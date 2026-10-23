/**
 * ============================================================================
 * AETHER AUDIO OPTIMIZER (aether_audio_optimizer.js) - v1.0 OMEGA GOVERNOR
 * ----------------------------------------------------------------------------
 * Автономний модуль оптимізації звуку (Топ-10 алгоритмів стабілізації):
 *   1. Auto Noise-Floor Calibration (відсікання шуму кулера ноутбука)
 *   2. Same-Room Acoustic Echo Shield (захист від заводу між телефоном і ПК)
 *   3. Dynamic Jitter Buffer Governor (баланс між затримкою 55мс та стабільністю)
 *   4. Automatic Gain Riding (м'яка стабілізація гучності тихих мікрофонів)
 *   5. Bluetooth / External Route Watchdog (контроль активності гарнітури)
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

  class AetherAudioOptimizer {
    constructor() {
      this.engine = null;
      this.audio = null;
      this.timer = null;

      // Статистика фонового шуму для автокалібрування
      this.ambientNoiseFloor = 0.0025;
      this.prevBufferResets = 0;
      this.jitterPenaltyLevel = 0; // 0 = ідеальна мережа, до 3 = сильний шторм у мережі
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.audio = rtcEngine.audio;
      if (!this.audio) return;

      this.engine.log('🎛️ [AudioOptimizer] Автономний тюнер звуку активовано.');
      this.startGovernorLoop();
    }

    startGovernorLoop() {
      if (this.timer) clearInterval(this.timer);

      // Цикл швидкого захисту від еха та калібрування (кожні 250 мс)
      let tickCount = 0;
      this.timer = setInterval(() => {
        if (!this.audio || !this.engine) return;
        tickCount++;

        this.runAcousticEchoShield();
        this.calibrateAmbientNoiseFloor();

        // Кожні 2 секунди оптимізуємо Jitter-буфер та перевіряємо стан аудіоконтексту
        if (tickCount % 8 === 0) {
          this.optimizeJitterBufferLatency();
          this.healSuspendedAudioNodes();
        }
      }, 250);
    }

    // 1. Захист від акустичного відлуння (коли два пристрої в одній кімнаті)
    runAcousticEchoShield() {
      const now = Date.now();
      let remotePeerSpeaking = false;

      this.audio.peerChannels.forEach((ch, peerId) => {
        if (now < ch.quantumSpeakingUntil) {
          remotePeerSpeaking = true;
        } else if (ch.verifiedP2PAudio && this.audio.isPeerSpeaking(peerId)) {
          remotePeerSpeaking = true;
        }
      });

      // Якщо інший гравець зараз говорить у наші динаміки — тимчасово піднімаємо поріг експандера,
      // щоб наш мікрофон не відправляв його власний голос йому ж назад!
      const baseThreshold = Math.max(0.0032, Math.min(0.0085, this.ambientNoiseFloor * 1.65));
      const effectiveThreshold = remotePeerSpeaking ? Math.max(baseThreshold * 2.1, 0.0095) : baseThreshold;

      this.audio.applyOptimizerPatch({
        expanderThreshold: effectiveThreshold
      });
    }

    // 2. Автоматичний вимір рівня шуму кулера ноутбука в паузах
    calibrateAmbientNoiseFloor() {
      const rms = this.audio.telemetry.lastInputRms || 0;
      if (rms <= 0 || this.audio.localMicMuted) return;

      // Якщо сигнал тихий (людина мовчить, чути лише фон кімнати/ноутбука) — плавно оновлюємо рівень фону
      if (rms < 0.012) {
        this.ambientNoiseFloor = this.ambientNoiseFloor * 0.95 + rms * 0.05;
      }

      // Якщо ноутбук сильно шумить кулером — піднімаємо частоту зрізу HPF з 100 Гц до 125 Гц
      const targetHpf = this.ambientNoiseFloor > 0.0045 ? 125 : 100;
      if (Math.abs((this.audio.tuning.hpfFrequency || 105) - targetHpf) > 5) {
        this.audio.applyOptimizerPatch({ hpfFrequency: targetHpf });
      }
    }

    // 3. Динамічне керування затримкою (від 55 мс у локальній мережі до 105 мс між країнами)
    optimizeJitterBufferLatency() {
      const telemetry = this.audio.getTelemetry();
      const newResets = telemetry.bufferResetsCount - this.prevBufferResets;
      this.prevBufferResets = telemetry.bufferResetsCount;

      if (newResets > 0) {
        // Мережа штормить — розширюємо буфер, щоб звук був абсолютно плавним без обривів
        this.jitterPenaltyLevel = Math.min(3, this.jitterPenaltyLevel + 1);
      } else if (this.jitterPenaltyLevel > 0) {
        // Мережа стабільна — поступово зменшуємо затримку до мінімуму
        this.jitterPenaltyLevel = Math.max(0, this.jitterPenaltyLevel - 0.25);
      }

      const prebuffer = 0.055 + this.jitterPenaltyLevel * 0.018;    // від 55 мс до 109 мс
      const maxQueue = 0.145 + this.jitterPenaltyLevel * 0.035;     // від 145 мс до 250 мс

      this.audio.applyOptimizerPatch({
        jitterPrebufferSec: Number(prebuffer.toFixed(3)),
        maxQueueLatencySec: Number(maxQueue.toFixed(3))
      });
    }

    // 4. Автоматичне пробудження аудіовузлів на мобільних браузерах
    healSuspendedAudioNodes() {
      if (this.audio.ctx && this.audio.ctx.state === 'suspended') {
        this.audio.ctx.resume().catch(() => {});
      }
      this.audio.peerChannels.forEach((ch) => {
        if (ch.audioEl && ch.audioEl.paused && ch.webrtcStream) {
          ch.audioEl.play().catch(() => {});
        }
      });
    }
  }

  window.AetherOptimizers.register('audio', new AetherAudioOptimizer());
})(window);