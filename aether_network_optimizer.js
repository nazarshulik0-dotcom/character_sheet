/**
 * ============================================================================
 * AETHER NETWORK OPTIMIZER (aether_network_optimizer.js) - v1.0 OMEGA GOVERNOR
 * ----------------------------------------------------------------------------
 * Автономний модуль оптимізації мережі (Рівень Discord WebRTC):
 *   1. PlayoutDelayHint Zero-Latency (примусове зниження буфера WebRTC до 30 мс)
 *   2. RTP Audio Priority & Bitrate Tuning (високий QoS пріоритет для голосу)
 *   3. Smart ICE Auto-Healer (перезапуск завислих P2P-тунелів без спаму)
 *   4. WebSocket Backpressure Controller + Live Ping HUD на кріслах
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
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.engine.log('🌐 [NetworkOptimizer] Discord Low-Latency & QoS автопілот активовано.');
      this.startNetworkGovernorLoop();
    }

    startNetworkGovernorLoop() {
      if (this.timer) clearInterval(this.timer);

      this.timer = setInterval(() => {
        if (!this.engine) return;

        this.optimizePeerConnections();
        this.guardSocketBackpressure();
        this.updateSeatLatencyBadges();
      }, 1500);
    }

    // 1. Вмикає ультранизьку затримку декодера (30 мс) та високий пріоритет аудіопакетів
    optimizePeerConnections() {
      const now = Date.now();

      this.engine.peers.forEach((peerObj, remoteId) => {
        const pc = peerObj.pc;
        if (!pc) return;

        // А. Знижуємо апаратний буфер приймачів WebRTC (playoutDelayHint = 30 мс як у Discord)
        if (typeof pc.getReceivers === 'function') {
          pc.getReceivers().forEach((receiver) => {
            if (receiver.track && receiver.track.kind === 'audio') {
              if ('playoutDelayHint' in receiver && receiver.playoutDelayHint !== 0.03) {
                try { receiver.playoutDelayHint = 0.03; } catch (_) {}
              }
            }
            if (receiver.track && receiver.track.kind === 'video') {
              if ('playoutDelayHint' in receiver && receiver.playoutDelayHint !== 0.05) {
                try { receiver.playoutDelayHint = 0.05; } catch (_) {}
              }
            }
          });
        }

        // Б. Піднімаємо пріоритет відправки аудіо над відео
        if (typeof pc.getSenders === 'function' && !peerObj._qosTuned) {
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
                params.encodings[0].maxBitrate = 320000;
              }
              sender.setParameters(params).catch(() => {});
              peerObj._qosTuned = true;
            } catch (_) {}
          });
        }

        // В. Розумне відновлення завислого P2P (не частіше ніж раз на 12 секунд!)
        const st = pc.iceConnectionState;
        const remoteDev = this.engine.remoteDevices.get(remoteId);
        if ((st === 'failed' || st === 'disconnected') && remoteDev && remoteDev.inGame) {
          const lastAttempt = this.lastIceRestartByPeer.get(remoteId) || 0;
          if (now - lastAttempt > 12000 && this.engine.deviceId > remoteId) {
            this.lastIceRestartByPeer.set(remoteId, now);
            this.engine.triggerNegotiation(remoteId, true);
          }
        }
      });
    }

    // 2. Контроль черги сокетів (щоб відео ніколи не затримувало пакети звуку)
    guardSocketBackpressure() {
      try {
        const ws = this.engine.mqttClient?.stream?.socket;
        if (ws && ws.bufferedAmount > 32768) {
          this.engine.tuning.maxVideoSocketBufferBytes = 24576;
        } else {
          this.engine.tuning.maxVideoSocketBufferBytes = 65536;
        }
      } catch (_) {}
    }

    // 3. Відображення живої затримки (ms) на бейджах крісел
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
  }

  window.AetherOptimizers.register('network', new AetherNetworkOptimizer());
})(window);