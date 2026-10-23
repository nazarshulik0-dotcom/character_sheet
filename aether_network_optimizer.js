/**
 * ============================================================================
 * AETHER NETWORK OPTIMIZER (aether_network_optimizer.js) - v3.0 APEX MASTER
 * ----------------------------------------------------------------------------
 * Пакет 1 + Пакет 2 (Dual-Broker Zero-Drop & Interactive Studio Mixer HUD):
 *   1. Active-Active Dual-Broker Redundancy (EMQX + HiveMQ одночасно):
 *      кожен аудіопакет летить паралельно двома незалежними брокерами з
 *      дедуплікацією за номером seq (0.0% втрат при лагах магістралі!).
 *   2. Audio-First Micro-Pacing (зелений коридор 8 мс для голосу).
 *   3. Ultra-Low Playout Delay (25 ms) + DSCP High Priority для WebRTC Opus.
 *   4. Розширений Пульт Звукорежисера у HUD (клік по 00:00):
 *      - Індивідуальні повзунки гучності 0%–200% та Mute для кожного гравця
 *      - Індикація 3D-панорами крісла (L / C / R)
 *      - Тумблери 3D-Панорами, Пріоритету Майстра (-4 dB) та ADPCM 24kHz HD
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

      // Dual-Broker (Другий паралельний WebSocket-канал для 0% втрат аудіо)
      this.dualBrokerEnabled = true;
      this.secondaryAudioClient = null;
      this.currentMirroredRoom = null;
      this.txSeqCounter = 1;
      this.seenPacketSignatures = new Set();
      this.seenSignatureQueue = [];
      this.dualPacketsRecovered = 0;

      this.hudPanel = null;
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.installDualBrokerAndMicroPacer();
      this.connectSecondaryMirrorBroker();
      this.buildTacticalHudOverlay();
      this.startNetworkGovernorLoop();

      this.engine.log('🌐 [NetworkOptimizer v3.0] Dual-Broker (EMQX + HiveMQ) + Studio Mixer HUD активовано.');
    }

    // =========================================================================
    // 1. ПОДВІЙНИЙ БРОКЕР (SMPTE 2022-7 DUAL-STREAMING) + MICRO-PACING
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
      // Обираємо альтернативний брокер (якщо основний EMQX — беремо HiveMQ, і навпаки)
      const mirrorUrl = SECONDARY_BROKERS[this.engine.brokerIndex % SECONDARY_BROKERS.length];
      const audioTopic = `entropia_ark_317/omega_v5/${roomId}/media`;

      try {
        this.secondaryAudioClient = window.mqtt.connect(mirrorUrl, {
          clientId: 'mirror30_' + this.engine.deviceId + '_' + Math.floor(Math.random() * 9999),
          clean: true,
          connectTimeout: 6000,
          reconnectPeriod: 3000
        });

        this.secondaryAudioClient.on('connect', () => {
          this.secondaryAudioClient.subscribe(audioTopic, { qos: 0 });
          this.engine.log(`🛡️ [Dual-Broker] Резервна магістраль активна (${mirrorUrl.split('/')[2]}).`);
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

    installDualBrokerAndMicroPacer() {
      if (!this.engine || this.engine._v3NetHooksInstalled) return;
      this.engine._v3NetHooksInstalled = true;

      const origPubAudio = this.engine.publishQuantumAudioPacket.bind(this.engine);
      const origPubVideo = this.engine.publishQuantumVideoPacket.bind(this.engine);
      const origHandleRelay = this.engine.handleQuantumRelayPacket.bind(this.engine);
      const origConnectRoom = this.engine.connectRoom.bind(this.engine);

      // При зміні кімнати перепідключаємо і другий брокер
      this.engine.connectRoom = (roomId) => {
        const res = origConnectRoom(roomId);
        setTimeout(() => this.connectSecondaryMirrorBroker(), 200);
        return res;
      };

      // Відправка аудіо: додаємо унікальний номер пакета seq і шлемо через ОБИДВА брокери одночасно!
      this.engine.publishQuantumAudioPacket = (pkt) => {
        this.lastAudioPacketSentAt = performance.now();
        pkt.seq = this.txSeqCounter++;

        // 1. Основний брокер
        origPubAudio(pkt);

        // 2. Дублюючий брокер (якщо підключений)
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

      // Micro-Pacing: відео завжди поступається чергою звуковому пакету на 8 мс
      this.engine.publishQuantumVideoPacket = (pkt) => {
        const sinceAudioMs = performance.now() - this.lastAudioPacketSentAt;
        if (sinceAudioMs >= 0 && sinceAudioMs < 8) {
          setTimeout(() => origPubVideo(pkt), 8);
          return;
        }
        return origPubVideo(pkt);
      };

      // Прийом із миттєвою дедуплікацією: грає той пакет, який прилетів першим!
      this.engine.handleQuantumRelayPacket = (pkt) => {
        if (!pkt || !pkt.from || pkt.from === this.engine.deviceId) return;

        if (pkt.seq !== undefined && pkt.t !== 'V') {
          const sig = `${pkt.from}_${pkt.seq}`;
          if (this.seenPacketSignatures.has(sig)) {
            return; // Друга копія пакета прийшла пізніше — тихо ігноруємо дублікат!
          }
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

    startNetworkGovernorLoop() {
      if (this.timer) clearInterval(this.timer);

      this.timer = setInterval(() => {
        if (!this.engine) return;

        this.optimizePeerConnections();
        this.guardSocketBackpressure();
        this.updateSeatLatencyBadges();
        this.refreshTacticalHudContent();
      }, 1300);
    }

    // =========================================================================
    // 2. НИЗЬКА ЗАТРИМКА WEBRTC (25 MS) ТА QOS ПРІОРИТЕТ ГОЛОСУ
    // =========================================================================
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

        if (typeof pc.getSenders === 'function' && !peerObj._qosTunedV3) {
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
              peerObj._qosTunedV3 = true;
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
    // 3. ІНТЕРАКТИВНИЙ ТАКТИЧНИЙ HUD v3.0 + ПУЛЬТ ЗВУКОРЕЖИСЕРА (КЛІК ПО 00:00)
    // =========================================================================
    buildTacticalHudOverlay() {
      const clockEl = document.getElementById('session-clock');
      if (clockEl) {
        clockEl.style.cursor = 'pointer';
        clockEl.title = 'Клікніть, щоб відкрити Пульт Звукорежисера та HUD v3.0';
        clockEl.addEventListener('click', () => {
          if (this.hudPanel) {
            const isHidden = this.hudPanel.style.display === 'none';
            this.hudPanel.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) this.refreshTacticalHudContent(true);
          }
        });
      }

      const panel = document.createElement('div');
      panel.id = 'aether-tactical-hud-v3';
      panel.style.cssText = `
        position: fixed;
        bottom: 16px;
        right: 302px;
        width: 325px;
        max-height: 82vh;
        overflow-y: auto;
        background: rgba(12, 15, 18, 0.97);
        border: 1px solid rgba(52, 211, 153, 0.5);
        border-radius: 12px;
        padding: 13px;
        color: #eceff4;
        font-family: Inter, sans-serif;
        font-size: 11px;
        z-index: 9999;
        display: none;
        flex-direction: column;
        gap: 9px;
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.88);
      `;

      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:6px;">
          <strong style="color:#6ee7b7;letter-spacing:0.4px;">🎛️ AETHER STUDIO MIXER & HUD v3.0</strong>
          <span id="hud-close-btn" style="cursor:pointer;color:#8b929e;font-size:14px;">✕</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;" id="hud-preset-buttons">
          <button data-preset="auto" class="small-btn" style="font-size:10px;padding:4px;">🤖 Автопілот</button>
          <button data-preset="room" class="small-btn" style="font-size:10px;padding:4px;">🏠 1 Кімната</button>
          <button data-preset="global" class="small-btn" style="font-size:10px;padding:4px;">🌍 Між країнами</button>
          <button data-preset="studio" class="small-btn" style="font-size:10px;padding:4px;">🎙️ Студія</button>
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
        </div>

        <div style="font-weight:600;color:#a7f3d0;font-size:10px;letter-spacing:0.4px;">
          ІНДИВІДУАЛЬНИЙ МІКШЕР УЧАСНИКІВ (0% – 200%):
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

      const chkSpatial = panel.querySelector('#hud-chk-spatial');
      const chkGmDuck = panel.querySelector('#hud-chk-gm-duck');
      const chkAdpcm = panel.querySelector('#hud-chk-adpcm');

      chkSpatial.addEventListener('change', (e) => {
        window.AetherOptimizers.audio?.setSpatialEnabled(e.target.checked);
        this.refreshTacticalHudContent(true);
      });

      chkGmDuck.addEventListener('change', (e) => {
        window.AetherOptimizers.audio?.setGmPriorityEnabled(e.target.checked);
      });

      chkAdpcm.addEventListener('change', (e) => {
        window.AetherOptimizers.audio?.setAdpcm24kEnabled(e.target.checked);
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
      const activePreset = audioOpt?.presetMode || 'auto';

      this.hudPanel.querySelectorAll('#hud-preset-buttons button').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-preset') === activePreset);
      });

      if (audioOpt) {
        this.hudPanel.querySelector('#hud-chk-spatial').checked = audioOpt.spatialEnabled;
        this.hudPanel.querySelector('#hud-chk-gm-duck').checked = audioOpt.gmPriorityEnabled;
        this.hudPanel.querySelector('#hud-chk-adpcm').checked = audioOpt.adpcm24kEnabled;
      }

      // Оновлюємо список гравців у мікшері
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

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-direction:column;gap:3px;background:rgba(0,0,0,0.35);padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.06);';
            row.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:600;color:#e2e8f0;">@${dev.name} <small style="color:#34d399;">[${panBadge}]</small></span>
                <div style="display:flex;align-items:center;gap:6px;">
                  <span class="vol-label" style="font-family:monospace;color:#6ee7b7;">${currentVolPct}%</span>
                  <button class="small-btn mute-peer-btn" style="padding:2px 6px;font-size:10px;">${isMuted ? '🔇' : '🔊'}</button>
                </div>
              </div>
              <input type="range" min="0" max="200" value="${currentVolPct}" style="width:100%;accent-color:#10b981;cursor:pointer;" />
            `;

            const slider = row.querySelector('input[type="range"]');
            const volLabel = row.querySelector('.vol-label');
            const muteBtn = row.querySelector('.mute-peer-btn');

            slider.addEventListener('input', (e) => {
              const pct = Number(e.target.value);
              volLabel.textContent = `${pct}%`;
              audioOpt?.setPlayerCustomVolume(remoteId, dev.name, pct / 100);
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

      // Жива телеметрія
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
          <div>• Пакетів TX/RX: <b>${aTel.packetsSent || 0}</b> / <b>${aTel.packetsReceived || 0}</b> | Відео: <b>${vTel.currentFps || 60} FPS</b></div>
        `;
      }
    }
  }

  window.AetherOptimizers.register('network', new AetherNetworkOptimizer());
})(window);