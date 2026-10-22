/**
 * ============================================================================
 * AETHER NETWORK & WEBRTC ENGINE (aether_rtc.js) - v4.0
 * Повноцінний Trickle ICE з буферизацією кандидатів, захистом від розсинхрону
 * годинників між пристроями та автоматичним резервним відеопотоком
 * ============================================================================
 */

(function (window) {
  'use strict';

  const PROFILE_STORAGE_KEY = 'entropia_aether_profile_v4';
  const SESSION_DEVICE_KEY = 'entropia_aether_tab_device_id_v4';

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];

  class AetherRTCEngine {
    constructor(callbacks = {}) {
      this.cb = callbacks;

      // Унікальний ID для кожної вкладки/пристрою (sessionStorage),
      // але збереження Ролі, Імені та Крісла між сесіями (localStorage)
      this.deviceId = sessionStorage.getItem(SESSION_DEVICE_KEY);
      if (!this.deviceId) {
        this.deviceId = 'peer_' + Math.random().toString(36).substring(2, 10);
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
        mediaEpoch: 0
      };

      this.remoteDevices = new Map(); // remoteId -> { ...state, _receivedAt }
      this.peers = new Map();         // remoteId -> { pc, sessionId, remoteStream, audioEl, remoteDescSet, iceQueue, connState }
      this.earlyIceQueues = new Map();// remoteId -> candidate[] (кандидати, що прийшли до OFFER)

      this.localStream = null;
      this.selectedSpeakerId = 'default';
      this.audioContext = null;
      this.analysers = new Map();

      this.setupBridgeIntegration();
      this.startLoops();
    }

    log(msg) {
      console.log(`[AetherRTC] ${msg}`);
      this.cb.onLog?.(msg);
    }

    // --- 1. ПРОФІЛЬ КОРИСТУВАЧА (РОЗДІЛЕННЯ МАЙСТРА І ГРАВЦЯ) ---
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
      const savedRole = sessionStorage.getItem('entropia_user_role') || localStorage.getItem('entropia_user_role');
      return savedRole === 'gm' ? 'gm' : 'player';
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
      const handleSheetUpdate = (char, roleFromSheet) => {
        if (roleFromSheet === 'gm' && this.localState.role !== 'gm') {
          this.setRole('gm', true);
          return;
        }
        // Якщо ми Майстер (GM) — ніколи не перезаписуємо своє ім'я відкритим листом гравця
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
          handleSheetUpdate(e.data.character, e.data.role);
        }
      });

      if (window.EntropiaBridge && typeof window.EntropiaBridge.on === 'function') {
        window.EntropiaBridge.on('characterUpdate', (char) => handleSheetUpdate(char));
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

    // --- 2. MQTT СИГНАЛІНГ ТА СИНХРОНІЗАЦІЯ КІМНАТИ ---
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
      this.earlyIceQueues.clear();

      const base = `entropia_ark_317/aether_v4/${this.roomId}`;
      this.roomTopic = `${base}/room`;
      this.directTopicForMe = `${base}/peer/${this.deviceId}`;
      this.directPrefix = `${base}/peer/`;

      this.cb.onNetworkStatus?.('Підключення...', false);
      this.log(`Підключення до кімнати "${this.roomId}"...`);

      this.mqttClient = window.mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
        clientId: 'aether4_' + this.deviceId + '_' + Math.floor(Math.random() * 9999),
        clean: true,
        reconnectPeriod: 2500,
        will: {
          topic: this.roomTopic,
          payload: JSON.stringify({ type: 'LEAVE', deviceId: this.deviceId }),
          qos: 0,
          retain: false
        }
      });

      this.mqttClient.on('connect', () => {
        this.cb.onNetworkStatus?.(`Онлайн (${this.roomId})`, true);
        this.log(`MQTT підключено (ID: ${this.deviceId}).`);

        this.mqttClient.subscribe(this.roomTopic, { qos: 0 });
        this.mqttClient.subscribe(this.directTopicForMe, { qos: 0 });

        // Одразу питаємо всіх живих учасників у кімнаті та анонсуємо себе
        this.publishRoomEvent({ type: 'DISCOVER', from: this.deviceId });
        this.publishPresence();
      });

      this.mqttClient.on('message', (topic, payload) => {
        try {
          const data = JSON.parse(payload.toString());
          if (topic === this.roomTopic) {
            this.handleRoomBroadcast(data);
          } else if (topic === this.directTopicForMe) {
            this.handleDirectSignal(data);
          }
        } catch (err) {
          console.warn('[AetherRTC] Помилка JSON:', err);
        }
      });

      this.mqttClient.on('offline', () => {
        this.cb.onNetworkStatus?.('Офлайн (Перепідключення...)', false);
      });
    }

    publishRoomEvent(packet) {
      if (!this.mqttClient || !this.mqttClient.connected) return;
      this.mqttClient.publish(this.roomTopic, JSON.stringify(packet), { qos: 0, retain: false });
    }

    publishPresence() {
      this.publishRoomEvent({
        type: 'PRESENCE',
        state: this.localState
      });
    }

    publishSeatCount(count) {
      this.playerSeatCount = count;
      this.saveProfile();
      this.publishRoomEvent({
        type: 'SEAT_COUNT',
        playerSeatCount: count,
        from: this.deviceId
      });
    }

    sendChat(text) {
      this.publishRoomEvent({
        type: 'CHAT',
        deviceId: this.deviceId,
        author: this.localState.name,
        text
      });
    }

    sendDirectSignal(targetId, packet) {
      if (!this.mqttClient || !this.mqttClient.connected) return;
      this.mqttClient.publish(
        this.directPrefix + targetId,
        JSON.stringify({
          ...packet,
          from: this.deviceId,
          to: targetId
        }),
        { qos: 0, retain: false }
      );
    }

    handleRoomBroadcast(msg) {
      if (!msg) return;

      if (msg.type === 'DISCOVER' && msg.from !== this.deviceId) {
        // Новий пристрій зайшов у кімнату — миттєво відповідаємо своїм станом
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

        // Зберігаємо час отримання за ЛОКАЛЬНИМ годинником (усуває баг різних годинників)
        remote._receivedAt = Date.now();
        this.remoteDevices.set(remoteId, remote);

        // Якщо ми гравець і крісло зайняте кимось зі старшим ID — пересаджуємося на вільне
        if (this.localState.role !== 'gm' && remote.seat === this.localState.seat && remoteId < this.deviceId) {
          this.resolveSeatConflict();
        }

        this.notifyStateChanged();

        // Перевіряємо, чи потрібно ініціювати WebRTC-дзвінок:
        // 1) Якщо у нас увімкнений етер (localStream), а з цим гравцем ще немає активного з'єднання
        // 2) Або якщо інший гравець щойно оновив свій медіапотік (mediaEpoch змінився)
        const peerObj = this.peers.get(remoteId);
        const isConnected = peerObj && (peerObj.connState === 'connected' || peerObj.connState === 'checking');
        const remoteEpochChanged = prev && prev.mediaEpoch !== remote.mediaEpoch;

        if (this.localStream && !isConnected) {
          // Щоб обидва одночасно не слали OFFER, ініціює той, хто щойно увімкнув камеру, або старший ID
          if (!remote.inGame || this.deviceId > remoteId) {
            this.startOfferToPeer(remoteId);
          }
        } else if (!this.localStream && remote.inGame && !isConnected && remoteEpochChanged) {
          // Якщо у нас камера вимкнена, а інший гравець в етері — просимо його надіслати нам OFFER
          this.sendDirectSignal(remoteId, { type: 'REQUEST_OFFER' });
        }
      }
    }

    resolveSeatConflict() {
      const taken = new Set();
      this.remoteDevices.forEach((d) => {
        if (d.seat) taken.add(d.seat);
      });
      if (!taken.has(this.localState.seat)) return;

      for (let i = 1; i <= this.playerSeatCount; i++) {
        const candidate = `seat${i}`;
        if (!taken.has(candidate)) {
          this.localState.seat = candidate;
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
        if (!confirm('Перейти з крісла Майстра (GM) на крісло Гравця?')) return false;
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

    // --- 3. ЗАХОПЛЕННЯ КАМЕРИ / МІКРОФОНА + СИНТЕТИЧНИЙ РЕЗЕРВ ---
    createSyntheticVideoTrack() {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      let tick = 0;

      this._synthInterval = setInterval(() => {
        tick += 0.08;
        ctx.fillStyle = '#0c1412';
        ctx.fillRect(0, 0, 320, 240);

        ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(160, 110, 42 + Math.sin(tick) * 6, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#6ee7b7';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.localState.name || 'ЕТЕР', 160, 115);
        ctx.font = '11px monospace';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('АУДІОКАНАЛ АКТИВНИЙ', 160, 205);
      }, 100);

      const stream = canvas.captureStream(12);
      return stream.getVideoTracks()[0];
    }

    async startLocalMedia(micDeviceId = '', camDeviceId = '') {
      if (this._synthInterval) {
        clearInterval(this._synthInterval);
        this._synthInterval = null;
      }

      const videoConstraints = {
        width: { ideal: 320, max: 480 },
        height: { ideal: 240, max: 360 },
        frameRate: { ideal: 15, max: 20 }
      };
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      };

      if (micDeviceId) audioConstraints.deviceId = { exact: micDeviceId };
      if (camDeviceId) videoConstraints.deviceId = { exact: camDeviceId };

      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
        this.localStream = null;
      }

      let gotVideo = false;
      let gotAudio = false;

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: audioConstraints
          });
          gotVideo = this.localStream.getVideoTracks().length > 0;
          gotAudio = this.localStream.getAudioTracks().length > 0;
          this.log(`Камера та мікрофон увімкнені.`);
        } catch (err) {
          this.log(`Камера недоступна (${err.name}), вмикаємо мікрофон...`);
          try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
              video: false,
              audio: audioConstraints
            });
            gotAudio = this.localStream.getAudioTracks().length > 0;
            // Додаємо синтетичний відеотрек, щоб вікно бодікамери відкрилося у всіх гравців
            const synthTrack = this.createSyntheticVideoTrack();
            if (synthTrack) {
              this.localStream.addTrack(synthTrack);
              gotVideo = true;
            }
            this.log(`Мікрофон активний (+ тактичний відеоекран).`);
          } catch (audErr) {
            this.log(`Мікрофон також недоступний (${audErr.name}). Запускаємо тестовий потік.`);
          }
        }
      } else {
        this.log(`Браузер блокує камеру без HTTPS! Запускаємо тестовий відеопотік.`);
      }

      // Якщо фізичні камера й мікрофон заблоковані (наприклад, друга вкладка на тому ж ПК),
      // створюємо синтетичний потік, щоб WebRTC все одно передавав картинку!
      if (!this.localStream) {
        this.localStream = new MediaStream();
        const synthTrack = this.createSyntheticVideoTrack();
        if (synthTrack) {
          this.localStream.addTrack(synthTrack);
          gotVideo = true;
        }
      }

      this.localState.inGame = true;
      this.localState.hasVideo = gotVideo;
      this.localState.hasAudio = gotAudio;
      this.localState.mediaEpoch += 1;

      if (gotAudio) {
        this.attachVoiceAnalyser(this.deviceId, this.localStream);
      }

      this.publishPresence();
      this.notifyStateChanged();

      // Відправляємо свіжий OFFER кожному пристрою в кімнаті
      for (const [remoteId] of this.remoteDevices.entries()) {
        await this.startOfferToPeer(remoteId);
      }

      return this.localStream;
    }

    // --- 4. WEBRTC TRICKLE ICE З ЧЕРГОЮ КАНДИДАТІВ ---
    createPeerSession(remoteId, sessionId) {
      const old = this.peers.get(remoteId);
      if (old && old.pc) {
        try {
          old.pc.onicecandidate = null;
          old.pc.ontrack = null;
          old.pc.oniceconnectionstatechange = null;
          old.pc.close();
        } catch (_) {}
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const remoteStream = new MediaStream();

      const peerObj = {
        pc,
        sessionId,
        remoteStream,
        remoteDescSet: false,
        sdpSent: false,
        outgoingIceBuffer: [],
        iceQueue: this.earlyIceQueues.get(remoteId) || [],
        connState: 'connecting'
      };
      this.earlyIceQueues.delete(remoteId);
      this.peers.set(remoteId, peerObj);

      // Додаємо локальні треки (або recvonly трансивери, якщо ми тільки дивимося)
      const hasLocalAudio = this.localStream && this.localStream.getAudioTracks().length > 0;
      const hasLocalVideo = this.localStream && this.localStream.getVideoTracks().length > 0;

      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          pc.addTrack(track, this.localStream);
        });
      }
      if (!hasLocalAudio) {
        try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch (_) {}
      }
      if (!hasLocalVideo) {
        try { pc.addTransceiver('video', { direction: 'recvonly' }); } catch (_) {}
      }

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const candData = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
        if (peerObj.sdpSent) {
          this.sendDirectSignal(remoteId, {
            type: 'ICE',
            sessionId,
            candidate: candData
          });
        } else {
          peerObj.outgoingIceBuffer.push(candData);
        }
      };

      pc.ontrack = (e) => {
        if (e.streams && e.streams[0]) {
          e.streams[0].getTracks().forEach((t) => {
            if (!peerObj.remoteStream.getTracks().some((ex) => ex.id === t.id)) {
              peerObj.remoteStream.addTrack(t);
            }
          });
        } else if (e.track) {
          if (!peerObj.remoteStream.getTracks().some((ex) => ex.id === e.track.id)) {
            peerObj.remoteStream.addTrack(e.track);
          }
        }

        peerObj.connState = 'connected';
        const remoteName = this.remoteDevices.get(remoteId)?.name || remoteId;
        this.log(`Отримано медіапотік (${e.track.kind}) від @${remoteName}!`);

        this.attachVoiceAnalyser(remoteId, peerObj.remoteStream);
        this.notifyStateChanged();
      };

      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        peerObj.connState = st;
        const remoteName = this.remoteDevices.get(remoteId)?.name || remoteId;
        this.log(`ICE з @${remoteName}: ${st}`);
        this.notifyStateChanged();

        if (st === 'failed') {
          this.log(`Перезапуск з'єднання з @${remoteName}...`);
          if (this.localStream) {
            setTimeout(() => this.startOfferToPeer(remoteId), 1500);
          }
        }
      };

      return peerObj;
    }

    flushOutgoingIce(remoteId, peerObj) {
      peerObj.sdpSent = true;
      while (peerObj.outgoingIceBuffer.length > 0) {
        const cand = peerObj.outgoingIceBuffer.shift();
        this.sendDirectSignal(remoteId, {
          type: 'ICE',
          sessionId: peerObj.sessionId,
          candidate: cand
        });
      }
    }

    async flushIncomingIce(peerObj) {
      peerObj.remoteDescSet = true;
      while (peerObj.iceQueue.length > 0) {
        const cand = peerObj.iceQueue.shift();
        try {
          await peerObj.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (err) {
          console.warn('[AetherRTC] Помилка addIceCandidate:', err);
        }
      }
    }

    async startOfferToPeer(remoteId) {
      const sessionId = 's_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const peerObj = this.createPeerSession(remoteId, sessionId);
      const remoteName = this.remoteDevices.get(remoteId)?.name || remoteId;

      try {
        const offer = await peerObj.pc.createOffer();
        await peerObj.pc.setLocalDescription(offer);

        this.sendDirectSignal(remoteId, {
          type: 'OFFER',
          sessionId,
          sdp: {
            type: peerObj.pc.localDescription.type,
            sdp: peerObj.pc.localDescription.sdp
          },
          state: this.localState
        });

        this.flushOutgoingIce(remoteId, peerObj);
        this.log(`OFFER надіслано до @${remoteName}`);
      } catch (err) {
        this.log(`Помилка OFFER: ${err.message}`);
      }
    }

    async handleDirectSignal(msg) {
      if (!msg || !msg.from || msg.from === this.deviceId) return;
      const remoteId = msg.from;

      if (msg.state) {
        msg.state._receivedAt = Date.now();
        this.remoteDevices.set(remoteId, msg.state);
      }

      if (msg.type === 'REQUEST_OFFER') {
        if (this.localStream) {
          await this.startOfferToPeer(remoteId);
        }
        return;
      }

      if (msg.type === 'OFFER') {
        const remoteName = this.remoteDevices.get(remoteId)?.name || remoteId;
        this.log(`Отримано OFFER від @${remoteName}, формуємо ANSWER...`);

        const peerObj = this.createPeerSession(remoteId, msg.sessionId);
        try {
          await peerObj.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await this.flushIncomingIce(peerObj);

          const answer = await peerObj.pc.createAnswer();
          await peerObj.pc.setLocalDescription(answer);

          this.sendDirectSignal(remoteId, {
            type: 'ANSWER',
            sessionId: msg.sessionId,
            sdp: {
              type: peerObj.pc.localDescription.type,
              sdp: peerObj.pc.localDescription.sdp
            },
            state: this.localState
          });

          this.flushOutgoingIce(remoteId, peerObj);
          this.log(`ANSWER надіслано до @${remoteName}`);
        } catch (err) {
          this.log(`Помилка ANSWER: ${err.message}`);
        }
        return;
      }

      if (msg.type === 'ANSWER') {
        const peerObj = this.peers.get(remoteId);
        if (!peerObj || peerObj.sessionId !== msg.sessionId) return;
        try {
          await peerObj.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await this.flushIncomingIce(peerObj);
          const remoteName = this.remoteDevices.get(remoteId)?.name || remoteId;
          this.log(`Отримано ANSWER від @${remoteName}!`);
        } catch (err) {
          this.log(`Помилка прийому ANSWER: ${err.message}`);
        }
        return;
      }

      if (msg.type === 'ICE' && msg.candidate) {
        const peerObj = this.peers.get(remoteId);
        if (!peerObj || peerObj.sessionId !== msg.sessionId) {
          // Якщо кандидат прийшов на мілісекунду раніше за OFFER — кладемо в ранню чергу
          if (!this.earlyIceQueues.has(remoteId)) {
            this.earlyIceQueues.set(remoteId, []);
          }
          this.earlyIceQueues.get(remoteId).push(msg.candidate);
          return;
        }

        if (peerObj.remoteDescSet && peerObj.pc.remoteDescription) {
          try {
            await peerObj.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (_) {}
        } else {
          peerObj.iceQueue.push(msg.candidate);
        }
      }
    }

    unlockAllAudio() {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
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
        if (!this.audioContext) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          this.audioContext = new AudioCtx();
        }
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

    startLoops() {
      const loop = () => {
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
        this.cb.onVoiceActivity?.(speakingSeatIds);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);

      // Публікуємо пульс кожні 3.5 секунди та очищаємо тих, хто мовчить >18 секунд за ЛОКАЛЬНИМ часом
      setInterval(() => {
        this.publishPresence();
        const now = Date.now();
        let changed = false;
        this.remoteDevices.forEach((dev, id) => {
          if (dev._receivedAt && now - dev._receivedAt > 18000) {
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