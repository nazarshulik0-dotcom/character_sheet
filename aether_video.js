/**
 * ============================================================================
 * AETHER VIDEO & CAMERA HARDWARE ENGINE (aether_video.js) - v6.0 OMEGA GOLD
 * ----------------------------------------------------------------------------
 * Автономний відео-модуль для системи «ЕТЕР» (компанія «ЕНТРОПІЯ»):
 *   1. Smart Hardware Camera Selector (відсікає віртуальні камери смартфонів
 *      на ПК і примусово вмикає рідну фізичну вебкамеру через exact deviceId)
 *   2. Гаряча заміна камери на льоту (Hot-Swap) без розриву з'єднання
 *   3. Апаратний кодек WebP (із JPEG-фолбеком) + детектор руху (Smart Delta)
 *   4. Темпоральна інтерполяція 60 FPS (плавне згладжування кадрів Quantum Relay)
 *   5. Генератор тактичної голограми при вимкненій/відсутній фізичній камері
 * ============================================================================
 */

(function (window) {
  'use strict';

  const PREFERRED_CAM_STORAGE_KEY = 'entropia_aether_preferred_cam_v6';

  // Ключові слова віртуальних та телефонних камер, які Windows/macOS підсовують замість рідної вебки
  const VIRTUAL_OR_PHONE_KEYWORDS = [
    'link to windows', 'phone', 'телефон', 'смартфон', 'droidcam', 'iriun',
    'epoccam', 'camo', 'obs', 'virtual', 'continuity', 'iphone', 'ipad',
    'android', 'vcam', 'manycam', 'snap', 'xsplit', 'nvidia broadcast'
  ];

  // Ключові слова справжніх фізичних вебкамер ноутбуків та ПК
  const PHYSICAL_CAM_KEYWORDS = [
    'integrated', 'usb', 'webcam', 'hd camera', 'logitech', 'c920', 'c922',
    'brio', 'razer', 'kiyo', 'elgato', 'chicony', 'realtek', 'sunplus',
    'bison', 'acer', 'asus', 'hp ', 'lenovo', 'dell', 'facetime', 'front'
  ];

  class AetherVideoEngine {
    constructor(options = {}) {
      this.onQuantumVideoFrameOut = options.onQuantumVideoFrameOut || null;
      this.onCameraListUpdated = options.onCameraListUpdated || null;
      this.onLog = options.onLog || null;

      this.ecoMode = false;
      this.supportsWebP = this.detectWebPSupport();

      // Локальний стан відео
      this.localVideoTrack = null;
      this.isSyntheticTrack = false;
      this.selectedCameraId = localStorage.getItem(PREFERRED_CAM_STORAGE_KEY) || '';
      this.cameraEnabled = true;
      this.localCallsign = 'Оперативник';

      // Прихований DOM-док, щоб мобільні браузери (Safari/Chrome) ніколи не заморожували декодер
      this.hiddenDock = this.createHiddenMediaDock();
      this.localSamplerVideo = this.createSamplerVideoElement();

      // Кодувальник Quantum Video Relay (WebP / JPEG + детектор руху)
      this.txWidth = 240;
      this.txHeight = 180;
      this.txCanvas = document.createElement('canvas');
      this.txCanvas.width = this.txWidth;
      this.txCanvas.height = this.txHeight;
      this.txCtx = this.txCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
      this.lastFrameSignature = null;
      this.lastKeyframeSentAt = 0;
      this.encoderTimer = null;

      // Віддалені відео-рендерери гравців (з плавною 60 FPS інтерполяцією): peerId -> PeerVideoChannel
      this.peerVideos = new Map();

      this.startInterpolationLoop();

      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => {
          this.enumerateAndRankCameras();
        });
      }
    }

    log(msg) {
      console.log(`%c[AetherVideo v6.0]%c ${msg}`, 'color:#22d3ee;font-weight:bold;', 'color:#e2e8f0;');
      if (this.onLog) this.onLog(msg);
    }

    detectWebPSupport() {
      try {
        const c = document.createElement('canvas');
        c.width = 2;
        c.height = 2;
        return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
      } catch (_) {
        return false;
      }
    }

    createHiddenMediaDock() {
      let dock = document.getElementById('aether-video-engine-dock');
      if (!dock) {
        dock = document.createElement('div');
        dock.id = 'aether-video-engine-dock';
        dock.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:4px;height:4px;opacity:0.01;pointer-events:none;overflow:hidden;z-index:-1;';
        document.body.appendChild(dock);
      }
      return dock;
    }

    createSamplerVideoElement() {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.width = this.txWidth;
      v.height = this.txHeight;
      this.hiddenDock.appendChild(v);
      return v;
    }

    // =========================================================================
    // 1. РОЗУМНИЙ ПОШУК КАМЕР (ІГНОРУВАННЯ ТЕЛЕФОНА ЯК ВЕБКИ ЗА ЗАМОВЧУВАННЯМ)
    // =========================================================================
    scoreCameraDevice(device, index) {
      const label = (device.label || '').toLowerCase();
      let score = 50 - index * 2;

      if (!label) return score;

      // Штрафуємо віртуальні камери та підключені смартфони, щоб ПК брав рідну вебку
      for (const badWord of VIRTUAL_OR_PHONE_KEYWORDS) {
        if (label.includes(badWord)) {
          score -= 120;
          break;
        }
      }

      // Підвищуємо рейтинг справжніх фізичних камер (USB / Integrated)
      for (const goodWord of PHYSICAL_CAM_KEYWORDS) {
        if (label.includes(goodWord)) {
          score += 65;
          break;
        }
      }

      return score;
    }

    async enumerateAndRankCameras() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = allDevices
          .filter((d) => d.kind === 'videoinput')
          .map((d, idx) => ({
            deviceId: d.deviceId,
            label: d.label || `Камера #${idx + 1}`,
            groupId: d.groupId,
            score: this.scoreCameraDevice(d, idx),
            isVirtualOrPhone: VIRTUAL_OR_PHONE_KEYWORDS.some((w) => (d.label || '').toLowerCase().includes(w))
          }))
          .sort((a, b) => b.score - a.score);

        if (this.onCameraListUpdated) {
          this.onCameraListUpdated(videoInputs, this.selectedCameraId);
        }
        return videoInputs;
      } catch (err) {
        console.warn('[AetherVideo] Помилка переліку камер:', err);
        return [];
      }
    }

    // =========================================================================
    // 2. ЗАХОПЛЕННЯ ФІЗИЧНОЇ КАМЕРИ З КАСКАДНИМ РЕЗЕРВОМ ТА HOT-SWAP
    // =========================================================================
    async acquireCameraTrack(explicitDeviceId = '', callsign = 'Оперативник') {
      this.localCallsign = callsign || this.localCallsign;
      this.stopSyntheticGenerator();

      if (explicitDeviceId) {
        this.selectedCameraId = explicitDeviceId;
        localStorage.setItem(PREFERRED_CAM_STORAGE_KEY, explicitDeviceId);
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.log('Браузер блокує фізичну камеру (потрібен HTTPS). Увімкнено голографічний аватар.');
        return this.createSyntheticVideoTrack();
      }

      // Крок А: Отримуємо ранжований список камер (фізичні камери ПК йдуть першими!)
      let cameras = await this.enumerateAndRankCameras();

      // Якщо назви камер ще приховані браузером (до першого дозволу), робимо короткий пробний запит
      if (cameras.length > 0 && !cameras[0].label.includes(' ') && cameras[0].label.startsWith('Камера #')) {
        try {
          const probeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          probeStream.getTracks().forEach((t) => t.stop());
          cameras = await this.enumerateAndRankCameras();
        } catch (_) {}
      }

      // Визначаємо цільову камеру: або обрана користувачем, або найкраща фізична камера ПК
      let targetCamId = this.selectedCameraId;
      const savedExists = cameras.some((c) => c.deviceId === targetCamId);

      if (!targetCamId || !savedExists) {
        const bestPhysical = cameras[0]; // Вже відсортовано: фізична вебкамера має найвищий бал
        if (bestPhysical && bestPhysical.deviceId) {
          targetCamId = bestPhysical.deviceId;
          this.selectedCameraId = targetCamId;
          this.log(`Автовибір фізичної камери: "${bestPhysical.label}" (ігноруючи віртуальні).`);
        }
      }

      // Будуємо чергу профілів захоплення (від точного ID фізичної камери до універсального)
      const attempts = [];
      if (targetCamId) {
        attempts.push({
          deviceId: { exact: targetCamId },
          width: { ideal: 480 },
          height: { ideal: 360 },
          frameRate: { ideal: 24 }
        });
        attempts.push({
          deviceId: { exact: targetCamId }
        });
      }

      // Якщо перша камера виявилася зайнятою іншою програмою — пробуємо наступні фізичні камери зі списку
      cameras.forEach((cam) => {
        if (cam.deviceId && cam.deviceId !== targetCamId) {
          attempts.push({
            deviceId: { exact: cam.deviceId },
            width: { ideal: 480 },
            height: { ideal: 360 }
          });
        }
      });

      attempts.push({ width: { ideal: 480 }, height: { ideal: 360 } });
      attempts.push(true);

      for (const constraint of attempts) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: constraint, audio: false });
          const track = stream.getVideoTracks()[0];
          if (track) {
            if (this.localVideoTrack) {
              try { this.localVideoTrack.stop(); } catch (_) {}
            }
            this.localVideoTrack = track;
            this.isSyntheticTrack = false;
            this.cameraEnabled = true;

            const settings = track.getSettings ? track.getSettings() : {};
            if (settings.deviceId) {
              this.selectedCameraId = settings.deviceId;
              localStorage.setItem(PREFERRED_CAM_STORAGE_KEY, settings.deviceId);
            }

            this.attachTrackToSampler(track);
            await this.enumerateAndRankCameras();
            this.log(`Активна камера: "${track.label || 'WebCam'}" (${settings.width || 480}x${settings.height || 360}).`);
            return track;
          }
        } catch (err) {
          // Продовжуємо перебір наступної доступної камери
        }
      }

      this.log('Жодна фізична вебкамера не відповіла — вмикаємо тактичну голограму.');
      return this.createSyntheticVideoTrack();
    }

    attachTrackToSampler(videoTrack) {
      if (!videoTrack) return;
      const samplerStream = new MediaStream([videoTrack]);
      this.localSamplerVideo.srcObject = samplerStream;
      this.localSamplerVideo.play().catch(() => {});
    }

    // Генерація живого тактичного радара, якщо гравець без камери або вимкнув її
    createSyntheticVideoTrack() {
      this.stopSyntheticGenerator();

      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      let angle = 0;

      this._synthTimer = setInterval(() => {
        angle += 0.08;
        ctx.fillStyle = '#0a100e';
        ctx.fillRect(0, 0, 320, 240);

        // Концентричні кільця сканера
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.22)';
        ctx.lineWidth = 1.5;
        [34, 58, 82].forEach((r) => {
          ctx.beginPath();
          ctx.arc(160, 108, r, 0, Math.PI * 2);
          ctx.stroke();
        });

        // Обертовий промінь радара
        ctx.save();
        ctx.translate(160, 108);
        ctx.rotate(angle);
        const grad = ctx.createLinearGradient(0, 0, 75, 0);
        grad.addColorStop(0, 'rgba(52, 211, 153, 0.65)');
        grad.addColorStop(1, 'transparent');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(78, 0);
        ctx.stroke();
        ctx.restore();

        // Позивний гравця
        ctx.fillStyle = '#d1fae5';
        ctx.font = 'bold 15px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.localCallsign || 'ОПЕРАТИВНИК', 160, 113);

        ctx.fillStyle = '#34d399';
        ctx.font = '10px monospace';
        ctx.fillText('TACTICAL LINK // AUDIO ACTIVE', 160, 212);
      }, 90);

      const stream = canvas.captureStream(12);
      const track = stream.getVideoTracks()[0];
      this.localVideoTrack = track;
      this.isSyntheticTrack = true;
      this.attachTrackToSampler(track);
      return track;
    }

    stopSyntheticGenerator() {
      if (this._synthTimer) {
        clearInterval(this._synthTimer);
        this._synthTimer = null;
      }
    }

    // =========================================================================
    // 3. QUANTUM VIDEO ENCODER (WEBP + ДЕТЕКТОР РУХУ SMART LUMA DELTA)
    // =========================================================================
    startQuantumVideoEncoder(shouldSendCallback) {
      if (this.encoderTimer) clearInterval(this.encoderTimer);

      const mimeType = this.supportsWebP ? 'image/webp' : 'image/jpeg';

      this.encoderTimer = setInterval(() => {
        if (!this.cameraEnabled || !this.localVideoTrack) return;
        if (typeof shouldSendCallback === 'function' && !shouldSendCallback()) return;
        if (!this.localSamplerVideo || this.localSamplerVideo.readyState < 2) return;

        try {
          this.txCtx.drawImage(this.localSamplerVideo, 0, 0, this.txWidth, this.txHeight);

          // Обчислюємо швидкий підпис яскравості кадру (сітка 8x6 точок),
          // щоб не спамити мережу однаковими кадрами, коли гравець не рухається
          const motionDelta = this.computeMotionDelta();
          const now = Date.now();
          const forceKeyframe = (now - this.lastKeyframeSentAt) > 1400;

          if (motionDelta < 1.8 && !forceKeyframe) {
            return; // Гравець статичний — пропускаємо дублікат, економимо трафік для звуку!
          }

          this.lastKeyframeSentAt = now;
          const quality = this.ecoMode ? 0.42 : (motionDelta > 12 ? 0.50 : 0.58);
          const dataUrl = this.txCanvas.toDataURL(mimeType, quality);

          if (this.onQuantumVideoFrameOut) {
            this.onQuantumVideoFrameOut({
              t: 'V',
              d: dataUrl
            });
          }
        } catch (_) {}
      }, 115); // До ~8.5–9 FPS реальних змін (розганяється інтерполятором до 60 FPS на прийомі)
    }

    computeMotionDelta() {
      try {
        const imgData = this.txCtx.getImageData(0, 0, this.txWidth, this.txHeight).data;
        const sig = new Uint8Array(48);
        let idx = 0;

        for (let y = 15; y < this.txHeight; y += 30) {
          for (let x = 15; x < this.txWidth; x += 30) {
            if (idx >= 48) break;
            const p = (y * this.txWidth + x) * 4;
            sig[idx++] = (imgData[p] * 2 + imgData[p + 1] * 5 + imgData[p + 2]) >> 3;
          }
        }

        if (!this.lastFrameSignature) {
          this.lastFrameSignature = sig;
          return 100;
        }

        let diffSum = 0;
        for (let i = 0; i < 48; i++) {
          diffSum += Math.abs(sig[i] - this.lastFrameSignature[i]);
        }
        this.lastFrameSignature = sig;
        return diffSum / 48;
      } catch (_) {
        return 50;
      }
    }

    // =========================================================================
    // 4. ПРИЙОМ КАДРІВ ТА 60 FPS ІНТЕРПОЛЯЦІЯ (TEMPORAL CROSS-DISSOLVE)
    // =========================================================================
    getOrCreatePeerVideo(remoteId) {
      if (this.peerVideos.has(remoteId)) {
        return this.peerVideos.get(remoteId);
      }

      const prevCanvas = document.createElement('canvas');
      prevCanvas.width = this.txWidth;
      prevCanvas.height = this.txHeight;
      const prevCtx = prevCanvas.getContext('2d');

      const currCanvas = document.createElement('canvas');
      currCanvas.width = this.txWidth;
      currCanvas.height = this.txHeight;
      const currCtx = currCanvas.getContext('2d');

      const peerVid = {
        remoteId,
        prevCanvas,
        prevCtx,
        currCanvas,
        currCtx,
        frameTimestamp: 0,
        blendDurationMs: 125,
        hasRelayFrames: false,
        targetSeatId: null
      };

      this.peerVideos.set(remoteId, peerVid);
      return peerVid;
    }

    ingestQuantumVideoFrame(remoteId, pkt, seatId = null) {
      if (!pkt || !pkt.d) return;
      const peerVid = this.getOrCreatePeerVideo(remoteId);
      if (seatId) peerVid.targetSeatId = seatId;

      const img = new Image();
      img.onload = () => {
        // Копіюємо попередній кадр у prevCanvas для плавного перетікання (Cross-Dissolve)
        if (peerVid.hasRelayFrames) {
          peerVid.prevCtx.drawImage(peerVid.currCanvas, 0, 0, this.txWidth, this.txHeight);
        } else {
          peerVid.prevCtx.drawImage(img, 0, 0, this.txWidth, this.txHeight);
        }

        peerVid.currCtx.drawImage(img, 0, 0, this.txWidth, this.txHeight);
        peerVid.frameTimestamp = performance.now();
        peerVid.hasRelayFrames = true;
      };
      img.src = pkt.d;
    }

    startInterpolationLoop() {
      const render = (now) => {
        this.peerVideos.forEach((peerVid) => {
          if (!peerVid.hasRelayFrames || !peerVid.targetSeatId) return;

          const seatCanvas = document.getElementById(`relay-canvas-${peerVid.targetSeatId}`);
          if (!seatCanvas) return;

          const ctx = seatCanvas.getContext('2d');
          if (this.ecoMode) {
            ctx.drawImage(peerVid.currCanvas, 0, 0, seatCanvas.width, seatCanvas.height);
            return;
          }

          // Плавна інтерполяція прозорості між попереднім і поточним кадром
          const elapsed = now - peerVid.frameTimestamp;
          const alpha = Math.max(0, Math.min(1, elapsed / peerVid.blendDurationMs));

          ctx.globalAlpha = 1.0;
          ctx.drawImage(peerVid.prevCanvas, 0, 0, seatCanvas.width, seatCanvas.height);

          if (alpha > 0) {
            ctx.globalAlpha = alpha;
            ctx.drawImage(peerVid.currCanvas, 0, 0, seatCanvas.width, seatCanvas.height);
          }
          ctx.globalAlpha = 1.0;
        });

        requestAnimationFrame(render);
      };
      requestAnimationFrame(render);
    }

    // Прив'язка відеопотоку (WebRTC або Quantum) до конкретного крісла за столом
    bindSeatVideo(seatId, { isLocal, localStream, remotePeerId, webrtcStream, hasVideoFlag }) {
      const node = document.getElementById(`seat-${seatId}`);
      const videoEl = document.getElementById(`video-${seatId}`);
      if (!node || !videoEl) return;

      if (isLocal) {
        const showLocal = !!(localStream && hasVideoFlag && this.cameraEnabled);
        node.classList.toggle('has-video', showLocal);
        node.classList.toggle('show-webrtc-video', showLocal);
        node.classList.remove('show-relay-video');

        videoEl.dataset.isLocal = 'true';
        videoEl.muted = true;
        if (showLocal && videoEl.srcObject !== localStream) {
          videoEl.srcObject = localStream;
          videoEl.play().catch(() => {});
        }
        return;
      }

      const peerVid = remotePeerId ? this.peerVideos.get(remotePeerId) : null;
      if (peerVid) {
        peerVid.targetSeatId = seatId;
      }

      const hasLiveWebRTC = !!(
        webrtcStream &&
        webrtcStream.getVideoTracks().length > 0 &&
        webrtcStream.getVideoTracks()[0].readyState === 'live' &&
        hasVideoFlag !== false
      );
      const hasQuantumRelay = !!(peerVid && peerVid.hasRelayFrames && hasVideoFlag !== false);

      if (hasLiveWebRTC) {
        node.classList.add('has-video', 'show-webrtc-video');
        node.classList.remove('show-relay-video');
        delete videoEl.dataset.isLocal;
        // Звук грає через AetherAudioEngine, тому саме <video> тримаємо muted,
        // щоб мобільний Safari ніколи не блокував автовідтворення картинки!
        videoEl.muted = true;
        if (videoEl.srcObject !== webrtcStream) {
          videoEl.srcObject = webrtcStream;
        }
        videoEl.play().catch(() => {});
      } else if (hasQuantumRelay) {
        node.classList.add('has-video', 'show-relay-video');
        node.classList.remove('show-webrtc-video');
      } else {
        node.classList.remove('has-video', 'show-webrtc-video', 'show-relay-video');
      }
    }

    setEcoMode(enabled) {
      this.ecoMode = !!enabled;
    }

    removePeer(remoteId) {
      this.peerVideos.delete(remoteId);
    }
  }

  window.AetherVideoEngine = AetherVideoEngine;
})(window);