/**
 * ============================================================================
 * AETHER VIDEO OPTIMIZER (aether_video_optimizer.js) - v1.0 OMEGA GOVERNOR
 * ----------------------------------------------------------------------------
 * Автономний модуль оптимізації відео та захисту FPS:
 *   1. Voice-Priority Bandwidth Guard (поступається смугою під час активної мови)
 *   2. Adaptive CPU/FPS Governor (автоматичний баланс якості WebP під пристрій)
 *   3. Background Tab Saver (економія CPU, коли гравець відкрив Лист Персонажа)
 *   4. Frozen Video Auto-Healer (миттєве відновлення відеовікон у кріслах)
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
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.video = rtcEngine.video;
      if (!this.video) return;

      this.engine.log('🎬 [VideoOptimizer] Автономний контролер кадрів та CPU активовано.');
      this.setupVisibilityGuard();
      this.startVideoGovernorLoop();
    }

    // Коли вкладка Етеру у фоні (гравець дивиться Лист Персонажа) — знижуємо частоту кадрів,
    // щоб браузер не грів ноутбук/телефон і не заважав фоновій музиці
    setupVisibilityGuard() {
      document.addEventListener('visibilitychange', () => {
        if (!this.video) return;
        if (document.hidden) {
          this.video.applyOptimizerPatch({
            frameIntervalMs: 450,
            webpQuality: 0.35
          });
        } else {
          this.video.applyOptimizerPatch({
            frameIntervalMs: 125,
            webpQuality: 0.52,
            blendDurationMs: 125
          });
          this.healVideoElements();
        }
      });
    }

    startVideoGovernorLoop() {
      if (this.timer) clearInterval(this.timer);

      this.timer = setInterval(() => {
        if (!this.video || !this.engine || document.hidden) return;

        this.adjustQualityForVoiceAndCpu();
        this.healVideoElements();
      }, 2000);
    }

    adjustQualityForVoiceAndCpu() {
      const vTel = this.video.getTelemetry();
      const encodeMs = vTel.lastEncodeDurationMs || 0;
      const fps = vTel.currentFps || 60;

      // Перевіряємо, чи зараз іде активна передача голосу через WebSocket Relay
      const isLocalSpeaking = this.engine.audio
        ? this.engine.audio.isPeerSpeaking(this.engine.deviceId)
        : false;
      const usingRelay = this.engine.needsQuantumAudioRelay();

      // Якщо пристрій перевантажений (encode > 25ms або FPS < 38) АБО ми говоримо через Relay —
      // полегшуємо вагу відеокадрів, щоб звук летів без жодної затримки!
      if (encodeMs > 25 || fps < 38) {
        this.video.applyOptimizerPatch({
          frameIntervalMs: 165,
          webpQuality: 0.40,
          blendDurationMs: 165
        });
      } else if (isLocalSpeaking && usingRelay) {
        this.video.applyOptimizerPatch({
          frameIntervalMs: 145,
          webpQuality: 0.44,
          blendDurationMs: 145
        });
      } else {
        // Коли канал вільний і процесор холодний — даємо максимальну плавність і чіткість
        this.video.applyOptimizerPatch({
          frameIntervalMs: 120,
          webpQuality: 0.54,
          blendDurationMs: 120
        });
      }
    }

    // Автоматично будить відеотеги на смартфонах, якщо Safari/Chrome поставив їх на паузу
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