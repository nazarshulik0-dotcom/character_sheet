/**
 * ============================================================================
 * AETHER ULTRA-STABLE VIDEO ENGINE (aether_video.js) - v7.0 GOLD
 * ----------------------------------------------------------------------------
 * Ключові інновації v7.0:
 *   1. Non-Drop Video Latch: якщо гравець увімкнув камеру, вікно відео ніколи
 *      не схлопується назад у кружечок при перемиканні між Relay та P2P.
 *   2. Fast-Frame WebP Encoder (10 FPS з миттєвою відправкою без блокування UI).
 *   3. Пріоритет рідної фізичної вебкамери ПК над віртуальними камерами смартфонів.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const PREFERRED_CAM_STORAGE_KEY = 'entropia_aether_preferred_cam_v7';

  const VIRTUAL_OR_PHONE_KEYWORDS = [
    'link to windows', 'phone', 'телефон', 'смартфон', 'droidcam', 'iriun',
    'epoccam', 'camo', 'obs', 'virtual', 'continuity', 'iphone', 'ipad',
    'android', 'vcam', 'manycam', 'snap', 'xsplit', 'nvidia broadcast'
  ];

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

      this.localVideoTrack = null;
      this.selectedCameraId = localStorage.getItem(PREFERRED_CAM_STORAGE_KEY) || '';
      this.cameraEnabled = true;
      this.localCallsign = 'Оперативник';

      this.hiddenDock = this.createInViewportMediaDock();
      this.localSamplerVideo = this.createSamplerVideoElement();

      this.txWidth = 220;
      this.txHeight = 165;
      this.txCanvas = document.createElement('canvas');
      this.txCanvas.width = this.txWidth;
      this.txCanvas.height = this.txHeight;
      this.txCtx = this.txCanvas.getContext('2d', { alpha: false });
      this.encoderTimer = null;

      this.peerVideos = new Map();
      this.startInterpolationLoop();
    }

    log(msg) {
      console.log(`%c[AetherVideo v7.0]%c ${msg}`, 'color:#22d3ee;font-weight:bold;', 'color:#e2e8f0;');
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

    createInViewportMediaDock() {
      let dock = document.getElementById('aether-video-engine-dock');
      if (!dock) {
        dock = document.createElement('div');
        dock.id = 'aether-video-engine-dock';
        dock.style.cssText = 'position:fixed;bottom:1px;right:1px;width:2px;height:2px;opacity:0.01;pointer-events:none;overflow:hidden;z-index:1;';
        document.body.appendChild(dock);
      }
      return dock;
    }

    createSamplerVideoElement() {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.style.cssText = 'width:2px;height:2px;';
      this.hiddenDock.appendChild(v);
      return v;
    }

    isVirtualOrPhoneLabel(label = '') {
      const low = label.toLowerCase();
      return VIRTUAL_OR_PHONE_KEYWORDS.some((w) => low.includes(w));
    }

    scoreCameraDevice(device, index) {
      const label = (device.label || '').toLowerCase();
      let score = 50 - index * 2;
      if (!label) return score;

      if (this.isVirtualOrPhoneLabel(label)) score -= 120;
      if (PHYSICAL_CAM_KEYWORDS.some((w) => label.includes(w))) score += 65;
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
            score: this.scoreCameraDevice(d, idx),
            isVirtualOrPhone: this.isVirtualOrPhoneLabel(d.label || '')
          }))
          .sort((a, b) => b.score - a.score);

        if (this.onCameraListUpdated) {
          this.onCameraListUpdated(videoInputs, this.selectedCameraId);
        }
        return videoInputs;
      } catch (_) {
        return [];
      }
    }

    async acquireCameraTrack(explicitDeviceId = '', callsign = 'Оперативник') {
      this.localCallsign = callsign || this.localCallsign;
      this.stopSyntheticGenerator();

      if (explicitDeviceId) {
        this.selectedCameraId = explicitDeviceId;
        localStorage.setItem(PREFERRED_CAM_STORAGE_KEY, explicitDeviceId);
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return this.createSyntheticVideoTrack();
      }

      let cameras = await this.enumerateAndRankCameras();
      let targetCamId = explicitDeviceId || this.selectedCameraId;

      if (!targetCamId || !cameras.some((c) => c.deviceId === targetCamId)) {
        if (cameras[0] && cameras[0].deviceId) {
          targetCamId = cameras[0].deviceId;
        }
      }

      const vConstraint = targetCamId
        ? { deviceId: { ideal: targetCamId }, width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 24 } }
        : { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 24 } };

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: vConstraint, audio: false });
        let track = stream.getVideoTracks()[0];

        cameras = await this.enumerateAndRankCameras();
        if (!explicitDeviceId && track && this.isVirtualOrPhoneLabel(track.label)) {
          const realCam = cameras.find((c) => !c.isVirtualOrPhone && c.deviceId);
          if (realCam) {
            try {
              const realStream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: realCam.deviceId }, width: { ideal: 480 }, height: { ideal: 360 } },
                audio: false
              });
              track.stop();
              track = realStream.getVideoTracks()[0];
              this.log(`Обрано фізичну вебкамеру ПК: "${track.label}"`);
            } catch (_) {}
          }
        }

        if (track) {
          if (this.localVideoTrack && this.localVideoTrack !== track) {
            try { this.localVideoTrack.stop(); } catch (_) {}
          }
          this.localVideoTrack = track;
          this.cameraEnabled = true;

          track.onended = () => {
            if (this.cameraEnabled) {
              this.acquireCameraTrack(this.selectedCameraId, this.localCallsign);
            }
          };

          const settings = track.getSettings ? track.getSettings() : {};
          if (settings.deviceId) {
            this.selectedCameraId = settings.deviceId;
            localStorage.setItem(PREFERRED_CAM_STORAGE_KEY, settings.deviceId);
          }

          this.attachTrackToSampler(track);
          await this.enumerateAndRankCameras();
          this.log(`Камера працює: "${track.label || 'WebCam'}".`);
          return track;
        }
      } catch (err) {
        this.log(`Фізична камера зайнята (${err.name}) — увімкнено голограму.`);
      }

      return this.createSyntheticVideoTrack();
    }

    attachTrackToSampler(videoTrack) {
      if (!videoTrack) return;
      this.localSamplerVideo.srcObject = new MediaStream([videoTrack]);
      this.localSamplerVideo.play().catch(() => {});
    }

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

        ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.lineWidth = 1.5;
        [36, 62].forEach((r) => {
          ctx.beginPath();
          ctx.arc(160, 108, r, 0, Math.PI * 2);
          ctx.stroke();
        });

        ctx.fillStyle = '#d1fae5';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.localCallsign || 'ОПЕРАТИВНИК', 160, 113);
        ctx.fillStyle = '#34d399';
        ctx.font = '10px monospace';
        ctx.fillText('TACTICAL LINK ACTIVE', 160, 208);
      }, 100);

      const stream = canvas.captureStream(12);
      const track = stream.getVideoTracks()[0];
      this.localVideoTrack = track;
      this.attachTrackToSampler(track);
      return track;
    }

    stopSyntheticGenerator() {
      if (this._synthTimer) {
        clearInterval(this._synthTimer);
        this._synthTimer = null;
      }
    }

    startQuantumVideoEncoder(shouldSendCallback) {
      if (this.encoderTimer) clearInterval(this.encoderTimer);
      const mimeType = this.supportsWebP ? 'image/webp' : 'image/jpeg';

      this.encoderTimer = setInterval(() => {
        if (!this.cameraEnabled || !this.localVideoTrack) return;
        if (typeof shouldSendCallback === 'function' && !shouldSendCallback()) return;

        let sourceVid = document.querySelector('video[data-is-local="true"]');
        if (!sourceVid || sourceVid.readyState < 2 || sourceVid.videoWidth === 0) {
          sourceVid = this.localSamplerVideo;
        }
        if (!sourceVid || sourceVid.readyState < 2) {
          if (sourceVid) sourceVid.play().catch(() => {});
          return;
        }

        try {
          this.txCtx.drawImage(sourceVid, 0, 0, this.txWidth, this.txHeight);
          const quality = this.ecoMode ? 0.40 : 0.50;
          const dataUrl = this.txCanvas.toDataURL(mimeType, quality);

          if (this.onQuantumVideoFrameOut) {
            this.onQuantumVideoFrameOut({
              t: 'V',
              d: dataUrl
            });
          }
        } catch (_) {}
      }, 110); // ~9 FPS реальних кадрів із плавною розгорткою до 60 FPS
    }

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
        blendDurationMs: 115,
        hasRelayFrames: false,
        decodingInFlight: false,
        targetSeatId: null
      };

      this.peerVideos.set(remoteId, peerVid);
      return peerVid;
    }

    ingestQuantumVideoFrame(remoteId, pkt, seatId = null) {
      if (!pkt || !pkt.d) return;
      const peerVid = this.getOrCreatePeerVideo(remoteId);
      if (seatId) peerVid.targetSeatId = seatId;

      if (peerVid.decodingInFlight) return;
      peerVid.decodingInFlight = true;

      const img = new Image();
      img.onload = () => {
        peerVid.decodingInFlight = false;
        if (peerVid.hasRelayFrames) {
          peerVid.prevCtx.drawImage(peerVid.currCanvas, 0, 0, this.txWidth, this.txHeight);
        } else {
          peerVid.prevCtx.drawImage(img, 0, 0, this.txWidth, this.txHeight);
        }
        peerVid.currCtx.drawImage(img, 0, 0, this.txWidth, this.txHeight);
        peerVid.frameTimestamp = performance.now();
        peerVid.hasRelayFrames = true;

        if (peerVid.targetSeatId) {
          const node = document.getElementById(`seat-${peerVid.targetSeatId}`);
          if (node && !node.classList.contains('show-webrtc-video')) {
            node.classList.add('has-video', 'show-relay-video');
          }
        }
      };
      img.onerror = () => {
        peerVid.decodingInFlight = false;
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

      if (hasVideoFlag === false) {
        node.classList.remove('has-video', 'show-webrtc-video', 'show-relay-video');
        return;
      }

      const hasWebRTCVideo = !!(webrtcStream && webrtcStream.getVideoTracks().length > 0);
      const hasQuantumRelay = !!(peerVid && peerVid.hasRelayFrames);

      if (hasWebRTCVideo) {
        delete videoEl.dataset.isLocal;
        videoEl.muted = true;
        if (videoEl.srcObject !== webrtcStream) {
          videoEl.srcObject = webrtcStream;
          videoEl.play().catch(() => {});
        }

        // Якщо P2P-відео вже реально рендерить пікселі — показуємо його,
        // інакше тримаємо відкритим Quantum Canvas (щоб відео ніколи не мигало і не відлітало!)
        if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
          node.classList.add('has-video', 'show-webrtc-video');
          node.classList.remove('show-relay-video');
        } else if (hasQuantumRelay) {
          node.classList.add('has-video', 'show-relay-video');
          node.classList.remove('show-webrtc-video');
        }
      } else if (hasQuantumRelay) {
        node.classList.add('has-video', 'show-relay-video');
        node.classList.remove('show-webrtc-video');
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