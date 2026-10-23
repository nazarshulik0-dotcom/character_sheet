/**
 * ============================================================================
 * AETHER NETWORK OPTIMIZER (aether_network_optimizer.js) - v6.3 VITRUVIUS GM
 * ----------------------------------------------------------------------------
 * Фінальне зведення правок під систему «Вітрувій»:
 *   1. GM-ONLY ACCESS: Консоль Режисера (клік по 00:00), саундпад, морфер,
 *      гарячі клавіші шепоту та керування Рафаелем доступні ВИКЛЮЧНО Майстру (role === 'gm').
 *   2. ZERO PHANTOM LOGS: Поки Рафаель вимкнений (rafaelActive === false),
 *      жодна його репліка не з'являється ні в чаті, ні в логах під кнопкою «В Етері».
 *   3. ПРИБРАНО ЗАЙВЕ: видалено вбудовані кидки 1d20+4 з чату, авто-звіти статусу,
 *      авто-реакцію на HP < 25% та кринжові самоназви «Великий Мудрець».
 *   4. СЕКРЕТНА АДМІН-ВКЛАДКА В ЧАТІ ДЛЯ МАЙСТРА («⚡ Адмін / Рафаель»):
 *      дозволяє Майстру писати приховані команди, підказки та репліки для Рафаеля
 *      прямо в блоці чату ліворуч без відображення гравцям.
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

      this.pttActiveByHotkey = false;
      this.ptwActiveSeatNum = null;

      // Стан ядра Рафаеля в системі «Вітрувій» (за замовчуванням ВИМКНЕНО)
      this.rafaelActive = false;
      this.rafaelState = 'Idle';
      this.externalLlmHandler = null;
      this.rafaelCommandCallbacks = new Set();
      this.rafaelStateCallbacks = new Set();
      this.gmPromptHints = []; // Приховані настанови від Майстра для LLM

      this.partySheetsByPeer = new Map();
      this.recentChatHistory = [];

      // Стан адмін-вкладки Майстра в панелі чату
      this.gmChatTabMode = 'public'; // 'public' | 'admin'
      this.gmTabBarEl = null;
      this.gmAdminLogEl = null;
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.exposeGlobalRafaelBridge();
      this.installDualBrokerWhisperAndRafaelHooks();
      this.connectSecondaryMirrorBroker();
      this.setupTacticalHotkeys();
      this.syncLocalCharacterSheetToRoom();
      this.buildTacticalHudOverlay();
      this.mountGmAdminChatTab();
      this.startNetworkGovernorLoop();
    }

    isLocalUserGM() {
      return this.engine?.localState?.role === 'gm';
    }

    // =========================================================================
    // 1. ПРИХОВАНА АДМІН-ВКЛАДКА ДЛЯ МАЙСТРА В ПАНЕЛІ ЧАТУ («⚡ АДМІН / РАФАЕЛЬ»)
    // =========================================================================
    mountGmAdminChatTab() {
      const chatLog = document.getElementById('chat-log');
      const chatInput = document.getElementById('chat-input');
      const chatSendBtn = document.getElementById('btn-chat-send');
      if (!chatLog || !chatLog.parentElement || document.getElementById('vitruvius-gm-chat-tabs')) return;

      const parentCard = chatLog.parentElement;

      // Панель перемикання вкладок (показується ТІЛЬКИ якщо роль === 'gm')
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

      // Прихований лог адмін-термінала Майстра
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
          • <code>#підказка</code> — додати приховану директиву в пам'ять Рафаеля<br/>
          • Будь-який інший текст — прямий запит до Рафаеля.
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

      // Перехоплюємо Enter та клік по кнопці відправки, коли активна вкладка «⚡ Адмін / Рафаель»
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

      this.syncGmPermissionsUI();
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

      // Прихована директива/контекст для майбутніх відповідей ШІ (#...)
      if (cmd.startsWith('#')) {
        const hint = cmd.substring(1).trim();
        if (hint) {
          this.gmPromptHints.push(hint);
          this.appendGmAdminLog('🧠 Пам’ять Рафаеля', `Директиву збережено: "${hint}"`);
        }
        return;
      }

      // Якщо Рафаель вимкнений — попереджаємо тільки Майстра у приватному терміналі (в загальний чат нічого не йде!)
      if (!this.rafaelActive) {
        this.appendGmAdminLog('⚠️ Увага', 'Рафаель зараз вимкнений. Напишіть /on або увімкніть «💠 Ядро» у консолі (00:00).', '#fbbf24');
        return;
      }

      // Пряме озвучення тексту голосом Рафаеля (!...)
      if (cmd.startsWith('!')) {
        const speechText = cmd.substring(1).trim();
        if (speechText) {
          window.AetherRafaelBridge?.speak(speechText, true);
          this.appendGmAdminLog('💠 Рафаель (Етер)', speechText);
        }
        return;
      }

      // Звернення до обробника Рафаеля
      window.AetherRafaelBridge?.ask(cmd, 'Майстер (GM)', true);
    }

    // Оновлює видимість елементів залежно від ролі (Гравець бачить лише стандартний стіл!)
    syncGmPermissionsUI() {
      const isGM = this.isLocalUserGM();

      // 1. Вкладка адміна в чаті — тільки для Майстра
      if (this.gmTabBarEl) {
        this.gmTabBarEl.style.display = isGM ? 'grid' : 'none';
      }
      if (!isGM && this.gmChatTabMode === 'admin') {
        this.gmChatTabMode = 'public';
        const chatLog = document.getElementById('chat-log');
        if (chatLog) chatLog.style.display = '';
        if (this.gmAdminLogEl) this.gmAdminLogEl.style.display = 'none';
      }

      // 2. Звукова консоль (HUD) — тільки для Майстра
      if (!isGM && this.hudPanel && this.hudPanel.style.display !== 'none') {
        this.hudPanel.style.display = 'none';
      }

      const clockEl = document.getElementById('session-clock');
      if (clockEl) {
        clockEl.style.cursor = isGM ? 'pointer' : 'default';
        clockEl.title = isGM ? 'Пульт Майстра «Вітрувій» (клік)' : '';
      }
    }

    // =========================================================================
    // 2. КОНТЕКСТ СТОЛУ СИСТЕМИ «ВІТРУВІЙ» ДЛЯ ЗОВНІШНЬОГО LLM
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

    // =========================================================================
    // 3. ГЛОБАЛЬНИЙ ШЛЮЗ window.AetherRafaelBridge (СУВОРА ПЕРЕВІРКА АКТИВНОСТІ)
    // =========================================================================
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

        // Озвучення працює ТІЛЬКИ якщо Рафаель увімкнений (жодних авто-спавнів і фантомних повідомлень!)
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
      // СУВОРИЙ ГЕЙТ: ніяких повідомлень у чат, якщо Рафаель вимкнений!
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
        // Якщо зовнішній LLM ще не підключений — тихо повертаємо стан у Idle без кринжових авто-фраз у чат
        if (fromGmTerminal) {
          this.appendGmAdminLog(
            '💠 Рафаель',
            'Запит прийнято шлюзом (підключіть LLM через AetherRafaelBridge.connectLLM або використайте !текст для прямого озвучення).'
          );
        }
        setTimeout(() => {
          if (this.rafaelActive) this.setRafaelState('Idle', true);
        }, 600);
      }
    }

    // =========================================================================
    // 4. ТАКТИЧНІ ГАРЯЧІ КЛАВІШІ (ШЕПІТ ALT+1..6 ДОСТУПНИЙ ТІЛЬКИ МАЙСТРУ)
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

        // Приватний Шепіт Alt+1..6 — виключно для Майстра (GM)
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

    // =========================================================================
    // 5. ПОДВІЙНИЙ БРОКЕР + ФІЛЬТРАЦІЯ ПАКЕТІВ ВИМКНЕНОГО РАФАЕЛЯ
    // =========================================================================
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
          clientId: 'mirror63_' + this.engine.deviceId + '_' + Math.floor(Math.random() * 9999),
          clean: true,
          connectTimeout: 6000,
          reconnectPeriod: 3000
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

    installDualBrokerWhisperAndRafaelHooks() {
      if (!this.engine || this.engine._v63NetHooksInstalled) return;
      this.engine._v63NetHooksInstalled = true;

      const origPubAudio = this.engine.publishQuantumAudioPacket.bind(this.engine);
      const origPubVideo = this.engine.publishQuantumVideoPacket.bind(this.engine);
      const origHandleRelay = this.engine.handleQuantumRelayPacket.bind(this.engine);
      const origHandleRoom = this.engine.handleRoomMessage.bind(this.engine);
      const origConnectRoom = this.engine.connectRoom.bind(this.engine);
      const origSendChat = this.engine.sendChat.bind(this.engine);
      const origLog = this.engine.log.bind(this.engine);

      // Фільтрація логів під кнопкою «В Етері»: блокуємо будь-які рядки про Рафаеля, коли він вимкнений
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

      // Звичайний чат більше не запускає жодних авто-кидків кубиків чи авто-звітів
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

        // Якщо прилетів фантомний чат-пакет від вимкненого Рафаеля — жорстко блокуємо!
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
          try {
            this.secondaryAudioClient.publish(
              this.engine.audioRelayTopic,
              JSON.stringify({
                ...pkt,
                from: this.engine.deviceId
              }),
              { qos: 0, retain: false }
            );
          } catch (_) {}
        }
      };

      this.engine.publishQuantumVideoPacket = (pkt) => {
        const sinceAudioMs = performance.now() - this.lastAudioPacketSentAt;
        if (sinceAudioMs >= 0 && sinceAudioMs < 8) {
          setTimeout(() => origPubVideo(pkt), 8);
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
          if (this.seenSignatureQueue.length > 600) {
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

        this.syncGmPermissionsUI();

        const rafDev = this.engine.remoteDevices.get(RAFAEL_VIRTUAL_ID);
        if (rafDev) {
          if (this.rafaelActive) {
            rafDev._lastSeen = Date.now() + 3600000;
            rafDev.seat = RAFAEL_CENTER_SEAT;
          } else {
            this.engine.remoteDevices.delete(RAFAEL_VIRTUAL_ID);
          }
        }

        this.optimizePeerConnections();
        this.guardSocketBackpressure();
        this.updateSeatLatencyBadges();
        this.renderWhisperBadgesOnSeats();
        this.refreshTacticalHudContent();
      }, 1200);
    }

    optimizePeerConnections() {
      const now = Date.now();

      this.engine.peers.forEach((peerObj, remoteId) => {
        if (remoteId === RAFAEL_VIRTUAL_ID) return;
        const pc = peerObj.pc;
        if (!pc) return;

        if (typeof pc.getReceivers === 'function') {
          pc.getReceivers().forEach((receiver) => {
            if (receiver.track && receiver.track.kind === 'audio') {
              if ('playoutDelayHint' in receiver && receiver.playoutDelayHint !== 0.025) {
                try { receiver.playoutDelayHint = 0.025; } catch (_) {}
              }
            }
            if (receiver.track && receiver.track.kind === 'video') {
              if ('playoutDelayHint' in receiver && receiver.playoutDelayHint !== 0.045) {
                try { receiver.playoutDelayHint = 0.045; } catch (_) {}
              }
            }
          });
        }

        if (typeof pc.getSenders === 'function' && !peerObj._qosTunedV63) {
          pc.getSenders().forEach((sender) => {
            if (!sender.track || typeof sender.getParameters !== 'function') return;
            try {
              const params = sender.getParameters();
              if (!params.encodings || params.encodings.length === 0) return;

              if (sender.track.kind === 'audio') {
                params.encodings[0].priority = 'high';
                params.encodings[0].networkPriority = 'high';
                params.encodings[0].maxBitrate = 72000;
              } else if (sender.track.kind === 'video') {
                params.encodings[0].priority = 'low';
                params.encodings[0].maxBitrate = 340000;
              }
              sender.setParameters(params).catch(() => {});
              peerObj._qosTunedV63 = true;
            } catch (_) {}
          });
        }

        const st = pc.iceConnectionState;
        const remoteDev = this.engine.remoteDevices.get(remoteId);
        if ((st === 'failed' || st === 'disconnected') && remoteDev && remoteDev.inGame) {
          const lastAttempt = this.lastIceRestartByPeer.get(remoteId) || 0;
          if (now - lastAttempt > 11000 && this.engine.deviceId > remoteId) {
            this.lastIceRestartByPeer.set(remoteId, now);
            this.engine.triggerNegotiation(remoteId, true);
          }
        }
      });
    }

    guardSocketBackpressure() {
      try {
        const ws = this.engine.mqttClient?.stream?.socket;
        if (ws && ws.bufferedAmount > 28000) {
          this.engine.tuning.maxVideoSocketBufferBytes = 20480;
        } else {
          this.engine.tuning.maxVideoSocketBufferBytes = 65536;
        }
      } catch (_) {}
    }

    updateSeatLatencyBadges() {
      this.engine.remoteDevices.forEach((dev, remoteId) => {
        if (!dev.seat || remoteId === RAFAEL_VIRTUAL_ID || dev._isVirtualAI) return;
        const statusEl = document.getElementById(`status-${dev.seat}`);
        if (!statusEl) return;

        const peerObj = this.engine.peers.get(remoteId);
        const peerCh = this.engine.audio?.peerChannels.get(remoteId);
        const mutedIcon = (dev.hasAudio === false || peerCh?.muted) ? '🔇 ' : '';

        if (peerObj && (peerObj.p2pAudioVerified || peerObj.p2pVideoVerified)) {
          const rtt = peerObj.rttMs ? `${peerObj.rttMs} ms` : 'LAN';
          statusEl.textContent = `${mutedIcon}🟢 P2P • ${rtt}`;
        } else if ((peerObj && peerObj.hasRelayFrames) || dev.inGame) {
          const prebufMs = Math.round((this.engine.audio?.tuning?.jitterPrebufferSec || 0.065) * 1000);
          const hdTag = window.AetherOptimizers.audio?.adpcm24kEnabled ? 'HD' : '';
          statusEl.textContent = `${mutedIcon}⚡ ${hdTag} • ~${prebufMs} ms`;
        }
      });
    }

    // =========================================================================
    // 6. ПУЛЬТ МАЙСТРА «ВІТРУВІЙ» v6.3 (ДОСТУПНИЙ ВИКЛЮЧНО ДЛЯ РОЛІ GM)
    // =========================================================================
    buildTacticalHudOverlay() {
      const clockEl = document.getElementById('session-clock');
      if (clockEl) {
        clockEl.addEventListener('click', () => {
          // Звичайні гравці НЕ можуть відкрити звукову консоль Майстра!
          if (!this.isLocalUserGM()) return;
          if (this.hudPanel) {
            const isHidden = this.hudPanel.style.display === 'none';
            this.hudPanel.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) this.refreshTacticalHudContent(true);
          }
        });
      }

      const panel = document.createElement('div');
      panel.id = 'aether-tactical-hud-v63';
      panel.style.cssText = `
        position: fixed;
        bottom: 12px;
        right: 298px;
        width: 364px;
        max-height: 90vh;
        overflow-y: auto;
        background: rgba(9, 13, 18, 0.98);
        border: 1px solid rgba(34, 211, 238, 0.58);
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
          <strong style="color:#67e8f9;letter-spacing:0.4px;">👑 VITRUVIUS GM CONSOLE v6.3</strong>
          <span id="hud-close-btn" style="cursor:pointer;color:#8b929e;font-size:14px;">✕</span>
        </div>

        <div style="display:flex;flex-direction:column;gap:5px;background:rgba(8, 47, 73, 0.42);padding:8px;border-radius:8px;border:1px solid rgba(34, 211, 238, 0.45);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="color:#a5f3fc;font-size:10px;">💠 СИСТЕМА «РАФАЕЛЬ» (ЦЕНТР СТОЛУ):</strong>
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

        <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:3px;" id="hud-preset-buttons">
          <button data-preset="auto" class="small-btn" style="font-size:9px;padding:4px 2px;">🤖 Авто</button>
          <button data-preset="room" class="small-btn" style="font-size:9px;padding:4px 2px;">🏠 Кімната</button>
          <button data-preset="global" class="small-btn" style="font-size:9px;padding:4px 2px;">🌍 Країни</button>
          <button data-preset="studio" class="small-btn" style="font-size:9px;padding:4px 2px;">🎙️ Студія</button>
        </div>

        <div style="font-weight:600;color:#67e8f9;font-size:10px;">🏛️ АКУСТИКА ЛОКАЦІЇ:</div>
        <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:3px;" id="hud-acoustic-buttons">
          <button data-space="dry" class="small-btn active" style="font-size:9px;padding:4px 2px;">🎙️ Сухий</button>
          <button data-space="dungeon" class="small-btn" style="font-size:9px;padding:4px 2px;">🏰 Данж</button>
          <button data-space="cathedral" class="small-btn" style="font-size:9px;padding:4px 2px;">⛪ Собор</button>
          <button data-space="radio" class="small-btn" style="font-size:9px;padding:4px 2px;">📻 Рація</button>
          <button data-space="abyss" class="small-btn" style="font-size:9px;padding:4px 2px;">👹 Безодня</button>
        </div>

        <div style="font-weight:600;color:#c084fc;font-size:10px;">🎭 МОРФЕР ГОЛОСУ NPC (ДЛЯ МАЙСТРА):</div>
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

        <div style="display:flex;flex-direction:column;gap:3px;background:rgba(255,255,255,0.03);padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);font-size:10px;">
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
            <span>🎚️ Пропорційний Автомікшер Dan Dugan</span>
            <input type="checkbox" id="hud-chk-dugan" checked />
          </label>
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
            <span>🎧 3D-Панорама + 👑 Пріоритет Майстра</span>
            <input type="checkbox" id="hud-chk-spatial" checked />
          </label>
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
            <span>⚡ ADPCM 24kHz HD + 2x Брокер + HD Відео</span>
            <input type="checkbox" id="hud-chk-adpcm" checked />
          </label>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <span style="font-weight:600;color:#a7f3d0;font-size:10px;">МІКШЕР ТА ШЕПІТ (Alt+1..6):</span>
          <div style="display:flex;gap:4px;">
            <button id="hud-stop-whisper-btn" class="small-btn" style="display:none;font-size:9px;padding:2px 6px;border-color:#22d3ee;color:#67e8f9;">🔊 Стоп Шепіт</button>
            <button id="hud-save-30s-btn" class="small-btn" style="font-size:9px;padding:2px 7px;border-color:#10b981;color:#6ee7b7;">💾 Хайлайт 30с</button>
          </div>
        </div>
        <div id="hud-player-mixer-list" style="display:flex;flex-direction:column;gap:5px;"></div>

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
          window.AetherOptimizers.audio?.setAcousticSpace(btn.getAttribute('data-space'));
          this.refreshTacticalHudContent();
        });
      });

      panel.querySelectorAll('#hud-morph-buttons button').forEach((btn) => {
        btn.addEventListener('click', () => {
          window.AetherOptimizers.audio?.setVoiceMorph(btn.getAttribute('data-morph'));
          this.refreshTacticalHudContent();
        });
      });

      panel.querySelectorAll('#hud-sfx-buttons button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sfx = btn.getAttribute('data-sfx');
          window.AetherOptimizers.audio?.playProceduralSoundEffect(sfx, true);
          this.refreshTacticalHudContent();
        });
      });

      panel.querySelectorAll('#hud-bio-buttons button').forEach((btn) => {
        btn.addEventListener('click', () => {
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
      if (!this.isLocalUserGM()) {
        this.hudPanel.style.display = 'none';
        return;
      }

      const audioOpt = window.AetherOptimizers.audio;
      const videoOpt = window.AetherOptimizers.video;
      const activePreset = audioOpt?.presetMode || 'auto';
      const activeSpace = audioOpt?.currentAcousticSpace || 'dry';
      const activeMorph = audioOpt?.currentVoiceMorph || 'normal';
      const activeBio = videoOpt?.localBiometricState || 'normal';
      const currentWhisperTarget = audioOpt?.whisperTargetId || null;

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
        stopWhisperBtn.style.display = currentWhisperTarget ? 'inline-block' : 'none';
      }

      if (audioOpt) {
        this.hudPanel.querySelector('#hud-chk-dugan').checked = audioOpt.duganAutomixEnabled;
        this.hudPanel.querySelector('#hud-chk-spatial').checked = audioOpt.spatialEnabled;
        this.hudPanel.querySelector('#hud-chk-adpcm').checked = audioOpt.adpcm24kEnabled;
      }

      const mixerList = this.hudPanel.querySelector('#hud-player-mixer-list');
      const peerCount = this.engine.remoteDevices.size;

      if (mixerList && (forceRebuildMixer || Number(mixerList.dataset.peerCount) !== peerCount)) {
        mixerList.dataset.peerCount = String(peerCount);
        mixerList.innerHTML = '';

        if (peerCount === 0) {
          mixerList.innerHTML = `<div style="color:#64748b;font-size:10px;">Поки немає активних учасників за столом...</div>`;
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

            const row = document.createElement('div');
            row.style.cssText = `
              display:flex;flex-direction:column;gap:4px;
              background:${isAI ? 'rgba(8, 47, 73, 0.45)' : (isWhisperingToThis ? 'rgba(6, 78, 59, 0.45)' : 'rgba(0,0,0,0.38)')};
              padding:6px 8px;border-radius:6px;
              border:1px solid ${isAI ? 'rgba(34, 211, 238, 0.5)' : (isWhisperingToThis ? '#22d3ee' : 'rgba(255,255,255,0.06)')};
            `;
            row.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:600;color:${isAI ? '#67e8f9' : '#e2e8f0'};">
                  ${isAI ? '💠 ' : ''}@${dev.name} <small style="color:#34d399;">[${isAI ? 'ЦЕНТР' : panBadge}]</small>
                </span>
                <div style="display:flex;align-items:center;gap:4px;">
                  <span class="vol-label" style="font-family:monospace;color:#6ee7b7;font-size:10px;">${currentVolPct}%</span>
                  ${!isAI ? `<button class="small-btn whisper-peer-btn ${isWhisperingToThis ? 'gm-mode' : ''}" style="padding:2px 6px;font-size:9px;">👁️ Шепіт</button>` : ''}
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
      const prebufMs = Math.round((aTel.tuning?.jitterPrebufferSec || 0.065) * 1000);
      const mirrorOk = !!(this.secondaryAudioClient && this.secondaryAudioClient.connected);

      const metricsEl = this.hudPanel.querySelector('#hud-live-metrics');
      if (metricsEl) {
        metricsEl.innerHTML = `
          <div>• Кодек: <b>${audioOpt?.adpcm24kEnabled ? `ADPCM ${srKhz}kHz HD` : `PCM 16kHz`}</b> | Буфер: <b>${prebufMs} ms</b> | 2x Брокер: <b>${mirrorOk ? '🟢' : '🟡'}</b></div>
          <div>• Система «Вітрувій» | Ядро Рафаеля: <b>${this.rafaelActive ? `АКТИВНЕ (${this.rafaelState})` : 'ВИМКНЕНО'}</b></div>
        `;
      }
    }
  }

  window.AetherOptimizers.register('network', new AetherNetworkOptimizer());
})(window);