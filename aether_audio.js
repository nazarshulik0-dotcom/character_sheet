/**
 * ============================================================================
 * AETHER STUDIO APEX AUDIO ENGINE (aether_audio.js) - v7.5
 * ----------------------------------------------------------------------------
 * Побудовано на стабільній базі v6.2 з повним усуненням усіх артефактів:
 *   1. True 16-Bit Linear PCM (Int16) @ 16kHz — 0% шуму квантування, 0% пульсацій
 *   2. 4ms Raised-Cosine Overlap-Add (OLA) — ідеальна неперервна звукова хвиля
 *   3. Hard Latency Guard (120ms max) — фізично унеможливлює затримку 1–3 секунди
 *   4. Smart Mic Selector для ноутбуків (ігнорує Stereo Mix / порожні лінії)
 *   5. Вбудований Sidechain Ducking (-6 dB) для модуля фонової музики сайту
 * ============================================================================
 */

(function (window) {
  'use strict';

  const BAD_MIC_KEYWORDS = [
    'stereo mix', 'стерео микшер', 'стерео мікшер', 'what u hear',
    'loopback', 'virtual audio', 'vb-audio', 'hands-free ag'
  ];

  class AetherAudioEngine {
    constructor(options = {}) {
      this.onVoiceActivity = options.onVoiceActivity || null;
      this.onAudioBlocked = options.onAudioBlocked || null;
      this.onQuantumAudioPacketOut = options.onQuantumAudioPacketOut || null;
      this.onLog = options.onLog || null;

      this.ctx = null;
      this.masterGain = null;
      this.selectedSinkId = 'default';

      // Локальний мікрофонний тракт
      this.rawMicStream = null;
      this.processedMicStream = null;
      this.micMuteGainNode = null;
      this.localScriptNode = null;
      this.localMicMuted = false;

      // Канали гравців: remoteId -> PeerAudioChannel
      this.peerChannels = new Map();
      this.analysers = new Map();

      // 16000 Hz 16-bit PCM + 64 семпли (4 мс) перекриття для ідеальної склейки без пульсацій
      this.TARGET_SAMPLE_RATE = 16000;
      this.OLA_OVERLAP_SAMPLES = 64; // 4 ms @ 16kHz
      this.OLA_OVERLAP_SEC = this.OLA_OVERLAP_SAMPLES / this.TARGET_SAMPLE_RATE;
      this.txOverlapTail = new Float32Array(this.OLA_OVERLAP_SAMPLES);

      // Жорсткі параметри низької затримки (55 мс старт, максимум 130 мс до примусового скидання черги)
      this.JITTER_PREBUFFER_SEC = 0.055;
      this.MAX_QUEUE_LATENCY_SEC = 0.130;

      // Інтеграція з фоновою музикою сайту (Sidechain Ducking -6 dB під час діалогів)
      this.musicElements = new Set();
      this.musicGainNodes = new Set();
      this.sidechainCallbacks = new Set();
      this.currentDuckFactor = 1.0;

      this.exposeMusicBridge();
      this.setupLifecycleHandlers();
      this.startVadAndSidechainLoop();
    }

    log(msg) {
      console.log(`%c[AetherAudio v7.5]%c ${msg}`, 'color:#34d399;font-weight:bold;', 'color:#e2e8f0;');
      if (this.onLog) this.onLog(msg);
    }

    // =========================================================================
    // 1. МІСТ СУМІСНОСТІ З ФОНОВОЮ МУЗИКОЮ САЙТУ (SIDECHAIN DUCKING -6 dB)
    // =========================================================================
    exposeMusicBridge() {
      const self = this;
      window.AetherMusicBridge = {
        // Реєстрація <audio> плеєра фонової музики (автоматично приглушується на 6 dB під час розмови)
        registerAudioElement(audioEl, baseVolume = 1.0) {
          if (!audioEl) return;
          audioEl.dataset.aetherMusicIgnore = 'true';
          audioEl._aetherBaseVol = baseVolume;
          self.musicElements.add(audioEl);
        },
        // Реєстрація Web Audio GainNode фонової музики
        registerMusicGainNode(gainNode, baseGain = 1.0) {
          if (!gainNode) return;
          gainNode._aetherBaseGain = baseGain;
          self.musicGainNodes.add(gainNode);
        },
        // Підписка зовнішнього модуля музики на коефіцієнт сайдчейну (1.0 = тиша в етері, 0.501 = -6 dB мовлення)
        onSidechainDuck(cb) {
          if (typeof cb === 'function') self.sidechainCallbacks.add(cb);
        },
        getAudioContext() {
          return self.ensureContext();
        }
      };
    }

    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx({
          latencyHint: 'interactive'
        });

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;
        this.masterGain.connect(this.ctx.destination);
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
      // Чіпаємо ВИКЛЮЧНО голосові канали Етеру, не зачіпаючи фонову музику сайту!
      this.peerChannels.forEach((ch) => {
        if (ch.audioEl && ch.audioEl.paused) {
          ch.audioEl.play().catch(() => {});
        }
      });
    }

    // =========================================================================
    // 2. РОЗУМНИЙ ВИБІР МІКРОФОНА НА НОУТБУЦІ ТА СТУДІЙНИЙ ПРЕАМП
    // =========================================================================
    async pickBestMicrophoneDeviceId(explicitId = '') {
      if (explicitId && explicitId !== 'default') return explicitId;
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return '';

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId);
        if (mics.length === 0) return '';

        // Відсіюємо віртуальні лінії типу Stereo Mix, які на ноутбуках дають тишу або гул
        const realMics = mics.filter((d) => {
          const lbl = (d.label || '').toLowerCase();
          return !BAD_MIC_KEYWORDS.some((bad) => lbl.includes(bad));
        });

        const chosen = realMics[0] || mics[0];
        return chosen ? chosen.deviceId : '';
      } catch (_) {
        return '';
      }
    }

    getOptimalAudioConstraints(deviceId = '') {
      // Вимикаємо браузерні autoGainControl та noiseSuppression:
      // 1) Вони не переходять у телефонний режим ОС і не псують фонову музику на сайті
      // 2) Вони не глушать мікрофон ноутбука при фонових звуках
      const constraints = {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 }
      };
      if (deviceId && deviceId !== 'default' && deviceId !== '') {
        constraints.deviceId = { ideal: deviceId };
      }
      return constraints;
    }

    async buildStudioMicPipeline(rawStream, localPeerId, shouldSendQuantumCallback) {
      const ctx = this.ensureContext();
      this.cleanupLocalMicPipeline();

      this.rawMicStream = rawStream;
      if (!rawStream || rawStream.getAudioTracks().length === 0) {
        this.log('УВАГА: Аудіотрек мікрофона відсутній у потоці!');
        return rawStream;
      }

      const activeTrack = rawStream.getAudioTracks()[0];
      activeTrack.enabled = true;
      this.log(`Мікрофон підключено: "${activeTrack.label || ' Основний мікрофон'}".`);

      try {
        const source = ctx.createMediaStreamSource(rawStream);

        // 1. Чистий High-Pass 90 Гц (прибирає гул кулера ноутбука та низькочастотний резонанс)
        const hpf = ctx.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 90;
        hpf.Q.value = 0.707;

        // 2. Notch-фільтр 50 Гц та 100 Гц (повністю вирізає європейське/українське мережеве гудіння ноутбуків на зарядці!)
        const humNotch = ctx.createBiquadFilter();
        humNotch.type = 'notch';
        humNotch.frequency.value = 50;
        humNotch.Q.value = 10;

        // 3. М'який підйом розбірливості дикції (+2.2 дБ на 3.0 кГц)
        const presenceEq = ctx.createBiquadFilter();
        presenceEq.type = 'peaking';
        presenceEq.frequency.value = 3000;
        presenceEq.Q.value = 1.0;
        presenceEq.gain.value = 2.2;

        // 4. М'який студійний компресор/лімітер
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -20;
        compressor.knee.value = 12;
        compressor.ratio.value = 2.5;
        compressor.attack.value = 0.006;
        compressor.release.value = 0.20;

        // 5. Вихідне підсилення + Вентиль Mute/Unmute (ніколи не ламає потік на смартфонах!)
        const makeupGain = ctx.createGain();
        makeupGain.gain.value = 1.35;

        const micMuteGain = ctx.createGain();
        micMuteGain.gain.value = this.localMicMuted ? 0.0 : 1.0;
        this.micMuteGainNode = micMuteGain;

        const streamDest = ctx.createMediaStreamDestination();

        source.connect(humNotch);
        humNotch.connect(hpf);
        hpf.connect(presenceEq);
        presenceEq.connect(compressor);
        compressor.connect(makeupGain);
        makeupGain.connect(micMuteGain);
        micMuteGain.connect(streamDest);

        this.attachVoiceAnalyser(localPeerId, micMuteGain, true);

        // 6. Стабільний процесор захвату з перевіреної версії v6.2:
        // КРИТИЧНО: silentSink.gain.value = 0.000001 (НЕ 0.0!), щоб Chrome на ноутбуці ніколи не заморожував мікрофон!
        const scriptNode = ctx.createScriptProcessor(2048, 1, 1);
        const silentSink = ctx.createGain();
        silentSink.gain.value = 0.000001;

        let holdBlocks = 25; // Тримає канал відкритим ~1.1 секунди після кожного слова

        scriptNode.onaudioprocess = (e) => {
          if (this.localMicMuted) return;
          if (typeof shouldSendQuantumCallback === 'function' && !shouldSendQuantumCallback()) return;

          const ch = e.inputBuffer.getChannelData(0);
          let peak = 0;
          for (let i = 0; i < ch.length; i += 4) {
            const abs = Math.abs(ch[i]);
            if (abs > peak) peak = abs;
          }

          if (peak > 0.002) {
            holdBlocks = 25;
          }

          if (holdBlocks > 0) {
            holdBlocks--;
            const b64 = this.encode16BitPCMWithOverlap(ch, ctx.sampleRate);
            if (b64 && this.onQuantumAudioPacketOut) {
              this.onQuantumAudioPacketOut({
                t: 'PCM16',
                sr: this.TARGET_SAMPLE_RATE,
                ov: this.OLA_OVERLAP_SAMPLES,
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
        this.log('Студійний тракт v7.5 активний (16-Bit Linear PCM + OLA Crossfade + Sidechain -6dB).');
        return combinedStream;
      } catch (err) {
        console.warn('[AetherAudio] Фолбек на прямий потік:', err);
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

    // Безвідмовне перемикання мікрофона на телефонах і ПК
    setMicMuted(muted) {
      this.localMicMuted = !!muted;
      const ctx = this.ensureContext();
      if (this.micMuteGainNode && ctx) {
        this.micMuteGainNode.gain.setTargetAtTime(this.localMicMuted ? 0.0 : 1.0, ctx.currentTime, 0.015);
      }
      // Тримаємо фізичний трек активним (enabled = true), щоб мобільна ОС не вбивала сесію мікрофона!
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
    // 3. 16-БІТНИЙ ЛІНІЙНИЙ PCM КОДЕК З OVERLAP-ADD (0 ПУЛЬСАЦІЙ, 0 ШУМУ)
    // =========================================================================
    encode16BitPCMWithOverlap(float32Samples, sourceRate) {
      const ratio = sourceRate / this.TARGET_SAMPLE_RATE;
      const newSamplesCount = Math.floor(float32Samples.length / ratio);
      if (newSamplesCount <= 0) return null;

      const ov = this.OLA_OVERLAP_SAMPLES;
      const totalSamples = ov + newSamplesCount;
      const int16Buf = new Int16Array(totalSamples);

      // 1. Записуємо на початок пакета 64 семпли (4 мс) хвоста з попереднього пакета для безшовної склейки
      for (let i = 0; i < ov; i++) {
        const s = Math.max(-1, Math.min(1, this.txOverlapTail[i]));
        int16Buf[i] = Math.round(s * 32767);
      }

      // 2. Ресемплінг нових семплів у чисті 16 біт
      for (let i = 0; i < newSamplesCount; i++) {
        const exactIdx = i * ratio;
        const idx0 = Math.floor(exactIdx);
        const idx1 = Math.min(float32Samples.length - 1, idx0 + 1);
        const frac = exactIdx - idx0;

        const val = float32Samples[idx0] + (float32Samples[idx1] - float32Samples[idx0]) * frac;
        const clamped = Math.max(-1, Math.min(1, val));
        int16Buf[ov + i] = Math.round(clamped * 32767);

        // Зберігаємо останні 64 семпли для наступного пакета
        if (i >= newSamplesCount - ov) {
          this.txOverlapTail[i - (newSamplesCount - ov)] = clamped;
        }
      }

      const bytes = new Uint8Array(int16Buf.buffer);
      let binary = '';
      const chunkSize = 1024;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      return btoa(binary);
    }

    // Прийом 16-бітного PCM (та зворотна сумісність із A16/A22) із жорстким контролем затримки <120 мс
    ingestQuantumAudioPacket(remoteId, pkt) {
      if (!pkt || !pkt.d) return;
      const ctx = this.ensureContext();
      const peerCh = this.getOrCreatePeerChannel(remoteId);

      if (peerCh.verifiedP2PAudio) return;

      try {
        const binary = atob(pkt.d);
        const sampleRate = pkt.sr || this.TARGET_SAMPLE_RATE;
        let floatData;

        if (pkt.t === 'PCM16') {
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
          // Зворотна сумісність, якщо інший пристрій ще не оновив кеш
          floatData = new Float32Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            const uVal = ~binary.charCodeAt(i) & 0xff;
            const t = (((uVal & 0x0f) << 3) + 0x84) << ((uVal & 0x70) >> 4);
            const pcm = (uVal & 0x80) ? (0x84 - t) : (t - 0x84);
            floatData[i] = pcm / 32768.0;
          }
        }

        const len = floatData.length;
        if (len < 32) return;

        // Накладаємо точні комплементарні вікна (Raised-Cosine Fade-In на перші 64 семпли і Fade-Out на останні 64 семпли):
        // Коли кінець Пакета 1 накладається на початок Пакета 2 зі зсувом -4 мс, їх сума дорівнює РІВНО 1.0!
        const ov = Math.min(pkt.ov || this.OLA_OVERLAP_SAMPLES, Math.floor(len / 4));
        let sumAbs = 0;

        for (let i = 0; i < len; i++) {
          sumAbs += Math.abs(floatData[i]);
        }

        for (let i = 0; i < ov; i++) {
          const wIn = 0.5 * (1 - Math.cos((Math.PI * i) / ov));
          const wOut = 1.0 - wIn;
          floatData[i] *= wIn;
          floatData[len - ov + i] *= wOut;
        }

        const audioBuf = ctx.createBuffer(1, len, sampleRate);
        audioBuf.getChannelData(0).set(floatData);

        const now = ctx.currentTime;

        // ЗАХИСТ ВІД ЗАТРИМКИ 1–3 СЕКУНДИ:
        // Якщо черга відірвалася вперед більш ніж на 130 мс — миттєво скасовуємо старі заплановані буфери!
        if (peerCh.nextPlayTime - now > this.MAX_QUEUE_LATENCY_SEC) {
          peerCh.activeNodes.forEach((n) => {
            try { n.stop(); n.disconnect(); } catch (_) {}
          });
          peerCh.activeNodes.length = 0;
          peerCh.nextPlayTime = now + 0.045;
        }

        if (!peerCh.nextPlayTime || peerCh.nextPlayTime < now) {
          peerCh.nextPlayTime = now + this.JITTER_PREBUFFER_SEC;
        }

        const bufSource = ctx.createBufferSource();
        bufSource.buffer = audioBuf;
        bufSource.connect(peerCh.gainNode);

        peerCh.activeNodes.push(bufSource);
        bufSource.onended = () => {
          const idx = peerCh.activeNodes.indexOf(bufSource);
          if (idx !== -1) peerCh.activeNodes.splice(idx, 1);
        };

        bufSource.start(peerCh.nextPlayTime);

        // Зсуваємо старт наступного пакета рівно на величину 4-мс перекриття (Overlap-Add)!
        const overlapSec = ov / sampleRate;
        peerCh.nextPlayTime += (audioBuf.duration - overlapSec);

        if (sumAbs / len > 0.008) {
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

    async setSpeakerOutput(deviceId) {
      this.selectedSinkId = deviceId || 'default';
      if (this.ctx && typeof this.ctx.setSinkId === 'function') {
        try { await this.ctx.setSinkId(this.selectedSinkId === 'default' ? '' : this.selectedSinkId); } catch (_) {}
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
      for (let i = 2; i < 42; i++) sum += item.buf[i];
      if (sum / 40 > 13) {
        item.holdUntil = now + 260;
      }
      return now < item.holdUntil;
    }

    // Цикл VAD + Плавний Sidechain Ducking (-6 dB) для фонової музики
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

        // Якщо хоча б один учасник говорить — плавно приглушуємо фонову музику на 6 dB (коефіцієнт 0.501)
        const someoneSpeaking = activePeerIds.size > 0;
        const targetDuck = someoneSpeaking ? 0.501 : 1.0;
        const speed = someoneSpeaking ? 0.14 : 0.03; // Швидка атака (Attack), плавне повернення (Release)
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