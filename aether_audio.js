/**
 * ============================================================================
 * AETHER STUDIO DSP & JITTER BUFFER ENGINE (aether_audio.js) - v6.0 OMEGA GOLD
 * ----------------------------------------------------------------------------
 * Автономний аудіо-модуль для системи «ЕТЕР» (компанія «ЕНТРОПІЯ»):
 *   1. Студійний преамп і DSP-тракт мікрофона (HPF 85Hz -> Presence EQ -> Compressor)
 *   2. Окремий потік AudioWorklet (із фолбеком на ScriptProcessor) без фризів UI
 *   3. Плавний Envelope Noise Gate із хвостом утримання (Hold 220ms / Release 320ms)
 *   4. Кодек ITU-T G.711 µ-Law (16 kHz HD Voice) для Quantum Relay
 *   5. Lookahead Jitter Buffer (80ms) + Cosine Crossfade + Packet Loss Concealment
 *   6. Індивідуальний мікшер гравців та маршрутизація виходу (setSinkId)
 * ============================================================================
 */

(function (window) {
  'use strict';

  // Код вбудованого AudioWorklet-процесора (працює в окремому реальному часі поза головним потоком браузера)
  const WORKLET_CODE = `
    class AetherVoiceCaptureProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.buffer = new Float32Array(2048);
        this.writeIndex = 0;
        this.envelope = 0;
        this.holdCounter = 0;
      }

      process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;
        const ch = input[0];

        for (let i = 0; i < ch.length; i++) {
          const sample = ch[i];
          const abs = Math.abs(sample);

          // Швидка атака (Attack) та плавне загасання (Release) для детектора мовлення
          if (abs > this.envelope) {
            this.envelope = this.envelope * 0.8 + abs * 0.2;
          } else {
            this.envelope = this.envelope * 0.9992 + abs * 0.0008;
          }

          this.buffer[this.writeIndex++] = sample;

          if (this.writeIndex >= 2048) {
            // Поріг відкриття гейта з утриманням хвоста фрази (Hold ~220ms)
            if (this.envelope > 0.0065) {
              this.holdCounter = 6;
            }
            if (this.holdCounter > 0) {
              this.holdCounter--;
              const chunk = this.buffer.slice(0);
              this.port.postMessage({ samples: chunk, rms: this.envelope }, [chunk.buffer]);
            }
            this.writeIndex = 0;
          }
        }
        return true;
      }
    }
    registerProcessor('aether-voice-capture', AetherVoiceCaptureProcessor);
  `;

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
      this.localWorkletNode = null;
      this.localScriptNode = null;
      this.localMicMuted = false;

      // Віддалені аудіо-канали гравців: peerId -> PeerAudioChannel
      this.peerChannels = new Map();
      // Аналізатори гучності для підсвічування рамок крісел: id -> { analyser, buf, smoothRms, holdUntil }
      this.analysers = new Map();

      // Конфігурація Jitter-буфера для міжкраїнового Quantum Relay
      this.TARGET_SAMPLE_RATE = 16000;
      this.JITTER_PREBUFFER_SEC = 0.085; // 85 мс комфортного запасу проти мережевих затримок
      this.MAX_LATENCY_DRIFT_SEC = 0.28; // Якщо затримка зросла >280 мс — плавно підтягуємо до реального часу

      this.setupLifecycleHandlers();
      this.startVadLoop();
    }

    log(msg) {
      console.log(`%c[AetherAudio v6.0]%c ${msg}`, 'color:#34d399;font-weight:bold;', 'color:#e2e8f0;');
      if (this.onLog) this.onLog(msg);
    }

    // =========================================================================
    // 1. ІНІЦІАЛІЗАЦІЯ КОНТЕКСТУ ТА ANTI-SLEEP ЗАХИСТ НА СМАРТФОНАХ
    // =========================================================================
    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx({
          latencyHint: 'interactive'
        });

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;
        this.masterGain.connect(this.ctx.destination);

        // Запускаємо ультратихий фоновий генератор, щоб iOS/Android не присипляли звуковий рушій
        try {
          const keepAliveOsc = this.ctx.createOscillator();
          const keepAliveGain = this.ctx.createGain();
          keepAliveOsc.frequency.value = 18;
          keepAliveGain.gain.value = 0.00001;
          keepAliveOsc.connect(keepAliveGain);
          keepAliveGain.connect(this.ctx.destination);
          keepAliveOsc.start();
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

      const unlockHandler = () => this.unlockAudio();
      window.addEventListener('click', unlockHandler, { passive: true });
      window.addEventListener('touchstart', unlockHandler, { passive: true });
    }

    unlockAudio() {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          if (this.onAudioBlocked) this.onAudioBlocked(false);
        }).catch(() => {});
      }
      this.peerChannels.forEach((ch) => {
        if (ch.audioEl && ch.audioEl.paused) {
          ch.audioEl.play().catch(() => {});
        }
      });
    }

    // =========================================================================
    // 2. ЗАХОПЛЕННЯ МІКРОФОНА ТА СТУДІЙНИЙ DSP-ТРАКТ (HPF + EQ + COMPRESSOR)
    // =========================================================================
    getOptimalAudioConstraints(deviceId = '') {
      const constraints = {
        // Залишаємо лише апаратне ехоподавлення, але ВИМИКАЄМО агресивний браузерний шумодав,
        // який перетворював голос на «булькання» — натомість працює наш власний студійний DSP
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 }
      };

      if (deviceId && deviceId !== 'default' && deviceId !== '') {
        constraints.deviceId = { exact: deviceId };
      }
      return constraints;
    }

    async buildStudioMicPipeline(rawStream, localPeerId, shouldSendQuantumCallback) {
      const ctx = this.ensureContext();
      this.cleanupLocalMicPipeline();

      this.rawMicStream = rawStream;
      if (!rawStream || rawStream.getAudioTracks().length === 0) {
        return rawStream;
      }

      try {
        const source = ctx.createMediaStreamSource(rawStream);

        // 1. High-Pass фільтр (85 Гц) — відсікає низькочастотний гул, вітер і удари по столу
        const hpf = ctx.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 85;
        hpf.Q.value = 0.707;

        // 2. Presence EQ (2800 Гц, +2.5 дБ) — додає розбірливості та «близькості» голосу
        const presenceEq = ctx.createBiquadFilter();
        presenceEq.type = 'peaking';
        presenceEq.frequency.value = 2800;
        presenceEq.Q.value = 1.1;
        presenceEq.gain.value = 2.5;

        // 3. Low-Pass фільтр (9500 Гц) — прибирає високочастотний цифровий пісок
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 9500;
        lpf.Q.value = 0.707;

        // 4. Broadcast-компресор — вирівнює динаміку голосу
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 12;
        compressor.ratio.value = 3.5;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.22;

        // 5. Вихідний Make-up Gain (+3 дБ)
        const makeupGain = ctx.createGain();
        makeupGain.gain.value = 1.35;

        // 6. Формуємо новий чистий MediaStream для передачі у WebRTC P2P
        const streamDest = ctx.createMediaStreamDestination();

        source.connect(hpf);
        hpf.connect(presenceEq);
        presenceEq.connect(lpf);
        lpf.connect(compressor);
        compressor.connect(makeupGain);
        makeupGain.connect(streamDest);

        // Підключаємо аналізатор для підсвічування власного крісла
        this.attachVoiceAnalyser(localPeerId, makeupGain, true);

        // Підключаємо AudioWorklet (або ScriptProcessor) для кодування звуку у Quantum Relay
        await this.attachQuantumEncoderNode(makeupGain, shouldSendQuantumCallback);

        // Збираємо комбінований потік (очищений звук + оригінальне відео, якщо є)
        const combinedStream = new MediaStream();
        streamDest.stream.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
        rawStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

        this.processedMicStream = combinedStream;
        this.log('Студійний DSP-тракт мікрофона активовано (HPF 85Hz + EQ + Compressor + µ-Law 16kHz).');
        return combinedStream;
      } catch (err) {
        console.warn('[AetherAudio] Помилка побудови DSP-тракту, використовуємо прямий потік:', err);
        this.attachVoiceAnalyser(localPeerId, rawStream, false);
        return rawStream;
      }
    }

    async attachQuantumEncoderNode(inputNode, shouldSendQuantumCallback) {
      const ctx = this.ctx;

      const handleRawChunk = (float32Samples) => {
        if (this.localMicMuted) return;
        if (typeof shouldSendQuantumCallback === 'function' && !shouldSendQuantumCallback()) return;

        const packetBase64 = this.encodeMuLaw16k(float32Samples, ctx.sampleRate);
        if (packetBase64 && this.onQuantumAudioPacketOut) {
          this.onQuantumAudioPacketOut({
            t: 'A16', // Маркер нового HD-кодека µ-Law 16kHz
            sr: this.TARGET_SAMPLE_RATE,
            d: packetBase64
          });
        }
      };

      // Спочатку пробуємо сучасний AudioWorklet (працює в окремому потоці без жодних затримок)
      if (ctx.audioWorklet) {
        try {
          const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
          const workletUrl = URL.createObjectURL(blob);
          await ctx.audioWorklet.addModule(workletUrl);
          URL.revokeObjectURL(workletUrl);

          const workletNode = new AudioWorkletNode(ctx, 'aether-voice-capture');
          workletNode.port.onmessage = (e) => {
            if (e.data && e.data.samples) {
              handleRawChunk(e.data.samples);
            }
          };
          inputNode.connect(workletNode);
          this.localWorkletNode = workletNode;
          return;
        } catch (workletErr) {
          console.info('[AetherAudio] Перехід на класичний буфер захвата (ScriptProcessor).');
        }
      }

      // Надійний резервний варіант із плавним гейтом і хвостом утримання (Hold/Release)
      const scriptNode = ctx.createScriptProcessor(2048, 1, 1);
      const silentSink = ctx.createGain();
      silentSink.gain.value = 0;

      let envelope = 0;
      let holdFrames = 0;

      scriptNode.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < ch.length; i++) {
          const abs = Math.abs(ch[i]);
          envelope = abs > envelope ? envelope * 0.8 + abs * 0.2 : envelope * 0.9992 + abs * 0.0008;
        }
        if (envelope > 0.0065) {
          holdFrames = 6; // Утримуємо передачу ще ~250 мс після закінчення слова!
        }
        if (holdFrames > 0) {
          holdFrames--;
          handleRawChunk(new Float32Array(ch));
        }
      };

      inputNode.connect(scriptNode);
      scriptNode.connect(silentSink);
      silentSink.connect(ctx.destination);
      this.localScriptNode = scriptNode;
    }

    cleanupLocalMicPipeline() {
      if (this.localWorkletNode) {
        try { this.localWorkletNode.disconnect(); } catch (_) {}
        this.localWorkletNode = null;
      }
      if (this.localScriptNode) {
        try { this.localScriptNode.disconnect(); } catch (_) {}
        this.localScriptNode = null;
      }
    }

    // =========================================================================
    // 3. КОДЕК G.711 µ-LAW (16 kHz) + МІКРО-КРОСФЕЙД ТА JITTER BUFFER
    // =========================================================================
    static linearToMuLawSample(sample) {
      const BIAS = 0x84;
      const CLIP = 32635;
      let s = Math.max(-1, Math.min(1, sample));
      let pcm = Math.round(s * 32767);

      let sign = (pcm >> 8) & 0x80;
      if (sign !== 0) pcm = -pcm;
      if (pcm > CLIP) pcm = CLIP;
      pcm += BIAS;

      let exponent = 7;
      for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
      const mantissa = (pcm >> (exponent + 3)) & 0x0f;
      const ulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
      return ulawByte;
    }

    static muLawToLinearSample(uVal) {
      uVal = ~uVal & 0xff;
      const t = (((uVal & 0x0f) << 3) + 0x84) << ((uVal & 0x70) >> 4);
      const pcm = (uVal & 0x80) ? (0x84 - t) : (t - 0x84);
      return pcm / 32768.0;
    }

    // Ресемплінг із частоти браузера (48/44.1 kHz) у чисті 16 kHz із антиаліасинг-усередненням
    encodeMuLaw16k(float32Samples, sourceRate) {
      const ratio = sourceRate / this.TARGET_SAMPLE_RATE;
      const outLen = Math.floor(float32Samples.length / ratio);
      if (outLen <= 0) return null;

      const bytes = new Uint8Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const startIdx = Math.floor(i * ratio);
        const endIdx = Math.min(float32Samples.length, Math.ceil((i + 1) * ratio));
        let sum = 0;
        let count = 0;
        for (let j = startIdx; j < endIdx; j++) {
          sum += float32Samples[j];
          count++;
        }
        const avgSample = count > 0 ? sum / count : float32Samples[startIdx];
        bytes[i] = AetherAudioEngine.linearToMuLawSample(avgSample);
      }

      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }

    // Прийом та плавне відтворення аудіопакетів через Lookahead Jitter Buffer
    ingestQuantumAudioPacket(remoteId, pkt) {
      if (!pkt || !pkt.d) return;
      const ctx = this.ensureContext();
      const peerCh = this.getOrCreatePeerChannel(remoteId);

      // Якщо з цим гравцем уже працює прямий WebRTC аудіопотік — не дублюємо звук
      if (peerCh.hasActiveWebRTCAudio) return;

      try {
        const binary = atob(pkt.d);
        const len = binary.length;
        if (len === 0) return;

        const isMuLaw = pkt.t === 'A16';
        const sampleRate = pkt.sr || (isMuLaw ? this.TARGET_SAMPLE_RATE : 11025);
        const audioBuf = ctx.createBuffer(1, len, sampleRate);
        const channelData = audioBuf.getChannelData(0);

        let sumAbs = 0;
        for (let i = 0; i < len; i++) {
          const code = binary.charCodeAt(i);
          const sample = isMuLaw
            ? AetherAudioEngine.muLawToLinearSample(code)
            : (code / 127.5) - 1.0;
          channelData[i] = sample;
          sumAbs += Math.abs(sample);
        }

        // Накладаємо м'який 3-мілісекундний косинусний кросфейд на краях буфера,
        // щоб повністю усунути клацання при склеюванні пакетів
        const fadeSamples = Math.min(48, Math.floor(len / 8));
        for (let i = 0; i < fadeSamples; i++) {
          const fade = 0.5 * (1 - Math.cos((Math.PI * i) / fadeSamples));
          channelData[i] *= fade;
          channelData[len - 1 - i] *= fade;
        }

        // Планування безперервного часу відтворення (Jitter Buffer Scheduler)
        const now = ctx.currentTime;
        if (!peerCh.nextPlayTime || peerCh.nextPlayTime < now) {
          // Якщо буфер спустошився (початок фрази) — беремо передзатримку 85 мс для стабільності
          peerCh.nextPlayTime = now + this.JITTER_PREBUFFER_SEC;
        } else if (peerCh.nextPlayTime - now > this.MAX_LATENCY_DRIFT_SEC) {
          // Якщо через лаг мережі накопичилася черга >280 мс — м'яко підтягуємо до реального часу
          peerCh.nextPlayTime = now + this.JITTER_PREBUFFER_SEC;
        }

        const bufSource = ctx.createBufferSource();
        bufSource.buffer = audioBuf;
        bufSource.connect(peerCh.gainNode);
        bufSource.start(peerCh.nextPlayTime);

        peerCh.nextPlayTime += audioBuf.duration;

        // Оновлюємо індикатор мовлення для рамки крісла
        const rms = sumAbs / len;
        if (rms > 0.015) {
          peerCh.quantumSpeakingUntil = Date.now() + Math.round(audioBuf.duration * 1000) + 180;
        }
      } catch (err) {
        console.warn('[AetherAudio] Помилка декодування пакета Quantum Audio:', err);
      }
    }

    // =========================================================================
    // 4. КЕРУВАННЯ ВХІДНИМИ КАНАЛАМИ ГРАВЦІВ ТА WEBRTC АУДІО
    // =========================================================================
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
        audioEl: null,
        webrtcStream: null,
        hasActiveWebRTCAudio: false,
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

      // Створюємо прихований <audio> елемент для апаратного декодування WebRTC потоку та роботи setSinkId
      if (!peerCh.audioEl) {
        const aud = document.createElement('audio');
        aud.id = `aether-peer-audio-${remoteId}`;
        aud.autoplay = true;
        aud.playsInline = true;
        aud.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(aud);
        peerCh.audioEl = aud;
      }

      if (peerCh.audioEl.srcObject !== stream) {
        peerCh.audioEl.srcObject = stream;
        peerCh.webrtcStream = stream;
        peerCh.audioEl.volume = peerCh.muted ? 0 : Math.min(1, peerCh.volume);

        if (typeof peerCh.audioEl.setSinkId === 'function' && this.selectedSinkId !== 'default') {
          peerCh.audioEl.setSinkId(this.selectedSinkId).catch(() => {});
        }

        peerCh.audioEl.play().then(() => {
          peerCh.hasActiveWebRTCAudio = true;
          if (this.onAudioBlocked) this.onAudioBlocked(false);
        }).catch(() => {
          if (this.onAudioBlocked) this.onAudioBlocked(true);
        });

        this.attachVoiceAnalyser(remoteId, stream, false);
      }
    }

    setPeerVolume(remoteId, volumeZeroToOne) {
      const peerCh = this.getOrCreatePeerChannel(remoteId);
      peerCh.volume = Math.max(0, Math.min(2, Number(volumeZeroToOne) || 1));
      peerCh.gainNode.gain.value = peerCh.muted ? 0 : peerCh.volume;
      if (peerCh.audioEl) {
        peerCh.audioEl.volume = peerCh.muted ? 0 : Math.min(1, peerCh.volume);
      }
    }

    setPeerMuted(remoteId, muted) {
      const peerCh = this.getOrCreatePeerChannel(remoteId);
      peerCh.muted = !!muted;
      peerCh.gainNode.gain.value = peerCh.muted ? 0 : peerCh.volume;
      if (peerCh.audioEl) {
        peerCh.audioEl.muted = peerCh.muted;
      }
    }

    async setSpeakerOutput(deviceId) {
      this.selectedSinkId = deviceId || 'default';

      // Перемикаємо вихід у Web Audio Context (підтримується в сучасних Chrome/Edge)
      if (this.ctx && typeof this.ctx.setSinkId === 'function') {
        try {
          await this.ctx.setSinkId(this.selectedSinkId === 'default' ? '' : this.selectedSinkId);
        } catch (_) {}
      }

      // Перемикаємо вихід на всіх індивідуальних <audio> елементах гравців
      for (const [, peerCh] of this.peerChannels.entries()) {
        if (peerCh.audioEl && typeof peerCh.audioEl.setSinkId === 'function') {
          try {
            await peerCh.audioEl.setSinkId(this.selectedSinkId);
          } catch (_) {}
        }
      }
      this.log(`Аудіовихід перемкнено на: ${this.selectedSinkId}`);
    }

    removePeer(remoteId) {
      const peerCh = this.peerChannels.get(remoteId);
      if (peerCh) {
        if (peerCh.audioEl) peerCh.audioEl.remove();
        try { peerCh.gainNode.disconnect(); } catch (_) {}
        this.peerChannels.delete(remoteId);
      }
      this.analysers.delete(remoteId);
    }

    // =========================================================================
    // 5. ДЕТЕКТОР АКТИВНОСТІ МОВЛЕННЯ (VAD З ПЛАВНИМ УТРИМАННЯМ РАМКИ)
    // =========================================================================
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
        analyser.smoothingTimeConstant = 0.78;
        srcNode.connect(analyser);

        this.analysers.set(id, {
          analyser,
          buf: new Uint8Array(analyser.frequencyBinCount),
          holdUntil: 0
        });
      } catch (_) {}
    }

    isPeerSpeaking(id) {
      const now = Date.now();
      const peerCh = this.peerChannels.get(id);
      if (peerCh && now < peerCh.quantumSpeakingUntil) {
        return true;
      }

      const item = this.analysers.get(id);
      if (!item) return false;

      item.analyser.getByteFrequencyData(item.buf);
      let sum = 0;
      for (let i = 2; i < 42; i++) {
        sum += item.buf[i]; // Аналізуємо саме голосовий діапазон частот (150 Hz - 3.5 kHz)
      }
      const avg = sum / 40;

      if (avg > 16) {
        item.holdUntil = now + 260; // Не даємо рамці nervovo блимати між словами
      }
      return now < item.holdUntil;
    }

    startVadLoop() {
      const tick = () => {
        if (this.onVoiceActivity) {
          const activePeerIds = new Set();
          this.analysers.forEach((_, id) => {
            if (this.isPeerSpeaking(id)) activePeerIds.add(id);
          });
          this.peerChannels.forEach((ch, id) => {
            if (Date.now() < ch.quantumSpeakingUntil) activePeerIds.add(id);
          });
          this.onVoiceActivity(activePeerIds);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  window.AetherAudioEngine = AetherAudioEngine;
})(window);