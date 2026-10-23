/**
 * ============================================================================
 * AETHER NETWORK OPTIMIZER (aether_network_optimizer.js) - v2.0 LUXURY MAX
 * ----------------------------------------------------------------------------
 * Мережевий автопілот рівня Discord + Тактичний HUD Майстра:
 *   1. Audio-First Micro-Pacing: розводить відправку відео та звуку в часі,
 *      щоб відеокадр ніколи не затримував аудіопакет у Wi-Fi роутері.
 *   2. Ultra-Low Playout Delay (25 ms) + DSCP High Priority для WebRTC Opus.
 *   3. Multi-Broker Watchdog: автоматичний перехід на резервний брокер при збоях.
 *   4. Interactive Tactical HUD (клік по годиннику 00:00): живий монітор пінгу
 *      та миттєвий перемикач режимів (Кімната / Між країнами / Студія).
 * ============================================================================
 */

(function (window) {
  'use strict';

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
      this.offlineSeconds = 0;
      this.hudPanel = null;
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.installAudioFirstMicroPacer();
      this.buildTacticalHudOverlay();
      this.startNetworkGovernorLoop();
      this.engine.log('🌐 [NetworkOptimizer v2.0] Micro-Pacer + Tactical HUD готові (клік по годиннику 00:00).');
    }

    // =========================================================================
    // 1. MICRO-PACING: ЗЕЛЕНИЙ КОРИДОР ДЛЯ АУДІОПАКЕТІВ
    // =========================================================================
    installAudioFirstMicroPacer() {
      if (!this.engine || this.engine._pacerInstalled) return;
      this.engine._pacerInstalled = true;

      const origPubAudio = this.engine.publishQuantumAudioPacket.bind(this.engine);
      const origPubVideo = this.engine.publishQuantumVideoPacket.bind(this.engine);

      this.engine.publishQuantumAudioPacket = (pkt) => {
        this.lastAudioPacketSentAt = performance.now();
        return origPubAudio(pkt);
      };

      // Якщо щойно (менш ніж 8 мс тому) пішов пакет голосу — відкладаємо кадр відео на 8 мс,
      // щоб роутер відправив звук першим без жодної черги!
      this.engine.publishQuantumVideoPacket = (pkt) => {
        const sinceAudioMs = performance.now() - this.lastAudioPacketSentAt;
        if (sinceAudioMs >= 0 && sinceAudioMs < 8) {
          setTimeout(() => origPubVideo(pkt), 8);
          return;
        }
        return origPubVideo(pkt);
      };
    }

    startNetworkGovernorLoop() {
      if (this.timer) clearInterval(this.timer);

      this.timer = setInterval(() => {
        if (!this.engine) return;

        this.optimizePeerConnections();
        this.guardSocketBackpressureAndFailover();
        this.updateSeatLatencyBadges();
        this.refreshTacticalHudContent();
      }, 1400);
    }

    // =========================================================================
    // 2. НАЛАШТУВАННЯ МІНІМАЛЬНОЇ ЗАТРИМКИ ТА ПРІОРИТЕТІВ WEBRTC
    // =========================================================================
    optimizePeerConnections() {
      const now = Date.now();

      this.engine.peers.forEach((peerObj, remoteId) => {
        const pc = peerObj.pc;
        if (!pc) return;

        // Апаратний буфер 25 мс для звуку та 45 мс для відео
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

        // Найвищий мережевий пріоритет (DSCP High) для потоку голосу
        if (typeof pc.getSenders === 'function' && !peerObj._qosTunedV2) {
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
              peerObj._qosTunedV2 = true;
            } catch (_) {}
          });
        }

        // Чистий перезапуск ICE при обриві маршруту
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

    // =========================================================================
    // 3. КОНТРОЛЬ БУФЕРА СОКЕТІВ ТА АВТО-ФЕЙЛОВЕР БРОКЕРА
    // =========================================================================
    guardSocketBackpressureAndFailover() {
      try {
        const mqttConnected = !!(this.engine.mqttClient && this.engine.mqttClient.connected);
        if (!mqttConnected) {
          this.offlineSeconds += 1.4;
          if (this.offlineSeconds > 9) {
            this.offlineSeconds = 0;
            this.engine.brokerIndex = (this.engine.brokerIndex + 1) % 2;
            this.engine.log('🔄 [NetworkOptimizer] Перемикання на резервний MQTT-кластер...');
            this.engine.connectRoom(this.engine.roomId);
          }
        } else {
          this.offlineSeconds = 0;
        }

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
        const mutedIcon = dev.hasAudio === false ? '🔇 ' : '';

        if (peerObj && (peerObj.p2pAudioVerified || peerObj.p2pVideoVerified)) {
          const rtt = peerObj.rttMs ? `${peerObj.rttMs} ms` : 'LAN';
          statusEl.textContent = `${mutedIcon}🟢 P2P • ${rtt}`;
        } else if ((peerObj && peerObj.hasRelayFrames) || dev.inGame) {
          const prebufMs = Math.round((this.engine.audio?.tuning?.jitterPrebufferSec || 0.065) * 1000);
          statusEl.textContent = `${mutedIcon}⚡ Quantum • ~${prebufMs} ms`;
        }
      });
    }

    // =========================================================================
    // 4. ІНТЕРАКТИВНИЙ ТАКТИЧНИЙ HUD (КЛІК ПО ГОДИННИКУ СЕСІЇ 00:00)
    // =========================================================================
    buildTacticalHudOverlay() {
      const clockEl = document.getElementById('session-clock');
      if (clockEl) {
        clockEl.style.cursor = 'pointer';
        clockEl.title = 'Клікніть, щоб відкрити Тактичний HUD оптимізаторів (v2.0)';
        clockEl.addEventListener('click', () => {
          if (this.hudPanel) {
            const isHidden = this.hudPanel.style.display === 'none';
            this.hudPanel.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) this.refreshTacticalHudContent();
          }
        });
      }

      const panel = document.createElement('div');
      panel.id = 'aether-tactical-hud-v2';
      panel.style.cssText = `
        position: fixed;
        bottom: 18px;
        right: 305px;
        width: 290px;
        background: rgba(13, 17, 20, 0.96);
        border: 1px solid rgba(52, 211, 153, 0.45);
        border-radius: 10px;
        padding: 12px;
        color: #eceff4;
        font-family: Inter, sans-serif;
        font-size: 11px;
        z-index: 9999;
        display: none;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.8);
      `;

      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:6px;">
          <strong style="color:#6ee7b7;letter-spacing:0.5px;">⚡ OMEGA OPTIMIZER HUD v2.0</strong>
          <span id="hud-close-btn" style="cursor:pointer;color:#8b929e;font-size:14px;">✕</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;" id="hud-preset-buttons">
          <button data-preset="auto" class="small-btn" style="font-size:10px;padding:4px;">🤖 Автопілот</button>
          <button data-preset="room" class="small-btn" style="font-size:10px;padding:4px;">🏠 1 Кімната</button>
          <button data-preset="global" class="small-btn" style="font-size:10px;padding:4px;">🌍 Між країнами</button>
          <button data-preset="studio" class="small-btn" style="font-size:10px;padding:4px;">🎙️ Студія</button>
        </div>
        <div id="hud-live-metrics" style="font-family:monospace;font-size:10px;color:#a7f3d0;line-height:1.45;"></div>
      `;

      document.body.appendChild(panel);
      this.hudPanel = panel;

      panel.querySelector('#hud-close-btn').addEventListener('click', () => {
        panel.style.display = 'none';
      });

      panel.querySelectorAll('#hud-preset-buttons button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const preset = btn.getAttribute('data-preset');
          if (window.AetherOptimizers.audio) {
            window.AetherOptimizers.audio.setPresetMode(preset);
          }
          this.refreshTacticalHudContent();
        });
      });
    }

    refreshTacticalHudContent() {
      if (!this.hudPanel || this.hudPanel.style.display === 'none' || !this.engine) return;

      const activePreset = window.AetherOptimizers.audio?.presetMode || 'auto';
      this.hudPanel.querySelectorAll('#hud-preset-buttons button').forEach((btn) => {
        const isCurrent = btn.getAttribute('data-preset') === activePreset;
        btn.classList.toggle('active', isCurrent);
      });

      const aTel = this.engine.audio ? this.engine.audio.getTelemetry() : {};
      const vTel = this.engine.video ? this.engine.video.getTelemetry() : {};
      const nTel = this.engine.getNetworkTelemetry ? this.engine.getNetworkTelemetry() : {};

      const prebufMs = Math.round((aTel.tuning?.jitterPrebufferSec || 0.065) * 1000);
      const hpfHz = aTel.tuning?.hpfFrequency || 105;
      const fps = vTel.currentFps || 60;

      const metricsEl = this.hudPanel.querySelector('#hud-live-metrics');
      if (metricsEl) {
        metricsEl.innerHTML = `
          <div>• Аудіобуфер: <b>${prebufMs} ms</b> | HPF: <b>${hpfHz} Hz</b></div>
          <div>• Пакетів TX/RX: <b>${aTel.packetsSent || 0}</b> / <b>${aTel.packetsReceived || 0}</b></div>
          <div>• Відео FPS: <b>${fps}</b> | Кадр: <b>${vTel.lastEncodeDurationMs || 0} ms</b></div>
          <div>• Вузлів у кімнаті: <b>${1 + (nTel.remoteCount || 0)}</b></div>
        `;
      }
    }
  }

  window.AetherOptimizers.register('network', new AetherNetworkOptimizer());
})(window);