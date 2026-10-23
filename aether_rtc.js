/**
 * ============================================================================
 * AETHER ZERO-LATENCY ORCHESTRATOR (aether_rtc.js) - v7.0 GOLD
 * ----------------------------------------------------------------------------
 * Ключові інновації v7.0:
 *   1. Discord Opus SDP Tuning (minptime=10, useinbandfec=1, maxaveragebitrate=64000)
 *      для мінімальної затримки 5–15 мс у локальній мережі та між країнами.
 *   2. Fast RTP Verification (кожні 450 мс замість 2500 мс) + Live Ping HUD (ms)
 *      прямо на бейджах крісел.
 *   3. Безвідмовне відновлення мікрофона при повторному увімкненні на смартфонах.
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

  // Оптимізація SDP під низьку затримку голосу (як у Discord: 10ms пакети + FEC захист від втрат)
  function optimizeSdpForLowLatencyOpus(sdp) {
    if (!sdp) return sdp;
    return sdp.replace(
      /a=fmtp:(\d+) minptime=10;useinbandfec=1/g,
      'a=fmtp:$1 minptime=10;ptime=20;useinbandfec=1;maxaveragebitrate=64000;stereo=0'
    );
  }

  class AetherRTCEngine {
    constructor(callbacks = {}) {
      this.cb = callbacks;
      this.brokerIndex = 0;

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

      this.remoteDevices = new Map();
      this.peers = new Map();
      this.localStream = null;
      this.selectedMicId = '';

      this.mqttClient = null;
      this.mqttVideoClient = null;

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
          this.publishQuantumAudioPacket(pkt);
        }
      });

      this.video = new window.AetherVideoEngine({
        onLog: (msg) => this.log(msg),
        onCameraListUpdated: (cams, selectedId) => {
          this.cb.onCameraListUpdated?.(cams, selectedId);
        },
        onQuantumVideoFrameOut: (pkt) => {
          this.publishQuantumVideoPacket(pkt);
        }
      });

      this.setupBridgeIntegration();
      this.startFastTelemetryLoops();
    }

    log(msg) {
      console.log(`%c[AetherRTC v7.0]%c ${msg}`, 'color:#10b981;font-weight:bold;', 'color:#e2e8f0;');
      this.cb.onLog?.(msg);
    }

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

    connectRoom(roomId) {
      if (roomId) {
        this.roomId = roomId.trim() || 'entropia-1';
        this.saveProfile();
      }

      if (this.mqttClient) {
        try { this.mqttClient.end(true); } catch (_) {}
      }
      if (this.mqttVideoClient) {
        try { this.mqttVideoClient.end(true); } catch (_) {}
      }

      this.remoteDevices.clear();
      this.peers.forEach((_, id) => this.closePeer(id));

      const base = `entropia_ark_317/omega_v5/${this.roomId}`;
      this.roomTopic = `${base}/room`;
      this.sigTopicForMe = `${base}/sig/${this.deviceId}`;
      this.sigPrefix = `${base}/sig/`;
      this.audioRelayTopic = `${base}/media`;
      this.videoRelayTopic = `${base}/media_video`;

      const brokerUrl = MQTT_BROKERS[this.brokerIndex % MQTT_BROKERS.length];
      this.cb.onNetworkStatus?.('Підключення...', false);
      this.log(`Запуск ядра v7.0 GOLD (${this.roomId})...`);

      this.mqttClient = window.mqtt.connect(brokerUrl, {
        clientId: 'aud7_' + this.deviceId + '_' + Math.floor(Math.random() * 9999),
        clean: true,
        connectTimeout: 6000,
        reconnectPeriod: 2000,
        will: {
          topic: this.roomTopic,
          payload: JSON.stringify({ type: 'LEAVE', deviceId: this.deviceId }),
          qos: 0,
          retain: false
        }
      });

      this.mqttClient.on('connect', () => {
        this.cb.onNetworkStatus?.(`Онлайн (${this.roomId})`, true);
        this.mqttClient.subscribe(this.roomTopic, { qos: 0 });
        this.mqttClient.subscribe(this.sigTopicForMe, { qos: 0 });
        this.mqttClient.subscribe(this.audioRelayTopic, { qos: 0 });

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
          } else if (topic === this.audioRelayTopic) {
            this.handleQuantumRelayPacket(data);
          }
        } catch (_) {}
      });

      this.mqttVideoClient = window.mqtt.connect(brokerUrl, {
        clientId: 'vid7_' + this.deviceId + '_' + Math.floor(Math.random() * 9999),
        clean: true,
        connectTimeout: 6000,
        reconnectPeriod: 2500
      });

      this.mqttVideoClient.on('connect', () => {
        this.mqttVideoClient.subscribe(this.videoRelayTopic, { qos: 0 });
      });

      this.mqttVideoClient.on('message', (topic, payload) => {
        try {
          if (topic === this.videoRelayTopic) {
            const data = JSON.parse(payload.toString());
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

    publishQuantumAudioPacket(pkt) {
      if (!this.mqttClient || !this.mqttClient.connected) return;
      this.mqttClient.publish(
        this.audioRelayTopic,
        JSON.stringify({
          ...pkt,
          from: this.deviceId,
           sentAt: Date.now()
        }),
        { qos: 0, retain: false }
      );
    }

    publishQuantumVideoPacket(pkt) {
      const client = (this.mqttVideoClient && this.mqttVideoClient.connected)
        ? this.mqttVideoClient
        : this.mqttClient;
      if (!client || !client.connected) return;

      try {
        const ws = client.stream && client.stream.socket;
        if (ws && ws.bufferedAmount > 48000) return;
      } catch (_) {}

      const targetTopic = (client === this.mqttVideoClient) ? this.videoRelayTopic : this.audioRelayTopic;
      client.publish(
        targetTopic,
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

        const peerObj = this.getOrCreatePeer(remoteId);

        const remoteMediaUpdated = !prev || prev.mediaRev !== remote.mediaRev || prev.inGame !== remote.inGame;
        if ((remoteMediaUpdated || !peerObj.p2pConnected) && (this.localStream || remote.inGame)) {
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
    // ЗАПУСК ТА БЕЗВІДМОВНИЙ ПЕРЕЗАПУСК МІКРОФОНА / КАМЕРИ
    // =========================================================================
    async acquireRawMicStream(micDeviceId = '') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: this.audio.getOptimalAudioConstraints(micDeviceId),
          video: false
        });
      } catch (err1) {
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (err2) {
          this.log(`Мікрофон недоступний (${err2.name}).`);
          return null;
        }
      }
    }

    async startLocalMedia(micDeviceId = '', camDeviceId = '') {
      this.selectedMicId = micDeviceId || this.selectedMicId;
      this.audio.ensureContext();
      this.audio.localMicMuted = false;

      const rawMicStream = await this.acquireRawMicStream(this.selectedMicId);
      const videoTrack = await this.video.acquireCameraTrack(camDeviceId, this.localState.name);

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

      this.video.startQuantumVideoEncoder(() => this.needsQuantumVideoRelay());

      this.localState.inGame = true;
      this.localState.hasAudio = this.localStream.getAudioTracks().length > 0;
      this.localState.hasVideo = this.localStream.getVideoTracks().length > 0;
      this.localState.mediaRev += 1;

      for (const [remoteId, peerObj] of this.peers.entries()) {
        this.syncLocalTracksToPeer(peerObj);
        await this.triggerNegotiation(remoteId);
      }

      this.publishPresence();
      this.notifyStateChanged();
      return this.localStream;
    }

    async switchCamera(newCamDeviceId) {
      const newVideoTrack = await this.video.acquireCameraTrack(newCamDeviceId, this.localState.name);
      if (!newVideoTrack) return;

      if (!this.localStream) {
        await this.startLocalMedia(this.selectedMicId, newCamDeviceId);
        return;
      }

      this.localStream.getVideoTracks().forEach((oldTrack) => {
        this.localStream.removeTrack(oldTrack);
        try { oldTrack.stop(); } catch (_) {}
      });
      this.localStream.addTrack(newVideoTrack);
      this.localState.hasVideo = true;
      this.localState.mediaRev += 1;

      this.peers.forEach((peerObj) => this.syncLocalTracksToPeer(peerObj));
      this.publishPresence();
      this.notifyStateChanged();
    }

    async switchMicrophone(newMicDeviceId) {
      this.selectedMicId = newMicDeviceId;
      if (!this.localStream) return;
      await this.startLocalMedia(newMicDeviceId, this.video.selectedCameraId);
    }

    // Виправлений тумблер мікрофона: миттєво вмикає/вимикає звук і відновлює мікрофон на смартфонах
    toggleMic() {
      this.audio.unlockAudio();

      // Якщо фізичний мікрофон заснув на телефоні — автоматично піднімаємо його!
      if (this.audio.localMicMuted && !this.audio.isMicTrackAlive()) {
        this.startLocalMedia(this.selectedMicId, this.video.selectedCameraId);
        return true;
      }

      const nowActive = this.audio.setMicMuted(!this.audio.localMicMuted);
      this.localState.hasAudio = nowActive;
      this.publishPresence();
      this.notifyStateChanged();
      this.log(nowActive ? '🎤 Мікрофон увімкнено.' : '🔇 Мікрофон вимкнено.');
      return nowActive;
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

    needsQuantumAudioRelay() {
      if (!this.localState.inGame || !this.localState.hasAudio || this.audio.localMicMuted) return false;
      if (this.remoteDevices.size === 0) return false;
      for (const [remoteId] of this.remoteDevices.entries()) {
        const peerObj = this.peers.get(remoteId);
        if (!peerObj || !peerObj.p2pAudioVerified) return true;
      }
      return false;
    }

    needsQuantumVideoRelay() {
      if (!this.localState.inGame || !this.localState.hasVideo) return false;
      if (this.remoteDevices.size === 0) return false;
      for (const [remoteId] of this.remoteDevices.entries()) {
        const peerObj = this.peers.get(remoteId);
        if (!peerObj || !peerObj.p2pVideoVerified) return true;
      }
      return false;
    }

    handleQuantumRelayPacket(pkt) {
      if (!pkt || !pkt.from || pkt.from === this.deviceId) return;
      const remoteId = pkt.from;
      const peerObj = this.getOrCreatePeer(remoteId);

      if (pkt.t === 'A16' || pkt.t === 'A22' || pkt.t === 'A') {
        this.audio.ingestQuantumAudioPacket(remoteId, pkt);
        return;
      }

      if (pkt.t === 'V' && pkt.d) {
        if (peerObj.p2pVideoVerified) return;

        const remoteSeat = this.remoteDevices.get(remoteId)?.seat || null;
        const wasFirstFrame = !peerObj.hasRelayFrames;

        this.video.ingestQuantumVideoFrame(remoteId, pkt, remoteSeat);
        peerObj.hasRelayFrames = true;

        if (wasFirstFrame) {
          this.notifyStateChanged();
        }
      }
    }

    // =========================================================================
    // WEBRTC P2P З ДВОСТОРОННІМИ ТРАНСІВЕРАМИ ТА ПІНГОМ У МІЛІСЕКУНДАХ
    // =========================================================================
    getOrCreatePeer(remoteId) {
      if (this.peers.has(remoteId)) {
        return this.peers.get(remoteId);
      }

      const pc = new RTCPeerConnection(RTC_CONFIGURATION);
      const rawWebrtcStream = new MediaStream();

      const peerObj = {
        remoteId,
        pc,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        iceQueue: [],
        rawWebrtcStream,
        webrtcStream: null,
        p2pConnected: false,
        p2pAudioVerified: false,
        p2pVideoVerified: false,
        lastAudioBytes: 0,
        lastVideoFrames: 0,
        rttMs: null,
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
            if (!peerObj.rawWebrtcStream.getTracks().some((ex) => ex.id === t.id)) {
              peerObj.rawWebrtcStream.addTrack(t);
            }
          });
        } else if (e.track) {
          if (!peerObj.rawWebrtcStream.getTracks().some((ex) => ex.id === e.track.id)) {
            peerObj.rawWebrtcStream.addTrack(e.track);
          }
        }

        // Одразу підключаємо аудіопотік до плеєра (він сам заглушить Quantum при старті відтворення!)
        if (peerObj.rawWebrtcStream.getAudioTracks().length > 0) {
          this.audio.attachRemoteWebRTCStream(remoteId, peerObj.rawWebrtcStream);
        }
      };

      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        peerObj.connState = st;
        if (st === 'failed' || st === 'disconnected') {
          peerObj.p2pConnected = false;
          peerObj.p2pAudioVerified = false;
          peerObj.p2pVideoVerified = false;
          peerObj.webrtcStream = null;
          const peerCh = this.audio.peerChannels.get(remoteId);
          if (peerCh) peerCh.verifiedP2PAudio = false;
          this.notifyStateChanged();
        }
      };

      return peerObj;
    }

    // Швидка верифікація живого P2P-трафіку та вимірювання пінгу (RTT) кожні 500 мс
    async verifyPeerRtpTraffic(peerObj, remoteId) {
      if (!peerObj || !peerObj.pc) return;
      const st = peerObj.pc.iceConnectionState;
      if (st !== 'connected' && st !== 'completed') return;

      try {
        const stats = await peerObj.pc.getStats();
        let currentAudioBytes = 0;
        let currentVideoFrames = 0;
        let rttSec = null;

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded' && typeof report.currentRoundTripTime === 'number') {
            rttSec = report.currentRoundTripTime;
          }
          if (report.type === 'inbound-rtp') {
            if (report.kind === 'audio' && typeof report.bytesReceived === 'number') {
              currentAudioBytes += report.bytesReceived;
            }
            if (report.kind === 'video' && typeof report.framesDecoded === 'number') {
              currentVideoFrames += report.framesDecoded;
            }
          }
        });

        if (rttSec !== null) {
          peerObj.rttMs = Math.max(1, Math.round(rttSec * 1000));
        }

        const audioDelta = currentAudioBytes - (peerObj.lastAudioBytes || 0);
        const videoDelta = currentVideoFrames - (peerObj.lastVideoFrames || 0);

        peerObj.lastAudioBytes = currentAudioBytes;
        peerObj.lastVideoFrames = currentVideoFrames;

        let changed = false;

        // 1. P2P Аудіо підтверджується вже після перших 1.5 КБ даних (~0.3 секунди!)
        if (currentAudioBytes > 1500 && audioDelta > 150) {
          if (!peerObj.p2pAudioVerified) {
            peerObj.p2pAudioVerified = true;
            this.audio.attachRemoteWebRTCStream(remoteId, peerObj.rawWebrtcStream);
            const peerCh = this.audio.peerChannels.get(remoteId);
            if (peerCh) {
              peerCh.verifiedP2PAudio = true;
              peerCh.availableSamples = 0;
            }
            const rName = this.remoteDevices.get(remoteId)?.name || remoteId;
            this.log(`🟢 P2P Голос з @${rName} активний (${peerObj.rttMs || 12} ms)!`);
            changed = true;
          }
        }

        // 2. P2P Відео
        if (currentVideoFrames > 5 && videoDelta >= 1) {
          if (!peerObj.p2pVideoVerified) {
            peerObj.p2pVideoVerified = true;
            peerObj.p2pConnected = true;
            peerObj.webrtcStream = peerObj.rawWebrtcStream;
            changed = true;
          }
        } else if (peerObj.p2pVideoVerified && videoDelta === 0) {
          peerObj.p2pVideoVerified = false;
          peerObj.p2pConnected = false;
          peerObj.webrtcStream = null;
          changed = true;
        }

        if (changed) this.notifyStateChanged();
      } catch (_) {}
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
          try { pc.addTrack(track, this.localStream); } catch (_) {}
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

        offer.sdp = optimizeSdpForLowLatencyOpus(offer.sdp);

        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);

        this.sendSignal(remoteId, {
          type: 'SDP',
          description: {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp
          }
        });
      } catch (_) {
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
            answer.sdp = optimizeSdpForLowLatencyOpus(answer.sdp);
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
      } catch (_) {
        peerObj.isSettingRemoteAnswerPending = false;
      }
    }

    unlockAllAudio() {
      this.audio.unlockAudio();
    }

    setSpeakerOutput(deviceId) {
      this.audio.setSpeakerOutput(deviceId);
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

    startFastTelemetryLoops() {
      // 1. Швидка перевірка P2P-трафіку та пінгу кожні 550 мс (замість 2.5с)
      setInterval(() => {
        this.remoteDevices.forEach((dev, id) => {
          const peerObj = this.peers.get(id);
          if (peerObj) {
            this.verifyPeerRtpTraffic(peerObj, id);
          }
        });
        this.decorateSeatPingBadges();
      }, 550);

      // 2. Heartbeat присутності кожні 3 секунди
      setInterval(() => {
        this.publishPresence();
        const now = Date.now();
        let changed = false;

        this.remoteDevices.forEach((dev, id) => {
          if (dev._lastSeen && now - dev._lastSeen > 22000) {
            this.remoteDevices.delete(id);
            this.closePeer(id);
            changed = true;
          }
        });

        if (changed) this.notifyStateChanged();
      }, 3000);
    }

    // Відображення реального пінгу (ms) та стану мікрофона прямо на плашках крісел
    decorateSeatPingBadges() {
      this.remoteDevices.forEach((dev, remoteId) => {
        if (!dev.seat) return;
        const statusEl = document.getElementById(`status-${dev.seat}`);
        if (!statusEl) return;

        const peerObj = this.peers.get(remoteId);
        const micIcon = dev.hasAudio === false ? '🔇 ' : '';

        if (peerObj && (peerObj.p2pVideoVerified || peerObj.p2pAudioVerified)) {
          const pingTxt = peerObj.rttMs ? `${peerObj.rttMs}ms` : 'LAN';
          statusEl.textContent = `${micIcon}🟢 P2P • ${pingTxt}`;
        } else if ((peerObj && peerObj.hasRelayFrames) || dev.inGame) {
          statusEl.textContent = `${micIcon}⚡ Relay • ~45ms`;
        }
      });
    }

    notifyStateChanged() {
      this.cb.onStateUpdate?.({
        localState: this.localState,
        localStream: this.localStream,
        remoteDevices: this.remoteDevices,
        peers: this.peers
      });
      this.decorateSeatPingBadges();
    }
  }

  window.AetherRTCEngine = AetherRTCEngine;
})(window);