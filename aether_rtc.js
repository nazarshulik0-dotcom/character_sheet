/**
 * ============================================================================
 * AETHER NETWORK & WEBRTC ENGINE (aether_rtc.js) - v3.0
 * Выделенный модуль P2P аудио/видеосвязи и межпристроевой синхронизации
 * С поддержкой Vanilla ICE (защита от потерь пакетов в MQTT) и TURN-релеев
 * ============================================================================
 */

(function (window) {
  'use strict';

  const IDENTITY_KEY = 'entropia_aether_identity_v3';

  // STUN + бесплатные TURN-серверы для пробития любых роутеров и мобильных сетей
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];

  class AetherRTCEngine {
    constructor(callbacks = {}) {
      this.cb = callbacks;

      // 1. Загружаем постоянный профиль устройства (разделяет GM и Игрока)
      this.identity = this.loadIdentity();
      this.deviceId = this.identity.deviceId;

      const urlParams = new URLSearchParams(window.location.search);
      this.roomId = (urlParams.get('room') || this.identity.roomId || 'entropia-1').trim();
      this.playerSeatCount = Number(this.identity.playerSeatCount) || 6;

      const initialRole = this.detectInitialRole();
      const initialName = initialRole === 'gm'
        ? (this.identity.gmName || 'Архітект (GM)')
        : (this.identity.playerName || this.readBridgePlayerName() || 'Оперативник');
      const initialSeat = initialRole === 'gm'
        ? 'gm'
        : (this.identity.playerSeat || 'seat1');

      this.localState = {
        deviceId: this.deviceId,
        name: initialName,
        role: initialRole,
        seat: initialSeat,
        inGame: false,
        hasVideo: false,
        hasAudio: false,
        mediaSession: 0,
        ts: Date.now()
      };

      this.remoteDevices = new Map(); // remoteId -> state
      this.peers = new Map();         // remoteId -> { pc, sessionId, remoteStream, audioEl, connStatus }
      this.localStream = null;
      this.selectedSpeakerId = 'default';

      this.audioContext = null;
      this.analysers = new Map();

      this.setupBridgeIntegration();
      this.startVoiceMonitor();
    }

    // --- УПРАВЛЕНИЕ ПРОФИЛЕМ И РОЛЬЮ (ЗАЩИТА ПРОФИЛЯ МАСТЕРА) ---
    loadIdentity() {
      try {
        const raw = localStorage.getItem(IDENTITY_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.deviceId) return parsed;
        }
      } catch (_) {}

      const fresh = {
        deviceId: 'dev_' + Math.random().toString(36).substring(2, 10),
        role: null,
        gmName: 'Архітект (GM)',
        playerName: null,
        playerSeat: 'seat1',
        roomId: 'entropia-1',
        playerSeatCount: 6
      };
      localStorage.setItem(IDENTITY_KEY, JSON.stringify(fresh));
      return fresh;
    }

    saveIdentity() {
      this.identity.role = this.localState.role;
      this.identity.roomId = this.roomId;
      this.identity.playerSeatCount = this.playerSeatCount;

      if (this.localState.role === 'gm') {
        this.identity.gmName = this.localState.name;
      } else {
        this.identity.playerName = this.localState.name;
        if (this.localState.seat !== 'gm') {
          this.identity.playerSeat = this.localState.seat;
        }
      }
      localStorage.setItem(IDENTITY_KEY, JSON.stringify(this.identity));
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
      if (this.identity.role === 'gm' || this.identity.role === 'player') {
        return this.identity.role;
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
        // Если мы вошли как Мастер (GM) — игнорируем имя из открытого листа игрока!
        if (this.localState.role === 'gm') return;

        if (char && (char.name || char.callsign)) {
          this.localState.name = char.name || char.callsign;
          this.saveIdentity();
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
        this.localState.name = this.identity.gmName || 'Архітект (GM)';
      } else {
        this.localState.seat = this.identity.playerSeat || 'seat1';
        this.localState.name = this.identity.playerName || this.readBridgePlayerName() || 'Оперативник';
        this.resolveSeatConflict();
      }

      this.saveIdentity();
      this.publishPresence();
      this.notifyStateChanged();
      return true;
    }

    setName(newName) {
      this.localState.name = (newName || '').trim() || (this.localState.role === 'gm' ? 'Архітект (GM)' : 'Оперативник');
      this.saveIdentity();
      this.publishPresence();
      this.notifyStateChanged();
    }

    // --- MQTT СИНХРОНИЗАЦИЯ КОМНАТЫ И СИГНАЛИНГ ---
    connectRoom(roomId) {
      if (roomId) {
        this.roomId = roomId.trim() || 'entropia-1';
        this.saveIdentity();
      }

      if (this.mqttClient) {
        try { this.mqttClient.end(true); } catch (_) {}
      }

      this.remoteDevices.clear();
      this.peers.forEach((_, id) => this.closePeer(id));

      const base = `entropia_ark_317/room_v3/${this.roomId}`;
      this.presencePrefix = `${base}/presence/`;
      this.configTopic = `${base}/config`;
      this.signalTopicForMe = `${base}/signal/${this.deviceId}`;
      this.signalPrefix = `${base}/signal/`;
      this.chatTopic = `${base}/chat`;

      this.cb.onNetworkStatus?.('Підключення до брокера...', false);

      this.mqttClient = window.mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
        clientId: 'aether_' + this.deviceId + '_' + Math.floor(Math.random() * 9999),
        clean: true,
        reconnectPeriod: 3000,
        will: {
          topic: this.presencePrefix + this.deviceId,
          payload: JSON.stringify({ deviceId: this.deviceId, offline: true }),
          qos: 0,
          retain: true
        }
      });

      this.mqttClient.on('connect', () => {
        this.cb.onNetworkStatus?.(`Онлайн (${this.roomId})`, true);
        // Подписываемся на присутствие всех устройств и персональный канал сигналинга
        this.mqttClient.subscribe(`${this.presencePrefix}+`, { qos: 0 });
        this.mqttClient.subscribe(this.configTopic, { qos: 0 });
        this.mqttClient.subscribe(this.signalTopicForMe, { qos: 1 });
        this.mqttClient.subscribe(this.chatTopic, { qos: 0 });

        this.publishPresence();
      });

      this.mqttClient.on('message', (topic, payload) => {
        try {
          const data = JSON.parse(payload.toString());
          if (topic.startsWith(this.presencePrefix)) {
            this.onRemotePresence(data);
          } else if (topic === this.configTopic) {
            if (data.playerSeatCount && data.updatedBy !== this.deviceId) {
              this.cb.onSeatCountSync?.(Number(data.playerSeatCount));
            }
          } else if (topic === this.signalTopicForMe) {
            this.onDirectSignal(data);
          } else if (topic === this.chatTopic) {
            if (data.deviceId !== this.deviceId) {
              this.cb.onChatMessage?.(data.author, data.text);
            }
          }
        } catch (e) {
          console.warn('[AetherRTC] Помилка пакету MQTT:', e);
        }
      });

      this.mqttClient.on('offline', () => {
        this.cb.onNetworkStatus?.('Офлайн (Перепідключення...)', false);
      });
    }

    publishPresence() {
      this.localState.ts = Date.now();
      if (this.mqttClient && this.mqttClient.connected) {
        this.mqttClient.publish(
          this.presencePrefix + this.deviceId,
          JSON.stringify(this.localState),
          { qos: 0, retain: true }
        );
      }
    }

    publishSeatCount(count) {
      this.playerSeatCount = count;
      this.saveIdentity();
      if (this.mqttClient && this.mqttClient.connected) {
        this.mqttClient.publish(
          this.configTopic,
          JSON.stringify({ playerSeatCount: count, updatedBy: this.deviceId }),
          { qos: 0, retain: true }
        );
      }
    }

    sendChat(text) {
      if (this.mqttClient && this.mqttClient.connected) {
        this.mqttClient.publish(
          this.chatTopic,
          JSON.stringify({
            deviceId: this.deviceId,
            author: this.localState.name,
            text
          })
        );
      }
    }

    // Персональная отправка сигнала конкретному устройству (QoS 1 — гарантированная доставка)
    sendDirectSignal(targetDeviceId, packet) {
      if (!this.mqttClient || !this.mqttClient.connected) return;
      this.mqttClient.publish(
        this.signalPrefix + targetDeviceId,
        JSON.stringify({
          ...packet,
          from: this.deviceId,
          to: targetDeviceId,
          ts: Date.now()
        }),
        { qos: 1 }
      );
    }

    onRemotePresence(data) {
      if (!data || !data.deviceId || data.deviceId === this.deviceId) return;

      // Удаляем отключившиеся устройства
      if (data.offline || (data.ts && Date.now() - data.ts > 28000)) {
        this.remoteDevices.delete(data.deviceId);
        this.closePeer(data.deviceId);
        this.notifyStateChanged();
        return;
      }

      const isNewPeer = !this.remoteDevices.has(data.deviceId);
      this.remoteDevices.set(data.deviceId, data);

      // Если мы игрок и наше кресло уже занято кем-то с более ранним ID — пересаживаемся на свободное
      if (this.localState.role !== 'gm' && data.seat === this.localState.seat && data.deviceId < this.deviceId) {
        this.resolveSeatConflict();
      }

      this.notifyStateChanged();

      // КЛЮЧЕВОЕ ПРАВИЛО БЕЗ GLARE:
      // Если к комнате подключился новый участник, а у нас УЖЕ включена камера/микрофон —
      // мы сами отправляем ему OFFER, чтобы он сразу нас увидел и услышал!
      if (isNewPeer && this.localStream) {
        this.initiateCallToPeer(data.deviceId);
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
          this.saveIdentity();
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
        if (!confirm('Вийти з режиму Майстра (GM) та сісти на місце Гравця?')) return false;
        this.localState.role = 'player';
      }

      for (const [, dev] of this.remoteDevices.entries()) {
        if (dev.seat === seatId) {
          alert(`Це крісло вже зайняте гравцем ${dev.name}`);
          return false;
        }
      }

      this.localState.seat = seatId;
      this.saveIdentity();
      this.publishPresence();
      this.notifyStateChanged();
      return true;
    }

    // --- ЗАХВАТ КАМЕРЫ / МИКРОФОНА И НАДЕЖНЫЙ WEBRTC (VANILLA ICE) ---
    async startLocalMedia(micDeviceId = '', camDeviceId = '') {
      const constraints = {
        video: {
          width: { ideal: 320, max: 480 },
          height: { ideal: 240, max: 360 },
          frameRate: { ideal: 15, max: 20 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      };

      if (micDeviceId) constraints.audio.deviceId = { exact: micDeviceId };
      if (camDeviceId) constraints.video.deviceId = { exact: camDeviceId };

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Увага: Браузер заблокував доступ до камери/мікрофона, оскільки сторінка відкрита без HTTPS (або не через localhost). Ви все одно можете бачити та чути інших гравців!');
        this.localState.inGame = true;
        this.publishPresence();
        this.notifyStateChanged();
        return null;
      }

      try {
        if (this.localStream) {
          this.localStream.getTracks().forEach((t) => t.stop());
        }
        this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        this.localState.hasVideo = this.localStream.getVideoTracks().length > 0;
        this.localState.hasAudio = this.localStream.getAudioTracks().length > 0;
      } catch (err) {
        console.warn('[AetherRTC] Камера недоступна, пробуємо тільки мікрофон:', err);
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: constraints.audio, video: false });
          this.localState.hasVideo = false;
          this.localState.hasAudio = this.localStream.getAudioTracks().length > 0;
        } catch (audErr) {
          alert('Не вдалося увімкнути мікрофон або камеру (перевірте дозволи браузера). Ви підключені в режимі слухача.');
          this.localStream = null;
          this.localState.hasVideo = false;
          this.localState.hasAudio = false;
        }
      }

      this.localState.inGame = true;
      this.localState.mediaSession += 1;

      if (this.localStream) {
        this.attachVoiceAnalyser(this.deviceId, this.localStream);
      }

      this.publishPresence();
      this.notifyStateChanged();

      // Инициируем прямое соединение со всеми участниками в комнате
      for (const [remoteId] of this.remoteDevices.entries()) {
        await this.initiateCallToPeer(remoteId);
      }

      return this.localStream;
    }

    // Ожидание сбора ICE-кандидатов, чтобы вшить их прямо в один SDP-пакет (Vanilla ICE)
    waitForIceGathering(pc, timeoutMs = 800) {
      return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
          return;
        }
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          pc.removeEventListener('icegatheringstatechange', onState);
          resolve();
        };
        const onState = () => {
          if (pc.iceGatheringState === 'complete') finish();
        };
        pc.addEventListener('icegatheringstatechange', onState);
        setTimeout(finish, timeoutMs);
      });
    }

    createCleanPeerConnection(remoteId, sessionId) {
      // Закрываем старый PC, если он был
      const existing = this.peers.get(remoteId);
      if (existing && existing.pc) {
        try { existing.pc.close(); } catch (_) {}
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const remoteStream = new MediaStream();

      // Создаем или переиспользуем выделенный <audio> элемент для этого игрока
      let audioEl = document.getElementById(`aether-audio-${remoteId}`);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `aether-audio-${remoteId}`;
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        document.body.appendChild(audioEl);
      }

      const peerObj = {
        pc,
        sessionId,
        remoteStream,
        audioEl,
        connStatus: 'connecting'
      };
      this.peers.set(remoteId, peerObj);

      // Прикрепляем наши локальные треки (если есть)
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          pc.addTrack(track, this.localStream);
        });
      }

      // Досылаем поздние TURN-кандидаты, если они появились после основного пакета
      pc.onicecandidate = (e) => {
        if (e.candidate && pc.localDescription) {
          this.sendDirectSignal(remoteId, {
            type: 'ICE_LATE',
            sessionId,
            candidate: e.candidate
          });
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

        peerObj.connStatus = 'connected';

        // Запускаем воспроизведение звука через выделенный <audio>
        if (peerObj.audioEl.srcObject !== peerObj.remoteStream) {
          peerObj.audioEl.srcObject = peerObj.remoteStream;
        }
        if (typeof peerObj.audioEl.setSinkId === 'function' && this.selectedSpeakerId !== 'default') {
          peerObj.audioEl.setSinkId(this.selectedSpeakerId).catch(() => {});
        }

        const playPromise = peerObj.audioEl.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            // Браузер заблокировал автозапуск звука — показываем кнопку разблокировки
            this.cb.onAudioBlocked?.(true);
          });
        }

        this.attachVoiceAnalyser(remoteId, peerObj.remoteStream);
        this.notifyStateChanged();
      };

      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        if (st === 'connected' || st === 'completed') {
          peerObj.connStatus = 'connected';
          this.notifyStateChanged();
        } else if (st === 'failed' || st === 'disconnected') {
          peerObj.connStatus = 'reconnecting';
          this.notifyStateChanged();
          // Автопереподключение
          if (this.localStream && this.deviceId > remoteId) {
            setTimeout(() => this.initiateCallToPeer(remoteId), 2000);
          }
        }
      };

      return peerObj;
    }

    async initiateCallToPeer(remoteId) {
      const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const peerObj = this.createCleanPeerConnection(remoteId, sessionId);
      const pc = peerObj.pc;

      try {
        // Гарантируем, что соединение умеет и принимать, и отправлять аудио/видео
        if (!this.localStream || this.localStream.getAudioTracks().length === 0) {
          pc.addTransceiver('audio', { direction: 'recvonly' });
        }
        if (!this.localStream || this.localStream.getVideoTracks().length === 0) {
          pc.addTransceiver('video', { direction: 'recvonly' });
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Ждем до 700 мс, чтобы STUN/TURN кандидаты вшились прямо в SDP
        await this.waitForIceGathering(pc, 700);

        this.sendDirectSignal(remoteId, {
          type: 'OFFER',
          sessionId,
          sdp: pc.localDescription
        });
      } catch (err) {
        console.error('[AetherRTC] Помилка створення OFFER:', err);
      }
    }

    async onDirectSignal(msg) {
      if (!msg || !msg.from || msg.from === this.deviceId) return;
      const remoteId = msg.from;

      try {
        if (msg.type === 'OFFER') {
          // Пришел новый OFFER от другого устройства — создаем чистый PC под его sessionId
          const peerObj = this.createCleanPeerConnection(remoteId, msg.sessionId);
          const pc = peerObj.pc;

          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          // Собираем наши ICE-кандидаты прямо в пакет ANSWER
          await this.waitForIceGathering(pc, 700);

          this.sendDirectSignal(remoteId, {
            type: 'ANSWER',
            sessionId: msg.sessionId,
            sdp: pc.localDescription
          });
        } else if (msg.type === 'ANSWER') {
          const peerObj = this.peers.get(remoteId);
          if (peerObj && peerObj.sessionId === msg.sessionId && peerObj.pc.signalingState === 'have-local-offer') {
            await peerObj.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          }
        } else if (msg.type === 'ICE_LATE' && msg.candidate) {
          const peerObj = this.peers.get(remoteId);
          if (peerObj && peerObj.sessionId === msg.sessionId && peerObj.pc.remoteDescription) {
            await peerObj.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
          }
        }
      } catch (err) {
        console.error('[AetherRTC] Помилка обробки сигналу:', err);
      }
    }

    unlockAllAudio() {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
      this.peers.forEach((peerObj) => {
        if (peerObj.audioEl) {
          peerObj.audioEl.muted = false;
          peerObj.audioEl.play().catch(() => {});
        }
      });
      this.cb.onAudioBlocked?.(false);
    }

    setSpeakerOutput(deviceId) {
      this.selectedSpeakerId = deviceId || 'default';
      this.peers.forEach((peerObj) => {
        if (peerObj.audioEl && typeof peerObj.audioEl.setSinkId === 'function') {
          peerObj.audioEl.setSinkId(this.selectedSpeakerId).catch(() => {});
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
        if (peerObj.audioEl) peerObj.audioEl.remove();
        this.peers.delete(remoteId);
      }
      this.analysers.delete(remoteId);
    }

    // --- АНАЛИЗАТОР ГОЛОСА (ПОДСВЕТКА ГОВОРЯЩЕГО) ---
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

    startVoiceMonitor() {
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

      // Heartbeat присутствия каждые 4 секунды
      setInterval(() => this.publishPresence(), 4000);
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