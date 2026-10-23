/**
 * ============================================================================
 * AETHER VIDEO OPTIMIZER (aether_video_optimizer.js) - v4.0 ULTIMATE MASTER
 * ----------------------------------------------------------------------------
 * Повний стек відео-оптимізації (Пакет 3):
 *   1. GPU Convolution Unsharp Mask (SVG Filter Matrix): робить відео у кріслах
 *      кришталево чітким навіть при низькому бітрейті без навантаження на мережу.
 *   2. Tab Focus & Character Sheet Badge ("📜 У Листі"): автоматично показує
 *      на кріслі гравця плашку, коли він переключився у вкладку Листа Персонажа.
 *   3. Off-Thread createImageBitmap GPU Decoder + Auto Night-Vision Luma Boost.
 *   4. Active Speaker & GM FPS Priority.
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

      // Карта статусів вкладок гравців: remoteId -> boolean (true = дивиться іншу вкладку / Лист Персонажа)
      this.remoteTabHiddenMap = new Map();
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.video = rtcEngine.video;
      if (!this.video) return;

      this.injectSvgHdSharpenFilter();
      this.installGpuBitmapDecoderHook();
      this.setupVisibilityAndSheetStatusSync();
      this.startVideoGovernorLoop();

      this.engine.log('🎬 [VideoOptimizer v4.0] HD Unsharp Filter + Індикатор «📜 У Листі» активовано.');
    }

    // =========================================================================
    // 1. GPU МАТРИЦЯ ЧІТКОСТІ КОНТУРІВ (UNSHARP MASK SVG FILTER + VIGNETTE)
    // =========================================================================
    injectSvgHdSharpenFilter() {
      if (document.getElementById('aether-hd-svg-defs')) return;

      const svgWrap = document.createElement('div');
      svgWrap.id = 'aether-hd-svg-defs';
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
            box-shadow: 0 2px 8px rgba(0,0,0,0.6);
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

    // =========================================================================
    // 2. СИНХРОНІЗАЦІЯ СТАТУСУ ВКЛАДКИ («📜 У ЛИСТІ ПЕРСОНАЖА»)
    // =========================================================================
    setupVisibilityAndSheetStatusSync() {
      if (!this.engine) return;

      const origHandleRoom = this.engine.handleRoomMessage.bind(this.engine);
      this.engine.handleRoomMessage = (msg) => {
        if (msg && msg.type === 'TAB_FOCUS' && msg.from && msg.from !== this.engine.deviceId) {
          this.remoteTabHiddenMap.set(msg.from, !!msg.inSheet);
          this.decorateSeatsWithHdAndBadges();
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
          this.video.applyOptimizerPatch({
            frameIntervalMs: 480,
            webpQuality: 0.34
          });
        } else {
          this.video.applyOptimizerPatch({
            frameIntervalMs: 120,
            webpQuality: 0.54,
            blendDurationMs: 120
          });
          this.healVideoElements();
        }
        this.decorateSeatsWithHdAndBadges();
      };

      document.addEventListener('visibilitychange', broadcastFocus);
    }

    decorateSeatsWithHdAndBadges() {
      if (!this.engine) return;

      document.querySelectorAll('.seat-node').forEach((node) => {
        node.classList.toggle('hd-sharpen-on', this.hdSharpenEnabled && !this.video.ecoMode);
      });

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
      });
    }

    // =========================================================================
    // 3. АПАРАТНИЙ GPU ДЕКОДЕР CREATEIMAGEBITMAP
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
        this.video.applyOptimizerPatch({
          frameIntervalMs: 175,
          webpQuality: 0.40,
          blendDurationMs: 175
        });
      } else if (someoneElseSpeaking && !isLocalSpeaking) {
        this.video.applyOptimizerPatch({
          frameIntervalMs: 185,
          webpQuality: 0.42,
          blendDurationMs: 185
        });
      } else if (isLocalSpeaking || isGM) {
        this.video.applyOptimizerPatch({
          frameIntervalMs: 115,
          webpQuality: 0.56,
          blendDurationMs: 115
        });
      } else {
        this.video.applyOptimizerPatch({
          frameIntervalMs: 135,
          webpQuality: 0.50,
          blendDurationMs: 135
        });
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