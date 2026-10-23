/**
 * ============================================================================
 * AETHER VIDEO OPTIMIZER (aether_video_optimizer.js) - v6.3 VITRUVIUS GM
 * ----------------------------------------------------------------------------
 * Фінальна версія під систему «Вітрувій»:
 *   1. 3D-Голограма ядра «Рафаель» у центрі столу (Idle / Listening / Working /
 *      Speaking / Error) без кринжових реплік та без авто-спавну.
 *   2. Клік по голограмі в центрі столу доступний виключно Майстру (GM).
 *   3. 60 FPS Reactive Voice Aura + Біометрія крісел (без авто-вигуків ШІ).
 * ============================================================================
 */

(function (window) {
  'use strict';

  const RAFAEL_VIRTUAL_ID = 'node_rafael_ai';

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

  class AetherVideoOptimizer {
    constructor() {
      this.engine = null;
      this.video = null;
      this.timer = null;
      this.nightVisionActive = false;
      this.hdSharpenEnabled = true;

      this.remoteTabHiddenMap = new Map();
      this.peerBiometricStateMap = new Map();
      this.localBiometricState = 'normal';

      this.holoWrap = null;
      this.holoCanvas = null;
      this.holoCtx = null;
      this.plexusNodes = [];
      this.rotY = 0;
      this.rotX = 0;
      this.sageRingAngle = 0;
      this.pulseShockwave = 0;
    }

    attach(rtcEngine) {
      this.engine = rtcEngine;
      this.video = rtcEngine.video;
      if (!this.video) return;

      this.injectSvgHdAndBiometricStyles();
      this.mountCenterHologram();
      this.installGpuBitmapDecoderHook();
      this.setupVisibilityAndBiometricSync();
      this.startReactiveVoiceAuraAndHologramLoop();
      this.startVideoGovernorLoop();
    }

    mountCenterHologram() {
      const innerRing = document.querySelector('.table-inner-ring');
      if (!innerRing) return;

      const existing = document.getElementById('rafael-table-center-core');
      if (existing) existing.remove();

      this.plexusNodes = [];
      const totalNodes = 128;
      const golden = (1 + Math.sqrt(5)) / 2;

      for (let i = 0; i < totalNodes; i++) {
        const isCoreCluster = i < 36;
        const theta = (2 * Math.PI * i) / golden;
        const phi = Math.acos(1 - (2 * (i + 0.5)) / totalNodes);
        const baseRadius = isCoreCluster
          ? (0.22 + (i % 5) * 0.08)
          : (0.64 + (i % 7) * 0.065);

        this.plexusNodes.push({
          bx: baseRadius * Math.sin(phi) * Math.cos(theta),
          by: baseRadius * Math.sin(phi) * Math.sin(theta),
          bz: baseRadius * Math.cos(phi),
          driftSpeed: 0.8 + (i % 7) * 0.35,
          phaseX: i * 1.17,
          phaseY: i * 2.31,
          phaseZ: i * 0.73,
          size: isCoreCluster ? (1.6 + (i % 3) * 0.7) : (1.0 + (i % 3) * 0.55),
          isCore: isCoreCluster
        });
      }

      const wrap = document.createElement('div');
      wrap.id = 'rafael-table-center-core';
      wrap.style.cssText = `
        position: absolute;
        inset: -14px;
        border-radius: 50%;
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: radial-gradient(circle, rgba(4, 28, 44, 0.94) 0%, rgba(5, 14, 22, 0.82) 66%, transparent 100%);
        border: 1px solid rgba(34, 211, 238, 0.55);
        box-shadow: 0 0 38px rgba(34, 211, 238, 0.38), inset 0 0 28px rgba(34, 211, 238, 0.25);
        z-index: 16;
        overflow: hidden;
        pointer-events: auto;
      `;

      wrap.innerHTML = `
        <canvas id="rafael-center-canvas" width="210" height="210" style="width:154px;height:154px;pointer-events:none;"></canvas>
        <div id="rafael-holo-status-bar" style="
          position: absolute;
          bottom: 6px;
          display: flex;
          gap: 3px;
          background: rgba(4, 15, 24, 0.92);
          border: 1px solid rgba(34, 211, 238, 0.45);
          padding: 2px 6px;
          border-radius: 8px;
          font-family: monospace;
          font-size: 7.5px;
          letter-spacing: 0.3px;
          color: #64748b;
          box-shadow: 0 2px 10px rgba(0,0,0,0.7);
        ">
          <span data-st="Idle" style="color:#67e8f9;font-weight:700;">Idle</span>•
          <span data-st="Listening">Listen</span>•
          <span data-st="Working">Work</span>•
          <span data-st="Speaking">Speak</span>
        </div>
      `;

      // Клік по голограмі працює ТІЛЬКИ для Майстра (GM) і просто зупиняє мовлення у разі потреби
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.engine?.localState?.role !== 'gm') return;
        const bridge = window.AetherRafaelBridge;
        if (bridge && bridge.getBotState() !== 'Idle') {
          window.AetherOptimizers.audio?.stopRafaelSpeechImmediately();
          bridge.setBotState('Idle', true);
        }
      });

      innerRing.appendChild(wrap);
      this.holoWrap = wrap;
      this.holoCanvas = wrap.querySelector('#rafael-center-canvas');
      this.holoCtx = this.holoCanvas.getContext('2d');
    }

    renderCenterHologramFrame(now) {
      const netOpt = window.AetherOptimizers.network;
      if (!netOpt || !this.holoWrap) return;

      const innerRing = document.querySelector('.table-inner-ring');
      if (innerRing) {
        const defaultControls = innerRing.querySelector('.table-center-controls');
        const defaultCounter = innerRing.querySelector('.table-seats-counter');
        if (netOpt.rafaelActive) {
          if (defaultControls) defaultControls.style.display = 'none';
          if (defaultCounter) defaultCounter.style.display = 'none';
          if (this.holoWrap.style.display !== 'flex') this.holoWrap.style.display = 'flex';
        } else {
          if (defaultControls) defaultControls.style.display = 'flex';
          if (defaultCounter) defaultCounter.style.display = 'block';
          if (this.holoWrap.style.display !== 'none') this.holoWrap.style.display = 'none';
          return;
        }
      }

      if (!this.holoCtx) return;
      const ctx = this.holoCtx;
      const W = this.holoCanvas.width;
      const H = this.holoCanvas.height;
      const cx = W / 2;
      const cy = H / 2 - 4;

      ctx.clearRect(0, 0, W, H);

      const state = netOpt.rafaelState || 'Idle';
      const voiceEnergy = window.AetherOptimizers.audio?.getPeerVoiceEnergy(RAFAEL_VIRTUAL_ID) || 0;
      const t = now * 0.001;

      const statusBar = this.holoWrap.querySelector('#rafael-holo-status-bar');
      if (statusBar && statusBar.dataset.lastState !== state) {
        statusBar.dataset.lastState = state;
        statusBar.querySelectorAll('span[data-st]').forEach((sp) => {
          const isCur = sp.getAttribute('data-st') === state;
          sp.style.color = isCur ? (state === 'Error' ? '#f87171' : '#67e8f9') : '#475569';
          sp.style.fontWeight = isCur ? '700' : '400';
        });
      }

      let rotSpeed = 0.007;
      let sageRingSpeed = 0.005;
      let sphereRadius = 64;
      let organicDrift = 0.055;
      let rCol = 34, gCol = 211, bCol = 238;

      if (state === 'Listening') {
        rotSpeed = 0.015;
        sageRingSpeed = 0.018;
        sphereRadius = 60 + Math.sin(t * 6.5) * 4;
        organicDrift = 0.08;
        rCol = 52; gCol = 211; bCol = 153;
      } else if (state === 'Working') {
        rotSpeed = 0.038;
        sageRingSpeed = 0.055;
        sphereRadius = 56 + Math.sin(t * 14) * 3;
        organicDrift = 0.11;
        rCol = 56; gCol = 189; bCol = 248;
      } else if (state === 'Speaking') {
        rotSpeed = 0.019;
        sageRingSpeed = 0.028 + voiceEnergy * 0.04;
        sphereRadius = 64 + voiceEnergy * 24 + Math.sin(t * 16) * 2.5;
        organicDrift = 0.09 + voiceEnergy * 0.16;
        this.pulseShockwave = (this.pulseShockwave + 0.04 + voiceEnergy * 0.08) % 1;
      } else if (state === 'Error') {
        rotSpeed = 0.025;
        sageRingSpeed = -0.04;
        organicDrift = 0.22;
        rCol = 248; gCol = 113; bCol = 113;
      } else {
        sphereRadius = 62 + Math.sin(t * 1.9) * 3.2;
      }

      this.rotY += rotSpeed;
      this.rotX += rotSpeed * 0.62;
      this.sageRingAngle += sageRingSpeed;

      ctx.save();
      ctx.strokeStyle = `rgba(${rCol}, ${gCol}, ${bCol}, 0.16)`;
      ctx.lineWidth = 0.6;
      const gridY = H - 22;
      for (let gx = -4; gx <= 4; gx++) {
        ctx.beginPath();
        ctx.moveTo(cx + gx * 14, gridY - 12);
        ctx.lineTo(cx + gx * 26, H);
        ctx.stroke();
      }
      for (let gy = 0; gy < 3; gy++) {
        const yPos = gridY - 10 + gy * 7;
        ctx.beginPath();
        ctx.moveTo(cx - 75, yPos);
        ctx.lineTo(cx + 75, yPos);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.sageRingAngle);
      ctx.strokeStyle = `rgba(${rCol}, ${gCol}, ${bCol}, ${0.22 + voiceEnergy * 0.35})`;
      ctx.lineWidth = 0.85;

      const octR = sphereRadius * 1.08;
      for (let k = 0; k < 2; k++) {
        ctx.rotate((Math.PI / 4) * k);
        ctx.strokeRect(-octR * 0.68, -octR * 0.68, octR * 1.36, octR * 1.36);
      }

      ctx.rotate(-this.sageRingAngle * 2.1);
      for (let a = 0; a < 4; a++) {
        ctx.beginPath();
        ctx.arc(0, 0, sphereRadius * 1.15, a * (Math.PI / 2) + 0.15, a * (Math.PI / 2) + 0.95);
        ctx.stroke();
      }
      ctx.restore();

      const coreGlow = ctx.createRadialGradient(cx, cy, 2, cx, cy, sphereRadius * 0.95);
      coreGlow.addColorStop(0, `rgba(255, 255, 255, ${0.55 + voiceEnergy * 0.42})`);
      coreGlow.addColorStop(0.32, `rgba(${rCol}, ${gCol}, ${bCol}, ${0.38 + voiceEnergy * 0.32})`);
      coreGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = coreGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, sphereRadius * 0.95, 0, Math.PI * 2);
      ctx.fill();

      if (state === 'Speaking' && this.pulseShockwave > 0.01) {
        ctx.strokeStyle = `rgba(165, 243, 252, ${(1 - this.pulseShockwave) * 0.55})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, sphereRadius * (0.4 + this.pulseShockwave * 0.85), 0, Math.PI * 2);
        ctx.stroke();
      }

      const cosY = Math.cos(this.rotY);
      const sinY = Math.sin(this.rotY);
      const cosX = Math.cos(this.rotX);
      const sinX = Math.sin(this.rotX);

      const projected = [];
      for (let i = 0; i < this.plexusNodes.length; i++) {
        const n = this.plexusNodes[i];
        const dx = Math.sin(t * n.driftSpeed + n.phaseX) * organicDrift;
        const dy = Math.cos(t * n.driftSpeed * 1.1 + n.phaseY) * organicDrift;
        const dz = Math.sin(t * n.driftSpeed * 0.9 + n.phaseZ) * organicDrift;

        const voiceExpand = n.isCore ? (1 + voiceEnergy * 0.55) : (1 + voiceEnergy * 0.25);
        const x0 = (n.bx + dx) * voiceExpand;
        const y0 = (n.by + dy) * voiceExpand;
        const z0 = (n.bz + dz) * voiceExpand;

        const x1 = x0 * cosY - z0 * sinY;
        const z1 = z0 * cosY + x0 * sinY;
        const y2 = y0 * cosX - z1 * sinX;
        const z2 = z1 * cosX + y0 * sinX;

        const persp = 2.5 / (2.5 - z2 * 0.72);
        projected.push({
          px: cx + x1 * sphereRadius * persp,
          py: cy + y2 * sphereRadius * persp,
          z: z2,
          size: n.size * persp * (1 + voiceEnergy * 0.5),
          isCore: n.isCore
        });
      }

      ctx.lineWidth = 0.65;
      for (let i = 0; i < projected.length; i++) {
        const a = projected[i];
        let connections = 0;
        for (let j = i + 1; j < projected.length; j++) {
          const b = projected[j];
          const ddx = a.px - b.px;
          const ddy = a.py - b.py;
          const distSq = ddx * ddx + ddy * ddy;
          if (distSq < 540) {
            const alpha = (1 - distSq / 540) * (0.42 + voiceEnergy * 0.38);
            ctx.strokeStyle = `rgba(${rCol}, ${gCol}, ${bCol}, ${alpha.toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(a.px, a.py);
            ctx.lineTo(b.px, b.py);
            ctx.stroke();
            if (++connections >= 3) break;
          }
        }
      }

      for (let i = 0; i < projected.length; i++) {
        const p = projected[i];
        const alpha = Math.max(0.22, Math.min(1, (p.z + 1.15) / 1.9));
        ctx.fillStyle = (p.isCore || p.z > 0.35)
          ? `rgba(240, 253, 255, ${alpha})`
          : `rgba(${rCol}, ${gCol}, ${bCol}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.px, p.py, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    injectSvgHdAndBiometricStyles() {
      if (document.getElementById('aether-hd-svg-defs-v5')) return;

      const svgWrap = document.createElement('div');
      svgWrap.id = 'aether-hd-svg-defs-v5';
      svgWrap.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;';
      svgWrap.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="aether-unsharp-hd" color-interpolation-filters="sRGB">
              <feConvolveMatrix
                order="3 3"
                preserveAlpha="true"
                kernelMatrix="0 -0.35 0 -0.35 2.4 -0.35 0 -0.35 0"
              />
            </filter>
          </defs>
        </svg>
        <style>
          body:not(.eco-mode) .seat-node.has-video.hd-sharpen-on .seat-media-frame video,
          body:not(.eco-mode) .seat-node.has-video.hd-sharpen-on .seat-media-frame canvas.relay-canvas-view {
            filter: url(#aether-unsharp-hd) contrast(1.04) saturate(1.05);
          }

          .seat-node.bio-wounded .seat-media-frame {
            border-color: #ef4444 !important;
            animation: aetherBioWoundedPulse 1.6s infinite ease-in-out !important;
          }
          .seat-node.bio-wounded .seat-media-frame::after {
            content: '🩸 КРИТИЧНЕ HP';
            position: absolute;
            inset: 0;
            box-shadow: inset 0 0 24px rgba(239, 68, 68, 0.78);
            display: flex;
            align-items: flex-end;
            justify-content: center;
            padding-bottom: 3px;
            font-size: 8px;
            font-weight: 800;
            color: #fecaca;
            letter-spacing: 0.6px;
            pointer-events: none;
            z-index: 11;
          }
          @keyframes aetherBioWoundedPulse {
            0%, 100% { box-shadow: 0 0 14px rgba(239, 68, 68, 0.65); }
            50% { box-shadow: 0 0 28px rgba(220, 38, 38, 0.98); }
          }

          .seat-node.bio-cursed .seat-media-frame {
            border-color: #a855f7 !important;
            box-shadow: -3px 0 16px rgba(168, 85, 247, 0.85), 3px 0 16px rgba(34, 211, 238, 0.85) !important;
          }
          .seat-node.bio-cursed .seat-media-frame video,
          .seat-node.bio-cursed .seat-media-frame canvas.relay-canvas-view {
            filter: hue-rotate(28deg) contrast(1.18) saturate(1.3) !important;
          }

          .seat-node.bio-crit20 .seat-media-frame {
            border-color: #fbbf24 !important;
            box-shadow: 0 0 36px rgba(251, 191, 36, 0.98), inset 0 0 22px rgba(251, 191, 36, 0.65) !important;
            transform: scale(1.06);
          }

          .seat-tab-badge {
            position: absolute;
            top: 5px;
            left: 5px;
            background: rgba(9, 14, 18, 0.86);
            border: 1px solid rgba(52, 211, 153, 0.55);
            color: #6ee7b7;
            font-size: 9px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 5px;
            z-index: 12;
            pointer-events: none;
            backdrop-filter: blur(4px);
          }

          .seat-whisper-badge {
            position: absolute;
            bottom: 5px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(6, 78, 59, 0.92);
            border: 1px solid #22d3ee;
            color: #a5f3fc;
            font-size: 9px;
            font-weight: 700;
            padding: 2px 7px;
            border-radius: 6px;
            z-index: 14;
            pointer-events: none;
            white-space: nowrap;
            box-shadow: 0 0 12px rgba(34, 211, 238, 0.65);
          }
        </style>
      `;
      document.body.appendChild(svgWrap);
    }

    setHdSharpenEnabled(enabled) {
      this.hdSharpenEnabled = !!enabled;
      this.decorateSeatsWithHdAndBadges();
    }

    setLocalBiometricState(stateName) {
      this.localBiometricState = stateName || 'normal';
      this.peerBiometricStateMap.set(this.engine.deviceId, this.localBiometricState);

      if (this.engine && this.engine.publishRoomPacket) {
        this.engine.publishRoomPacket({
          type: 'CHAR_VITAL_STATE',
          from: this.engine.deviceId,
          vitalState: this.localBiometricState
        });
      }

      if (this.localBiometricState === 'crit20') {
        setTimeout(() => {
          if (this.localBiometricState === 'crit20') {
            this.setLocalBiometricState('normal');
          }
        }, 4000);
      }

      this.decorateSeatsWithHdAndBadges();
    }

    startReactiveVoiceAuraAndHologramLoop() {
      const renderLoop = (now) => {
        if (this.engine && !document.hidden) {
          this.renderCenterHologramFrame(now);

          if (!this.video.ecoMode) {
            const audioOpt = window.AetherOptimizers.audio;
            if (audioOpt) {
              this.applyAuraToSeat(this.engine.localState?.seat, audioOpt.getPeerVoiceEnergy(this.engine.deviceId));
              this.engine.remoteDevices.forEach((dev, remoteId) => {
                if (remoteId !== RAFAEL_VIRTUAL_ID) {
                  this.applyAuraToSeat(dev.seat, audioOpt.getPeerVoiceEnergy(remoteId));
                }
              });
            }
          }
        }
        requestAnimationFrame(renderLoop);
      };
      requestAnimationFrame(renderLoop);
    }

    applyAuraToSeat(seatId, energy) {
      if (!seatId || seatId === 'table_center') return;
      const node = document.getElementById(`seat-${seatId}`);
      const frame = document.getElementById(`frame-${seatId}`);
      if (!node || !frame) return;

      if (node.classList.contains('bio-wounded') || node.classList.contains('bio-crit20')) {
        return;
      }

      if (energy > 0.08) {
        const radiusPx = Math.round(12 + energy * 26);
        const alpha = (0.45 + energy * 0.5).toFixed(2);
        const color = energy > 0.62
          ? `rgba(34, 211, 238, ${alpha})`
          : `rgba(16, 185, 129, ${alpha})`;
        frame.style.boxShadow = `0 0 ${radiusPx}px ${color}`;
      } else {
        frame.style.boxShadow = '';
      }
    }

    setupVisibilityAndBiometricSync() {
      if (!this.engine) return;

      const origHandleRoom = this.engine.handleRoomMessage.bind(this.engine);
      this.engine.handleRoomMessage = (msg) => {
        if (msg && msg.type === 'TAB_FOCUS' && msg.from && msg.from !== this.engine.deviceId) {
          this.remoteTabHiddenMap.set(msg.from, !!msg.inSheet);
          this.decorateSeatsWithHdAndBadges();
          return;
        }
        if (msg && msg.type === 'CHAR_VITAL_STATE' && msg.from) {
          this.peerBiometricStateMap.set(msg.from, msg.vitalState || 'normal');
          this.decorateSeatsWithHdAndBadges();
          return;
        }
        if (msg && msg.type === 'SFX_TRIGGER' && msg.sfx && msg.from !== this.engine.deviceId) {
          window.AetherOptimizers.audio?.playProceduralSoundEffect(msg.sfx, false);
          return;
        }
        return origHandleRoom(msg);
      };

      const broadcastFocus = () => {
        const inSheet = !!document.hidden;
        if (this.engine && this.engine.publishRoomPacket) {
          this.engine.publishRoomPacket({
            type: 'TAB_FOCUS',
            from: this.engine.deviceId,
            inSheet
          });
        }
        if (inSheet) {
          this.video.applyOptimizerPatch({ frameIntervalMs: 480, webpQuality: 0.34 });
        } else {
          this.video.applyOptimizerPatch({ frameIntervalMs: 120, webpQuality: 0.54, blendDurationMs: 120 });
          this.healVideoElements();
        }
        this.decorateSeatsWithHdAndBadges();
      };

      document.addEventListener('visibilitychange', broadcastFocus);
    }

    decorateSeatsWithHdAndBadges() {
      if (!this.engine) return;

      document.querySelectorAll('.seat-node').forEach((node) => {
        node.classList.toggle('hd-sharpen-on', this.hdSharpenEnabled && !this.video.ecoMode);
      });

      const localSeat = this.engine.localState?.seat;
      if (localSeat) {
        this.applyBiometricClassesToSeat(localSeat, this.localBiometricState);
      }

      this.engine.remoteDevices.forEach((dev, remoteId) => {
        if (!dev.seat || remoteId === RAFAEL_VIRTUAL_ID) return;
        const frame = document.getElementById(`frame-${dev.seat}`);
        if (!frame) return;

        let badge = frame.querySelector('.seat-tab-badge');
        const isLookingAtSheet = this.remoteTabHiddenMap.get(remoteId) === true;

        if (isLookingAtSheet) {
          if (!badge) {
            badge = document.createElement('div');
            badge.className = 'seat-tab-badge';
            badge.textContent = '📜 У Листі';
            frame.appendChild(badge);
          }
        } else if (badge) {
          badge.remove();
        }

        const bioState = this.peerBiometricStateMap.get(remoteId) || 'normal';
        this.applyBiometricClassesToSeat(dev.seat, bioState);
      });
    }

    applyBiometricClassesToSeat(seatId, bioState) {
      const node = document.getElementById(`seat-${seatId}`);
      if (!node) return;
      node.classList.toggle('bio-wounded', bioState === 'wounded');
      node.classList.toggle('bio-cursed', bioState === 'cursed');
      node.classList.toggle('bio-crit20', bioState === 'crit20');
    }

    installGpuBitmapDecoderHook() {
      if (!this.video || !window.createImageBitmap || this.video._gpuHookInstalled) return;
      this.video._gpuHookInstalled = true;

      const origIngest = this.video.ingestQuantumVideoFrame.bind(this.video);

      this.video.ingestQuantumVideoFrame = (remoteId, pkt, seatId = null) => {
        if (!pkt || !pkt.d) return;
        const peerVid = this.video.getOrCreatePeerVideo(remoteId);
        if (seatId) peerVid.targetSeatId = seatId;

        if (peerVid.decodingInFlight) return;
        peerVid.decodingInFlight = true;

        fetch(pkt.d)
          .then((res) => res.blob())
          .then((blob) => window.createImageBitmap(blob))
          .then((bitmap) => {
            peerVid.decodingInFlight = false;
            const w = peerVid.currCanvas.width;
            const h = peerVid.currCanvas.height;

            if (peerVid.hasRelayFrames) {
              peerVid.prevCtx.drawImage(peerVid.currCanvas, 0, 0, w, h);
            } else {
              peerVid.prevCtx.drawImage(bitmap, 0, 0, w, h);
            }

            peerVid.currCtx.drawImage(bitmap, 0, 0, w, h);
            bitmap.close();

            peerVid.frameTimestamp = performance.now();
            peerVid.hasRelayFrames = true;
            this.video.telemetry.framesReceived++;

            if (peerVid.targetSeatId) {
              const node = document.getElementById(`seat-${peerVid.targetSeatId}`);
              if (node && !node.classList.contains('show-webrtc-video')) {
                node.classList.add('has-video', 'show-relay-video');
              }
            }
          })
          .catch(() => {
            peerVid.decodingInFlight = false;
            origIngest(remoteId, pkt, seatId);
          });
      };
    }

    startVideoGovernorLoop() {
      if (this.timer) clearInterval(this.timer);

      this.timer = setInterval(() => {
        if (!this.video || !this.engine) return;

        this.decorateSeatsWithHdAndBadges();
        if (!document.hidden) {
          this.adjustDynamicSpeakerFpsAndQuality();
          this.runAutoNightVisionEnhancer();
          this.healVideoElements();
        }
      }, 1500);
    }

    adjustDynamicSpeakerFpsAndQuality() {
      const vTel = this.video.getTelemetry();
      const encodeMs = vTel.lastEncodeDurationMs || 0;
      const fps = vTel.currentFps || 60;

      const isGM = this.engine.localState?.role === 'gm';
      const isLocalSpeaking = this.engine.audio
        ? this.engine.audio.isPeerSpeaking(this.engine.deviceId)
        : false;

      let someoneElseSpeaking = false;
      if (this.engine.audio) {
        this.engine.remoteDevices.forEach((_, remoteId) => {
          if (this.engine.audio.isPeerSpeaking(remoteId)) {
            someoneElseSpeaking = true;
          }
        });
      }

      if (encodeMs > 26 || fps < 36) {
        this.video.applyOptimizerPatch({ frameIntervalMs: 175, webpQuality: 0.40, blendDurationMs: 175 });
      } else if (someoneElseSpeaking && !isLocalSpeaking) {
        this.video.applyOptimizerPatch({ frameIntervalMs: 185, webpQuality: 0.42, blendDurationMs: 185 });
      } else if (isLocalSpeaking || isGM) {
        this.video.applyOptimizerPatch({ frameIntervalMs: 115, webpQuality: 0.56, blendDurationMs: 115 });
      } else {
        this.video.applyOptimizerPatch({ frameIntervalMs: 135, webpQuality: 0.50, blendDurationMs: 135 });
      }
    }

    runAutoNightVisionEnhancer() {
      if (!this.video.txCtx || !this.video.cameraEnabled || this.video.ecoMode) return;

      try {
        const w = this.video.txCanvas.width;
        const h = this.video.txCanvas.height;
        const data = this.video.txCtx.getImageData(0, 0, w, h).data;

        let lumaSum = 0;
        let samples = 0;
        for (let i = 0; i < data.length; i += 64) {
          lumaSum += (data[i] * 2 + data[i + 1] * 5 + data[i + 2]) >> 3;
          samples++;
        }

        const avgLuma = samples > 0 ? lumaSum / samples : 128;
        const shouldBoostLight = avgLuma > 8 && avgLuma < 62;

        if (shouldBoostLight !== this.nightVisionActive) {
          this.nightVisionActive = shouldBoostLight;
          this.video.txCtx.filter = shouldBoostLight
            ? 'brightness(1.22) contrast(1.08)'
            : 'none';
        }
      } catch (_) {}
    }

    healVideoElements() {
      document.querySelectorAll('.seat-node.show-webrtc-video video').forEach((vid) => {
        if (vid.srcObject && vid.paused) {
          vid.play().catch(() => {});
        }
      });
    }
  }

  window.AetherOptimizers.register('video', new AetherVideoOptimizer());
})(window);