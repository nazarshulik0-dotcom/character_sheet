/**
 * ============================================================================
 * AETHER AUDIO OPTIMIZER (aether_audio_optimizer.js) - v6.0 RAFAEL BRIDGE
 * ----------------------------------------------------------------------------
 * Повний стек v1.0–v5.0 SHOWRUNNER + Пункт 2 (Аудіо-шлюз Рафаеля STT / TTS):
 *   1. IMA-ADPCM 24 kHz HD Codec + PLC + Dan Dugan Auto-Mixer + 3D Panning.
 *   2. Procedural Acoustic Spaces + NPC Voice Morpher + Soundpad + Blackbox 30s.
 *   3. RAFAEL STT ("Слух"):
 *      - Буферизація 16kHz PCM чанків гравців для зовнішнього Whisper/STT API.
 *      - Вбудований Web Speech API розпізнавач із тригером на слово «Рафаель».
 *   4. RAFAEL TTS ("Голос"):
 *      - Пряма інжекція аудіопотоку (Float32 / AudioBuffer) від імені 'node_rafael_ai'
 *        у кодек IMA-ADPCM 24 kHz HD з роздачею на весь стіл і -6dB Sidechain.
 *      - Процедурний акустичний підпис «Великого Мудреця» + синтез мовлення.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const MIXER_STORAGE_KEY = 'entropia_aether_mixer_vols_v5';
  const AUDIO_SETTINGS_KEY = 'entropia_aether_audio_opt_v5';
  const RAFAEL_VIRTUAL_ID = 'node_rafael_ai';

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
      this.duganAutomixEnabled = savedCfg.duganAutomixEnabled !== false;

      this.currentAcousticSpace = 'dry';
      this.currentVoiceMorph = 'normal';
      this.impulseCache = new Map();
      this.whisperTargetId = null;

      this.customPeerVolumes = this.loadMixerVolumes();
      this.peerSmoothedAutoGain = new Map();
      this.peerVoiceEnergy = new Map();
      this.currentGmDuckFactor = 1.0;

      this.ambientNoiseFloor = 0.0025;
      this.prevBufferResets = 0;
      this.jitterPenaltyLevel = 0;
      this.detectedHumFreq = 120;
      this.txAdpcmPredictor = 0;
      this.txAdpcmStepIndex = 0;

      // Окремий стан кодувальника ADPCM для голосу Рафаеля (щоб не змішувався з мікрофоном гравця)
      this.rafaelAdpcmPredictor = 0;
      this.rafaelAdpcmStepIndex = 0;

      // Шлюз Слуху (STT) та Голосу (TTS) Рафаеля
      this.sttEnabled = false;
      this.speechRecognizer = null;
      this.rawSttCallbacks = new Set();
      this.sttAccumulator = [];
      this.sttAccumulatorSamples = 0;

      this.injectedMicNodes = null;
      this.lastHookedHpf = null;
      this.abyssDroneNodes = null;

      this.blackboxDest = null;
      this.blackboxRecorder = null;
      this.blackboxChunks = [];
      this.blackboxHeaderChunk = null;
      this.blackboxMimeType = '';
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
          adpcm24kEnabled: this.adpcm24kEnabled,
          duganAutomixEnabled: this.duganAutomixEnabled
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

      this.installAdpcm24kAndWhisperHooks();
      this.startGovernorLoops();
      setTimeout(() => this.initBlackboxRecorder(), 1200);

      this.engine.log(
        `🎛️ [AudioOptimizer v6.0] SHOWRUNNER + Аудіо-шлюз Рафаеля (STT/TTS 24kHz) активні.`
      );
    }

    // =========================================================================
    // ПУНКТ 2.1: АУДІО-ШЛЮЗ «СЛУХ РАФАЕЛЯ» (STT INTERCEPTOR & SPEECH RECOGNITION)
    // =========================================================================
    onRawAudioChunkForSTT(callback) {
      if (typeof callback === 'function') {
        this.rawSttCallbacks.add(callback);
      }
    }

    feedSamplesToRafaelSTT(float32Samples, sourceRate) {
      if (this.rawSttCallbacks.size === 0) return;

      // Децимація до 16000 Hz для стандартних моделей Whisper / Kaldi / Vosk
      const targetSr = 16000;
      const ratio = sourceRate / targetSr;
      const outLen = Math.floor(float32Samples.length / ratio);
      const chunk = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        chunk[i] = float32Samples[Math.floor(i * ratio)];
      }

      this.sttAccumulator.push(chunk);
      this.sttAccumulatorSamples += outLen;

      // Кожні ~1.0 секунди мовлення (16000 семплів) відправляємо готовий буфер у STT-шлюз
      if (this.sttAccumulatorSamples >= 16000) {
        const merged = new Float32Array(this.sttAccumulatorSamples);
        let offset = 0;
        for (let i = 0; i < this.sttAccumulator.length; i++) {
          merged.set(this.sttAccumulator[i], offset);
          offset += this.sttAccumulator[i].length;
        }
        this.sttAccumulator = [];
        this.sttAccumulatorSamples = 0;

        this.rawSttCallbacks.forEach((cb) => {
          try {
            cb({
              speakerId: this.engine?.deviceId,
              speakerName: this.engine?.localState?.name || 'Оперативник',
              sampleRate: targetSr,
              samples: merged
            });
          } catch (_) {}
        });
      }
    }

    setRafaelSttListening(enabled) {
      this.sttEnabled = !!enabled;
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!this.sttEnabled) {
        if (this.speechRecognizer) {
          try { this.speechRecognizer.onend = null; this.speechRecognizer.stop(); } catch (_) {}
          this.speechRecognizer = null;
        }
        window.AetherRafaelBridge?.setBotState('Idle');
        this.engine?.log('👂 [Rafael STT] Голосовий слух вимкнено.');
        return false;
      }

      if (!SpeechRec) {
        this.engine?.log('⚠️ [Rafael STT] Браузер не підтримує Web Speech API (доступний лише Raw PCM Tap).');
        return false;
      }

      try {
        const rec = new SpeechRec();
        rec.lang = 'uk-UA';
        rec.continuous = true;
        rec.interimResults = true;

        rec.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            const transcript = (res[0]?.transcript || '').trim();
            if (!transcript) continue;

            const low = transcript.toLowerCase();
            const isWakeWord =
              low.includes('рафаель') ||
              low.includes('рафаэль') ||
              low.includes('мудрець') ||
              low.includes('мудрец') ||
              low.includes('система');

            if (!res.isFinal) {
              if (isWakeWord) {
                window.AetherRafaelBridge?.setBotState('Listening');
              }
            } else {
              window.AetherRafaelBridge?.handleRecognizedSpeech(
                this.engine?.localState?.name || 'Оперативник',
                transcript,
                isWakeWord
              );
            }
          }
        };

        rec.onerror = () => {};
        rec.onend = () => {
          if (this.sttEnabled) {
            setTimeout(() => {
              try { rec.start(); } catch (_) {}
            }, 400);
          }
        };

        rec.start();
        this.speechRecognizer = rec;
        this.engine?.log('👂 [Rafael STT] Слух Великого Мудреця активовано (Тригер: «Рафаель...»).');
        return true;
      } catch (_) {
        return false;
      }
    }

    // =========================================================================
    // ПУНКТ 2.2: АУДІО-ШЛЮЗ «ГОЛОС РАФАЕЛЯ» (TTS -> IMA-ADPCM 24 KHZ HD STREAM)
    // =========================================================================
    // Метод для зовнішніх нейромереж (ElevenLabs / OpenAI / Piper / Coqui):
    // Приймає масив Float32 семплів, нарізає на пакети, кодує в IMA-ADPCM 24kHz HD
    // і транслює всьому столу від імені віртуального вузла 'node_rafael_ai'!
    injectExternalTtsAudioAsRafael(float32Samples, sourceSampleRate = 24000) {
      if (!float32Samples || float32Samples.length === 0 || !this.audio) return;

      window.AetherRafaelBridge?.setBotState('Speaking');

      const chunkSamples = Math.floor(sourceSampleRate * 0.085); // Пакети по 85 мс
      let offset = 0;
      let packetIndex = 0;

      const sendNextChunk = () => {
        if (offset >= float32Samples.length) {
          setTimeout(() => window.AetherRafaelBridge?.setBotState('Idle'), 250);
          return;
        }

        const slice = float32Samples.subarray(offset, Math.min(float32Samples.length, offset + chunkSamples));
        offset += chunkSamples;

        const encoded = this.encodeRafaelAdpcmPacket(slice, sourceSampleRate);
        if (encoded) {
          const pkt = {
            t: 'PCM16_V8',
            sr: 24000,
            d: encoded,
            from: RAFAEL_VIRTUAL_ID,
            seq: 900000 + (packetIndex++)
          };

          // Відтворюємо локально у кріслі Рафаеля
          this.audio.ingestQuantumAudioPacket(RAFAEL_VIRTUAL_ID, pkt);

          // Транслюємо всім гравцям через Dual-Broker
          window.AetherOptimizers.network?.broadcastRafaelAudioPacket(pkt);
        }

        setTimeout(sendNextChunk, 80);
      };

      sendNextChunk();
    }

    encodeRafaelAdpcmPacket(float32Samples, sourceRate) {
      const targetRate = 24000;
      const ratio = sourceRate / targetRate;
      let outLen = Math.floor(float32Samples.length / ratio);
      if (outLen % 2 !== 0) outLen--;
      if (outLen <= 0) return null;

      const packedBytes = new Uint8Array(4 + (outLen >> 1));
      let predictor = this.rafaelAdpcmPredictor;
      let stepIndex = this.rafaelAdpcmStepIndex;

      const headerView = new DataView(packedBytes.buffer);
      headerView.setInt16(0, predictor, true);
      headerView.setUint8(2, stepIndex);
      headerView.setUint8(3, 0xAD);

      let byteOffset = 4;
      let highNibble = false;
      let currentByte = 0;

      for (let i = 0; i < outLen; i++) {
        const sample16 = Math.round(Math.max(-1, Math.min(1, float32Samples[Math.floor(i * ratio)])) * 32767);
        let step = ADPCM_STEP_TABLE[stepIndex];
        let diff = sample16 - predictor;
        let nibble = 0;

        if (diff < 0) {
          nibble = 8;
          diff = -diff;
        }

        let vpdiff = step >> 3;
        if (diff >= step) { nibble |= 4; diff -= step; vpdiff += step; }
        step >>= 1;
        if (diff >= step) { nibble |= 2; diff -= step; vpdiff += step; }
        step >>= 1;
        if (diff >= step) { nibble |= 1; vpdiff += step; }

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

      this.rafaelAdpcmPredictor = predictor;
      this.rafaelAdpcmStepIndex = stepIndex;

      let binary = '';
      for (let i = 0; i < packedBytes.length; i += 1024) {
        binary += String.fromCharCode.apply(null, packedBytes.subarray(i, i + 1024));
      }
      return '!' + btoa(binary);
    }

    // Вбудований синтезатор голосу та кристалічного сигналу «Великого Мудреця» («Повідомлення. Розпочинаю аналіз...»)
    playRafaelVoiceResponse(text = 'Повідомлення. Систему Великого Мудреця синхронізовано зі столом Етеру.') {
      const ctx = this.audio?.ensureContext();
      if (!ctx) return;

      window.AetherRafaelBridge?.setBotState('Speaking');

      // 1. Генеруємо фірмовий кристалічний акорд «Великого Мудреця» з Тенсури у потік ADPCM 24kHz,
      // щоб його почули всі гравці в кімнаті через канал 'node_rafael_ai'
      const sr = 24000;
      const chimeDurSec = 0.55;
      const chimeSamples = new Float32Array(Math.floor(sr * chimeDurSec));
      const freqs = [587.33, 880.0, 1174.66, 1760.0]; // D5 - A5 - D6 - A6 кристалічний інтервал

      for (let i = 0; i < chimeSamples.length; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 6.5) * Math.min(1, t * 80);
        let val = 0;
        for (let f = 0; f < freqs.length; f++) {
          val += Math.sin(2 * Math.PI * freqs[f] * t) * (0.22 / (f + 1));
        }
        chimeSamples[i] = val * env;
      }

      this.injectExternalTtsAudioAsRafael(chimeSamples, sr);

      // 2. Озвучуємо саму фразу через браузерний або підключений синтезатор мовлення
      // з пульсацією енергії для візуальної сфери Рафаеля
      if ('speechSynthesis' in window && text) {
        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(text);
          utter.lang = 'uk-UA';
          utter.pitch = 1.05;
          utter.rate = 1.04;

          let pulseInterval = null;
          utter.onstart = () => {
            window.AetherRafaelBridge?.setBotState('Speaking');
            pulseInterval = setInterval(() => {
              const simulatedEnergy = 0.35 + Math.random() * 0.55;
              this.peerVoiceEnergy.set(RAFAEL_VIRTUAL_ID, simulatedEnergy);
              const peerCh = this.audio?.getOrCreatePeerChannel(RAFAEL_VIRTUAL_ID);
              if (peerCh) peerCh.quantumSpeakingUntil = Date.now() + 260;
            }, 90);
          };

          const finishSpeech = () => {
            if (pulseInterval) clearInterval(pulseInterval);
            this.peerVoiceEnergy.set(RAFAEL_VIRTUAL_ID, 0);
            window.AetherRafaelBridge?.setBotState('Idle');
          };

          utter.onend = finishSpeech;
          utter.onerror = finishSpeech;
          setTimeout(() => window.speechSynthesis.speak(utter), 280);
        } catch (_) {
          setTimeout(() => window.AetherRafaelBridge?.setBotState('Idle'), 1200);
        }
      }
    }

    // =========================================================================
    // БАЗОВИЙ СТЕК v5.0 SHOWRUNNER (БЕЗ ЗМІН)
    // =========================================================================
    setPresetMode(mode) {
      this.presetMode = mode || 'auto';
      this.saveSettings();
      this.applyImmediatePresetParameters();
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

    setDuganAutomixEnabled(enabled) {
      this.duganAutomixEnabled = !!enabled;
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

    setAcousticSpace(spaceName) {
      this.currentAcousticSpace = spaceName || 'dry';
      this.applyAcousticAndMorphToNodes();
      this.engine?.log(`🏛️ [AudioOptimizer] Акустика: ${this.currentAcousticSpace.toUpperCase()}`);
    }

    setVoiceMorph(morphName) {
      this.currentVoiceMorph = morphName || 'normal';
      this.applyAcousticAndMorphToNodes();
      this.engine?.log(`🎭 [AudioOptimizer] Морфер голосу NPC: ${this.currentVoiceMorph.toUpperCase()}`);
    }

    setWhisperTarget(targetPeerId = null, forceState = undefined) {
      if (forceState === true) {
        this.whisperTargetId = targetPeerId;
      } else if (forceState === false) {
        this.whisperTargetId = null;
      } else {
        this.whisperTargetId = (this.whisperTargetId === targetPeerId) ? null : (targetPeerId || null);
      }

      if (this.audio && this.audio.processedMicStream) {
        const pubAllow = !this.whisperTargetId && !this.audio.localMicMuted;
        this.audio.processedMicStream.getAudioTracks().forEach((t) => {
          t.enabled = pubAllow;
        });
      }

      if (this.engine && this.engine.publishRoomPacket) {
        const targetName = this.whisperTargetId
          ? (this.engine.remoteDevices.get(this.whisperTargetId)?.name || 'Гравцю')
          : null;
        this.engine.publishRoomPacket({
          type: 'WHISPER_STATE',
          from: this.engine.deviceId,
          to: this.whisperTargetId,
          targetName
        });
      }

      return this.whisperTargetId;
    }

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

    getPeerVoiceEnergy(peerId) {
      return this.peerVoiceEnergy.get(peerId) || 0;
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
      }, 140);

      this.slowTimer = setInterval(() => {
        if (!this.audio || !this.engine) return;
        if (this.presetMode === 'auto') {
          this.optimizeJitterBufferLatency();
        }
        this.healSuspendedAudioNodes();
      }, 2000);
    }

    playProceduralSoundEffect(sfxType, broadcast = false) {
      const ctx = this.audio?.ensureContext();
      if (!ctx) return;

      if (broadcast && this.engine && this.engine.publishRoomPacket) {
        this.engine.publishRoomPacket({
          type: 'SFX_TRIGGER',
          sfx: sfxType,
          from: this.engine.deviceId
        });
      }

      const now = ctx.currentTime;
      const outBus = this.audio.masterGain || ctx.destination;

      if (sfxType === 'heartbeat') {
        [0, 0.28, 0.95, 1.23].forEach((offset, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const startFreq = idx % 2 === 0 ? 68 : 54;
          osc.frequency.setValueAtTime(startFreq, now + offset);
          osc.frequency.exponentialRampToValueAtTime(28, now + offset + 0.18);

          gain.gain.setValueAtTime(0.001, now + offset);
          gain.gain.linearRampToValueAtTime(idx % 2 === 0 ? 0.65 : 0.45, now + offset + 0.025);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.22);

          osc.connect(gain);
          gain.connect(outBus);
          if (this.blackboxDest) gain.connect(this.blackboxDest);
          osc.start(now + offset);
          osc.stop(now + offset + 0.24);
        });
      } else if (sfxType === 'thunder') {
        const dur = 2.6;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const data = buf.getChannelData(0);
        let b0 = 0;
        for (let i = 0; i < data.length; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.96 * b0 + 0.04 * white;
          const t = i / data.length;
          const burst = i < ctx.sampleRate * 0.08 ? 1.5 : Math.pow(1 - t, 1.8);
          data[i] = b0 * burst * 2.2;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;

        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(950, now);
        lpf.frequency.exponentialRampToValueAtTime(110, now + dur);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.75, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + dur);

        src.connect(lpf);
        lpf.connect(gain);
        gain.connect(outBus);
        if (this.blackboxDest) gain.connect(this.blackboxDest);
        src.start(now);
      } else if (sfxType === 'bell') {
        const ratios = [1.0, 2.0, 2.756, 4.07, 5.404];
        const baseFreq = 293.66;
        ratios.forEach((r, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = i === 0 ? 'sine' : 'triangle';
          osc.frequency.value = baseFreq * r;

          const dur = 3.2 / (i * 0.65 + 1);
          const amp = 0.28 / (i + 1);
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(amp, now + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0008, now + dur);

          osc.connect(gain);
          gain.connect(outBus);
          if (this.blackboxDest) gain.connect(this.blackboxDest);
          osc.start(now);
          osc.stop(now + dur + 0.05);
        });
      } else if (sfxType === 'drone') {
        if (this.abyssDroneNodes) {
          const { gain, osc1, osc2 } = this.abyssDroneNodes;
          gain.gain.setTargetAtTime(0.0001, now, 0.35);
          setTimeout(() => {
            try { osc1.stop(); osc2.stop(); } catch (_) {}
          }, 1200);
          this.abyssDroneNodes = null;
        } else {
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const lpf = ctx.createBiquadFilter();
          const gain = ctx.createGain();

          osc1.type = 'sawtooth';
          osc2.type = 'triangle';
          osc1.frequency.value = 64.0;
          osc2.frequency.value = 67.2;

          lpf.type = 'lowpass';
          lpf.frequency.value = 165;

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.setTargetAtTime(0.16, now, 0.8);

          osc1.connect(lpf);
          osc2.connect(lpf);
          lpf.connect(gain);
          gain.connect(outBus);

          osc1.start(now);
          osc2.start(now);
          this.abyssDroneNodes = { osc1, osc2, gain };
        }
      }
    }

    initBlackboxRecorder() {
      if (this.blackboxRecorder || !window.MediaRecorder) return;
      const ctx = this.audio?.ensureContext();
      if (!ctx || !ctx.createMediaStreamDestination) return;

      try {
        this.blackboxDest = ctx.createMediaStreamDestination();
        if (this.audio.masterGain) this.audio.masterGain.connect(this.blackboxDest);
        if (this.audio.micMuteGainNode) this.audio.micMuteGainNode.connect(this.blackboxDest);

        const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
        this.blackboxMimeType = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || '';

        const rec = this.blackboxMimeType
          ? new MediaRecorder(this.blackboxDest.stream, { mimeType: this.blackboxMimeType })
          : new MediaRecorder(this.blackboxDest.stream);

        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            if (!this.blackboxHeaderChunk) {
              this.blackboxHeaderChunk = e.data;
            } else {
              this.blackboxChunks.push(e.data);
              if (this.blackboxChunks.length > 30) this.blackboxChunks.shift();
            }
          }
        };

        rec.start(1000);
        this.blackboxRecorder = rec;
      } catch (_) {}
    }

    saveLast30SecondsHighlight() {
      if (!this.blackboxHeaderChunk && this.blackboxChunks.length === 0) return false;
      try {
        const parts = this.blackboxHeaderChunk
          ? [this.blackboxHeaderChunk, ...this.blackboxChunks]
          : [...this.blackboxChunks];

        const blob = new Blob(parts, { type: this.blackboxMimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
        a.href = url;
        a.download = `aether-highlight-${stamp}.webm`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return true;
      } catch (_) {
        return false;
      }
    }

    getOrBuildImpulseBuffer(type) {
      if (this.impulseCache.has(type)) return this.impulseCache.get(type);
      const ctx = this.audio?.ctx;
      if (!ctx) return null;

      const sr = ctx.sampleRate;
      const durationSec = type === 'cathedral' ? 2.8 : 1.45;
      const decayRate = type === 'cathedral' ? 2.4 : 4.2;
      const len = Math.floor(sr * durationSec);
      const impulse = ctx.createBuffer(1, len, sr);
      const data = impulse.getChannelData(0);

      let lpState = 0;
      const damping = type === 'cathedral' ? 0.35 : 0.55;

      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decayRate);
        const white = (Math.random() * 2 - 1);
        lpState = lpState * damping + white * (1 - damping);
        const earlyBoost = i < sr * 0.065 && (i % 180 === 0) ? 1.6 : 1.0;
        data[i] = lpState * env * earlyBoost * 0.65;
      }

      this.impulseCache.set(type, impulse);
      return impulse;
    }

    makeDistortionCurve(amount = 28) {
      const n = 4096;
      const curve = new Float32Array(n);
      const deg = Math.PI / 180;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
      }
      return curve;
    }

    applyAcousticAndMorphToNodes() {
      if (!this.injectedMicNodes || !this.audio?.ctx) return;
      const now = this.audio.ctx.currentTime;
      const {
        dryGain,
        wetReverbGain,
        convolver,
        fxBandpass,
        fxShaper,
        fxAbyssLow,
        morphFormantFilter,
        ringModDepthGain,
        chorusWetGain
      } = this.injectedMicNodes;

      dryGain.gain.setTargetAtTime(1.0, now, 0.04);
      wetReverbGain.gain.setTargetAtTime(0.0, now, 0.04);
      fxBandpass.type = 'allpass';
      fxBandpass.frequency.setTargetAtTime(1000, now, 0.04);
      fxShaper.curve = null;
      fxAbyssLow.gain.setTargetAtTime(0.0, now, 0.04);

      if (this.currentAcousticSpace === 'dungeon') {
        const imp = this.getOrBuildImpulseBuffer('dungeon');
        if (imp && convolver.buffer !== imp) convolver.buffer = imp;
        wetReverbGain.gain.setTargetAtTime(0.42, now, 0.05);
      } else if (this.currentAcousticSpace === 'cathedral') {
        const imp = this.getOrBuildImpulseBuffer('cathedral');
        if (imp && convolver.buffer !== imp) convolver.buffer = imp;
        dryGain.gain.setTargetAtTime(0.85, now, 0.05);
        wetReverbGain.gain.setTargetAtTime(0.65, now, 0.05);
      } else if (this.currentAcousticSpace === 'radio') {
        fxBandpass.type = 'bandpass';
        fxBandpass.frequency.setTargetAtTime(1350, now, 0.04);
        fxBandpass.Q.setTargetAtTime(1.8, now, 0.04);
        fxShaper.curve = this.makeDistortionCurve(32);
      } else if (this.currentAcousticSpace === 'abyss') {
        const imp = this.getOrBuildImpulseBuffer('cathedral');
        if (imp && convolver.buffer !== imp) convolver.buffer = imp;
        fxAbyssLow.gain.setTargetAtTime(9.5, now, 0.04);
        wetReverbGain.gain.setTargetAtTime(0.50, now, 0.05);
      }

      morphFormantFilter.type = 'allpass';
      morphFormantFilter.gain.setTargetAtTime(0.0, now, 0.04);
      ringModDepthGain.gain.setTargetAtTime(0.0, now, 0.04);
      chorusWetGain.gain.setTargetAtTime(0.0, now, 0.04);

      if (this.currentVoiceMorph === 'titan') {
        fxAbyssLow.gain.setTargetAtTime(11.5, now, 0.04);
        morphFormantFilter.type = 'lowshelf';
        morphFormantFilter.frequency.setTargetAtTime(240, now, 0.04);
        morphFormantFilter.gain.setTargetAtTime(6.5, now, 0.04);
        fxShaper.curve = this.makeDistortionCurve(14);
      } else if (this.currentVoiceMorph === 'automaton') {
        ringModDepthGain.gain.setTargetAtTime(0.48, now, 0.04);
        morphFormantFilter.type = 'peaking';
        morphFormantFilter.frequency.setTargetAtTime(1850, now, 0.04);
        morphFormantFilter.Q.setTargetAtTime(3.5, now, 0.04);
        morphFormantFilter.gain.setTargetAtTime(5.0, now, 0.04);
      } else if (this.currentVoiceMorph === 'phantom') {
        chorusWetGain.gain.setTargetAtTime(0.65, now, 0.04);
        const imp = this.getOrBuildImpulseBuffer('cathedral');
        if (imp && convolver.buffer !== imp) convolver.buffer = imp;
        wetReverbGain.gain.setTargetAtTime(0.55, now, 0.05);
      }
    }

    encodeImaAdpcmPacket(float32Samples, sourceRate, gainScale = 1.0) {
      const targetRate = this.audio.tuning.targetSampleRate || 24000;
      const ratio = sourceRate / targetRate;
      let outLen = Math.floor(float32Samples.length / ratio);
      if (outLen % 2 !== 0) outLen--;
      if (outLen <= 0) return null;

      const packedBytes = new Uint8Array(4 + (outLen >> 1));
      let predictor = this.txAdpcmPredictor;
      let stepIndex = this.txAdpcmStepIndex;

      const headerView = new DataView(packedBytes.buffer);
      headerView.setInt16(0, predictor, true);
      headerView.setUint8(2, stepIndex);
      headerView.setUint8(3, 0xAD);

      let byteOffset = 4;
      let highNibble = false;
      let currentByte = 0;

      for (let i = 0; i < outLen; i++) {
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
        if (diff >= step) { nibble |= 4; diff -= step; vpdiff += step; }
        step >>= 1;
        if (diff >= step) { nibble |= 2; diff -= step; vpdiff += step; }
        step >>= 1;
        if (diff >= step) { nibble |= 1; vpdiff += step; }

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
      for (let i = 0; i < packedBytes.length; i += 1024) {
        binary += String.fromCharCode.apply(null, packedBytes.subarray(i, i + 1024));
      }
      return '!' + btoa(binary);
    }

    decodeImaAdpcmToFloat32(b64WithoutPrefix) {
      const binary = atob(b64WithoutPrefix);
      const byteLen = binary.length;
      if (byteLen <= 4) return null;

      const bytes = new Uint8Array(byteLen);
      for (let i = 0; i < byteLen; i++) bytes[i] = binary.charCodeAt(i);

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

    installAdpcm24kAndWhisperHooks() {
      if (!this.audio || this.audio._v6HooksInstalled) return;
      this.audio._v6HooksInstalled = true;

      const origEncode = this.audio.encodeClean16BitPCM.bind(this.audio);
      const origIngest = this.audio.ingestQuantumAudioPacket.bind(this.audio);
      const origNeedRelay = this.engine.needsQuantumAudioRelay.bind(this.engine);

      this.engine.needsQuantumAudioRelay = () => {
        if (this.whisperTargetId && !this.audio.localMicMuted) return true;
        return origNeedRelay();
      };

      this.audio.encodeClean16BitPCM = (float32Samples, sourceRate, gainScale = 1.0) => {
        // Відправляємо копію потоку в шлюз Слуху Рафаеля (STT Tap)
        this.feedSamplesToRafaelSTT(float32Samples, sourceRate);

        if (this.currentVoiceMorph === 'titan') {
          let subSign = 1;
          let prevZeroCross = false;
          for (let i = 0; i < float32Samples.length; i++) {
            const s = float32Samples[i];
            if ((s >= 0 && !prevZeroCross) || (s < 0 && prevZeroCross)) {
              prevZeroCross = !prevZeroCross;
              if (prevZeroCross) subSign = -subSign;
            }
            float32Samples[i] = Math.max(-1, Math.min(1, s * 0.78 + Math.abs(s) * subSign * 0.35));
          }
        }

        if (this.adpcm24kEnabled) {
          return this.encodeImaAdpcmPacket(float32Samples, sourceRate, gainScale);
        }
        return origEncode(float32Samples, sourceRate, gainScale);
      };

      this.audio.ingestQuantumAudioPacket = (remoteId, pkt) => {
        if (!pkt || !pkt.d) return;
        if (pkt.to && pkt.to !== this.engine.deviceId) return;

        const isDirectWhisperToMe = !!(pkt.to && pkt.to === this.engine.deviceId);
        const isRafaelPacket = (remoteId === RAFAEL_VIRTUAL_ID);
        const peerCh = this.audio.getOrCreatePeerChannel(remoteId);
        if (peerCh.verifiedP2PAudio && !isDirectWhisperToMe && !isRafaelPacket) return;

        const ctx = this.audio.ensureContext();

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

        if (pkt.d.charCodeAt(0) === 33) {
          this.audio.telemetry.packetsReceived++;
          try {
            const floatData = this.decodeImaAdpcmToFloat32(pkt.d.substring(1));
            if (!floatData || floatData.length < 16) return;

            const len = floatData.length;
            const sampleRate = pkt.sr || 24000;
            let sumAbs = 0;
            for (let i = 0; i < len; i += 2) sumAbs += Math.abs(floatData[i]);
            const avgAmp = sumAbs / (len / 2);

            this.peerVoiceEnergy.set(remoteId, Math.min(1.0, avgAmp * 8.5));

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

            if (avgAmp > 0.0075) {
              peerCh.quantumSpeakingUntil = Date.now() + Math.round(audioBuf.duration * 1000) + 180;
            }
          } catch (_) {}
          return;
        }

        const prevP2P = peerCh.verifiedP2PAudio;
        if (isDirectWhisperToMe || isRafaelPacket) peerCh.verifiedP2PAudio = false;
        origIngest(remoteId, pkt);
        if (isDirectWhisperToMe || isRafaelPacket) peerCh.verifiedP2PAudio = prevP2P;
      };
    }

    computeSeatPanPosition(seatId) {
      if (!this.spatialEnabled || !seatId || seatId === 'gm' || seatId === 'rafael') return 0.0;
      const num = parseInt(String(seatId).replace('seat', ''), 10);
      if (isNaN(num) || num < 1) return 0.0;

      const totalSeats = Math.max(2, this.engine?.playerSeatCount || 6);
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

      const localItem = this.audio.analysers.get(this.engine.deviceId);
      if (localItem && localItem.analyser && !this.audio.localMicMuted) {
        localItem.analyser.getByteFrequencyData(localItem.buf);
        let lSum = 0;
        for (let i = 2; i < 36; i++) lSum += localItem.buf[i];
        this.peerVoiceEnergy.set(this.engine.deviceId, Math.min(1.0, (lSum / 34) / 75));
      } else {
        this.peerVoiceEnergy.set(this.engine.deviceId, 0);
      }

      let totalTableVoiceEnergy = 0.001;
      const peerRawLevels = new Map();

      this.audio.peerChannels.forEach((peerCh, remoteId) => {
        const analyserItem = this.audio.analysers.get(remoteId);
        let avgLevel = 0;
        if (analyserItem && analyserItem.analyser) {
          analyserItem.analyser.getByteFrequencyData(analyserItem.buf);
          let sum = 0;
          for (let i = 2; i < 38; i++) sum += analyserItem.buf[i];
          avgLevel = sum / 36;
          this.peerVoiceEnergy.set(remoteId, Math.min(1.0, avgLevel / 75));
        } else if (Date.now() > peerCh.quantumSpeakingUntil) {
          this.peerVoiceEnergy.set(remoteId, (this.peerVoiceEnergy.get(remoteId) || 0) * 0.6);
        }

        const effectiveE = Math.max(avgLevel, (this.peerVoiceEnergy.get(remoteId) || 0) * 60);
        peerRawLevels.set(remoteId, effectiveE);
        if (effectiveE > 10) {
          totalTableVoiceEnergy += effectiveE;
        }
      });

      let gmOrRafaelSpeakingNow = false;
      if (this.gmPriorityEnabled) {
        if (this.engine.localState?.role === 'gm' && this.audio.isPeerSpeaking(this.engine.deviceId)) {
          gmOrRafaelSpeakingNow = true;
        } else {
          this.engine.remoteDevices.forEach((dev, remoteId) => {
            if ((dev.role === 'gm' || dev.role === 'ai_assistant') && this.audio.isPeerSpeaking(remoteId)) {
              gmOrRafaelSpeakingNow = true;
            }
          });
        }
      }

      const targetGmDuck = gmOrRafaelSpeakingNow ? 0.63 : 1.0;
      this.currentGmDuckFactor += (targetGmDuck - this.currentGmDuckFactor) * (gmOrRafaelSpeakingNow ? 0.25 : 0.08);

      this.audio.peerChannels.forEach((peerCh, remoteId) => {
        const dev = this.engine.remoteDevices.get(remoteId);
        const seatId = dev?.seat || null;
        const isPriorityPeer = dev?.role === 'gm' || dev?.role === 'ai_assistant' || seatId === 'gm';
        const playerName = dev?.name || (remoteId === RAFAEL_VIRTUAL_ID ? 'Рафаель [AI]' : '');

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

        const level = peerRawLevels.get(remoteId) || 0;
        let autoGain = this.peerSmoothedAutoGain.get(remoteId) || 1.0;
        if (level > 12) {
          const desiredBoost = 52 / Math.max(20, level);
          const clampedBoost = Math.max(0.78, Math.min(1.55, desiredBoost));
          autoGain = autoGain * 0.90 + clampedBoost * 0.10;
          this.peerSmoothedAutoGain.set(remoteId, autoGain);
        }

        let duganWeight = 1.0;
        if (this.duganAutomixEnabled && totalTableVoiceEnergy > 25 && !isPriorityPeer) {
          const share = Math.max(0.15, level / totalTableVoiceEnergy);
          duganWeight = 0.55 + 0.45 * Math.min(1.0, share * 1.4);
        }

        const userSliderVol = this.getPlayerCustomVolume(remoteId, playerName);
        peerCh.volume = userSliderVol;
        const gmDuckMultiplier = isPriorityPeer ? 1.0 : this.currentGmDuckFactor;
        const finalQuantumGain = userSliderVol * autoGain * gmDuckMultiplier * duganWeight;

        peerCh.gainNode.gain.setTargetAtTime(finalQuantumGain, this.audio.ctx.currentTime, 0.06);

        if (peerCh.audioEl) {
          peerCh.audioEl.volume = Math.max(0, Math.min(1.0, userSliderVol * gmDuckMultiplier * duganWeight));
        }
      });
    }

    ensureStudioMasteringNodesInjected() {
      const ctx = this.audio.ctx;
      const hpf = this.audio.hpfNode;
      const presence = this.audio.presenceNode;

      if (!ctx || !hpf || !presence || this.lastHookedHpf === hpf) return;

      try {
        hpf.disconnect();

        const fanHumNotch = ctx.createBiquadFilter();
        fanHumNotch.type = 'notch';
        fanHumNotch.frequency.value = this.detectedHumFreq;
        fanHumNotch.Q.value = 14.0;

        const bodyWarmth = ctx.createBiquadFilter();
        bodyWarmth.type = 'peaking';
        bodyWarmth.frequency.value = 210;
        bodyWarmth.Q.value = 0.85;
        bodyWarmth.gain.value = 1.2;

        const deEsser = ctx.createBiquadFilter();
        deEsser.type = 'peaking';
        deEsser.frequency.value = 6200;
        deEsser.Q.value = 2.2;
        deEsser.gain.value = 0.0;

        const airBoost = ctx.createBiquadFilter();
        airBoost.type = 'highshelf';
        airBoost.frequency.value = 8200;
        airBoost.gain.value = 2.5;

        const fxAbyssLow = ctx.createBiquadFilter();
        fxAbyssLow.type = 'peaking';
        fxAbyssLow.frequency.value = 125;
        fxAbyssLow.Q.value = 1.2;
        fxAbyssLow.gain.value = 0.0;

        const morphFormantFilter = ctx.createBiquadFilter();
        morphFormantFilter.type = 'allpass';
        morphFormantFilter.frequency.value = 800;

        const fxBandpass = ctx.createBiquadFilter();
        fxBandpass.type = 'allpass';
        fxBandpass.frequency.value = 1000;

        const fxShaper = ctx.createWaveShaper();
        fxShaper.oversample = '2x';

        const ringCarrierGain = ctx.createGain();
        ringCarrierGain.gain.value = 1.0;
        const ringOsc = ctx.createOscillator();
        ringOsc.type = 'sine';
        ringOsc.frequency.value = 58;
        const ringModDepthGain = ctx.createGain();
        ringModDepthGain.gain.value = 0.0;
        ringOsc.connect(ringModDepthGain);
        ringModDepthGain.connect(ringCarrierGain.gain);
        ringOsc.start();

        const chorusDelay = ctx.createDelay(0.1);
        chorusDelay.delayTime.value = 0.022;
        const chorusLfo = ctx.createOscillator();
        chorusLfo.frequency.value = 2.4;
        const chorusLfoDepth = ctx.createGain();
        chorusLfoDepth.gain.value = 0.004;
        chorusLfo.connect(chorusLfoDepth);
        chorusLfoDepth.connect(chorusDelay.delayTime);
        chorusLfo.start();
        const chorusWetGain = ctx.createGain();
        chorusWetGain.gain.value = 0.0;

        const dryGain = ctx.createGain();
        dryGain.gain.value = 1.0;

        const convolver = ctx.createConvolver();
        convolver.buffer = this.getOrBuildImpulseBuffer('dungeon');

        const wetReverbGain = ctx.createGain();
        wetReverbGain.gain.value = 0.0;

        hpf.connect(fanHumNotch);
        fanHumNotch.connect(bodyWarmth);
        bodyWarmth.connect(deEsser);
        deEsser.connect(airBoost);
        airBoost.connect(fxAbyssLow);
        fxAbyssLow.connect(morphFormantFilter);
        morphFormantFilter.connect(fxBandpass);
        fxBandpass.connect(fxShaper);
        fxShaper.connect(ringCarrierGain);

        ringCarrierGain.connect(dryGain);
        dryGain.connect(presence);

        ringCarrierGain.connect(chorusDelay);
        chorusDelay.connect(chorusWetGain);
        chorusWetGain.connect(presence);

        ringCarrierGain.connect(convolver);
        convolver.connect(wetReverbGain);
        wetReverbGain.connect(presence);

        this.injectedMicNodes = {
          fanHumNotch,
          bodyWarmth,
          deEsser,
          airBoost,
          fxAbyssLow,
          morphFormantFilter,
          fxBandpass,
          fxShaper,
          ringModDepthGain,
          chorusWetGain,
          dryGain,
          convolver,
          wetReverbGain
        };
        this.lastHookedHpf = hpf;
        this.applyAcousticAndMorphToNodes();

        if (this.blackboxDest && this.audio.micMuteGainNode) {
          try { this.audio.micMuteGainNode.connect(this.blackboxDest); } catch (_) {}
        }
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