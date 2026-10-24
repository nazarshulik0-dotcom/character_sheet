/**
 * ============================================================================
 * AETHER NETWORK OPTIMIZER (aether_network_optimizer.js) - v6.4.1 VITRUVIUS
 * ----------------------------------------------------------------------------
 * ФІКС ВІДОБРАЖЕННЯ КНОПКИ «🚪 ВИЙТИ З ЕТЕРУ» ТА МІКШЕРА:
 *   1. Розумний пошук кнопки «В Етері (Оновити потік)» та картки годинника 00:00
 *      незалежно від ID у HTML.
 *   2. Кнопки «🚪 Вийти з Етеру» та «🎚️ Мікшер гучності» тепер ЗАВЖДИ видимі
 *      прямо під зеленою кнопкою «В Етері (Оновити потік)».
 *   3. Мікшер (0%–200%) доступний кожному гравцю, а адмін-функції (Рафаель,
 *      Саундпад, Морфер, Шепіт, Адмін-чат) — виключно Майстру (GM).
 *   4. Міжкраїнний стабілізатор (Staggered Dual-Broker 18 ms + 55 ms WebRTC).
 * ============================================================================
 */

(function (window) {
  'use strict';

  const RAFAEL_VIRTUAL_ID = 'node_rafael_ai';
  const RAFAEL_CENTER_SEAT = 'table_center';
  const RAFAEL_VALID_STATES = ['Idle', 'Listening', 'Working', 'Speaking', 'Error'];

  const SECONDARY_BROKERS = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt'
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

  class AetherNetworkOptimizer {
    constructor() {
      this.engine = null;
      this.timer = null;
      this.lastIceRestartByPeer = new Map();
      this.lastAudioPacketSentAt = 0;

      this.dualBrokerEnabled = true;
      this.secondaryAudioClient = null;
      this.currentMirroredRoom = null;
      this.txSeqCounter = 1;
      this.seenPacketSignatures = new Set();
      this.seenSignatureQueue = [];
      this.dualPacketsRecovered = 0;

      this.activeWhispersMap = new Map();
      this.hudPanel = null;
      this.leaveBtnEl = null;
      this.quickMixerBtnEl = null;
      this.mainAetherBtnEl = null;

      this.pttActiveByHotkey = false;
      this.ptwActiveSeatNum = null;

      this.rafaelActive = false;
      this.rafaelState = 'Idle';
      this.externalLlmHandler = null;
      this.rafaelCommandCallbacks = new Set();
      this.rafaelStateCallbacks = new Set();
      this.gmPromptHints = [];

      this.partySheetsByPeer = new Map();
      this.recentChatHistory = [];

      this.gmChatTabMode = 'public';
      this.gmTabBarEl = null;
      this.gmAdminLogEl = null;
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.exposeGlobalRafaelBridge();
      this.installDualBrokerWhisperAndCrossCountryHooks();
      this.connectSecondaryMirrorBroker();
      this.setupTacticalHotkeys();
      this.syncLocalCharacterSheetToRoom();
      this.buildTacticalHudOverlay();
      this.mountLeaveAetherAndMixerButtons();
      this.mountGmAdminChatTab();
      this.startNetworkGovernorLoop();

      this.engine.log('🌐 [NetworkOptimizer v6.4.1] Кнопка «🚪 Вийти з Етеру» та Мікшер закріплені у правій панелі.');
    }

    isLocalUserGM() {
      return this.engine?.localState?.role === 'gm';
    }

    // =========================================================================
    // 1. НАДІЙНИЙ ПОШУК КНОПКИ «В ЕТЕРІ» ТА МОНТАЖ КНОПКИ «🚪 ВИЙТИ З ЕТЕРУ»
    // =========================================================================
    findMainAetherJoinButton() {
      if (this.mainAetherBtnEl && document.body.contains(this.mainAetherBtnEl)) {
        return this.mainAetherBtnEl;
      }

      // 1. Пошук за можливими ID
      const knownIds = [
        'btn-join-aether',
        'btn-enter-aether',
        'btn-go-live',
        'btn-aether-join',
        'btn-start-aether',
        'btn-connect-aether'
      ];
      for (const id of knownIds) {
        const el = document.getElementById(id);
        if (el) {
          this.mainAetherBtnEl = el;
          return el;
        }
      }

      // 2. Пошук серед усіх кнопок за текстом («В Етері», «Вийти в Етер», «Оновити потік»)
      const allButtons = Array.from(document.querySelectorAll('button'));
      const byText = allButtons.find((b) => {
        const txt = (b.textContent || '').toLowerCase();
        return (
          (txt.includes('в етері') || txt.includes('вийти в етер') || txt.includes('оновити потік')) &&
          b.id !== 'btn-leave-aether' &&
          b.id !== 'btn-open-personal-mixer'
        );
      });
      if (byText) {
        this.mainAetherBtnEl = byText;
        return byText;
      }

      return null;
    }

    mountLeaveAetherAndMixerButtons() {
      if (document.getElementById('vitruvius-session-action-row')) return;

      const mainBtn = this.findMainAetherJoinButton();
      const clockEl = document.getElementById('session-clock');
      const micBtn = document.getElementById('btn-mic-toggle');

      // Знаходимо контейнер у правій нижній картці (біля кнопки «В Етері» або годинника 00:26)
      let anchorEl = mainBtn;
      if (!anchorEl && micBtn) anchorEl = micBtn.parentElement;
      if (!anchorEl && clockEl) anchorEl = clockEl.parentElement;
      if (!anchorEl) return;

      const actionRow = document.createElement('div');
      actionRow.id = 'vitruvius-session-action-row';
      actionRow.style.cssText = `
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-top: 6px;
        margin-bottom: 6px;
        width: 100%;
      `;

      // Кнопка 1: «🚪 Вийти з Етеру» (ЗАВЖДИ ВИДИМА)
      const leaveBtn = document.createElement('button');
      leaveBtn.type = 'button';
      leaveBtn.id = 'btn-leave-aether';
      leaveBtn.className = 'small-btn';
      leaveBtn.style.cssText = `
        width: 100%;
        padding: 8px 6px;
        font-size: 11px;
        font-weight: 700;
        border-radius: 8px;
        border: 1px solid rgba(248, 113, 113, 0.65);
        color: #fecaca;
        background: rgba(153, 27, 27, 0.45);
        cursor: pointer;
        transition: all 0.2s ease;
      `;
      leaveBtn.textContent = '🚪 Вийти з Етеру';

      // Кнопка 2: «🎚️ Мікшер гучності» (ЗАВЖДИ ВИДИМА І ГРАВЦЯМ, І МАЙСТРУ)
      const mixerBtn = document.createElement('button');
      mixerBtn.type = 'button';
      mixerBtn.id = 'btn-open-personal-mixer';
      mixerBtn.className = 'small-btn';
      mixerBtn.style.cssText = `
        width: 100%;
        padding: 8px 6px;
        font-size: 11px;
        font-weight: 700;
        border-radius: 8px;
        border: 1px solid rgba(52, 211, 153, 0.55);
        color: #6ee7b7;
        background: rgba(6, 78, 59, 0.45);
        cursor: pointer;
        transition: all 0.2s ease;
      `;
      mixerBtn.textContent = '🎚️ Мікшер звуку';

      actionRow.appendChild(leaveBtn);
      actionRow.appendChild(mixerBtn);

      // Вставляємо одразу після зеленої кнопки «В Етері (Оновити потік)»
      anchorEl.insertAdjacentElement('afterend', actionRow);

      this.leaveBtnEl = leaveBtn;
      this.quickMixerBtnEl = mixerBtn;

      leaveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.leaveAetherBroadcast();
      });

      mixerBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleHudPanel();
      });

      if (mainBtn && !mainBtn._leaveHooked) {
        mainBtn._leaveHooked = true;
        mainBtn.addEventListener('click', () => {
          setTimeout(() => this.syncLeaveButtonVisibility(), 300);
        });
      }

      this.syncLeaveButtonVisibility();
    }

    leaveAetherBroadcast() {
      if (!this.engine) return;

      try {
        window.AetherOptimizers.audio?.setWhisperTarget(null, false);

        // 1. Вимикаємо камеру
        if (this.engine.video) {
          if (typeof this.engine.video.stopCamera === 'function') {
            this.engine.video.stopCamera();
          } else if (this.engine.video.stream) {
            this.engine.video.stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
            this.engine.video.stream = null;
          }
          this.engine.video.cameraEnabled = false;
        }

        // 2. Вимикаємо мікрофон та очищаємо аудіо-черги
        if (this.engine.audio) {
          this.engine.audio.localMicMuted = true;
          if (this.engine.audio.rawMicStream) {
            this.engine.audio.rawMicStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
            this.engine.audio.rawMicStream = null;
          }
          if (this.engine.audio.processedMicStream) {
            this.engine.audio.processedMicStream.getTracks().forEach((t) => { t.enabled = false; });
          }
          this.engine.audio.peerChannels.forEach((ch) => {
            if (ch.activeNodes) {
              ch.activeNodes.forEach((n) => { try { n.stop(); n.disconnect(); } catch (_) {} });
              ch.activeNodes.length = 0;
            }
            if (ch.audioEl) {
              try { ch.audioEl.pause(); ch.audioEl.srcObject = null; } catch (_) {}
            }
            ch.verifiedP2PAudio = false;
          });
        }

        // 3. Закриваємо всі активні WebRTC P2P з'єднання
        if (this.engine.peers) {
          this.engine.peers.forEach((peerObj) => {
            try { peerObj.pc?.close(); } catch (_) {}
          });
          this.engine.peers.clear();
        }

        // 4. Оновлюємо стан: користувач вийшов з етеру
        if (this.engine.localState) {
          this.engine.localState.inGame = false;
          this.engine.localState.hasAudio = false;
          this.engine.localState.hasVideo = false;
          this.engine.localState.mediaRev = (this.engine.localState.mediaRev || 1) + 1;
        }

        if (typeof this.engine.broadcastPresence === 'function') {
          this.engine.broadcastPresence(true);
        } else if (this.engine.publishRoomPacket) {
          this.engine.publishRoomPacket({
            type: 'STATE',
            state: this.engine.localState
          });
        }

        // 5. Оновлюємо головну кнопку «В Етері» на «⚡ Вийти в Етер»
        const mainBtn = this.findMainAetherJoinButton();
        if (mainBtn) {
          mainBtn.textContent = '⚡ Вийти в Етер';
          mainBtn.classList.remove('active', 'in-air');
        }

        const mySeat = this.engine.localState?.seat;
        if (mySeat) {
          const seatNode = document.getElementById(`seat-${mySeat}`);
          if (seatNode) {
            seatNode.classList.remove('has-video', 'show-webrtc-video', 'show-relay-video', 'speaking');
          }
          const statusEl = document.getElementById(`status-${mySeat}`);
          if (statusEl) statusEl.textContent = 'Поза етером';
        }

        this.engine.notifyStateChanged?.();
        this.syncLeaveButtonVisibility();
        this.engine.log('🚪 Ви вийшли з Етеру. Мікрофон та камеру вимкнено.');
      } catch (_) {}
    }

    syncLeaveButtonVisibility() {
      // Якщо панель ще не змонтована — монтуємо її
      if (!document.getElementById('vitruvius-session-action-row')) {
        this.mountLeaveAetherAndMixerButtons();
      }

      if (this.leaveBtnEl && this.engine) {
        const inAir = !!(this.engine.localState && this.engine.localState.inGame);
        this.leaveBtnEl.style.opacity = inAir ? '1' : '0.65';
        this.leaveBtnEl.textContent = inAir ? '🚪 Вийти з Етеру' : '🚪 Поза Етером';
      }

      if (this.quickMixerBtnEl) {
        const isGM = this.isLocalUserGM();
        this.quickMixerBtnEl.textContent = isGM ? '👑 Пульт і Мікшер' : '🎚️ Мікшер звуку';
      }
    }

    // =========================================================================
    // 2. ПРИХОВАНА АДМІН-ВКЛАДКА ДЛЯ МАЙСТРА В ПАНЕЛІ ЧАТУ («⚡ АДМІН / РАФАЕЛЬ»)
    // =========================================================================
    mountGmAdminChatTab() {
      const chatLog = document.getElementById('chat-log');
      const chatInput = document.getElementById('chat-input');
      const chatSendBtn = document.getElementById('btn-chat-send');
      if (!chatLog || !chatLog.parentElement || document.getElementById('vitruvius-gm-chat-tabs')) return;

      const parentCard = chatLog.parentElement;

      const tabBar = document.createElement('div');
      tabBar.id = 'vitruvius-gm-chat-tabs';
      tabBar.style.cssText = `
        display: none;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        margin-bottom: 6px;
      `;
      tabBar.innerHTML = `
        <button type="button" data-tab="public" class="small-btn active" style="font-size:10px;padding:4px 6px;">💬 Чат столу</button>
        <button type="button" data-tab="admin" class="small-btn" style="font-size:10px;padding:4px 6px;border-color:rgba(34,211,238,0.45);color:#67e8f9;">⚡ Адмін / Рафаель</button>
      `;

      const adminLog = document.createElement('div');
      adminLog.id = 'vitruvius-gm-admin-log';
      adminLog.className = chatLog.className;
      adminLog.style.cssText = `
        display: none;
        flex: 1;
        overflow-y: auto;
        background: rgba(6, 20, 30, 0.65);
        border: 1px solid rgba(34, 211, 238, 0.35);
        border-radius: 8px;
        padding: 8px;
        font-size: 11px;
      `;
      adminLog.innerHTML = `
        <div style="color:#67e8f9;margin-bottom:6px;line-height:1.4;">
          <b>⚡ [Термінал Майстра — Вітрувій]</b><br/>
          Приватний канал керування Рафаелем (невидимий для гравців):<br/>
          • <code>/on</code> або <code>/off</code> — увімкнути/вимкнути ядро Рафаеля в центрі столу<br/>
          • <code>!текст</code> — озвучити репліку голосом Рафаеля на стіл<br/>
          • <code>#підказка</code> — додати приховану директиву в пам'ять Рафаеля
        </div>
      `;

      parentCard.insertBefore(tabBar, chatLog);
      parentCard.insertBefore(adminLog, chatLog.nextSibling);

      this.gmTabBarEl = tabBar;
      this.gmAdminLogEl = adminLog;

      const setTab = (mode) => {
        if (!this.isLocalUserGM()) mode = 'public';
        this.gmChatTabMode = mode;

        tabBar.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-tab') === mode);
        });

        if (mode === 'admin') {
          chatLog.style.display = 'none';
          adminLog.style.display = 'block';
          if (chatInput) {
            chatInput.placeholder = 'Команда GM (!репліка, #директива, /on, /off)...';
            chatInput.style.borderColor = '#22d3ee';
          }
        } else {
          chatLog.style.display = '';
          adminLog.style.display = 'none';
          if (chatInput) {
            chatInput.placeholder = 'Відправити повідомлення...';
            chatInput.style.borderColor = '';
          }
        }
      };

      tabBar.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => setTab(btn.getAttribute('data-tab')));
      });

      const interceptAdminSubmit = (e) => {
        if (!this.isLocalUserGM() || this.gmChatTabMode !== 'admin') return;
        if (e.type === 'keydown' && e.key !== 'Enter') return;

        e.preventDefault();
        e.stopImmediatePropagation();

        const raw = (chatInput?.value || '').trim();
        if (!raw) return;
        chatInput.value = '';
        this.handleGmAdminTerminalCommand(raw);
      };

      if (chatInput) chatInput.addEventListener('keydown', interceptAdminSubmit, true);
      if (chatSendBtn) chatSendBtn.addEventListener('click', interceptAdminSubmit, true);

      this.syncRolePermissionsUI();
    }

    appendGmAdminLog(author, text, color = '#a5f3fc') {
      if (!this.gmAdminLogEl) return;
      const line = document.createElement('div');
      line.style.cssText = 'margin-bottom:5px;line-height:1.38;word-break:break-word;';
      line.innerHTML = `<strong style="color:${color};">${author}:</strong> <span style="color:#e2e8f0;">${text}</span>`;
      this.gmAdminLogEl.appendChild(line);
      this.gmAdminLogEl.scrollTop = this.gmAdminLogEl.scrollHeight;
    }

    handleGmAdminTerminalCommand(rawInput) {
      const cmd = rawInput.trim();
      this.appendGmAdminLog('👑 GM', cmd, '#34d399');

      if (cmd === '/on') {
        this.setRafaelVirtualNodeActive(true);
        this.appendGmAdminLog('💠 Система', 'Ядро Рафаеля в центрі столу УВІМКНЕНО.');
        return;
      }
      if (cmd === '/off') {
        this.setRafaelVirtualNodeActive(false);
        this.appendGmAdminLog('💠 Система', 'Ядро Рафаеля ВИМКНЕНО.');
        return;
      }

      if (cmd.startsWith('#')) {
        const hint = cmd.substring(1).trim();
        if (hint) {
          this.gmPromptHints.push(hint);
          this.appendGmAdminLog('🧠 Пам’ять Рафаеля', `Директиву збережено: "${hint}"`);
        }
        return;
      }

      if (!this.rafaelActive) {
        this.appendGmAdminLog('⚠️ Увага', 'Рафаель зараз вимкнений. Напишіть /on або увімкніть «💠 Ядро» у консолі.', '#fbbf24');
        return;
      }

      if (cmd.startsWith('!')) {
        const speechText = cmd.substring(1).trim();
        if (speechText) {
          window.AetherRafaelBridge?.speak(speechText, true);
          this.appendGmAdminLog('💠 Рафаель (Етер)', speechText);
        }
        return;
      }

      window.AetherRafaelBridge?.ask(cmd, 'Майстер (GM)', true);
    }

    syncRolePermissionsUI() {
      const isGM = this.isLocalUserGM();

      if (this.gmTabBarEl) {
        this.gmTabBarEl.style.display = isGM ? 'grid' : 'none';
      }
      if (!isGM && this.gmChatTabMode === 'admin') {
        this.gmChatTabMode = 'public';
        const chatLog = document.getElementById('chat-log');
        if (chatLog) chatLog.style.display = '';
        if (this.gmAdminLogEl) this.gmAdminLogEl.style.display = 'none';
      }

      if (this.hudPanel) {
        this.hudPanel.querySelectorAll('.gm-only-section').forEach((el) => {
          el.style.display = isGM ? (el.dataset.gmDisplay || 'flex') : 'none';
        });
        const titleEl = this.hudPanel.querySelector('#hud-title-text');
        if (titleEl) {
          titleEl.textContent = isGM
            ? '👑 VITRUVIUS GM CONSOLE & MIXER v6.4'
            : '🎚️ ПЕРСОНАЛЬНИЙ МІКШЕР ЗВУКУ v6.4';
        }
      }

      this.syncLeaveButtonVisibility();
    }

    // =========================================================================
    // 3. КОНТЕКСТ СТОЛУ ТА ГЛОБАЛЬНИЙ ШЛЮЗ window.AetherRafaelBridge
    // =========================================================================
    readLocalCharacterData() {
      try {
        const raw = localStorage.getItem('entropia_active_character');
        if (!raw) return null;
        const c = JSON.parse(raw);
        return {
          name: c.name || c.callsign || this.engine?.localState?.name || 'Гравець',
          archetype: c.class || c.pathway || c.archetype || '',
          level: c.level || c.sequence || 1,
          hp: c.hp ?? c.currentHp ?? null,
          maxHp: c.maxHp ?? c.hpMax ?? null
        };
      } catch (_) {
        return null;
      }
    }

    syncLocalCharacterSheetToRoom() {
      const sheet = this.readLocalCharacterData();
      if (!sheet || !this.engine) return;

      this.partySheetsByPeer.set(this.engine.deviceId, sheet);
      if (this.engine.publishRoomPacket) {
        this.engine.publishRoomPacket({
          type: 'CHAR_SHEET_SYNC',
          from: this.engine.deviceId,
          sheet
        });
      }
    }

    getFullTableContext() {
      if (!this.engine) return {};

      const localBio = window.AetherOptimizers.video?.localBiometricState || 'normal';
      const members = [
        {
          peerId: this.engine.deviceId,
          name: this.engine.localState?.name,
          role: this.engine.localState?.role,
          seat: this.engine.localState?.seat,
          biometricState: localBio,
          characterSheet: this.partySheetsByPeer.get(this.engine.deviceId) || this.readLocalCharacterData()
        }
      ];

      this.engine.remoteDevices.forEach((dev, peerId) => {
        if (peerId === RAFAEL_VIRTUAL_ID || dev._isVirtualAI) return;
        const bio = window.AetherOptimizers.video?.peerBiometricStateMap.get(peerId) || 'normal';
        members.push({
          peerId,
          name: dev.name,
          role: dev.role,
          seat: dev.seat,
          inCharacterSheetTab: window.AetherOptimizers.video?.remoteTabHiddenMap.get(peerId) === true,
          biometricState: bio,
          characterSheet: this.partySheetsByPeer.get(peerId) || null
        });
      });

      return {
        system: 'Вітрувій',
        roomId: this.engine.roomId,
        acousticSpace: window.AetherOptimizers.audio?.currentAcousticSpace || 'dry',
        activeMembersCount: members.length,
        members,
        gmDirectives: this.gmPromptHints.slice(-10),
        recentChat: this.recentChatHistory.slice(-12)
      };
    }

    buildSystemPromptForLLM(userQuery, speakerName) {
      const ctx = this.getFullTableContext();
      return [
        'Ти — інтелектуальний асистент «Рафаель» у настільній рольовій системі «Вітрувій».',
        'ВАЖЛИВО: Ніколи не називай себе «Великий Мудрець» і не вживай пафосних вступів на кшталт «активація протоколу». Говори чітко, природно та по суті.',
        `Кімната: ${ctx.roomId}, учасники: ${JSON.stringify(ctx.members)}.`,
        `Приховані директиви Майстра (GM): ${JSON.stringify(ctx.gmDirectives)}.`,
        `Останні репліки чату: ${JSON.stringify(ctx.recentChat)}.`,
        `Запит від @${speakerName}: "${userQuery}"`
      ].join('\n');
    }

    exposeGlobalRafaelBridge() {
      const self = this;

      window.AetherRafaelBridge = {
        VIRTUAL_PEER_ID: RAFAEL_VIRTUAL_ID,
        STATES: RAFAEL_VALID_STATES,

        isActive() {
          return self.rafaelActive;
        },

        spawnVirtualPeer(active = true) {
          if (!self.isLocalUserGM()) return false;
          return self.setRafaelVirtualNodeActive(active);
        },

        setBotState(newState, broadcast = true) {
          if (!self.rafaelActive) return 'Idle';
          return self.setRafaelState(newState, broadcast);
        },

        getBotState() {
          return self.rafaelActive ? self.rafaelState : 'Idle';
        },

        speak(text, sendToChat = true) {
          if (!self.rafaelActive || !text) return false;
          if (sendToChat) {
            self.sendRafaelChatMessage(text);
          }
          window.AetherOptimizers.audio?.playRafaelVoiceResponse(text);
          return true;
        },

        playExternalAudioBlob(blobOrArrayBuffer) {
          if (!self.rafaelActive) return false;
          window.AetherOptimizers.audio?.playExternalAudioBlobAsRafael(blobOrArrayBuffer);
          return true;
        },

        injectTtsAudio(float32Samples, sampleRate = 24000) {
          if (!self.rafaelActive) return false;
          window.AetherOptimizers.audio?.injectExternalTtsAudioAsRafael(float32Samples, sampleRate);
          return true;
        },

        ask(queryText, speakerName = null, fromGmTerminal = false) {
          if (!self.rafaelActive || !queryText) return false;
          const author = speakerName || self.engine?.localState?.name || 'Майстер';
          self.dispatchPlayerSpeechToRafael(author, queryText, true, fromGmTerminal);
          return true;
        },

        connectLLM(asyncHandlerFn) {
          self.externalLlmHandler = typeof asyncHandlerFn === 'function' ? asyncHandlerFn : null;
        },

        getFullTableContext() {
          return self.getFullTableContext();
        },

        buildSystemPrompt(queryText, speakerName = 'Майстер') {
          return self.buildSystemPromptForLLM(queryText, speakerName);
        },

        onCommand(callback) {
          if (typeof callback === 'function') self.rafaelCommandCallbacks.add(callback);
        },

        onStateChange(callback) {
          if (typeof callback === 'function') self.rafaelStateCallbacks.add(callback);
        },

        onRawAudioChunk(callback) {
          window.AetherOptimizers.audio?.onRawAudioChunkForSTT(callback);
        },

        getVoiceEnergy() {
          if (!self.rafaelActive) return 0;
          return window.AetherOptimizers.audio?.getPeerVoiceEnergy(RAFAEL_VIRTUAL_ID) || 0;
        },

        handleRecognizedSpeech(speakerName, transcript, isWakeWord) {
          if (!self.rafaelActive) return;
          self.dispatchPlayerSpeechToRafael(speakerName, transcript, isWakeWord, false);
        }
      };
    }

    setRafaelVirtualNodeActive(active) {
      if (!this.engine || !this.isLocalUserGM()) return false;
      this.rafaelActive = !!active;

      if (this.rafaelActive) {
        const virtualDeviceState = {
          deviceId: RAFAEL_VIRTUAL_ID,
          name: 'Рафаель',
          role: 'ai_assistant',
          seat: RAFAEL_CENTER_SEAT,
          inGame: true,
          hasVideo: false,
          hasAudio: true,
          mediaRev: 1,
          _isVirtualAI: true,
          _rafaelState: this.rafaelState,
          _lastSeen: Date.now() + 3600000
        };

        this.engine.remoteDevices.set(RAFAEL_VIRTUAL_ID, virtualDeviceState);
        this.engine.audio?.getOrCreatePeerChannel(RAFAEL_VIRTUAL_ID);

        if (this.engine.publishRoomPacket) {
          this.engine.publishRoomPacket({
            type: 'RAFAEL_NODE_SYNC',
            active: true,
            botState: this.rafaelState,
            seat: RAFAEL_CENTER_SEAT,
            from: this.engine.deviceId
          });
        }
      } else {
        window.AetherOptimizers.audio?.stopRafaelSpeechImmediately();
        window.AetherOptimizers.audio?.setRafaelSttListening(false);
        this.rafaelState = 'Idle';
        this.engine.remoteDevices.delete(RAFAEL_VIRTUAL_ID);

        if (this.engine.publishRoomPacket) {
          this.engine.publishRoomPacket({
            type: 'RAFAEL_NODE_SYNC',
            active: false,
            botState: 'Idle',
            from: this.engine.deviceId
          });
        }
      }

      this.engine.notifyStateChanged();
      this.refreshTacticalHudContent(true);
      return this.rafaelActive;
    }

    setRafaelState(newState, broadcast = true) {
      if (!this.rafaelActive) return 'Idle';
      const normalized = RAFAEL_VALID_STATES.includes(newState) ? newState : 'Idle';
      this.rafaelState = normalized;

      const botDev = this.engine?.remoteDevices.get(RAFAEL_VIRTUAL_ID);
      if (botDev) {
        botDev._rafaelState = normalized;
        botDev._lastSeen = Date.now() + 3600000;
      }

      if (broadcast && this.engine?.publishRoomPacket) {
        this.engine.publishRoomPacket({
          type: 'RAFAEL_STATE',
          botState: normalized,
          from: this.engine.deviceId
        });
      }

      this.rafaelStateCallbacks.forEach((cb) => {
        try { cb(normalized); } catch (_) {}
      });

      this.refreshTacticalHudContent();
      return normalized;
    }

    sendRafaelChatMessage(text) {
      if (!this.engine || !this.rafaelActive || !text) return;
      this.recentChatHistory.push({ author: 'Рафаель', text, ts: Date.now() });
      this.engine.cb?.onChatMessage?.('Рафаель', text);
      this.engine.publishRoomPacket({
        type: 'CHAT',
        deviceId: RAFAEL_VIRTUAL_ID,
        author: 'Рафаель',
        text
      });
    }

    broadcastRafaelAudioPacket(pkt) {
      if (!this.engine || !this.rafaelActive || !pkt) return;
      pkt.from = RAFAEL_VIRTUAL_ID;

      if (this.engine.mqttClient && this.engine.mqttClient.connected) {
        this.engine.mqttClient.publish(this.engine.audioRelayTopic, JSON.stringify(pkt), { qos: 0, retain: false });
      }
      if (this.dualBrokerEnabled && this.secondaryAudioClient && this.secondaryAudioClient.connected) {
        try {
          this.secondaryAudioClient.publish(this.engine.audioRelayTopic, JSON.stringify(pkt), { qos: 0, retain: false });
        } catch (_) {}
      }
    }

    async dispatchPlayerSpeechToRafael(speakerName, transcript, isWakeWord, fromGmTerminal = false) {
      if (!this.rafaelActive || !transcript) return;

      const tableContext = this.getFullTableContext();
      const systemPrompt = this.buildSystemPromptForLLM(transcript, speakerName);
      const payload = {
        speaker: speakerName,
        text: transcript,
        isWakeWord,
        fromGmTerminal,
        systemPrompt,
        tableContext
      };

      this.rafaelCommandCallbacks.forEach((cb) => {
        try { cb(payload); } catch (_) {}
      });

      if (!isWakeWord) return;

      this.setRafaelState('Working', true);

      if (typeof this.externalLlmHandler === 'function') {
        try {
          const reply = await this.externalLlmHandler(payload);
          if (reply && this.rafaelActive) {
            if (fromGmTerminal) {
              this.appendGmAdminLog('💠 Рафаель', String(reply));
            }
            window.AetherRafaelBridge.speak(String(reply), !fromGmTerminal);
          } else {
            this.setRafaelState('Idle', true);
          }
        } catch (_) {
          this.setRafaelState('Error', true);
          setTimeout(() => this.setRafaelState('Idle', true), 2000);
        }
      } else {
        if (fromGmTerminal) {
          this.appendGmAdminLog(
            '💠 Рафаель',
            'Запит прийнято шлюзом (використайте !текст для прямого озвучення або підключіть LLM).'
          );
        }
        setTimeout(() => {
          if (this.rafaelActive) this.setRafaelState('Idle', true);
        }, 600);
      }
    }

    // =========================================================================
    // 4. ГАРЯЧІ КЛАВІШІ ТА STAGGERED DUAL-BROKER
    // =========================================================================
    isTypingInInput(e) {
      const el = e.target || document.activeElement;
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    }

    findPeerIdBySeatNumber(seatNum) {
      const targetSeat = `seat${seatNum}`;
      for (const [peerId, dev] of this.engine.remoteDevices.entries()) {
        if (dev.seat === targetSeat) return peerId;
      }
      return null;
    }

    setupTacticalHotkeys() {
      window.addEventListener('keydown', (e) => {
        if (this.isTypingInInput(e) || !this.engine) return;

        if (e.altKey && (e.code === 'KeyM' || e.key === 'm' || e.key === 'ь')) {
          e.preventDefault();
          document.getElementById('btn-mic-toggle')?.click();
          return;
        }

        if (this.isLocalUserGM() && e.altKey && /^Digit[1-6]$/.test(e.code)) {
          e.preventDefault();
          const seatNum = parseInt(e.code.replace('Digit', ''), 10);
          if (this.ptwActiveSeatNum === seatNum) return;

          const targetPeerId = this.findPeerIdBySeatNumber(seatNum);
          if (targetPeerId) {
            this.ptwActiveSeatNum = seatNum;
            window.AetherOptimizers.audio?.setWhisperTarget(targetPeerId, true);
            this.renderWhisperBadgesOnSeats();
            this.refreshTacticalHudContent(true);
          }
          return;
        }

        if (!e.altKey && !e.ctrlKey && (e.code === 'Space' || e.code === 'KeyV')) {
          if (this.engine.audio && this.engine.audio.localMicMuted && !this.pttActiveByHotkey) {
            e.preventDefault();
            this.pttActiveByHotkey = true;
            document.getElementById('btn-mic-toggle')?.click();
          }
        }
      });

      window.addEventListener('keyup', (e) => {
        if (!this.engine) return;

        if (this.ptwActiveSeatNum !== null && (/^Digit[1-6]$/.test(e.code) || e.key === 'Alt')) {
          this.ptwActiveSeatNum = null;
          window.AetherOptimizers.audio?.setWhisperTarget(null, false);
          this.renderWhisperBadgesOnSeats();
          this.refreshTacticalHudContent(true);
        }

        if (this.pttActiveByHotkey && (e.code === 'Space' || e.code === 'KeyV')) {
          this.pttActiveByHotkey = false;
          if (this.engine.audio && !this.engine.audio.localMicMuted) {
            document.getElementById('btn-mic-toggle')?.click();
          }
        }
      });
    }

    connectSecondaryMirrorBroker() {
      if (!this.engine || !window.mqtt) return;

      const roomId = this.engine.roomId || 'entropia-1';
      if (this.secondaryAudioClient && this.currentMirroredRoom === roomId) return;

      if (this.secondaryAudioClient) {
        try { this.secondaryAudioClient.end(true); } catch (_) {}
        this.secondaryAudioClient = null;
      }

      this.currentMirroredRoom = roomId;
      const mirrorUrl = SECONDARY_BROKERS[this.engine.brokerIndex % SECONDARY_BROKERS.length];
      const audioTopic = `entropia_ark_317/omega_v5/${roomId}/media`;

      try {
        this.secondaryAudioClient = window.mqtt.connect(mirrorUrl, {
          clientId: 'mirror641_' + this.engine.deviceId + '_' + Math.floor(Math.random() * 9999),
          clean: true,
          connectTimeout: 6000,
          reconnectPeriod: 2500
        });

        this.secondaryAudioClient.on('connect', () => {
          this.secondaryAudioClient.subscribe(audioTopic, { qos: 0 });
        });

        this.secondaryAudioClient.on('message', (topic, payload) => {
          if (topic !== audioTopic) return;
          try {
            const pkt = JSON.parse(payload.toString());
            pkt._viaMirror = true;
            this.engine.handleQuantumRelayPacket(pkt);
          } catch (_) {}
        });
      } catch (_) {}
    }

    installDualBrokerWhisperAndCrossCountryHooks() {
      if (!this.engine || this.engine._v641NetHooksInstalled) return;
      this.engine._v641NetHooksInstalled = true;

      const origPubAudio = this.engine.publishQuantumAudioPacket.bind(this.engine);
      const origPubVideo = this.engine.publishQuantumVideoPacket.bind(this.engine);
      const origHandleRelay = this.engine.handleQuantumRelayPacket.bind(this.engine);
      const origHandleRoom = this.engine.handleRoomMessage.bind(this.engine);
      const origConnectRoom = this.engine.connectRoom.bind(this.engine);
      const origSendChat = this.engine.sendChat.bind(this.engine);
      const origLog = this.engine.log.bind(this.engine);

      this.engine.log = (msg) => {
        if (!this.rafaelActive && /рафаель|rafael|мудрец/i.test(String(msg))) {
          return;
        }
        return origLog(msg);
      };

      this.engine.connectRoom = (roomId) => {
        const res = origConnectRoom(roomId);
        setTimeout(() => {
          this.connectSecondaryMirrorBroker();
          this.syncLocalCharacterSheetToRoom();
        }, 250);
        return res;
      };

      this.engine.sendChat = (text) => {
        this.recentChatHistory.push({ author: this.engine.localState?.name || 'Ви', text, ts: Date.now() });
        if (this.recentChatHistory.length > 30) this.recentChatHistory.shift();
        origSendChat(text);
      };

      this.engine.handleRoomMessage = (msg) => {
        if (!msg) return;

        if (msg.type === 'WHISPER_STATE' && msg.from) {
          if (msg.to) {
            this.activeWhispersMap.set(msg.from, { to: msg.to, targetName: msg.targetName });
          } else {
            this.activeWhispersMap.delete(msg.from);
          }
          this.renderWhisperBadgesOnSeats();
          return;
        }

        if (msg.type === 'CHAR_SHEET_SYNC' && msg.from && msg.sheet) {
          this.partySheetsByPeer.set(msg.from, msg.sheet);
          return;
        }

        if (msg.type === 'RAFAEL_NODE_SYNC' && msg.from !== this.engine.deviceId) {
          this.rafaelState = msg.botState || 'Idle';
          if (msg.active) {
            this.rafaelActive = true;
            this.engine.remoteDevices.set(RAFAEL_VIRTUAL_ID, {
              deviceId: RAFAEL_VIRTUAL_ID,
              name: 'Рафаель',
              role: 'ai_assistant',
              seat: RAFAEL_CENTER_SEAT,
              inGame: true,
              hasVideo: false,
              hasAudio: true,
              mediaRev: 1,
              _isVirtualAI: true,
              _rafaelState: this.rafaelState,
              _lastSeen: Date.now() + 3600000
            });
            this.engine.audio?.getOrCreatePeerChannel(RAFAEL_VIRTUAL_ID);
          } else {
            this.rafaelActive = false;
            this.rafaelState = 'Idle';
            window.AetherOptimizers.audio?.stopRafaelSpeechImmediately();
            this.engine.remoteDevices.delete(RAFAEL_VIRTUAL_ID);
          }
          this.engine.notifyStateChanged();
          this.refreshTacticalHudContent(true);
          return;
        }

        if (msg.type === 'RAFAEL_STATE' && msg.from !== this.engine.deviceId) {
          if (!this.rafaelActive) return;
          this.setRafaelState(msg.botState || 'Idle', false);
          return;
        }

        if (msg.type === 'CHAT' && msg.deviceId === RAFAEL_VIRTUAL_ID && !this.rafaelActive) {
          return;
        }

        if (msg.type === 'CHAT' && msg.text && msg.deviceId !== this.engine.deviceId) {
          this.recentChatHistory.push({ author: msg.author || 'Гравець', text: msg.text, ts: Date.now() });
          if (this.recentChatHistory.length > 30) this.recentChatHistory.shift();
        }

        return origHandleRoom(msg);
      };

      this.engine.publishQuantumAudioPacket = (pkt) => {
        this.lastAudioPacketSentAt = performance.now();
        pkt.seq = this.txSeqCounter++;

        const whisperTo = window.AetherOptimizers.audio?.whisperTargetId || null;
        if (whisperTo) {
          pkt.to = whisperTo;
        }

        origPubAudio(pkt);

        if (this.dualBrokerEnabled && this.secondaryAudioClient && this.secondaryAudioClient.connected) {
          const mirrorPayload = JSON.stringify({
            ...pkt,
            from: this.engine.deviceId
          });
          setTimeout(() => {
            try {
              if (this.secondaryAudioClient && this.secondaryAudioClient.connected) {
                this.secondaryAudioClient.publish(this.engine.audioRelayTopic, mirrorPayload, { qos: 0, retain: false });
              }
            } catch (_) {}
          }, 18);
        }
      };

      this.engine.publishQuantumVideoPacket = (pkt) => {
        const ws = this.engine.mqttClient?.stream?.socket;
        if (ws && ws.bufferedAmount > 12288) {
          return;
        }

        const sinceAudioMs = performance.now() - this.lastAudioPacketSentAt;
        if (sinceAudioMs >= 0 && sinceAudioMs < 14) {
          setTimeout(() => origPubVideo(pkt), 14);
          return;
        }
        return origPubVideo(pkt);
      };

      this.engine.handleQuantumRelayPacket = (pkt) => {
        if (!pkt || !pkt.from || pkt.from === this.engine.deviceId) return;
        if (pkt.to && pkt.to !== this.engine.deviceId) return;
        if (pkt.from === RAFAEL_VIRTUAL_ID && !this.rafaelActive) return;

        if (pkt.seq !== undefined && pkt.t !== 'V') {
          const sig = `${pkt.from}_${pkt.seq}`;
          if (this.seenPacketSignatures.has(sig)) return;
          this.seenPacketSignatures.add(sig);
          this.seenSignatureQueue.push(sig);
          if (this.seenSignatureQueue.length > 900) {
            const oldest = this.seenSignatureQueue.shift();
            this.seenPacketSignatures.delete(oldest);
          }
          if (pkt._viaMirror) {
            this.dualPacketsRecovered++;
          }
        }

        return origHandleRelay(pkt);
      };
    }

    renderWhisperBadgesOnSeats() {
      document.querySelectorAll('.seat-whisper-badge').forEach((el) => el.remove());

      const myWhisperTo = window.AetherOptimizers.audio?.whisperTargetId;
      if (myWhisperTo) {
        const targetDev = this.engine.remoteDevices.get(myWhisperTo);
        if (targetDev && targetDev.seat) {
          const frame = document.getElementById(`frame-${targetDev.seat}`);
          if (frame) {
            const b = document.createElement('div');
            b.className = 'seat-whisper-badge';
            b.textContent = '👁️ Ваш Шепіт';
            frame.appendChild(b);
          }
        }
      }

      this.activeWhispersMap.forEach((info, senderId) => {
        const senderDev = this.engine.remoteDevices.get(senderId);
        if (!senderDev || !senderDev.seat) return;
        const frame = document.getElementById(`frame-${senderDev.seat}`);
        if (!frame) return;

        const b = document.createElement('div');
        b.className = 'seat-whisper-badge';
        b.textContent = info.to === this.engine.deviceId
          ? '👁️ Шепоче Вам!'
          : '👁️ Таємний шепіт...';
        frame.appendChild(b);
      });
    }

    startNetworkGovernorLoop() {
      if (this.timer) clearInterval(this.timer);

      this.timer = setInterval(() => {
        if (!this.engine) return;

        this.syncRolePermissionsUI();

        const rafDev = this.engine.remoteDevices.get(RAFAEL_VIRTUAL_ID);
        if (rafDev) {
          if (this.rafaelActive) {
            rafDev._lastSeen = Date.now() + 3600000;
            rafDev.seat = RAFAEL_CENTER_SEAT;
          } else {
            this.engine.remoteDevices.delete(RAFAEL_VIRTUAL_ID);
          }
        }

        this.optimizePeerConnectionsForCrossCountry();
        this.guardSocketBackpressure();
        this.updateSeatLatencyBadges();
        this.renderWhisperBadgesOnSeats();
        this.refreshTacticalHudContent();
      }, 1200);
    }

    optimizePeerConnectionsForCrossCountry() {
      const now = Date.now();

      this.engine.peers.forEach((peerObj, remoteId) => {
        if (remoteId === RAFAEL_VIRTUAL_ID) return;
        const pc = peerObj.pc;
        if (!pc) return;

        if (typeof pc.getReceivers === 'function') {
          pc.getReceivers().forEach((receiver) => {
            if (receiver.track && receiver.track.kind === 'audio') {
              if ('playoutDelayHint' in receiver && receiver.playoutDelayHint !== 0.055) {
                try { receiver.playoutDelayHint = 0.055; } catch (_) {}
              }
            }
            if (receiver.track && receiver.track.kind === 'video') {
              if ('playoutDelayHint' in receiver && receiver.playoutDelayHint !== 0.075) {
                try { receiver.playoutDelayHint = 0.075; } catch (_) {}
              }
            }
          });
        }

        if (typeof pc.getSenders === 'function' && !peerObj._qosTunedV64) {
          pc.getSenders().forEach((sender) => {
            if (!sender.track || typeof sender.getParameters !== 'function') return;
            try {
              const params = sender.getParameters();
              if (!params.encodings || params.encodings.length === 0) return;

              if (sender.track.kind === 'audio') {
                params.encodings[0].priority = 'high';
                params.encodings[0].networkPriority = 'high';
                params.encodings[0].maxBitrate = 64000;
              } else if (sender.track.kind === 'video') {
                params.encodings[0].priority = 'low';
                params.encodings[0].maxBitrate = 240000;
              }
              sender.setParameters(params).catch(() => {});
              peerObj._qosTunedV64 = true;
            } catch (_) {}
          });
        }

        const st = pc.iceConnectionState;
        const remoteDev = this.engine.remoteDevices.get(remoteId);
        if (st === 'failed' || st === 'disconnected' || (peerObj.rttMs && peerObj.rttMs > 320)) {
          peerObj.p2pAudioVerified = false;
          const peerCh = this.engine.audio?.peerChannels.get(remoteId);
          if (peerCh) peerCh.verifiedP2PAudio = false;

          if ((st === 'failed' || st === 'disconnected') && remoteDev && remoteDev.inGame) {
            const lastAttempt = this.lastIceRestartByPeer.get(remoteId) || 0;
            if (now - lastAttempt > 9000 && this.engine.deviceId > remoteId) {
              this.lastIceRestartByPeer.set(remoteId, now);
              this.engine.triggerNegotiation(remoteId, true);
            }
          }
        }
      });
    }

    guardSocketBackpressure() {
      try {
        const ws = this.engine.mqttClient?.stream?.socket;
        if (ws && ws.bufferedAmount > 14000) {
          this.engine.tuning.maxVideoSocketBufferBytes = 12288;
        } else {
          this.engine.tuning.maxVideoSocketBufferBytes = 49152;
        }
      } catch (_) {}
    }

    updateSeatLatencyBadges() {
      this.engine.remoteDevices.forEach((dev, remoteId) => {
        if (!dev.seat || remoteId === RAFAEL_VIRTUAL_ID || dev._isVirtualAI) return;
        const statusEl = document.getElementById(`status-${dev.seat}`);
        if (!statusEl) return;

        if (!dev.inGame) {
          statusEl.textContent = 'Поза етером';
          return;
        }

        const peerObj = this.engine.peers.get(remoteId);
        const peerCh = this.engine.audio?.peerChannels.get(remoteId);
        const mutedIcon = (dev.hasAudio === false || peerCh?.muted) ? '🔇 ' : '';

        if (peerObj && (peerObj.p2pAudioVerified || peerObj.p2pVideoVerified)) {
          const rtt = peerObj.rttMs ? `${peerObj.rttMs} ms` : 'LAN';
          statusEl.textContent = `${mutedIcon}🟢 P2P • ${rtt}`;
        } else {
          const prebufMs = Math.round((this.engine.audio?.tuning?.jitterPrebufferSec || 0.095) * 1000);
          const hdTag = window.AetherOptimizers.audio?.adpcm24kEnabled ? 'HD' : '';
          statusEl.textContent = `${mutedIcon}⚡ ${hdTag} • ~${prebufMs} ms`;
        }
      });
    }

    toggleHudPanel() {
      if (!this.hudPanel) return;
      const isHidden = this.hudPanel.style.display === 'none';
      this.hudPanel.style.display = isHidden ? 'flex' : 'none';
      if (isHidden) {
        this.syncRolePermissionsUI();
        this.refreshTacticalHudContent(true);
      }
    }

    buildTacticalHudOverlay() {
      const clockEl = document.getElementById('session-clock');
      if (clockEl) {
        clockEl.style.cursor = 'pointer';
        clockEl.title = 'Клікніть, щоб відкрити Мікшер гучності';
        clockEl.addEventListener('click', () => {
          this.toggleHudPanel();
        });
      }

      const panel = document.createElement('div');
      panel.id = 'aether-tactical-hud-v64';
      panel.style.cssText = `
        position: fixed;
        bottom: 12px;
        right: 298px;
        width: 364px;
        max-height: 90vh;
        overflow-y: auto;
        background: rgba(9, 13, 18, 0.98);
        border: 1px solid rgba(52, 211, 153, 0.58);
        border-radius: 12px;
        padding: 13px;
        color: #eceff4;
        font-family: Inter, sans-serif;
        font-size: 11px;
        z-index: 9999;
        display: none;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 22px 54px rgba(0, 0, 0, 0.94);
      `;

      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:6px;">
          <strong id="hud-title-text" style="color:#6ee7b7;letter-spacing:0.4px;">🎚️ ПЕРСОНАЛЬНИЙ МІКШЕР ЗВУКУ v6.4</strong>
          <span id="hud-close-btn" style="cursor:pointer;color:#8b929e;font-size:14px;">✕</span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <span style="font-weight:700;color:#a7f3d0;font-size:10.5px;">🔊 ГУЧНІСТЬ УЧАСНИКІВ ТА МАЙСТРА (0%–200%):</span>
          <div style="display:flex;gap:4px;">
            <button id="hud-stop-whisper-btn" class="small-btn" style="display:none;font-size:9px;padding:2px 6px;border-color:#22d3ee;color:#67e8f9;">🔊 Стоп Шепіт</button>
            <button id="hud-save-30s-btn" class="small-btn" style="font-size:9px;padding:2px 7px;border-color:#10b981;color:#6ee7b7;">💾 Запис 30с</button>
          </div>
        </div>
        <div id="hud-player-mixer-list" style="display:flex;flex-direction:column;gap:5px;"></div>

        <div style="font-weight:600;color:#94a3b8;font-size:9.5px;margin-top:2px;">ПРОФІЛЬ ЗВ'ЯЗКУ ТА СТУДІЙНИЙ ТРАКТ (БЕЗ ШУМОДАВА):</div>
        <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:3px;" id="hud-preset-buttons">
          <button data-preset="global" class="small-btn active" style="font-size:9px;padding:4px 2px;">🌍 Країни</button>
          <button data-preset="studio" class="small-btn" style="font-size:9px;padding:4px 2px;">🎙️ Студія</button>
          <button data-preset="room" class="small-btn" style="font-size:9px;padding:4px 2px;">🏠 Кімната</button>
          <button data-preset="auto" class="small-btn" style="font-size:9px;padding:4px 2px;">🤖 Авто</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:3px;background:rgba(255,255,255,0.03);padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);font-size:10px;">
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
            <span>🎧 3D-Панорама крісел столу</span>
            <input type="checkbox" id="hud-chk-spatial" checked />
          </label>
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
            <span>🎚️ М'яке авто-вирівнювання гучності (Dugan)</span>
            <input type="checkbox" id="hud-chk-dugan" checked />
          </label>
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
            <span>⚡ Кодек ADPCM 24kHz HD + Подвійний Брокер</span>
            <input type="checkbox" id="hud-chk-adpcm" checked />
          </label>
        </div>

        <div class="gm-only-section" data-gm-display="flex" style="display:none;flex-direction:column;gap:6px;border-top:1px solid rgba(34,211,238,0.28);padding-top:8px;margin-top:2px;">
          <div style="display:flex;flex-direction:column;gap:5px;background:rgba(8, 47, 73, 0.42);padding:8px;border-radius:8px;border:1px solid rgba(34, 211, 238, 0.45);">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong style="color:#a5f3fc;font-size:10px;">💠 СИСТЕМА «РАФАЕЛЬ» (ТІЛЬКИ GM):</strong>
              <span id="hud-rafael-state-pill" style="font-family:monospace;font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(34,211,238,0.18);color:#67e8f9;">OFF</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
              <button id="hud-btn-rafael-spawn" class="small-btn" style="font-size:9.5px;padding:4px;">💠 Ядро: ВИМК</button>
              <button id="hud-btn-rafael-stt" class="small-btn" style="font-size:9.5px;padding:4px;">👂 Слух STT</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:3px;" id="hud-rafael-state-btns">
              <button data-rstate="Idle" class="small-btn active" style="font-size:8.5px;padding:3px 1px;">Idle</button>
              <button data-rstate="Listening" class="small-btn" style="font-size:8.5px;padding:3px 1px;">Listening</button>
              <button data-rstate="Working" class="small-btn" style="font-size:8.5px;padding:3px 1px;">Working</button>
              <button data-rstate="Speaking" class="small-btn" style="font-size:8.5px;padding:3px 1px;">Speaking</button>
              <button data-rstate="Error" class="small-btn" style="font-size:8.5px;padding:3px 1px;">Error</button>
            </div>
          </div>

          <div style="font-weight:600;color:#67e8f9;font-size:10px;">🏛️ АКУСТИКА ЛОКАЦІЇ (GM):</div>
          <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:3px;" id="hud-acoustic-buttons">
            <button data-space="dry" class="small-btn active" style="font-size:9px;padding:4px 2px;">🎙️ Сухий</button>
            <button data-space="dungeon" class="small-btn" style="font-size:9px;padding:4px 2px;">🏰 Данж</button>
            <button data-space="cathedral" class="small-btn" style="font-size:9px;padding:4px 2px;">⛪ Собор</button>
            <button data-space="radio" class="small-btn" style="font-size:9px;padding:4px 2px;">📻 Рація</button>
            <button data-space="abyss" class="small-btn" style="font-size:9px;padding:4px 2px;">👹 Безодня</button>
          </div>

          <div style="font-weight:600;color:#c084fc;font-size:10px;">🎭 МОРФЕР ГОЛОСУ NPC (GM):</div>
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:3px;" id="hud-morph-buttons">
            <button data-morph="normal" class="small-btn active" style="font-size:9px;padding:4px 2px;">👤 Людина</button>
            <button data-morph="titan" class="small-btn" style="font-size:9px;padding:4px 2px;">🐉 Титан</button>
            <button data-morph="automaton" class="small-btn" style="font-size:9px;padding:4px 2px;">🤖 Механізм</button>
            <button data-morph="phantom" class="small-btn" style="font-size:9px;padding:4px 2px;">🌀 Привид</button>
          </div>

          <div style="font-weight:600;color:#fbbf24;font-size:10px;">🔊 САУНДПАД МАЙСТРА (НА ВЕСЬ СТІЛ):</div>
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:3px;" id="hud-sfx-buttons">
            <button data-sfx="heartbeat" class="small-btn" style="font-size:9px;padding:4px 2px;">💓 Пульс</button>
            <button data-sfx="thunder" class="small-btn" style="font-size:9px;padding:4px 2px;">⚡ Грім</button>
            <button data-sfx="bell" class="small-btn" style="font-size:9px;padding:4px 2px;">🔔 Дзвін</button>
            <button data-sfx="drone" class="small-btn" style="font-size:9px;padding:4px 2px;">👁️ Дрон</button>
          </div>

          <div style="font-weight:600;color:#f87171;font-size:10px;">🩸 ВІЗУАЛЬНА АУРА КРІСЛА:</div>
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:3px;" id="hud-bio-buttons">
            <button data-bio="normal" class="small-btn active" style="font-size:9px;padding:4px 2px;">🟢 Норма</button>
            <button data-bio="wounded" class="small-btn" style="font-size:9px;padding:4px 2px;">🩸 HP &lt;25%</button>
            <button data-bio="cursed" class="small-btn" style="font-size:9px;padding:4px 2px;">🔮 Безумство</button>
            <button data-bio="crit20" class="small-btn" style="font-size:9px;padding:4px 2px;">🎲 Крит!</button>
          </div>
        </div>

        <div id="hud-live-metrics" style="font-family:monospace;font-size:9.5px;color:#94a3b8;border-top:1px solid rgba(255,255,255,0.08);padding-top:5px;line-height:1.4;"></div>
      `;

      document.body.appendChild(panel);
      this.hudPanel = panel;

      panel.querySelector('#hud-close-btn').addEventListener('click', () => {
        panel.style.display = 'none';
      });

      panel.querySelector('#hud-btn-rafael-spawn').addEventListener('click', () => {
        if (!this.isLocalUserGM()) return;
        this.setRafaelVirtualNodeActive(!this.rafaelActive);
      });

      panel.querySelector('#hud-btn-rafael-stt').addEventListener('click', () => {
        if (!this.isLocalUserGM() || !this.rafaelActive) return;
        const audioOpt = window.AetherOptimizers.audio;
        if (audioOpt) {
          audioOpt.setRafaelSttListening(!audioOpt.sttEnabled);
          this.refreshTacticalHudContent();
        }
      });

      panel.querySelectorAll('#hud-rafael-state-btns button').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!this.isLocalUserGM() || !this.rafaelActive) return;
          this.setRafaelState(btn.getAttribute('data-rstate'), true);
        });
      });

      panel.querySelectorAll('#hud-preset-buttons button').forEach((btn) => {
        btn.addEventListener('click', () => {
          window.AetherOptimizers.audio?.setPresetMode(btn.getAttribute('data-preset'));
          this.refreshTacticalHudContent(true);
        });
      });

      panel.querySelectorAll('#hud-acoustic-buttons button').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!this.isLocalUserGM()) return;
          window.AetherOptimizers.audio?.setAcousticSpace(btn.getAttribute('data-space'));
          this.refreshTacticalHudContent();
        });
      });

      panel.querySelectorAll('#hud-morph-buttons button').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!this.isLocalUserGM()) return;
          window.AetherOptimizers.audio?.setVoiceMorph(btn.getAttribute('data-morph'));
          this.refreshTacticalHudContent();
        });
      });

      panel.querySelectorAll('#hud-sfx-buttons button').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!this.isLocalUserGM()) return;
          const sfx = btn.getAttribute('data-sfx');
          window.AetherOptimizers.audio?.playProceduralSoundEffect(sfx, true);
          this.refreshTacticalHudContent();
        });
      });

      panel.querySelectorAll('#hud-bio-buttons button').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!this.isLocalUserGM()) return;
          const bio = btn.getAttribute('data-bio');
          window.AetherOptimizers.video?.setLocalBiometricState(bio);
          this.refreshTacticalHudContent();
        });
      });

      panel.querySelector('#hud-stop-whisper-btn').addEventListener('click', () => {
        window.AetherOptimizers.audio?.setWhisperTarget(null, false);
        this.renderWhisperBadgesOnSeats();
        this.refreshTacticalHudContent(true);
      });

      panel.querySelector('#hud-save-30s-btn').addEventListener('click', () => {
        window.AetherOptimizers.audio?.saveLast30SecondsHighlight();
      });

      panel.querySelector('#hud-chk-dugan').addEventListener('change', (e) => {
        window.AetherOptimizers.audio?.setDuganAutomixEnabled(e.target.checked);
      });

      panel.querySelector('#hud-chk-spatial').addEventListener('change', (e) => {
        window.AetherOptimizers.audio?.setSpatialEnabled(e.target.checked);
        window.AetherOptimizers.audio?.setGmPriorityEnabled(e.target.checked);
        this.refreshTacticalHudContent(true);
      });

      panel.querySelector('#hud-chk-adpcm').addEventListener('change', (e) => {
        window.AetherOptimizers.audio?.setAdpcm24kEnabled(e.target.checked);
        window.AetherOptimizers.video?.setHdSharpenEnabled(e.target.checked);
        this.dualBrokerEnabled = e.target.checked;
        this.refreshTacticalHudContent(true);
      });
    }

    formatPanBadge(panVal) {
      if (!panVal || Math.abs(panVal) < 0.04) return 'C';
      const pct = Math.round(Math.abs(panVal) * 100);
      return panVal < 0 ? `L${pct}` : `R${pct}`;
    }

    refreshTacticalHudContent(forceRebuildMixer = false) {
      if (!this.hudPanel || this.hudPanel.style.display === 'none' || !this.engine) return;

      const isGM = this.isLocalUserGM();
      const audioOpt = window.AetherOptimizers.audio;
      const videoOpt = window.AetherOptimizers.video;
      const activePreset = audioOpt?.presetMode || 'global';
      const activeSpace = audioOpt?.currentAcousticSpace || 'dry';
      const activeMorph = audioOpt?.currentVoiceMorph || 'normal';
      const activeBio = videoOpt?.localBiometricState || 'normal';
      const currentWhisperTarget = audioOpt?.whisperTargetId || null;

      this.syncRolePermissionsUI();

      const spawnBtn = this.hudPanel.querySelector('#hud-btn-rafael-spawn');
      if (spawnBtn) {
        spawnBtn.textContent = this.rafaelActive ? '💠 Ядро: АКТИВНЕ' : '💠 Ядро: ВИМК';
        spawnBtn.classList.toggle('active', this.rafaelActive);
      }

      const sttBtn = this.hudPanel.querySelector('#hud-btn-rafael-stt');
      if (sttBtn) {
        const sttOn = !!(this.rafaelActive && audioOpt && audioOpt.sttEnabled);
        sttBtn.textContent = sttOn ? '👂 STT: АКТИВ' : '👂 Слух STT';
        sttBtn.classList.toggle('active', sttOn);
        sttBtn.disabled = !this.rafaelActive;
        sttBtn.style.opacity = this.rafaelActive ? '1' : '0.45';
      }

      const statePill = this.hudPanel.querySelector('#hud-rafael-state-pill');
      if (statePill) {
        statePill.textContent = this.rafaelActive ? this.rafaelState : 'OFF';
      }

      this.hudPanel.querySelectorAll('#hud-rafael-state-btns button').forEach((btn) => {
        btn.classList.toggle('active', this.rafaelActive && btn.getAttribute('data-rstate') === this.rafaelState);
        btn.disabled = !this.rafaelActive;
        btn.style.opacity = this.rafaelActive ? '1' : '0.45';
      });

      this.hudPanel.querySelectorAll('#hud-preset-buttons button').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-preset') === activePreset);
      });

      this.hudPanel.querySelectorAll('#hud-acoustic-buttons button').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-space') === activeSpace);
      });

      this.hudPanel.querySelectorAll('#hud-morph-buttons button').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-morph') === activeMorph);
      });

      this.hudPanel.querySelectorAll('#hud-bio-buttons button').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-bio') === activeBio);
      });

      const droneBtn = this.hudPanel.querySelector('button[data-sfx="drone"]');
      if (droneBtn) {
        droneBtn.classList.toggle('active', !!(audioOpt && audioOpt.abyssDroneNodes));
      }

      const stopWhisperBtn = this.hudPanel.querySelector('#hud-stop-whisper-btn');
      if (stopWhisperBtn) {
        stopWhisperBtn.style.display = (isGM && currentWhisperTarget) ? 'inline-block' : 'none';
      }

      if (audioOpt) {
        this.hudPanel.querySelector('#hud-chk-dugan').checked = audioOpt.duganAutomixEnabled;
        this.hudPanel.querySelector('#hud-chk-spatial').checked = audioOpt.spatialEnabled;
        this.hudPanel.querySelector('#hud-chk-adpcm').checked = audioOpt.adpcm24kEnabled;
      }

      const mixerList = this.hudPanel.querySelector('#hud-player-mixer-list');
      const peerCount = this.engine.remoteDevices.size;
      const roleKey = isGM ? 'gm' : 'player';

      if (
        mixerList &&
        (forceRebuildMixer ||
          Number(mixerList.dataset.peerCount) !== peerCount ||
          mixerList.dataset.roleKey !== roleKey)
      ) {
        mixerList.dataset.peerCount = String(peerCount);
        mixerList.dataset.roleKey = roleKey;
        mixerList.innerHTML = '';

        if (peerCount === 0) {
          mixerList.innerHTML = `<div style="color:#64748b;font-size:10px;">Поки немає інших учасників за столом...</div>`;
        } else {
          this.engine.remoteDevices.forEach((dev, remoteId) => {
            if (remoteId === RAFAEL_VIRTUAL_ID && !this.rafaelActive) return;

            const peerCh = this.engine.audio?.getOrCreatePeerChannel(remoteId);
            const currentVolPct = Math.round((audioOpt ? audioOpt.getPlayerCustomVolume(remoteId, dev.name) : 1.0) * 100);
            const panVal = audioOpt ? audioOpt.computeSeatPanPosition(dev.seat) : 0;
            const panBadge = this.formatPanBadge(panVal);
            const isMuted = !!(peerCh && peerCh.muted);
            const isWhisperingToThis = currentWhisperTarget === remoteId;
            const isAI = remoteId === RAFAEL_VIRTUAL_ID || dev._isVirtualAI;
            const isPeerGM = dev.role === 'gm' || dev.seat === 'gm';

            const row = document.createElement('div');
            row.style.cssText = `
              display:flex;flex-direction:column;gap:4px;
              background:${isAI ? 'rgba(8, 47, 73, 0.45)' : (isWhisperingToThis ? 'rgba(6, 78, 59, 0.45)' : 'rgba(0,0,0,0.38)')};
              padding:6px 8px;border-radius:6px;
              border:1px solid ${isAI ? 'rgba(34, 211, 238, 0.5)' : (isWhisperingToThis ? '#22d3ee' : 'rgba(255,255,255,0.06)')};
            `;
            row.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:600;color:${isAI ? '#67e8f9' : (isPeerGM ? '#fcd34d' : '#e2e8f0')};">
                  ${isAI ? '💠 ' : (isPeerGM ? '👑 ' : '👤 ')}@${dev.name} <small style="color:#34d399;">[${isAI ? 'ЦЕНТР' : panBadge}]</small>
                </span>
                <div style="display:flex;align-items:center;gap:4px;">
                  <span class="vol-label" style="font-family:monospace;color:#6ee7b7;font-size:10px;">${currentVolPct}%</span>
                  ${(isGM && !isAI) ? `<button class="small-btn whisper-peer-btn ${isWhisperingToThis ? 'gm-mode' : ''}" style="padding:2px 6px;font-size:9px;">👁️ Шепіт</button>` : ''}
                  <button class="small-btn mute-peer-btn" style="padding:2px 6px;font-size:10px;">${isMuted ? '🔇' : '🔊'}</button>
                </div>
              </div>
              <input type="range" min="0" max="200" value="${currentVolPct}" style="width:100%;accent-color:${isAI ? '#22d3ee' : '#10b981'};cursor:pointer;" />
            `;

            const slider = row.querySelector('input[type="range"]');
            const volLabel = row.querySelector('.vol-label');
            const muteBtn = row.querySelector('.mute-peer-btn');
            const whisperBtn = row.querySelector('.whisper-peer-btn');

            slider.addEventListener('input', (e) => {
              const pct = Number(e.target.value);
              volLabel.textContent = `${pct}%`;
              audioOpt?.setPlayerCustomVolume(remoteId, dev.name, pct / 100);
            });

            if (whisperBtn) {
              whisperBtn.addEventListener('click', () => {
                audioOpt?.setWhisperTarget(remoteId);
                this.renderWhisperBadgesOnSeats();
                this.refreshTacticalHudContent(true);
              });
            }

            muteBtn.addEventListener('click', () => {
              if (!peerCh) return;
              peerCh.muted = !peerCh.muted;
              muteBtn.textContent = peerCh.muted ? '🔇' : '🔊';
              this.updateSeatLatencyBadges();
            });

            mixerList.appendChild(row);
          });
        }
      }

      const aTel = this.engine.audio ? this.engine.audio.getTelemetry() : {};
      const srKhz = ((aTel.tuning?.targetSampleRate || 24000) / 1000).toFixed(1);
      const prebufMs = Math.round((aTel.tuning?.jitterPrebufferSec || 0.095) * 1000);
      const mirrorOk = !!(this.secondaryAudioClient && this.secondaryAudioClient.connected);

      const metricsEl = this.hudPanel.querySelector('#hud-live-metrics');
      if (metricsEl) {
        metricsEl.innerHTML = `
          <div>• Тракт: <b>Студійний (Шумодав ВИМК)</b> | Буфер: <b>${prebufMs} ms</b></div>
          <div>• Кодек: <b>${audioOpt?.adpcm24kEnabled ? `ADPCM ${srKhz}kHz HD` : `PCM 16kHz`}</b> | 2x Брокер: <b>${mirrorOk ? `🟢 (Врятовано: ${this.dualPacketsRecovered})` : '🟡'}</b></div>
        `;
      }
    }
  }

  window.AetherOptimizers.register('network', new AetherNetworkOptimizer());
})(window);