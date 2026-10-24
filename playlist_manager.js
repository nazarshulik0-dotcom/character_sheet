/**
 * ВІТРУВІЙ • ЕНТРОПІЯ v3.5
 * Модуль: Професійний Мікшерний Пульт Вавилонії (playlist_manager.js)
 * Функції:
 *  - Роздільна гучність: Гучність Трансляції (для гравців) + Монітор Майстра (локально)
 *  - Режими відтворення: Повтор 1 треку (🔂), Підряд по плейлисту (🔁), Shuffle (🔀), Один раз (➡️)
 *  - Автоматичний кросфейд між треками плейлиста (Deck A <-> Deck B)
 *  - Незалежний шар фонового ембієнту Вавилонії (грає паралельно з музикою)
 *  - Синхронні SFX-педи (Stingers) через MQTT та BroadcastChannel
 */

(function () {
  'use strict';

  const ARK_CHANNEL_NAME = 'entropia_ark_sync_channel';
  const MIXER_STORAGE_KEY = 'entropia_babylon_mixer_v35';
  const arkChannel = ('BroadcastChannel' in window) ? new BroadcastChannel(ARK_CHANNEL_NAME) : null;

  // Вбудовані процедурні ембієнти Вавилонії (можуть грати як окремо, так і фоновим шаром під музикою)
  const BABYLON_AMBIENTS = [
    { id: 'babylon_spire',      title: 'Вавилонія: Шпиль Ковчега',      subtitle: 'Висотний вітер та гармоніки ядра',        f1: 98.0,  f2: 146.8, lfo: 0.14, type: 'sine' },
    { id: 'babylon_undercity',  title: 'Вавилонія: Нижні Рівні',        subtitle: 'Гул генераторів та неоновий туман',       f1: 65.4,  f2: 98.0,  lfo: 0.22, type: 'sawtooth' },
    { id: 'babylon_irminsul',   title: 'Коріння Ірмінсуля',             subtitle: 'Біолюмінесцентний резонанс памʼяті',      f1: 130.8, f2: 196.0, lfo: 0.19, type: 'triangle' },
    { id: 'babylon_ciel',       title: 'Протокол «СІЕЛЬ» (Аналіз)',     subtitle: 'Кібернетичний кристалічний імпульс',       f1: 164.8, f2: 246.9, lfo: 0.35, type: 'sine' },
    { id: 'babylon_quarantine', title: 'Карантинний Купол Сектора 4',   subtitle: 'Тривожний біо-пульс заростей',            f1: 73.4,  f2: 110.0, lfo: 0.42, type: 'triangle' },
    { id: 'babylon_combat',     title: 'Вавилонія: Бойова Тривога',     subtitle: 'Агресивний низькочастотний пульс',        f1: 55.0,  f2: 82.4,  lfo: 1.25, type: 'sawtooth' }
  ];

  // Миттєві звукові ефекти (SFX Stingers), що транслюються всім гравцям
  const BABYLON_SFX_PADS = [
    { id: 'sfx_siren',    icon: '🚨', label: 'Тривога Ковчега' },
    { id: 'sfx_blight',   icon: '☢️', label: 'Імпульс Скверни' },
    { id: 'sfx_airlock',  icon: '🚪', label: 'Важкий Шлюз' },
    { id: 'sfx_thunder',  icon: '⚡', label: 'Грозовий Розряд' },
    { id: 'sfx_crystal',  icon: '💎', label: 'Резонанс Кристала' },
    { id: 'sfx_ciel_msg', icon: '👁️', label: 'Сигнал СІЕЛЬ' }
  ];

  // Внутрішній стан мікшерного пульта
  const mixer = {
    activeDeck: 'A',               // 'A' (#globalAudioElement) або 'B' (#secondaryAudioElement)
    isPaused: false,

    // Керування гучністю
    broadcastVolume: 0.75,         // Гучність трансляції для всіх гравців (0.0 .. 1.0)
    gmMonitorVolume: 0.80,         // Особистий монітор Майстра (0.0 .. 1.0)
    ambientLayerVolume: 0.45,      // Гучність фонового шару ембієнту (0.0 .. 1.0)
    voiceDucking: false,           // Чи увімкнено приглушення під голос ГМ
    duckingFactor: 0.30,           // Залишкова гучність під час дакінгу (0.30 = -70%)

    // Кросфейд та трансляція
    crossfadeSec: 3.0,             // Час плавного переходу між треками (0 .. 8 сек)
    broadcastToParty: true,        // true = транслювати всім гравцям, false = тільки локально у ГМ

    // Режими програвання плейлиста
    playbackMode: 'loop_playlist', // 'loop_one' | 'loop_playlist' | 'shuffle_playlist' | 'play_once'
    queuePlaylist: 'ALL',          // Який плейлист грає по черзі ('ALL' або назва плейлиста)
    autoAdvancing: false,          // Прапорець захисту від подвійного перемикання в кінці треку

    // Таймлайн поточного треку
    currentTime: 0,
    duration: 0,

    // WebAudio контекст для ембієнту та SFX
    fadeIntervalId: null,
    uiTickerId: null,
    synthCtx: null,
    synthMasterGain: null,
    synthNodes: [],
    currentAmbientId: null,
    lastTriggeredSfxStamp: 0
  };

  function loadMixerSettings() {
    try {
      const raw = localStorage.getItem(MIXER_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.broadcastVolume === 'number') mixer.broadcastVolume = saved.broadcastVolume;
      if (typeof saved.gmMonitorVolume === 'number') mixer.gmMonitorVolume = saved.gmMonitorVolume;
      if (typeof saved.ambientLayerVolume === 'number') mixer.ambientLayerVolume = saved.ambientLayerVolume;
      if (typeof saved.duckingFactor === 'number') mixer.duckingFactor = saved.duckingFactor;
      if (typeof saved.crossfadeSec === 'number') mixer.crossfadeSec = saved.crossfadeSec;
      if (typeof saved.broadcastToParty === 'boolean') mixer.broadcastToParty = saved.broadcastToParty;
      if (saved.playbackMode) mixer.playbackMode = saved.playbackMode;
      if (saved.queuePlaylist) mixer.queuePlaylist = saved.queuePlaylist;
    } catch (_) {}
  }

  function saveMixerSettings() {
    try {
      localStorage.setItem(MIXER_STORAGE_KEY, JSON.stringify({
        broadcastVolume: mixer.broadcastVolume,
        gmMonitorVolume: mixer.gmMonitorVolume,
        ambientLayerVolume: mixer.ambientLayerVolume,
        duckingFactor: mixer.duckingFactor,
        crossfadeSec: mixer.crossfadeSec,
        broadcastToParty: mixer.broadcastToParty,
        playbackMode: mixer.playbackMode,
        queuePlaylist: mixer.queuePlaylist
      }));
    } catch (_) {}
  }

  function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
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

  /**
   * Обчислює підсумкову гучність для поточного пристрою:
   * - У Майстра: broadcastVolume * gmMonitorVolume * ducking
   * - У Гравця:  broadcastVolume (від Майстра) * локальний регулятор гравця * ducking
   */
  function getEffectiveTrackVolume() {
    const isGM = isMasterMode();
    const remoteBroadcastVol = Number(window.state?.audioState?.broadcastVolume ?? mixer.broadcastVolume ?? 0.75);
    const duckMult = (window.state?.audioState?.voiceDucking ?? mixer.voiceDucking)
      ? Number(window.state?.audioState?.duckingFactor ?? mixer.duckingFactor ?? 0.30)
      : 1.0;

    if (isGM) {
      return Math.min(1, Math.max(0, mixer.broadcastVolume * mixer.gmMonitorVolume * duckMult));
    } else {
      const playerLocalTrim = Number(window.state?.audioState?.volume ?? 0.8);
      return Math.min(1, Math.max(0, remoteBroadcastVol * playerLocalTrim * duckMult));
    }
  }

  function getEffectiveAmbientVolume() {
    const baseAmb = Number(window.state?.audioState?.ambientLayerVolume ?? mixer.ambientLayerVolume ?? 0.45);
    return Math.min(1, Math.max(0, baseAmb * getEffectiveTrackVolume() * 0.45));
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
    attachDeckEventsIfNeeded(deckA, 'A');
    attachDeckEventsIfNeeded(deckB, 'B');
    return { deckA, deckB };
  }

  function getCurrentActiveDeckElement() {
    const { deckA, deckB } = getDecks();
    return mixer.activeDeck === 'A' ? deckA : deckB;
  }

  /********************************************************************
   * 1. ВІДСТЕЖЕННЯ ЧАСУ ТРЕКУ ТА АВТОМАТИЧНИЙ ПЕРЕХІД ПО ПЛЕЙЛИСТУ
   ********************************************************************/
  function attachDeckEventsIfNeeded(audioEl, deckLabel) {
    if (!audioEl || audioEl.dataset.babylonBound === '1') return;
    audioEl.dataset.babylonBound = '1';

    audioEl.addEventListener('timeupdate', () => {
      if (mixer.activeDeck !== deckLabel || audioEl.paused) return;
      mixer.currentTime = audioEl.currentTime || 0;
      mixer.duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
      updateTransportProgressDOM();

      // Якщо обрано режим «Підряд по плейлисту» або «Shuffle» — запускаємо авто-кросфейд перед кінцем треку
      if (isMasterMode() && !mixer.autoAdvancing && mixer.duration > 8) {
        const remaining = mixer.duration - mixer.currentTime;
        const triggerWindow = Math.max(0.4, Number(mixer.crossfadeSec || 0));
        if (remaining <= triggerWindow && (mixer.playbackMode === 'loop_playlist' || mixer.playbackMode === 'shuffle_playlist')) {
          mixer.autoAdvancing = true;
          playNextInQueue(true);
          setTimeout(() => { mixer.autoAdvancing = false; }, 2500);
        }
      }
    });

    audioEl.addEventListener('ended', () => {
      if (mixer.activeDeck !== deckLabel) return;
      handleTrackEnded();
    });
  }

  // Слухаємо події від YouTube IFrame для автопереходу на наступний трек у плейлисті
  window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'string') return;
    try {
      const data = JSON.parse(event.data);
      if (data && data.event === 'infoDelivery' && data.info) {
        if (window.state?.audioState?.mode === 'youtube') {
          if (typeof data.info.currentTime === 'number') mixer.currentTime = data.info.currentTime;
          if (typeof data.info.duration === 'number' && data.info.duration > 0) mixer.duration = data.info.duration;
          updateTransportProgressDOM();

          // Коли YouTube-відео закінчилося (playerState === 0)
          if (data.info.playerState === 0 && isMasterMode() && !mixer.autoAdvancing) {
            mixer.autoAdvancing = true;
            handleTrackEnded();
            setTimeout(() => { mixer.autoAdvancing = false; }, 1500);
          }
        }
      }
    } catch (_) {}
  });

  function handleTrackEnded() {
    if (!isMasterMode()) return;

    if (mixer.playbackMode === 'loop_one') {
      const activeId = window.state?.audioState?.activeTrackId;
      if (activeId) playTrackById(activeId, true);
      return;
    }

    if (mixer.playbackMode === 'loop_playlist' || mixer.playbackMode === 'shuffle_playlist') {
      playNextInQueue(true);
      return;
    }

    // Режим 'play_once' — зупиняємо музичний потік
    stopMusicOnly();
  }

  function getQueueTrackList() {
    const allTracks = window.state?.audioTracks || [];
    if (!allTracks.length) return [];
    const filterPl = mixer.queuePlaylist || 'ALL';
    if (filterPl === 'ALL') return allTracks;
    const filtered = allTracks.filter(t => (t.playlist || 'Загальний') === filterPl);
    return filtered.length > 0 ? filtered : allTracks;
  }

  function playNextInQueue(isAuto = false) {
    const list = getQueueTrackList();
    if (!list.length) return;

    const currentId = window.state?.audioState?.activeTrackId;
    let nextTrack = list[0];

    if (mixer.playbackMode === 'shuffle_playlist' && list.length > 1) {
      const candidates = list.filter(t => t.id !== currentId);
      nextTrack = candidates[Math.floor(Math.random() * candidates.length)] || list[0];
    } else {
      const idx = list.findIndex(t => t.id === currentId);
      const nextIdx = (idx >= 0 && idx + 1 < list.length) ? (idx + 1) : 0;
      nextTrack = list[nextIdx];
    }

    if (nextTrack) {
      playTrackById(nextTrack.id, isAuto);
    }
  }

  function playPrevInQueue() {
    const list = getQueueTrackList();
    if (!list.length) return;

    const currentId = window.state?.audioState?.activeTrackId;
    const idx = list.findIndex(t => t.id === currentId);
    const prevIdx = (idx > 0) ? (idx - 1) : (list.length - 1);
    const prevTrack = list[prevIdx];

    if (prevTrack) {
      playTrackById(prevTrack.id, false);
    }
  }

  /********************************************************************
   * 2. ДВОДЕКОВИЙ КРОСФЕЙД ТА НЕЗАЛЕЖНИЙ ШАР ЕМБІЄНТУ ВАВИЛОНІЇ
   ********************************************************************/
  function clearActiveFadeTimer() {
    if (mixer.fadeIntervalId) {
      clearInterval(mixer.fadeIntervalId);
      mixer.fadeIntervalId = null;
    }
  }

  function ensureWebAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!mixer.synthCtx) mixer.synthCtx = new AudioCtx();
    if (mixer.synthCtx.state === 'suspended') mixer.synthCtx.resume();
    return mixer.synthCtx;
  }

  // Запуск / зупинка фонового шару ембієнту (працює паралельно з музикою!)
  function stopBabylonSynth(fadeOutSec = 0.8) {
    if (!mixer.synthNodes.length) {
      mixer.currentAmbientId = null;
      return;
    }
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
    stopBabylonSynth(0.5);

    try {
      const ctx = ensureWebAudioContext();
      const now = ctx.currentTime;
      const targetGain = Math.max(0.015, getEffectiveAmbientVolume());

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.001, now);
      masterGain.gain.linearRampToValueAtTime(targetGain, now + Math.max(0.2, fadeInSec));
      masterGain.connect(ctx.destination);

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const subOsc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

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

  // Процедурний синтезатор SFX Stingers (миттєві звукові ефекти без зовнішніх файлів)
  function playProceduralSfxStinger(sfxId) {
    try {
      const ctx = ensureWebAudioContext();
      const now = ctx.currentTime;
      const vol = Math.min(1, Math.max(0.08, getEffectiveTrackVolume() * 0.75));

      const gain = ctx.createGain();
      gain.connect(ctx.destination);

      if (sfxId === 'sfx_siren') {
        // Тривога Ковчега (двотональна сирена)
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(950, now);

        osc.frequency.setValueAtTime(320, now);
        osc.frequency.linearRampToValueAtTime(640, now + 0.65);
        osc.frequency.linearRampToValueAtTime(310, now + 1.3);
        osc.frequency.linearRampToValueAtTime(640, now + 1.95);
        osc.frequency.linearRampToValueAtTime(280, now + 2.5);

        gain.gain.setValueAtTime(0.01, now);
        gain.gain.linearRampToValueAtTime(vol * 0.45, now + 0.15);
        gain.gain.setValueAtTime(vol * 0.45, now + 2.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 2.6);

        osc.connect(filter);
        filter.connect(gain);
        osc.start(now);
        osc.stop(now + 2.65);
      } else if (sfxId === 'sfx_blight') {
        // Імпульс Скверни (глибокий суб-басовий удар з дисонансом)
        const sub = ctx.createOscillator();
        const mid = ctx.createOscillator();
        sub.type = 'sine';
        mid.type = 'triangle';

        sub.frequency.setValueAtTime(110, now);
        sub.frequency.exponentialRampToValueAtTime(32, now + 1.8);
        mid.frequency.setValueAtTime(156, now);
        mid.frequency.exponentialRampToValueAtTime(43, now + 1.8);

        gain.gain.setValueAtTime(vol * 0.8, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.9);

        sub.connect(gain);
        mid.connect(gain);
        sub.start(now);
        mid.start(now);
        sub.stop(now + 1.95);
        mid.stop(now + 1.95);
      } else if (sfxId === 'sfx_airlock') {
        // Важкий Гідрошлюз (пневматичний шум + металевий удар)
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(28, now + 0.55);

        gain.gain.setValueAtTime(vol * 0.9, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 0.75);
      } else if (sfxId === 'sfx_thunder') {
        // Грозовий розряд Сектора VI
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(480, now);
        osc.frequency.exponentialRampToValueAtTime(38, now + 1.1);

        gain.gain.setValueAtTime(vol * 0.65, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 1.25);
      } else if (sfxId === 'sfx_crystal') {
        // Резонанс Аура-Кристала (чистий акорд)
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, now + idx * 0.08);
          g.gain.setValueAtTime(vol * 0.22, now + idx * 0.08);
          g.gain.exponentialRampToValueAtTime(0.0008, now + 2.2);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(now + idx * 0.08);
          o.stop(now + 2.25);
        });
      } else if (sfxId === 'sfx_ciel_msg') {
        // Сигнал термінала СІЕЛЬ
        [880, 1174.66, 1318.5, 1760].forEach((freq, idx) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          const t0 = now + idx * 0.11;
          o.frequency.setValueAtTime(freq, t0);
          g.gain.setValueAtTime(vol * 0.28, t0);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(t0);
          o.stop(t0 + 0.38);
        });
      }
    } catch (e) {
      console.warn('SFX synth error:', e);
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
        if (deckA) { deckA.pause(); deckA.volume = getEffectiveTrackVolume(); }
        if (deckB) { deckB.pause(); deckB.volume = getEffectiveTrackVolume(); }
      }
    }, stepTime);
  }

  function crossfadeHtmlTrack(playUrl) {
    clearActiveFadeTimer();

    const { deckA, deckB } = getDecks();
    const outgoingDeck = mixer.activeDeck === 'A' ? deckA : deckB;
    const incomingDeck = mixer.activeDeck === 'A' ? deckB : deckA;
    mixer.activeDeck = mixer.activeDeck === 'A' ? 'B' : 'A';
    mixer.isPaused = false;

    const targetVol = getEffectiveTrackVolume();
    const fadeSec = Number(mixer.crossfadeSec || 0);
    const shouldLoopSingle = (mixer.playbackMode === 'loop_one');

    if (!incomingDeck) return;

    incomingDeck.src = playUrl;
    incomingDeck.loop = shouldLoopSingle;

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
      const currentTarget = getEffectiveTrackVolume();
      incomingDeck.volume = Math.min(1, currentTarget * progress);
      if (!outgoingDeck.paused) {
        outgoingDeck.volume = Math.max(0, startOutVol * (1 - progress));
      }

      if (step >= steps) {
        clearActiveFadeTimer();
        outgoingDeck.pause();
        incomingDeck.volume = getEffectiveTrackVolume();
      }
    }, stepMs);
  }

  /********************************************************************
   * 3. СИНХРОНІЗАЦІЯ З ГРАВЦЯМИ ЧЕРЕЗ MQTT ТА BROADCAST_CHANNEL
   ********************************************************************/
  function enrichAudioStateForSync() {
    if (!window.state?.audioState) return;
    window.state.audioState.broadcastVolume = mixer.broadcastVolume;
    window.state.audioState.ambientLayerVolume = mixer.ambientLayerVolume;
    window.state.audioState.ambientId = mixer.currentAmbientId || '';
    window.state.audioState.voiceDucking = mixer.voiceDucking;
    window.state.audioState.duckingFactor = mixer.duckingFactor;
    window.state.audioState.playbackMode = mixer.playbackMode;
    window.state.audioState.queuePlaylist = mixer.queuePlaylist;
    window.state.audioState.crossfadeSec = mixer.crossfadeSec;
    window.state.audioState.isPaused = mixer.isPaused;
    window.state.audioState.updatedAt = Date.now();
  }

  function broadcastAudioStateToParty(actionType, trackSummary, extraPayload = {}) {
    if (!window.state) return;
    enrichAudioStateForSync();
    saveMixerSettings();

    if (window.IrminsulGateway && typeof window.IrminsulGateway.recordEvent === 'function') {
      window.IrminsulGateway.recordEvent('AUDIO_MIXER_EVENT', {
        action: actionType,
        track: trackSummary,
        broadcastVol: Math.round(mixer.broadcastVolume * 100) + '%',
        mode: mixer.playbackMode,
        broadcasted: mixer.broadcastToParty
      });
    }

    if (!mixer.broadcastToParty) return;

    const audioPacket = {
      type: 'BABYLON_AUDIO_SYNC',
      actionType,
      audioState: window.state.audioState,
      ...extraPayload,
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
      if (ev.data && ev.data.type === 'BABYLON_AUDIO_SYNC') {
        if (ev.data.sfxId && ev.data.sfxStamp !== mixer.lastTriggeredSfxStamp) {
          mixer.lastTriggeredSfxStamp = ev.data.sfxStamp;
          playProceduralSfxStinger(ev.data.sfxId);
        }
        if (ev.data.audioState && !isMasterMode()) {
          syncRemoteState(ev.data.audioState, false);
        }
      }
    };
  }

  /********************************************************************
   * 4. ПУБЛІЧНІ МЕТОДИ КЕРУВАННЯ МІКШЕРОМ ВАВИЛОНІЇ
   ********************************************************************/
  function toggleAmbientLayer(presetId) {
    const preset = BABYLON_AMBIENTS.find(b => b.id === presetId);
    if (!preset) return;

    if (mixer.currentAmbientId === preset.id) {
      stopBabylonSynth(1.0);
      broadcastAudioStateToParty('STOP_AMBIENT_LAYER', preset.title);
    } else {
      startBabylonSynth(preset, mixer.crossfadeSec);
      broadcastAudioStateToParty('START_AMBIENT_LAYER', preset.title);
    }
    mount('babylon-playlist-manager-root');
  }

  function triggerSfxPad(sfxId) {
    const pad = BABYLON_SFX_PADS.find(p => p.id === sfxId);
    if (!pad) return;
    const stamp = Date.now();
    mixer.lastTriggeredSfxStamp = stamp;
    playProceduralSfxStinger(sfxId);

    if (window.state?.audioState) {
      window.state.audioState.lastSfxId = sfxId;
      window.state.audioState.lastSfxStamp = stamp;
    }
    broadcastAudioStateToParty('TRIGGER_SFX', pad.label, { sfxId, sfxStamp: stamp });
  }

  function playTrackById(trackId, isAutoQueue = false) {
    if (!window.state) return;

    // Якщо клікнули на ембієнт Вавилонії — перемикаємо фоновий шар ембієнту
    const babylonPreset = BABYLON_AMBIENTS.find(b => b.id === trackId);
    if (babylonPreset) {
      toggleAmbientLayer(trackId);
      return;
    }

    const tr = (window.state.audioTracks || []).find(t => t.id === trackId);
    if (!tr) return;

    // Якщо користувач вручну запустив трек з певного плейлиста — оновлюємо чергу плейлиста
    if (!isAutoQueue && tr.playlist && mixer.queuePlaylist !== 'ALL') {
      mixer.queuePlaylist = tr.playlist;
    }

    const store = window.EntropiaBridge?.getAudioStore ? window.EntropiaBridge.getAudioStore() : null;
    const localBlobUrl = store?.localBlobs?.[tr.id] || tr.url;
    const ytId = tr.ytId || (typeof window.extractYoutubeId === 'function' ? window.extractYoutubeId(tr.url) : '');

    window.state.audioState.activeTrackId = tr.id;
    window.state.audioState.activeTitle = tr.title;
    window.state.audioState.isPlaying = true;
    mixer.isPaused = false;
    mixer.currentTime = 0;
    mixer.duration = 0;

    if (tr.isYoutube || ytId) {
      crossfadeOutBothHtmlDecks(0.8);
      window.state.audioState.activeUrl = tr.url;
      window.state.audioState.activeYtId = ytId;
      window.state.audioState.mode = 'youtube';

      if (typeof window.startYoutubePlayback === 'function') {
        window.startYoutubePlayback(ytId);
      }
      applyCurrentVolumesToEngines();
    } else {
      // Зупиняємо YouTube, якщо грав
      if (typeof ytPlayer !== 'undefined' && ytPlayer && typeof ytPlayer.stopVideo === 'function') {
        try { ytPlayer.stopVideo(); } catch (_) {}
      }
      window.state.audioState.activeUrl = tr.isLocalBlob ? '' : tr.url;
      window.state.audioState.activeYtId = '';
      window.state.audioState.mode = tr.isLocalBlob ? 'file' : 'url';

      crossfadeHtmlTrack(localBlobUrl);
    }

    broadcastAudioStateToParty('PLAY_TRACK', tr.title);
    if (typeof window.safeRenderApp === 'function') window.safeRenderApp();
  }

  function togglePlayPause() {
    if (!window.state?.audioState) return;

    // Якщо жоден трек ще не був запущений — запускаємо перший трек із черги
    if (!window.state.audioState.activeTrackId) {
      const list = getQueueTrackList();
      if (list.length > 0) {
        playTrackById(list[0].id, false);
      }
      return;
    }

    const mode = window.state.audioState.mode;
    if (mixer.isPaused || !window.state.audioState.isPlaying) {
      mixer.isPaused = false;
      window.state.audioState.isPlaying = true;

      if (mode === 'youtube' && typeof ytPlayer !== 'undefined' && ytPlayer && typeof ytPlayer.playVideo === 'function') {
        try { ytPlayer.playVideo(); } catch (_) {}
      } else {
        const deck = getCurrentActiveDeckElement();
        if (deck) {
          deck.volume = getEffectiveTrackVolume();
          deck.play().catch(() => {});
        }
      }
      broadcastAudioStateToParty('RESUME_TRACK', window.state.audioState.activeTitle);
    } else {
      mixer.isPaused = true;
      window.state.audioState.isPlaying = false;

      if (mode === 'youtube' && typeof ytPlayer !== 'undefined' && ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
        try { ytPlayer.pauseVideo(); } catch (_) {}
      } else {
        const deck = getCurrentActiveDeckElement();
        if (deck) deck.pause();
      }
      broadcastAudioStateToParty('PAUSE_TRACK', window.state.audioState.activeTitle);
    }

    if (typeof window.safeRenderApp === 'function') window.safeRenderApp();
  }

  function seekToPercent(percentVal) {
    const p = Math.min(100, Math.max(0, Number(percentVal) || 0));
    if (mixer.duration <= 0) return;
    const targetSec = (p / 100) * mixer.duration;
    mixer.currentTime = targetSec;

    const mode = window.state?.audioState?.mode;
    if (mode === 'youtube' && typeof ytPlayer !== 'undefined' && ytPlayer && typeof ytPlayer.seekTo === 'function') {
      try { ytPlayer.seekTo(targetSec, true); } catch (_) {}
    } else {
      const deck = getCurrentActiveDeckElement();
      if (deck) {
        try { deck.currentTime = targetSec; } catch (_) {}
      }
    }
    updateTransportProgressDOM();
  }

  function stopMusicOnly() {
    crossfadeOutBothHtmlDecks(0.8);
    if (typeof ytPlayer !== 'undefined' && ytPlayer && typeof ytPlayer.stopVideo === 'function') {
      try { ytPlayer.stopVideo(); } catch (_) {}
    }
    if (window.state?.audioState) {
      window.state.audioState.isPlaying = false;
    }
    mixer.isPaused = false;
    broadcastAudioStateToParty('STOP_MUSIC', 'Музику зупинено');
    if (typeof window.safeRenderApp === 'function') window.safeRenderApp();
  }

  function stopAll() {
    stopBabylonSynth(0.9);
    crossfadeOutBothHtmlDecks(0.9);
    if (typeof ytPlayer !== 'undefined' && ytPlayer && typeof ytPlayer.stopVideo === 'function') {
      try { ytPlayer.stopVideo(); } catch (_) {}
    }
    if (window.state?.audioState) {
      window.state.audioState.isPlaying = false;
      window.state.audioState.ambientId = '';
    }
    mixer.isPaused = false;
    broadcastAudioStateToParty('STOP_ALL', 'Повна тиша');
  }

  function applyCurrentVolumesToEngines() {
    const effTrack = getEffectiveTrackVolume();
    const effAmb = getEffectiveAmbientVolume();

    const { deckA, deckB } = getDecks();
    if (deckA && !deckA.paused) deckA.volume = effTrack;
    if (deckB && !deckB.paused) deckB.volume = effTrack;

    if (typeof ytPlayer !== 'undefined' && ytPlayer && typeof ytPlayer.setVolume === 'function') {
      try { ytPlayer.setVolume(Math.round(effTrack * 100)); } catch (_) {}
    }

    if (mixer.synthMasterGain && mixer.synthCtx) {
      try {
        mixer.synthMasterGain.gain.setTargetAtTime(Math.max(0.01, effAmb), mixer.synthCtx.currentTime, 0.12);
      } catch (_) {}
    }
  }

  // Зміна Гучності Трансляції (чують усі гравці!)
  let broadcastVolSyncTimeout = null;
  function setBroadcastVolume(val) {
    const v = Math.min(1, Math.max(0, Number(val)));
    mixer.broadcastVolume = v;
    if (window.state?.audioState) {
      window.state.audioState.broadcastVolume = v;
    }
    applyCurrentVolumesToEngines();

    const lbl = document.getElementById('babylonBroadcastVolLabel');
    if (lbl) lbl.textContent = Math.round(v * 100) + '%';

    saveMixerSettings();
    if (broadcastVolSyncTimeout) clearTimeout(broadcastVolSyncTimeout);
    broadcastVolSyncTimeout = setTimeout(() => {
      broadcastAudioStateToParty('VOLUME_BROADCAST_CHANGE', Math.round(v * 100) + '%');
    }, 180);
  }

  // Зміна особистого монітора Майстра (або локальної гучності гравця з шапки)
  function setMasterVolume(val) {
    const v = Math.min(1, Math.max(0, Number(val)));
    mixer.gmMonitorVolume = v;
    if (window.state?.audioState) {
      window.state.audioState.volume = v;
    }
    applyCurrentVolumesToEngines();

    const lbl = document.getElementById('babylonMonitorVolLabel');
    if (lbl) lbl.textContent = Math.round(v * 100) + '%';
    saveMixerSettings();
  }

  function setAmbientLayerVolume(val) {
    const v = Math.min(1, Math.max(0, Number(val)));
    mixer.ambientLayerVolume = v;
    if (window.state?.audioState) {
      window.state.audioState.ambientLayerVolume = v;
    }
    applyCurrentVolumesToEngines();

    const lbl = document.getElementById('babylonAmbientVolLabel');
    if (lbl) lbl.textContent = Math.round(v * 100) + '%';

    saveMixerSettings();
    if (broadcastVolSyncTimeout) clearTimeout(broadcastVolSyncTimeout);
    broadcastVolSyncTimeout = setTimeout(() => {
      broadcastAudioStateToParty('AMBIENT_VOL_CHANGE', Math.round(v * 100) + '%');
    }, 220);
  }

  function setPlaybackMode(mode) {
    if (!['loop_one', 'loop_playlist', 'shuffle_playlist', 'play_once'].includes(mode)) return;
    mixer.playbackMode = mode;

    // Оновлюємо прапорець loop на поточній HTML5-деці
    const deck = getCurrentActiveDeckElement();
    if (deck) {
      deck.loop = (mode === 'loop_one');
    }

    broadcastAudioStateToParty('PLAYBACK_MODE_CHANGE', mode);
    mount('babylon-playlist-manager-root');
  }

  function setQueuePlaylist(plName) {
    mixer.queuePlaylist = plName || 'ALL';
    saveMixerSettings();
    mount('babylon-playlist-manager-root');
  }

  function toggleVoiceDucking() {
    mixer.voiceDucking = !mixer.voiceDucking;
    applyCurrentVolumesToEngines();
    broadcastAudioStateToParty('VOICE_DUCKING_TOGGLE', mixer.voiceDucking ? 'ON' : 'OFF');
    mount('babylon-playlist-manager-root');
  }

  function setDuckingAttenuation(attenuationPercent) {
    // attenuationPercent = на скільки % приглушити (напр. 65% -> залишок 0.35)
    const att = Math.min(85, Math.max(30, Number(attenuationPercent) || 65));
    mixer.duckingFactor = Math.round((100 - att)) / 100;
    applyCurrentVolumesToEngines();
    const lbl = document.getElementById('babylonDuckingDepthLabel');
    if (lbl) lbl.textContent = '-' + Math.round(att) + '%';
    saveMixerSettings();
  }

  function toggleBroadcastMode() {
    mixer.broadcastToParty = !mixer.broadcastToParty;
    saveMixerSettings();
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
    saveMixerSettings();
  }

  // Синхронізація стану на боці гравців
  function syncRemoteState(remoteState, forcePlayGesture = false) {
    if (!remoteState) return;

    if (typeof remoteState.crossfadeSec === 'number') mixer.crossfadeSec = remoteState.crossfadeSec;
    if (typeof remoteState.broadcastVolume === 'number') mixer.broadcastVolume = remoteState.broadcastVolume;
    if (typeof remoteState.ambientLayerVolume === 'number') mixer.ambientLayerVolume = remoteState.ambientLayerVolume;
    if (typeof remoteState.voiceDucking === 'boolean') mixer.voiceDucking = remoteState.voiceDucking;
    if (typeof remoteState.duckingFactor === 'number') mixer.duckingFactor = remoteState.duckingFactor;
    if (remoteState.playbackMode) mixer.playbackMode = remoteState.playbackMode;

    // Відтворення миттєвого SFX, якщо надійшов новий штамп
    if (remoteState.lastSfxId && remoteState.lastSfxStamp && remoteState.lastSfxStamp !== mixer.lastTriggeredSfxStamp) {
      if (Date.now() - remoteState.lastSfxStamp < 8000) {
        mixer.lastTriggeredSfxStamp = remoteState.lastSfxStamp;
        playProceduralSfxStinger(remoteState.lastSfxId);
      }
    }

    // Синхронізація фонового шару ембієнту
    if (remoteState.ambientId) {
      const preset = BABYLON_AMBIENTS.find(b => b.id === remoteState.ambientId);
      if (preset && (mixer.currentAmbientId !== preset.id || forcePlayGesture)) {
        startBabylonSynth(preset, mixer.crossfadeSec);
      }
    } else if (mixer.currentAmbientId) {
      stopBabylonSynth(0.8);
    }

    applyCurrentVolumesToEngines();

    if (!remoteState.isPlaying) {
      crossfadeOutBothHtmlDecks(0.6);
      if (typeof ytPlayer !== 'undefined' && ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
        try { ytPlayer.pauseVideo(); } catch (_) {}
      }
      return;
    }

    if (remoteState.mode === 'url' && remoteState.activeUrl) {
      const deck = getCurrentActiveDeckElement();
      if (!deck || deck.src !== remoteState.activeUrl) {
        crossfadeHtmlTrack(remoteState.activeUrl);
      } else if (deck.paused || forcePlayGesture) {
        deck.volume = getEffectiveTrackVolume();
        deck.play().catch(() => {});
      }
      return;
    }

    if (remoteState.mode === 'youtube' && remoteState.activeYtId) {
      crossfadeOutBothHtmlDecks(0.5);
      if (typeof window.startYoutubePlayback === 'function') {
        window.startYoutubePlayback(remoteState.activeYtId);
      }
      applyCurrentVolumesToEngines();
    }
  }

  function updateTransportProgressDOM() {
    const timeEl = document.getElementById('babylonTransportTimeLabel');
    const sliderEl = document.getElementById('babylonTransportSeekSlider');
    if (timeEl) {
      timeEl.textContent = `${formatTime(mixer.currentTime)} / ${formatTime(mixer.duration)}`;
    }
    if (sliderEl && document.activeElement !== sliderEl) {
      const pct = mixer.duration > 0 ? Math.min(100, (mixer.currentTime / mixer.duration) * 100) : 0;
      sliderEl.value = pct;
    }
  }

  /********************************************************************
   * 5. РЕНДЕР ПРОФЕСІЙНОГО МІКШЕРНОГО ПУЛЬТА ВАВИЛОНІЇ (GM ONLY)
   ********************************************************************/
  function mount(containerId = 'babylon-playlist-manager-root') {
    const host = document.getElementById(containerId);
    if (!host) return;

    if (!isMasterMode()) {
      host.innerHTML = `
        <div class="p-4 rounded-2xl bg-slate-950 border border-red-500/30 text-xs text-red-300 font-bold">
          🔒 Доступ до Мікшерного пульта Вавилонії дозволено виключно Майстру (GM).
        </div>
      `;
      return;
    }

    const isPlaying = !!window.state?.audioState?.isPlaying;
    const activeTitle = window.state?.audioState?.activeTitle || 'Трек не обрано';
    const playlists = window.state?.audioPlaylists || ['Загальний'];
    const queueList = getQueueTrackList();
    const duckAttenuationPct = Math.round((1 - mixer.duckingFactor) * 100);
    const seekPct = mixer.duration > 0 ? Math.min(100, (mixer.currentTime / mixer.duration) * 100) : 0;

    host.innerHTML = `
      <section class="bio-card w-full bg-slate-900/95 border border-cyan-500/35 rounded-2xl p-5 space-y-6 shadow-[0_0_45px_rgba(6,182,212,0.14)]">
        <!-- 1. ШАПКА МІКШЕРНОГО ПУЛЬТА -->
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(34,211,238,0.25)]">
              🎚️
            </div>
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <h2 class="text-base md:text-lg font-black uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-emerald-300 to-lime-300">
                  Майстер-Мікшер Вавилонії v3.5
                </h2>
                <span class="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-black">
                  PRO CONSOLE
                </span>
              </div>
              <p class="text-xs text-slate-400 mt-0.5">
                Керування гучністю трансляції для гравців, автоматизація черги плейлистів, паралельний ембієнт та SFX-педи
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onclick="window.BabylonPlaylistManager.toggleVoiceDucking()"
              class="px-3.5 py-2 rounded-xl text-xs font-extrabold border transition-all ${
                mixer.voiceDucking
                  ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-[0_0_18px_rgba(245,158,11,0.45)]'
                  : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-cyan-400'
              }"
            >
              ${mixer.voiceDucking ? `🔉 Дакінг Активний (-${duckAttenuationPct}%)` : '🎙️ Дакінг під голос ГМ'}
            </button>

            <button
              type="button"
              onclick="window.BabylonPlaylistManager.toggleBroadcastMode()"
              class="px-3.5 py-2 rounded-xl text-xs font-extrabold border transition-all ${
                mixer.broadcastToParty
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                  : 'bg-slate-950 text-amber-300 border-amber-500/40'
              }"
            >
              ${mixer.broadcastToParty ? '📡 Ефір: Усім гравцям' : '🎧 Тільки локально у ГМ'}
            </button>

            <button
              type="button"
              onclick="window.BabylonPlaylistManager.forceResyncPlayers()"
              class="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-xs font-extrabold"
              title="Примусово синхронізувати поточний трек та гучність на пристроях гравців"
            >
              🔄 Синхр. гравців
            </button>
          </div>
        </div>

        <!-- 2. ТРАНСПОРТНА ПАНЕЛЬ ТА РЕЖИМИ ПРОГРАВАННЯ ПЛЕЙЛИСТА -->
        <div class="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
            <!-- Індикатор поточного треку та Деки -->
            <div class="lg:col-span-5 flex items-center gap-3 min-w-0">
              <div class="px-2.5 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-center shrink-0">
                <div class="text-[9px] uppercase font-black text-slate-400">ДЕКА</div>
                <div class="text-sm font-black text-cyan-300">${mixer.activeDeck}</div>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}"></span>
                  <span class="text-xs font-black text-white truncate">${escHtml(activeTitle)}</span>
                </div>
                <div class="text-[11px] text-slate-400 truncate mt-0.5">
                  Черга: <b class="text-cyan-300">${mixer.queuePlaylist === 'ALL' ? 'Усі треки' : escHtml(mixer.queuePlaylist)}</b> (${queueList.length} тр.)
                </div>
              </div>
            </div>

            <!-- Кнопки транспорту: Попередній / Пуск-Пауза / Наступний / Стоп -->
            <div class="lg:col-span-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onclick="window.BabylonPlaylistManager.playPrevInQueue()"
                class="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-black text-slate-200"
                title="Попередній трек у черзі"
              >
                ⏮
              </button>
              <button
                type="button"
                onclick="window.BabylonPlaylistManager.togglePlayPause()"
                class="px-5 py-2 rounded-xl font-black text-xs uppercase tracking-wider transition-all ${
                  isPlaying
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                    : 'bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-950 shadow-[0_0_15px_rgba(34,211,238,0.3)]'
                }"
              >
                ${isPlaying ? '⏸ Пауза' : '▶ Пуск'}
              </button>
              <button
                type="button"
                onclick="window.BabylonPlaylistManager.playNextInQueue(false)"
                class="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-black text-slate-200"
                title="Наступний трек із плавним кросфейдом"
              >
                ⏭
              </button>
              <button
                type="button"
                onclick="window.stopAllAudio()"
                class="px-3 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-xs font-black text-red-300"
                title="Повністю зупинити музику та ембієнт"
              >
                ⏹
              </button>
            </div>

            <!-- Вибір активного плейлиста для автоматичної черги -->
            <div class="lg:col-span-3">
              <label class="block text-[10px] font-bold uppercase text-slate-400 mb-1">Плейлист для авто-черги:</label>
              <select
                onchange="window.BabylonPlaylistManager.setQueuePlaylist(this.value)"
                class="w-full px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-bold focus:outline-none focus:border-cyan-400"
              >
                <option value="ALL" ${mixer.queuePlaylist === 'ALL' ? 'selected' : ''}>🗂️ Усі треки (${(window.state?.audioTracks || []).length})</option>
                ${playlists.map(pl => {
                  const cnt = (window.state?.audioTracks || []).filter(t => (t.playlist || 'Загальний') === pl).length;
                  return `<option value="${escHtml(pl)}" ${mixer.queuePlaylist === pl ? 'selected' : ''}>📁 ${escHtml(pl)} (${cnt})</option>`;
                }).join('')}
              </select>
            </div>
          </div>

          <!-- Смуга прогресу часу (Seek Bar) -->
          <div class="flex items-center gap-3 pt-1">
            <span id="babylonTransportTimeLabel" class="text-[11px] font-mono text-slate-400 w-24 shrink-0">
              ${formatTime(mixer.currentTime)} / ${formatTime(mixer.duration)}
            </span>
            <input
              id="babylonTransportSeekSlider"
              type="range"
              min="0"
              max="100"
              step="0.5"
              value="${seekPct}"
              onchange="window.BabylonPlaylistManager.seekToPercent(this.value)"
              class="w-full accent-cyan-400 cursor-pointer"
            />
          </div>

          <!-- 4 Режими циклічності та черги -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80">
            ${[
              { id: 'loop_one',         label: '🔂 Цикл 1 треку',       desc: 'Один трек грає по колу' },
              { id: 'loop_playlist',    label: '🔁 Підряд по плейлисту', desc: 'Автоперехід на наступний' },
              { id: 'shuffle_playlist', label: '🔀 Випадково (Shuffle)', desc: 'Мікс треків плейлиста' },
              { id: 'play_once',        label: '➡️ Один раз',            desc: 'Зупинка після треку' }
            ].map(m => {
              const active = mixer.playbackMode === m.id;
              return `
                <button
                  type="button"
                  onclick="window.BabylonPlaylistManager.setPlaybackMode('${m.id}')"
                  class="p-2.5 rounded-xl border text-left transition-all ${
                    active
                      ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                      : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:border-slate-700'
                  }"
                >
                  <div class="text-xs font-extrabold">${m.label}</div>
                  <div class="text-[10px] text-slate-400 mt-0.5">${m.desc}</div>
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <!-- 3. ФЕЙДЕРИ ГУЧНОСТІ ТА КРОСФЕЙДУ (4 КАНАЛИ МІКШЕРА) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <!-- Фейдер 1: Загальна Гучність Трансляції (Для всіх гравців) -->
          <div class="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/35 space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-extrabold text-emerald-300">📡 Гучність Трансляції</span>
              <span id="babylonBroadcastVolLabel" class="font-black text-white">${Math.round(mixer.broadcastVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value="${mixer.broadcastVolume}"
              oninput="window.BabylonPlaylistManager.setBroadcastVolume(this.value)"
              class="w-full accent-emerald-400 cursor-pointer"
            />
            <div class="text-[10px] text-slate-400">Керує гучністю ефіру на пристроях усіх гравців</div>
          </div>

          <!-- Фейдер 2: Особистий Монітор Майстра -->
          <div class="p-3.5 rounded-xl bg-slate-950 border border-cyan-500/30 space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-extrabold text-cyan-300">🎧 Монітор Майстра</span>
              <span id="babylonMonitorVolLabel" class="font-black text-white">${Math.round(mixer.gmMonitorVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value="${mixer.gmMonitorVolume}"
              oninput="window.BabylonPlaylistManager.setMasterVolume(this.value)"
              class="w-full accent-cyan-400 cursor-pointer"
            />
            <div class="text-[10px] text-slate-400">Гучність тільки у твоїх навушниках / динаміках</div>
          </div>

          <!-- Фейдер 3: Шина Фонового Ембієнту Вавилонії -->
          <div class="p-3.5 rounded-xl bg-slate-950 border border-purple-500/30 space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-extrabold text-purple-300">🏛️ Шар Ембієнту</span>
              <span id="babylonAmbientVolLabel" class="font-black text-white">${Math.round(mixer.ambientLayerVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value="${mixer.ambientLayerVolume}"
              oninput="window.BabylonPlaylistManager.setAmbientLayerVolume(this.value)"
              class="w-full accent-purple-400 cursor-pointer"
            />
            <div class="text-[10px] text-slate-400">Гучність фонового дрону Вавилонії під музикою</div>
          </div>

          <!-- Фейдер 4: Час Кросфейду та Глибина Дакінгу -->
          <div class="p-3.5 rounded-xl bg-slate-950 border border-amber-500/30 space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-extrabold text-amber-300">🌊 Кросфейд / Дакінг</span>
              <span id="babylonCrossfadeValueLabel" class="font-black text-white">${mixer.crossfadeSec.toFixed(1)} сек</span>
            </div>
            <input
              type="range"
              min="0"
              max="8"
              step="0.5"
              value="${mixer.crossfadeSec}"
              oninput="window.BabylonPlaylistManager.setCrossfadeSeconds(this.value)"
              class="w-full accent-amber-400 cursor-pointer"
            />
            <div class="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
              <span>Дакінг: <b id="babylonDuckingDepthLabel" class="text-amber-300">-${duckAttenuationPct}%</b></span>
              <input
                type="range"
                min="30"
                max="85"
                step="5"
                value="${duckAttenuationPct}"
                oninput="window.BabylonPlaylistManager.setDuckingAttenuation(this.value)"
                class="w-20 accent-amber-400 cursor-pointer"
                title="На скільки відсотків приглушувати музику при активному дакінгу"
              />
            </div>
          </div>
        </div>

        <!-- 4. ШВИДКІ САУНД-ПЕДИ (SFX STINGERS ДЛЯ КАТ-СЦЕН) -->
        <div class="space-y-2">
          <div class="text-xs font-extrabold uppercase tracking-wider text-amber-300">
            ⚡ Миттєві Саунд-педи (SFX Stingers — звучать поверх музики у всіх гравців):
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            ${BABYLON_SFX_PADS.map(pad => `
              <button
                type="button"
                onclick="window.BabylonPlaylistManager.triggerSfxPad('${pad.id}')"
                class="p-2.5 rounded-xl bg-slate-950 hover:bg-amber-500/15 active:scale-95 border border-slate-800 hover:border-amber-400/50 transition-all flex flex-col items-center justify-center gap-1 text-center shadow"
              >
                <span class="text-xl">${pad.icon}</span>
                <span class="text-[11px] font-bold text-slate-200">${escHtml(pad.label)}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- 5. ПАРАЛЕЛЬНИЙ ШАР ЕМБІЄНТІВ ВАВИЛОНІЇ -->
        <div class="space-y-2.5 pt-2 border-t border-slate-800">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="text-xs font-extrabold uppercase tracking-wider text-emerald-400">
              🏛️ Фоновий Шар Ембієнтів Вавилонії (Можна вмикати одночасно з музикою плейлиста):
            </div>
            ${
              mixer.currentAmbientId
                ? `<button type="button" onclick="window.BabylonPlaylistManager.stopAmbientLayer()" class="px-3 py-1 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-[11px] font-bold">⏹ Вимкнути фоновий ембієнт</button>`
                : ''
            }
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${BABYLON_AMBIENTS.map(amb => {
              const active = mixer.currentAmbientId === amb.id;
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
                    onclick="window.BabylonPlaylistManager.toggleAmbientLayer('${amb.id}')"
                    class="px-3 py-1.5 rounded-lg text-xs font-black shrink-0 transition-all ${
                      active
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-950 hover:brightness-110'
                    }"
                  >
                    ${active ? '⏹ Стоп' : '▶ Підмішати'}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </section>
    `;
  }

  function stopAmbientLayer() {
    stopBabylonSynth(0.9);
    broadcastAudioStateToParty('STOP_AMBIENT_LAYER', 'Ембієнт вимкнено');
    mount('babylon-playlist-manager-root');
  }

  function forceResyncPlayers() {
    broadcastAudioStateToParty('FORCE_RESYNC', window.state?.audioState?.activeTitle || '');
  }

  // Запускаємо завантаження збережених налаштувань мікшера
  loadMixerSettings();

  // Експортуємо API у глобальний простір
  window.BabylonPlaylistManager = {
    mount,
    playTrackById,
    togglePlayPause,
    playNextInQueue,
    playPrevInQueue,
    seekToPercent,
    stopAll,
    stopMusicOnly,
    stopAmbientLayer,
    toggleAmbientLayer,
    triggerSfxPad,
    setBroadcastVolume,
    setMasterVolume,
    setAmbientLayerVolume,
    setPlaybackMode,
    setQueuePlaylist,
    toggleVoiceDucking,
    setDuckingAttenuation,
    toggleBroadcastMode,
    setCrossfadeSeconds,
    syncRemoteState,
    forceResyncPlayers
  };

  document.addEventListener('DOMContentLoaded', () => {
    getDecks();
    if (window.state?.session?.activeTab === 'audio') {
      mount('babylon-playlist-manager-root');
    }
  });
})();