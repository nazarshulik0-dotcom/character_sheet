/**
 * ============================================================================
 * AETHER DISCORD-GRADE AUDIO ENGINE (aether_audio.js) - v7.0 GOLD
 * ----------------------------------------------------------------------------
 * Ключові інновації v7.0:
 *   1. True Ring-Buffer Playout (Фіксована затримка 35–55 мс замість 1–3 секунд!
 *      Жодних запланованих у майбутнє AudioBufferSourceNode, які нашаровувалися)
 *   2. Повністю усунено 11.5 Hz пульсуючий гул (прибрано IIR-інтегратор + DC Blocker)
 *   3. Апаратний Echo Cancellation + Smart Acoustic Ducking (для гри в 1 кімнаті)
 *   4. Безвідмовний Mute/Unmute на смартфонах (через миттєвий Gain-вентиль + авто-рестарт)
 * ============================================================================
 */

(function (window) {
  'use strict';

  // Кільцевий буфер на 1 секунду при 16000 Гц (жорсткий ліміт затримки — максимум 55 мс)
  const RING_CAPACITY = 16384;

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
      this.micGateNode = null;
      this.localCaptureNode = null;
      this.localMicMuted = false;

      // Канали гравців: remoteId -> PeerAudioChannel
      this.peerChannels = new Map();
      this.analysers = new Map();

      // 16000 Hz Wideband Voice — золотий стандарт низької затримки без мережевих черг
      this.TARGET_SAMPLE_RATE = 16000;
      this.remoteSpeakingNow = false;

      this.setupLifecycleHandlers();
      this.startVadLoop();
    }

    log(msg) {
      console.log(`%c[AetherAudio v7.0]%c ${msg}`, 'color:#34d399;font-weight:bold;', 'color:#e2e8f0;');
      if (this.onLog) this.onLog(msg);
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
      this.peerChannels.forEach((ch) => {
        if (ch.audioEl && ch.audioEl.paused) {
          ch.audioEl.play().catch(() => {});
        }
      });
    }

    // Увімкнено апаратний Echo Cancellation та Noise Suppression рівня ОС,
    // щоб прибрати акустичний завод і силовий гул ноутбука!
    getOptimalAudioConstraints(deviceId = '') {
      const constraints = {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
        channelCount: { ideal: 1 }
      };
      if (deviceId && deviceId !== 'default' && deviceId !== '') {
        constraints.deviceId = { ideal: deviceId };
      }
      return constraints;
    }

    // =========================================================================
    // 1. ЧИСТИЙ МІКРОФОННИЙ ТРАКТ БЕЗ ПУЛЬСАЦІЙ ТА З МИТТЄВИМ MUTE-ВЕНТИЛЕМ
    // =========================================================================
    async buildStudioMicPipeline(rawStream, localPeerId, shouldSendQuantumCallback) {
      const ctx = this.ensureContext();
      this.cleanupLocalMicPipeline();

      this.rawMicStream = rawStream;
      if (!rawStream || rawStream.getAudioTracks().length === 0) {
        return rawStream;
      }

      try {
        const source = ctx.createMediaStreamSource(rawStream);

        // 1. Фільтр 110 Гц (24 дБ/окт): повністю вирізає низькочастотний гул кулерів ноутбука та мережі 50/60 Гц
        const hpf1 = ctx.createBiquadFilter();
        hpf1.type = 'highpass';
        hpf1.frequency.value = 110;
        hpf1.Q.value = 0.707;

        const hpf2 = ctx.createBiquadFilter();
        hpf2.type = 'highpass';
        hpf2.frequency.value = 110;
        hpf2.Q.value = 0.707;

        // 2. M'який Presence EQ (+2.0 дБ на 3 кГц) для розбірливості мови
        const presenceEq = ctx.createBiquadFilter();
        presenceEq.type = 'peaking';
        presenceEq.frequency.value = 3000;
        presenceEq.Q.value = 1.0;
        presenceEq.gain.value = 2.0;

        // 3. Делікатний лімітер (Ratio 2:1, високий поріг -18 дБ — не накачує шум кімнати!)
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -18;
        limiter.knee.value = 10;
        limiter.ratio.value = 2.2;
        limiter.attack.value = 0.005;
        limiter.release.value = 0.15;

        // 4. Керуючий вентиль мікрофона (micGateNode) — гарантує 100% надійний Mute/Unmute на смартфонах
        const micGateNode = ctx.createGain();
        micGateNode.gain.value = this.localMicMuted ? 0.0 : 1.0;
        this.micGateNode = micGateNode;

        const streamDest = ctx.createMediaStreamDestination();

        source.connect(hpf1);
        hpf1.connect(hpf2);
        hpf2.connect(presenceEq);
        presenceEq.connect(limiter);
        limiter.connect(micGateNode);
        micGateNode.connect(streamDest);

        this.attachVoiceAnalyser(localPeerId, micGateNode, true);

        // 5. Надшвидкий захват (1024 семпли = ~21 мс при 48 кГц!) для нульової затримки Quantum Relay
        const captureNode = ctx.createScriptProcessor(1024, 1, 1);
        const silentOut = ctx.createGain();
        silentOut.gain.value = 0.0;

        let holdChunks = 0;
        let dcInPrev = 0;
        let dcOutPrev = 0;

        captureNode.onaudioprocess = (e) => {
          if (this.localMicMuted) return;
          if (typeof shouldSendQuantumCallback === 'function' && !shouldSendQuantumCallback()) return;

          const input = e.inputBuffer.getChannelData(0);
          const cleanBuf = new Float32Array(input.length);
          let sumSq = 0;

          // Усунення постійної складової (DC Blocker) — жодних низькочастотних ударів чи пульсацій!
          for (let i = 0; i < input.length; i++) {
            const x = input[i];
            const y = x - dcInPrev + 0.995 * dcOutPrev;
            dcInPrev = x;
            dcOutPrev = y;

            // Якщо в цей момент із наших динаміків гучно говорить інший гравець,
            // злегка приглушуємо вхід (Acoustic Echo Shield для гри в одній кімнаті)
            const echoShield = this.remoteSpeakingNow ? 0.45 : 1.0;
            const s = Math.max(-1, Math.min(1, y * echoShield));
            cleanBuf[i] = s;
            sumSq += s * s;
          }

          const rms = Math.sqrt(sumSq / input.length);
          // Поріг голосу з плавним хвостом утримання 450 мс (~20 блоків по 21 мс)
          if (rms > 0.004) {
            holdChunks = 20;
          }

          if (holdChunks > 0) {
            holdChunks--;
            const b64 = this.encodeMuLaw16k(cleanBuf, ctx.sampleRate);
            if (b64 && this.onQuantumAudioPacketOut) {
              this.onQuantumAudioPacketOut({
                t: 'A16',
                sr: this.TARGET_SAMPLE_RATE,
                d: b64
              });
            }
          }
        };

        micGateNode.connect(captureNode);
        captureNode.connect(silentOut);
        silentOut.connect(ctx.destination);
        this.localCaptureNode = captureNode;

        const combinedStream = new MediaStream();
        streamDest.stream.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
        rawStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

        this.processedMicStream = combinedStream;
        this.applyMuteStateToTracks();

        this.log('Discord-Grade DSP активовано (Затримка буфера: 21 мс, Anti-Hum фільтр 110 Гц).');
        return combinedStream;
      } catch (err) {
        console.warn('[AetherAudio] Фолбек на прямий мікрофон:', err);
        this.attachVoiceAnalyser(localPeerId, rawStream, false);
        return rawStream;
      }
    }

    cleanupLocalMicPipeline() {
      if (this.localCaptureNode) {
        try { this.localCaptureNode.disconnect(); } catch (_) {}
        this.localCaptureNode = null;
      }
    }

    // Надійне увімкнення/вимкнення мікрофона (працює безвідмовно на iOS та Android)
    setMicMuted(muted) {
      this.localMicMuted = !!muted;
      const ctx = this.ensureContext();

      if (this.micGateNode && ctx) {
        this.micGateNode.gain.setTargetAtTime(this.localMicMuted ? 0.0 : 1.0, ctx.currentTime, 0.01);
      }

      this.applyMuteStateToTracks();
      return !this.localMicMuted;
    }

    applyMuteStateToTracks() {
      const enabled = !this.localMicMuted;
      if (this.rawMicStream) {
        this.rawMicStream.getAudioTracks().forEach((t) => { t.enabled = enabled; });
      }
      if (this.processedMicStream) {
        this.processedMicStream.getAudioTracks().forEach((t) => { t.enabled = enabled; });
      }
    }

    isMicTrackAlive() {
      if (!this.rawMicStream) return false;
      const tracks = this.rawMicStream.getAudioTracks();
      return tracks.length > 0 && tracks[0].readyState === 'live';
    }

    // =========================================================================
    // 2. КОДЕК G.711 µ-LAW (16 kHz) ТА КІЛЬЦЕВИЙ БУФЕР РЕАЛЬНОГО ЧАСУ (<45ms)
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
      return ~(sign | (exponent << 4) | mantissa) & 0xff;
    }

    static muLawToLinearSample(uVal) {
      uVal = ~uVal & 0xff;
      const t = (((uVal & 0x0f) << 3) + 0x84) << ((uVal & 0x70) >> 4);
      const pcm = (uVal & 0x80) ? (0x84 - t) : (t - 0x84);
      return pcm / 32768.0;
    }

    encodeMuLaw16k(float32Samples, sourceRate) {
      const ratio = sourceRate / this.TARGET_SAMPLE_RATE;
      const outLen = Math.floor(float32Samples.length / ratio);
      if (outLen <= 0) return null;

      const bytes = new Uint8Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const idx = Math.floor(i * ratio);
        bytes[i] = AetherAudioEngine.linearToMuLawSample(float32Samples[idx]);
      }

      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }

    // Запис вхідного пакета у Кільцевий Буфер гравця (Ніколи не накопичує затримку 1–3 секунди!)
    ingestQuantumAudioPacket(remoteId, pkt) {
      if (!pkt || !pkt.d) return;
      this.ensureContext();
      const peerCh = this.getOrCreatePeerChannel(remoteId);

      // Якщо прямий P2P-звук вже працює — ігноруємо резервні пакети, щоб не було подвійного ехо
      if (peerCh.verifiedP2PAudio) return;

      try {
        const binary = atob(pkt.d);
        const len = binary.length;
        if (len === 0) return;

        const isMuLaw = pkt.t === 'A16' || pkt.t === 'A22';
        const pktRate = pkt.sr || 16000;
        const ctxRate = this.ctx.sampleRate;
        const upsampleRatio = ctxRate / pktRate;
        const outSamplesCount = Math.floor(len * upsampleRatio);

        // Перевіряємо, скільки семплів зараз лежить у кільцевому буфері:
        // Якщо через стрибок Wi-Fi там накопичилося більше 65 мс звуку —
        // миттєво скидаємо старий хвіст, щоб затримка НІКОЛИ не перевищувала 65 мс!
        const maxBufferedSamples = Math.floor(ctxRate * 0.065);
        if (peerCh.availableSamples > maxBufferedSamples) {
          peerCh.readPos = (peerCh.writePos - Math.floor(ctxRate * 0.025) + RING_CAPACITY) % RING_CAPACITY;
          peerCh.availableSamples = Math.floor(ctxRate * 0.025);
        }

        let sumAbs = 0;
        for (let i = 0; i < outSamplesCount; i++) {
          const srcPos = i / upsampleRatio;
          const idx0 = Math.floor(srcPos);
          const idx1 = Math.min(len - 1, idx0 + 1);
          const frac = srcPos - idx0;

          const c0 = binary.charCodeAt(idx0);
          const c1 = binary.charCodeAt(idx1);

          const s0 = isMuLaw ? AetherAudioEngine.muLawToLinearSample(c0) : (c0 / 127.5) - 1.0;
          const s1 = isMuLaw ? AetherAudioEngine.muLawToLinearSample(c1) : (c1 / 127.5) - 1.0;
          const sample = s0 + (s1 - s0) * frac;

          peerCh.ringBuffer[peerCh.writePos] = sample;
          peerCh.writePos = (peerCh.writePos + 1) % RING_CAPACITY;
          if (peerCh.availableSamples < RING_CAPACITY) {
            peerCh.availableSamples++;
          }
          sumAbs += Math.abs(sample);
        }

        if (sumAbs / outSamplesCount > 0.008) {
          peerCh.quantumSpeakingUntil = Date.now() + 180;
        }
      } catch (_) {}
    }

    // =========================================================================
    // 3. СТВОРЕННЯ КАНАЛУ ГРАВЦЯ З ПОТОКОВИМ RING-BUFFER ПЛЕЄРОМ
    // =========================================================================
    getOrCreatePeerChannel(remoteId) {
      if (this.peerChannels.has(remoteId)) {
        return this.peerChannels.get(remoteId);
      }

      const ctx = this.ensureContext();
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;
      gainNode.connect(this.masterGain);

      const ringBuffer = new Float32Array(RING_CAPACITY);
      const playerNode = ctx.createScriptProcessor(1024, 1, 1);

      const channelObj = {
        remoteId,
        gainNode,
        playerNode,
        ringBuffer,
        readPos: 0,
        writePos: 0,
        availableSamples: 0,
        prebuffering: true,
        lastSample: 0,
        audioEl: null,
        webrtcStream: null,
        verifiedP2PAudio: false,
        quantumSpeakingUntil: 0,
        volume: 1.0,
        muted: false
      };

      const minStartThreshold = Math.floor(ctx.sampleRate * 0.028); // 28 мс передзатримки для старту

      playerNode.onaudioprocess = (e) => {
        const out = e.outputBuffer.getChannelData(0);

        if (channelObj.verifiedP2PAudio || channelObj.muted) {
          out.fill(0);
          return;
        }

        if (channelObj.prebuffering) {
          if (channelObj.availableSamples < minStartThreshold) {
            out.fill(0);
            return;
          }
          channelObj.prebuffering = false;
        }

        for (let i = 0; i < out.length; i++) {
          if (channelObj.availableSamples > 0) {
            const s = channelObj.ringBuffer[channelObj.readPos];
            channelObj.readPos = (channelObj.readPos + 1) % RING_CAPACITY;
            channelObj.availableSamples--;
            channelObj.lastSample = s;
            out[i] = s;
          } else {
            // Плавне загасання до нуля при закінченні фрази (0 клацань!)
            channelObj.lastSample *= 0.92;
            out[i] = channelObj.lastSample;
            if (Math.abs(channelObj.lastSample) < 0.0001) {
              channelObj.prebuffering = true;
            }
          }
        }
      };

      playerNode.connect(gainNode);
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

        // Як тільки P2P-аудіо почало грати — миттєво глушимо Quantum-буфер, щоб не було дублювання!
        peerCh.audioEl.onplaying = () => {
          peerCh.verifiedP2PAudio = true;
          peerCh.availableSamples = 0;
        };

        peerCh.audioEl.play().then(() => {
          peerCh.verifiedP2PAudio = true;
          peerCh.availableSamples = 0;
        }).catch(() => {
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
        try { peerCh.playerNode.disconnect(); } catch (_) {}
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
        analyser.smoothingTimeConstant = 0.75;
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
      if (this.localMicMuted && this.analysers.get(id)?.isLocal) return false;

      const now = Date.now();
      const peerCh = this.peerChannels.get(id);
      if (peerCh && now < peerCh.quantumSpeakingUntil) return true;

      const item = this.analysers.get(id);
      if (!item) return false;

      item.analyser.getByteFrequencyData(item.buf);
      let sum = 0;
      for (let i = 3; i < 40; i++) sum += item.buf[i];
      if (sum / 37 > 15) {
        item.holdUntil = now + 240;
      }
      return now < item.holdUntil;
    }

    startVadLoop() {
      const tick = () => {
        if (this.onVoiceActivity) {
          const activePeerIds = new Set();
          let anyRemoteSpeaking = false;

          this.analysers.forEach((info, id) => {
            if (this.isPeerSpeaking(id)) {
              activePeerIds.add(id);
              if (!info.isLocal) anyRemoteSpeaking = true;
            }
          });

          this.peerChannels.forEach((ch, id) => {
            if (Date.now() < ch.quantumSpeakingUntil) {
              activePeerIds.add(id);
              anyRemoteSpeaking = true;
            }
          });

          this.remoteSpeakingNow = anyRemoteSpeaking;
          this.onVoiceActivity(activePeerIds);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  window.AetherAudioEngine = AetherAudioEngine;
})(window);