/**
 * ============================================================================
 * AETHER NETWORK OPTIMIZER (aether_network_optimizer.js) - v6.1 CENTER CORE
 * ----------------------------------------------------------------------------
 * Оновлення тільки 1 файлу:
 *   1. Рафаель більше НЕ займає крісла гравців (I - VI) — усі крісла вільні!
 *   2. Рафаель розміщується строго ПОСЕРЕДИНІ СТОЛУ (.table-inner-ring, там де '+')
 *      із живою 3D-голограмою нейронної сфери (Idle / Listening / Working / Speaking / Error).
 *   3. Збережено весь стек v6.0: window.AetherRafaelBridge, Dual-Broker (EMQX + HiveMQ),
 *      гарячі клавіші (Alt+1..6 Шепіт, Пробіл/V Рація) та пульт SHOWRUNNER.
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

      // Стан центрального ядра Рафаеля посередині столу
      this.rafaelActive = false;
      this.rafaelState = 'Idle';
      this.rafaelCommandCallbacks = new Set();
      this.rafaelStateCallbacks = new Set();

      // 3D Нейронна сфера для центру столу
      this.centerCoreWrap = null;
      this.centerCanvas = null;
      this.centerCtx = null;
      this.sphereNodes = [];
      this.sphereAngleY = 0;
      this.sphereAngleX = 0;
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.exposeGlobalRafaelBridge();
      this.installDualBrokerWhisperAndRafaelHooks();
      this.connectSecondaryMirrorBroker();
      this.setupTacticalHotkeys();
      this.mountCenterTableRafaelCore();
      this.buildTacticalHudOverlay();
      this.startNetworkGovernorLoop();

      this.engine.log('🌐 [NetworkOptimizer v6.1] Рафаель прив’язаний до ЦЕНТРУ СТОЛУ (крісла гравців вільні).');
    }

    // =========================================================================
    // 1. ЦЕНТРАЛЬНЕ ЯДРО РАФАЕЛЯ ПОСЕРЕДИНІ СТОЛУ (ЗАМІСТЬ '+' У .table-inner-ring)
    // =========================================================================
    mountCenterTableRafaelCore() {
      const innerRing = document.querySelector('.table-inner-ring');
      if (!innerRing || document.getElementById('rafael-table-center-core')) return;

      // Створюємо 72 тривимірні вузли нейронної сфери (розподіл Фібоначчі як на референсі)
      this.sphereNodes = [];
      const count = 72;
      const goldenRatio = (1 + Math.sqrt(5)) / 2;
      for (let i = 0; i < count; i++) {
        const theta = (2 * Math.PI * i) / goldenRatio;
        const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
        const r = 0.72 + (i % 5) * 0.07;
        this.sphereNodes.push({
          bx: r * Math.sin(phi) * Math.cos(theta),
          by: r * Math.sin(phi) * Math.sin(theta),
          bz: r * Math.cos(phi),
          phase: Math.random() * Math.PI * 2,
          size: 1.3 + (i % 3) * 0.65
        });
      }

      const coreWrap = document.createElement('div');
      coreWrap.id = 'rafael-table-center-core';
      coreWrap.style.cssText = `
        position: absolute;
        inset: -8px;
        border-radius: 50%;
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: radial-gradient(circle, rgba(6, 34, 46, 0.92) 0%, rgba(7, 16, 22, 0.78) 68%, transparent 100%);
        border: 1px solid rgba(34, 211, 238, 0.55);
        box-shadow: 0 0 32px rgba(34, 211, 238, 0.35), inset 0 0 24px rgba(34, 211, 238, 0.25);
        cursor: pointer;
        z-index: 15;
        pointer-events: auto;
      `;

      coreWrap.innerHTML = `
        <canvas id="rafael-center-canvas" width="160" height="160" style="width:126px;height:126px;pointer-events:none;"></canvas>
        <div id="rafael-center-badge" style="
          position: absolute;
          bottom: 4px;
          background: rgba(8, 24, 34, 0.92);
          border: 1px solid rgba(34, 211, 238, 0.6);
          color: #a5f3fc;
          font-size: 9.5px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 10px;
          letter-spacing: 0.4px;
          white-space: nowrap;
          box-shadow: 0 0 10px rgba(34, 211, 238, 0.4);
        ">💠 Рафаель • Idle</div>
      `;

      // Клік по ядру Рафаеля в центрі столу озвучує статус або вмикає слух
      coreWrap.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.rafaelState === 'Idle') {
          window.AetherRafaelBridge?.speak('Повідомлення. Ядро Великого Мудреця в центрі столу активне і чекає вказівок.');
        } else {
          this.setRafaelState('Idle', true);
        }
      });

      innerRing.appendChild(coreWrap);
      this.centerCoreWrap = coreWrap;
      this.centerCanvas = coreWrap.querySelector('#rafael-center-canvas');
      this.centerCtx = this.centerCanvas.getContext('2d');

      this.startCenterSphereAnimationLoop();
    }

    syncCenterTableVisibility() {
      const innerRing = document.querySelector('.table-inner-ring');
      if (!innerRing || !this.centerCoreWrap) return;

      const defaultControls = innerRing.querySelector('.table-center-controls');
      const defaultCounter = innerRing.querySelector('.table-seats-counter');

      // Коли Рафаель активний — ховаємо центральний '+' і показуємо сферу Рафаеля посередині столу!
      if (this.rafaelActive) {
        if (defaultControls) defaultControls.style.display = 'none';
        if (defaultCounter) defaultCounter.style.display = 'none';
        this.centerCoreWrap.style.display = 'flex';
      } else {
        if (defaultControls) defaultControls.style.display = 'flex';
        if (defaultCounter) defaultCounter.style.display = 'block';
        this.centerCoreWrap.style.display = 'none';
      }

      const badge = document.getElementById('rafael-center-badge');
      if (badge) {
        const icons = {
          Idle: '💠',
          Listening: '👂',
          Working: '⚙️',
          Speaking: '🗣️',
          Error: '⚠️'
        };
        badge.textContent = `${icons[this.rafaelState] || '💠'} Рафаель • ${this.rafaelState}`;
        badge.style.borderColor = this.rafaelState === 'Error' ? '#f87171' : '#22d3ee';
        badge.style.color = this.rafaelState === 'Error' ? '#fecaca' : '#a5f3fc';
      }
    }

    // 60 FPS рендеринг живої нейронної сфери в центрі столу (за референсом)
    startCenterSphereAnimationLoop() {
      const render = (now) => {
        if (this.rafaelActive && this.centerCtx && !document.hidden) {
          const ctx = this.centerCtx;
          const W = this.centerCanvas.width;
          const H = this.centerCanvas.height;
          const cx = W / 2;
          const cy = H / 2;

          ctx.clearRect(0, 0, W, H);

          const voiceEnergy = window.AetherOptimizers.audio?.getPeerVoiceEnergy(RAFAEL_VIRTUAL_ID) || 0;
          const t = now * 0.001;

          // Швидкість та характер руху залежно від стану (Idle / Listening / Working / Speaking / Error)
          let rotSpeed = 0.009;
          let radiusScale = 52;
          let jitter = 0.03;
          let mainR = 34, mainG = 211, mainB = 238; // Бірюзово-блакитний неон

          if (this.rafaelState === 'Listening') {
            rotSpeed = 0.016;
            radiusScale = 48 + Math.sin(t * 6) * 4;
            mainR = 52; mainG = 211; mainB = 153;
          } else if (this.rafaelState === 'Working') {
            rotSpeed = 0.042;
            radiusScale = 44 + Math.sin(t * 12) * 3;
          } else if (this.rafaelState === 'Speaking') {
            rotSpeed = 0.022;
            radiusScale = 52 + voiceEnergy * 18 + Math.sin(t * 14) * 3;
            jitter = 0.08 + voiceEnergy * 0.12;
          } else if (this.rafaelState === 'Error') {
            rotSpeed = 0.03;
            jitter = 0.18;
            mainR = 248; mainG = 113; mainB = 113;
          } else {
            // Idle — плавне органічне дихання
            radiusScale = 50 + Math.sin(t * 2.2) * 3;
          }

          this.sphereAngleY += rotSpeed;
          this.sphereAngleX += rotSpeed * 0.65;

          const cosY = Math.cos(this.sphereAngleY);
          const sinY = Math.sin(this.sphereAngleY);
          const cosX = Math.cos(this.sphereAngleX);
          const sinX = Math.sin(this.sphereAngleX);

          // Центральне сяйво ядра
          const coreGlow = ctx.createRadialGradient(cx, cy, 2, cx, cy, radiusScale * 0.9);
          coreGlow.addColorStop(0, `rgba(255, 255, 255, ${0.45 + voiceEnergy * 0.45})`);
          coreGlow.addColorStop(0.35, `rgba(${mainR}, ${mainG}, ${mainB}, ${0.32 + voiceEnergy * 0.3})`);
          coreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = coreGlow;
          ctx.beginPath();
          ctx.arc(cx, cy, radiusScale * 0.9, 0, Math.PI * 2);
          ctx.fill();

          // Проєкція 3D вузлів
          const projected = [];
          for (let i = 0; i < this.sphereNodes.length; i++) {
            const n = this.sphereNodes[i];
            const wave = 1 + Math.sin(t * 3 + n.phase) * jitter;
            const x0 = n.bx * wave;
            const y0 = n.by * wave;
            const z0 = n.bz * wave;

            // Обертання навколо Y та X
            const x1 = x0 * cosY - z0 * sinY;
            const z1 = z0 * cosY + x0 * sinY;
            const y2 = y0 * cosX - z1 * sinX;
            const z2 = z1 * cosX + y0 * sinX;

            const perspective = 2.4 / (2.4 - z2 * 0.65);
            projected.push({
              px: cx + x1 * radiusScale * perspective,
              py: cy + y2 * radiusScale * perspective,
              z: z2,
              size: n.size * perspective * (1 + voiceEnergy * 0.45)
            });
          }

          // Малюємо тонкі синаптичні лінії між сусідніми вузлами (як на референсі)
          ctx.lineWidth = 0.75;
          for (let i = 0; i < projected.length; i++) {
            const a = projected[i];
            let links = 0;
            for (let j = i + 1; j < projected.length; j++) {
              const b = projected[j];
              const dx = a.px - b.px;
              const dy = a.py - b.py;
              const distSq = dx * dx + dy * dy;
              if (distSq < 780) {
                const alpha = (1 - distSq / 780) * (0.38 + voiceEnergy * 0.35);
                ctx.strokeStyle = `rgba(${mainR}, ${mainG}, ${mainB}, ${alpha.toFixed(2)})`;
                ctx.beginPath();
                ctx.moveTo(a.px, a.py);
                ctx.lineTo(b.px, b.py);
                ctx.stroke();
                if (++links >= 3) break;
              }
            }
          }

          // Малюємо сяючі квантові точки
          for (let i = 0; i < projected.length; i++) {
            const p = projected[i];
            const depthAlpha = Math.max(0.25, Math.min(1, (p.z + 1.2) / 2.0));
            ctx.fillStyle = p.z > 0.35
              ? `rgba(236, 254, 255, ${depthAlpha})`
              : `rgba(${mainR}, ${mainG}, ${mainB}, ${depthAlpha})`;
            ctx.beginPath();
            ctx.arc(p.px, p.py, p.size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        requestAnimationFrame(render);
      };
      requestAnimationFrame(render);
    }

    // =========================================================================
    // 2. ГЛОБАЛЬНИЙ ШЛЮЗ ВІРТУАЛЬНОГО ПЕЕРА РАФАЕЛЯ (AetherRafaelBridge)
    // =========================================================================
    exposeGlobalRafaelBridge() {
      const self = this;

      window.AetherRafaelBridge = {
        VIRTUAL_PEER_ID: RAFAEL_VIRTUAL_ID,
        STATES: RAFAEL_VALID_STATES,

        spawnVirtualPeer(active = true) {
          return self.setRafaelVirtualNodeActive(active);
        },

        setBotState(newState, broadcast = true) {
          return self.setRafaelState(newState, broadcast);
        },

        getBotState() {
          return self.rafaelState;
        },

        speak(text, sendToChat = true) {
          if (!self.rafaelActive) self.setRafaelVirtualNodeActive(true);
          if (sendToChat && text) {
            self.sendRafaelChatMessage(text);
          }
          window.AetherOptimizers.audio?.playRafaelVoiceResponse(text);
        },

        injectTtsAudio(float32Samples, sampleRate = 24000) {
          if (!self.rafaelActive) self.setRafaelVirtualNodeActive(true);
          window.AetherOptimizers.audio?.injectExternalTtsAudioAsRafael(float32Samples, sampleRate);
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
          return window.AetherOptimizers.audio?.getPeerVoiceEnergy(RAFAEL_VIRTUAL_ID) || 0;
        },

        handleRecognizedSpeech(speakerName, transcript, isWakeWord) {
          self.dispatchPlayerSpeechToRafael(speakerName, transcript, isWakeWord);
        }
      };
    }

    // КРИТИЧНЕ ВИПРАВЛЕННЯ: seat завжди 'table_center' (НЕ займає крісла гравців!)
    setRafaelVirtualNodeActive(active) {
      if (!this.engine) return false;
      this.rafaelActive = !!active;

      if (this.rafaelActive) {
        const virtualDeviceState = {
          deviceId: RAFAEL_VIRTUAL_ID,
          name: 'Рафаель [Мудрець]',
          role: 'ai_assistant',
          seat: RAFAEL_CENTER_SEAT, // Сидить строго в центрі столу, крісла I-VI вільні!
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
        this.engine.log(`🧠 [Rafael Bridge] Ядро @Рафаель активовано в ЦЕНТРІ СТОЛУ.`);
      } else {
        this.engine.remoteDevices.delete(RAFAEL_VIRTUAL_ID);
        if (this.engine.publishRoomPacket) {
          this.engine.publishRoomPacket({
            type: 'RAFAEL_NODE_SYNC',
            active: false,
            botState: 'Idle',
            from: this.engine.deviceId
          });
        }
        this.engine.log('🧠 [Rafael Bridge] Ядро @Рафаель у центрі столу вимкнено.');
      }

      this.syncCenterTableVisibility();
      this.engine.notifyStateChanged();
      this.refreshTacticalHudContent(true);
      return this.rafaelActive;
    }

    setRafaelState(newState, broadcast = true) {
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

      this.syncCenterTableVisibility();
      this.refreshTacticalHudContent();
      return normalized;
    }

    sendRafaelChatMessage(text) {
      if (!this.engine || !text) return;
      this.engine.cb?.onChatMessage?.('Рафаель [AI]', text);
      this.engine.publishRoomPacket({
        type: 'CHAT',
        deviceId: RAFAEL_VIRTUAL_ID,
        author: 'Рафаель [AI]',
        text
      });
    }

    broadcastRafaelAudioPacket(pkt) {
      if (!this.engine || !pkt) return;
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

    dispatchPlayerSpeechToRafael(speakerName, transcript, isWakeWord) {
      if (!transcript) return;

      const payload = {
        speaker: speakerName,
        text: transcript,
        isWakeWord,
        roomContext: {
          roomId: this.engine?.roomId,
          playersCount: 1 + (this.engine?.remoteDevices.size || 0)
        }
      };

      if (isWakeWord) {
        this.setRafaelState('Working', true);
        this.engine?.log(`🧠 [Rafael STT] Команда від @${speakerName}: "${transcript}"`);

        if (this.rafaelCommandCallbacks.size === 0) {
          setTimeout(() => {
            window.AetherRafaelBridge.speak(
              `Повідомлення для ${speakerName}. Запит оброблено центральним ядром Великого Мудреця.`
            );
          }, 650);
        }
      }

      this.rafaelCommandCallbacks.forEach((cb) => {
        try { cb(payload); } catch (_) {}
      });
    }

    // =========================================================================
    // 3. ТАКТИЧНІ ГАРЯЧІ КЛАВІШІ ТА ПОДВІЙНИЙ БРОКЕР
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
          clientId: 'mirror61_' + this.engine.deviceId + '_' + Math.floor(Math.random() * 9999),
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
      if (!this.engine || this.engine._v6NetHooksInstalled) return;
      this.engine._v6NetHooksInstalled = true;

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

        // Синхронізація центрального ядра Рафаеля між усіма гравцями (завжди 'table_center')
        if (msg.type === 'RAFAEL_NODE_SYNC' && msg.from !== this.engine.deviceId) {
          this.rafaelState = msg.botState || 'Idle';
          if (msg.active) {
            this.rafaelActive = true;
            this.engine.remoteDevices.set(RAFAEL_VIRTUAL_ID, {
              deviceId: RAFAEL_VIRTUAL_ID,
              name: 'Рафаель [Мудрець]',
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
            this.engine.remoteDevices.delete(RAFAEL_VIRTUAL_ID);
          }
          this.syncCenterTableVisibility();
          this.engine.notifyStateChanged();
          this.refreshTacticalHudContent(true);
          return;
        }

        if (msg.type === 'RAFAEL_STATE' && msg.from !== this.engine.deviceId) {
          this.setRafaelState(msg.botState || 'Idle', false);
          return;
        }

        if (msg.type === 'CHAT' && msg.text && msg.deviceId !== RAFAEL_VIRTUAL_ID) {
          const low = msg.text.toLowerCase();
          if (low.includes('рафаель') || low.includes('рафаэль') || low.includes('мудрець')) {
            this.dispatchPlayerSpeechToRafael(msg.author || 'Гравець', msg.text, true);
          }
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

        const rafDev = this.engine.remoteDevices.get(RAFAEL_VIRTUAL_ID);
        if (rafDev) {
          rafDev._lastSeen = Date.now() + 3600000;
          rafDev.seat = RAFAEL_CENTER_SEAT;
        }

        this.optimizePeerConnections();
        this.guardSocketBackpressure();
        this.updateSeatLatencyBadges();
        this.renderWhisperBadgesOnSeats();
        this.syncCenterTableVisibility();
        this.refreshTacticalHudContent();
      }, 1300);
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

        if (typeof pc.getSenders === 'function' && !peerObj._qosTunedV6) {
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
              peerObj._qosTunedV6 = true;
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
    // 4. SHOWRUNNER CONSOLE v6.1 + ПАНЕЛЬ КЕРУВАННЯ ЦЕНТРАЛЬНИМ ЯДРОМ РАФАЕЛЯ
    // =========================================================================
    buildTacticalHudOverlay() {
      const clockEl = document.getElementById('session-clock');
      if (clockEl) {
        clockEl.style.cursor = 'pointer';
        clockEl.title = 'Клікніть, щоб відкрити Пульт SHOWRUNNER v6.1 + Ядро Рафаеля';
        clockEl.addEventListener('click', () => {
          if (this.hudPanel) {
            const isHidden = this.hudPanel.style.display === 'none';
            this.hudPanel.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) this.refreshTacticalHudContent(true);
          }
        });
      }

      const panel = document.createElement('div');
      panel.id = 'aether-tactical-hud-v61';
      panel.style.cssText = `
        position: fixed;
        bottom: 12px;
        right: 298px;
        width: 364px;
        max-height: 90vh;
        overflow-y: auto;
        background: rgba(10, 13, 17, 0.98);
        border: 1px solid rgba(34, 211, 238, 0.55);
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
          <strong style="color:#67e8f9;letter-spacing:0.4px;">🧠 AETHER SHOWRUNNER & RAFAEL v6.1</strong>
          <span id="hud-close-btn" style="cursor:pointer;color:#8b929e;font-size:14px;">✕</span>
        </div>

        <div style="display:flex;flex-direction:column;gap:5px;background:rgba(8, 47, 73, 0.38);padding:8px;border-radius:8px;border:1px solid rgba(34, 211, 238, 0.4);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="color:#a5f3fc;font-size:10px;">💠 ЯДРО «РАФАЕЛЬ» (ЦЕНТР СТОЛУ):</strong>
            <span id="hud-rafael-state-pill" style="font-family:monospace;font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(34,211,238,0.18);color:#67e8f9;">Idle</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;">
            <button id="hud-btn-rafael-spawn" class="small-btn" style="font-size:9px;padding:4px 2px;">💠 Ядро: ВИМК</button>
            <button id="hud-btn-rafael-stt" class="small-btn" style="font-size:9px;padding:4px 2px;">👂 Слух STT</button>
            <button id="hud-btn-rafael-speak" class="small-btn" style="font-size:9px;padding:4px 2px;border-color:#22d3ee;color:#a5f3fc;">🗣️ Тест Голосу</button>
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
        this.setRafaelVirtualNodeActive(!this.rafaelActive);
      });

      panel.querySelector('#hud-btn-rafael-stt').addEventListener('click', () => {
        const audioOpt = window.AetherOptimizers.audio;
        if (audioOpt) {
          audioOpt.setRafaelSttListening(!audioOpt.sttEnabled);
          this.refreshTacticalHudContent();
        }
      });

      panel.querySelector('#hud-btn-rafael-speak').addEventListener('click', () => {
        window.AetherRafaelBridge?.speak(
          'Повідомлення. Ядро Великого Мудреця Рафаеля розміщено в центрі столу. Усі крісла оперативників вільні.'
        );
      });

      panel.querySelectorAll('#hud-rafael-state-btns button').forEach((btn) => {
        btn.addEventListener('click', () => {
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

      const audioOpt = window.AetherOptimizers.audio;
      const videoOpt = window.AetherOptimizers.video;
      const activePreset = audioOpt?.presetMode || 'auto';
      const activeSpace = audioOpt?.currentAcousticSpace || 'dry';
      const activeMorph = audioOpt?.currentVoiceMorph || 'normal';
      const activeBio = videoOpt?.localBiometricState || 'normal';
      const currentWhisperTarget = audioOpt?.whisperTargetId || null;

      const spawnBtn = this.hudPanel.querySelector('#hud-btn-rafael-spawn');
      if (spawnBtn) {
        spawnBtn.textContent = this.rafaelActive ? '💠 Ядро: У ЦЕНТРІ' : '💠 Ядро: ВИМК';
        spawnBtn.classList.toggle('active', this.rafaelActive);
      }

      const sttBtn = this.hudPanel.querySelector('#hud-btn-rafael-stt');
      if (sttBtn) {
        const sttOn = !!(audioOpt && audioOpt.sttEnabled);
        sttBtn.textContent = sttOn ? '👂 STT: АКТИВ' : '👂 Слух STT';
        sttBtn.classList.toggle('active', sttOn);
      }

      const statePill = this.hudPanel.querySelector('#hud-rafael-state-pill');
      if (statePill) {
        statePill.textContent = this.rafaelState;
      }

      this.hudPanel.querySelectorAll('#hud-rafael-state-btns button').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-rstate') === this.rafaelState);
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
          mixerList.innerHTML = `<div style="color:#64748b;font-size:10px;">Поки немає інших учасників (або увімкніть Ядро Рафаеля вище)...</div>`;
        } else {
          this.engine.remoteDevices.forEach((dev, remoteId) => {
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
          <div>• Позиція Рафаеля: <b>ЦЕНТР СТОЛУ (${this.rafaelState})</b></div>
        `;
      }
    }
  }

  window.AetherOptimizers.register('network', new AetherNetworkOptimizer());
})(window);