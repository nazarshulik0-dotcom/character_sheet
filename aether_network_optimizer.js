/**
 * ============================================================================
 * AETHER NETWORK OPTIMIZER (aether_network_optimizer.js) - v4.0 ULTIMATE MASTER
 * ----------------------------------------------------------------------------
 * Повний стек мережі та пульта керування столом (Пакети 1 + 2 + 3 + 4):
 *   1. Dual-Broker Active-Active (EMQX + HiveMQ) із 0% втрат пакетів.
 *   2. Маршрутизація приватного Шепоту (pkt.to) та візуалізація плашок шепоту.
 *   3. Кнопки Акустики Локацій прямо в HUD (Сухий / Підземелля / Собор / Рація / Безодня).
 *   4. Кнопка «👁️ Шепіт» біля кожного гравця в мікшері HUD.
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

      // Статуси активного шепоту за столом: senderId -> targetId
      this.activeWhispersMap = new Map();
      this.hudPanel = null;
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.installDualBrokerWhisperAndPacer();
      this.connectSecondaryMirrorBroker();
      this.buildTacticalHudOverlay();
      this.startNetworkGovernorLoop();

      this.engine.log('🌐 [NetworkOptimizer v4.0] ULTIMATE HUD (Шепіт + Акустика + Dual-Broker) готовий.');
    }

    // =========================================================================
    // 1. ПОДВІЙНИЙ БРОКЕР + МАРШРУТИЗАТОР ПРИВАТНОГО ШЕПОТУ
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
          clientId: 'mirror40_' + this.engine.deviceId + '_' + Math.floor(Math.random() * 9999),
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
      if (!this.engine || this.engine._v4NetHooksInstalled) return;
      this.engine._v4NetHooksInstalled = true;

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

      // Обробка візуальних індикаторів шепоту за столом
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

      // Додаємо seq та (якщо активний шепіт) цільовий ID одержувача pkt.to
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

        // Якщо пакет є приватним шепотом іншому гравцю — відкидаємо його ще на рівні мережі!
        if (pkt.to && pkt.to !== this.engine.deviceId) {
          return;
        }

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

      // Позначаємо локальний шепіт, якщо ми зараз шепочемо комусь
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

      // Позначаємо шепіт інших гравців
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

        if (typeof pc.getSenders === 'function' && !peerObj._qosTunedV4) {
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
              peerObj._qosTunedV4 = true;
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
    // 2. ІНТЕРАКТИВНИЙ ТАКТИЧНИЙ HUD v4.0 (АКУСТИКА + ШЕПІТ + МІКШЕР)
    // =========================================================================
    buildTacticalHudOverlay() {
      const clockEl = document.getElementById('session-clock');
      if (clockEl) {
        clockEl.style.cursor = 'pointer';
        clockEl.title = 'Клікніть, щоб відкрити Пульт Звукорежисера, Акустику та Шепіт (v4.0)';
        clockEl.addEventListener('click', () => {
          if (this.hudPanel) {
            const isHidden = this.hudPanel.style.display === 'none';
            this.hudPanel.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) this.refreshTacticalHudContent(true);
          }
        });
      }

      const panel = document.createElement('div');
      panel.id = 'aether-tactical-hud-v4';
      panel.style.cssText = `
        position: fixed;
        bottom: 14px;
        right: 300px;
        width: 340px;
        max-height: 86vh;
        overflow-y: auto;
        background: rgba(11, 14, 17, 0.97);
        border: 1px solid rgba(52, 211, 153, 0.55);
        border-radius: 12px;
        padding: 13px;
        color: #eceff4;
        font-family: Inter, sans-serif;
        font-size: 11px;
        z-index: 9999;
        display: none;
        flex-direction: column;
        gap: 9px;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.9);
      `;

      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:6px;">
          <strong style="color:#6ee7b7;letter-spacing:0.4px;">🎛️ AETHER ULTIMATE CONSOLE v4.0</strong>
          <span id="hud-close-btn" style="cursor:pointer;color:#8b929e;font-size:14px;">✕</span>
        </div>

        <div style="font-weight:600;color:#a7f3d0;font-size:10px;">ПРОФІЛЬ СЕРЕДОВИЩА:</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;" id="hud-preset-buttons">
          <button data-preset="auto" class="small-btn" style="font-size:10px;padding:4px;">🤖 Автопілот</button>
          <button data-preset="room" class="small-btn" style="font-size:10px;padding:4px;">🏠 1 Кімната</button>
          <button data-preset="global" class="small-btn" style="font-size:10px;padding:4px;">🌍 Між країнами</button>
          <button data-preset="studio" class="small-btn" style="font-size:10px;padding:4px;">🎙️ Студія</button>
        </div>

        <div style="font-weight:600;color:#67e8f9;font-size:10px;">🏛️ АКУСТИКА ЛОКАЦІЇ / ЕФЕКТ ГОЛОСУ:</div>
        <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:3px;" id="hud-acoustic-buttons">
          <button data-space="dry" class="small-btn active" style="font-size:9px;padding:4px 2px;">🎙️ Сухий</button>
          <button data-space="dungeon" class="small-btn" style="font-size:9px;padding:4px 2px;">🏰 Данж</button>
          <button data-space="cathedral" class="small-btn" style="font-size:9px;padding:4px 2px;">⛪ Собор</button>
          <button data-space="radio" class="small-btn" style="font-size:9px;padding:4px 2px;">📻 Рація</button>
          <button data-space="abyss" class="small-btn" style="font-size:9px;padding:4px 2px;">👹 Безодня</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:4px;background:rgba(255,255,255,0.03);padding:7px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
            <span>🎧 3D-Панорама крісел столу</span>
            <input type="checkbox" id="hud-chk-spatial" checked />
          </label>
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
            <span>👑 Пріоритет Майстра (GM -4 dB)</span>
            <input type="checkbox" id="hud-chk-gm-duck" checked />
          </label>
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
            <span>⚡ Кодек ADPCM 24kHz HD + 2x Брокер</span>
            <input type="checkbox" id="hud-chk-adpcm" checked />
          </label>
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">
            <span>✨ HD-Контур відео (Unsharp Filter)</span>
            <input type="checkbox" id="hud-chk-sharpen" checked />
          </label>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:600;color:#a7f3d0;font-size:10px;">МІКШЕР ТА ТАЄМНИЙ ШЕПІТ (0%–200%):</span>
          <button id="hud-stop-whisper-btn" class="small-btn" style="display:none;font-size:9px;padding:2px 6px;border-color:#22d3ee;color:#67e8f9;">🔊 Вимк. Шепіт</button>
        </div>
        <div id="hud-player-mixer-list" style="display:flex;flex-direction:column;gap:6px;"></div>

        <div id="hud-live-metrics" style="font-family:monospace;font-size:10px;color:#94a3b8;border-top:1px solid rgba(255,255,255,0.08);padding-top:6px;line-height:1.45;"></div>
      `;

      document.body.appendChild(panel);
      this.hudPanel = panel;

      panel.querySelector('#hud-close-btn').addEventListener('click', () => {
        panel.style.display = 'none';
      });

      panel.querySelectorAll('#hud-preset-buttons button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const preset = btn.getAttribute('data-preset');
          window.AetherOptimizers.audio?.setPresetMode(preset);
          this.refreshTacticalHudContent(true);
        });
      });

      panel.querySelectorAll('#hud-acoustic-buttons button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const space = btn.getAttribute('data-space');
          window.AetherOptimizers.audio?.setAcousticSpace(space);
          this.refreshTacticalHudContent();
        });
      });

      panel.querySelector('#hud-stop-whisper-btn').addEventListener('click', () => {
        window.AetherOptimizers.audio?.setWhisperTarget(null);
        this.renderWhisperBadgesOnSeats();
        this.refreshTacticalHudContent(true);
      });

      panel.querySelector('#hud-chk-spatial').addEventListener('change', (e) => {
        window.AetherOptimizers.audio?.setSpatialEnabled(e.target.checked);
        this.refreshTacticalHudContent(true);
      });

      panel.querySelector('#hud-chk-gm-duck').addEventListener('change', (e) => {
        window.AetherOptimizers.audio?.setGmPriorityEnabled(e.target.checked);
      });

      panel.querySelector('#hud-chk-adpcm').addEventListener('change', (e) => {
        window.AetherOptimizers.audio?.setAdpcm24kEnabled(e.target.checked);
        this.dualBrokerEnabled = e.target.checked;
        this.refreshTacticalHudContent(true);
      });

      panel.querySelector('#hud-chk-sharpen').addEventListener('change', (e) => {
        window.AetherOptimizers.video?.setHdSharpenEnabled(e.target.checked);
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
      const currentWhisperTarget = audioOpt?.whisperTargetId || null;

      this.hudPanel.querySelectorAll('#hud-preset-buttons button').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-preset') === activePreset);
      });

      this.hudPanel.querySelectorAll('#hud-acoustic-buttons button').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-space') === activeSpace);
      });

      const stopWhisperBtn = this.hudPanel.querySelector('#hud-stop-whisper-btn');
      if (stopWhisperBtn) {
        stopWhisperBtn.style.display = currentWhisperTarget ? 'inline-block' : 'none';
      }

      if (audioOpt) {
        this.hudPanel.querySelector('#hud-chk-spatial').checked = audioOpt.spatialEnabled;
        this.hudPanel.querySelector('#hud-chk-gm-duck').checked = audioOpt.gmPriorityEnabled;
        this.hudPanel.querySelector('#hud-chk-adpcm').checked = audioOpt.adpcm24kEnabled;
      }
      if (videoOpt) {
        this.hudPanel.querySelector('#hud-chk-sharpen').checked = videoOpt.hdSharpenEnabled;
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
                  <button class="small-btn whisper-peer-btn ${isWhisperingToThis ? 'gm-mode' : ''}" style="padding:2px 6px;font-size:9px;" title="Приватний шепіт тільки цьому гравцю">
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
      const vTel = this.engine.video ? this.engine.video.getTelemetry() : {};
      const srKhz = ((aTel.tuning?.targetSampleRate || 24000) / 1000).toFixed(1);
      const prebufMs = Math.round((aTel.tuning?.jitterPrebufferSec || 0.065) * 1000);
      const mirrorOk = !!(this.secondaryAudioClient && this.secondaryAudioClient.connected);

      const metricsEl = this.hudPanel.querySelector('#hud-live-metrics');
      if (metricsEl) {
        metricsEl.innerHTML = `
          <div>• Кодек: <b>${audioOpt?.adpcm24kEnabled ? `ADPCM ${srKhz}kHz HD` : `PCM 16kHz`}</b> | Буфер: <b>${prebufMs} ms</b></div>
          <div>• Подвійний брокер: <b>${mirrorOk ? '🟢 Активний (2x)' : '🟡 Очікування'}</b> (Врятовано: ${this.dualPacketsRecovered})</div>
          <div>• Акустика: <b>${activeSpace.toUpperCase()}</b> | Відео: <b>${vTel.currentFps || 60} FPS</b></div>
        `;
      }
    }
  }

  window.AetherOptimizers.register('network', new AetherNetworkOptimizer());
})(window);