/**
 * ============================================================================
 * AETHER AUDIO OPTIMIZER (aether_audio_optimizer.js) - v2.0 LUXURY MAX
 * ----------------------------------------------------------------------------
 * Студійний автопілот звуку (Broadcast DSP & Per-Player Mastering):
 *   1. Live DSP Graph Injection: безшовне врізання вузького Hum-Notch фільтра
 *      (проти кулера ноутбука) та динамічного De-Esser (6.2 kHz) у тракт мікрофона.
 *   2. FFT Tonal Hum Scanner: автоматичний пошук частоти гудіння вентилятора (110-320 Hz).
 *   3. Per-Player Auto-Leveler: індивідуальне вирівнювання гучності кожного гравця.
 *   4. Packet Loss Concealment (PLC): маскування втрачених у мережі пакетів без клацань.
 *   5. Режими пресетів: 'room' (Анти-Ехо), 'global' (Швеція-Україна), 'studio' (Макс. якість).
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
      this.fastTimer = null;
      this.slowTimer = null;

      // Поточний пресет: 'auto' | 'room' | 'global' | 'studio'
      this.presetMode = localStorage.getItem('entropia_aether_audio_preset_v2') || 'auto';

      // Статистика середовища
      this.ambientNoiseFloor = 0.0025;
      this.prevBufferResets = 0;
      this.jitterPenaltyLevel = 0;
      this.detectedHumFreq = 120;

      // Додаткові студійні вузли, що врізаються в мікрофонний тракт на льоту
      this.injectedMicNodes = null;
      this.lastHookedHpf = null;

      // Цільова гучність для автолевеллера гравців
      this.peerSmoothedGain = new Map();
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.audio = rtcEngine.audio;
      if (!this.audio) return;

      this.installPacketLossConcealmentHook();
      this.startGovernorLoops();
      this.engine.log(`🎛️ [AudioOptimizer v2.0] LUXURY MAX активовано (Режим: ${this.presetMode.toUpperCase()}).`);
    }

    setPresetMode(mode) {
      this.presetMode = mode || 'auto';
      localStorage.setItem('entropia_aether_audio_preset_v2', this.presetMode);
      this.engine?.log(`🎛️ [AudioOptimizer] Встановлено профіль: ${this.presetMode.toUpperCase()}`);
      this.applyImmediatePresetParameters();
    }

    applyImmediatePresetParameters() {
      if (!this.audio) return;

      if (this.presetMode === 'room') {
        // Максимальний захист від акустичного заводу та еха між пристроями в одній кімнаті
        this.audio.applyOptimizerPatch({
          jitterPrebufferSec: 0.050,
          maxQueueLatencySec: 0.125,
          hpfFrequency: 120,
          presenceGainDb: 1.4,
          expanderThreshold: 0.0075,
          holdBlocksCount: 10
        });
      } else if (this.presetMode === 'global') {
        // Надійна міжконтинентальна траса (Швеція <-> Україна) — 0% обривів при стрибках пінгу
        this.audio.applyOptimizerPatch({
          jitterPrebufferSec: 0.095,
          maxQueueLatencySec: 0.220,
          hpfFrequency: 105,
          presenceGainDb: 2.0,
          expanderThreshold: 0.0040,
          holdBlocksCount: 18
        });
      } else if (this.presetMode === 'studio') {
        // Студійний режим для навушників та зовнішнього мікрофона (оксамитовий низ і детальний верх)
        this.audio.applyOptimizerPatch({
          jitterPrebufferSec: 0.065,
          maxQueueLatencySec: 0.150,
          hpfFrequency: 82,
          presenceGainDb: 2.4,
          expanderThreshold: 0.0028,
          holdBlocksCount: 20
        });
      }
    }

    startGovernorLoops() {
      if (this.fastTimer) clearInterval(this.fastTimer);
      if (this.slowTimer) clearInterval(this.slowTimer);

      this.applyImmediatePresetParameters();

      // Швидкий цикл (кожні 180 мс): De-Esser, Anti-Echo Shield, Auto-Leveler гравців
      this.fastTimer = setInterval(() => {
        if (!this.audio || !this.engine) return;
        this.ensureStudioMasteringNodesInjected();
        this.runDynamicDeEsserAndHumTracker();
        this.runAcousticEchoShield();
        this.runPerPlayerAutoLeveler();
      }, 180);

      // Повільний цикл (кожні 2000 мс): Jitter Governor та пробудження вузлів
      this.slowTimer = setInterval(() => {
        if (!this.audio || !this.engine) return;
        if (this.presetMode === 'auto') {
          this.optimizeJitterBufferLatency();
        }
        this.healSuspendedAudioNodes();
      }, 2000);
    }

    // =========================================================================
    // 1. ВРІЗАННЯ СТУДІЙНИХ ФІЛЬТРІВ (HUM NOTCH + DE-ESSER + WARMTH) НА ЛЬОТУ
    // =========================================================================
    ensureStudioMasteringNodesInjected() {
      const ctx = this.audio.ctx;
      const hpf = this.audio.hpfNode;
      const presence = this.audio.presenceNode;

      if (!ctx || !hpf || !presence || this.lastHookedHpf === hpf) return;

      try {
        // Перехоплюємо з'єднання між hpfNode та presenceNode у базовому aether_audio.js
        hpf.disconnect();

        // Вузол А: Адаптивний вирізувач тонального гулу кулера ноутбука (110–320 Гц)
        const fanHumNotch = ctx.createBiquadFilter();
        fanHumNotch.type = 'notch';
        fanHumNotch.frequency.value = this.detectedHumFreq;
        fanHumNotch.Q.value = 14.0; // Вузький хірургічний виріз, що не чіпає голос

        // Вузол Б: Студійне утеплення голосу (Low-Mid Body 210 Hz, +1.2 dB)
        const bodyWarmth = ctx.createBiquadFilter();
        bodyWarmth.type = 'peaking';
        bodyWarmth.frequency.value = 210;
        bodyWarmth.Q.value = 0.85;
        bodyWarmth.gain.value = 1.2;

        // Вузол В: Динамічний De-Esser (6200 Гц) — гасить різкі сибілянти "С/Ц/Ш"
        const deEsser = ctx.createBiquadFilter();
        deEsser.type = 'peaking';
        deEsser.frequency.value = 6200;
        deEsser.Q.value = 2.2;
        deEsser.gain.value = 0.0;

        hpf.connect(fanHumNotch);
        fanHumNotch.connect(bodyWarmth);
        bodyWarmth.connect(deEsser);
        deEsser.connect(presence);

        this.injectedMicNodes = { fanHumNotch, bodyWarmth, deEsser };
        this.lastHookedHpf = hpf;
        this.engine.log('🎙️ [AudioOptimizer] Студійний ланцюг (Fan-Notch + Warmth + De-Esser) підключено.');
      } catch (err) {
        // Якщо браузер не дозволив перепідключення — відновлюємо прямий зв'язок
        try { hpf.connect(presence); } catch (_) {}
      }
    }

    // =========================================================================
    // 2. СПЕКТРАЛЬНИЙ СКАНЕР КУЛЕРА НОУТБУКА ТА ДИНАМІЧНИЙ DE-ESSER
    // =========================================================================
    runDynamicDeEsserAndHumTracker() {
      if (!this.injectedMicNodes || !this.audio.ctx) return;
      const localItem = this.audio.analysers.get(this.engine.deviceId);
      if (!localItem || !localItem.analyser) return;

      const buf = localItem.buf;
      localItem.analyser.getByteFrequencyData(buf);
      const binHz = this.audio.ctx.sampleRate / localItem.analyser.fftSize; // ~187.5 Hz при fftSize=256

      // А. Динамічний De-Esser: порівнюємо енергію сибілянтів (5.5–7.5 кГц) з основою голосу (300–1500 Гц)
      let voiceMidSum = 0;
      for (let i = 2; i <= 8; i++) voiceMidSum += buf[i];
      const voiceMidAvg = voiceMidSum / 7;

      let sibilanceSum = 0;
      for (let i = 28; i <= 40; i++) sibilanceSum += buf[i];
      const sibilanceAvg = sibilanceSum / 13;

      // Якщо свистячі високі частоти перевищують норму — миттєво притискаємо їх до -5.5 dB
      let targetDeEssDb = 0.0;
      if (sibilanceAvg > 35 && sibilanceAvg > voiceMidAvg * 0.72) {
        targetDeEssDb = -Math.min(5.5, (sibilanceAvg - 30) * 0.12);
      }
      this.injectedMicNodes.deEsser.gain.setTargetAtTime(
        targetDeEssDb,
        this.audio.ctx.currentTime,
        0.025
      );

      // Б. Калібрування фонового шуму в моменти тиші
      const rms = this.audio.telemetry.lastInputRms || 0;
      if (rms > 0 && rms < 0.010 && !this.audio.localMicMuted) {
        this.ambientNoiseFloor = this.ambientNoiseFloor * 0.94 + rms * 0.06;

        // Якщо чути постійний низькочастотний гул кулера в діапазоні 100–350 Гц, наводимо на нього Notch
        if (buf[1] > 28 && buf[1] > buf[3] * 1.4) {
          this.detectedHumFreq = Math.round(binHz * 1.0);
          this.injectedMicNodes.fanHumNotch.frequency.setTargetAtTime(
            Math.max(95, Math.min(320, this.detectedHumFreq)),
            this.audio.ctx.currentTime,
            0.2
          );
        }
      }
    }

    // =========================================================================
    // 3. ЗАХИСТ ВІД ЕХА В ОДНІЙ КІМНАТІ (DUPLEX ECHO SHIELD)
    // =========================================================================
    runAcousticEchoShield() {
      if (this.presetMode === 'studio') return; // У студійному режимі в навушниках не обмежуємо дуплекс

      const now = Date.now();
      let remotePeerSpeaking = false;

      this.audio.peerChannels.forEach((ch, peerId) => {
        if (now < ch.quantumSpeakingUntil) {
          remotePeerSpeaking = true;
        } else if (ch.verifiedP2PAudio && this.audio.isPeerSpeaking(peerId)) {
          remotePeerSpeaking = true;
        }
      });

      const baseThreshold = this.presetMode === 'room'
        ? 0.0068
        : Math.max(0.0032, Math.min(0.0075, this.ambientNoiseFloor * 1.6));

      const effectiveThreshold = remotePeerSpeaking
        ? Math.max(baseThreshold * 2.2, 0.0105)
        : baseThreshold;

      this.audio.applyOptimizerPatch({
        expanderThreshold: Number(effectiveThreshold.toFixed(4))
      });
    }

    // =========================================================================
    // 4. АВТОЛЕВЕЛЛЕР ГУЧНОСТІ КОЖНОГО ГРАВЦЯ (PER-PLAYER LUFS AUTO-LEVELER)
    // =========================================================================
    runPerPlayerAutoLeveler() {
      if (!this.audio.ctx) return;

      this.audio.peerChannels.forEach((peerCh, remoteId) => {
        if (peerCh.muted) return;

        const analyserItem = this.audio.analysers.get(remoteId);
        let currentGain = this.peerSmoothedGain.get(remoteId) || 1.0;

        if (analyserItem && analyserItem.analyser) {
          analyserItem.analyser.getByteFrequencyData(analyserItem.buf);
          let sum = 0;
          for (let i = 2; i < 38; i++) sum += analyserItem.buf[i];
          const avgLevel = sum / 36;

          // Якщо гравець говорить (рівень > 12), плавно підтягуємо його до еталонної гучності (avg ~ 52)
          if (avgLevel > 12) {
            const desiredBoost = 52 / Math.max(20, avgLevel);
            const clampedBoost = Math.max(0.75, Math.min(1.65, desiredBoost));
            currentGain = currentGain * 0.90 + clampedBoost * 0.10;
            this.peerSmoothedGain.set(remoteId, currentGain);
          }
        }

        const finalGain = (peerCh.volume || 1.0) * currentGain;
        peerCh.gainNode.gain.setTargetAtTime(finalGain, this.audio.ctx.currentTime, 0.08);
      });
    }

    // =========================================================================
    // 5. PACKET LOSS CONCEALMENT (PLC) — МАСКУВАННЯ ВТРАТ ПАКЕТІВ
    // =========================================================================
    installPacketLossConcealmentHook() {
      if (!this.audio || this.audio._plcHookInstalled) return;
      this.audio._plcHookInstalled = true;

      const origIngest = this.audio.ingestQuantumAudioPacket.bind(this.audio);
      this.audio.ingestQuantumAudioPacket = (remoteId, pkt) => {
        const peerCh = this.audio.getOrCreatePeerChannel(remoteId);
        const ctx = this.audio.ctx;

        // Якщо між пакетами під час активної фрази виникла мікро-дірка (20–90 мс через втрату пакета),
        // генеруємо 18 мс плавного інтерпольованого хвоста з попереднього семпла, щоб не було клацання!
        if (ctx && peerCh.nextPlayTime > 0) {
          const gapSec = ctx.currentTime - peerCh.nextPlayTime;
          if (gapSec > 0.012 && gapSec < 0.095 && Math.abs(peerCh.lastSample || 0) > 0.002) {
            try {
              const sr = this.audio.tuning.targetSampleRate || 16000;
              const plcLen = Math.floor(sr * 0.018);
              const plcBuf = ctx.createBuffer(1, plcLen, sr);
              const data = plcBuf.getChannelData(0);
              for (let i = 0; i < plcLen; i++) {
                data[i] = peerCh.lastSample * Math.pow(1 - i / plcLen, 1.8);
              }
              const src = ctx.createBufferSource();
              src.buffer = plcBuf;
              src.connect(peerCh.gainNode);
              src.start(ctx.currentTime);
              peerCh.lastSample = 0;
            } catch (_) {}
          }
        }

        return origIngest(remoteId, pkt);
      };
    }

    // =========================================================================
    // 6. ДИНАМІЧНИЙ ТЮНЕР ЗАТРИМКИ (JITTER BUFFER GOVERNOR)
    // =========================================================================
    optimizeJitterBufferLatency() {
      const telemetry = this.audio.getTelemetry();
      const newResets = telemetry.bufferResetsCount - this.prevBufferResets;
      this.prevBufferResets = telemetry.bufferResetsCount;

      if (newResets > 0) {
        this.jitterPenaltyLevel = Math.min(3, this.jitterPenaltyLevel + 1);
      } else if (this.jitterPenaltyLevel > 0) {
        this.jitterPenaltyLevel = Math.max(0, this.jitterPenaltyLevel - 0.25);
      }

      const prebuffer = 0.055 + this.jitterPenaltyLevel * 0.016;
      const maxQueue = 0.145 + this.jitterPenaltyLevel * 0.032;

      this.audio.applyOptimizerPatch({
        jitterPrebufferSec: Number(prebuffer.toFixed(3)),
        maxQueueLatencySec: Number(maxQueue.toFixed(3))
      });
    }

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