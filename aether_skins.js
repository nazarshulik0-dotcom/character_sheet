/**
 * AETHER_v8.5_CORE_FINAL — Modular Skin & Visual Engine
 * File: aether_skins.js
 * Description: Dynamic theme palettes, SVG texture overlays, glow controls & ECO-mode compatibility.
 */

class AetherSkinEngine {
    constructor() {
        this.STORAGE_KEY = 'aether_v85_skin_config';

        // Базові пресети палітр
        this.themes = {
            'bio-emerald': {
                name: 'Bio-Emerald',
                badge: '🌿',
                vars: {
                    '--bg-panel': 'rgba(8, 20, 14, 0.78)',
                    '--bg-panel-solid': '#08140e',
                    '--neon-vine': '#00ff88',
                    '--neon-secondary': '#00b862',
                    '--border-base': 'rgba(0, 255, 136, 0.22)',
                    '--border-hover': 'rgba(0, 255, 136, 0.75)',
                    '--text-primary': '#e6fff2',
                    '--text-muted': '#70a88c',
                    '--accent-glow': 'rgba(0, 255, 136, 0.35)',
                    '--table-aura': 'radial-gradient(ellipse at center, rgba(0, 255, 136, 0.14) 0%, transparent 70%)'
                }
            },
            'obsidian-carbon': {
                name: 'Obsidian Carbon',
                badge: '🖤',
                vars: {
                    '--bg-panel': 'rgba(14, 15, 18, 0.86)',
                    '--bg-panel-solid': '#0e0f12',
                    '--neon-vine': '#e0e6ed',
                    '--neon-secondary': '#6c7a89',
                    '--border-base': 'rgba(224, 230, 237, 0.16)',
                    '--border-hover': 'rgba(255, 255, 255, 0.65)',
                    '--text-primary': '#f5f7fa',
                    '--text-muted': '#7f8c9a',
                    '--accent-glow': 'rgba(224, 230, 237, 0.22)',
                    '--table-aura': 'radial-gradient(ellipse at center, rgba(224, 230, 237, 0.08) 0%, transparent 70%)'
                }
            },
            'arcane-cyan': {
                name: 'Arcane Cyan',
                badge: '💠',
                vars: {
                    '--bg-panel': 'rgba(7, 17, 26, 0.78)',
                    '--bg-panel-solid': '#07111a',
                    '--neon-vine': '#00f0ff',
                    '--neon-secondary': '#0088ff',
                    '--border-base': 'rgba(0, 240, 255, 0.24)',
                    '--border-hover': 'rgba(0, 240, 255, 0.8)',
                    '--text-primary': '#e6fcff',
                    '--text-muted': '#6ba8b8',
                    '--accent-glow': 'rgba(0, 240, 255, 0.38)',
                    '--table-aura': 'radial-gradient(ellipse at center, rgba(0, 240, 255, 0.15) 0%, transparent 70%)'
                }
            },
            'monolith-crimson': {
                name: 'Monolith Crimson',
                badge: '🩸',
                vars: {
                    '--bg-panel': 'rgba(24, 8, 12, 0.82)',
                    '--bg-panel-solid': '#18080c',
                    '--neon-vine': '#ff1e42',
                    '--neon-secondary': '#b30021',
                    '--border-base': 'rgba(255, 30, 66, 0.25)',
                    '--border-hover': 'rgba(255, 30, 66, 0.8)',
                    '--text-primary': '#ffeef1',
                    '--text-muted': '#b8707d',
                    '--accent-glow': 'rgba(255, 30, 66, 0.38)',
                    '--table-aura': 'radial-gradient(ellipse at center, rgba(255, 30, 66, 0.15) 0%, transparent 70%)'
                }
            }
        };

        // Вбудовані легкі текстури (SVG Data-URI + CSS градієнти)
        this.textures = {
            'none': {
                name: 'Чисте скло',
                pattern: 'none',
                size: 'auto'
            },
            'hex': {
                name: 'Гексагональна сітка',
                pattern: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                size: '28px 49px'
            },
            'carbon': {
                name: 'Карбонове волокно',
                pattern: `radial-gradient( rgba(255,255,255,0.06) 15%, transparent 16%), radial-gradient( rgba(255,255,255,0.06) 15%, transparent 16%)`,
                size: '8px 8px',
                position: '0 0, 4px 4px'
            },
            'veins': {
                name: 'Органічні прожилки',
                pattern: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cpath d='M0 60 Q 30 45 60 60 T 120 60 M60 0 Q 75 30 60 60 T 60 120 M20 20 Q 50 40 60 60 T 100 100' fill='none' stroke='%23ffffff' stroke-opacity='0.04' stroke-width='1'/%3E%3C/svg%3E")`,
                size: '120px 120px'
            },
            'scanlines': {
                name: 'Цифрові сканлайни',
                pattern: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255, 255, 255, 0.035) 2px, rgba(255, 255, 255, 0.035) 4px)`,
                size: '100% 4px'
            }
        };

        // Дефолтний стан
        this.state = {
            theme: 'bio-emerald',
            texture: 'hex',
            glowIntensity: 1.0,  // 0.0 - 2.0
            glassBlur: 12,       // 0px - 24px
            borderWidth: 1,      // 1px - 2.5px
            ecoMode: false
        };

        this.init();
    }

    init() {
        this.loadState();
        this.injectBaseStyles();
        this.observeEcoMode();
        this.applyAll();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.mountUI());
        } else {
            this.mountUI();
        }
    }

    loadState() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                this.state = { ...this.state, ...parsed };
            }
        } catch (e) {
            console.warn('[AetherSkinEngine] LocalStorage недоступний, використано стандартні налаштування.');
        }
    }

    saveState() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
        } catch (e) {
            console.warn('[AetherSkinEngine] Помилка збереження конфігурації скіна.');
        }
    }

    /**
     * Ін'єкція базових стилів для плашок, кутиків, текстур та панелі керування
     */
    injectBaseStyles() {
        if (document.getElementById('aether-skin-engine-styles')) return;

        const style = document.createElement('style');
        style.id = 'aether-skin-engine-styles';
        style.textContent = `
            :root {
                --skin-blur: 12px;
                --skin-border-width: 1px;
                --skin-glow-mult: 1;
                --skin-texture-pattern: none;
                --skin-texture-size: auto;
                --skin-texture-pos: 0 0;
            }

            /* Інтеграція зі скляними панелями та основними блоками Етера */
            .glass-card, .top-bar, .game-table-oval {
                position: relative;
                background-color: var(--bg-panel) !important;
                backdrop-filter: blur(var(--skin-blur)) !important;
                -webkit-backdrop-filter: blur(var(--skin-blur)) !important;
                border: var(--skin-border-width) solid var(--border-base) !important;
                box-shadow: 
                    0 8px 32px rgba(0, 0, 0, 0.55),
                    0 0 calc(16px * var(--skin-glow-mult)) var(--accent-glow),
                    inset 0 0 calc(8px * var(--skin-glow-mult)) var(--accent-glow) !important;
                transition: 
                    background-color 0.35s ease,
                    border-color 0.3s ease,
                    box-shadow 0.35s ease !important;
            }

            .glass-card:hover {
                border-color: var(--border-hover) !important;
                box-shadow: 
                    0 10px 36px rgba(0, 0, 0, 0.65),
                    0 0 calc(24px * var(--skin-glow-mult)) var(--accent-glow),
                    inset 0 0 calc(12px * var(--skin-glow-mult)) var(--accent-glow) !important;
            }

            /* Текстурний оверлей всередині .glass-card */
            .glass-card::before {
                content: "";
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 0;
                border-radius: inherit;
                background-image: var(--skin-texture-pattern);
                background-size: var(--skin-texture-size);
                background-position: var(--skin-texture-pos);
                opacity: 0.85;
                transition: opacity 0.3s ease;
            }

            /* Неонові кутові акценти на .glass-card */
            .glass-card::after {
                content: "";
                position: absolute;
                inset: -1px;
                pointer-events: none;
                z-index: 1;
                border-radius: inherit;
                background: 
                    linear-gradient(135deg, var(--neon-vine) 0%, transparent 12px) top left,
                    linear-gradient(-45deg, var(--neon-vine) 0%, transparent 12px) bottom right;
                background-size: 16px 16px;
                background-repeat: no-repeat;
                opacity: calc(0.45 * var(--skin-glow-mult));
                transition: opacity 0.3s ease;
            }

            /* Аура ігрового столу */
            .game-table-oval {
                background-image: var(--table-aura) !important;
            }

            /* Сумісність з ECO-режимом */
            body.eco-mode .glass-card,
            body.eco-mode .top-bar,
            body.eco-mode .game-table-oval,
            body[data-eco="true"] .glass-card,
            body[data-eco="true"] .top-bar {
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                background-color: var(--bg-panel-solid) !important;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.7) !important;
                transition: none !important;
            }

            body.eco-mode .glass-card::before,
            body.eco-mode .glass-card::after,
            body[data-eco="true"] .glass-card::before,
            body[data-eco="true"] .glass-card::after {
                display: none !important;
            }

            /* --- UI Селектора та Поповера Налаштувань --- */
            .aether-skin-widget {
                position: relative;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                margin-left: 8px;
                z-index: 9999;
                font-family: inherit;
            }

            .aether-skin-trigger {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 5px 11px;
                font-size: 12px;
                font-weight: 600;
                letter-spacing: 0.5px;
                color: var(--text-primary, #fff);
                background: rgba(0, 0, 0, 0.45);
                border: 1px solid var(--border-base, rgba(0,255,136,0.3));
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .aether-skin-trigger:hover {
                border-color: var(--neon-vine, #00ff88);
                box-shadow: 0 0 10px var(--accent-glow);
            }

            .aether-skin-popover {
                position: absolute;
                top: calc(100% + 10px);
                right: 0;
                width: 280px;
                padding: 14px;
                border-radius: 10px;
                background: var(--bg-panel-solid, #0a140f);
                border: 1px solid var(--border-hover, #00ff88);
                box-shadow: 0 14px 40px rgba(0, 0, 0, 0.85), 0 0 20px var(--accent-glow);
                color: var(--text-primary, #e6fff2);
                display: none;
                flex-direction: column;
                gap: 12px;
            }

            .aether-skin-popover.open {
                display: flex;
            }

            .skin-section-title {
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 1.2px;
                color: var(--text-muted, #70a88c);
                margin-bottom: 6px;
                display: flex;
                justify-content: space-between;
            }

            .skin-preset-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px;
            }

            .skin-preset-btn {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 7px 9px;
                font-size: 11px;
                color: var(--text-primary);
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid var(--border-base);
                border-radius: 6px;
                cursor: pointer;
                text-align: left;
                transition: all 0.2s ease;
            }

            .skin-preset-btn:hover {
                background: rgba(255, 255, 255, 0.08);
            }

            .skin-preset-btn.active {
                border-color: var(--neon-vine);
                background: var(--accent-glow);
                font-weight: 600;
            }

            .skin-select, .skin-range {
                width: 100%;
                background: rgba(0, 0, 0, 0.5);
                color: var(--text-primary);
                border: 1px solid var(--border-base);
                border-radius: 5px;
                padding: 5px 8px;
                font-size: 12px;
                outline: none;
            }

            .skin-range {
                padding: 0;
                accent-color: var(--neon-vine);
                cursor: pointer;
            }

            .skin-eco-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding-top: 8px;
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                font-size: 11px;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Застосовує всі поточні параметри скіна до DOM (:root)
     */
    applyAll() {
        const root = document.documentElement;
        const themeData = this.themes[this.state.theme] || this.themes['bio-emerald'];
        const textureData = this.textures[this.state.texture] || this.textures['none'];

        // 1. Оновлюємо палітру CSS-змінних
        Object.entries(themeData.vars).forEach(([prop, val]) => {
            root.style.setProperty(prop, val);
        });

        // 2. Оновлюємо текстурні шари
        root.style.setProperty('--skin-texture-pattern', textureData.pattern);
        root.style.setProperty('--skin-texture-size', textureData.size || 'auto');
        root.style.setProperty('--skin-texture-pos', textureData.position || '0 0');

        // 3. Оновлюємо параметри скла, рамок та світіння
        root.style.setProperty('--skin-glow-mult', this.state.ecoMode ? '0' : this.state.glowIntensity);
        root.style.setProperty('--skin-blur', this.state.ecoMode ? '0px' : `${this.state.glassBlur}px`);
        root.style.setProperty('--skin-border-width', `${this.state.borderWidth}px`);

        // 4. Синхронізуємо клас ECO-режиму та дата-атрибут теми
        if (document.body) {
            document.body.dataset.aetherTheme = this.state.theme;
            document.body.classList.toggle('eco-mode', Boolean(this.state.ecoMode));
        }

        this.updateUIControls();
        this.saveState();
    }

    /**
     * Публічні методи для швидкого керування з консолі або інших скриптів Етера
     */
    setTheme(themeKey) {
        if (!this.themes[themeKey]) return;
        this.state.theme = themeKey;
        this.applyAll();
    }

    setTexture(textureKey) {
        if (!this.textures[textureKey]) return;
        this.state.texture = textureKey;
        this.applyAll();
    }

    setGlow(intensity) {
        this.state.glowIntensity = parseFloat(intensity);
        this.applyAll();
    }

    setBlur(px) {
        this.state.glassBlur = parseInt(px, 10);
        this.applyAll();
    }

    setBorderWidth(px) {
        this.state.borderWidth = parseFloat(px);
        this.applyAll();
    }

    toggleEco(forceState) {
        this.state.ecoMode = typeof forceState === 'boolean' ? forceState : !this.state.ecoMode;
        this.applyAll();
    }

    /**
     * Відстежує перемикання глобального ECO-режиму в основному aether.html
     */
    observeEcoMode() {
        const attachObserver = () => {
            if (!document.body) return;
            const observer = new MutationObserver(() => {
                const isBodyEco = document.body.classList.contains('eco-mode') ||
                                  document.body.getAttribute('data-eco') === 'true';
                if (isBodyEco !== this.state.ecoMode) {
                    this.state.ecoMode = isBodyEco;
                    this.applyAll();
                }
            });
            observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-eco'] });
        };

        if (document.body) attachObserver();
        else document.addEventListener('DOMContentLoaded', attachObserver);
    }

    /**
     * Автоматично монтує компактний віджет вибору скінів у .top-bar (або у фіксований кут)
     */
    mountUI() {
        if (document.getElementById('aether-skin-widget')) return;

        const widget = document.createElement('div');
        widget.id = 'aether-skin-widget';
        widget.className = 'aether-skin-widget';

        const presetButtonsHTML = Object.entries(this.themes).map(([key, t]) => `
            <button type="button" class="skin-preset-btn" data-theme="${key}">
                <span>${t.badge}</span>
                <span>${t.name}</span>
            </button>
        `).join('');

        const textureOptionsHTML = Object.entries(this.textures).map(([key, tex]) => `
            <option value="${key}">${tex.name}</option>
        `).join('');

        widget.innerHTML = `
            <button type="button" class="aether-skin-trigger" id="aether-skin-btn" title="Налаштування візуального стилю Етера">
                <span id="aether-skin-badge">🌿</span>
                <span>SKIN</span>
            </button>

            <div class="aether-skin-popover" id="aether-skin-popover">
                <div>
                    <div class="skin-section-title"><span>Палітра Системи</span></div>
                    <div class="skin-preset-grid" id="skin-preset-list">
                        ${presetButtonsHTML}
                    </div>
                </div>

                <div>
                    <div class="skin-section-title"><span>Текстура Плашок (.glass-card)</span></div>
                    <select class="skin-select" id="skin-texture-select">
                        ${textureOptionsHTML}
                    </select>
                </div>

                <div>
                    <div class="skin-section-title">
                        <span>Неонове світіння (Glow)</span>
                        <span id="skin-glow-val">100%</span>
                    </div>
                    <input type="range" class="skin-range" id="skin-glow-range" min="0" max="2" step="0.1" value="${this.state.glowIntensity}">
                </div>

                <div>
                    <div class="skin-section-title">
                        <span>Розмиття скла (Blur)</span>
                        <span id="skin-blur-val">${this.state.glassBlur}px</span>
                    </div>
                    <input type="range" class="skin-range" id="skin-blur-range" min="0" max="24" step="2" value="${this.state.glassBlur}">
                </div>

                <div>
                    <div class="skin-section-title">
                        <span>Товщина рамки</span>
                        <span id="skin-border-val">${this.state.borderWidth}px</span>
                    </div>
                    <input type="range" class="skin-range" id="skin-border-range" min="0.5" max="2.5" step="0.5" value="${this.state.borderWidth}">
                </div>

                <div class="skin-eco-row">
                    <span>⚡ ECO-режим (без Blur/Glow)</span>
                    <input type="checkbox" id="skin-eco-check" ${this.state.ecoMode ? 'checked' : ''}>
                </div>
            </div>
        `;

        // Шукаємо слот або .top-bar для вбудовування
        const customSlot = document.getElementById('aether-skin-slot');
        const topBar = document.querySelector('.top-bar');

        if (customSlot) {
            customSlot.appendChild(widget);
        } else if (topBar) {
            topBar.appendChild(widget);
        } else {
            widget.style.position = 'fixed';
            widget.style.top = '12px';
            widget.style.right = '16px';
            document.body.appendChild(widget);
        }

        this.bindUIEvents(widget);
        this.updateUIControls();
    }

    bindUIEvents(widget) {
        const triggerBtn = widget.querySelector('#aether-skin-btn');
        const popover = widget.querySelector('#aether-skin-popover');

        triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            popover.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!widget.contains(e.target)) {
                popover.classList.remove('open');
            }
        });

        // Перемикання пресетів палітр
        widget.querySelectorAll('.skin-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setTheme(btn.dataset.theme);
            });
        });

        // Вибір текстури
        widget.querySelector('#skin-texture-select').addEventListener('change', (e) => {
            this.setTexture(e.target.value);
        });

        // Повзунок світіння
        widget.querySelector('#skin-glow-range').addEventListener('input', (e) => {
            this.setGlow(e.target.value);
        });

        // Повзунок розмиття
        widget.querySelector('#skin-blur-range').addEventListener('input', (e) => {
            this.setBlur(e.target.value);
        });

        // Повзунок рамки
        widget.querySelector('#skin-border-range').addEventListener('input', (e) => {
            this.setBorderWidth(e.target.value);
        });

        // Перемикач ECO
        widget.querySelector('#skin-eco-check').addEventListener('change', (e) => {
            this.toggleEco(e.target.checked);
        });
    }

    updateUIControls() {
        const widget = document.getElementById('aether-skin-widget');
        if (!widget) return;

        const currentTheme = this.themes[this.state.theme] || this.themes['bio-emerald'];
        const badgeEl = widget.querySelector('#aether-skin-badge');
        if (badgeEl) badgeEl.textContent = currentTheme.badge;

        widget.querySelectorAll('.skin-preset-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === this.state.theme);
        });

        const texSelect = widget.querySelector('#skin-texture-select');
        if (texSelect) texSelect.value = this.state.texture;

        const glowVal = widget.querySelector('#skin-glow-val');
        if (glowVal) glowVal.textContent = `${Math.round(this.state.glowIntensity * 100)}%`;

        const blurVal = widget.querySelector('#skin-blur-val');
        if (blurVal) blurVal.textContent = `${this.state.glassBlur}px`;

        const borderVal = widget.querySelector('#skin-border-val');
        if (borderVal) borderVal.textContent = `${this.state.borderWidth}px`;

        const ecoCheck = widget.querySelector('#skin-eco-check');
        if (ecoCheck) ecoCheck.checked = Boolean(this.state.ecoMode);
    }
}

// Автоматичний запуск та глобальний доступ через window.AetherSkins
window.AetherSkins = new AetherSkinEngine();