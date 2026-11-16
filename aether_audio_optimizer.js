/**
 * ============================================================================
 * AETHER AUDIO OPTIMIZER (aether_audio_optimizer.js) - v6.5 EURO-LINK EDITION
 * ----------------------------------------------------------------------------
 * Стабілізація міжкраїнного звуку (Швеція <-> Чехія <-> Україна):
 *   1. ZERO NOISE-GATE: повністю відкритий студійний мікрофонний тракт без
 *      ковтання закінчень слів (expanderThreshold = 0.00001).
 *   2. HOT-STANDBY P2P WATCHDOG: якщо прямий WebRTC P2P потік між країнами
 *      завмирає навіть на 220 мс, резервний ADPCM-потік миттєво підхоплює фразу.
 *   3. SEQUENCE GAP INTERPOLATOR: якщо пакет (seq) випав на трасі, синтезується
 *      плавний 20 мс хвильовий міст замість дірки в голосі.
 *   4. ELASTIC NETEQ BUFFER: м'яке прискорення (1.045x) замість скидання черги.
 *   5. CLEAN GM CONSOLE PATCH: 2 кнопки Рафаїла (ВКЛ/ВИКЛ фон + Запис історії),
 *      відкриття пульта по кліку на таймер партії, без голограми в центрі столу.
 * ============================================================================
 */

(function (window) {
  'use strict';

  const MIXER_STORAGE_KEY = 'entropia_aether_mixer_vols_v5';
  const AUDIO_SETTINGS_KEY = 'entropia_aether_audio_opt_v65';
  const IRMINSUL_CHRONICLE_KEY = 'entropia_irminsul_chronicle_log';

  const ADPCM_INDEX_TABLE = [
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8
  ];

  const ADPCM_STEP_TABLE = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
    19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
    130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
    337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
    876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
    2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
    5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
    15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
  ];

  window.AetherOptimizers = window.AetherOptimizers || {
    audio: null,
    video: null,
    network: null,
    activeEngine: null,
    register(type, instance) {
      this[type] = instance;
      if (this.activeEngine && typeof instance.attach === 'function') {
        instance.attach(this.activeEngine);
      }
    }
  };

  class AetherAudioOptimizer {
    constructor() {
      this.engine = null;
      this.audio = null;
      this.fastTimer = null;
      this.slowTimer = null;

      const savedCfg = this.loadSettings();
      this.presetMode = savedCfg.presetMode || 'global';
      this.spatialEnabled = savedCfg.spatialEnabled !== false;
      this.gmPriorityEnabled = savedCfg.gmPriorityEnabled !== false;
      this.adpcm24kEnabled = savedCfg.adpcm24kEnabled !== false;
      this.duganAutomixEnabled = savedCfg.duganAutomixEnabled !== false;

      this.currentAcousticSpace = 'dry';
      this.currentVoiceMorph = 'normal';
      this.impulseCache = new Map();
      this.whisperTargetId = null;

      this.customPeerVolumes = this.loadMixerVolumes();
      this.peerSmoothedAutoGain = new Map();
      this.peerVoiceEnergy = new Map();
      this.peerLastPacketWallClock = new Map();
      this.peerLastSeqMap = new Map();
      this.peerLastP2PActiveAt = new Map();
      this.currentGmDuckFactor = 1.0;

      this.detectedHumFreq = 120;
      this.txAdpcmPredictor = 0;
      this.txAdpcmStepIndex = 0;

      // Фоновий контур Рафаїла (Тільки 2 кнопки в пульті Майстра: ВКЛ/ВИКЛ + Запис історії)
      this.rafaelBgEnabled = false;
      this.rafaelHistoryRecording = false;
      this.speechRecognizer = null;
      this.rawSttCallbacks = new Set();
      this.sttAccumulator = [];
      this.sttAccumulatorSamples = 0;
      this.chronicleEntries = this.loadChronicleEntries();
      this.arkChannel = typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('entropia_ark_sync_channel')
        : null;

      this.injectedMicNodes = null;
      this.lastHookedHpf = null;
      this.lastRawMicStreamHooked = null;
      this.abyssDroneNodes = null;

      this.blackboxDest = null;
      this.blackboxRecorder = null;
      this.blackboxChunks = [];
      this.blackboxHeaderChunk = null;
      this.blackboxMimeType = '';

      this.hiddenGmConsoleTriggerBtn = null;
      this.clockBound = false;
    }

    loadSettings() {
      try {
        return JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY) || '{}');
      } catch (_) {
        return {};
      }
    }

    saveSettings() {
      try {
        localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({
          presetMode: this.presetMode,
          spatialEnabled: this.spatialEnabled,
          gmPriorityEnabled: this.gmPriorityEnabled,
          adpcm24kEnabled: this.adpcm24kEnabled,
          duganAutomixEnabled: this.duganAutomixEnabled
        }));
      } catch (_) {}
    }

    loadMixerVolumes() {
      try {
        return JSON.parse(localStorage.getItem(MIXER_STORAGE_KEY) || '{}');
      } catch (_) {
        return {};
      }
    }

    saveMixerVolumes() {
      try {
        localStorage.setItem(MIXER_STORAGE_KEY, JSON.stringify(this.customPeerVolumes));
      } catch (_) {}
    }

    loadChronicleEntries() {
      try {
        const parsed = JSON.parse(localStorage.getItem(IRMINSUL_CHRONICLE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }

    appendChronicleEntry(speaker, text) {
      const clean = String(text || '').trim();
      if (!clean) return;
      const entry = {
        ts: new Date().toISOString(),
        time: new Date().toLocaleTimeString('uk-UA', { hour12: false }),
        room: this.engine?.roomId || 'entropia-1',
        speaker: speaker || 'Учасник',
        text: clean
      };
      this.chronicleEntries.push(entry);
      if (this.chronicleEntries.length > 400) {
        this.chronicleEntries = this.chronicleEntries.slice(-400);
      }
      try {
        localStorage.setItem(IRMINSUL_CHRONICLE_KEY, JSON.stringify(this.chronicleEntries));
      } catch (_) {}
      try {
        this.arkChannel?.postMessage({ type: 'IRMINSUL_CHRONICLE_APPEND', entry });
      } catch (_) {}
      this.syncCleanGmPanelUI();
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.audio = rtcEngine.audio;
      if (!this.audio) return;

      this.installCrossCountryElasticAudioHooks();
      this.installCleanGmConsoleAndTableGuard();
      this.startGovernorLoops();
      setTimeout(() => this.initBlackboxRecorder(), 1200);

      this.engine.log('🎙️ [AudioOptimizer v6.5] EURO-LINK: Відкритий тракт + Гарячий резерв P2P/Relay активні.');
    }

    // Фоновий статус Рафаїла (більше ніколи не викликає появу голограми в центрі столу)
    isRafaelActiveNow() {
      return !!this.rafaelBgEnabled;
    }

    // =========================================================================
    // ЗАХИСТ ЦЕНТРУ СТОЛУ ТА ОЧИЩЕННЯ ПУЛЬТА МАЙСТРА (2 КНОПКИ ЗА СХЕМОЮ)
    // =========================================================================
    installCleanGmConsoleAndTableGuard() {
      if (document.getElementById('aether-clean-gm-patch-styles')) return;

      const style = document.createElement('style');
      style.id = 'aether-clean-gm-patch-styles';
      style.textContent = `
        /* Блокуємо появу будь-якої голограми в центрі столу */
        .table-inner-ring > :not(.table-center-controls):not(#table-seats-label) {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .table-inner-ring .table-center-controls {
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
        }
        .table-inner-ring #table-seats-label {
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
        }
        #session-clock {
          cursor: pointer !important;
          padding: 3px 8px;
          border-radius: 6px;
          transition: color 0.15s ease, background 0.15s ease;
        }
        #session-clock:hover {
          color: #22d3ee !important;
          background: rgba(34, 211, 238, 0.1);
        }
        .gm-clean-raphael-box {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px;
          border-radius: 8px;
          background: rgba(10, 18, 24, 0.9);
          border: 1px solid rgba(34, 211, 238, 0.32);
          margin: 6px 0;
        }
        .gm-clean-raphael-btn {
          width: 100%;
          padding: 10px 12px;
          border-radius: 7px;
          border: 1px solid rgba(34, 211, 238, 0.4);
          background: rgba(16, 28, 38, 0.95);
          color: #e0f2fe;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: all 0.15s ease;
        }
        .gm-clean-raphael-btn:hover {
          background: rgba(34, 211, 238, 0.22);
        }
        .gm-clean-raphael-btn.active-bg {
          background: rgba(16, 185, 129, 0.24);
          border-color: #34d399;
          color: #6ee7b7;
        }
        .gm-clean-raphael-btn.active-rec {
          background: rgba(239, 68, 68, 0.28);
          border-color: #f87171;
          color: #fecaca;
        }
      `;
      document.head.appendChild(style);

      const enforceCleanUI = () => {
        // 1. Вимикаємо прапорець центральної голограми в мережевому оптимізаторі, якщо він там є
        if (window.AetherOptimizers?.network && window.AetherOptimizers.network.rafaelActive) {
          window.AetherOptimizers.network.rafaelActive = false;
        }

        // 2. Тримаємо центр столу (.table-inner-ring) завжди у штатному стані з кнопками - / +
        const innerRing = document.querySelector('.table-inner-ring');
        if (innerRing) {
          innerRing.style.setProperty('display', 'flex', 'important');
          Array.from(innerRing.children).forEach((ch) => {
            if (ch.classList.contains('table-center-controls')) {
              ch.style.setProperty('display', 'flex', 'important');
              ch.style.setProperty('opacity', '1', 'important');
              ch.style.setProperty('visibility', 'visible', 'important');
            } else if (ch.id === 'table-seats-label') {
              ch.style.setProperty('display', 'block', 'important');
              ch.style.setProperty('opacity', '1', 'important');
              ch.style.setProperty('visibility', 'visible', 'important');
            } else {
              ch.remove();
            }
          });
        }

        // 3. Прибираємо всі кнопки «👑 Пульт» та «🎛️ Мікшер» з шапки та лобі
        document.querySelectorAll('.top-bar button, .glass-card button').forEach((btn) => {
          if (btn.id === 'session-clock' || btn.id === 'btn-toggle-raphael-mode') return;
          const label = (btn.textContent || '').trim();
          if (/Пульт|Мікшер/i.test(label)) {
            this.hiddenGmConsoleTriggerBtn = btn;
            btn.style.setProperty('display', 'none', 'important');
          }
        });

        // Прив'язуємо клік по цифрах часу партії (#session-clock) до відкриття VITRUVIUS GM CONSOLE
        const clockEl = document.getElementById('session-clock');
        if (clockEl && !this.clockBound) {
          this.clockBound = true;
          clockEl.title = 'Натисніть на час партії, щоб відкрити Пульт Майстра';
          clockEl.addEventListener('click', () => {
            if (this.hiddenGmConsoleTriggerBtn) {
              this.hiddenGmConsoleTriggerBtn.click();
              setTimeout(enforceCleanUI, 30);
            }
          });
        }

        // 4. Очищуємо секцію Рафаїла всередині VITRUVIUS GM CONSOLE & MIXER v6.5 (залишаємо 2 кнопки зі схеми)
        document.querySelectorAll('body div').forEach((div) => {
          const txt = (div.textContent || '').trim();

          // Ховаємо рядок "@Рафаель [ЦЕНТР]" у списку гучності
          if (txt.includes('@Рафаель') && txt.includes('[ЦЕНТР]') && div.children.length <= 4) {
            div.style.setProperty('display', 'none', 'important');
          }

          // Замінюємо старий блок "СИСТЕМА «РАФАЕЛЬ» (ТІЛЬКИ GM)" на 2 кнопки: ВКЛ/ВИКЛ + Запис історії
          if (
            !div.dataset.cleanGmRaphael &&
            txt.includes('СИСТЕМА «РАФАЕЛЬ»') &&
            txt.includes('Слух STT') &&
            !txt.includes('АКУСТИКА ЛОКАЦІЇ') &&
            !txt.includes('ПРОФІЛЬ ЗВ\'ЯЗКУ')
          ) {
            div.dataset.cleanGmRaphael = '1';
            div.className = 'gm-clean-raphael-box';
            div.innerHTML = `
              <button type="button" class="gm-clean-raphael-btn" id="gm-clean-btn-power">
                <span>ВКЛ / ВИКЛ</span>
                <span id="gm-clean-power-state">ВИМК</span>
              </button>
              <button type="button" class="gm-clean-raphael-btn" id="gm-clean-btn-record">
                <span>Запис історії</span>
                <span id="gm-clean-record-state">ВИМК [0]</span>
              </button>
            `;

            const pwrBtn = div.querySelector('#gm-clean-btn-power');
            const recBtn = div.querySelector('#gm-clean-btn-record');

            pwrBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.toggleRafaelMasterBackground();
            });

            recBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.toggleRafaelIrminsulRecording();
            });

            this.syncCleanGmPanelUI();
          }
        });
      };

      enforceCleanUI();
      const obs = new MutationObserver(enforceCleanUI);
      obs.observe(document.body, { childList: true, subtree: true });
      setInterval(enforceCleanUI, 450);
    }

    syncCleanGmPanelUI() {
      const pwrBtn = document.getElementById('gm-clean-btn-power');
      const recBtn = document.getElementById('gm-clean-btn-record');
      const pwrState = document.getElementById('gm-clean-power-state');
      const recState = document.getElementById('gm-clean-record-state');

      if (pwrBtn) pwrBtn.classList.toggle('active-bg', this.rafaelBgEnabled);
      if (pwrState) pwrState.textContent = this.rafaelBgEnabled ? 'ФОН АКТИВНИЙ' : 'ВИМК';

      if (recBtn) recBtn.classList.toggle('active-rec', this.rafaelHistoryRecording);
      if (recState) {
        recState.textContent = this.rafaelHistoryRecording
          ? `🔴 ЗАПИС [${this.chronicleEntries.length}]`
          : `ВИМК [${this.chronicleEntries.length}]`;
      }
    }

    toggleRafaelMasterBackground(forceState) {
      this.rafaelBgEnabled = forceState !== undefined ? !!forceState : !this.rafaelBgEnabled;
      if (!this.rafaelBgEnabled && this.rafaelHistoryRecording) {
        this.setRafaelSttListening(false);
      }
      this.engine?.log(
        this.rafaelBgEnabled
          ? '💠 [Пульт Майстра] Рафаїл увімкнений у фоновому режимі (без появи на столі).'
          : '🔇 [Пульт Майстра] Фоновий режим Рафаїла вимкнено.'
      );
      this.syncCleanGmPanelUI();
      return this.rafaelBgEnabled;
    }

    toggleRafaelIrminsulRecording(forceState) {
      const next = forceState !== undefined ? !!forceState : !this.rafaelHistoryRecording;
      if (next && !this.rafaelBgEnabled) {
        this.rafaelBgEnabled = true;
      }
      this.setRafaelSttListening(next);
      this.engine?.log(
        this.rafaelHistoryRecording
          ? '🔴 [Ірмінсуль] Фонове прослуховування та запис історії партії розпочато.'
          : `💾 [Ірмінсуль] Запис історії зупинено (збережено записів: ${this.chronicleEntries.length}).`
      );
      this.syncCleanGmPanelUI();
      return this.rafaelHistoryRecording;
    }

    disableHardwareNoiseGateOnMic() {
      if (!this.audio) return;

      if (this.audio.tuning.expanderThreshold > 0.0001) {
        this.audio.applyOptimizerPatch({
          expanderThreshold: 0.00001,
          holdBlocksCount: 9999
        });
      }

      const rawStream = this.audio.rawMicStream;
      if (rawStream && this.lastRawMicStreamHooked !== rawStream) {
        this.lastRawMicStreamHooked = rawStream;
        rawStream.getAudioTracks().forEach((track) => {
          if (typeof track.applyConstraints === 'function') {
            track.applyConstraints({
              noiseSuppression: false,
              autoGainControl: true,
              echoCancellation: this.presetMode === 'room'
            }).catch(() => {});
          }
        });
      }
    }

    applyImmediatePresetParameters() {
      if (!this.audio) return;
      const targetSr = this.adpcm24kEnabled ? 24000 : 16000;

      if (this.presetMode === 'room') {
        this.audio.applyOptimizerPatch({
          targetSampleRate: targetSr,
          jitterPrebufferSec: 0.065,
          maxQueueLatencySec: 0.480,
          hpfFrequency: 110,
          presenceGainDb: 1.6,
          expanderThreshold: 0.00001,
          holdBlocksCount: 9999
        });
      } else if (this.presetMode === 'studio') {
        this.audio.applyOptimizerPatch({
          targetSampleRate: targetSr,
          jitterPrebufferSec: 0.080,
          maxQueueLatencySec: 0.580,
          hpfFrequency: 80,
          presenceGainDb: 2.4,
          expanderThreshold: 0.00001,
          holdBlocksCount: 9999
        });
      } else {
        this.audio.applyOptimizerPatch({
          targetSampleRate: targetSr,
          jitterPrebufferSec: 0.105,
          maxQueueLatencySec: 0.720,
          hpfFrequency: 90,
          presenceGainDb: 2.2,
          expanderThreshold: 0.00001,
          holdBlocksCount: 9999
        });
      }

      this.disableHardwareNoiseGateOnMic();
    }

    startGovernorLoops() {
      if (this.fastTimer) clearInterval(this.fastTimer);
      if (this.slowTimer) clearInterval(this.slowTimer);

      this.applyImmediatePresetParameters();

      this.fastTimer = setInterval(() => {
        if (!this.audio || !this.engine) return;
        this.disableHardwareNoiseGateOnMic();
        this.ensureStudioMasteringNodesInjected();
        this.runDynamicDeEsserAndHumTracker();
        this.updateSpatialPanningAndMixer();
      }, 140);

      this.slowTimer = setInterval(() => {
        if (!this.audio || !this.engine) return;
        this.healSuspendedAudioNodes();
      }, 1800);
    }

    // =========================================================================
    // HOT-STANDBY P2P WATCHDOG + SEQUENCE GAP BRIDGE + ELASTIC NETEQ
    // =========================================================================
    installCrossCountryElasticAudioHooks() {
      if (!this.audio || this.audio._v65HooksInstalled) return;
      this.audio._v65HooksInstalled = true;

      const origEncode = this.audio.encodeClean16BitPCM.bind(this.audio);

      this.engine.needsQuantumAudioRelay = () => {
        if (!this.engine.localState?.inGame || this.audio.localMicMuted) return false;
        if (this.whisperTargetId) return true;
        return this.engine.remoteDevices.size > 0;
      };

      this.audio.encodeClean16BitPCM = (float32Samples, sourceRate, gainScale = 1.0) => {
        if (this.rafaelBgEnabled && this.rafaelHistoryRecording) {
          this.feedSamplesToRafaelSTT(float32Samples, sourceRate);
        }

        if (this.currentVoiceMorph === 'titan') {
          let subSign = 1;
          let prevZeroCross = false;
          for (let i = 0; i < float32Samples.length; i++) {
            const s = float32Samples[i];
            if ((s >= 0 && !prevZeroCross) || (s < 0 && prevZeroCross)) {
              prevZeroCross = !prevZeroCross;
              if (prevZeroCross) subSign = -subSign;
            }
            float32Samples[i] = Math.max(-1, Math.min(1, s * 0.78 + Math.abs(s) * subSign * 0.35));
          }
        }

        if (this.adpcm24kEnabled) {
          return this.encodeImaAdpcmPacket(float32Samples, sourceRate, gainScale);
        }
        return origEncode(float32Samples, sourceRate, gainScale);
      };

      this.audio.ingestQuantumAudioPacket = (remoteId, pkt) => {
        if (!pkt || !pkt.d) return;
        if (pkt.to && pkt.to !== this.engine.deviceId) return;

        const isDirectWhisperToMe = !!(pkt.to && pkt.to === this.engine.deviceId);
        const peerCh = this.audio.getOrCreatePeerChannel(remoteId);

        if (peerCh.verifiedP2PAudio && !isDirectWhisperToMe) {
          const lastP2PVoice = this.peerLastP2PActiveAt.get(remoteId) || 0;
          const p2pDeliveringNow = (performance.now() - lastP2PVoice) < 220;
          if (p2pDeliveringNow) {
            return;
          }
        }

        const ctx = this.audio.ensureContext();
        const now = ctx.currentTime;
        const wallNow = performance.now();
        const lastWall = this.peerLastPacketWallClock.get(remoteId) || 0;
        const wallGapMs = wallNow - lastWall;
        this.peerLastPacketWallClock.set(remoteId, wallNow);

        let floatData = null;
        if (pkt.d.charCodeAt(0) === 33) {
          floatData = this.decodeImaAdpcmToFloat32(pkt.d.substring(1));
        } else {
          floatData = this.decodeLegacyPcm16ToFloat32(pkt.d);
        }
        if (!floatData || floatData.length < 16) return;

        this.audio.telemetry.packetsReceived++;
        const len = floatData.length;
        const sampleRate = pkt.sr || (pkt.d.charCodeAt(0) === 33 ? 24000 : 16000);

        let sumAbs = 0;
        for (let i = 0; i < len; i += 2) sumAbs += Math.abs(floatData[i]);
        const avgAmp = sumAbs / (len / 2);
        this.peerVoiceEnergy.set(remoteId, Math.min(1.0, avgAmp * 8.5));

        const prevSeq = this.peerLastSeqMap.get(remoteId);
        const seqGap = (pkt.seq !== undefined && prevSeq !== undefined) ? (pkt.seq - prevSeq) : 1;
        if (pkt.seq !== undefined) {
          this.peerLastSeqMap.set(remoteId, pkt.seq);
        }

        if (!peerCh.nextPlayTime || peerCh.nextPlayTime < now) {
          const underrunSec = peerCh.nextPlayTime ? (now - peerCh.nextPlayTime) : 999;

          if (underrunSec < 0.450 && wallGapMs < 550) {
            if (underrunSec > 0.008 && Math.abs(peerCh.lastSample || 0) > 0.0008) {
              try {
                const plcDuration = Math.min(0.055, underrunSec);
                const plcLen = Math.max(8, Math.floor(sampleRate * plcDuration));
                const plcBuf = ctx.createBuffer(1, plcLen, sampleRate);
                const plcData = plcBuf.getChannelData(0);
                const startVal = peerCh.lastSample || 0;
                const endVal = floatData[0] || 0;
                for (let i = 0; i < plcLen; i++) {
                  const mu = i / plcLen;
                  plcData[i] = startVal * (1 - mu) + endVal * mu * 0.5;
                }
                const plcSrc = ctx.createBufferSource();
                plcSrc.buffer = plcBuf;
                plcSrc.connect(peerCh.gainNode);
                plcSrc.start(now);
              } catch (_) {}
            }
            peerCh.nextPlayTime = now + 0.018;
          } else {
            peerCh.nextPlayTime = now + (this.audio.tuning.jitterPrebufferSec || 0.105);
            for (let i = 0; i < 24; i++) floatData[i] *= (i / 24);
          }
        } else if (seqGap > 1 && seqGap <= 3 && Math.abs(peerCh.lastSample || 0) > 0.001) {
          try {
            const bridgeLen = Math.floor(sampleRate * 0.018);
            const bridgeBuf = ctx.createBuffer(1, bridgeLen, sampleRate);
            const bridgeData = bridgeBuf.getChannelData(0);
            const s0 = peerCh.lastSample || 0;
            const s1 = floatData[0] || 0;
            for (let i = 0; i < bridgeLen; i++) {
              const t = i / bridgeLen;
              bridgeData[i] = s0 * (1 - t) + s1 * t;
            }
            const bSrc = ctx.createBufferSource();
            bSrc.buffer = bridgeBuf;
            bSrc.connect(peerCh.gainNode);
            bSrc.start(peerCh.nextPlayTime);
            peerCh.nextPlayTime += bridgeBuf.duration;
          } catch (_) {}
        }

        const delta = (peerCh.lastSample || 0) - floatData[0];
        if (Math.abs(delta) > 0.0002) {
          const crossLen = Math.min(28, len);
          for (let i = 0; i < crossLen; i++) {
            floatData[i] += delta * (1 - i / crossLen);
          }
        }
        peerCh.lastSample = floatData[len - 1];

        const queueAheadSec = peerCh.nextPlayTime - now;
        let playbackRate = 1.0;
        if (queueAheadSec > 0.580) {
          playbackRate = 1.08;
        } else if (queueAheadSec > 0.340) {
          playbackRate = 1.04;
        }

        if (queueAheadSec > 1.8) {
          peerCh.nextPlayTime = now + 0.120;
          this.audio.telemetry.bufferResetsCount++;
        }

        const audioBuf = ctx.createBuffer(1, len, sampleRate);
        audioBuf.getChannelData(0).set(floatData);

        const bufSource = ctx.createBufferSource();
        bufSource.buffer = audioBuf;
        bufSource.playbackRate.value = playbackRate;
        bufSource.connect(peerCh.gainNode);

        peerCh.activeNodes.push(bufSource);
        bufSource.onended = () => {
          const idx = peerCh.activeNodes.indexOf(bufSource);
          if (idx !== -1) peerCh.activeNodes.splice(idx, 1);
        };

        bufSource.start(peerCh.nextPlayTime);
        peerCh.nextPlayTime += (audioBuf.duration / playbackRate);

        if (avgAmp > 0.003) {
          peerCh.quantumSpeakingUntil = Date.now() + Math.round(audioBuf.duration * 1000) + 240;
        }
      };
    }

    decodeLegacyPcm16ToFloat32(b64) {
      try {
        const binary = atob(b64);
        const byteLen = binary.length;
        if (byteLen < 4) return null;
        const bytes = new Uint8Array(byteLen);
        for (let i = 0; i < byteLen; i++) bytes[i] = binary.charCodeAt(i);
        const int16 = new Int16Array(bytes.buffer);
        const floatData = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          floatData[i] = int16[i] / 32768.0;
        }
        return floatData;
      } catch (_) {
        return null;
      }
    }

    // =========================================================================
    // ФОНОВИЙ ЗАПИС ІСТОРІЇ ДЛЯ ІРМІНСУЛЯ
    // =========================================================================
    onRawAudioChunkForSTT(callback) {
      if (typeof callback === 'function') {
        this.rawSttCallbacks.add(callback);
      }
    }

    feedSamplesToRafaelSTT(float32Samples, sourceRate) {
      if (!this.rafaelBgEnabled || !this.rafaelHistoryRecording || this.rawSttCallbacks.size === 0) return;

      const targetSr = 16000;
      const ratio = sourceRate / targetSr;
      const outLen = Math.floor(float32Samples.length / ratio);
      const chunk = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        chunk[i] = float32Samples[Math.floor(i * ratio)];
      }

      this.sttAccumulator.push(chunk);
      this.sttAccumulatorSamples += outLen;

      if (this.sttAccumulatorSamples >= 16000) {
        const merged = new Float32Array(this.sttAccumulatorSamples);
        let offset = 0;
        for (let i = 0; i < this.sttAccumulator.length; i++) {
          merged.set(this.sttAccumulator[i], offset);
          offset += this.sttAccumulator[i].length;
        }
        this.sttAccumulator = [];
        this.sttAccumulatorSamples = 0;

        this.rawSttCallbacks.forEach((cb) => {
          try {
            cb({
              speakerId: this.engine?.deviceId,
              speakerName: this.engine?.localState?.name || 'Гравець',
              sampleRate: targetSr,
              samples: merged
            });
          } catch (_) {}
        });
      }
    }

    setRafaelSttListening(enabled) {
      this.rafaelHistoryRecording = !!enabled;
      if (this.rafaelHistoryRecording && !this.rafaelBgEnabled) {
        this.rafaelBgEnabled = true;
      }

      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!this.rafaelHistoryRecording) {
        if (this.speechRecognizer) {
          try { this.speechRecognizer.onend = null; this.speechRecognizer.stop(); } catch (_) {}
          this.speechRecognizer = null;
        }
        this.syncCleanGmPanelUI();
        return false;
      }

      if (!SpeechRec) {
        this.syncCleanGmPanelUI();
        return true;
      }

      try {
        const rec = new SpeechRec();
        rec.lang = 'uk-UA';
        rec.continuous = true;
        rec.interimResults = false;

        rec.onresult = (event) => {
          if (!this.rafaelBgEnabled || !this.rafaelHistoryRecording) return;
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            if (!res.isFinal) continue;
            const transcript = (res[0]?.transcript || '').trim();
            if (!transcript) continue;
            const speaker = this.engine?.localState?.name || 'Майстер (GM)';
            this.appendChronicleEntry(speaker, transcript);
          }
        };

        rec.onerror = () => {};
        rec.onend = () => {
          if (this.rafaelHistoryRecording && this.rafaelBgEnabled) {
            setTimeout(() => {
              try { rec.start(); } catch (_) {}
            }, 400);
          }
        };

        rec.start();
        this.speechRecognizer = rec;
        this.syncCleanGmPanelUI();
        return true;
      } catch (_) {
        this.syncCleanGmPanelUI();
        return false;
      }
    }

    // Заглушки для зворотної сумісності зі старими викликами (без старої озвучки в центрі столу)
    playExternalAudioBlobAsRafael() {}
    injectExternalTtsAudioAsRafael() {}
    playRafaelVoiceResponse() {}
    stopRafaelSpeechImmediately() {}

    // =========================================================================
    // КЕРУВАННЯ ПАРАМЕТРАМИ ТА СТУДІЙНИМ МІКШЕРОМ
    // =========================================================================
    setPresetMode(mode) {
      this.presetMode = mode || 'global';
      this.saveSettings();
      this.applyImmediatePresetParameters();
    }

    setSpatialEnabled(enabled) {
      this.spatialEnabled = !!enabled;
      this.saveSettings();
      this.updateSpatialPanningAndMixer();
    }

    setGmPriorityEnabled(enabled) {
      this.gmPriorityEnabled = !!enabled;
      this.saveSettings();
    }

    setDuganAutomixEnabled(enabled) {
      this.duganAutomixEnabled = !!enabled;
      this.saveSettings();
    }

    setAdpcm24kEnabled(enabled) {
      this.adpcm24kEnabled = !!enabled;
      this.saveSettings();
      if (this.audio) {
        this.audio.applyOptimizerPatch({
          targetSampleRate: this.adpcm24kEnabled ? 24000 : 16000
        });
      }
    }

    setAcousticSpace(spaceName) {
      this.currentAcousticSpace = spaceName || 'dry';
      this.applyAcousticAndMorphToNodes();
    }

    setVoiceMorph(morphName) {
      this.currentVoiceMorph = morphName || 'normal';
      this.applyAcousticAndMorphToNodes();
    }

    setWhisperTarget(targetPeerId = null, forceState = undefined) {
      if (forceState === true) {
        this.whisperTargetId = targetPeerId;
      } else if (forceState === false) {
        this.whisperTargetId = null;
      } else {
        this.whisperTargetId = (this.whisperTargetId === targetPeerId) ? null : (targetPeerId || null);
      }

      if (this.audio && this.audio.processedMicStream) {
        const pubAllow = !this.whisperTargetId && !this.audio.localMicMuted;
        this.audio.processedMicStream.getAudioTracks().forEach((t) => {
          t.enabled = pubAllow;
        });
      }

      if (this.engine && this.engine.publishRoomPacket) {
        const targetName = this.whisperTargetId
          ? (this.engine.remoteDevices.get(this.whisperTargetId)?.name || 'Гравцю')
          : null;
        this.engine.publishRoomPacket({
          type: 'WHISPER_STATE',
          from: this.engine.deviceId,
          to: this.whisperTargetId,
          targetName
        });
      }

      return this.whisperTargetId;
    }

    setPlayerCustomVolume(remoteId, playerName, volumeRatio) {
      const clamped = Math.max(0, Math.min(2.0, Number(volumeRatio)));
      const key = playerName ? `name:${playerName}` : `id:${remoteId}`;
      this.customPeerVolumes[key] = clamped;
      this.customPeerVolumes[`id:${remoteId}`] = clamped;
      this.saveMixerVolumes();

      if (this.audio) {
        const peerCh = this.audio.getOrCreatePeerChannel(remoteId);
        peerCh.volume = clamped;
      }
    }

    getPlayerCustomVolume(remoteId, playerName) {
      const byName = playerName ? this.customPeerVolumes[`name:${playerName}`] : undefined;
      if (byName !== undefined) return byName;
      const byId = this.customPeerVolumes[`id:${remoteId}`];
      return byId !== undefined ? byId : 1.0;
    }

    getPeerVoiceEnergy(peerId) {
      return this.peerVoiceEnergy.get(peerId) || 0;
    }

    playProceduralSoundEffect(sfxType, broadcast = false) {
      const ctx = this.audio?.ensureContext();
      if (!ctx) return;

      if (broadcast && this.engine && this.engine.publishRoomPacket) {
        this.engine.publishRoomPacket({
          type: 'SFX_TRIGGER',
          sfx: sfxType,
          from: this.engine.deviceId
        });
      }

      const now = ctx.currentTime;
      const outBus = this.audio.masterGain || ctx.destination;

      if (sfxType === 'heartbeat') {
        [0, 0.28, 0.95, 1.23].forEach((offset, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const startFreq = idx % 2 === 0 ? 68 : 54;
          osc.frequency.setValueAtTime(startFreq, now + offset);
          osc.frequency.exponentialRampToValueAtTime(28, now + offset + 0.18);

          gain.gain.setValueAtTime(0.001, now + offset);
          gain.gain.linearRampToValueAtTime(idx % 2 === 0 ? 0.65 : 0.45, now + offset + 0.025);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.22);

          osc.connect(gain);
          gain.connect(outBus);
          if (this.blackboxDest) gain.connect(this.blackboxDest);
          osc.start(now + offset);
          osc.stop(now + offset + 0.24);
        });
      } else if (sfxType === 'thunder') {
        const dur = 2.6;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const data = buf.getChannelData(0);
        let b0 = 0;
        for (let i = 0; i < data.length; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.96 * b0 + 0.04 * white;
          const t = i / data.length;
          const burst = i < ctx.sampleRate * 0.08 ? 1.5 : Math.pow(1 - t, 1.8);
          data[i] = b0 * burst * 2.2;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;

        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(950, now);
        lpf.frequency.exponentialRampToValueAtTime(110, now + dur);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.75, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + dur);

        src.connect(lpf);
        lpf.connect(gain);
        gain.connect(outBus);
        if (this.blackboxDest) gain.connect(this.blackboxDest);
        src.start(now);
      } else if (sfxType === 'bell') {
        const ratios = [1.0, 2.0, 2.756, 4.07, 5.404];
        const baseFreq = 293.66;
        ratios.forEach((r, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = i === 0 ? 'sine' : 'triangle';
          osc.frequency.value = baseFreq * r;

          const dur = 3.2 / (i * 0.65 + 1);
          const amp = 0.28 / (i + 1);
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(amp, now + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0008, now + dur);

          osc.connect(gain);
          gain.connect(outBus);
          if (this.blackboxDest) gain.connect(this.blackboxDest);
          osc.start(now);
          osc.stop(now + dur + 0.05);
        });
      } else if (sfxType === 'drone') {
        if (this.abyssDroneNodes) {
          const { gain, osc1, osc2 } = this.abyssDroneNodes;
          gain.gain.setTargetAtTime(0.0001, now, 0.35);
          setTimeout(() => {
            try { osc1.stop(); osc2.stop(); } catch (_) {}
          }, 1200);
          this.abyssDroneNodes = null;
        } else {
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const lpf = ctx.createBiquadFilter();
          const gain = ctx.createGain();

          osc1.type = 'sawtooth';
          osc2.type = 'triangle';
          osc1.frequency.value = 64.0;
          osc2.frequency.value = 67.2;

          lpf.type = 'lowpass';
          lpf.frequency.value = 165;

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.setTargetAtTime(0.16, now, 0.8);

          osc1.connect(lpf);
          osc2.connect(lpf);
          lpf.connect(gain);
          gain.connect(outBus);

          osc1.start(now);
          osc2.start(now);
          this.abyssDroneNodes = { osc1, osc2, gain };
        }
      }
    }

    initBlackboxRecorder() {
      if (this.blackboxRecorder || !window.MediaRecorder) return;
      const ctx = this.audio?.ensureContext();
      if (!ctx || !ctx.createMediaStreamDestination) return;

      try {
        this.blackboxDest = ctx.createMediaStreamDestination();
        if (this.audio.masterGain) this.audio.masterGain.connect(this.blackboxDest);
        if (this.audio.micMuteGainNode) this.audio.micMuteGainNode.connect(this.blackboxDest);

        const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
        this.blackboxMimeType = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || '';

        const rec = this.blackboxMimeType
          ? new MediaRecorder(this.blackboxDest.stream, { mimeType: this.blackboxMimeType })
          : new MediaRecorder(this.blackboxDest.stream);

        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            if (!this.blackboxHeaderChunk) {
              this.blackboxHeaderChunk = e.data;
            } else {
              this.blackboxChunks.push(e.data);
              if (this.blackboxChunks.length > 30) this.blackboxChunks.shift();
            }
          }
        };

        rec.start(1000);
        this.blackboxRecorder = rec;
      } catch (_) {}
    }

    saveLast30SecondsHighlight() {
      if (!this.blackboxHeaderChunk && this.blackboxChunks.length === 0) return false;
      try {
        const parts = this.blackboxHeaderChunk
          ? [this.blackboxHeaderChunk, ...this.blackboxChunks]
          : [...this.blackboxChunks];

        const blob = new Blob(parts, { type: this.blackboxMimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
        a.href = url;
        a.download = `vitruvius-highlight-${stamp}.webm`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return true;
      } catch (_) {
        return false;
      }
    }

    getOrBuildImpulseBuffer(type) {
      if (this.impulseCache.has(type)) return this.impulseCache.get(type);
      const ctx = this.audio?.ctx;
      if (!ctx) return null;

      const sr = ctx.sampleRate;
      const durationSec = type === 'cathedral' ? 2.8 : 1.45;
      const decayRate = type === 'cathedral' ? 2.4 : 4.2;
      const len = Math.floor(sr * durationSec);
      const impulse = ctx.createBuffer(1, len, sr);
      const data = impulse.getChannelData(0);

      let lpState = 0;
      const damping = type === 'cathedral' ? 0.35 : 0.55;

      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decayRate);
        const white = (Math.random() * 2 - 1);
        lpState = lpState * damping + white * (1 - damping);
        const earlyBoost = i < sr * 0.065 && (i % 180 === 0) ? 1.6 : 1.0;
        data[i] = lpState * env * earlyBoost * 0.65;
      }

      this.impulseCache.set(type, impulse);
      return impulse;
    }

    makeDistortionCurve(amount = 28) {
      const n = 4096;
      const curve = new Float32Array(n);
      const deg = Math.PI / 180;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
      }
      return curve;
    }

    applyAcousticAndMorphToNodes() {
      if (!this.injectedMicNodes || !this.audio?.ctx) return;
      const now = this.audio.ctx.currentTime;
      const {
        dryGain,
        wetReverbGain,
        convolver,
        fxBandpass,
        fxShaper,
        fxAbyssLow,
        morphFormantFilter,
        ringModDepthGain,
        chorusWetGain
      } = this.injectedMicNodes;

      dryGain.gain.setTargetAtTime(1.0, now, 0.04);
      wetReverbGain.gain.setTargetAtTime(0.0, now, 0.04);
      fxBandpass.type = 'allpass';
      fxBandpass.frequency.setTargetAtTime(1000, now