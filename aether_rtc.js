/**
 * ============================================================================
 * AETHER NETWORK & HYBRID MEDIA ENGINE (aether_rtc.js) - v5.0 OMEGA
 * ----------------------------------------------------------------------------
 * Трирівнева архітектура гарантованої доставки Аудіо та Відео між країнами:
 *   1. WebRTC P2P (W3C Perfect Negotiation + Pre-warmed ICE Pool)
 *   2. Multi-Port TURN Relay (UDP 80/3478 + TCP/TLS 443 NAT Traversal)
 *   3. Aether Quantum Relay (Автоматичний фолбек передачі Відео та Голосу
 *      через захищений WebSocket, якщо провайдер блокує WebRTC)
 * ============================================================================
 */

(function (window) {
  'use strict';

  const PROFILE_STORAGE_KEY = 'entropia_aether_profile_v5';
  const SESSION_DEVICE_KEY = 'entropia_aether_tab_id_v5';

  // Список брокерів із автоматичним резервуванням
  const MQTT_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];

  // Розширений пул STUN + TURN серверів (включно з TCP/443 для пробиття мобільних операторів у різних країнах)
  const RTC_CONFIGURATION = {
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp',
          'turns:openrelay.metered.ca:443?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  };

  class AetherRTCEngine {
    constructor(callbacks = {}) {
      this.cb = callbacks;
      this.brokerIndex = 0;

      // 1. Унікальний ID вкладки + збережений профіль (GM / Гравець окремо)
      this.deviceId = sessionStorage.getItem(SESSION_DEVICE_KEY);
      if (!this.deviceId) {
        this.deviceId = 'node_' + Math.random().toString(36).substring(2, 10);
        sessionStorage.setItem(SESSION_DEVICE_KEY, this.deviceId);
      }

      this.profile = this.loadProfile();

      const urlParams = new URLSearchParams(window.location.search);
      this.roomId = (urlParams.get('room') || this.profile.roomId || 'entropia-1').trim();
      this.playerSeatCount = Number(this.profile.playerSeatCount) || 6;

      const initialRole = this.detectInitialRole();
      const initialName = initialRole === 'gm'
        ? (this.profile.gmName || 'Архітект (GM)')
        : (this.profile.playerName || this.readBridgePlayerName() || 'Оперативник');
      const initialSeat = initialRole === 'gm'
        ? 'gm'
        : (this.profile.playerSeat || 'seat1');

      this.localState = {
        deviceId: this.deviceId,
        name: initialName,
        role: initialRole,
        seat: initialSeat,
        inGame: false,
        hasVideo: false,
        hasAudio: false,
        transport: 'standby',
        mediaRev: 0
      };

      // Стан кімнати та з'єднань
      this.remoteDevices = new Map(); // remoteId -> { ...state, _lastSeen }
      this.peers = new Map();         // remoteId -> PeerSession

      // Локальні медіаресурси
      this.localStream = null;
      this.localVideoSamplerEl = null;
      this.selectedSpeakerId = 'default';

      // Web Audio API (аналіз мовлення + Quantum Audio Relay)
      this.audioContext = null;
      this.analysers = new Map();
      this.localAudioRelayProcessor = null;

      // Quantum Video Relay (стиснення кадрів для резервного каналу)
      this.txCanvas = document.createElement('canvas');
      this.txCanvas.width = 220;
      this.txCanvas.height = 165;
      this.txCtx = this.txCanvas.getContext('2d', { alpha: false });
      this.quantumRelayTimer = null;

      this.setupBridgeIntegration();
      this.startBackgroundLoops();
    }

    log(msg) {
      console.log(`%c[Aether v5.0]%c ${msg}`, 'color:#10b981;font-weight:bold;', 'color:#e2e8f0;');
      this.cb.onLog?.(msg);
    }

    // =========================================================================
    // 1. КЕРУВАННЯ ПРОФІЛЕМ ТА ЗАХИСТ РОЛІ МАЙСТРА (GM)
    // =========================================================================
    loadProfile() {
      try {
        const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return {
        role: null,
        gmName: 'Архітект (GM)',
        playerName: null,
        playerSeat: 'seat1',
        roomId: 'entropia-1',
        playerSeatCount: 6
      };
    }

    saveProfile() {
      this.profile.role = this.localState.role;
      this.profile.roomId = this.roomId;
      this.profile.playerSeatCount = this.playerSeatCount;

      if (this.localState.role === 'gm') {
        this.profile.gmName = this.localState.name;
      } else {
        this.profile.playerName = this.localState.name;
        if (this.localState.seat !== 'gm') {
          this.profile.playerSeat = this.localState.seat;
        }
      }
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(this.profile));
      localStorage.setItem('entropia_user_role', this.localState.role);
      sessionStorage.setItem('entropia_user_role', this.localState.role);
    }

    detectInitialRole() {
      const urlParams = new URLSearchParams(window.location.search);
      const hash = window.location.hash.toLowerCase();
      if (
        urlParams.get('role') === 'gm' ||
        urlParams.get('mode') === 'admin' ||
        urlParams.get('admin') === 'true' ||
        hash.includes('admin') ||
        hash.includes('gm')
      ) {
        return 'gm';
      }
      if (this.profile.role === 'gm' || this.profile.role === 'player') {
        return this.profile.role;
      }
      const saved = sessionStorage.getItem('entropia_user_role') || localStorage.getItem('entropia_user_role');
      return saved === 'gm' ? 'gm' : 'player';
    }

    readBridgePlayerName() {
      try {
        const raw = localStorage.getItem('entropia_active_character');
        if (raw) {
          const c = JSON.parse(raw);
          return c.name || c.callsign || null;
        }
      } catch (_) {}
      return null;
    }

    setupBridgeIntegration() {
      const onSheetData = (char, sheetRole) => {
        if (sheetRole === 'gm' && this.localState.role !== 'gm') {
          this.setRole('gm', true);
          return;
        }
        // ЖОРСТКИЙ ЗАХИСТ: якщо ми Майстер (GM), чужий відкритий лист персонажа ігнорується
        if (this.localState.role === 'gm') return;

        if (char && (char.name || char.callsign)) {
          this.localState.name = char.name || char.callsign;
          this.saveProfile();
          this.publishPresence();
          this.notifyStateChanged();
        }
      };

      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'CHARACTER_UPDATE') {
          onSheetData(e.data.character, e.data.role);
        }
      });

      if (window.EntropiaBridge && typeof window.EntropiaBridge.on === 'function') {
        window.EntropiaBridge.on('characterUpdate', (char) => onSheetData(char));
        window.EntropiaBridge.on('roleChange', (role) => {
          if (role !== this.localState.role) this.setRole(role, true);
        });
      }
    }

    setRole(targetRole, skipPassword = false) {
      if (targetRole === 'gm' && this.localState.role !== 'gm' && !skipPassword) {
        const pass = prompt('Введіть пароль Майстра («ентропія»):');
        if (!pass) return false;
        const clean = pass.trim().toLowerCase()
          .replace(/e/g, 'е').replace(/i/g, 'і').replace(/o/g, 'о').replace(/p/g, 'р').replace(/a/g, 'а').replace(/c/g, 'с');
        if (clean !== 'ентропія') {
          alert('Невірний пароль Майстра.');
          return false;
        }
      }

      this.localState.role = targetRole === 'gm' ? 'gm' : 'player';
      if (this.localState.role === 'gm') {
        this.localState.seat = 'gm';
        this.localState.name = this.profile.gmName || 'Архітект (GM)';
      } else {
        this.localState.seat = this.profile.playerSeat || 'seat1';
        this.localState.name = this.profile.playerName || this.readBridgePlayerName() || 'Оперативник';
        this.resolveSeatConflict();
      }

      this.saveProfile();
      this.publishPresence();
      this.notifyStateChanged();
      return true;
    }

    setName(newName) {
      this.localState.name = (newName || '').trim() || (this.localState.role === 'gm' ? 'Архітект (GM)' : 'Оперативник');
      this.saveProfile();
      this.publishPresence();
      this.notifyStateChanged();
    }

    // =========================================================================
    // 2. МУЛЬТИ-БРОКЕРНИЙ MQTT ТРАНСПОРТ (СИГНАЛІНГ + QUANTUM RELAY)
    // =========================================================================
    connectRoom(roomId) {
      if (roomId) {
        this.roomId = roomId.trim() || 'entropia-1';
        this.saveProfile();
      }

      if (this.mqttClient) {
        try { this.mqttClient.end(true); } catch (_) {}
      }

      this.remoteDevices.clear();
      this.peers.forEach((_, id) => this.closePeer(id));

      const base = `entropia_ark_317/omega_v5/${this.roomId}`;
      this.roomTopic = `${base}/room`;
      this.sigTopicForMe = `${base}/sig/${this.deviceId}`;
      this.sigPrefix = `${base}/sig/`;
      this.mediaRelayTopic = `${base}/media`;

      const brokerUrl = MQTT_BROKERS[this.brokerIndex % MQTT_BROKERS.length];
      this.cb.onNetworkStatus?.('Підключення...', false);
      this.log(`З'єднання з вузлом ${brokerUrl} (Кімната: ${this.roomId})...`);

      this.mqttClient = window.mqtt.connect(brokerUrl, {
        clientId: 'omega_' + this.deviceId + '_' + Math.floor(Math.random() * 9999),
        clean: true,
        connectTimeout: 6000,
        reconnectPeriod: 3000,
        will: {
          topic: this.roomTopic,
          payload: JSON.stringify({ type: 'LEAVE', deviceId: this.deviceId }),
          qos: 0,
          retain: false
        }
      });

      this.mqttClient.on('connect', () => {
        this.cb.onNetworkStatus?.(`Онлайн (${this.roomId})`, true);
        this.log(`Канал синхронізації відкрито (${this.deviceId}).`);

        this.mqttClient.subscribe(this.roomTopic, { qos: 0 });
        this.mqttClient.subscribe(this.sigTopicForMe, { qos: 0 });
        this.mqttClient.subscribe(this.mediaRelayTopic, { qos: 0 });

        this.publishRoomPacket({ type: 'HELLO', from: this.deviceId });
        this.publishPresence();
      });

      this.mqttClient.on('message', (topic, payload) => {
        try {
          const data = JSON.parse(payload.toString());
          if (topic === this.roomTopic) {
            this.handleRoomMessage(data);
          } else if (topic === this.sigTopicForMe) {
            this.handleSignalingMessage(data);
          } else if (topic === this.mediaRelayTopic) {
            this.handleQuantumRelayPacket(data);
          }
        } catch (_) {}
      });

      this.mqttClient.on('error', () => {
        // Якщо основний брокер недоступний у країні гравця — перемикаємося на резервний
        this.brokerIndex = (this.brokerIndex + 1) % MQTT_BROKERS.length;
      });

      this.mqttClient.on('offline', () => {
        this.cb.onNetworkStatus?.('Перепідключення...', false);
      });
    }

    publishRoomPacket(packet) {
      if (!this.mqttClient || !this.mqttClient.connected) return;
      this.mqttClient.publish(this.roomTopic, JSON.stringify(packet), { qos: 0, retain: false });
    }

    publishPresence() {
      this.publishRoomPacket({
        type: 'PRESENCE',
        state: this.localState
      });
    }

    publishSeatCount(count) {
      this.playerSeatCount = count;
      this.saveProfile();
      this.publishRoomPacket({
        type: 'SEAT_COUNT',
        playerSeatCount: count,
        from: this.deviceId
      });
    }

    sendChat(text) {
      this.publishRoomPacket({
        type: 'CHAT',
        deviceId: this.deviceId,
        author: this.localState.name,
        text
      });
    }

    sendSignal(targetId, packet) {
      if (!this.mqttClient || !this.mqttClient.connected) return;
      this.mqttClient.publish(
        this.sigPrefix + targetId,
        JSON.stringify({
          ...packet,
          from: this.deviceId,
          to: targetId
        }),
        { qos: 0, retain: false }
      );
    }

    handleRoomMessage(msg) {
      if (!msg) return;

      if (msg.type === 'HELLO' && msg.from !== this.deviceId) {
        this.publishPresence();
        return;
      }

      if (msg.type === 'LEAVE' && msg.deviceId && msg.deviceId !== this.deviceId) {
        this.remoteDevices.delete(msg.deviceId);
        this.closePeer(msg.deviceId);
        this.notifyStateChanged();
        return;
      }

      if (msg.type === 'SEAT_COUNT' && msg.from !== this.deviceId) {
        this.cb.onSeatCountSync?.(Number(msg.playerSeatCount));
        return;
      }

      if (msg.type === 'CHAT' && msg.deviceId !== this.deviceId) {
        this.cb.onChatMessage?.(msg.author, msg.text);
        return;
      }

      if (msg.type === 'PRESENCE' && msg.state && msg.state.deviceId !== this.deviceId) {
        const remote = msg.state;
        const remoteId = remote.deviceId;
        const prev = this.remoteDevices.get(remoteId);

        remote._lastSeen = Date.now();
        this.remoteDevices.set(remoteId, remote);

        // Автоматичне розведення по вільних кріслах для гравців
        if (this.localState.role !== 'gm' && remote.seat === this.localState.seat && remoteId < this.deviceId) {
          this.resolveSeatConflict();
        }

        // Гарантуємо існування постійної PeerSession для цього учасника (без скидання існуючої!)
        const peerObj = this.getOrCreatePeer(remoteId);

        // Якщо хтось із нас увімкнув або оновив камеру/мікрофон — запускаємо узгодження WebRTC
        const remoteMediaUpdated = !prev || prev.mediaRev !== remote.mediaRev || prev.inGame !== remote.inGame;
        if (remoteMediaUpdated && (this.localStream || remote.inGame)) {
          if (this.deviceId > remoteId) {
            this.triggerNegotiation(remoteId);
          } else {
            this.sendSignal(remoteId, { type: 'PLEASE_OFFER' });
          }
        }

        this.notifyStateChanged();
      }
    }

    resolveSeatConflict() {
      const occupied = new Set();
      this.remoteDevices.forEach((d) => {
        if (d.seat) occupied.add(d.seat);
      });
      if (!occupied.has(this.localState.seat)) return;

      for (let i = 1; i <= this.playerSeatCount; i++) {
        const s = `seat${i}`;
        if (!occupied.has(s)) {
          this.localState.seat = s;
          this.saveProfile();
          this.publishPresence();
          return;
        }
      }
    }

    claimSeat(seatId) {
      if (seatId === 'gm' && this.localState.role !== 'gm') {
        return this.setRole('gm', false);
      }
      if (seatId !== 'gm' && this.localState.role === 'gm') {
        if (!confirm('Перейти з місця Майстра на крісло Гравця?')) return false;
        this.localState.role = 'player';
      }

      for (const [, dev] of this.remoteDevices.entries()) {
        if (dev.seat === seatId) {
          alert(`Це крісло вже зайняте учасником ${dev.name}`);
          return false;
        }
      }

      this.localState.seat = seatId;
      this.saveProfile();
      this.publishPresence();
      this.notifyStateChanged();
      return true;
    }

    // =========================================================================
    // 3. ЗАХОПЛЕННЯ КАМЕРИ ТА МІКРОФОНА (АДАПТИВНИЙ ЗАХВАТ + BACKUP STREAM)
    // =========================================================================
    createTacticalFallbackVideoTrack() {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      let phase = 0;

      if (this._fallbackCanvasTimer) clearInterval(this._fallbackCanvasTimer);
      this._fallbackCanvasTimer = setInterval(() => {
        phase += 0.1;
        ctx.fillStyle = '#0d1512';
        ctx.fillRect(0, 0, 320, 240);

        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(160, 108, 38 + Math.sin(phase) * 5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#6ee7b7';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.localState.name || 'ОПЕРАТИВНИК', 160, 113);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px monospace';
        ctx.fillText('ГОЛОСОВИЙ КОНТУР АКТИВНИЙ', 160, 198);
      }, 100);

      const stream = canvas.captureStream(12);
      return stream.getVideoTracks()[0];
    }

    async startLocalMedia(micDeviceId = '', camDeviceId = '') {
      this.ensureAudioContext();

      // Гнучкі налаштування: спочатку просимо комфортний HD/SD без жорстких max-лімітів,
      // які могли викликати помилку на смартфонах
      const videoOpts = {
        width: { ideal: 480 },
        height: { ideal: 360 },
        frameRate: { ideal: 20 }
      };
      const audioOpts = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };

      if (micDeviceId) audioOpts.deviceId = { ideal: micDeviceId };
      if (camDeviceId) videoOpts.deviceId = { ideal: camDeviceId };

      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
        this.localStream = null;
      }

      let hasVid = false;
      let hasAud = false;

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            video: videoOpts,
            audio: audioOpts
          });
          hasVid = this.localStream.getVideoTracks().length > 0;
          hasAud = this.localStream.getAudioTracks().length > 0;
          this.log(`Камера та мікрофон успішно активовані.`);
        } catch (err1) {
          // Спроба 2: максимально прості констрейнти { video: true, audio: true }
          try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: true
            });
            hasVid = this.localStream.getVideoTracks().length > 0;
            hasAud = this.localStream.getAudioTracks().length > 0;
            this.log(`Камера та мікрофон увімкнені (стандартний профіль).`);
          } catch (err2) {
            // Спроба 3: тільки мікрофон + синтетична бодікамера
            try {
              this.localStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: true
              });
              hasAud = this.localStream.getAudioTracks().length > 0;
              const synthVid = this.createTacticalFallbackVideoTrack();
              if (synthVid) {
                this.localStream.addTrack(synthVid);
                hasVid = true;
              }
              this.log(`Мікрофон увімкнено (камера замінена тактичним аватаром).`);
            } catch (err3) {
              this.log(`Доступ до камери/мікрофона відсутній (${err3.name}). Активовано віртуальний потік.`);
            }
          }
        }
      }

      if (!this.localStream) {
        this.localStream = new MediaStream();
        const synthVid = this.createTacticalFallbackVideoTrack();
        if (synthVid) {
          this.localStream.addTrack(synthVid);
          hasVid = true;
        }
      }

      // Підготовка джерела для Quantum Relay (резервна трансляція через WebSocket)
      this.setupLocalQuantumRelaySources(this.localStream);

      this.localState.inGame = true;
      this.localState.hasVideo = hasVid;
      this.localState.hasAudio = hasAud;
      this.localState.mediaRev += 1;

      if (hasAud) {
        this.attachVoiceAnalyser(this.deviceId, this.localStream);
      }

      // Прикріплюємо або замінюємо треки у всіх активних PeerConnections
      for (const [remoteId, peerObj] of this.peers.entries()) {
        this.syncLocalTracksToPeer(peerObj);
        await this.triggerNegotiation(remoteId);
      }

      this.publishPresence();
      this.notifyStateChanged();
      return this.localStream;
    }

    // =========================================================================
    // 4. WEBRTC PERFECT NEGOTIATION ENGINE (БЕЗ СКИДАННЯ З'ЄДНАНЬ)
    // =========================================================================
    getOrCreatePeer(remoteId) {
      if (this.peers.has(remoteId)) {
        return this.peers.get(remoteId);
      }

      const pc = new RTCPeerConnection(RTC_CONFIGURATION);

      // Створюємо приймальний Canvas для Quantum Relay (працює миттєво, поки WebRTC пробиває NAT)
      const relayCanvas = document.createElement('canvas');
      relayCanvas.width = 220;
      relayCanvas.height = 165;
      const relayCtx = relayCanvas.getContext('2d');
      relayCtx.fillStyle = '#101614';
      relayCtx.fillRect(0, 0, 220, 165);
      const relayStream = relayCanvas.captureStream(15);

      const webrtcStream = new MediaStream();

      const peerObj = {
        remoteId,
        pc,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        iceQueue: [],
        webrtcStream,
        relayCanvas,
        relayCtx,
        relayStream,
        remoteStream: relayStream, // Спочатку показуємо relayStream, при підключенні P2P перемикаємо на webrtcStream
        p2pConnected: false,
        hasRelayFrames: false,
        connState: 'connecting'
      };

      this.peers.set(remoteId, peerObj);

      // Якщо наш потік уже запущений — одразу додаємо треки в PC
      this.syncLocalTracksToPeer(peerObj);

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          this.sendSignal(remoteId, {
            type: 'ICE',
            candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate
          });
        }
      };

      pc.ontrack = (e) => {
        if (e.streams && e.streams[0]) {
          e.streams[0].getTracks().forEach((t) => {
            if (!peerObj.webrtcStream.getTracks().some((ex) => ex.id === t.id)) {
              peerObj.webrtcStream.addTrack(t);
            }
          });
        } else if (e.track) {
          if (!peerObj.webrtcStream.getTracks().some((ex) => ex.id === e.track.id)) {
            peerObj.webrtcStream.addTrack(e.track);
          }
        }

        // Перемикаємо відображення на прямий WebRTC потік
        peerObj.remoteStream = peerObj.webrtcStream;
        peerObj.p2pConnected = true;
        peerObj.connState = 'connected';

        const rName = this.remoteDevices.get(remoteId)?.name || remoteId;
        this.log(`Прямий WebRTC потік (${e.track.kind}) від @${rName} активний!`);

        this.attachVoiceAnalyser(remoteId, peerObj.webrtcStream);
        this.notifyStateChanged();
      };

      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        peerObj.connState = st;
        const rName = this.remoteDevices.get(remoteId)?.name || remoteId;

        if (st === 'connected' || st === 'completed') {
          peerObj.p2pConnected = true;
          if (peerObj.webrtcStream.getTracks().length > 0) {
            peerObj.remoteStream = peerObj.webrtcStream;
          }
          this.log(`P2P з'єднання з @${rName} встановлено (${st}).`);
        } else if (st === 'failed' || st === 'disconnected') {
          peerObj.p2pConnected = false;
          // Автоматично перемикаємося на WebSocket Quantum Relay без обриву зв'язку!
          peerObj.remoteStream = peerObj.relayStream;
          this.log(`NAT блокує прямий UDP з @${rName} — працює Quantum Relay (WebSocket).`);

          if (st === 'failed' && this.deviceId > remoteId) {
            this.triggerNegotiation(remoteId, true);
          }
        }
        this.notifyStateChanged();
      };

      return peerObj;
    }

    syncLocalTracksToPeer(peerObj) {
      if (!this.localStream) return;
      const pc = peerObj.pc;
      const senders = pc.getSenders();

      this.localStream.getTracks().forEach((track) => {
        const existingSender = senders.find((s) => s.track && s.track.kind === track.kind);
        if (existingSender) {
          existingSender.replaceTrack(track).catch(() => {});
        } else {
          try {
            pc.addTrack(track, this.localStream);
          } catch (_) {}
        }
      });
    }

    async triggerNegotiation(remoteId, iceRestart = false) {
      const peerObj = this.getOrCreatePeer(remoteId);
      const pc = peerObj.pc;

      if (peerObj.makingOffer || pc.signalingState !== 'stable') return;

      try {
        peerObj.makingOffer = true;
        this.syncLocalTracksToPeer(peerObj);

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
          iceRestart
        });

        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);

        this.sendSignal(remoteId, {
          type: 'SDP',
          description: {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp
          }
        });
      } catch (err) {
        console.warn('[WebRTC] Помилка створення Offer:', err);
      } finally {
        peerObj.makingOffer = false;
      }
    }

    async handleSignalingMessage(msg) {
      if (!msg || !msg.from || msg.from === this.deviceId) return;
      const remoteId = msg.from;
      const peerObj = this.getOrCreatePeer(remoteId);
      const pc = peerObj.pc;

      if (msg.type === 'PLEASE_OFFER') {
        await this.triggerNegotiation(remoteId);
        return;
      }

      // W3C Perfect Negotiation Pattern: молодший ID є "polite" і поступається при одночасному Offer
      const polite = this.deviceId < remoteId;

      try {
        if (msg.type === 'SDP' && msg.description) {
          const desc = msg.description;
          const readyForOffer =
            !peerObj.makingOffer &&
            (pc.signalingState === 'stable' || peerObj.isSettingRemoteAnswerPending);
          const offerCollision = desc.type === 'offer' && !readyForOffer;

          peerObj.ignoreOffer = !polite && offerCollision;
          if (peerObj.ignoreOffer) {
            return;
          }

          peerObj.isSettingRemoteAnswerPending = desc.type === 'answer';
          if (offerCollision) {
            await pc.setLocalDescription({ type: 'rollback' });
          }

          this.syncLocalTracksToPeer(peerObj);
          await pc.setRemoteDescription(new RTCSessionDescription(desc));
          peerObj.isSettingRemoteAnswerPending = false;

          // Додаємо всі буферизовані ICE-кандидати
          while (peerObj.iceQueue.length > 0) {
            const c = peerObj.iceQueue.shift();
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
          }

          if (desc.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.sendSignal(remoteId, {
              type: 'SDP',
              description: {
                type: pc.localDescription.type,
                sdp: pc.localDescription.sdp
              }
            });
          }
        } else if (msg.type === 'ICE' && msg.candidate) {
          if (peerObj.ignoreOffer) return;
          if (pc.remoteDescription && pc.remoteDescription.type) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (_) {}
          } else {
            peerObj.iceQueue.push(msg.candidate);
          }
        }
      } catch (err) {
        peerObj.isSettingRemoteAnswerPending = false;
        console.warn('[WebRTC] Помилка обробки сигналу:', err);
      }
    }

    // =========================================================================
    // 5. AETHER QUANTUM RELAY (WEBSOCKET MEDIABank ДЛЯ ПРОБИТТЯ БУДЬ-ЯКИХ КРАЇН)
    // =========================================================================
    setupLocalQuantumRelaySources(stream) {
      // 1. Джерело відеокадрів
      if (!this.localVideoSamplerEl) {
        this.localVideoSamplerEl = document.createElement('video');
        this.localVideoSamplerEl.muted = true;
        this.localVideoSamplerEl.playsInline = true;
        this.localVideoSamplerEl.autoplay = true;
      }
      this.localVideoSamplerEl.srcObject = stream;
      this.localVideoSamplerEl.play().catch(() => {});

      // 2. Джерело аудіопотоку (PCM стиснення для передачі голосу через WebSocket, якщо P2P ще не з'єднався)
      if (stream.getAudioTracks().length > 0) {
        try {
          this.ensureAudioContext();
          if (this.localAudioRelayProcessor) {
            try { this.localAudioRelayProcessor.disconnect(); } catch (_) {}
          }
          const src = this.audioContext.createMediaStreamSource(stream);
          const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
          this.localAudioRelayProcessor = processor;

          processor.onaudioprocess = (e) => {
            if (!this.localState.inGame || !this.localState.hasAudio) return;
            // Перевіряємо, чи є в кімнаті хоча б один гравець, з яким P2P ще не піднявся
            if (!this.needsQuantumRelay()) return;

            const input = e.inputBuffer.getChannelData(0);
            // Перевірка порогу гучності (Noise Gate), щоб не слати тишу в мережу
            let sum = 0;
            for (let i = 0; i < input.length; i += 4) sum += Math.abs(input[i]);
            const avg = sum / (input.length / 4);
            if (avg < 0.012) return;

            // Даунсемплінг у 4 рази (~11025 Hz) до 8-бітного PCM для миттєвої доставки
            const ratio = 4;
            const outLen = Math.floor(input.length / ratio);
            const bytes = new Uint8Array(outLen);
            for (let i = 0; i < outLen; i++) {
              const s = Math.max(-1, Math.min(1, input[i * ratio]));
              bytes[i] = Math.round((s + 1) * 127.5);
            }

            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }

            if (this.mqttClient && this.mqttClient.connected) {
              this.mqttClient.publish(
                this.mediaRelayTopic,
                JSON.stringify({
                  t: 'A',
                  from: this.deviceId,
                  sr: Math.round(this.audioContext.sampleRate / ratio),
                  d: btoa(binary)
                }),
                { qos: 0, retain: false }
              );
            }
          };

          src.connect(processor);
          processor.connect(this.audioContext.destination);
        } catch (e) {
          console.warn('[QuantumRelay] Помилка ініціалізації аудіо-ретранслятора:', e);
        }
      }

      // 3. Цикл відправки відеокадрів (6 FPS WebP/JPEG ~3 KB), поки P2P встановлюється або заблокований
      if (this.quantumRelayTimer) clearInterval(this.quantumRelayTimer);
      this.quantumRelayTimer = setInterval(() => {
        if (!this.localState.inGame || !this.localState.hasVideo) return;
        if (!this.needsQuantumRelay()) return;
        if (!this.localVideoSamplerEl || this.localVideoSamplerEl.readyState < 2) return;

        try {
          this.txCtx.drawImage(this.localVideoSamplerEl, 0, 0, 220, 165);
          const frameDataUrl = this.txCanvas.toDataURL('image/jpeg', 0.48);

          if (this.mqttClient && this.mqttClient.connected) {
            this.mqttClient.publish(
              this.mediaRelayTopic,
              JSON.stringify({
                t: 'V',
                from: this.deviceId,
                d: frameDataUrl
              }),
              { qos: 0, retain: false }
            );
          }
        } catch (_) {}
      }, 170);
    }

    needsQuantumRelay() {
      if (this.remoteDevices.size === 0) return false;
      for (const [remoteId] of this.remoteDevices.entries()) {
        const peerObj = this.peers.get(remoteId);
        if (!peerObj || !peerObj.p2pConnected) {
          return true;
        }
      }
      return false;
    }

    handleQuantumRelayPacket(pkt) {
      if (!pkt || !pkt.from || pkt.from === this.deviceId) return;
      const remoteId = pkt.from;
      const peerObj = this.getOrCreatePeer(remoteId);

      // Якщо прямий WebRTC вже працює і має активні треки — ігноруємо резервні пакети
      if (peerObj.p2pConnected && peerObj.webrtcStream.getTracks().length > 0) return;

      // Прийом відеокадру через Quantum Relay
      if (pkt.t === 'V' && pkt.d) {
        const img = new Image();
        img.onload = () => {
          peerObj.relayCtx.drawImage(img, 0, 0, 220, 165);
          if (!peerObj.hasRelayFrames) {
            peerObj.hasRelayFrames = true;
            this.log(`Відеопотік від @${this.remoteDevices.get(remoteId)?.name || remoteId} отримано через Quantum Relay!`);
            this.notifyStateChanged();
          }
        };
        img.src = pkt.d;
      }

      // Прийом голосового пакета через Quantum Relay
      if (pkt.t === 'A' && pkt.d) {
        try {
          this.ensureAudioContext();
          const binary = atob(pkt.d);
          const len = binary.length;
          const sampleRate = pkt.sr || 11025;
          const audioBuf = this.audioContext.createBuffer(1, len, sampleRate);
          const channel = audioBuf.getChannelData(0);

          for (let i = 0; i < len; i++) {
            channel[i] = (binary.charCodeAt(i) / 127.5) - 1.0;
          }

          const source = this.audioContext.createBufferSource();
          source.buffer = audioBuf;
          source.connect(this.audioContext.destination);
          source.start();

          // Підсвічуємо рамку мовця
          const seatId = this.remoteDevices.get(remoteId)?.seat;
          if (seatId) {
            this._relaySpeakingSeat = seatId;
            this._relaySpeakingUntil = Date.now() + 350;
          }
        } catch (_) {}
      }
    }

    // =========================================================================
    // 6. АУДІО-УТИЛІТИ ТА МОНІТОРИНГ АКТИВНОСТІ
    // =========================================================================
    ensureAudioContext() {
      if (!this.audioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.audioContext = new AudioCtx();
      }
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
    }

    unlockAllAudio() {
      this.ensureAudioContext();
      document.querySelectorAll('.seat-media-frame video').forEach((v) => {
        if (!v.dataset.isLocal) {
          v.muted = false;
        }
        v.play().catch(() => {});
      });
      this.cb.onAudioBlocked?.(false);
    }

    setSpeakerOutput(deviceId) {
      this.selectedSpeakerId = deviceId || 'default';
      document.querySelectorAll('.seat-media-frame video').forEach((v) => {
        if (!v.dataset.isLocal && typeof v.setSinkId === 'function') {
          v.setSinkId(this.selectedSpeakerId).catch(() => {});
        }
      });
    }

    toggleMic() {
      if (!this.localStream) return false;
      const track = this.localStream.getAudioTracks()[0];
      if (!track) return false;
      track.enabled = !track.enabled;
      this.localState.hasAudio = track.enabled;
      this.publishPresence();
      this.notifyStateChanged();
      return track.enabled;
    }

    toggleCam() {
      if (!this.localStream) return false;
      const track = this.localStream.getVideoTracks()[0];
      if (!track) return false;
      track.enabled = !track.enabled;
      this.localState.hasVideo = track.enabled;
      this.publishPresence();
      this.notifyStateChanged();
      return track.enabled;
    }

    closePeer(remoteId) {
      const peerObj = this.peers.get(remoteId);
      if (peerObj) {
        try { peerObj.pc.close(); } catch (_) {}
        this.peers.delete(remoteId);
      }
      this.analysers.delete(remoteId);
    }

    attachVoiceAnalyser(id, stream) {
      if (!stream || stream.getAudioTracks().length === 0) return;
      try {
        this.ensureAudioContext();
        const src = this.audioContext.createMediaStreamSource(stream);
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 128;
        src.connect(analyser);
        this.analysers.set(id, {
          analyser,
          buf: new Uint8Array(analyser.frequencyBinCount)
        });
      } catch (_) {}
    }

    startBackgroundLoops() {
      const voiceTick = () => {
        const speakingSeatIds = new Set();
        this.analysers.forEach(({ analyser, buf }, devId) => {
          analyser.getByteFrequencyData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i];
          const avg = sum / buf.length;
          if (avg > 14) {
            const seatId = devId === this.deviceId
              ? this.localState.seat
              : this.remoteDevices.get(devId)?.seat;
            if (seatId) speakingSeatIds.add(seatId);
          }
        });

        if (this._relaySpeakingSeat && Date.now() < this._relaySpeakingUntil) {
          speakingSeatIds.add(this._relaySpeakingSeat);
        }

        this.cb.onVoiceActivity?.(speakingSeatIds);
        requestAnimationFrame(voiceTick);
      };
      requestAnimationFrame(voiceTick);

      // Heartbeat присутності кожні 3.5 секунди (БЕЗ розриву існуючих WebRTC з'єднань!)
      setInterval(() => {
        this.publishPresence();
        const now = Date.now();
        let changed = false;
        this.remoteDevices.forEach((dev, id) => {
          if (dev._lastSeen && now - dev._lastSeen > 20000) {
            this.remoteDevices.delete(id);
            this.closePeer(id);
            changed = true;
          }
        });
        if (changed) this.notifyStateChanged();
      }, 3500);
    }

    notifyStateChanged() {
      this.cb.onStateUpdate?.({
        localState: this.localState,
        localStream: this.localStream,
        remoteDevices: this.remoteDevices,
        peers: this.peers
      });
    }
  }

  window.AetherRTCEngine = AetherRTCEngine;
})(window);