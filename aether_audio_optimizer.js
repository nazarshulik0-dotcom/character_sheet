/**
 * ============================================================================
 * AETHER AUDIO OPTIMIZER (aether_audio_optimizer.js) - v3.0 APEX MASTER
 * ----------------------------------------------------------------------------
 * Пакет 1 + Пакет 2 (Broadcast Spatial & IMA-ADPCM 24kHz HD Engine):
 *   1. IMA-ADPCM 24 kHz HD Codec: розширення спектра голосу до 11.2 кГц при
 *      зменшенні розміру мережевих пакетів у 2.6 раза (повна зворотна сумісність).
 *   2. True Table 3D Spatial Panning: розведення крісел гравців по стереобазі
 *      (-0.38 L ... +0.38 R, Майстер GM по центру 0.0).
 *   3. GM Authority Ducking (-4 dB): автоматичний пріоритет голосу Майстра.
 *   4. Individual Player Mixer (0% - 200%) + Auto-Leveler + De-Esser + PLC.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const MIXER_STORAGE_KEY = 'entropia_aether_mixer_vols_v3';
  const AUDIO_SETTINGS_KEY = 'entropia_aether_audio_opt_v3';

  // Таблиці кроків квантування стандарту IMA-ADPCM (16-bit -> 4-bit без втрати динаміки)
  const ADPCM_INDEX_TABLE = [
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8
  ];

  const ADPCM_STEP_TABLE = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
    19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
    130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
    337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
    876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
    2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
    5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
    15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
  ];

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

      const savedCfg = this.loadSettings();
      this.presetMode = savedCfg.presetMode || 'auto';
      this.spatialEnabled = savedCfg.spatialEnabled !== false;
      this.gmPriorityEnabled = savedCfg.gmPriorityEnabled !== false;
      this.adpcm24kEnabled = savedCfg.adpcm24kEnabled !== false;

      // Індивідуальні рівні гучності гравців (по імені або ID): 0.0 .. 2.0 (за замовчуванням 1.0 = 100%)
      this.customPeerVolumes = this.loadMixerVolumes();
      this.peerSmoothedAutoGain = new Map();
      this.currentGmDuckFactor = 1.0;

      // Статистика середовища
      this.ambientNoiseFloor = 0.0025;
      this.prevBufferResets = 0;
      this.jitterPenaltyLevel = 0;
      this.detectedHumFreq = 120;

      // Стан кодувальника IMA-ADPCM
      this.txAdpcmPredictor = 0;
      this.txAdpcmStepIndex = 0;

      this.injectedMicNodes = null;
      this.lastHookedHpf = null;
    }

    loadSettings() {
      try {
        return JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY) || '{}');
      } catch (_) {
        return {};
      }
    }

    saveSettings() {
      try {
        localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({
          presetMode: this.presetMode,
          spatialEnabled: this.spatialEnabled,
          gmPriorityEnabled: this.gmPriorityEnabled,
          adpcm24kEnabled: this.adpcm24kEnabled
        }));
      } catch (_) {}
    }

    loadMixerVolumes() {
      try {
        return JSON.parse(localStorage.getItem(MIXER_STORAGE_KEY) || '{}');
      } catch (_) {
        return {};
      }
    }

    saveMixerVolumes() {
      try {
        localStorage.setItem(MIXER_STORAGE_KEY, JSON.stringify(this.customPeerVolumes));
      } catch (_) {}
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.audio = rtcEngine.audio;
      if (!this.audio) return;

      this.installAdpcm24kAndPlcHooks();
      this.startGovernorLoops();
      this.engine.log(
        `🎛️ [AudioOptimizer v3.0] APEX MASTER активний (ADPCM 24kHz: ${this.adpcm24kEnabled ? 'ON' : 'OFF'}, 3D-Стіл: ${this.spatialEnabled ? 'ON' : 'OFF'}).`
      );
    }

    // =========================================================================
    // 1. КЕРУВАННЯ РЕЖИМАМИ, МІКШЕРОМ ТА ОПЦІЯМИ З HUD
    // =========================================================================
    setPresetMode(mode) {
      this.presetMode = mode || 'auto';
      this.saveSettings();
      this.applyImmediatePresetParameters();
      this.engine?.log(`🎛️ [AudioOptimizer] Профіль: ${this.presetMode.toUpperCase()}`);
    }

    setSpatialEnabled(enabled) {
      this.spatialEnabled = !!enabled;
      this.saveSettings();
      this.updateSpatialPanningAndMixer();
    }

    setGmPriorityEnabled(enabled) {
      this.gmPriorityEnabled = !!enabled;
      this.saveSettings();
    }

    setAdpcm24kEnabled(enabled) {
      this.adpcm24kEnabled = !!enabled;
      this.saveSettings();
      if (this.audio) {
        this.audio.applyOptimizerPatch({
          targetSampleRate: this.adpcm24kEnabled ? 24000 : 16000
        });
      }
    }

    // Встановлення індивідуальної гучності гравця з мікшера HUD (0.0 .. 2.0)
    setPlayerCustomVolume(remoteId, playerName, volumeRatio) {
      const clamped = Math.max(0, Math.min(2.0, Number(volumeRatio)));
      const key = playerName ? `name:${playerName}` : `id:${remoteId}`;
      this.customPeerVolumes[key] = clamped;
      this.customPeerVolumes[`id:${remoteId}`] = clamped;
      this.saveMixerVolumes();

      if (this.audio) {
        const peerCh = this.audio.getOrCreatePeerChannel(remoteId);
        peerCh.volume = clamped;
      }
    }

    getPlayerCustomVolume(remoteId, playerName) {
      const byName = playerName ? this.customPeerVolumes[`name:${playerName}`] : undefined;
      if (byName !== undefined) return byName;
      const byId = this.customPeerVolumes[`id:${remoteId}`];
      return byId !== undefined ? byId : 1.0;
    }

    applyImmediatePresetParameters() {
      if (!this.audio) return;
      const targetSr = this.adpcm24kEnabled ? 24000 : 16000;

      if (this.presetMode === 'room') {
        this.audio.applyOptimizerPatch({
          targetSampleRate: targetSr,
          jitterPrebufferSec: 0.050,
          maxQueueLatencySec: 0.125,
          hpfFrequency: 120,
          presenceGainDb: 1.5,
          expanderThreshold: 0.0072,
          holdBlocksCount: 10
        });
      } else if (this.presetMode === 'global') {
        this.audio.applyOptimizerPatch({
          targetSampleRate: targetSr,
          jitterPrebufferSec: 0.090,
          maxQueueLatencySec: 0.210,
          hpfFrequency: 100,
          presenceGainDb: 2.1,
          expanderThreshold: 0.0038,
          holdBlocksCount: 18
        });
      } else if (this.presetMode === 'studio') {
        this.audio.applyOptimizerPatch({
          targetSampleRate: targetSr,
          jitterPrebufferSec: 0.060,
          maxQueueLatencySec: 0.145,
          hpfFrequency: 80,
          presenceGainDb: 2.5,
          expanderThreshold: 0.0026,
          holdBlocksCount: 20
        });
      } else {
        this.audio.applyOptimizerPatch({
          targetSampleRate: targetSr
        });
      }
    }

    startGovernorLoops() {
      if (this.fastTimer) clearInterval(this.fastTimer);
      if (this.slowTimer) clearInterval(this.slowTimer);

      this.applyImmediatePresetParameters();

      this.fastTimer = setInterval(() => {
        if (!this.audio || !this.engine) return;
        this.ensureStudioMasteringNodesInjected();
        this.runDynamicDeEsserAndHumTracker();
        this.runAcousticEchoShield();
        this.updateSpatialPanningAndMixer();
      }, 160);

      this.slowTimer = setInterval(() => {
        if (!this.audio || !this.engine) return;
        if (this.presetMode === 'auto') {
          this.optimizeJitterBufferLatency();
        }
        this.healSuspendedAudioNodes();
      }, 2000);
    }

    // =========================================================================
    // 2. КОДЕК IMA-ADPCM 24 KHZ HD VOICE + PACKET LOSS CONCEALMENT (PLC)
    // =========================================================================
    encodeImaAdpcmPacket(float32Samples, sourceRate, gainScale = 1.0) {
      const targetRate = this.audio.tuning.targetSampleRate || 24000;
      const ratio = sourceRate / targetRate;
      let outLen = Math.floor(float32Samples.length / ratio);
      if (outLen % 2 !== 0) outLen--; // Парна кількість семплів для упаковки по 2 у байт
      if (outLen <= 0) return null;

      // 4 байти заголовка стану (Int16 predictor + Uint8 stepIndex + Uint8 magic 0xAD)
      const packedBytes = new Uint8Array(4 + (outLen >> 1));
      let predictor = this.txAdpcmPredictor;
      let stepIndex = this.txAdpcmStepIndex;

      // Записуємо стартовий стан пакета (робить кожен пакет незалежним від втрат попередніх!)
      const headerView = new DataView(packedBytes.buffer);
      headerView.setInt16(0, predictor, true);
      headerView.setUint8(2, stepIndex);
      headerView.setUint8(3, 0xAD);

      let byteOffset = 4;
      let highNibble = false;
      let currentByte = 0;

      for (let i = 0; i < outLen; i++) {
        // 3-точковий антиаліасинг-фільтр при ресемплінгу 48kHz -> 24kHz
        const center = Math.floor(i * ratio);
        const sPrev = float32Samples[Math.max(0, center - 1)];
        const sCurr = float32Samples[center];
        const sNext = float32Samples[Math.min(float32Samples.length - 1, center + 1)];

        const filtered = (0.22 * sPrev + 0.56 * sCurr + 0.22 * sNext) * gainScale;
        const sample16 = Math.round(Math.max(-1, Math.min(1, filtered)) * 32767);

        let step = ADPCM_STEP_TABLE[stepIndex];
        let diff = sample16 - predictor;
        let nibble = 0;

        if (diff < 0) {
          nibble = 8;
          diff = -diff;
        }

        let vpdiff = step >> 3;
        if (diff >= step) {
          nibble |= 4;
          diff -= step;
          vpdiff += step;
        }
        step >>= 1;
        if (diff >= step) {
          nibble |= 2;
          diff -= step;
          vpdiff += step;
        }
        step >>= 1;
        if (diff >= step) {
          nibble |= 1;
          vpdiff += step;
        }

        if (nibble & 8) predictor -= vpdiff;
        else predictor += vpdiff;

        predictor = Math.max(-32768, Math.min(32767, predictor));
        stepIndex = Math.max(0, Math.min(88, stepIndex + ADPCM_INDEX_TABLE[nibble]));

        if (!highNibble) {
          currentByte = nibble & 0x0F;
          highNibble = true;
        } else {
          currentByte |= (nibble & 0x0F) << 4;
          packedBytes[byteOffset++] = currentByte;
          highNibble = false;
        }
      }

      this.txAdpcmPredictor = predictor;
      this.txAdpcmStepIndex = stepIndex;

      let binary = '';
      const chunkSize = 1024;
      for (let i = 0; i < packedBytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, packedBytes.subarray(i, i + chunkSize));
      }
      // Префікс '!' маркує пакет як IMA-ADPCM 24kHz HD
      return '!' + btoa(binary);
    }

    decodeImaAdpcmToFloat32(b64WithoutPrefix) {
      const binary = atob(b64WithoutPrefix);
      const byteLen = binary.length;
      if (byteLen <= 4) return null;

      const bytes = new Uint8Array(byteLen);
      for (let i = 0; i < byteLen; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const headerView = new DataView(bytes.buffer);
      let predictor = headerView.getInt16(0, true);
      let stepIndex = Math.max(0, Math.min(88, headerView.getUint8(2)));

      const numSamples = (byteLen - 4) * 2;
      const floatData = new Float32Array(numSamples);
      let sampleIdx = 0;

      for (let i = 4; i < byteLen; i++) {
        const b = bytes[i];
        for (let shift = 0; shift <= 4; shift += 4) {
          const nibble = (b >> shift) & 0x0F;
          const step = ADPCM_STEP_TABLE[stepIndex];

          let vpdiff = step >> 3;
          if (nibble & 4) vpdiff += step;
          if (nibble & 2) vpdiff += (step >> 1);
          if (nibble & 1) vpdiff += (step >> 2);

          if (nibble & 8) predictor -= vpdiff;
          else predictor += vpdiff;

          predictor = Math.max(-32768, Math.min(32767, predictor));
          stepIndex = Math.max(0, Math.min(88, stepIndex + ADPCM_INDEX_TABLE[nibble]));

          floatData[sampleIdx++] = predictor / 32768.0;
        }
      }

      return floatData;
    }

    installAdpcm24kAndPlcHooks() {
      if (!this.audio || this.audio._v3HooksInstalled) return;
      this.audio._v3HooksInstalled = true;

      const origEncode = this.audio.encodeClean16BitPCM.bind(this.audio);
      const origIngest = this.audio.ingestQuantumAudioPacket.bind(this.audio);

      // 1. Перехоплюємо кодування: якщо активний ADPCM 24kHz — стискаємо у 4-бітний HD-потік
      this.audio.encodeClean16BitPCM = (float32Samples, sourceRate, gainScale = 1.0) => {
        if (this.adpcm24kEnabled) {
          return this.encodeImaAdpcmPacket(float32Samples, sourceRate, gainScale);
        }
        return origEncode(float32Samples, sourceRate, gainScale);
      };

      // 2. Перехоплюємо декодування: розпізнаємо ADPCM 24kHz ('!') + виконуємо PLC-маскування втрат
      this.audio.ingestQuantumAudioPacket = (remoteId, pkt) => {
        if (!pkt || !pkt.d) return;
        const peerCh = this.audio.getOrCreatePeerChannel(remoteId);
        if (peerCh.verifiedP2PAudio) return;

        const ctx = this.audio.ensureContext();

        // PLC (Packet Loss Concealment): якщо виникла мікро-пауза 15–90 мс через втрату пакета
        if (ctx && peerCh.nextPlayTime > 0) {
          const gapSec = ctx.currentTime - peerCh.nextPlayTime;
          if (gapSec > 0.014 && gapSec < 0.095 && Math.abs(peerCh.lastSample || 0) > 0.002) {
            try {
              const sr = pkt.sr || 24000;
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

        // Якщо пакет закодований нашим новим кодеком IMA-ADPCM 24kHz (починається з '!')
        if (pkt.d.charCodeAt(0) === 33) {
          this.audio.telemetry.packetsReceived++;
          try {
            const floatData = this.decodeImaAdpcmToFloat32(pkt.d.substring(1));
            if (!floatData || floatData.length < 16) return;

            const len = floatData.length;
            const sampleRate = pkt.sr || 24000;
            let sumAbs = 0;
            for (let i = 0; i < len; i += 2) sumAbs += Math.abs(floatData[i]);

            const now = ctx.currentTime;
            if (peerCh.nextPlayTime - now > this.audio.tuning.maxQueueLatencySec) {
              peerCh.activeNodes.forEach((n) => {
                try { n.stop(); n.disconnect(); } catch (_) {}
              });
              peerCh.activeNodes.length = 0;
              peerCh.nextPlayTime = now + 0.045;
              this.audio.telemetry.bufferResetsCount++;
            }

            const isNewPhrase = !peerCh.nextPlayTime || peerCh.nextPlayTime < now;
            if (isNewPhrase) {
              peerCh.nextPlayTime = now + this.audio.tuning.jitterPrebufferSec;
              for (let i = 0; i < 32; i++) floatData[i] *= (i / 32);
            } else {
              // 16-семплова сплайн-склейка сусідніх ADPCM пакетів (0 клацань)
              const delta = peerCh.lastSample - floatData[0];
              if (Math.abs(delta) > 0.0004) {
                for (let i = 0; i < 16; i++) {
                  floatData[i] += delta * (1 - i / 16);
                }
              }
            }

            peerCh.lastSample = floatData[len - 1];

            const audioBuf = ctx.createBuffer(1, len, sampleRate);
            audioBuf.getChannelData(0).set(floatData);

            const bufSource = ctx.createBufferSource();
            bufSource.buffer = audioBuf;
            bufSource.connect(peerCh.gainNode);

            peerCh.activeNodes.push(bufSource);
            bufSource.onended = () => {
              const idx = peerCh.activeNodes.indexOf(bufSource);
              if (idx !== -1) peerCh.activeNodes.splice(idx, 1);
            };

            bufSource.start(peerCh.nextPlayTime);
            peerCh.nextPlayTime += audioBuf.duration;

            if (sumAbs / (len / 2) > 0.0075) {
              peerCh.quantumSpeakingUntil = Date.now() + Math.round(audioBuf.duration * 1000) + 180;
            }
          } catch (_) {}
          return;
        }

        // Зворотна сумісність зі звичайним PCM16
        return origIngest(remoteId, pkt);
      };
    }

    // =========================================================================
    // 3. 3D ПАНОРАМА СТОЛУ + ПРІОРИТЕТ МАЙСТРА (GM DUCK) + ІНДИВІДУАЛЬНИЙ МІКШЕР
    // =========================================================================
    computeSeatPanPosition(seatId) {
      if (!this.spatialEnabled || !seatId || seatId === 'gm') return 0.0;
      const num = parseInt(String(seatId).replace('seat', ''), 10);
      if (isNaN(num) || num < 1) return 0.0;

      const totalSeats = Math.max(2, this.engine?.playerSeatCount || 6);
      // Розподіляємо крісла по дузі від -0.38 (ліворуч) до +0.38 (праворуч)
      const normalized = ((num - 1) / (totalSeats - 1)) * 2 - 1;
      return Number(Math.max(-0.42, Math.min(0.42, normalized * 0.38)).toFixed(2));
    }

    ensurePeerStereoPanner(peerCh) {
      if (peerCh.pannerNode || !this.audio.ctx || !this.audio.ctx.createStereoPanner) return;
      try {
        const panner = this.audio.ctx.createStereoPanner();
        panner.pan.value = 0.0;
        peerCh.gainNode.disconnect();
        peerCh.gainNode.connect(panner);
        panner.connect(this.audio.masterGain);
        peerCh.pannerNode = panner;
      } catch (_) {}
    }

    updateSpatialPanningAndMixer() {
      if (!this.audio.ctx || !this.engine) return;

      // Перевіряємо, чи говорить зараз Майстер (GM) для активації GM Authority Ducking (-4 dB = 0.63x)
      let gmSpeakingNow = false;
      if (this.gmPriorityEnabled) {
        if (this.engine.localState?.role === 'gm' && this.audio.isPeerSpeaking(this.engine.deviceId)) {
          gmSpeakingNow = true;
        } else {
          this.engine.remoteDevices.forEach((dev, remoteId) => {
            if (dev.role === 'gm' && this.audio.isPeerSpeaking(remoteId)) {
              gmSpeakingNow = true;
            }
          });
        }
      }

      const targetGmDuck = gmSpeakingNow ? 0.63 : 1.0; // -4 dB для звичайних гравців, коли говорить Майстер
      this.currentGmDuckFactor += (targetGmDuck - this.currentGmDuckFactor) * (gmSpeakingNow ? 0.25 : 0.08);

      this.audio.peerChannels.forEach((peerCh, remoteId) => {
        const dev = this.engine.remoteDevices.get(remoteId);
        const seatId = dev?.seat || null;
        const isPeerGM = dev?.role === 'gm' || seatId === 'gm';
        const playerName = dev?.name || '';

        // 1. Встановлюємо бінауральну 3D-панораму відповідно до крісла за столом
        this.ensurePeerStereoPanner(peerCh);
        const targetPan = this.computeSeatPanPosition(seatId);
        peerCh.currentPan = targetPan;
        if (peerCh.pannerNode) {
          peerCh.pannerNode.pan.setTargetAtTime(targetPan, this.audio.ctx.currentTime, 0.08);
        }

        if (peerCh.muted) {
          peerCh.gainNode.gain.setTargetAtTime(0, this.audio.ctx.currentTime, 0.02);
          if (peerCh.audioEl) peerCh.audioEl.volume = 0;
          return;
        }

        // 2. Автолевеллер (вирівнювання тихих/гучних мікрофонів)
        const analyserItem = this.audio.analysers.get(remoteId);
        let autoGain = this.peerSmoothedAutoGain.get(remoteId) || 1.0;
        if (analyserItem && analyserItem.analyser) {
          analyserItem.analyser.getByteFrequencyData(analyserItem.buf);
          let sum = 0;
          for (let i = 2; i < 38; i++) sum += analyserItem.buf[i];
          const avgLevel = sum / 36;

          if (avgLevel > 12) {
            const desiredBoost = 52 / Math.max(20, avgLevel);
            const clampedBoost = Math.max(0.78, Math.min(1.55, desiredBoost));
            autoGain = autoGain * 0.90 + clampedBoost * 0.10;
            this.peerSmoothedAutoGain.set(remoteId, autoGain);
          }
        }

        // 3. Комбінуємо: Повзунок мікшера (0-200%) * Auto-Leveler * GM Ducking (-4 dB якщо говорить GM)
        const userSliderVol = this.getPlayerCustomVolume(remoteId, playerName);
        peerCh.volume = userSliderVol;
        const gmDuckMultiplier = isPeerGM ? 1.0 : this.currentGmDuckFactor;
        const finalQuantumGain = userSliderVol * autoGain * gmDuckMultiplier;

        peerCh.gainNode.gain.setTargetAtTime(finalQuantumGain, this.audio.ctx.currentTime, 0.06);

        // Застосовуємо також до прямого WebRTC P2P потоку
        if (peerCh.audioEl) {
          peerCh.audioEl.volume = Math.max(0, Math.min(1.0, userSliderVol * gmDuckMultiplier));
        }
      });
    }

    // =========================================================================
    // 4. СТУДІЙНИЙ ПРЕАМП: HUM-NOTCH + WARMTH + DE-ESSER + AIR BOOST 8.2 KHZ
    // =========================================================================
    ensureStudioMasteringNodesInjected() {
      const ctx = this.audio.ctx;
      const hpf = this.audio.hpfNode;
      const presence = this.audio.presenceNode;

      if (!ctx || !hpf || !presence || this.lastHookedHpf === hpf) return;

      try {
        hpf.disconnect();

        // 1. Хірургічний виріз гулу кулера ноутбука
        const fanHumNotch = ctx.createBiquadFilter();
        fanHumNotch.type = 'notch';
        fanHumNotch.frequency.value = this.detectedHumFreq;
        fanHumNotch.Q.value = 14.0;

        // 2. Оксамитове тіло голосу (210 Hz, +1.2 dB)
        const bodyWarmth = ctx.createBiquadFilter();
        bodyWarmth.type = 'peaking';
        bodyWarmth.frequency.value = 210;
        bodyWarmth.Q.value = 0.85;
        bodyWarmth.gain.value = 1.2;

        // 3. Динамічний De-Esser (6200 Hz)
        const deEsser = ctx.createBiquadFilter();
        deEsser.type = 'peaking';
        deEsser.frequency.value = 6200;
        deEsser.Q.value = 2.2;
        deEsser.gain.value = 0.0;

        // 4. Air Shelf Boost (8200 Hz, +2.5 dB) — розкриває високі частоти для 24kHz ADPCM HD
        const airBoost = ctx.createBiquadFilter();
        airBoost.type = 'highshelf';
        airBoost.frequency.value = 8200;
        airBoost.gain.value = 2.5;

        hpf.connect(fanHumNotch);
        fanHumNotch.connect(bodyWarmth);
        bodyWarmth.connect(deEsser);
        deEsser.connect(airBoost);
        airBoost.connect(presence);

        this.injectedMicNodes = { fanHumNotch, bodyWarmth, deEsser, airBoost };
        this.lastHookedHpf = hpf;
      } catch (_) {
        try { hpf.connect(presence); } catch (e) {}
      }
    }

    runDynamicDeEsserAndHumTracker() {
      if (!this.injectedMicNodes || !this.audio.ctx) return;
      const localItem = this.audio.analysers.get(this.engine.deviceId);
      if (!localItem || !localItem.analyser) return;

      const buf = localItem.buf;
      localItem.analyser.getByteFrequencyData(buf);
      const binHz = this.audio.ctx.sampleRate / localItem.analyser.fftSize;

      let voiceMidSum = 0;
      for (let i = 2; i <= 8; i++) voiceMidSum += buf[i];
      const voiceMidAvg = voiceMidSum / 7;

      let sibilanceSum = 0;
      for (let i = 28; i <= 40; i++) sibilanceSum += buf[i];
      const sibilanceAvg = sibilanceSum / 13;

      let targetDeEssDb = 0.0;
      if (sibilanceAvg > 35 && sibilanceAvg > voiceMidAvg * 0.72) {
        targetDeEssDb = -Math.min(5.5, (sibilanceAvg - 30) * 0.12);
      }
      this.injectedMicNodes.deEsser.gain.setTargetAtTime(targetDeEssDb, this.audio.ctx.currentTime, 0.025);

      const rms = this.audio.telemetry.lastInputRms || 0;
      if (rms > 0 && rms < 0.010 && !this.audio.localMicMuted) {
        this.ambientNoiseFloor = this.ambientNoiseFloor * 0.94 + rms * 0.06;
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

    runAcousticEchoShield() {
      if (this.presetMode === 'studio') return;

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