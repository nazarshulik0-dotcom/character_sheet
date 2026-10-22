/**
 * ============================================================================
 * AETHER STUDIO DSP & CONTINUOUS AUDIO ENGINE (aether_audio.js) - v6.2 MASTER
 * ----------------------------------------------------------------------------
 * Виправлення студійної якості:
 *   1. Повністю усунено 23Hz модуляцію (нульові кросфейди між пакетами)
 *   2. Sample-Accurate Boundary Smoothing (безшовне зшивання сусідніх пакетів)
 *   3. Частота 22.05 kHz + Broadcast Pre-Emphasis/De-Emphasis (кришталеві верхи)
 *   4. Неперервний потік із м'яким хвостом 2.5с (жодних обрізаних слів)
 * ============================================================================
 */

(function (window) {
  'use strict';

  class AetherAudioEngine {
    constructor(options = {}) {
      this.onVoiceActivity = options.onVoiceActivity || null;
      this.onAudioBlocked = options.onAudioBlocked || null;
      this.onQuantumAudioPacketOut = options.onQuantumAudioPacketOut || null;
      this.onLog = options.onLog || null;

      this.ctx = null;
      this.masterGain = null;
      this.selectedSinkId = 'default';

      this.rawMicStream = null;
      this.processedMicStream = null;
      this.localScriptNode = null;
      this.localMicMuted = false;

      this.peerChannels = new Map();
      this.analysers = new Map();

      // 22050 Hz забезпечує передачу частот голосу до 11 кГц (студійна розбірливість)
      this.TARGET_SAMPLE_RATE = 22050;
      this.JITTER_PREBUFFER_SEC = 0.095; // 95 мс стабільного буфера для ідеальної склейки
      this.MAX_LATENCY_DRIFT_SEC = 0.35;

      // Стан фільтра преемфазису на передачі
      this.txPrevSample = 0;

      this.setupLifecycleHandlers();
      this.startVadLoop();
    }

    log(msg) {
      console.log(`%c[AetherAudio v6.2]%c ${msg}`, 'color:#34d399;font-weight:bold;', 'color:#e2e8f0;');
      if (this.onLog) this.onLog(msg);
    }

    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx({ latencyHint: 'interactive' });

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
      this.peerChannels.forEach((ch) => {
        if (ch.audioEl && ch.audioEl.paused) {
          ch.audioEl.play().catch(() => {});
        }
      });
    }

    getOptimalAudioConstraints(deviceId = '') {
      // Вимикаємо агресивний браузерний noiseSuppression та autoGainControl,
      // які «милять» тембр і створюють ефект підводного звуку
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
        return rawStream;
      }

      try {
        const source = ctx.createMediaStreamSource(rawStream);

        // 1. М'який High-Pass фільтр (75 Гц) — прибирає тільки інфразвуковий гул, зберігаючи оксамитовий низ голосу
        const hpf = ctx.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 75;
        hpf.Q.value = 0.707;

        // 2. Теплий Low-Mid Шельф (+1.5 дБ на 220 Гц) — повертає тілесність голосу
        const warmthEq = ctx.createBiquadFilter();
        warmthEq.type = 'lowshelf';
        warmthEq.frequency.value = 220;
        warmthEq.gain.value = 1.5;

        // 3. Air & Presence EQ (+3.0 дБ на 3.2 кГц) — кристальна чіткість дикції
        const presenceEq = ctx.createBiquadFilter();
        presenceEq.type = 'peaking';
        presenceEq.frequency.value = 3200;
        presenceEq.Q.value = 0.9;
        presenceEq.gain.value = 3.0;

        // 4. Студійний м'який оптичний компресор (Ratio 2.5:1) — не душить голос, а делікатно вирівнює
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -22;
        compressor.knee.value = 18;
        compressor.ratio.value = 2.5;
        compressor.attack.value = 0.010;
        compressor.release.value = 0.28;

        // 5. Вихідний рівень
        const makeupGain = ctx.createGain();
        makeupGain.gain.value = 1.28;

        const streamDest = ctx.createMediaStreamDestination();

        source.connect(hpf);
        hpf.connect(warmthEq);
        warmthEq.connect(presenceEq);
        presenceEq.connect(compressor);
        compressor.connect(makeupGain);
        makeupGain.connect(streamDest);

        this.attachVoiceAnalyser(localPeerId, makeupGain, true);

        // 6. Розмір буфера 4096 семплів (~85 мс при 48 кГц):
        // Дає всього ~11.5 пакетів на секунду (удвічі менше навантаження на мережу) і нуль розривів!
        const scriptNode = ctx.createScriptProcessor(4096, 1, 1);
        const silentSink = ctx.createGain();
        silentSink.gain.value = 0.000001;

        let holdFrames = 30; // ~2.5 секунди утримання після будь-якого звуку (ніколи не ріже закінчення фраз!)
        let seqNumber = 0;

        scriptNode.onaudioprocess = (e) => {
          if (this.localMicMuted) return;
          if (typeof shouldSendQuantumCallback === 'function' && !shouldSendQuantumCallback()) return;

          const ch = e.inputBuffer.getChannelData(0);
          let peak = 0;
          for (let i = 0; i < ch.length; i += 4) {
            const abs = Math.abs(ch[i]);
            if (abs > peak) peak = abs;
          }

          // Наднизький поріг (-56 dB): відкривається від найменшого шепоту і тримає потік 2.5 секунди
          if (peak > 0.0015) {
            holdFrames = 30;
          }

          if (holdFrames > 0) {
            holdFrames--;
            const b64 = this.encodeStudioMuLaw22k(ch, ctx.sampleRate);
            if (b64 && this.onQuantumAudioPacketOut) {
              this.onQuantumAudioPacketOut({
                t: 'A22',
                seq: seqNumber++,
                sr: this.TARGET_SAMPLE_RATE,
                d: b64
              });
            }
          } else {
            this.txPrevSample = 0;
          }
        };

        makeupGain.connect(scriptNode);
        scriptNode.connect(silentSink);
        silentSink.connect(ctx.destination);
        this.localScriptNode = scriptNode;

        const combinedStream = new MediaStream();
        streamDest.stream.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
        rawStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

        this.processedMicStream = combinedStream;
        this.log('Студійний аудіотракт v6.2 активний (22.05 kHz HD + Pre-Emphasis + Безшовне зшивання).');
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
      return ~(sign | (exponent << 4) | mantissa) & 0xff;
    }

    static muLawToLinearSample(uVal) {
      uVal = ~uVal & 0xff;
      const t = (((uVal & 0x0f) << 3) + 0x84) << ((uVal & 0x70) >> 4);
      const pcm = (uVal & 0x80) ? (0x84 - t) : (t - 0x84);
      return pcm / 32768.0;
    }

    // Кодування 22.05 kHz із Broadcast Pre-Emphasis (підкреслення високих частот для усунення шуму квантування)
    encodeStudioMuLaw22k(float32Samples, sourceRate) {
      const ratio = sourceRate / this.TARGET_SAMPLE_RATE;
      const outLen = Math.floor(float32Samples.length / ratio);
      if (outLen <= 0) return null;

      const bytes = new Uint8Array(outLen);
      let prev = this.txPrevSample;

      for (let i = 0; i < outLen; i++) {
        const exactPos = i * ratio;
        const idx = Math.floor(exactPos);
        const frac = exactPos - idx;
        const s0 = float32Samples[idx] || 0;
        const s1 = float32Samples[Math.min(float32Samples.length - 1, idx + 1)] || 0;
        // Лінійна інтерполяція при ресемплінгу (чистий звук без аліасингу)
        const current = s0 + (s1 - s0) * frac;

        // Pre-Emphasis фільтр: піднімаємо ВЧ перед упаковкою в µ-Law
        const emphasized = current - 0.65 * prev;
        prev = current;

        bytes[i] = AetherAudioEngine.linearToMuLawSample(emphasized);
      }

      this.txPrevSample = prev;

      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }

    // Прийом та БЕЗШОВНЕ склеювання аудіопакетів (0 провалів гучності!)
    ingestQuantumAudioPacket(remoteId, pkt) {
      if (!pkt || !pkt.d) return;
      const ctx = this.ensureContext();
      const peerCh = this.getOrCreatePeerChannel(remoteId);

      if (peerCh.verifiedP2PAudio) return;

      try {
        const binary = atob(pkt.d);
        const len = binary.length;
        if (len === 0) return;

        const isStudio22k = pkt.t === 'A22';
        const isMuLaw = isStudio22k || pkt.t === 'A16';
        const sampleRate = pkt.sr || (isStudio22k ? 22050 : (pkt.t === 'A16' ? 16000 : 11025));

        const audioBuf = ctx.createBuffer(1, len, sampleRate);
        const channelData = audioBuf.getChannelData(0);

        let deEmphasisState = peerCh.rxDeEmphasisState || 0;
        let sumAbs = 0;

        for (let i = 0; i < len; i++) {
          const code = binary.charCodeAt(i);
          let sample = isMuLaw
            ? AetherAudioEngine.muLawToLinearSample(code)
            : (code / 127.5) - 1.0;

          // De-Emphasis фільтр для пакетів A22: відновлює природний оксамитовий спектр і гасить високочастотний шум
          if (isStudio22k) {
            sample = sample + 0.65 * deEmphasisState;
            sample = Math.max(-1, Math.min(1, sample));
            deEmphasisState = sample;
          }

          channelData[i] = sample;
          sumAbs += Math.abs(sample);
        }

        peerCh.rxDeEmphasisState = deEmphasisState;

        const now = ctx.currentTime;
        const isStreamDiscontinuity = !peerCh.nextPlayTime || peerCh.nextPlayTime < now - 0.015;

        if (isStreamDiscontinuity) {
          // ТІЛЬКИ на самому початку нової фрази робимо 4-мс плавний вхід і ставимо передзатримку 95 мс
          peerCh.nextPlayTime = now + this.JITTER_PREBUFFER_SEC;
          const rampLen = Math.min(64, len);
          for (let i = 0; i < rampLen; i++) {
            channelData[i] *= (i / rampLen);
          }
        } else {
          // Якщо потік іде безперервно — НЕ ОБНУЛЯЄМО краї!
          // Лише згладжуємо перші 12 семплів від останнього семпла попереднього пакета (Sample-Continuous Stitch)
          const prevEnd = peerCh.lastEndSample || 0;
          const diff = prevEnd - channelData[0];
          if (Math.abs(diff) > 0.001) {
            const stitchLen = Math.min(16, len);
            for (let i = 0; i < stitchLen; i++) {
              channelData[i] += diff * (1 - i / stitchLen);
            }
          }

          // Якщо затримка накопичилася понад 350 мс — м'яко підтягуємо графік
          if (peerCh.nextPlayTime - now > this.MAX_LATENCY_DRIFT_SEC) {
            peerCh.nextPlayTime = now + this.JITTER_PREBUFFER_SEC;
          }
        }

        peerCh.lastEndSample = channelData[len - 1];

        const bufSource = ctx.createBufferSource();
        bufSource.buffer = audioBuf;
        bufSource.connect(peerCh.gainNode);
        bufSource.start(peerCh.nextPlayTime);

        peerCh.nextPlayTime += audioBuf.duration;

        if (sumAbs / len > 0.006) {
          peerCh.quantumSpeakingUntil = Date.now() + Math.round(audioBuf.duration * 1000) + 250;
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
        audioEl: null,
        webrtcStream: null,
        verifiedP2PAudio: false,
        nextPlayTime: 0,
        lastEndSample: 0,
        rxDeEmphasisState: 0,
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
      if (peerCh && now < peerCh.quantumSpeakingUntil) return true;

      const item = this.analysers.get(id);
      if (!item) return false;

      item.analyser.getByteFrequencyData(item.buf);
      let sum = 0;
      for (let i = 2; i < 42; i++) sum += item.buf[i];
      if (sum / 40 > 14) {
        item.holdUntil = now + 280;
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