/**
 * ============================================================================
 * AETHER CORE AUDIO ENGINE (aether_audio.js) - v8.6 GOLDEN BASE
 * ----------------------------------------------------------------------------
 * Виправлення золотої бази:
 *   1. Mobile Bluetooth Bridge: вивід усього звукового графа через активний
 *      MediaStream -> <audio>, щоб Android/iOS гарантовано подавали звук
 *      у Bluetooth-навушники в режимі дзвінка.
 *   2. Discord NetEQ Elastic Catch-Up: замість обрізання пакетів (node.stop)
 *      використовується плавне прискорення playbackRate (1.05x) при стрибках Wi-Fi.
 *   3. Пакет 2048 семплів (42 мс) + ідеальна сплайн-склейка без розривів.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const PREFERRED_MIC_STORAGE_KEY = 'entropia_aether_preferred_mic_v86';

  const VIRTUAL_LOOPBACK_KEYWORDS = [
    'stereo mix', 'стерео микшер', 'стерео мікшер', 'what u hear',
    'loopback', 'vb-audio', 'cable output'
  ];

  const INTERNAL_LAPTOP_MIC_KEYWORDS = [
    'array', 'матриця', 'матрица', 'internal', 'integrated',
    'вбудован', 'встроенн', 'smart sound', 'intel® smart'
  ];

  const BLUETOOTH_AND_PRO_MIC_KEYWORDS = [
    'bluetooth', 'airpods', 'buds', 'wireless', 'hands-free', 'headset',
    'earbuds', 'гарнітура', 'гарнитура', 'навушник', 'наушник', 'bt ',
    'usb', 'minifuse', 'arturia', 'scarlett', 'focusrite', 'rode', 'nt1',
    'shure', 'steinberg', 'behringer', 'audient', 'zoom', 'hyperx', 'fifine',
    'yeti', 'razer', 'steelseries', 'logitech', 'external', 'зовнішн'
  ];

  class AetherAudioEngine {
    constructor(options = {}) {
      this.onVoiceActivity = options.onVoiceActivity || null;
      this.onAudioBlocked = options.onAudioBlocked || null;
      this.onQuantumAudioPacketOut = options.onQuantumAudioPacketOut || null;
      this.onMicListUpdated = options.onMicListUpdated || null;
      this.onSpeakerListUpdated = options.onSpeakerListUpdated || null;
      this.onLog = options.onLog || null;

      this.ctx = null;
      this.masterGain = null;
      this.directDestinationGain = null;
      this.bluetoothBridgeDest = null;
      this.bluetoothBridgeAudioEl = null;

      this.selectedSinkId = 'default';
      this.selectedMicId = localStorage.getItem(PREFERRED_MIC_STORAGE_KEY) || '';
      this.isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

      // Локальний мікрофонний тракт
      this.rawMicStream = null;
      this.processedMicStream = null;
      this.hpfNode = null;
      this.presenceNode = null;
      this.micMuteGainNode = null;
      this.localScriptNode = null;
      this.localMicMuted = false;

      // Канали гравців: remoteId -> PeerAudioChannel
      this.peerChannels = new Map();
      this.analysers = new Map();

      // Збалансовані таймінги буфера (усувають і обриви, і затримку)
      this.tuning = {
        targetSampleRate: 16000,
        jitterPrebufferSec: 0.095,     // 95 мс стабільного запасу (2.2 пакета)
        elasticCatchupThresholdSec: 0.190, // Понад 190 мс — плавне прискорення 1.06x без обрізання
        hardResetThresholdSec: 0.480,  // Скидання тільки якщо вкладка зависла на півсекунди
        hpfFrequency: 95,
        presenceGainDb: 1.8,
        expanderThreshold: 0.0032,
        holdBlocksCount: 28,           // ~1.2 секунди утримання після кожного слова
        sidechainDuckGain: 0.501       // -6 dB для фонової музики
      };

      this.telemetry = {
        packetsSent: 0,
        packetsReceived: 0,
        bufferResetsCount: 0,
        lastInputRms: 0,
        activeSampleRate: 0
      };

      this.musicElements = new Set();
      this.musicGainNodes = new Set();
      this.sidechainCallbacks = new Set();
      this.currentDuckFactor = 1.0;

      this.exposeMusicBridge();
      this.setupLifecycleHandlers();
      this.startVadAndSidechainLoop();

      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => {
          this.enumerateAndRankMicrophones();
        });
      }
    }

    log(msg) {
      console.log(`%c[AetherAudio v8.6]%c ${msg}`, 'color:#34d399;font-weight:bold;', 'color:#e2e8f0;');
      if (this.onLog) this.onLog(msg);
    }

    // Шлюз для майбутнього aether_audio_optimizer.js
    applyOptimizerPatch(patch = {}) {
      Object.assign(this.tuning, patch);
      if (this.hpfNode && patch.hpfFrequency !== undefined && this.ctx) {
        this.hpfNode.frequency.setTargetAtTime(this.tuning.hpfFrequency, this.ctx.currentTime, 0.05);
      }
      if (this.presenceNode && patch.presenceGainDb !== undefined && this.ctx) {
        this.presenceNode.gain.setTargetAtTime(this.tuning.presenceGainDb, this.ctx.currentTime, 0.05);
      }
    }

    getTelemetry() {
      return {
        ...this.telemetry,
        tuning: { ...this.tuning },
        activePeersCount: this.peerChannels.size,
        contextState: this.ctx ? this.ctx.state : 'uninitialized'
      };
    }

    exposeMusicBridge() {
      const self = this;
      window.AetherMusicBridge = {
        registerAudioElement(audioEl, baseVolume = 1.0) {
          if (!audioEl) return;
          audioEl.dataset.aetherMusicIgnore = 'true';
          audioEl._aetherBaseVol = baseVolume;
          self.musicElements.add(audioEl);
        },
        registerMusicGainNode(gainNode, baseGain = 1.0) {
          if (!gainNode) return;
          gainNode._aetherBaseGain = baseGain;
          self.musicGainNodes.add(gainNode);
        },
        onSidechainDuck(cb) {
          if (typeof cb === 'function') self.sidechainCallbacks.add(cb);
        },
        getAudioContext() {
          return self.ensureContext();
        }
      };
    }

    // =========================================================================
    // 1. ІНІЦІАЛІЗАЦІЯ АУДІО ТА АКТИВНИЙ МІСТ ДЛЯ BLUETOOTH НА ТЕЛЕФОНАХ
    // =========================================================================
    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx({
          latencyHint: 'interactive'
        });

        this.telemetry.activeSampleRate = this.ctx.sampleRate;
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;

        // Прямий вихід у ctx.destination (використовується на ПК або як резерв до старту медіа-мосту)
        this.directDestinationGain = this.ctx.createGain();
        this.directDestinationGain.gain.value = 1.0;
        this.masterGain.connect(this.directDestinationGain);
        this.directDestinationGain.connect(this.ctx.destination);

        // КРИТИЧНО ДЛЯ BLUETOOTH НА СМАРТФОНАХ:
        // На мобільних ОС WebAudio ctx.destination ігнорує Bluetooth під час активного мікрофона.
        // Тому ми виводимо masterGain через MediaStreamDestination у справжній <audio> елемент!
        try {
          this.bluetoothBridgeDest = this.ctx.createMediaStreamDestination();
          this.masterGain.connect(this.bluetoothBridgeDest);

          const btAudio = document.createElement('audio');
          btAudio.id = 'aether-bt-master-bridge';
          btAudio.autoplay = true;
          btAudio.playsInline = true;
          btAudio.srcObject = this.bluetoothBridgeDest.stream;
          btAudio.style.cssText = 'position:fixed;bottom:1px;right:1px;width:1px;height:1px;opacity:0.01;pointer-events:none;';
          document.body.appendChild(btAudio);
          this.bluetoothBridgeAudioEl = btAudio;

          // На телефонах одразу активуємо вивід через <audio> міст, щоб звук ішов у Bluetooth-навушники!
          if (this.isMobileDevice) {
            btAudio.muted = false;
            btAudio.onplaying = () => {
              // Вимикаємо прямий ctx.destination, щоб не було подвійного звуку
              if (this.directDestinationGain) {
                this.directDestinationGain.gain.value = 0.0;
              }
            };
            btAudio.play().catch(() => {});
          } else {
            btAudio.muted = true;
          }
        } catch (_) {}
      }

      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {
          if (this.onAudioBlocked) this.onAudioBlocked(true);
        });
      }
      return this.ctx;
    }

    setupLifecycleHandlers() {
      document.addEventListener('visibilitychange', () => {
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
      });

      const unlock = () => this.unlockAudio();
      window.addEventListener('click', unlock, { passive: true });
      window.addEventListener('touchstart', unlock, { passive: true });
    }

    unlockAudio() {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          if (this.onAudioBlocked) this.onAudioBlocked(false);
        }).catch(() => {});
      }
      if (this.bluetoothBridgeAudioEl && this.isMobileDevice) {
        this.bluetoothBridgeAudioEl.muted = false;
        this.bluetoothBridgeAudioEl.play().then(() => {
          if (this.directDestinationGain) this.directDestinationGain.gain.value = 0.0;
        }).catch(() => {});
      }
      this.peerChannels.forEach((ch) => {
        if (ch.audioEl && ch.audioEl.paused) {
          ch.audioEl.play().catch(() => {});
        }
      });
    }

    // =========================================================================
    // 2. ВИБІР МІКРОФОНА (ПІДТРИМКА BLUETOOTH НА ТЕЛЕФОНІ ТА ЗОВНІШНЬОГО НА ПК)
    // =========================================================================
    isBluetoothOrHeadsetLabel(label = '') {
      const low = label.toLowerCase();
      return [
        'bluetooth', 'airpods', 'buds', 'wireless', 'hands-free',
        'headset', 'earbuds', 'гарнітура', 'гарнитура', 'навушник', 'наушник'
      ].some((w) => low.includes(w));
    }

    scoreMicrophoneDevice(device, index) {
      const label = (device.label || '').toLowerCase();
      let score = 50 - index;
      if (!label) return score;

      if (VIRTUAL_LOOPBACK_KEYWORDS.some((w) => label.includes(w))) score -= 200;
      if (INTERNAL_LAPTOP_MIC_KEYWORDS.some((w) => label.includes(w))) score -= 60;
      if (BLUETOOTH_AND_PRO_MIC_KEYWORDS.some((w) => label.includes(w))) score += 110;
      if (this.isBluetoothOrHeadsetLabel(label)) score += 50;
      return score;
    }

    async enumerateAndRankMicrophones() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      try {
        const all = await navigator.mediaDevices.enumerateDevices();

        const outputs = all.filter((d) => d.kind === 'audiooutput');
        if (this.onSpeakerListUpdated) {
          this.onSpeakerListUpdated(outputs, this.selectedSinkId);
        }

        const mics = all
          .filter((d) => d.kind === 'audioinput' && d.deviceId)
          .map((d, idx) => {
            const low = (d.label || '').toLowerCase();
            const isBluetooth = this.isBluetoothOrHeadsetLabel(low);
            const isExternal = isBluetooth || BLUETOOTH_AND_PRO_MIC_KEYWORDS.some((w) => low.includes(w));
            const isInternal = !isExternal && INTERNAL_LAPTOP_MIC_KEYWORDS.some((w) => low.includes(w));
            return {
              deviceId: d.deviceId,
              label: d.label || `Мікрофон #${idx + 1}`,
              score: this.scoreMicrophoneDevice(d, idx),
              isBluetooth,
              isExternal,
              isInternal
            };
          })
          .sort((a, b) => b.score - a.score);

        if (this.onMicListUpdated) {
          this.onMicListUpdated(mics, this.selectedMicId);
        }
        return mics;
      } catch (_) {
        return [];
      }
    }

    async acquireStudioMicStream(explicitMicId = '') {
      if (explicitMicId) {
        this.selectedMicId = explicitMicId;
        localStorage.setItem(PREFERRED_MIC_STORAGE_KEY, explicitMicId);
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;

      const baseAudioOpts = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };

      // КРИТИЧНЕ ПРАВИЛО ДЛЯ СМАРТФОНІВ:
      // На Android та iOS, якщо користувач не обрав інший мікрофон вручну,
      // викликаємо getUserMedia ОДИН РАЗ без жорсткого deviceId (або з Bluetooth deviceId, якщо він явно видимий).
      // Повторне перевідкриття потоку на телефоні скидає Bluetooth SCO!
      if (this.isMobileDevice && !explicitMicId) {
        try {
          const mobileMics = await this.enumerateAndRankMicrophones();
          const btMic = mobileMics.find((m) => m.isBluetooth && m.deviceId !== 'default');
          const mobileConstraints = btMic
            ? { ...baseAudioOpts, deviceId: { ideal: btMic.deviceId } }
            : baseAudioOpts;

          const stream = await navigator.mediaDevices.getUserMedia({
            audio: mobileConstraints,
            video: false
          });
          await this.enumerateAndRankMicrophones();
          return stream;
        } catch (err) {
          try {
            return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          } catch (_) {
            return null;
          }
        }
      }

      // На ноутбуці / ПК обираємо найкращий зовнішній або Bluetooth мікрофон замість гучного мікрофона біля кулера
      let mics = await this.enumerateAndRankMicrophones();
      let targetMicId = explicitMicId || this.selectedMicId;

      if (!targetMicId || !mics.some((m) => m.deviceId === targetMicId)) {
        if (mics[0] && mics[0].deviceId) {
          targetMicId = mics[0].deviceId;
        }
      }

      try {
        let stream = null;
        if (targetMicId && targetMicId !== 'default') {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: { ...baseAudioOpts, deviceId: { exact: targetMicId } },
              video: false
            });
          } catch (_) {}
        }

        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: baseAudioOpts,
            video: false
          });
        }

        mics = await this.enumerateAndRankMicrophones();
        const currentTrack = stream.getAudioTracks()[0];
        const currentLabel = (currentTrack?.label || '').toLowerCase();
        const isCurrentInternal = INTERNAL_LAPTOP_MIC_KEYWORDS.some((w) => currentLabel.includes(w));

        if (!explicitMicId && isCurrentInternal) {
          const betterMic = mics.find((m) => (m.isBluetooth || m.isExternal) && m.deviceId !== 'default');
          if (betterMic) {
            try {
              const betterStream = await navigator.mediaDevices.getUserMedia({
                audio: { ...baseAudioOpts, deviceId: { exact: betterMic.deviceId } },
                video: false
              });
              stream.getTracks().forEach((t) => t.stop());
              stream = betterStream;
              this.log(`Автовибір зовнішнього мікрофона/гарнітури: "${betterMic.label}"`);
            } catch (_) {}
          }
        }

        const finalTrack = stream.getAudioTracks()[0];
        if (finalTrack) {
          const settings = finalTrack.getSettings ? finalTrack.getSettings() : {};
          if (settings.deviceId) {
            this.selectedMicId = settings.deviceId;
            localStorage.setItem(PREFERRED_MIC_STORAGE_KEY, settings.deviceId);
          }
          await this.enumerateAndRankMicrophones();
        }

        return stream;
      } catch (err) {
        this.log(`Помилка доступу до мікрофона (${err.name}).`);
        return null;
      }
    }

    // =========================================================================
    // 3. СТУДІЙНИЙ ТРАКТ ЗАХВАТУ (2048 СЕМПЛІВ = 42 МС БЕЗ ОБРИВІВ)
    // =========================================================================
    async buildStudioMicPipeline(rawStream, localPeerId, shouldSendQuantumCallback) {
      const ctx = this.ensureContext();
      this.cleanupLocalMicPipeline();

      this.rawMicStream = rawStream;
      if (!rawStream || rawStream.getAudioTracks().length === 0) {
        return rawStream;
      }

      const activeTrack = rawStream.getAudioTracks()[0];
      activeTrack.enabled = true;
      this.log(`Мікрофон у роботі: "${activeTrack.label || 'Audio Input'}"`);

      try {
        const source = ctx.createMediaStreamSource(rawStream);

        const notch50 = ctx.createBiquadFilter();
        notch50.type = 'notch';
        notch50.frequency.value = 50;
        notch50.Q.value = 10;

        const hpf = ctx.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = this.tuning.hpfFrequency;
        hpf.Q.value = 0.707;
        this.hpfNode = hpf;

        const presenceEq = ctx.createBiquadFilter();
        presenceEq.type = 'peaking';
        presenceEq.frequency.value = 3100;
        presenceEq.Q.value = 1.0;
        presenceEq.gain.value = this.tuning.presenceGainDb;
        this.presenceNode = presenceEq;

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -14;
        limiter.knee.value = 10;
        limiter.ratio.value = 3.0;
        limiter.attack.value = 0.004;
        limiter.release.value = 0.18;

        const micMuteGain = ctx.createGain();
        micMuteGain.gain.value = this.localMicMuted ? 0.0 : 1.0;
        this.micMuteGainNode = micMuteGain;

        const streamDest = ctx.createMediaStreamDestination();

        source.connect(notch50);
        notch50.connect(hpf);
        hpf.connect(presenceEq);
        presenceEq.connect(limiter);
        limiter.connect(micMuteGain);
        micMuteGain.connect(streamDest);

        this.attachVoiceAnalyser(localPeerId, micMuteGain, true);

        // Буфер 2048 семплів (~42 мс) ідеально узгоджується з пребуфером 95 мс!
        const scriptNode = ctx.createScriptProcessor(2048, 1, 1);
        const silentSink = ctx.createGain();
        silentSink.gain.value = 0.000001;

        let expanderEnv = 0;
        let holdBlocks = 0;

        scriptNode.onaudioprocess = (e) => {
          if (this.localMicMuted) return;
          if (typeof shouldSendQuantumCallback === 'function' && !shouldSendQuantumCallback()) return;

          const ch = e.inputBuffer.getChannelData(0);
          let sumSq = 0;
          for (let i = 0; i < ch.length; i += 2) {
            sumSq += ch[i] * ch[i];
          }
          const rms = Math.sqrt(sumSq / (ch.length / 2));
          this.telemetry.lastInputRms = rms;

          expanderEnv = rms > expanderEnv
            ? expanderEnv * 0.55 + rms * 0.45
            : expanderEnv * 0.92 + rms * 0.08;

          if (expanderEnv > this.tuning.expanderThreshold) {
            holdBlocks = this.tuning.holdBlocksCount;
          }

          if (holdBlocks > 0) {
            holdBlocks--;
            const thresh = this.tuning.expanderThreshold * 1.25;
            const noiseFloorGain = expanderEnv >= thresh
              ? 1.0
              : Math.max(0.15, expanderEnv / thresh);

            const b64 = this.encodeClean16BitPCM(ch, ctx.sampleRate, noiseFloorGain);
            if (b64 && this.onQuantumAudioPacketOut) {
              this.telemetry.packetsSent++;
              this.onQuantumAudioPacketOut({
                t: 'PCM16_V8',
                sr: this.tuning.targetSampleRate,
                d: b64
              });
            }
          }
        };

        micMuteGain.connect(scriptNode);
        scriptNode.connect(silentSink);
        silentSink.connect(ctx.destination);
        this.localScriptNode = scriptNode;

        const combinedStream = new MediaStream();
        streamDest.stream.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
        rawStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

        this.processedMicStream = combinedStream;
        return combinedStream;
      } catch (err) {
        this.attachVoiceAnalyser(localPeerId, rawStream, false);
        return rawStream;
      }
    }

    cleanupLocalMicPipeline() {
      if (this.localScriptNode) {
        try { this.localScriptNode.disconnect(); } catch (_) {}
        this.localScriptNode = null;
      }
    }

    setMicMuted(muted) {
      this.localMicMuted = !!muted;
      const ctx = this.ensureContext();
      if (this.micMuteGainNode && ctx) {
        this.micMuteGainNode.gain.setTargetAtTime(this.localMicMuted ? 0.0 : 1.0, ctx.currentTime, 0.015);
      }
      if (this.rawMicStream) {
        this.rawMicStream.getAudioTracks().forEach((t) => { t.enabled = true; });
      }
      if (this.processedMicStream) {
        this.processedMicStream.getAudioTracks().forEach((t) => { t.enabled = !this.localMicMuted; });
      }
      return !this.localMicMuted;
    }

    isMicTrackAlive() {
      if (!this.rawMicStream) return false;
      const tracks = this.rawMicStream.getAudioTracks();
      return tracks.length > 0 && tracks[0].readyState === 'live';
    }

    // =========================================================================
    // 4. КОДУВАННЯ ТА ПЛАВНЕ ВІДТВОРЕННЯ (NETEQ ELASTIC CATCH-UP БЕЗ ОБРИВІВ)
    // =========================================================================
    encodeClean16BitPCM(float32Samples, sourceRate, gainScale = 1.0) {
      const targetRate = this.tuning.targetSampleRate;
      const ratio = sourceRate / targetRate;
      const outLen = Math.floor(float32Samples.length / ratio);
      if (outLen <= 0) return null;

      const int16Buf = new Int16Array(outLen);

      for (let i = 0; i < outLen; i++) {
        const exactPos = i * ratio;
        const idx0 = Math.floor(exactPos);
        const idx1 = Math.min(float32Samples.length - 1, idx0 + 1);
        const frac = exactPos - idx0;

        const val = (float32Samples[idx0] + (float32Samples[idx1] - float32Samples[idx0]) * frac) * gainScale;
        const clamped = Math.max(-1, Math.min(1, val));
        int16Buf[i] = Math.round(clamped * 32767);
      }

      const bytes = new Uint8Array(int16Buf.buffer);
      let binary = '';
      const chunkSize = 1024;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      return btoa(binary);
    }

    ingestQuantumAudioPacket(remoteId, pkt) {
      if (!pkt || !pkt.d) return;
      const ctx = this.ensureContext();
      const peerCh = this.getOrCreatePeerChannel(remoteId);

      if (peerCh.verifiedP2PAudio) return;
      this.telemetry.packetsReceived++;

      try {
        const binary = atob(pkt.d);
        const sampleRate = pkt.sr || this.tuning.targetSampleRate;
        let floatData;

        if (pkt.t === 'PCM16_V8' || pkt.t === 'PCM16') {
          const byteLen = binary.length - (binary.length % 2);
          const uint8 = new Uint8Array(byteLen);
          for (let i = 0; i < byteLen; i++) {
            uint8[i] = binary.charCodeAt(i);
          }
          const int16 = new Int16Array(uint8.buffer);
          floatData = new Float32Array(int16.length);
          for (let i = 0; i < int16.length; i++) {
            floatData[i] = int16[i] / 32768.0;
          }
        } else {
          floatData = new Float32Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            const uVal = ~binary.charCodeAt(i) & 0xff;
            const t = (((uVal & 0x0f) << 3) + 0x84) << ((uVal & 0x70) >> 4);
            const pcm = (uVal & 0x80) ? (0x84 - t) : (t - 0x84);
            floatData[i] = pcm / 32768.0;
          }
        }

        const len = floatData.length;
        if (len < 16) return;

        let sumAbs = 0;
        for (let i = 0; i < len; i += 2) {
          sumAbs += Math.abs(floatData[i]);
        }

        const now = ctx.currentTime;
        const queueAheadSec = (peerCh.nextPlayTime || 0) - now;

        // Тільки якщо вкладка зависла на півсекунди (>480 мс) — очищаємо старий хвіст
        if (queueAheadSec > this.tuning.hardResetThresholdSec) {
          peerCh.activeNodes.forEach((n) => {
            try { n.stop(); n.disconnect(); } catch (_) {}
          });
          peerCh.activeNodes.length = 0;
          peerCh.nextPlayTime = now + this.tuning.jitterPrebufferSec;
          this.telemetry.bufferResetsCount++;
        }

        const isNewPhrase = !peerCh.nextPlayTime || peerCh.nextPlayTime < now;
        if (isNewPhrase) {
          peerCh.nextPlayTime = now + this.tuning.jitterPrebufferSec;
          for (let i = 0; i < 24; i++) {
            floatData[i] *= (i / 24);
          }
        } else {
          // Сплайн-зшивання перших 16 семплів із останнім семплом попереднього пакета (0 розривів!)
          const delta = peerCh.lastSample - floatData[0];
          if (Math.abs(delta) > 0.0003) {
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

        // АЛГОРИТМ DISCORD NETEQ: якщо черга трохи виросла (>190 мс), не ріжемо звук,
        // а плавно програємо пакет на 5% швидше (1.05x), м'яко повертаючи затримку до 95 мс!
        const playbackRate = (queueAheadSec > this.tuning.elasticCatchupThresholdSec) ? 1.05 : 1.0;
        bufSource.playbackRate.value = playbackRate;

        bufSource.connect(peerCh.gainNode);

        peerCh.activeNodes.push(bufSource);
        bufSource.onended = () => {
          const idx = peerCh.activeNodes.indexOf(bufSource);
          if (idx !== -1) peerCh.activeNodes.splice(idx, 1);
        };

        bufSource.start(peerCh.nextPlayTime);
        peerCh.nextPlayTime += (audioBuf.duration / playbackRate);

        if (sumAbs / (len / 2) > 0.007) {
          peerCh.quantumSpeakingUntil = Date.now() + Math.round(audioBuf.duration * 1000) + 180;
        }
      } catch (_) {}
    }

    getOrCreatePeerChannel(remoteId) {
      if (this.peerChannels.has(remoteId)) {
        return this.peerChannels.get(remoteId);
      }

      const ctx = this.ensureContext();
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;
      gainNode.connect(this.masterGain);

      const channelObj = {
        remoteId,
        gainNode,
        activeNodes: [],
        audioEl: null,
        webrtcStream: null,
        verifiedP2PAudio: false,
        nextPlayTime: 0,
        lastSample: 0,
        quantumSpeakingUntil: 0,
        volume: 1.0,
        muted: false
      };

      this.peerChannels.set(remoteId, channelObj);
      return channelObj;
    }

    attachRemoteWebRTCStream(remoteId, stream) {
      if (!stream || stream.getAudioTracks().length === 0) return;
      const peerCh = this.getOrCreatePeerChannel(remoteId);

      if (!peerCh.audioEl) {
        const aud = document.createElement('audio');
        aud.id = `aether-peer-audio-${remoteId}`;
        aud.className = 'aether-rtc-audio-el';
        aud.autoplay = true;
        aud.playsInline = true;
        aud.style.cssText = 'position:fixed;bottom:1px;right:1px;width:1px;height:1px;opacity:0.01;pointer-events:none;';
        document.body.appendChild(aud);
        peerCh.audioEl = aud;
      }

      if (peerCh.audioEl.srcObject !== stream) {
        peerCh.audioEl.srcObject = stream;
        peerCh.webrtcStream = stream;

        if (typeof peerCh.audioEl.setSinkId === 'function' && this.selectedSinkId !== 'default') {
          peerCh.audioEl.setSinkId(this.selectedSinkId).catch(() => {});
        }

        peerCh.audioEl.play().catch(() => {
          if (this.onAudioBlocked) this.onAudioBlocked(true);
        });

        this.attachVoiceAnalyser(remoteId, stream, false);
      }
    }

    setPeerVerifiedP2P(remoteId, isVerified) {
      const peerCh = this.getOrCreatePeerChannel(remoteId);
      if (peerCh.verifiedP2PAudio === isVerified) return;
      peerCh.verifiedP2PAudio = isVerified;

      if (isVerified) {
        peerCh.activeNodes.forEach((n) => {
          try { n.stop(); n.disconnect(); } catch (_) {}
        });
        peerCh.activeNodes.length = 0;
      }
    }

    async setSpeakerOutput(deviceId) {
      this.selectedSinkId = deviceId || 'default';

      if (this.ctx && typeof this.ctx.setSinkId === 'function') {
        try {
          await this.ctx.setSinkId(this.selectedSinkId === 'default' ? '' : this.selectedSinkId);
        } catch (_) {}
      }

      if (this.bluetoothBridgeAudioEl) {
        if (this.isMobileDevice || this.selectedSinkId !== 'default') {
          if (typeof this.bluetoothBridgeAudioEl.setSinkId === 'function' && this.selectedSinkId !== 'default') {
            try { await this.bluetoothBridgeAudioEl.setSinkId(this.selectedSinkId); } catch (_) {}
          }
          this.bluetoothBridgeAudioEl.muted = false;
          this.bluetoothBridgeAudioEl.play().then(() => {
            if (this.directDestinationGain) this.directDestinationGain.gain.value = 0.0;
          }).catch(() => {});
        } else {
          this.bluetoothBridgeAudioEl.muted = true;
          if (this.directDestinationGain) this.directDestinationGain.gain.value = 1.0;
        }
      }

      for (const [, peerCh] of this.peerChannels.entries()) {
        if (peerCh.audioEl && typeof peerCh.audioEl.setSinkId === 'function') {
          try { await peerCh.audioEl.setSinkId(this.selectedSinkId); } catch (_) {}
        }
      }
    }

    removePeer(remoteId) {
      const peerCh = this.peerChannels.get(remoteId);
      if (peerCh) {
        peerCh.activeNodes.forEach((n) => {
          try { n.stop(); n.disconnect(); } catch (_) {}
        });
        if (peerCh.audioEl) peerCh.audioEl.remove();
        try { peerCh.gainNode.disconnect(); } catch (_) {}
        this.peerChannels.delete(remoteId);
      }
      this.analysers.delete(remoteId);
    }

    attachVoiceAnalyser(id, sourceOrStream, isAudioNode = false) {
      try {
        const ctx = this.ensureContext();
        let srcNode = sourceOrStream;
        if (!isAudioNode) {
          if (!sourceOrStream || sourceOrStream.getAudioTracks().length === 0) return;
          srcNode = ctx.createMediaStreamSource(sourceOrStream);
        }

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.76;
        srcNode.connect(analyser);

        this.analysers.set(id, {
          analyser,
          buf: new Uint8Array(analyser.frequencyBinCount),
          holdUntil: 0,
          isLocal: isAudioNode
        });
      } catch (_) {}
    }

    isPeerSpeaking(id) {
      const item = this.analysers.get(id);
      if (this.localMicMuted && item?.isLocal) return false;

      const now = Date.now();
      const peerCh = this.peerChannels.get(id);
      if (peerCh && now < peerCh.quantumSpeakingUntil) return true;

      if (!item) return false;

      item.analyser.getByteFrequencyData(item.buf);
      let sum = 0;
      for (let i = 3; i < 40; i++) sum += item.buf[i];
      if (sum / 37 > 14) {
        item.holdUntil = now + 260;
      }
      return now < item.holdUntil;
    }

    startVadAndSidechainLoop() {
      const tick = () => {
        const activePeerIds = new Set();

        this.analysers.forEach((_, id) => {
          if (this.isPeerSpeaking(id)) activePeerIds.add(id);
        });

        this.peerChannels.forEach((ch, id) => {
          if (Date.now() < ch.quantumSpeakingUntil) activePeerIds.add(id);
        });

        if (this.onVoiceActivity) {
          this.onVoiceActivity(activePeerIds);
        }

        const someoneSpeaking = activePeerIds.size > 0;
        const targetDuck = someoneSpeaking ? this.tuning.sidechainDuckGain : 1.0;
        const speed = someoneSpeaking ? 0.14 : 0.03;
        this.currentDuckFactor += (targetDuck - this.currentDuckFactor) * speed;

        this.musicElements.forEach((el) => {
          const base = el._aetherBaseVol ?? 1.0;
          el.volume = Math.max(0, Math.min(1, base * this.currentDuckFactor));
        });

        this.musicGainNodes.forEach((gNode) => {
          const base = gNode._aetherBaseGain ?? 1.0;
          gNode.gain.value = base * this.currentDuckFactor;
        });

        this.sidechainCallbacks.forEach((cb) => {
          try { cb(this.currentDuckFactor, someoneSpeaking ? -6.0 : 0.0); } catch (_) {}
        });

        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  window.AetherAudioEngine = AetherAudioEngine;
})(window);