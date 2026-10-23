/**
 * ============================================================================
 * AETHER NETWORK OPTIMIZER (aether_network_optimizer.js) - v5.0 SHOWRUNNER
 * ----------------------------------------------------------------------------
 * Повний стек мережі, гарячих клавіш та режисерського пульта (Пакети 1-5):
 *   1. Dual-Broker Active-Active (EMQX + HiveMQ) із 0% втрат пакетів.
 *   2. Тактичні Гарячі Клавіші (коли курсор не в полі вводу):
 *      - Утримувати Alt + 1..6 : Миттєвий приватний Шепіт гравцю на кріслі 1..6
 *      - Утримувати Пробіл або V : Рація Push-To-Talk (тимчасове увімкнення мікрофона)
 *      - Alt + M : Швидке вимкнення/увімкнення мікрофона
 *   3. Showrunner Console HUD v5.0 (клік по 00:00):
 *      - Процедурний Саундпад Майстра (Серцебиття, Грім, Дзвін Долі, Дрон Безодні)
 *      - Вокальний Морфер NPC (Природний, Титан, Автоматон, Привид)
 *      - Біометричні стани (Норма, Поранений, Прокляття, Крит Nat 20)
 *      - Кнопка «💾 Зберегти останні 30 сек» (Highlight Blackbox)
 * ============================================================================
 */

(function (window) {
  'use strict';

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

      // Стан гарячих клавіш Push-To-Talk та Push-To-Whisper
      this.pttActiveByHotkey = false;
      this.ptwActiveSeatNum = null;
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.installDualBrokerWhisperAndPacer();
      this.connectSecondaryMirrorBroker();
      this.setupTacticalHotkeys();
      this.buildTacticalHudOverlay();
      this.startNetworkGovernorLoop();

      this.engine.log('🌐 [NetworkOptimizer v5.0] SHOWRUNNER Console + Хоткеї (Alt+1..6, PTT) активовано.');
    }

    // =========================================================================
    // 1. ТАКТИЧНІ ГАРЯЧІ КЛАВІШІ (ALT+1..6 ШЕПІТ, ПРОБІЛ/V РАЦІЯ, ALT+M MUTE)
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

        // 1. Alt + M -> Швидкий Mute/Unmute мікрофона
        if (e.altKey && (e.code === 'KeyM' || e.key === 'm' || e.key === 'ь')) {
          e.preventDefault();
          document.getElementById('btn-mic-toggle')?.click();
          return;
        }

        // 2. Утримання Alt + 1..6 -> Миттєвий Шепіт гравцю на кріслі seat1..seat6
        if (e.altKey && /^Digit[1-6]$/.test(e.code)) {
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

        // 3. Утримання Пробілу або клавіші V (коли мікрофон вимкнено) -> Push-To-Talk рація
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

        // Відпускання Alt + 1..6 -> Завершення миттєвого шепоту
        if (this.ptwActiveSeatNum !== null && (/^Digit[1-6]$/.test(e.code) || e.key === 'Alt')) {
          this.ptwActiveSeatNum = null;
          window.AetherOptimizers.audio?.setWhisperTarget(null, false);
          this.renderWhisperBadgesOnSeats();
          this.refreshTacticalHudContent(true);
        }

        // Відпускання Пробілу або V -> Повернення мікрофона в Mute після Push-To-Talk
        if (this.pttActiveByHotkey && (e.code === 'Space' || e.code === 'KeyV')) {
          this.pttActiveByHotkey = false;
          if (this.engine.audio && !this.engine.audio.localMicMuted) {
            document.getElementById('btn-mic-toggle')?.click();
          }
        }
      });
    }

    // =========================================================================
    // 2. ПОДВІЙНИЙ БРОКЕР + МАРШРУТИЗАТОР ПРИВАТНОГО ШЕПОТУ
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
          clientId: 'mirror50_' + this.engine.deviceId + '_' + Math.floor(Math.random() * 9999),
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

    installDualBrokerWhisperAndPacer() {
      if (!this.engine || this.engine._v5NetHooksInstalled) return;
      this.engine._v5NetHooksInstalled = true;

      const origPubAudio = this.engine.publishQuantumAudioPacket.bind(this.engine);
      const origPubVideo = this.engine.publishQuantumVideoPacket.bind(this.engine);
      const origHandleRelay = this.engine.handleQuantumRelayPacket.bind(this.engine);
      const origHandleRoom = this.engine.handleRoomMessage.bind(this.engine);
      const origConnectRoom = this.engine.connectRoom.bind(this.engine);

      this.engine.connectRoom = (roomId) => {
        const res = origConnectRoom(roomId);
        setTimeout(() => this.connectSecondaryMirrorBroker(), 200);
        return res;
      };

      this.engine.handleRoomMessage = (msg) => {
        if (msg && msg.type === 'WHISPER_STATE' && msg.from) {
          if (msg.to) {
            this.activeWhispersMap.set(msg.from, { to: msg.to, targetName: msg.targetName });
          } else {
            this.activeWhispersMap.delete(msg.from);
          }
          this.renderWhisperBadgesOnSeats();
          return;
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

        this.optimizePeerConnections();
        this.guardSocketBackpressure();
        this.updateSeatLatencyBadges();
        this.renderWhisperBadgesOnSeats();
        this.refreshTacticalHudContent();
      }, 1300);
    }

    optimizePeerConnections() {
      const now = Date.now();

      this.engine.peers.forEach((peerObj, remoteId) => {
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

        if (typeof pc.getSenders === 'function' && !peerObj._qosTunedV5) {
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
              peerObj._qosTunedV5 = true;
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
        if (!dev.seat) return;
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
    // 3. ІНТЕРАКТИВНИЙ ПУЛЬТ РЕЖИСЕРА SHOWRUNNER CONSOLE v5.0 (КЛІК ПО 00:00)
    // =========================================================================
    buildTacticalHudOverlay() {
      const clockEl = document.getElementById('session-clock');
      if (clockEl) {
        clockEl.style.cursor = 'pointer';
        clockEl.title = 'Клікніть, щоб відкрити Режисерський Пульт SHOWRUNNER v5.0';
        clockEl.addEventListener('click', () => {
          if (this.hudPanel) {
            const isHidden = this.hudPanel.style.display === 'none';
            this.hudPanel.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) this.refreshTacticalHudContent(true);
          }
        });
      }

      const panel = document.createElement('div');
      panel.id = 'aether-tactical-hud-v5';
      panel.style.cssText = `
        position: fixed;
        bottom: 12px;
        right: 298px;
        width: 356px;
        max-height: 89vh;
        overflow-y: auto;
        background: rgba(10, 13, 16, 0.98);
        border: 1px solid rgba(52, 211, 153, 0.6);
        border-radius: 12px;
        padding: 13px;
        color: #eceff4;
        font-family: Inter, sans-serif;
        font-size: 11px;
        z-index: 9999;
        display: none;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 22px 54px rgba(0, 0, 0, 0.92);
      `;

      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:6px;">
          <strong style="color:#6ee7b7;letter-spacing:0.4px;">🎬 AETHER SHOWRUNNER CONSOLE v5.0</strong>
          <span id="hud-close-btn" style="cursor:pointer;color:#8b929e;font-size:14px;">✕</span>
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

        <div style="font-weight:600;color:#c084fc;font-size:10px;">🎭 МОРФЕР ГОЛОСУ NPC (НА ЛЬОТУ):</div>
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

        <div style="font-weight:600;color:#f87171;font-size:10px;">🩸 БІОМЕТРИЧНА АУРА ВАШОГО КРІСЛА:</div>
        <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:3px;" id="hud-bio-buttons">
          <button data-bio="normal" class="small-btn active" style="font-size:9px;padding:4px 2px;">🟢 Норма</button>
          <button data-bio="wounded" class="small-btn" style="font-size:9px;padding:4px 2px;">🩸 HP &lt;25%</button>
          <button data-bio="cursed" class="small-btn" style="font-size:9px;padding:4px 2px;">🔮 Безумство</button>
          <button data-bio="crit20" class="small-btn" style="font-size:9px;padding:4px 2px;">🎲 Nat 20!</button>
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
            <button id="hud-save-30s-btn" class="small-btn" style="font-size:9px;padding:2px 7px;border-color:#10b981;color:#6ee7b7;" title="Завантажити останні 30 секунд розмови у файл">💾 Хайлайт 30с</button>
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

      const audioOpt = window.AetherOptimizers.audio;
      const videoOpt = window.AetherOptimizers.video;
      const activePreset = audioOpt?.presetMode || 'auto';
      const activeSpace = audioOpt?.currentAcousticSpace || 'dry';
      const activeMorph = audioOpt?.currentVoiceMorph || 'normal';
      const activeBio = videoOpt?.localBiometricState || 'normal';
      const currentWhisperTarget = audioOpt?.whisperTargetId || null;

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
          mixerList.innerHTML = `<div style="color:#64748b;font-size:10px;">Поки немає інших гравців за столом...</div>`;
        } else {
          this.engine.remoteDevices.forEach((dev, remoteId) => {
            const peerCh = this.engine.audio?.getOrCreatePeerChannel(remoteId);
            const currentVolPct = Math.round((audioOpt ? audioOpt.getPlayerCustomVolume(remoteId, dev.name) : 1.0) * 100);
            const panVal = audioOpt ? audioOpt.computeSeatPanPosition(dev.seat) : 0;
            const panBadge = this.formatPanBadge(panVal);
            const isMuted = !!(peerCh && peerCh.muted);
            const isWhisperingToThis = currentWhisperTarget === remoteId;

            const row = document.createElement('div');
            row.style.cssText = `
              display:flex;flex-direction:column;gap:4px;
              background:${isWhisperingToThis ? 'rgba(6, 78, 59, 0.45)' : 'rgba(0,0,0,0.38)'};
              padding:6px 8px;border-radius:6px;
              border:1px solid ${isWhisperingToThis ? '#22d3ee' : 'rgba(255,255,255,0.06)'};
            `;
            row.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:600;color:#e2e8f0;">@${dev.name} <small style="color:#34d399;">[${panBadge}]</small></span>
                <div style="display:flex;align-items:center;gap:4px;">
                  <span class="vol-label" style="font-family:monospace;color:#6ee7b7;font-size:10px;">${currentVolPct}%</span>
                  <button class="small-btn whisper-peer-btn ${isWhisperingToThis ? 'gm-mode' : ''}" style="padding:2px 6px;font-size:9px;">
                    👁️ Шепіт
                  </button>
                  <button class="small-btn mute-peer-btn" style="padding:2px 6px;font-size:10px;">${isMuted ? '🔇' : '🔊'}</button>
                </div>
              </div>
              <input type="range" min="0" max="200" value="${currentVolPct}" style="width:100%;accent-color:#10b981;cursor:pointer;" />
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

            whisperBtn.addEventListener('click', () => {
              audioOpt?.setWhisperTarget(remoteId);
              this.renderWhisperBadgesOnSeats();
              this.refreshTacticalHudContent(true);
            });

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
          <div>• Хоткеї: <b>Alt+1..6</b> (Шепіт) | <b>Пробіл/V</b> (Рація PTT) | <b>Alt+M</b> (Mute)</div>
        `;
      }
    }
  }

  window.AetherOptimizers.register('network', new AetherNetworkOptimizer());
})(window);