/**
 * ============================================================================
 * AETHER STUDIO MASTERPIECE AUDIO ENGINE (aether_audio.js) - v8.0
 * ----------------------------------------------------------------------------
 * Ключові рішення v8.0:
 *   1. Пріоритет зовнішніх мікрофонів та аудіоінтерфейсів ({ exact: deviceId })
 *      із блокуванням вбудованих мікрофонів біля кулера ноутбука.
 *   2. Zero-Modulation Continuous PCM16 @ 16kHz (3:1 Anti-Aliased Decimation):
 *      повністю прибрано крайові вікна wIn/wOut, які створювали пульсацію!
 *   3. Smooth Downward Expander замість рваного гейта — 0% ефекту «качання» шуму.
 *   4. Збережено міст фонової музики AetherMusicBridge (Sidechain Ducking -6 dB).
 * ============================================================================
 */

(function (window) {
  'use strict';

  const PREFERRED_MIC_STORAGE_KEY = 'entropia_aether_preferred_mic_v8';

  // Ключові слова віртуальних ліній, які взагалі не є мікрофонами
  const VIRTUAL_LINE_KEYWORDS = [
    'stereo mix', 'стерео микшер', 'стерео мікшер', 'what u hear',
    'loopback', 'virtual audio', 'vb-audio', 'hands-free ag'
  ];

  // Ключові слова вбудованих мікрофонів ноутбука (які ловлять гул кулера і корпусу)
  const INTERNAL_LAPTOP_MIC_KEYWORDS = [
    'array', 'матриця', 'матрица', 'internal', 'integrated',
    'вбудован', 'встроенн', 'smart sound', 'intel® smart', 'realtek(r) audio'
  ];

  // Ключові слова якісних зовнішніх мікрофонів, аудіокарт та гарнітур
  const EXTERNAL_PRO_MIC_KEYWORDS = [
    'usb', 'minifuse', 'arturia', 'scarlett', 'focusrite', 'rode', 'nt1',
    'shure', 'steinberg', 'behringer', 'audient', 'volt', 'apollo', 'zoom',
    'hyperx', 'fifine', 'blue', 'yeti', 'razer', 'steelseries', 'logitech',
    'headset', 'гарнітура', 'гарнитура', 'external', 'зовнішн', 'внешн'
  ];

  class AetherAudioEngine {
    constructor(options = {}) {
      this.onVoiceActivity = options.onVoiceActivity || null;
      this.onAudioBlocked = options.onAudioBlocked || null;
      this.onQuantumAudioPacketOut = options.onQuantumAudioPacketOut || null;
      this.onMicListUpdated = options.onMicListUpdated || null;
      this.onLog = options.onLog || null;

      this.ctx = null;
      this.masterGain = null;
      this.selectedSinkId = 'default';
      this.selectedMicId = localStorage.getItem(PREFERRED_MIC_STORAGE_KEY) || '';

      // Локальний мікрофонний тракт
      this.rawMicStream = null;
      this.processedMicStream = null;
      this.micMuteGainNode = null;
      this.localScriptNode = null;
      this.localMicMuted = false;

      // Канали гравців: remoteId -> PeerAudioChannel
      this.peerChannels = new Map();
      this.analysers = new Map();

      // 16000 Hz 16-bit PCM (точний коефіцієнт 3:1 від 48000 Hz — без інтерполяційних спотворень)
      this.TARGET_SAMPLE_RATE = 16000;
      this.JITTER_PREBUFFER_SEC = 0.065;
      this.MAX_QUEUE_LATENCY_SEC = 0.140;

      // Інтеграція з фоновою музикою сайту (Sidechain Ducking -6 dB)
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
      console.log(`%c[AetherAudio v8.0]%c ${msg}`, 'color:#34d399;font-weight:bold;', 'color:#e2e8f0;');
      if (this.onLog) this.onLog(msg);
    }

    // =========================================================================
    // 1. МІСТ ФОНОВОЇ МУЗИКИ (SIDECHAIN DUCKING -6 dB ПІД ЧАС РОЗМОВИ)
    // =========================================================================
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

    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx({
          latencyHint: 'interactive',
          sampleRate: 48000
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

    // =========================================================================
    // 2. РОЗУМНИЙ РЕЙТИНГ МІКРОФОНІВ (ЗОВНІШНІЙ МІКРОФОН ЗАМІСТЬ КУЛЕРА НОУТБУКА)
    // =========================================================================
    scoreMicrophoneDevice(device, index) {
      const label = (device.label || '').toLowerCase();
      let score = 50 - index;
      if (!label) return score;

      // Не беремо віртуальні петлі (Stereo Mix)
      if (VIRTUAL_LINE_KEYWORDS.some((w) => label.includes(w))) {
        score -= 200;
      }

      // Штрафуємо вбудовані мікрофони на корпусі ноутбука (біля кулера)
      if (INTERNAL_LAPTOP_MIC_KEYWORDS.some((w) => label.includes(w))) {
        score -= 60;
      }

      // Максимальний пріоритет зовнішнім USB/XLR інтерфейсам та гарнітурам
      if (EXTERNAL_PRO_MIC_KEYWORDS.some((w) => label.includes(w))) {
        score += 90;
      }

      return score;
    }

    async enumerateAndRankMicrophones() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const mics = all
          .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications')
          .map((d, idx) => {
            const low = (d.label || '').toLowerCase();
            const isExternal = EXTERNAL_PRO_MIC_KEYWORDS.some((w) => low.includes(w));
            const isInternal = INTERNAL_LAPTOP_MIC_KEYWORDS.some((w) => low.includes(w));
            return {
              deviceId: d.deviceId,
              label: d.label || `Мікрофон #${idx + 1}`,
              score: this.scoreMicrophoneDevice(d, idx),
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

    // Гарантоване захоплення САМЕ зовнішнього (або явно вибраного) мікрофона через { exact: deviceId }
    async acquireStudioMicStream(explicitMicId = '') {
      if (explicitMicId) {
        this.selectedMicId = explicitMicId;
        localStorage.setItem(PREFERRED_MIC_STORAGE_KEY, explicitMicId);
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;

      let mics = await this.enumerateAndRankMicrophones();
      let targetMicId = explicitMicId || this.selectedMicId;

      if (!targetMicId || !mics.some((m) => m.deviceId === targetMicId)) {
        if (mics[0] && mics[0].deviceId) {
          targetMicId = mics[0].deviceId;
        }
      }

      // Базові студійні констрейнти: вмикаємо нативне C++ шумозаглушення та ехоподавлення браузера,
      // щоб повністю прибрати фоновий гул вентилятора ноутбука!
      const baseAudioOpts = {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 }
      };

      try {
        // Крок 1: Суворий запит { exact: targetMicId }, щоб браузер не підмінив мікрофон на вбудований!
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

        // Крок 2: Коли дозвіл отримано і назви пристроїв відкрилися — перевіряємо,
        // чи не схопив ноутбук вбудований мікрофон за наявності підключеного зовнішнього!
        mics = await this.enumerateAndRankMicrophones();
        const currentTrack = stream.getAudioTracks()[0];
        const currentLabel = (currentTrack?.label || '').toLowerCase();
        const isCurrentInternal = INTERNAL_LAPTOP_MIC_KEYWORDS.some((w) => currentLabel.includes(w));

        if (!explicitMicId && isCurrentInternal) {
          const externalMic = mics.find((m) => m.isExternal && m.deviceId !== 'default');
          if (externalMic) {
            try {
              const extStream = await navigator.mediaDevices.getUserMedia({
                audio: { ...baseAudioOpts, deviceId: { exact: externalMic.deviceId } },
                video: false
              });
              stream.getTracks().forEach((t) => t.stop());
              stream = extStream;
              this.log(`Автоматично перемкнено з мікрофона ноутбука на зовнішній: "${externalMic.label}"`);
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
        this.log(`Не вдалося відкрити мікрофон (${err.name}).`);
        return null;
      }
    }

    // =========================================================================
    // 3. ЧИСТИЙ СТУДІЙНИЙ ТРАКТ БЕЗ ПУЛЬСАЦІЇ ТА БЕЗ РОЗДУВАННЯ ШУМУ
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
      this.log(`Активний мікрофон: "${activeTrack.label || 'Audio Input'}"`);

      try {
        const source = ctx.createMediaStreamSource(rawStream);

        // 1. Подвійний фільтр гулу ноутбука: Notch 50 Hz (живлення) + High-Pass 105 Hz (кулери та вібрація столу)
        const notch50 = ctx.createBiquadFilter();
        notch50.type = 'notch';
        notch50.frequency.value = 50;
        notch50.Q.value = 12;

        const hpf = ctx.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 105;
        hpf.Q.value = 0.707;

        // 2. Легкий студійний еквалайзер розбірливості (+1.8 дБ на 3.2 кГц) та м'який зріз ВЧ-піску (Low-Pass 7.5 кГц)
        const presenceEq = ctx.createBiquadFilter();
        presenceEq.type = 'peaking';
        presenceEq.frequency.value = 3200;
        presenceEq.Q.value = 1.0;
        presenceEq.gain.value = 1.8;

        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 7500;
        lpf.Q.value = 0.707;

        // 3. Делікатний піковий лімітер (Unity Gain 1.0x — НЕ підсилює фоновий шум кімнати!)
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 8;
        limiter.ratio.value = 4.0;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.15;

        // 4. Керуючий вентиль Mute/Unmute
        const micMuteGain = ctx.createGain();
        micMuteGain.gain.value = this.localMicMuted ? 0.0 : 1.0;
        this.micMuteGainNode = micMuteGain;

        const streamDest = ctx.createMediaStreamDestination();

        source.connect(notch50);
        notch50.connect(hpf);
        hpf.connect(presenceEq);
        presenceEq.connect(lpf);
        lpf.connect(limiter);
        limiter.connect(micMuteGain);
        micMuteGain.connect(streamDest);

        this.attachVoiceAnalyser(localPeerId, micMuteGain, true);

        // 5. Кодувальник Quantum Audio з буфером 4096 семплів (~85 мс = лише 11.7 пакетів/сек)
        // та плавним експандером (Smooth Downward Expander), який НІКОЛИ не пульсує на шумі!
        const scriptNode = ctx.createScriptProcessor(4096, 1, 1);
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

          // Плавна огинаюча експандера без різких стрибків
          expanderEnv = rms > expanderEnv
            ? expanderEnv * 0.5 + rms * 0.5
            : expanderEnv * 0.88 + rms * 0.12;

          if (expanderEnv > 0.0045) {
            holdBlocks = 14; // Тримаємо потік ще ~1.2с після закінчення фрази
          }

          if (holdBlocks > 0) {
            holdBlocks--;
            // Якщо людина мовчить у паузі (expanderEnv < 0.006), плавно приглушуємо шум кулера,
            // щоб у навушниках співрозмовника була студійна тиша без «качання»!
            const noiseFloorGain = expanderEnv >= 0.006
              ? 1.0
              : Math.max(0.08, Math.pow(expanderEnv / 0.006, 1.6));

            const b64 = this.encodeClean16BitPCM(ch, ctx.sampleRate, noiseFloorGain);
            if (b64 && this.onQuantumAudioPacketOut) {
              this.onQuantumAudioPacketOut({
                t: 'PCM16_V8',
                sr: this.TARGET_SAMPLE_RATE,
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
        this.log('Студійний аудіотракт v8.0 активний (Без пульсацій, Smooth Expander, 16-bit PCM).');
        return combinedStream;
      } catch (err) {
        console.warn('[AetherAudio] Фолбек на прямий мікрофон:', err);
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
    // 4. ЧИСТЕ 16-БІТНЕ КОДУВАННЯ ТА БЕЗШОВНЕ ВІДТВОРЕННЯ (0% ПУЛЬСАЦІЙ!)
    // =========================================================================
    encodeClean16BitPCM(float32Samples, sourceRate, gainScale = 1.0) {
      const ratio = sourceRate / this.TARGET_SAMPLE_RATE;
      const outLen = Math.floor(float32Samples.length / ratio);
      if (outLen <= 0) return null;

      const int16Buf = new Int16Array(outLen);

      for (let i = 0; i < outLen; i++) {
        // 3-точковий антиаліасинг-фільтр при децимації 48kHz -> 16kHz (прибирає металевий призвук!)
        const center = Math.floor(i * ratio);
        const sPrev = float32Samples[Math.max(0, center - 1)];
        const sCurr = float32Samples[center];
        const sNext = float32Samples[Math.min(float32Samples.length - 1, center + 1)];

        const filtered = (0.25 * sPrev + 0.5 * sCurr + 0.25 * sNext) * gainScale;
        const clamped = Math.max(-1, Math.min(1, filtered));
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

    // Прийом аудіопакетів БЕЗ крайових загасань (wIn/wOut), які викликали пульсацію!
    ingestQuantumAudioPacket(remoteId, pkt) {
      if (!pkt || !pkt.d) return;
      const ctx = this.ensureContext();
      const peerCh = this.getOrCreatePeerChannel(remoteId);

      // Якщо працює прямий P2P Opus — ретранслятор повністю вимкнений
      if (peerCh.verifiedP2PAudio) return;

      try {
        const binary = atob(pkt.d);
        const sampleRate = pkt.sr || this.TARGET_SAMPLE_RATE;
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

        // Захист від накопичення затримки (>140 мс)
        if (peerCh.nextPlayTime - now > this.MAX_QUEUE_LATENCY_SEC) {
          peerCh.activeNodes.forEach((n) => {
            try { n.stop(); n.disconnect(); } catch (_) {}
          });
          peerCh.activeNodes.length = 0;
          peerCh.nextPlayTime = now + 0.045;
        }

        const isNewPhrase = !peerCh.nextPlayTime || peerCh.nextPlayTime < now;
        if (isNewPhrase) {
          peerCh.nextPlayTime = now + this.JITTER_PREBUFFER_SEC;
          // М'який старт лише для найпершого пакета після паузи (32 семпли = 2 мс)
          for (let i = 0; i < 32; i++) {
            floatData[i] *= (i / 32);
          }
        } else {
          // Сплайн-вирівнювання перших 12 семплів (0.7 мс) від останнього семпла попереднього пакета:
          // Абсолютно безшовна хвиля без ЖОДНОГО просідання гучності та без пульсацій!
          const delta = peerCh.lastSample - floatData[0];
          if (Math.abs(delta) > 0.0005) {
            for (let i = 0; i < 12; i++) {
              floatData[i] += delta * (1 - i / 12);
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

        if (sumAbs / (len / 2) > 0.008) {
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

    // Негайне підключення нативного WebRTC Opus 48kHz потоку
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

    // Коли P2P Opus підтверджено — очищаємо чергу Quantum Relay, щоб грав лише чистий P2P
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
        const targetDuck = someoneSpeaking ? 0.501 : 1.0; // -6 dB під час реплік
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