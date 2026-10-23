/**
 * ============================================================================
 * AETHER VIDEO OPTIMIZER (aether_video_optimizer.js) - v5.0 SHOWRUNNER EDITION
 * ----------------------------------------------------------------------------
 * Повний стек відео-оптимізації та біометричної візуалізації:
 *   1. 60 FPS Reactive Voice Aura: динамічне світіння та масштаб ореолу крісла
 *      пропорційно реальній гучності та енергії голосу учасника.
 *   2. Biometric Character State Shaders (синхронізація з Листом Персонажа):
 *      - 🩸 HP < 25% (Поранений): багряна пульсуюча віньєтка навколо камери
 *      - 🔮 Безумство / Прокляття: містичне фіолетово-бірюзове зміщення
 *      - 🎲 Крит Nat 20: золотий спалах тріумфу на кріслі гравця
 *   3. GPU Convolution Unsharp Mask (SVG HD Filter) + плашка «📜 У Листі».
 *   4. Off-Thread createImageBitmap GPU Decoder + Auto Night-Vision.
 * ============================================================================
 */

(function (window) {
  'use strict';

  window.AetherOptimizers = window.AetherOptimizers || {
    audio: null,
    video: null,
    network: null,
    activeEngine: null,
    register(type, instance) {
      this[type] = instance;
      if (this.activeEngine && typeof instance.attach === 'function') {
        instance.attach(this.activeEngine);
      }
    }
  };

  class AetherVideoOptimizer {
    constructor() {
      this.engine = null;
      this.video = null;
      this.timer = null;
      this.nightVisionActive = false;
      this.hdSharpenEnabled = true;

      this.remoteTabHiddenMap = new Map();
      // Біометричні стани гравців: peerId -> 'normal' | 'wounded' | 'cursed' | 'crit20'
      this.peerBiometricStateMap = new Map();
      this.localBiometricState = 'normal';
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.video = rtcEngine.video;
      if (!this.video) return;

      this.injectSvgHdAndBiometricStyles();
      this.installGpuBitmapDecoderHook();
      this.setupVisibilityAndBiometricSync();
      this.startReactiveVoiceAuraLoop();
      this.startVideoGovernorLoop();

      this.engine.log('🎬 [VideoOptimizer v5.0] Реактивна Аура + Біометричні шейдери HP/Крит готові.');
    }

    // =========================================================================
    // 1. SVG МАТРИЦЯ ЧІТКОСТІ ТА БІОМЕТРИЧНІ СТИЛІ КРІСЕЛ (HP / ПРОКЛЯТТЯ / КРИТ)
    // =========================================================================
    injectSvgHdAndBiometricStyles() {
      if (document.getElementById('aether-hd-svg-defs-v5')) return;

      const svgWrap = document.createElement('div');
      svgWrap.id = 'aether-hd-svg-defs-v5';
      svgWrap.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;';
      svgWrap.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="aether-unsharp-hd" color-interpolation-filters="sRGB">
              <feConvolveMatrix
                order="3 3"
                preserveAlpha="true"
                kernelMatrix="0 -0.35 0 -0.35 2.4 -0.35 0 -0.35 0"
              />
            </filter>
          </defs>
        </svg>
        <style>
          body:not(.eco-mode) .seat-node.has-video.hd-sharpen-on .seat-media-frame video,
          body:not(.eco-mode) .seat-node.has-video.hd-sharpen-on .seat-media-frame canvas.relay-canvas-view {
            filter: url(#aether-unsharp-hd) contrast(1.04) saturate(1.05);
          }

          /* Біометричний стан: Поранений (HP < 25%) */
          .seat-node.bio-wounded .seat-media-frame {
            border-color: #ef4444 !important;
            animation: aetherBioWoundedPulse 1.6s infinite ease-in-out !important;
          }
          .seat-node.bio-wounded .seat-media-frame::after {
            content: '🩸 КРИТИЧНЕ HP';
            position: absolute;
            inset: 0;
            box-shadow: inset 0 0 24px rgba(239, 68, 68, 0.78);
            display: flex;
            align-items: flex-end;
            justify-content: center;
            padding-bottom: 3px;
            font-size: 8px;
            font-weight: 800;
            color: #fecaca;
            letter-spacing: 0.6px;
            pointer-events: none;
            z-index: 11;
          }
          @keyframes aetherBioWoundedPulse {
            0%, 100% { box-shadow: 0 0 14px rgba(239, 68, 68, 0.65); }
            50% { box-shadow: 0 0 28px rgba(220, 38, 38, 0.98); }
          }

          /* Біометричний стан: Безумство / Прокляття Безодні */
          .seat-node.bio-cursed .seat-media-frame {
            border-color: #a855f7 !important;
            box-shadow: -3px 0 16px rgba(168, 85, 247, 0.85), 3px 0 16px rgba(34, 211, 238, 0.85) !important;
          }
          .seat-node.bio-cursed .seat-media-frame video,
          .seat-node.bio-cursed .seat-media-frame canvas.relay-canvas-view {
            filter: hue-rotate(28deg) contrast(1.18) saturate(1.3) !important;
          }

          /* Біометричний стан: Критичний Успіх (Nat 20!) */
          .seat-node.bio-crit20 .seat-media-frame {
            border-color: #fbbf24 !important;
            box-shadow: 0 0 36px rgba(251, 191, 36, 0.98), inset 0 0 22px rgba(251, 191, 36, 0.65) !important;
            transform: scale(1.06);
          }

          .seat-tab-badge {
            position: absolute;
            top: 5px;
            left: 5px;
            background: rgba(9, 14, 18, 0.86);
            border: 1px solid rgba(52, 211, 153, 0.55);
            color: #6ee7b7;
            font-size: 9px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 5px;
            z-index: 12;
            pointer-events: none;
            backdrop-filter: blur(4px);
          }

          .seat-whisper-badge {
            position: absolute;
            bottom: 5px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(6, 78, 59, 0.92);
            border: 1px solid #22d3ee;
            color: #a5f3fc;
            font-size: 9px;
            font-weight: 700;
            padding: 2px 7px;
            border-radius: 6px;
            z-index: 14;
            pointer-events: none;
            white-space: nowrap;
            box-shadow: 0 0 12px rgba(34, 211, 238, 0.65);
          }
        </style>
      `;
      document.body.appendChild(svgWrap);
    }

    setHdSharpenEnabled(enabled) {
      this.hdSharpenEnabled = !!enabled;
      this.decorateSeatsWithHdAndBadges();
    }

    // Встановлення біометричного стану локального персонажа та трансляція на стіл
    setLocalBiometricState(stateName) {
      this.localBiometricState = stateName || 'normal';
      this.peerBiometricStateMap.set(this.engine.deviceId, this.localBiometricState);

      if (this.engine && this.engine.publishRoomPacket) {
        this.engine.publishRoomPacket({
          type: 'CHAR_VITAL_STATE',
          from: this.engine.deviceId,
          vitalState: this.localBiometricState
        });
      }

      // Якщо це спалах Nat 20 — автоматично повертаємо в норму через 4 секунди
      if (this.localBiometricState === 'crit20') {
        setTimeout(() => {
          if (this.localBiometricState === 'crit20') {
            this.setLocalBiometricState('normal');
          }
        }, 4000);
      }

      this.decorateSeatsWithHdAndBadges();
    }

    // =========================================================================
    // 2. РЕАКТИВНА АУРА ГОЛОСУ (ПЛАВНИЙ СПЕКТРАЛЬНИЙ ОРЕОЛ КРІСЕЛ)
    // =========================================================================
    startReactiveVoiceAuraLoop() {
      const renderAura = () => {
        if (this.engine && !this.video.ecoMode && !document.hidden) {
          const audioOpt = window.AetherOptimizers.audio;
          if (audioOpt) {
            // Локальне крісло
            this.applyAuraToSeat(this.engine.localState?.seat, audioOpt.getPeerVoiceEnergy(this.engine.deviceId));
            // Віддалені крісла
            this.engine.remoteDevices.forEach((dev, remoteId) => {
              this.applyAuraToSeat(dev.seat, audioOpt.getPeerVoiceEnergy(remoteId));
            });
          }
        }
        requestAnimationFrame(renderAura);
      };
      requestAnimationFrame(renderAura);
    }

    applyAuraToSeat(seatId, energy) {
      if (!seatId) return;
      const node = document.getElementById(`seat-${seatId}`);
      const frame = document.getElementById(`frame-${seatId}`);
      if (!node || !frame) return;

      // Не перебиваємо спецефекти поранення чи криту
      if (node.classList.contains('bio-wounded') || node.classList.contains('bio-crit20')) {
        return;
      }

      if (energy > 0.08) {
        const radiusPx = Math.round(12 + energy * 26);
        const alpha = (0.45 + energy * 0.5).toFixed(2);
        // При високій емоційній гучності ореол переходить зі смарагдового в яскраво-бірюзовий
        const color = energy > 0.62
          ? `rgba(34, 211, 238, ${alpha})`
          : `rgba(16, 185, 129, ${alpha})`;
        frame.style.boxShadow = `0 0 ${radiusPx}px ${color}`;
      } else {
        frame.style.boxShadow = '';
      }
    }

    // =========================================================================
    // 3. СИНХРОНІЗАЦІЯ СТАТУСУ ВКЛАДКИ ТА HP З ЛИСТА ПЕРСОНАЖА
    // =========================================================================
    setupVisibilityAndBiometricSync() {
      if (!this.engine) return;

      const origHandleRoom = this.engine.handleRoomMessage.bind(this.engine);
      this.engine.handleRoomMessage = (msg) => {
        if (msg && msg.type === 'TAB_FOCUS' && msg.from && msg.from !== this.engine.deviceId) {
          this.remoteTabHiddenMap.set(msg.from, !!msg.inSheet);
          this.decorateSeatsWithHdAndBadges();
          return;
        }
        if (msg && msg.type === 'CHAR_VITAL_STATE' && msg.from) {
          this.peerBiometricStateMap.set(msg.from, msg.vitalState || 'normal');
          this.decorateSeatsWithHdAndBadges();
          return;
        }
        if (msg && msg.type === 'SFX_TRIGGER' && msg.sfx && msg.from !== this.engine.deviceId) {
          window.AetherOptimizers.audio?.playProceduralSoundEffect(msg.sfx, false);
          return;
        }
        return origHandleRoom(msg);
      };

      const broadcastFocus = () => {
        const inSheet = !!document.hidden;
        if (this.engine && this.engine.publishRoomPacket) {
          this.engine.publishRoomPacket({
            type: 'TAB_FOCUS',
            from: this.engine.deviceId,
            inSheet
          });
        }
        if (inSheet) {
          this.video.applyOptimizerPatch({ frameIntervalMs: 480, webpQuality: 0.34 });
        } else {
          this.video.applyOptimizerPatch({ frameIntervalMs: 120, webpQuality: 0.54, blendDurationMs: 120 });
          this.healVideoElements();
        }
        this.decorateSeatsWithHdAndBadges();
      };

      document.addEventListener('visibilitychange', broadcastFocus);

      // Автоматичне читання HP персонажа з localStorage ('entropia_active_character')
      window.addEventListener('storage', (e) => {
        if (e.key === 'entropia_active_character') {
          this.checkCharacterSheetVitals();
        }
      });
    }

    checkCharacterSheetVitals() {
      try {
        const raw = localStorage.getItem('entropia_active_character');
        if (!raw) return;
        const char = JSON.parse(raw);
        const hp = Number(char.hp ?? char.currentHp);
        const maxHp = Number(char.maxHp ?? char.hpMax);

        if (!isNaN(hp) && !isNaN(maxHp) && maxHp > 0) {
          const ratio = hp / maxHp;
          if (ratio > 0 && ratio <= 0.25 && this.localBiometricState === 'normal') {
            this.setLocalBiometricState('wounded');
          } else if (ratio > 0.25 && this.localBiometricState === 'wounded') {
            this.setLocalBiometricState('normal');
          }
        }
      } catch (_) {}
    }

    decorateSeatsWithHdAndBadges() {
      if (!this.engine) return;

      document.querySelectorAll('.seat-node').forEach((node) => {
        node.classList.toggle('hd-sharpen-on', this.hdSharpenEnabled && !this.video.ecoMode);
      });

      // Застосовуємо біометричний стан до локального крісла
      const localSeat = this.engine.localState?.seat;
      if (localSeat) {
        this.applyBiometricClassesToSeat(localSeat, this.localBiometricState);
      }

      // Застосовуємо плашки та біометрію до віддалених крісел
      this.engine.remoteDevices.forEach((dev, remoteId) => {
        if (!dev.seat) return;
        const frame = document.getElementById(`frame-${dev.seat}`);
        if (!frame) return;

        let badge = frame.querySelector('.seat-tab-badge');
        const isLookingAtSheet = this.remoteTabHiddenMap.get(remoteId) === true;

        if (isLookingAtSheet) {
          if (!badge) {
            badge = document.createElement('div');
            badge.className = 'seat-tab-badge';
            badge.textContent = '📜 У Листі';
            frame.appendChild(badge);
          }
        } else if (badge) {
          badge.remove();
        }

        const bioState = this.peerBiometricStateMap.get(remoteId) || 'normal';
        this.applyBiometricClassesToSeat(dev.seat, bioState);
      });
    }

    applyBiometricClassesToSeat(seatId, bioState) {
      const node = document.getElementById(`seat-${seatId}`);
      if (!node) return;
      node.classList.toggle('bio-wounded', bioState === 'wounded');
      node.classList.toggle('bio-cursed', bioState === 'cursed');
      node.classList.toggle('bio-crit20', bioState === 'crit20');
    }

    // =========================================================================
    // 4. АПАРАТНИЙ GPU ДЕКОДЕР CREATEIMAGEBITMAP ТА NIGHT-VISION
    // =========================================================================
    installGpuBitmapDecoderHook() {
      if (!this.video || !window.createImageBitmap || this.video._gpuHookInstalled) return;
      this.video._gpuHookInstalled = true;

      const origIngest = this.video.ingestQuantumVideoFrame.bind(this.video);

      this.video.ingestQuantumVideoFrame = (remoteId, pkt, seatId = null) => {
        if (!pkt || !pkt.d) return;
        const peerVid = this.video.getOrCreatePeerVideo(remoteId);
        if (seatId) peerVid.targetSeatId = seatId;

        if (peerVid.decodingInFlight) return;
        peerVid.decodingInFlight = true;

        fetch(pkt.d)
          .then((res) => res.blob())
          .then((blob) => window.createImageBitmap(blob))
          .then((bitmap) => {
            peerVid.decodingInFlight = false;
            const w = peerVid.currCanvas.width;
            const h = peerVid.currCanvas.height;

            if (peerVid.hasRelayFrames) {
              peerVid.prevCtx.drawImage(peerVid.currCanvas, 0, 0, w, h);
            } else {
              peerVid.prevCtx.drawImage(bitmap, 0, 0, w, h);
            }

            peerVid.currCtx.drawImage(bitmap, 0, 0, w, h);
            bitmap.close();

            peerVid.frameTimestamp = performance.now();
            peerVid.hasRelayFrames = true;
            this.video.telemetry.framesReceived++;

            if (peerVid.targetSeatId) {
              const node = document.getElementById(`seat-${peerVid.targetSeatId}`);
              if (node && !node.classList.contains('show-webrtc-video')) {
                node.classList.add('has-video', 'show-relay-video');
              }
            }
          })
          .catch(() => {
            peerVid.decodingInFlight = false;
            origIngest(remoteId, pkt, seatId);
          });
      };
    }

    startVideoGovernorLoop() {
      if (this.timer) clearInterval(this.timer);

      this.timer = setInterval(() => {
        if (!this.video || !this.engine) return;

        this.checkCharacterSheetVitals();
        this.decorateSeatsWithHdAndBadges();
        if (!document.hidden) {
          this.adjustDynamicSpeakerFpsAndQuality();
          this.runAutoNightVisionEnhancer();
          this.healVideoElements();
        }
      }, 1500);
    }

    adjustDynamicSpeakerFpsAndQuality() {
      const vTel = this.video.getTelemetry();
      const encodeMs = vTel.lastEncodeDurationMs || 0;
      const fps = vTel.currentFps || 60;

      const isGM = this.engine.localState?.role === 'gm';
      const isLocalSpeaking = this.engine.audio
        ? this.engine.audio.isPeerSpeaking(this.engine.deviceId)
        : false;

      let someoneElseSpeaking = false;
      if (this.engine.audio) {
        this.engine.remoteDevices.forEach((_, remoteId) => {
          if (this.engine.audio.isPeerSpeaking(remoteId)) {
            someoneElseSpeaking = true;
          }
        });
      }

      if (encodeMs > 26 || fps < 36) {
        this.video.applyOptimizerPatch({ frameIntervalMs: 175, webpQuality: 0.40, blendDurationMs: 175 });
      } else if (someoneElseSpeaking && !isLocalSpeaking) {
        this.video.applyOptimizerPatch({ frameIntervalMs: 185, webpQuality: 0.42, blendDurationMs: 185 });
      } else if (isLocalSpeaking || isGM) {
        this.video.applyOptimizerPatch({ frameIntervalMs: 115, webpQuality: 0.56, blendDurationMs: 115 });
      } else {
        this.video.applyOptimizerPatch({ frameIntervalMs: 135, webpQuality: 0.50, blendDurationMs: 135 });
      }
    }

    runAutoNightVisionEnhancer() {
      if (!this.video.txCtx || !this.video.cameraEnabled || this.video.ecoMode) return;

      try {
        const w = this.video.txCanvas.width;
        const h = this.video.txCanvas.height;
        const data = this.video.txCtx.getImageData(0, 0, w, h).data;

        let lumaSum = 0;
        let samples = 0;
        for (let i = 0; i < data.length; i += 64) {
          lumaSum += (data[i] * 2 + data[i + 1] * 5 + data[i + 2]) >> 3;
          samples++;
        }

        const avgLuma = samples > 0 ? lumaSum / samples : 128;
        const shouldBoostLight = avgLuma > 8 && avgLuma < 62;

        if (shouldBoostLight !== this.nightVisionActive) {
          this.nightVisionActive = shouldBoostLight;
          this.video.txCtx.filter = shouldBoostLight
            ? 'brightness(1.22) contrast(1.08)'
            : 'none';
        }
      } catch (_) {}
    }

    healVideoElements() {
      document.querySelectorAll('.seat-node.show-webrtc-video video').forEach((vid) => {
        if (vid.srcObject && vid.paused) {
          vid.play().catch(() => {});
        }
      });
    }
  }

  window.AetherOptimizers.register('video', new AetherVideoOptimizer());
})(window);