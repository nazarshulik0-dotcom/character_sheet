/**
 * ============================================================================
 * AETHER AUDIO OPTIMIZER (aether_audio_optimizer.js) - v6.5 EURO-LINK EDITION
 * ----------------------------------------------------------------------------
 * Стабілізація міжкраїнного звуку (Швеція <-> Чехія <-> Україна):
 *   1. ZERO NOISE-GATE: повністю відкритий студійний мікрофонний тракт без
 *      ковтання закінчень слів (expanderThreshold = 0.00001).
 *   2. HOT-STANDBY P2P WATCHDOG: якщо прямий WebRTC P2P потік між країнами
 *      завмирає навіть на 220 мс, резервний ADPCM-потік миттєво підхоплює фразу.
 *   3. SEQUENCE GAP INTERPOLATOR: якщо пакет (seq) випав на трасі, синтезується
 *      плавний 20 мс хвильовий міст замість дірки в голосі.
 *   4. ELASTIC NETEQ BUFFER: м'яке прискорення (1.045x) замість скидання черги.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const MIXER_STORAGE_KEY = 'entropia_aether_mixer_vols_v5';
  const AUDIO_SETTINGS_KEY = 'entropia_aether_audio_opt_v65';
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
      this.presetMode = savedCfg.presetMode || 'global';
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
      this.peerLastPacketWallClock = new Map();
      this.peerLastSeqMap = new Map();
      this.peerLastP2PActiveAt = new Map();
      this.currentGmDuckFactor = 1.0;

      this.detectedHumFreq = 120;
      this.txAdpcmPredictor = 0;
      this.txAdpcmStepIndex = 0;

      this.rafaelAdpcmPredictor = 0;
      this.rafaelAdpcmStepIndex = 0;

      this.sttEnabled = false;
      this.speechRecognizer = null;
      this.rawSttCallbacks = new Set();
      this.sttAccumulator = [];
      this.sttAccumulatorSamples = 0;
      this.ttsQueueAbort = false;
      this.preferredVoice = null;

      this.injectedMicNodes = null;
      this.lastHookedHpf = null;
      this.lastRawMicStreamHooked = null;
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

      this.initPreferredTtsVoice();
      this.installCrossCountryElasticAudioHooks();
      this.startGovernorLoops();
      setTimeout(() => this.initBlackboxRecorder(), 1200);

      this.engine.log('🎙️ [AudioOptimizer v6.5] EURO-LINK: Відкритий тракт + Гарячий резерв P2P/Relay активні.');
    }

    isRafaelActiveNow() {
      return !!(window.AetherOptimizers.network && window.AetherOptimizers.network.rafaelActive);
    }

    disableHardwareNoiseGateOnMic() {
      if (!this.audio) return;

      if (this.audio.tuning.expanderThreshold > 0.0001) {
        this.audio.applyOptimizerPatch({
          expanderThreshold: 0.00001,
          holdBlocksCount: 9999
        });
      }

      const rawStream = this.audio.rawMicStream;
      if (rawStream && this.lastRawMicStreamHooked !== rawStream) {
        this.lastRawMicStreamHooked = rawStream;
        rawStream.getAudioTracks().forEach((track) => {
          if (typeof track.applyConstraints === 'function') {
            track.applyConstraints({
              noiseSuppression: false,
              autoGainControl: true,
              echoCancellation: this.presetMode === 'room'
            }).catch(() => {});
          }
        });
      }
    }

    applyImmediatePresetParameters() {
      if (!this.audio) return;
      const targetSr = this.adpcm24kEnabled ? 24000 : 16000;

      if (this.presetMode === 'room') {
        this.audio.applyOptimizerPatch({
          targetSampleRate: targetSr,
          jitterPrebufferSec: 0.065,
          maxQueueLatencySec: 0.480,
          hpfFrequency: 110,
          presenceGainDb: 1.6,
          expanderThreshold: 0.00001,
          holdBlocksCount: 9999
        });
      } else if (this.presetMode === 'studio') {
        this.audio.applyOptimizerPatch({
          targetSampleRate: targetSr,
          jitterPrebufferSec: 0.080,
          maxQueueLatencySec: 0.580,
          hpfFrequency: 80,
          presenceGainDb: 2.4,
          expanderThreshold: 0.00001,
          holdBlocksCount: 9999
        });
      } else {
        // Між країнами (global / auto) — підвищений запас плавності проти джиттера Wi-Fi/4G
        this.audio.applyOptimizerPatch({
          targetSampleRate: targetSr,
          jitterPrebufferSec: 0.105,
          maxQueueLatencySec: 0.720,
          hpfFrequency: 90,
          presenceGainDb: 2.2,
          expanderThreshold: 0.00001,
          holdBlocksCount: 9999
        });
      }

      this.disableHardwareNoiseGateOnMic();
    }

    startGovernorLoops() {
      if (this.fastTimer) clearInterval(this.fastTimer);
      if (this.slowTimer) clearInterval(this.slowTimer);

      this.applyImmediatePresetParameters();

      this.fastTimer = setInterval(() => {
        if (!this.audio || !this.engine) return;
        this.disableHardwareNoiseGateOnMic();
        this.ensureStudioMasteringNodesInjected();
        this.runDynamicDeEsserAndHumTracker();
        this.updateSpatialPanningAndMixer();
      }, 140);

      this.slowTimer = setInterval(() => {
        if (!this.audio || !this.engine) return;
        this.healSuspendedAudioNodes();
      }, 1800);
    }

    // =========================================================================
    // HOT-STANDBY P2P WATCHDOG + SEQUENCE GAP BRIDGE + ELASTIC NETEQ
    // =========================================================================
    installCrossCountryElasticAudioHooks() {
      if (!this.audio || this.audio._v65HooksInstalled) return;
      this.audio._v65HooksInstalled = true;

      const origEncode = this.audio.encodeClean16BitPCM.bind(this.audio);

      // КРИТИЧНИЙ СТАБІЛІЗАТОР МІЖ КРАЇНАМИ:
      // Ми ЗАВЖДИ підтримуємо легкий фоновий потік ADPCM паралельно з WebRTC P2P,
      // щоб при найменшому просіданні UDP-маршруту між країнами резервний потік
      // підхопив слово за 0 мілісекунд без обриву!
      this.engine.needsQuantumAudioRelay = () => {
        if (!this.engine.localState?.inGame || this.audio.localMicMuted) return false;
        if (this.whisperTargetId) return true;
        return this.engine.remoteDevices.size > 0;
      };

      this.audio.encodeClean16BitPCM = (float32Samples, sourceRate, gainScale = 1.0) => {
        if (this.isRafaelActiveNow()) {
          this.feedSamplesToRafaelSTT(float32Samples, sourceRate);
        }

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

        const isRafaelPacket = (remoteId === RAFAEL_VIRTUAL_ID || pkt.from === RAFAEL_VIRTUAL_ID);
        if (isRafaelPacket && !this.isRafaelActiveNow()) return;

        const isDirectWhisperToMe = !!(pkt.to && pkt.to === this.engine.deviceId);
        const peerCh = this.audio.getOrCreatePeerChannel(remoteId);

        // Перевіряємо, чи живий зараз WebRTC P2P звук (Hot-Standby Watchdog):
        // Якщо P2P мовчить понад 220 мс (або P2P взагалі не активний), ми негайно пускаємо
        // резервний ADPCM-пакет у динаміки, не чекаючи 10 секунд таймауту ICE!
        if (peerCh.verifiedP2PAudio && !isDirectWhisperToMe && !isRafaelPacket) {
          const lastP2PVoice = this.peerLastP2PActiveAt.get(remoteId) || 0;
          const p2pDeliveringNow = (performance.now() - lastP2PVoice) < 220;
          if (p2pDeliveringNow) {
            return; // P2P реально грає прямо зараз — дублювати не треба
          }
        }

        const ctx = this.audio.ensureContext();
        const now = ctx.currentTime;
        const wallNow = performance.now();
        const lastWall = this.peerLastPacketWallClock.get(remoteId) || 0;
        const wallGapMs = wallNow - lastWall;
        this.peerLastPacketWallClock.set(remoteId, wallNow);

        let floatData = null;
        if (pkt.d.charCodeAt(0) === 33) {
          floatData = this.decodeImaAdpcmToFloat32(pkt.d.substring(1));
        } else {
          floatData = this.decodeLegacyPcm16ToFloat32(pkt.d);
        }
        if (!floatData || floatData.length < 16) return;

        this.audio.telemetry.packetsReceived++;
        const len = floatData.length;
        const sampleRate = pkt.sr || (pkt.d.charCodeAt(0) === 33 ? 24000 : 16000);

        let sumAbs = 0;
        for (let i = 0; i < len; i += 2) sumAbs += Math.abs(floatData[i]);
        const avgAmp = sumAbs / (len / 2);
        this.peerVoiceEnergy.set(remoteId, Math.min(1.0, avgAmp * 8.5));

        // Перевірка пропуску пакета за номером seq (Sequence Gap Interpolator)
        const prevSeq = this.peerLastSeqMap.get(remoteId);
        const seqGap = (pkt.seq !== undefined && prevSeq !== undefined) ? (pkt.seq - prevSeq) : 1;
        if (pkt.seq !== undefined) {
          this.peerLastSeqMap.set(remoteId, pkt.seq);
        }

        if (!peerCh.nextPlayTime || peerCh.nextPlayTime < now) {
          const underrunSec = peerCh.nextPlayTime ? (now - peerCh.nextPlayTime) : 999;

          if (underrunSec < 0.450 && wallGapMs < 550) {
            // Мікро-затримка пакета в дорозі з іншої країни — зшиваємо хвилю через PLC-міст!
            if (underrunSec > 0.008 && Math.abs(peerCh.lastSample || 0) > 0.0008) {
              try {
                const plcDuration = Math.min(0.055, underrunSec);
                const plcLen = Math.max(8, Math.floor(sampleRate * plcDuration));
                const plcBuf = ctx.createBuffer(1, plcLen, sampleRate);
                const plcData = plcBuf.getChannelData(0);
                const startVal = peerCh.lastSample || 0;
                const endVal = floatData[0] || 0;
                for (let i = 0; i < plcLen; i++) {
                  const mu = i / plcLen;
                  plcData[i] = startVal * (1 - mu) + endVal * mu * 0.5;
                }
                const plcSrc = ctx.createBufferSource();
                plcSrc.buffer = plcBuf;
                plcSrc.connect(peerCh.gainNode);
                plcSrc.start(now);
              } catch (_) {}
            }
            peerCh.nextPlayTime = now + 0.018;
          } else {
            peerCh.nextPlayTime = now + (this.audio.tuning.jitterPrebufferSec || 0.105);
            for (let i = 0; i < 24; i++) floatData[i] *= (i / 24);
          }
        } else if (seqGap > 1 && seqGap <= 3 && Math.abs(peerCh.lastSample || 0) > 0.001) {
          // Якщо загубився 1 пакет між двома сусідніми — вставляємо короткий 18 мс інтерполяційний міст
          try {
            const bridgeLen = Math.floor(sampleRate * 0.018);
            const bridgeBuf = ctx.createBuffer(1, bridgeLen, sampleRate);
            const bridgeData = bridgeBuf.getChannelData(0);
            const s0 = peerCh.lastSample || 0;
            const s1 = floatData[0] || 0;
            for (let i = 0; i < bridgeLen; i++) {
              const t = i / bridgeLen;
              bridgeData[i] = s0 * (1 - t) + s1 * t;
            }
            const bSrc = ctx.createBufferSource();
            bSrc.buffer = bridgeBuf;
            bSrc.connect(peerCh.gainNode);
            bSrc.start(peerCh.nextPlayTime);
            peerCh.nextPlayTime += bridgeBuf.duration;
          } catch (_) {}
        }

        // Плавне зшивання країв пакета (Cubic Crossfade)
        const delta = (peerCh.lastSample || 0) - floatData[0];
        if (Math.abs(delta) > 0.0002) {
          const crossLen = Math.min(28, len);
          for (let i = 0; i < crossLen; i++) {
            floatData[i] += delta * (1 - i / crossLen);
          }
        }
        peerCh.lastSample = floatData[len - 1];

        const queueAheadSec = peerCh.nextPlayTime - now;
        let playbackRate = 1.0;
        if (queueAheadSec > 0.580) {
          playbackRate = 1.08;
        } else if (queueAheadSec > 0.340) {
          playbackRate = 1.04;
        }

        if (queueAheadSec > 1.8) {
          peerCh.nextPlayTime = now + 0.120;
          this.audio.telemetry.bufferResetsCount++;
        }

        const audioBuf = ctx.createBuffer(1, len, sampleRate);
        audioBuf.getChannelData(0).set(floatData);

        const bufSource = ctx.createBufferSource();
        bufSource.buffer = audioBuf;
        bufSource.playbackRate.value = playbackRate;
        bufSource.connect(peerCh.gainNode);

        peerCh.activeNodes.push(bufSource);
        bufSource.onended = () => {
          const idx = peerCh.activeNodes.indexOf(bufSource);
          if (idx !== -1) peerCh.activeNodes.splice(idx, 1);
        };

        bufSource.start(peerCh.nextPlayTime);
        peerCh.nextPlayTime += (audioBuf.duration / playbackRate);

        if (avgAmp > 0.003) {
          peerCh.quantumSpeakingUntil = Date.now() + Math.round(audioBuf.duration * 1000) + 240;
        }
      };
    }

    decodeLegacyPcm16ToFloat32(b64) {
      try {
        const binary = atob(b64);
        const byteLen = binary.length;
        if (byteLen < 4) return null;
        const bytes = new Uint8Array(byteLen);
        for (let i = 0; i < byteLen; i++) bytes[i] = binary.charCodeAt(i);
        const int16 = new Int16Array(bytes.buffer);
        const floatData = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          floatData[i] = int16[i] / 32768.0;
        }
        return floatData;
      } catch (_) {
        return null;
      }
    }

    // =========================================================================
    // СЛУХ ТА ГОЛОС РАФАЕЛЯ (ПІД СИСТЕМУ «ВІТРУВІЙ»)
    // =========================================================================
    onRawAudioChunkForSTT(callback) {
      if (typeof callback === 'function') {
        this.rawSttCallbacks.add(callback);
      }
    }

    feedSamplesToRafaelSTT(float32Samples, sourceRate) {
      if (!this.isRafaelActiveNow() || this.rawSttCallbacks.size === 0) return;

      const targetSr = 16000;
      const ratio = sourceRate / targetSr;
      const outLen = Math.floor(float32Samples.length / ratio);
      const chunk = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        chunk[i] = float32Samples[Math.floor(i * ratio)];
      }

      this.sttAccumulator.push(chunk);
      this.sttAccumulatorSamples += outLen;

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
              speakerName: this.engine?.localState?.name || 'Гравець',
              sampleRate: targetSr,
              samples: merged
            });
          } catch (_) {}
        });
      }
    }

    setRafaelSttListening(enabled) {
      if (!this.isRafaelActiveNow()) {
        this.sttEnabled = false;
        return false;
      }

      this.sttEnabled = !!enabled;
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!this.sttEnabled) {
        if (this.speechRecognizer) {
          try { this.speechRecognizer.onend = null; this.speechRecognizer.stop(); } catch (_) {}
          this.speechRecognizer = null;
        }
        window.AetherRafaelBridge?.setBotState('Idle');
        return false;
      }

      if (!SpeechRec) return false;

      try {
        const rec = new SpeechRec();
        rec.lang = 'uk-UA';
        rec.continuous = true;
        rec.interimResults = true;

        rec.onresult = (event) => {
          if (!this.isRafaelActiveNow()) return;
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            const transcript = (res[0]?.transcript || '').trim();
            if (!transcript) continue;

            const low = transcript.toLowerCase();
            const isWakeWord = low.includes('рафаель') || low.includes('рафаэль');

            if (!res.isFinal) {
              if (isWakeWord) window.AetherRafaelBridge?.setBotState('Listening');
            } else {
              window.AetherRafaelBridge?.handleRecognizedSpeech(
                this.engine?.localState?.name || 'Гравець',
                transcript,
                isWakeWord
              );
            }
          }
        };

        rec.onerror = () => {};
        rec.onend = () => {
          if (this.sttEnabled && this.isRafaelActiveNow()) {
            setTimeout(() => {
              try { rec.start(); } catch (_) {}
            }, 400);
          }
        };

        rec.start();
        this.speechRecognizer = rec;
        return true;
      } catch (_) {
        return false;
      }
    }

    initPreferredTtsVoice() {
      if (!('speechSynthesis' in window)) return;
      const pickBestVoice = () => {
        const voices = window.speechSynthesis.getVoices() || [];
        if (voices.length === 0) return;
        const ukVoices = voices.filter((v) => /uk|ukr/i.test(v.lang) || /ostap|polina|ukrain/i.test(v.name));
        const neuralUk = ukVoices.find((v) => /natural|neural|online|google|microsoft/i.test(v.name));
        this.preferredVoice = neuralUk || ukVoices[0] || null;
      };
      pickBestVoice();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = pickBestVoice;
      }
    }

    async playExternalAudioBlobAsRafael(audioBlobOrArrayBuffer) {
      if (!this.isRafaelActiveNow() || !this.audio) return;
      const ctx = this.audio.ensureContext();
      if (!ctx) return;

      try {
        const arrayBuf = audioBlobOrArrayBuffer instanceof Blob
          ? await audioBlobOrArrayBuffer.arrayBuffer()
          : audioBlobOrArrayBuffer;
        const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
        const float32 = decoded.getChannelData(0);
        this.injectExternalTtsAudioAsRafael(float32, decoded.sampleRate);
      } catch (_) {}
    }

    injectExternalTtsAudioAsRafael(float32Samples, sourceSampleRate = 24000) {
      if (!this.isRafaelActiveNow() || !float32Samples || float32Samples.length === 0 || !this.audio) return;

      window.AetherRafaelBridge?.setBotState('Speaking');

      const chunkSamples = Math.floor(sourceSampleRate * 0.085);
      let offset = 0;
      let packetIndex = 0;

      const sendNextChunk = () => {
        if (!this.isRafaelActiveNow() || offset >= float32Samples.length) {
          this.peerVoiceEnergy.set(RAFAEL_VIRTUAL_ID, 0);
          if (this.isRafaelActiveNow()) {
            setTimeout(() => window.AetherRafaelBridge?.setBotState('Idle'), 220);
          }
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

          this.audio.ingestQuantumAudioPacket(RAFAEL_VIRTUAL_ID, pkt);
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

    playRafaelVoiceResponse(rawText = '') {
      if (!this.isRafaelActiveNow() || !rawText) return;
      const ctx = this.audio?.ensureContext();
      if (!ctx) return;

      window.AetherRafaelBridge?.setBotState('Speaking');

      const sr = 24000;
      const chimeSamples = new Float32Array(Math.floor(sr * 0.32));
      const freqs = [659.25, 987.77, 1318.5];
      for (let i = 0; i < chimeSamples.length; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 9.5) * Math.min(1, t * 90);
        chimeSamples[i] = (
          Math.sin(2 * Math.PI * freqs[0] * t) * 0.16 +
          Math.sin(2 * Math.PI * freqs[1] * t) * 0.11 +
          Math.sin(2 * Math.PI * freqs[2] * t) * 0.07
        ) * env;
      }
      this.injectExternalTtsAudioAsRafael(chimeSamples, sr);

      if (!('speechSynthesis' in window)) return;

      try {
        this.ttsQueueAbort = true;
        window.speechSynthesis.cancel();
        this.ttsQueueAbort = false;

        const utter = new SpeechSynthesisUtterance(String(rawText).trim());
        if (this.preferredVoice) utter.voice = this.preferredVoice;
        utter.lang = this.preferredVoice?.lang || 'uk-UA';
        utter.rate = 0.96;
        utter.pitch = 1.0;

        let pulseTimer = null;
        utter.onstart = () => {
          window.AetherRafaelBridge?.setBotState('Speaking');
          pulseTimer = setInterval(() => {
            this.peerVoiceEnergy.set(RAFAEL_VIRTUAL_ID, 0.35 + Math.random() * 0.5);
          }, 90);
        };

        const done = () => {
          if (pulseTimer) clearInterval(pulseTimer);
          this.peerVoiceEnergy.set(RAFAEL_VIRTUAL_ID, 0);
          if (this.isRafaelActiveNow()) window.AetherRafaelBridge?.setBotState('Idle');
        };

        utter.onend = done;
        utter.onerror = done;
        setTimeout(() => window.speechSynthesis.speak(utter), 220);
      } catch (_) {
        window.AetherRafaelBridge?.setBotState('Idle');
      }
    }

    stopRafaelSpeechImmediately() {
      this.ttsQueueAbort = true;
      if ('speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (_) {}
      }
      this.peerVoiceEnergy.set(RAFAEL_VIRTUAL_ID, 0);
    }

    // =========================================================================
    // КЕРУВАННЯ ПАРАМЕТРАМИ ТА СТУДІЙНИМ МІКШЕРОМ
    // =========================================================================
    setPresetMode(mode) {
      this.presetMode = mode || 'global';
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
    }

    setVoiceMorph(morphName) {
      this.currentVoiceMorph = morphName || 'normal';
      this.applyAcousticAndMorphToNodes();
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
      if (peerId === RAFAEL_VIRTUAL_ID && !this.isRafaelActiveNow()) return 0;
      return this.peerVoiceEnergy.get(peerId) || 0;
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
        a.download = `vitruvius-highlight-${stamp}.webm`;
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

    computeSeatPanPosition(seatId) {
      if (!this.spatialEnabled || !seatId || seatId === 'gm' || seatId === 'table_center') return 0.0;
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
        if (remoteId === RAFAEL_VIRTUAL_ID && !this.isRafaelActiveNow()) return;

        const analyserItem = this.audio.analysers.get(remoteId);
        let avgLevel = 0;
        if (analyserItem && analyserItem.analyser) {
          analyserItem.analyser.getByteFrequencyData(analyserItem.buf);
          let sum = 0;
          for (let i = 2; i < 38; i++) sum += analyserItem.buf[i];
          avgLevel = sum / 36;
          this.peerVoiceEnergy.set(remoteId, Math.min(1.0, avgLevel / 75));

          // Якщо P2P-аналізатор бачить реальний звук (> 4), фіксуємо час активності P2P
          if (avgLevel > 4 && peerCh.verifiedP2PAudio) {
            this.peerLastP2PActiveAt.set(remoteId, performance.now());
          }
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
            if ((dev.role === 'gm' || (dev.role === 'ai_assistant' && this.isRafaelActiveNow())) && this.audio.isPeerSpeaking(remoteId)) {
              gmOrRafaelSpeakingNow = true;
            }
          });
        }
      }

      const targetGmDuck = gmOrRafaelSpeakingNow ? 0.68 : 1.0;
      this.currentGmDuckFactor += (targetGmDuck - this.currentGmDuckFactor) * (gmOrRafaelSpeakingNow ? 0.25 : 0.08);

      this.audio.peerChannels.forEach((peerCh, remoteId) => {
        if (remoteId === RAFAEL_VIRTUAL_ID && !this.isRafaelActiveNow()) {
          peerCh.gainNode.gain.setTargetAtTime(0, this.audio.ctx.currentTime, 0.02);
          return;
        }

        const dev = this.engine.remoteDevices.get(remoteId);
        const seatId = dev?.seat || null;
        const isPriorityPeer = dev?.role === 'gm' || dev?.role === 'ai_assistant' || seatId === 'gm';
        const playerName = dev?.name || (remoteId === RAFAEL_VIRTUAL_ID ? 'Рафаель' : '');

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
          const clampedBoost = Math.max(0.85, Math.min(1.55, desiredBoost));
          autoGain = autoGain * 0.90 + clampedBoost * 0.10;
          this.peerSmoothedAutoGain.set(remoteId, autoGain);
        }

        let duganWeight = 1.0;
        if (this.duganAutomixEnabled && totalTableVoiceEnergy > 28 && !isPriorityPeer) {
          const share = Math.max(0.25, level / totalTableVoiceEnergy);
          duganWeight = 0.72 + 0.28 * Math.min(1.0, share * 1.4);
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
        bodyWarmth.gain.value = 1.4;

        const deEsser = ctx.createBiquadFilter();
        deEsser.type = 'peaking';
        deEsser.frequency.value = 6200;
        deEsser.Q.value = 2.2;
        deEsser.gain.value = 0.0;

        const airBoost = ctx.createBiquadFilter();
        airBoost.type = 'highshelf';
        airBoost.frequency.value = 8200;
        airBoost.gain.value = 2.6;

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
        targetDeEssDb = -Math.min(5.0, (sibilanceAvg - 30) * 0.11);
      }
      this.injectedMicNodes.deEsser.gain.setTargetAtTime(targetDeEssDb, this.audio.ctx.currentTime, 0.025);

      const rms = this.audio.telemetry.lastInputRms || 0;
      if (rms > 0 && rms < 0.008 && !this.audio.localMicMuted) {
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