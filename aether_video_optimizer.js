/**
 * ============================================================================
 * AETHER VIDEO OPTIMIZER (aether_video_optimizer.js) - v2.0 LUXURY MAX
 * ----------------------------------------------------------------------------
 * Інтелектуальний відео-рушій (Smart Cinema & GPU Offload):
 *   1. GPU Off-Thread Decoding (createImageBitmap): декодує вхідні кадри у
 *      фоновому потоці відеокарти, звільняючи 100% головного потоку для звуку.
 *   2. Active Speaker & GM Priority: підвищує FPS і чіткість, коли гравець
 *      говорить або є Майстром, та переходить у тихий режим під час мовчання.
 *   3. Auto Night-Vision (Low-Light Luma Enhancer): автоматично витягує темні
 *      вебкамери у вечірніх кімнатах без засвітів.
 *   4. Background Tab Saver & Frozen Video Healer.
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
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.video = rtcEngine.video;
      if (!this.video) return;

      this.installGpuBitmapDecoderHook();
      this.setupVisibilityGuard();
      this.startVideoGovernorLoop();
      this.engine.log('🎬 [VideoOptimizer v2.0] GPU Bitmap Decoder + Night-Vision активовано.');
    }

    // =========================================================================
    // 1. АПАРАТНЕ ДЕКОДУВАННЯ КАДРІВ НА GPU (CREATEIMAGEBITMAP POЗА UI-ПОТОКОМ)
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

        // Асинхронне декодування на відеокарті без жодного блокування аудіо!
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

    setupVisibilityGuard() {
      document.addEventListener('visibilitychange', () => {
        if (!this.video) return;
        if (document.hidden) {
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
      });
    }

    startVideoGovernorLoop() {
      if (this.timer) clearInterval(this.timer);

      this.timer = setInterval(() => {
        if (!this.video || !this.engine || document.hidden) return;

        this.adjustDynamicSpeakerFpsAndQuality();
        this.runAutoNightVisionEnhancer();
        this.healVideoElements();
      }, 1600);
    }

    // =========================================================================
    // 2. ПРІОРИТЕТ АКТИВНОГО СПІКЕРА ТА МАЙСТРА (DYNAMIC FPS & BANDWIDTH SAVER)
    // =========================================================================
    adjustDynamicSpeakerFpsAndQuality() {
      const vTel = this.video.getTelemetry();
      const encodeMs = vTel.lastEncodeDurationMs || 0;
      const fps = vTel.currentFps || 60;

      const isGM = this.engine.localState?.role === 'gm';
      const isLocalSpeaking = this.engine.audio
        ? this.engine.audio.isPeerSpeaking(this.engine.deviceId)
        : false;

      // Перевіряємо, чи говорить зараз хтось інший за столом
      let someoneElseSpeaking = false;
      if (this.engine.audio) {
        this.engine.remoteDevices.forEach((_, remoteId) => {
          if (this.engine.audio.isPeerSpeaking(remoteId)) {
            someoneElseSpeaking = true;
          }
        });
      }

      if (encodeMs > 26 || fps < 36) {
        // Захист слабкого процесора від перегріву
        this.video.applyOptimizerPatch({
          frameIntervalMs: 175,
          webpQuality: 0.40,
          blendDurationMs: 175
        });
      } else if (someoneElseSpeaking && !isLocalSpeaking) {
        // Коли говорить інший гравець, а ми мовчимо — знижуємо власний відеопотік,
        // звільняючи 100% інтернет-каналу для ідеального прийому його голосу!
        this.video.applyOptimizerPatch({
          frameIntervalMs: 185,
          webpQuality: 0.42,
          blendDurationMs: 185
        });
      } else if (isLocalSpeaking || isGM) {
        // Коли говоримо ми або ми Майстер — даємо плавну, чітку картинку
        this.video.applyOptimizerPatch({
          frameIntervalMs: 115,
          webpQuality: 0.56,
          blendDurationMs: 115
        });
      } else {
        // Стандартний збалансований режим
        this.video.applyOptimizerPatch({
          frameIntervalMs: 135,
          webpQuality: 0.50,
          blendDurationMs: 135
        });
      }
    }

    // =========================================================================
    // 3. АВТОМАТИЧНЕ ВИТЯГУВАННЯ ТЕМНИХ ВЕБ-КАМЕР (NIGHT-VISION LUMA ENHANCER)
    // =========================================================================
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

        // Якщо в кімнаті темно (середня яскравість < 62 із 255) — м'яко підсвічуємо відеовікна!
        const shouldBoostLight = avgLuma > 8 && avgLuma < 62;
        if (shouldBoostLight !== this.nightVisionActive) {
          this.nightVisionActive = shouldBoostLight;
          this.video.txCtx.filter = shouldBoostLight
            ? 'brightness(1.22) contrast(1.08)'
            : 'none';

          const localSeat = this.engine.localState?.seat;
          const localVidEl = localSeat ? document.getElementById(`video-${localSeat}`) : null;
          if (localVidEl) {
            localVidEl.style.filter = shouldBoostLight ? 'brightness(1.18) contrast(1.06)' : '';
          }
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