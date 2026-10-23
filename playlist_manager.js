/**
 * ВІТРУВІЙ • ЕНТРОПІЯ v3.0
 * Модуль: Музичний пультівський модуль Вавилонії (playlist_manager.js)
 * Доступ до пульта: Виключно в режимі Майстра — window.EntropiaBridge.isGM()
 * Синхронізація: MQTT-міст + BroadcastChannel('entropia_ark_sync_channel') + IrminsulGateway
 */

(function () {
  'use strict';

  const ARK_CHANNEL_NAME = 'entropia_ark_sync_channel';
  const arkChannel = ('BroadcastChannel' in window) ? new BroadcastChannel(ARK_CHANNEL_NAME) : null;

  // Вбудовані процедурні ембієнти Вавилонії
  const BABYLON_AMBIENTS = [
    { id: 'babylon_spire',    title: 'Вавилонія: Шпиль Ковчега',         subtitle: 'Висотний вітер та гармоніки ядра',   f1: 98.0,  f2: 146.8, lfo: 0.14, type: 'sine' },
    { id: 'babylon_undercity',title: 'Вавилонія: Нижні Рівні',           subtitle: 'Гул генераторів та вологий неоновий туман', f1: 65.4,  f2: 98.0,  lfo: 0.22, type: 'sawtooth' },
    { id: 'babylon_irminsul', title: 'Коріння Ірмінсуля',                subtitle: 'Біолюмінесцентний резонанс памʼяті', f1: 130.8, f2: 196.0, lfo: 0.19, type: 'triangle' },
    { id: 'babylon_ciel',     title: 'Протокол «СІЕЛЬ» (Аналіз)',        subtitle: 'Кібернетичний кристалічний імпульс',  f1: 164.8, f2: 246.9, lfo: 0.35, type: 'sine' },
    { id: 'babylon_quarantine',title: 'Карантинний Купол Сектора 4',     subtitle: 'Тривожний біо-пульс заростей',       f1: 73.4,  f2: 110.0, lfo: 0.42, type: 'triangle' },
    { id: 'babylon_combat',   title: 'Вавилонія: Бойова Тривога',        subtitle: 'Агресивний низькочастотний ритм',     f1: 55.0,  f2: 82.4,  lfo: 1.25, type: 'sawtooth' }
  ];

  // Внутрішній стан дводекового кросфейд-пульту
  const mixer = {
    activeDeck: 'A',          // 'A' (#globalAudioElement) або 'B' (#secondaryAudioElement)
    crossfadeSec: 2.5,        // Тривалість плавного переходу між треками (секунд)
    broadcastToParty: true,   // true = музика грає у всіх гравців, false = тільки локально у ГМ
    voiceDucking: false,      // true = приглушення на 60% під час мовлення Майстра
    duckingFactor: 0.35,      // Множник гучності при активному дакінгу
    fadeIntervalId: null,
    synthCtx: null,
    synthMasterGain: null,
    synthNodes: [],
    currentAmbientId: null
  };

  function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isMasterMode() {
    if (window.EntropiaBridge && typeof window.EntropiaBridge.isGM === 'function') {
      return !!window.EntropiaBridge.isGM();
    }
    if (typeof window.isCurrentUserGM === 'function') {
      return !!window.isCurrentUserGM();
    }
    return window.state?.session?.role === 'gm';
  }

  function getEffectiveVolume() {
    const baseVol = Number(window.state?.audioState?.volume ?? 0.6);
    const mult = mixer.voiceDucking ? mixer.duckingFactor : 1.0;
    return Math.min(1, Math.max(0, baseVol * mult));
  }

  function getDecks() {
    const deckA = document.getElementById('globalAudioElement');
    let deckB = document.getElementById('secondaryAudioElement');
    if (!deckB) {
      deckB = document.createElement('audio');
      deckB.id = 'secondaryAudioElement';
      deckB.className = 'hidden';
      deckB.crossOrigin = 'anonymous';
      document.body.appendChild(deckB);
    }
    return { deckA, deckB };
  }

  /********************************************************************
   * 1. ДВОДЕКОВИЙ КРОСФЕЙД-РУШІЙ (ПЛАВНІ ПЕРЕХОДИ МІЖ ТРЕКАМИ)
   ********************************************************************/
  function clearActiveFadeTimer() {
    if (mixer.fadeIntervalId) {
      clearInterval(mixer.fadeIntervalId);
      mixer.fadeIntervalId = null;
    }
  }

  function stopBabylonSynth(fadeOutSec = 0.8) {
    if (!mixer.synthNodes.length) return;
    const nodesToClean = [...mixer.synthNodes];
    const gainNode = mixer.synthMasterGain;
    mixer.synthNodes = [];
    mixer.synthMasterGain = null;
    mixer.currentAmbientId = null;

    if (gainNode && mixer.synthCtx && fadeOutSec > 0) {
      try {
        const now = mixer.synthCtx.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0.0001, now + fadeOutSec);
        setTimeout(() => {
          nodesToClean.forEach(n => {
            try { n.stop && n.stop(); } catch (_) {}
            try { n.disconnect && n.disconnect(); } catch (_) {}
          });
        }, fadeOutSec * 1000 + 80);
        return;
      } catch (_) {}
    }

    nodesToClean.forEach(n => {
      try { n.stop && n.stop(); } catch (_) {}
      try { n.disconnect && n.disconnect(); } catch (_) {}
    });
  }

  function startBabylonSynth(preset, fadeInSec = 1.5) {
    stopBabylonSynth(0.6);
    crossfadeOutBothHtmlDecks(0.8);

    if (typeof window.stopAllAudio === 'function' && window.state?.audioState?.mode === 'youtube') {
      // Зупиняємо YouTube, якщо він грав
      try {
        const ytEl = document.getElementById('ytPlayerElement');
        if (ytEl && ytEl.contentWindow) {
          ytEl.contentWindow.postMessage('{"event":"command","func":"stopVideo","args":""}', '*');
        }
      } catch (_) {}
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!mixer.synthCtx) mixer.synthCtx = new AudioCtx();
      if (mixer.synthCtx.state === 'suspended') mixer.synthCtx.resume();

      const now = mixer.synthCtx.currentTime;
      const targetGain = Math.max(0.03, getEffectiveVolume() * 0.28);

      const masterGain = mixer.synthCtx.createGain();
      masterGain.gain.setValueAtTime(0.001, now);
      masterGain.gain.linearRampToValueAtTime(targetGain, now + Math.max(0.2, fadeInSec));
      masterGain.connect(mixer.synthCtx.destination);

      const osc1 = mixer.synthCtx.createOscillator();
      const osc2 = mixer.synthCtx.createOscillator();
      const subOsc = mixer.synthCtx.createOscillator();
      const lfo = mixer.synthCtx.createOscillator();
      const lfoGain = mixer.synthCtx.createGain();
      const filter = mixer.synthCtx.createBiquadFilter();

      osc1.type = preset.type || 'sine';
      osc2.type = 'sine';
      subOsc.type = 'sine';

      osc1.frequency.setValueAtTime(preset.f1, now);
      osc2.frequency.setValueAtTime(preset.f2, now);
      subOsc.frequency.setValueAtTime(preset.f1 * 0.5, now);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(380, now);

      lfo.frequency.setValueAtTime(preset.lfo || 0.2, now);
      lfoGain.gain.setValueAtTime(160, now);

      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      osc1.connect(filter);
      osc2.connect(filter);
      subOsc.connect(filter);
      filter.connect(masterGain);

      osc1.start();
      osc2.start();
      subOsc.start();
      lfo.start();

      mixer.synthMasterGain = masterGain;
      mixer.synthNodes = [osc1, osc2, subOsc, lfo, lfoGain, filter, masterGain];
      mixer.currentAmbientId = preset.id;
    } catch (err) {
      console.warn('Babylon WebAudio synth error:', err);
    }
  }

  function crossfadeOutBothHtmlDecks(durationSec = 1.0) {
    clearActiveFadeTimer();
    const { deckA, deckB } = getDecks();
    if (!deckA && !deckB) return;

    const steps = 20;
    const stepTime = Math.max(25, (durationSec * 1000) / steps);
    const startVolA = deckA ? deckA.volume : 0;
    const startVolB = deckB ? deckB.volume : 0;
    let currentStep = 0;

    mixer.fadeIntervalId = setInterval(() => {
      currentStep++;
      const ratio = Math.max(0, 1 - currentStep / steps);
      if (deckA && !deckA.paused) deckA.volume = startVolA * ratio;
      if (deckB && !deckB.paused) deckB.volume = startVolB * ratio;

      if (currentStep >= steps) {
        clearActiveFadeTimer();
        if (deckA) { deckA.pause(); deckA.volume = getEffectiveVolume(); }
        if (deckB) { deckB.pause(); deckB.volume = getEffectiveVolume(); }
      }
    }, stepTime);
  }

  // Плавний кросфейд з поточної деки на нову для .mp3 / .wav / .ogg
  function crossfadeHtmlTrack(playUrl) {
    stopBabylonSynth(mixer.crossfadeSec * 0.7);
    clearActiveFadeTimer();

    const { deckA, deckB } = getDecks();
    const outgoingDeck = mixer.activeDeck === 'A' ? deckA : deckB;
    const incomingDeck = mixer.activeDeck === 'A' ? deckB : deckA;
    mixer.activeDeck = mixer.activeDeck === 'A' ? 'B' : 'A';

    const targetVol = getEffectiveVolume();
    const fadeSec = Number(mixer.crossfadeSec || 0);

    if (!incomingDeck) return;

    incomingDeck.src = playUrl;
    incomingDeck.loop = true;

    if (fadeSec <= 0.1 || !outgoingDeck || outgoingDeck.paused) {
      if (outgoingDeck) outgoingDeck.pause();
      incomingDeck.volume = targetVol;
      incomingDeck.play().catch(() => {});
      return;
    }

    incomingDeck.volume = 0.01;
    incomingDeck.play().catch(() => {});

    const startOutVol = outgoingDeck.volume;
    const steps = 25;
    const stepMs = Math.max(30, (fadeSec * 1000) / steps);
    let step = 0;

    mixer.fadeIntervalId = setInterval(() => {
      step++;
      const progress = Math.min(1, step / steps);
      incomingDeck.volume = Math.min(1, targetVol * progress);
      if (!outgoingDeck.paused) {
        outgoingDeck.volume = Math.max(0, startOutVol * (1 - progress));
      }

      if (step >= steps) {
        clearActiveFadeTimer();
        outgoingDeck.pause();
        incomingDeck.volume = getEffectiveVolume();
      }
    }, stepMs);
  }

  /********************************************************************
   * 2. СИНХРОНІЗАЦІЯ З ГРАВЦЯМИ ЧЕРЕЗ MQTT, BROADCAST_CHANNEL ТА ІРМІНСУЛЬ
   ********************************************************************/
  function broadcastAudioStateToParty(actionType, trackSummary) {
    if (!window.state) return;

    // Записуємо подію в Ірмінсуль (для ШІ Сіель та Рафаїла)
    if (window.IrminsulGateway && typeof window.IrminsulGateway.recordEvent === 'function') {
      window.IrminsulGateway.recordEvent('AUDIO_SCENE_CHANGE', {
        action: actionType,
        track: trackSummary,
        broadcasted: mixer.broadcastToParty
      });
    }

    // Якщо обрано локальний режим («Тільки у Майстра») — не шлемо в хмару
    if (!mixer.broadcastToParty) {
      return;
    }

    const audioPacket = {
      type: 'BABYLON_AUDIO_SYNC',
      audioState: window.state.audioState,
      sentAt: Date.now()
    };

    if (arkChannel) {
      try { arkChannel.postMessage(audioPacket); } catch (_) {}
    }

    if (window.EntropiaBridge && typeof window.EntropiaBridge.publishMqttCustom === 'function') {
      window.EntropiaBridge.publishMqttCustom('babylon_audio', audioPacket, true);
    }

    if (window.EntropiaBridge && typeof window.EntropiaBridge.syncAudioStore === 'function') {
      window.EntropiaBridge.syncAudioStore(
        window.state.audioPlaylists,
        window.state.audioTracks,
        window.state.audioState
      );
    }
  }

  if (arkChannel) {
    arkChannel.onmessage = (ev) => {
      if (ev.data && ev.data.type === 'BABYLON_AUDIO_SYNC' && ev.data.audioState) {
        if (!isMasterMode()) {
          syncRemoteState(ev.data.audioState, false);
        }
      }
    };
  }

  /********************************************************************
   * 3. ПУБЛІЧНІ МЕТОДИ ПУЛЬТУ ВАВИЛОНІЇ
   ********************************************************************/
  function playTrackById(trackId) {
    if (!window.state) return;

    // Перевіряємо чи це ембієнт Вавилонії
    const babylonPreset = BABYLON_AMBIENTS.find(b => b.id === trackId);
    if (babylonPreset) {
      window.state.audioState.activeTrackId = babylonPreset.id;
      window.state.audioState.activeTitle = babylonPreset.title;
      window.state.audioState.activeUrl = '';
      window.state.audioState.activeYtId = '';
      window.state.audioState.mode = 'babylon_synth';
      window.state.audioState.isPlaying = true;
      window.state.audioState.crossfadeSec = mixer.crossfadeSec;
      window.state.audioState.updatedAt = Date.now();

      startBabylonSynth(babylonPreset, mixer.crossfadeSec);
      broadcastAudioStateToParty('PLAY_BABYLON_AMBIENT', babylonPreset.title);
      if (typeof window.safeRenderApp === 'function') window.safeRenderApp();
      return;
    }

    // Звичайний трек із плейлиста (MP3 або YouTube)
    const tr = (window.state.audioTracks || []).find(t => t.id === trackId);
    if (!tr) return;

    const store = window.EntropiaBridge?.getAudioStore ? window.EntropiaBridge.getAudioStore() : null;
    const localBlobUrl = store?.localBlobs?.[tr.id] || tr.url;
    const ytId = tr.ytId || (typeof window.extractYoutubeId === 'function' ? window.extractYoutubeId(tr.url) : '');

    window.state.audioState.activeTrackId = tr.id;
    window.state.audioState.activeTitle = tr.title;
    window.state.audioState.crossfadeSec = mixer.crossfadeSec;
    window.state.audioState.isPlaying = true;
    window.state.audioState.updatedAt = Date.now();

    if (tr.isYoutube || ytId) {
      stopBabylonSynth(0.8);
      crossfadeOutBothHtmlDecks(0.8);
      window.state.audioState.activeUrl = tr.url;
      window.state.audioState.activeYtId = ytId;
      window.state.audioState.mode = 'youtube';

      if (typeof window.startYoutubePlayback === 'function') {
        window.startYoutubePlayback(ytId);
      }
    } else {
      window.state.audioState.activeUrl = tr.isLocalBlob ? '' : tr.url;
      window.state.audioState.activeYtId = '';
      window.state.audioState.mode = tr.isLocalBlob ? 'file' : 'url';

      crossfadeHtmlTrack(localBlobUrl);
    }

    broadcastAudioStateToParty('PLAY_TRACK', tr.title);
    if (typeof window.safeRenderApp === 'function') window.safeRenderApp();
  }

  function stopAll() {
    stopBabylonSynth(1.0);
    crossfadeOutBothHtmlDecks(1.0);
    if (window.state?.audioState) {
      window.state.audioState.isPlaying = false;
      window.state.audioState.updatedAt = Date.now();
    }
    broadcastAudioStateToParty('STOP_ALL', 'Тиша');
  }

  function setMasterVolume(vol) {
    const cleanVol = Math.min(1, Math.max(0, Number(vol)));
    if (window.state?.audioState) {
      window.state.audioState.volume = cleanVol;
    }
    const eff = getEffectiveVolume();
    const { deckA, deckB } = getDecks();
    if (deckA && !deckA.paused) deckA.volume = eff;
    if (deckB && !deckB.paused) deckB.volume = eff;

    if (mixer.synthMasterGain && mixer.synthCtx) {
      try {
        mixer.synthMasterGain.gain.setTargetAtTime(Math.max(0.02, eff * 0.28), mixer.synthCtx.currentTime, 0.15);
      } catch (_) {}
    }
  }

  function toggleVoiceDucking() {
    mixer.voiceDucking = !mixer.voiceDucking;
    setMasterVolume(window.state?.audioState?.volume ?? 0.6);
    mount('babylon-playlist-manager-root');
  }

  function toggleBroadcastMode() {
    mixer.broadcastToParty = !mixer.broadcastToParty;
    mount('babylon-playlist-manager-root');
  }

  function setCrossfadeSeconds(sec) {
    const val = Math.min(8, Math.max(0, Number(sec) || 0));
    mixer.crossfadeSec = val;
    if (window.state?.audioState) {
      window.state.audioState.crossfadeSec = val;
    }
    const labelEl = document.getElementById('babylonCrossfadeValueLabel');
    if (labelEl) labelEl.textContent = val.toFixed(1) + ' сек';
  }

  function syncRemoteState(remoteState, forcePlayGesture = false) {
    if (!remoteState) return;
    if (typeof remoteState.crossfadeSec === 'number') {
      mixer.crossfadeSec = remoteState.crossfadeSec;
    }

    if (!remoteState.isPlaying) {
      stopBabylonSynth(0.8);
      crossfadeOutBothHtmlDecks(0.8);
      return;
    }

    if (remoteState.mode === 'babylon_synth') {
      const preset = BABYLON_AMBIENTS.find(b => b.id === remoteState.activeTrackId);
      if (preset && (mixer.currentAmbientId !== preset.id || forcePlayGesture)) {
        startBabylonSynth(preset, mixer.crossfadeSec);
      }
      return;
    }

    if (remoteState.mode === 'url' && remoteState.activeUrl) {
      const { deckA, deckB } = getDecks();
      const currentDeck = mixer.activeDeck === 'A' ? deckA : deckB;
      if (!currentDeck || currentDeck.src !== remoteState.activeUrl) {
        crossfadeHtmlTrack(remoteState.activeUrl);
      } else if (currentDeck.paused || forcePlayGesture) {
        currentDeck.volume = getEffectiveVolume();
        currentDeck.play().catch(() => {});
      }
      return;
    }

    if (remoteState.mode === 'youtube' && remoteState.activeYtId) {
      stopBabylonSynth(0.5);
      crossfadeOutBothHtmlDecks(0.5);
      if (typeof window.startYoutubePlayback === 'function') {
        window.startYoutubePlayback(remoteState.activeYtId);
      }
    }
  }

  /********************************************************************
   * 4. РЕНДЕР ПАНЕЛІ ПУЛЬТУ ВАВИЛОНІЇ (ДОСТУПНО ЛИШЕ МАЙСТРУ)
   ********************************************************************/
  function mount(containerId = 'babylon-playlist-manager-root') {
    const host = document.getElementById(containerId);
    if (!host) return;

    // Сувора перевірка прав Майстра за ТЗ: window.EntropiaBridge.isGM()
    if (!isMasterMode()) {
      host.innerHTML = `
        <div class="p-4 rounded-2xl bg-slate-950 border border-red-500/30 text-xs text-red-300 font-bold">
          🔒 Доступ до Музичного пульта Вавилонії дозволено виключно Майстру (GM).
        </div>
      `;
      return;
    }

    const activeTrackId = window.state?.audioState?.activeTrackId || '';
    const isPlaying = !!window.state?.audioState?.isPlaying;

    host.innerHTML = `
      <section class="bio-card w-full bg-slate-900/95 border border-cyan-500/35 rounded-2xl p-5 space-y-5 shadow-[0_0_40px_rgba(6,182,212,0.12)]">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(34,211,238,0.25)]">
              🎛️
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-base font-black uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-emerald-300 to-lime-300">
                  Музичний Пульт Вавилонії (Dual-Deck Crossfade)
                </h2>
                <span class="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-black">
                  GM EXCLUSIVE
                </span>
              </div>
              <p class="text-xs text-slate-400 mt-0.5">
                Плавні кросфейди між треками, дакінг під голос Майстра та генератор звукових ландшафтів Вавилонії
              </p>
            </div>
          </div>

          <!-- Тумблери трансляції та приглушення (Ducking) -->
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onclick="window.BabylonPlaylistManager.toggleVoiceDucking()"
              class="px-3.5 py-2 rounded-xl text-xs font-extrabold border transition-all ${
                mixer.voiceDucking
                  ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-[0_0_18px_rgba(245,158,11,0.4)]'
                  : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-cyan-400'
              }"
              title="Миттєво приглушити музику на 65%, поки говорить Майстер"
            >
              ${mixer.voiceDucking ? '🔉 Дакінг Активний (-65%)' : '🎙️ Приглушити під голос'}
            </button>

            <button
              type="button"
              onclick="window.BabylonPlaylistManager.toggleBroadcastMode()"
              class="px-3.5 py-2 rounded-xl text-xs font-extrabold border transition-all ${
                mixer.broadcastToParty
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                  : 'bg-slate-950 text-amber-300 border-amber-500/40'
              }"
              title="Виберіть: транслювати музику всім гравцям через MQTT чи слухати тільки локально"
            >
              ${mixer.broadcastToParty ? '📡 Ефір: Усім гравцям партії' : '🎧 Ефір: Тільки локально у ГМ'}
            </button>
          </div>
        </div>

        <!-- Налаштування кросфейду та дек -->
        <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-slate-950/90 p-4 rounded-xl border border-slate-800">
          <div class="md:col-span-5 space-y-1">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-slate-300">🌊 Час плавного кросфейду (Crossfade):</span>
              <span id="babylonCrossfadeValueLabel" class="font-black text-cyan-400">${mixer.crossfadeSec.toFixed(1)} сек</span>
            </div>
            <input
              type="range"
              min="0"
              max="8"
              step="0.5"
              value="${mixer.crossfadeSec}"
              oninput="window.BabylonPlaylistManager.setCrossfadeSeconds(this.value)"
              class="w-full accent-emerald-400 cursor-pointer"
            />
            <div class="flex justify-between text-[10px] text-slate-500">
              <span>0с (Миттєво)</span>
              <span>2.5с (Стандарт)</span>
              <span>8.0с (Кінематографічний)</span>
            </div>
          </div>

          <div class="md:col-span-4 flex flex-col justify-center px-3 border-l border-r border-slate-800/80">
            <div class="text-[10px] uppercase font-bold text-slate-400">Активна дека мікшера</div>
            <div class="text-xs font-extrabold text-white mt-0.5 flex items-center gap-2">
              <span class="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300">
                DECK ${mixer.activeDeck}
              </span>
              <span class="truncate text-slate-300">
                ${isPlaying ? escHtml(window.state?.audioState?.activeTitle || 'Відтворення') : 'Очікування сигналу'}
              </span>
            </div>
          </div>

          <div class="md:col-span-3 flex justify-end gap-2">
            <button
              type="button"
              onclick="window.BabylonPlaylistManager.forceResyncPlayers()"
              class="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-xs font-extrabold"
              title="Примусово синхронізувати поточний трек на пристроях усіх гравців"
            >
              🔄 Синхр. плеєри
            </button>
            ${
              isPlaying
                ? `<button type="button" onclick="window.stopAllAudio()" class="px-3 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-slate-950 text-xs font-black">⏹ Стоп</button>`
                : ''
            }
          </div>
        </div>

        <!-- Генератор Атмосфери Вавилонії -->
        <div class="space-y-2.5">
          <div class="text-xs font-extrabold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
            <span>🏛️ Генератор Ембієнтів Вавилонії (Плавний Crossfade-Синтез):</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${BABYLON_AMBIENTS.map(amb => {
              const active = isPlaying && activeTrackId === amb.id;
              return `
                <div class="p-3.5 rounded-xl bg-slate-950 border ${
                  active ? 'border-emerald-400 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.2)]' : 'border-slate-800 hover:border-slate-700'
                } flex items-center justify-between gap-2 transition-all">
                  <div class="min-w-0">
                    <div class="text-xs font-extrabold text-white truncate">${escHtml(amb.title)}</div>
                    <div class="text-[10px] text-slate-400 truncate mt-0.5">${escHtml(amb.subtitle)}</div>
                  </div>
                  <button
                    type="button"
                    onclick="${active ? 'window.stopAllAudio()' : `window.BabylonPlaylistManager.playTrackById('${amb.id}')`}"
                    class="px-3 py-1.5 rounded-lg text-xs font-black shrink-0 transition-all ${
                      active
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-950 hover:brightness-110'
                    }"
                  >
                    ${active ? '⏹ Стоп' : '▶ Пуск'}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </section>
    `;
  }

  function forceResyncPlayers() {
    broadcastAudioStateToParty('FORCE_RESYNC', window.state?.audioState?.activeTitle || '');
  }

  // Експортуємо API модуля в глобальний простір
  window.BabylonPlaylistManager = {
    mount,
    playTrackById,
    stopAll,
    setMasterVolume,
    toggleVoiceDucking,
    toggleBroadcastMode,
    setCrossfadeSeconds,
    syncRemoteState,
    forceResyncPlayers
  };

  // Автоматичне монтування, якщо вкладка аудіо вже відкрита
  document.addEventListener('DOMContentLoaded', () => {
    if (window.state?.session?.activeTab === 'audio') {
      mount('babylon-playlist-manager-root');
    }
  });
})();