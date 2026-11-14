/**
 * ============================================================================
 * UNIVERSAL IRMINSUL VOICE CORE v4.0 (./voice/raphael_voice_core.js)
 *  1) Стягує 10-вимірний вектор ДНК голосу з репозиторію NRI_IRMINSUL.
 *  2) Паралельно (Promise.any) завантажує чисту звукову хвилю через
 *     прямі JSON-канали Lingva Audio API та шлюзи client=gtx (за 0.3 сек).
 *  3) Перековує тембр у реальному часі через Rust WASM (process_voice_dsp)
 *     та 6-смугову формантну матрицю ДНК Ірмінсуля.
 * ============================================================================
 */

export class RaphaelVoiceCore {
  constructor(options = {}) {
    this.wasmEngine = null;
    this.audioCtx = null;
    this.activeSource = null;

    this.irminsulRepo = 'nazarshulik0-dotcom/NRI_IRMINSUL';
    this.irminsulBranch = options.irminsulBranch || 'main';

    this.currentProfile = {
      id: 'raphael_archangel_1',
      title: 'Рафаїль // Вежа Архангела I (Apex Matrix)',
      carrier_voice: 'uk-UA-OstapNeural',
      pitch_ratio: 0.90,
      dna_vector: [114.5, 4.2, 2.6, -2.1, 3.4, 2.1, -1.5, 0.22, 0.36, 1.32],
      samples: {}
    };

    this.sampleBank = new Map();
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onLog = options.onLog || (() => {});

    window.addEventListener('storage', (e) => {
      if (e.key === 'entropia_irminsul_active_voice' && e.newValue) {
        try {
          const prof = JSON.parse(e.newValue);
          this.applyVoiceProfile(prof);
          this.onLog(
            'ІРМІНСУЛЬ [LIVE SYNC]',
            `🧬 Профіль «${prof.title}» миттєво підхоплено з сусідньої вкладки Ірмінсуля!`,
            'ai'
          );
        } catch (_) {}
      }
    });
  }

  attachRustWasm(wasmEngineInstance) {
    this.wasmEngine = wasmEngineInstance;
    if (this.wasmEngine && typeof this.wasmEngine.load_voice_dna === 'function') {
      this.wasmEngine.load_voice_dna(new Float32Array(this.currentProfile.dna_vector));
    }
    this.onStatusChange(`🦀 DNA: ${this.currentProfile.id}`);
  }

  ensureAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  stop() {
    if (this.activeSource) {
      try { this.activeSource.stop(); } catch (_) {}
      this.activeSource = null;
    }
    if (this.wasmEngine) {
      this.wasmEngine.set_voice_energy(0.0);
      this.wasmEngine.set_activity_mode(0);
    }
    this.onStatusChange(`🧬 ${this.currentProfile.id}`);
  }

  /**
   * Стягує голосовий профіль із репозиторію NRI_IRMINSUL.
   */
  async pullProfileFromIrminsul(profileId = 'raphael_archangel_1') {
    const bust = `?t=${Date.now()}`;
    const candidateUrls = [
      `https://raw.githubusercontent.com/${this.irminsulRepo}/${this.irminsulBranch}/voices/irminsul_voice_bank.json${bust}`,
      `https://raw.githubusercontent.com/${this.irminsulRepo}/${this.irminsulBranch}/irminsul_voice_bank.json${bust}`,
      `https://raw.githubusercontent.com/${this.irminsulRepo}/${this.irminsulBranch}/irminsul/voices/irminsul_voice_bank.json${bust}`,
      `https://nazarshulik0-dotcom.github.io/NRI_IRMINSUL/voices/irminsul_voice_bank.json${bust}`,
      `https://nazarshulik0-dotcom.github.io/NRI_IRMINSUL/irminsul_voice_bank.json${bust}`,
      `./irminsul/voices/irminsul_voice_bank.json${bust}`,
      `./voices/irminsul_voice_bank.json${bust}`
    ];

    for (const url of candidateUrls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const bank = await res.json();
        const prof = bank?.profiles?.[profileId] || Object.values(bank?.profiles || {})[0];

        if (prof && Array.isArray(prof.dna_vector)) {
          this.applyVoiceProfile(prof);
          this.onLog(
            'ІРМІНСУЛЬ [NRI_IRMINSUL]',
            `✅ Голосовий профіль «${prof.title}» (F0: ${prof.dna_vector[0]} Hz) стягнуто з NRI_IRMINSUL і завантажено в Rust WASM!`,
            'ai'
          );
          return prof;
        }
      } catch (_) {}
    }

    this.restoreSavedVoicePrint();
    return this.currentProfile;
  }

  applyVoiceProfile(profileObj) {
    if (!profileObj) return;
    this.currentProfile = {
      ...this.currentProfile,
      ...profileObj
    };

    if (this.wasmEngine && typeof this.wasmEngine.load_voice_dna === 'function') {
      this.wasmEngine.load_voice_dna(new Float32Array(this.currentProfile.dna_vector));
    }

    try {
      localStorage.setItem('entropia_irminsul_active_voice', JSON.stringify(this.currentProfile));
    } catch (_) {}

    const f0 = this.currentProfile.dna_vector?.[0] || 115;
    this.onStatusChange(`🧬 ${this.currentProfile.id} (${f0}Hz)`);
  }

  restoreSavedVoicePrint() {
    try {
      const saved =
        localStorage.getItem('entropia_irminsul_active_voice') ||
        localStorage.getItem('entropia_raphael_voice_dna');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.dna_vector)) {
          this.applyVoiceProfile(parsed);
        }
      }
    } catch (_) {}
  }

  _splitTextIntoChunks(text, maxLen = 140) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
    const chunks = [];
    let current = '';

    for (const w of words) {
      if ((current + ' ' + w).trim().length > maxLen) {
        if (current.trim()) chunks.push(current.trim());
        current = w;
      } else {
        current = (current + ' ' + w).trim();
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [text];
  }

  _base64ToArrayBuffer(base64String) {
    const cleanB64 = base64String.includes('base64,')
      ? base64String.split('base64,')[1]
      : base64String;
    const binary = window.atob(cleanB64.trim());
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * ОНОВЛЕНИЙ ПАРАЛЕЛЬНИЙ ЗАВАНТАЖУВАЧ (Lingva JSON API + client=gtx):
   * Опитує одразу декілька дзеркал паралельно і бере першу успішну відповідь за ~0.3 сек.
   */
  async _fetchChunkAudioBuffer(chunkText) {
    const ctx = this.ensureAudioContext();
    const q = encodeURIComponent(chunkText);

    // 1. Прямі JSON-сервери Lingva (віддають масив байтів MP3 напряму у JSON з відкритим CORS)
    const lingvaMirrors = [
      `https://translate.plausibility.cloud/api/v1/audio/uk/${q}`,
      `https://lingva.lunar.icu/api/v1/audio/uk/${q}`,
      `https://lingva.garudalinux.org/api/v1/audio/uk/${q}`,
      `https://lingva.ml/api/v1/audio/uk/${q}`
    ];

    const fetchFromLingva = async (apiUrl) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4500);
      try {
        const res = await fetch(apiUrl, {
          mode: 'cors',
          credentials: 'omit',
          signal: ctrl.signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data || !Array.isArray(data.audio) || data.audio.length < 200) {
          throw new Error('Empty audio array');
        }
        const byteArray = new Uint8Array(data.audio);
        return await ctx.decodeAudioData(byteArray.buffer.slice(0));
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      return await Promise.any(lingvaMirrors.map((url) => fetchFromLingva(url)));
    } catch (_) {}

    // 2. Резервні канали з робочим параметром client=gtx (замість заблокованого tw-ob)
    const gtxUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=uk&q=${q}`;

    const gtxTasks = [
      async () => {
        const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(gtxUrl)}`);
        if (!res.ok) throw new Error('AllOrigins get failed');
        const data = await res.json();
        if (!data?.contents) throw new Error('Empty contents');
        const buf = this._base64ToArrayBuffer(data.contents);
        return await ctx.decodeAudioData(buf.slice(0));
      },
      async () => {
        const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(gtxUrl)}`);
        if (!res.ok) throw new Error('AllOrigins raw failed');
        const buf = await res.arrayBuffer();
        return await ctx.decodeAudioData(buf.slice(0));
      },
      async () => {
        const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(gtxUrl)}`);
        if (!res.ok) throw new Error('CodeTabs failed');
        const buf = await res.arrayBuffer();
        return await ctx.decodeAudioData(buf.slice(0));
      }
    ];

    try {
      return await Promise.any(gtxTasks.map((fn) => fn()));
    } catch (_) {}

    return null;
  }

  _stitchAudioBuffers(buffers) {
    const ctx = this.ensureAudioContext();
    if (!buffers || buffers.length === 0) return null;
    if (buffers.length === 1) return buffers[0];

    const sr = buffers[0].sampleRate;
    const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
    const out = ctx.createBuffer(1, totalLength, sr);
    const outData = out.getChannelData(0);

    let offset = 0;
    for (const b of buffers) {
      outData.set(b.getChannelData(0), offset);
      offset += b.length;
    }
    return out;
  }

  /**
   * ГОЛОВНИЙ МЕТОД ОЗВУЧЕННЯ:
   * Збирає чисту несучу хвилю і проганяє її крізь Rust WASM (process_voice_dsp) + 6 формант ДНК Ірмінсуля.
   */
  async speak(text, slotKey = null) {
    const cleanText = String(text || '').replace(/\[.*?\]/g, '').trim();
    if (!cleanText) return false;

    this.playCueChime();
    const ctx = this.ensureAudioContext();

    if (slotKey && this.sampleBank.has(slotKey)) {
      await this.playBufferThroughRustCloneDSP(this.sampleBank.get(slotKey));
      return true;
    }

    const slotUrl = slotKey && this.currentProfile.samples?.[slotKey];
    if (slotUrl) {
      try {
        const res = await fetch(slotUrl);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const decoded = await ctx.decodeAudioData(buf);
          this.sampleBank.set(slotKey, decoded);
          await this.playBufferThroughRustCloneDSP(decoded);
          return true;
        }
      } catch (_) {}
    }

    this.onStatusChange('⏳ SYNTH + RUST DNA...');
    const chunks = this._splitTextIntoChunks(cleanText, 140);
    const decodedParts = [];

    for (const chunk of chunks) {
      const partBuf = await this._fetchChunkAudioBuffer(chunk);
      if (partBuf) decodedParts.push(partBuf);
    }

    const fullCarrierBuffer = this._stitchAudioBuffers(decodedParts);
    if (fullCarrierBuffer) {
      await this.playBufferThroughRustCloneDSP(fullCarrierBuffer);
      return true;
    }

    this.onLog(
      'ГОЛОСОВЕ ЯДРО [ДІАГНОСТИКА]',
      '⚠️ Усі зовнішні шлюзи заблоковані браузером. Перевір, чи не блокує запити вбудований щиток AdBlock в Opera GX біля адресного рядка.',
      'error'
    );
    this.onStatusChange(`🧬 ${this.currentProfile.id}`);
    return false;
  }

  /**
   * Пропускає AudioBuffer крізь скомпільований Rust WASM (process_voice_dsp)
   * та 6-смугову формантну матрицю ДНК із репозиторію NRI_IRMINSUL.
   */
  async playBufferThroughRustCloneDSP(sourceBuffer, maxDurationSec = null) {
    this.stop();
    const ctx = this.ensureAudioContext();

    const maxSamples = maxDurationSec
      ? Math.min(sourceBuffer.length, Math.floor(maxDurationSec * sourceBuffer.sampleRate))
      : sourceBuffer.length;

    const workingBuffer = ctx.createBuffer(
      sourceBuffer.numberOfChannels,
      maxSamples,
      sourceBuffer.sampleRate
    );

    for (let ch = 0; ch < sourceBuffer.numberOfChannels; ch++) {
      const srcData = sourceBuffer.getChannelData(ch).subarray(0, maxSamples);
      workingBuffer.copyToChannel(srcData, ch);
    }

    const primary = workingBuffer.getChannelData(0);
    const sr = workingBuffer.sampleRate;
    const dna = this.currentProfile.dna_vector || [114.5, 4.2, 2.6, -2.1, 3.4, 2.1, -1.5, 0.22, 0.36, 1.32];

    // 1. Перековка в Rust WASM (6 Biquad-резонаторів ДНК + суб-гармоніка + Apex Stereo Doubler)
    if (this.wasmEngine && typeof this.wasmEngine.process_voice_dsp === 'function') {
      const chunk = 2048;
      for (let i = 0; i < primary.length; i += chunk) {
        const slice = primary.subarray(i, Math.min(i + chunk, primary.length));
        this.wasmEngine.process_voice_dsp(slice, sr);
      }
    }

    // 2. Каскад формант WebAudio за вектором ДНК з NRI_IRMINSUL
    const freqs = [115, 250, 580, 1350, 2750, 4600];
    const f0 = dna[0] || 114.5;
    const effectivePitch = f0 < 110 ? 0.85 : f0 < 145 ? 0.90 : (this.currentProfile.pitch_ratio || 0.97);

    const srcNode = ctx.createBufferSource();
    srcNode.buffer = workingBuffer;
    srcNode.playbackRate.value = effectivePitch;

    let lastNode = srcNode;
    for (let i = 0; i < freqs.length; i++) {
      const eq = ctx.createBiquadFilter();
      eq.type = i === 0 ? 'lowshelf' : i === freqs.length - 1 ? 'highshelf' : 'peaking';
      eq.frequency.value = freqs[i];
      eq.Q.value = 1.45;
      eq.gain.value = dna[i + 1] ?? 0;
      lastNode.connect(eq);
      lastNode = eq;
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const pcmData = new Float32Array(analyser.fftSize);

    lastNode.connect(analyser);
    analyser.connect(ctx.destination);

    this.activeSource = srcNode;
    this.onStatusChange(`🔊 SPEAKING [${this.currentProfile.id}]`);
    if (this.wasmEngine) this.wasmEngine.set_activity_mode(4);

    let playing = true;
    const tickVisualizer = () => {
      if (!playing || this.activeSource !== srcNode) return;
      analyser.getFloatTimeDomainData(pcmData);
      let sum = 0;
      for (let i = 0; i < pcmData.length; i++) sum += pcmData[i] * pcmData[i];
      const rms = Math.sqrt(sum / pcmData.length);
      if (this.wasmEngine) {
        this.wasmEngine.set_voice_energy(Math.min(1.35, rms * 5.5));
      }
      requestAnimationFrame(tickVisualizer);
    };

    return new Promise((resolve) => {
      srcNode.onended = () => {
        playing = false;
        if (this.activeSource === srcNode) this.activeSource = null;
        if (this.wasmEngine) {
          this.wasmEngine.set_voice_energy(0.0);
          this.wasmEngine.set_activity_mode(0);
        }
        this.onStatusChange(`🧬 ${this.currentProfile.id}`);
        resolve(true);
      };
      srcNode.start(0);
      requestAnimationFrame(tickVisualizer);
    });
  }

  playCueChime() {
    try {
      const ctx = this.ensureAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(690, now + 0.09);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch (_) {}
  }
}