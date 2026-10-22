/**
 * ============================================================================
 * AETHER STUDIO DSP & JITTER BUFFER ENGINE (aether_audio.js) - v6.1 HOTFIX
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

      this.TARGET_SAMPLE_RATE = 16000;
      this.JITTER_PREBUFFER_SEC = 0.085;
      this.MAX_LATENCY_DRIFT_SEC = 0.30;

      this.setupLifecycleHandlers();
      this.startVadLoop();
    }

    log(msg) {
      console.log(`%c[AetherAudio v6.1]%c ${msg}`, 'color:#34d399;font-weight:bold;', 'color:#e2e8f0;');
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
      const constraints = {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1
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

        // 1. Фільтр низьких частот (85 Гц) проти гулу кімнати
        const hpf = ctx.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 85;
        hpf.Q.value = 0.707;

        // 2. Еквалайзер присутності голосу (+2.5 дБ на 2.8 кГц)
        const presenceEq = ctx.createBiquadFilter();
        presenceEq.type = 'peaking';
        presenceEq.frequency.value = 2800;
        presenceEq.Q.value = 1.1;
        presenceEq.gain.value = 2.5;

        // 3. Студійний компресор для вирівнювання гучності
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 12;
        compressor.ratio.value = 3.2;
        compressor.attack.value = 0.005;
        compressor.release.value = 0.24;

        // 4. Вихідний підсилювач
        const makeupGain = ctx.createGain();
        makeupGain.gain.value = 1.35;

        const streamDest = ctx.createMediaStreamDestination();

        source.connect(hpf);
        hpf.connect(presenceEq);
        presenceEq.connect(compressor);
        compressor.connect(makeupGain);
        makeupGain.connect(streamDest);

        this.attachVoiceAnalyser(localPeerId, makeupGain, true);

        // 5. Надійний кодувальник Quantum Audio (16 kHz µ-Law з плавним хвостом Hold/Release)
        const scriptNode = ctx.createScriptProcessor(2048, 1, 1);
        const silentSink = ctx.createGain();
        silentSink.gain.value = 0.000001; // Гарантує, що браузер ніколи не зупинить обробку

        let envelope = 0;
        let holdFrames = 0;

        scriptNode.onaudioprocess = (e) => {
          if (this.localMicMuted) return;
          if (typeof shouldSendQuantumCallback === 'function' && !shouldSendQuantumCallback()) return;

          const ch = e.inputBuffer.getChannelData(0);
          let peak = 0;
          for (let i = 0; i < ch.length; i += 2) {
            const abs = Math.abs(ch[i]);
            if (abs > peak) peak = abs;
          }

          envelope = peak > envelope ? peak : envelope * 0.85;

          // Чутливий поріг відкриття з утриманням хвоста фрази (~300 мс)
          if (envelope > 0.0045) {
            holdFrames = 7;
          }

          if (holdFrames > 0) {
            holdFrames--;
            const b64 = this.encodeMuLaw16k(ch, ctx.sampleRate);
            if (b64 && this.onQuantumAudioPacketOut) {
              this.onQuantumAudioPacketOut({
                t: 'A16',
                sr: this.TARGET_SAMPLE_RATE,
                d: b64
              });
            }
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
        this.log('Студійний аудіотракт активний (16 kHz µ-Law + Jitter Buffer).');
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
        const avg = count > 0 ? sum / count : float32Samples[startIdx];
        bytes[i] = AetherAudioEngine.linearToMuLawSample(avg);
      }

      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }

    ingestQuantumAudioPacket(remoteId, pkt) {
      if (!pkt || !pkt.d) return;
      const ctx = this.ensureContext();
      const peerCh = this.getOrCreatePeerChannel(remoteId);

      // Блокуємо Quantum тільки якщо P2P-аудіо РЕАЛЬНО підтверджено мережевою статистикою
      if (peerCh.verifiedP2PAudio) return;

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

        // Косинусний кросфейд на краях пакета для відсутності клацань
        const fadeSamples = Math.min(48, Math.floor(len / 8));
        for (let i = 0; i < fadeSamples; i++) {
          const fade = 0.5 * (1 - Math.cos((Math.PI * i) / fadeSamples));
          channelData[i] *= fade;
          channelData[len - 1 - i] *= fade;
        }

        const now = ctx.currentTime;
        if (!peerCh.nextPlayTime || peerCh.nextPlayTime < now) {
          peerCh.nextPlayTime = now + this.JITTER_PREBUFFER_SEC;
        } else if (peerCh.nextPlayTime - now > this.MAX_LATENCY_DRIFT_SEC) {
          peerCh.nextPlayTime = now + this.JITTER_PREBUFFER_SEC;
        }

        const bufSource = ctx.createBufferSource();
        bufSource.buffer = audioBuf;
        bufSource.connect(peerCh.gainNode);
        bufSource.start(peerCh.nextPlayTime);

        peerCh.nextPlayTime += audioBuf.duration;

        if (sumAbs / len > 0.01) {
          peerCh.quantumSpeakingUntil = Date.now() + Math.round(audioBuf.duration * 1000) + 220;
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
        aud.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
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
      if (sum / 40 > 15) {
        item.holdUntil = now + 260;
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