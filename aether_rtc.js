/**
 * ============================================================================
 * AETHER NETWORK ORCHESTRATOR (aether_rtc.js) - v6.0 OMEGA GOLD
 * ----------------------------------------------------------------------------
 * Центральний мережевий контролер, що об'єднує:
 *   - AetherAudioEngine (aether_audio.js) — Studio DSP + µ-Law 16kHz + Jitter Buffer
 *   - AetherVideoEngine (aether_video.js) — Smart Physical Cam + WebP + 60fps Blend
 *   - WebRTC Perfect Negotiation (RFC 8829) + Multi-Broker MQTT Quantum Relay
 * ============================================================================
 */

(function (window) {
  'use strict';

  const PROFILE_STORAGE_KEY = 'entropia_aether_profile_v6';
  const SESSION_DEVICE_KEY = 'entropia_aether_tab_id_v6';

  const MQTT_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];

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

      // 1. Ідентифікатор вкладки та збережений профіль (GM / Гравець окремо)
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
        mediaRev: 0
      };

      this.remoteDevices = new Map(); // remoteId -> state
      this.peers = new Map();         // remoteId -> PeerSession
      this.localStream = null;
      this.selectedMicId = '';

      // 2. Ініціалізуємо виділений Студійний Аудіо-Рушій (aether_audio.js)
      this.audio = new window.AetherAudioEngine({
        onLog: (msg) => this.log(msg),
        onAudioBlocked: (blocked) => this.cb.onAudioBlocked?.(blocked),
        onVoiceActivity: (activePeerIds) => {
          const speakingSeats = new Set();
          activePeerIds.forEach((peerId) => {
            const seat = peerId === this.deviceId
              ? this.localState.seat
              : this.remoteDevices.get(peerId)?.seat;
            if (seat) speakingSeats.add(seat);
          });
          this.cb.onVoiceActivity?.(speakingSeats);
        },
        onQuantumAudioPacketOut: (pkt) => {
          this.publishQuantumMediaPacket(pkt);
        }
      });

      // 3. Ініціалізуємо виділений Відео-Рушій (aether_video.js)
      this.video = new window.AetherVideoEngine({
        onLog: (msg) => this.log(msg),
        onCameraListUpdated: (cams, selectedId) => {
          this.cb.onCameraListUpdated?.(cams, selectedId);
        },
        onQuantumVideoFrameOut: (pkt) => {
          this.publishQuantumMediaPacket(pkt);
        }
      });

      this.setupBridgeIntegration();
      this.startHeartbeatLoop();
    }

    log(msg) {
      console.log(`%c[AetherRTC v6.0]%c ${msg}`, 'color:#10b981;font-weight:bold;', 'color:#e2e8f0;');
      this.cb.onLog?.(msg);
    }

    // =========================================================================
    // 1. ПРОФІЛЬ ТА ЗАХИСТ МІСЦЯ МАЙСТРА (GM)
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
        // Якщо ми Майстер — ніколи не беремо ім'я з відкритого листа гравця
        if (this.localState.role === 'gm') return;

        if (char && (char.name || char.callsign)) {
          this.localState.name = char.name || char.callsign;
          this.video.localCallsign = this.localState.name;
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

      this.video.localCallsign = this.localState.name;
      this.saveProfile();
      this.publishPresence();
      this.notifyStateChanged();
      return true;
    }

    setName(newName) {
      this.localState.name = (newName || '').trim() || (this.localState.role === 'gm' ? 'Архітект (GM)' : 'Оперативник');
      this.video.localCallsign = this.localState.name;
      this.saveProfile();
      this.publishPresence();
      this.notifyStateChanged();
    }

    // =========================================================================
    // 2. MQTT ТРАНСПОРТ ТА СИНХРОНІЗАЦІЯ КІМНАТИ
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

      // Спільний топік v5/v6 для сумісності між усіма пристроями
      const base = `entropia_ark_317/omega_v5/${this.roomId}`;
      this.roomTopic = `${base}/room`;
      this.sigTopicForMe = `${base}/sig/${this.deviceId}`;
      this.sigPrefix = `${base}/sig/`;
      this.mediaRelayTopic = `${base}/media`;

      const brokerUrl = MQTT_BROKERS[this.brokerIndex % MQTT_BROKERS.length];
      this.cb.onNetworkStatus?.('Підключення...', false);
      this.log(`Підключення до брокера ${brokerUrl} (Стіл: ${this.roomId})...`);

      this.mqttClient = window.mqtt.connect(brokerUrl, {
        clientId: 'omega6_' + this.deviceId + '_' + Math.floor(Math.random() * 9999),
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
        this.log(`Синхронізацію встановлено (${this.deviceId}).`);

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

    publishQuantumMediaPacket(pkt) {
      if (!this.mqttClient || !this.mqttClient.connected) return;
      this.mqttClient.publish(
        this.mediaRelayTopic,
        JSON.stringify({
          ...pkt,
          from: this.deviceId
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

        if (this.localState.role !== 'gm' && remote.seat === this.localState.seat && remoteId < this.deviceId) {
          this.resolveSeatConflict();
        }

        this.getOrCreatePeer(remoteId);

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
    // 3. ЗАПУСК ТА ГАРЯЧА ЗАМІНА МІКРОФОНА І КАМЕРИ (ЧЕРЕЗ AUDIO & VIDEO ENGINES)
    // =========================================================================
    async startLocalMedia(micDeviceId = '', camDeviceId = '') {
      this.selectedMicId = micDeviceId || this.selectedMicId;
      this.audio.ensureContext();

      // 1. Захоплюємо сирий мікрофонний потік для нашого студійного преампа
      let rawMicStream = null;
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const audioConstraints = this.audio.getOptimalAudioConstraints(this.selectedMicId);
          rawMicStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false
          });
        } catch (err1) {
          try {
            rawMicStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          } catch (err2) {
            this.log(`Мікрофон недоступний (${err2.name}) — працюємо без мікрофона.`);
          }
        }
      }

      // 2. Захоплюємо фізичну вебкамеру (або тактичну голограму) через AetherVideoEngine
      const videoTrack = await this.video.acquireCameraTrack(camDeviceId, this.localState.name);

      // 3. Збираємо комбінований сирий потік та пропускаємо звук через Studio DSP Pipeline
      const combinedRaw = new MediaStream();
      if (rawMicStream) {
        rawMicStream.getAudioTracks().forEach((t) => combinedRaw.addTrack(t));
      }
      if (videoTrack) {
        combinedRaw.addTrack(videoTrack);
      }

      this.localStream = await this.audio.buildStudioMicPipeline(
        combinedRaw,
        this.deviceId,
        () => this.needsQuantumAudioRelay()
      );

      // 4. Запускаємо кодувальник Quantum Video (WebP + Smart Luma Delta)
      this.video.startQuantumVideoEncoder(() => this.needsQuantumVideoRelay());

      this.localState.inGame = true;
      this.localState.hasAudio = this.localStream.getAudioTracks().length > 0;
      this.localState.hasVideo = this.localStream.getVideoTracks().length > 0;
      this.localState.mediaRev += 1;

      // 5. Оновлюємо треки у всіх активних PeerConnections
      for (const [remoteId, peerObj] of this.peers.entries()) {
        this.syncLocalTracksToPeer(peerObj);
        await this.triggerNegotiation(remoteId);
      }

      this.publishPresence();
      this.notifyStateChanged();
      return this.localStream;
    }

    // Гаряче перемикання вебкамери на льоту без переривання звуку
    async switchCamera(newCamDeviceId) {
      const newVideoTrack = await this.video.acquireCameraTrack(newCamDeviceId, this.localState.name);
      if (!newVideoTrack) return;

      if (!this.localStream) {
        await this.startLocalMedia(this.selectedMicId, newCamDeviceId);
        return;
      }

      // Замінюємо відеотрек у локальному потоці
      this.localStream.getVideoTracks().forEach((oldTrack) => {
        this.localStream.removeTrack(oldTrack);
        try { oldTrack.stop(); } catch (_) {}
      });
      this.localStream.addTrack(newVideoTrack);
      this.localState.hasVideo = true;
      this.localState.mediaRev += 1;

      // Миттєво підміняємо трек у всіх WebRTC-з'єднаннях
      this.peers.forEach((peerObj) => {
        this.syncLocalTracksToPeer(peerObj);
      });

      this.publishPresence();
      this.notifyStateChanged();
    }

    // Гаряче перемикання мікрофона на льоту без переривання камери
    async switchMicrophone(newMicDeviceId) {
      this.selectedMicId = newMicDeviceId;
      if (!this.localStream) return;
      await this.startLocalMedia(newMicDeviceId, this.video.selectedCameraId);
    }

    needsQuantumAudioRelay() {
      if (!this.localState.inGame || !this.localState.hasAudio) return false;
      for (const [remoteId] of this.remoteDevices.entries()) {
        const peerObj = this.peers.get(remoteId);
        const hasP2PAudio = peerObj && peerObj.p2pConnected && peerObj.webrtcStream.getAudioTracks().length > 0;
        if (!hasP2PAudio) return true;
      }
      return false;
    }

    needsQuantumVideoRelay() {
      if (!this.localState.inGame || !this.localState.hasVideo) return false;
      for (const [remoteId] of this.remoteDevices.entries()) {
        const peerObj = this.peers.get(remoteId);
        const hasP2PVideo = peerObj && peerObj.p2pConnected && peerObj.webrtcStream.getVideoTracks().length > 0;
        if (!hasP2PVideo) return true;
      }
      return false;
    }

    handleQuantumRelayPacket(pkt) {
      if (!pkt || !pkt.from || pkt.from === this.deviceId) return;
      const remoteId = pkt.from;
      const peerObj = this.getOrCreatePeer(remoteId);

      // Голосовий пакет (16 kHz µ-Law або резервний PCM)
      if (pkt.t === 'A16' || pkt.t === 'A') {
        this.audio.ingestQuantumAudioPacket(remoteId, pkt);
        return;
      }

      // Відеокадр (WebP / JPEG)
      if (pkt.t === 'V' && pkt.d) {
        if (peerObj.p2pConnected && peerObj.webrtcStream.getVideoTracks().length > 0) return;
        const remoteSeat = this.remoteDevices.get(remoteId)?.seat || null;
        const wasFirstFrame = !peerObj.hasRelayFrames;

        this.video.ingestQuantumVideoFrame(remoteId, pkt, remoteSeat);
        peerObj.hasRelayFrames = true;

        if (wasFirstFrame) {
          this.log(`Quantum Video від @${this.remoteDevices.get(remoteId)?.name || remoteId} активне.`);
          this.notifyStateChanged();
        }
      }
    }

    // =========================================================================
    // 4. WEBRTC PERFECT NEGOTIATION
    // =========================================================================
    getOrCreatePeer(remoteId) {
      if (this.peers.has(remoteId)) {
        return this.peers.get(remoteId);
      }

      const pc = new RTCPeerConnection(RTC_CONFIGURATION);
      const webrtcStream = new MediaStream();

      const peerObj = {
        remoteId,
        pc,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        iceQueue: [],
        webrtcStream,
        p2pConnected: false,
        hasRelayFrames: false,
        connState: 'connecting'
      };

      this.peers.set(remoteId, peerObj);
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

        peerObj.p2pConnected = true;
        peerObj.connState = 'connected';

        // Передаємо аудіопотік у студійний AetherAudioEngine
        if (peerObj.webrtcStream.getAudioTracks().length > 0) {
          this.audio.attachRemoteWebRTCStream(remoteId, peerObj.webrtcStream);
        }

        const rName = this.remoteDevices.get(remoteId)?.name || remoteId;
        this.log(`Прямий P2P потік (${e.track.kind}) від @${rName} підключено!`);
        this.notifyStateChanged();
      };

      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        peerObj.connState = st;
        const rName = this.remoteDevices.get(remoteId)?.name || remoteId;

        if (st === 'connected' || st === 'completed') {
          peerObj.p2pConnected = true;
          this.log(`P2P маршрут із @${rName} активний.`);
        } else if (st === 'failed' || st === 'disconnected') {
          peerObj.p2pConnected = false;
          const peerCh = this.audio.peerChannels.get(remoteId);
          if (peerCh) peerCh.hasActiveWebRTCAudio = false;

          this.log(`NAT закрив UDP з @${rName} — працює Quantum Relay.`);
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
        console.warn('[AetherRTC] Offer Error:', err);
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

      const polite = this.deviceId < remoteId;

      try {
        if (msg.type === 'SDP' && msg.description) {
          const desc = msg.description;
          const readyForOffer =
            !peerObj.makingOffer &&
            (pc.signalingState === 'stable' || peerObj.isSettingRemoteAnswerPending);
          const offerCollision = desc.type === 'offer' && !readyForOffer;

          peerObj.ignoreOffer = !polite && offerCollision;
          if (peerObj.ignoreOffer) return;

          peerObj.isSettingRemoteAnswerPending = desc.type === 'answer';
          if (offerCollision) {
            await pc.setLocalDescription({ type: 'rollback' });
          }

          this.syncLocalTracksToPeer(peerObj);
          await pc.setRemoteDescription(new RTCSessionDescription(desc));
          peerObj.isSettingRemoteAnswerPending = false;

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
            try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (_) {}
          } else {
            peerObj.iceQueue.push(msg.candidate);
          }
        }
      } catch (err) {
        peerObj.isSettingRemoteAnswerPending = false;
      }
    }

    // =========================================================================
    // 5. КЕРУВАННЯ СТАНОМ МІКРОФОНА / КАМЕРИ / ДИНАМІКІВ
    // =========================================================================
    unlockAllAudio() {
      this.audio.unlockAudio();
    }

    setSpeakerOutput(deviceId) {
      this.audio.setSpeakerOutput(deviceId);
    }

    toggleMic() {
      if (!this.localStream) return false;
      const track = this.localStream.getAudioTracks()[0];
      if (!track) return false;
      track.enabled = !track.enabled;
      this.audio.localMicMuted = !track.enabled;
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
      this.video.cameraEnabled = track.enabled;
      this.localState.hasVideo = track.enabled;
      this.publishPresence();
      this.notifyStateChanged();
      return track.enabled;
    }

    setEcoMode(enabled) {
      this.video.setEcoMode(enabled);
    }

    closePeer(remoteId) {
      const peerObj = this.peers.get(remoteId);
      if (peerObj) {
        try { peerObj.pc.close(); } catch (_) {}
        this.peers.delete(remoteId);
      }
      this.audio.removePeer(remoteId);
      this.video.removePeer(remoteId);
    }

    startHeartbeatLoop() {
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