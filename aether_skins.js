/**
 * AETHER_v8.5_CORE_FINAL — Shader-Grade Visual & Material Engine
 * File: aether_skins.js
 * Features: Cursor Spotlight Tracking, SVG Fractal Noise Filters, Hull Geometry Morphing,
 *           Multi-stop Chromatic Borders, Animated Table Aura & BroadcastChannel Sync.
 */

class AetherAtelierEngine {
    constructor() {
        this.STORAGE_KEY = 'aether_v85_atelier_config';
        this.SYNC_CHANNEL = 'entropia_ark_sync_channel';

        // 6 Кінематографічних пресетів (глибокі багатошарові палітри)
        this.presets = {
            'irminsul-prime': {
                name: 'Irminsul Prime',
                subtitle: 'Біо-люмінесценція Древа',
                colors: ['#04140d', '#00ff88', '#00b8ff'],
                defaultTexture: 'bio-membrane',
                defaultHull: 'organic',
                vars: {
                    '--bg-panel': 'linear-gradient(155deg, rgba(6, 22, 15, 0.84) 0%, rgba(3, 10, 8, 0.94) 100%)',
                    '--bg-panel-solid': '#05120c',
                    '--neon-vine': '#00ff88',
                    '--neon-secondary': '#00d4ff',
                    '--neon-rgb': '0, 255, 136',
                    '--secondary-rgb': '0, 212, 255',
                    '--border-base': 'rgba(0, 255, 136, 0.24)',
                    '--border-hover': 'rgba(0, 255, 136, 0.75)',
                    '--text-main': '#ebfff5',
                    '--text-muted': '#6ca88c',
                    '--specular-top': 'rgba(180, 255, 220, 0.28)',
                    '--table-aura': 'radial-gradient(ellipse at 50% 50%, rgba(0, 255, 136, 0.16) 0%, rgba(0, 180, 255, 0.05) 45%, transparent 75%)'
                }
            },
            'ciel-astral': {
                name: 'Ciel Astral Core',
                subtitle: 'Квантовий горизонт Ковчега',
                colors: ['#050d1a', '#00f0ff', '#7000ff'],
                defaultTexture: 'hex-matrix',
                defaultHull: 'chamfer',
                vars: {
                    '--bg-panel': 'linear-gradient(155deg, rgba(8, 18, 34, 0.84) 0%, rgba(4, 8, 18, 0.94) 100%)',
                    '--bg-panel-solid': '#060e1a',
                    '--neon-vine': '#00f0ff',
                    '--neon-secondary': '#8a2be2',
                    '--neon-rgb': '0, 240, 255',
                    '--secondary-rgb': '138, 43, 226',
                    '--border-base': 'rgba(0, 240, 255, 0.26)',
                    '--border-hover': 'rgba(0, 240, 255, 0.82)',
                    '--text-main': '#eefcff',
                    '--text-muted': '#6c9eb8',
                    '--specular-top': 'rgba(180, 245, 255, 0.32)',
                    '--table-aura': 'radial-gradient(ellipse at 50% 50%, rgba(0, 240, 255, 0.16) 0%, rgba(138, 43, 226, 0.08) 50%, transparent 75%)'
                }
            },
            'gilded-sovereign': {
                name: 'Gilded Sovereign',
                subtitle: 'Імперський онікс та золото',
                colors: ['#120f0a', '#ffcc4d', '#ff6b00'],
                defaultTexture: 'anodized-grain',
                defaultHull: 'runic',
                vars: {
                    '--bg-panel': 'linear-gradient(155deg, rgba(24, 20, 14, 0.88) 0%, rgba(10, 8, 6, 0.95) 100%)',
                    '--bg-panel-solid': '#120f0a',
                    '--neon-vine': '#ffcc4d',
                    '--neon-secondary': '#ff7b00',
                    '--neon-rgb': '255, 204, 77',
                    '--secondary-rgb': '255, 123, 0',
                    '--border-base': 'rgba(255, 204, 77, 0.28)',
                    '--border-hover': 'rgba(255, 215, 110, 0.85)',
                    '--text-main': '#fff9eb',
                    '--text-muted': '#b59b6d',
                    '--specular-top': 'rgba(255, 235, 180, 0.3)',
                    '--table-aura': 'radial-gradient(ellipse at 50% 50%, rgba(255, 204, 77, 0.14) 0%, rgba(255, 123, 0, 0.05) 50%, transparent 75%)'
                }
            },
            'blood-monolith': {
                name: 'Blood Monolith',
                subtitle: 'Багряний протокол тривоги',
                colors: ['#170509', '#ff1e42', '#ff7700'],
                defaultTexture: 'topography',
                defaultHull: 'chamfer',
                vars: {
                    '--bg-panel': 'linear-gradient(155deg, rgba(28, 7, 12, 0.86) 0%, rgba(12, 3, 5, 0.95) 100%)',
                    '--bg-panel-solid': '#160609',
                    '--neon-vine': '#ff1e42',
                    '--neon-secondary': '#ff0055',
                    '--neon-rgb': '255, 30, 66',
                    '--secondary-rgb': '255, 0, 85',
                    '--border-base': 'rgba(255, 30, 66, 0.28)',
                    '--border-hover': 'rgba(255, 50, 85, 0.85)',
                    '--text-main': '#ffedf0',
                    '--text-muted': '#b56d7a',
                    '--specular-top': 'rgba(255, 180, 195, 0.26)',
                    '--table-aura': 'radial-gradient(ellipse at 50% 50%, rgba(255, 30, 66, 0.18) 0%, rgba(140, 0, 30, 0.08) 50%, transparent 75%)'
                }
            },
            'obsidian-phantom': {
                name: 'Obsidian Phantom',
                subtitle: 'Стелс-карбон та титан',
                colors: ['#0a0b0e', '#e2e8f0', '#64748b'],
                defaultTexture: 'carbon-weave',
                defaultHull: 'sleek',
                vars: {
                    '--bg-panel': 'linear-gradient(160deg, rgba(18, 20, 26, 0.88) 0%, rgba(9, 10, 13, 0.96) 100%)',
                    '--bg-panel-solid': '#0c0d10',
                    '--neon-vine': '#e2e8f0',
                    '--neon-secondary': '#94a3b8',
                    '--neon-rgb': '226, 232, 240',
                    '--secondary-rgb': '148, 163, 184',
                    '--border-base': 'rgba(226, 232, 240, 0.18)',
                    '--border-hover': 'rgba(255, 255, 255, 0.7)',
                    '--text-main': '#f8fafc',
                    '--text-muted': '#8492a6',
                    '--specular-top': 'rgba(255, 255, 255, 0.22)',
                    '--table-aura': 'radial-gradient(ellipse at 50% 50%, rgba(226, 232, 240, 0.09) 0%, transparent 70%)'
                }
            },
            'void-singularity': {
                name: 'Void Singularity',
                subtitle: 'Викривлення темної матерії',
                colors: ['#0c0517', '#c04dff', '#00ffcc'],
                defaultTexture: 'bio-membrane',
                defaultHull: 'runic',
                vars: {
                    '--bg-panel': 'linear-gradient(155deg, rgba(19, 8, 34, 0.85) 0%, rgba(8, 3, 15, 0.95) 100%)',
                    '--bg-panel-solid': '#0b0414',
                    '--neon-vine': '#c04dff',
                    '--neon-secondary': '#00ffcc',
                    '--neon-rgb': '192, 77, 255',
                    '--secondary-rgb': '0, 255, 204',
                    '--border-base': 'rgba(192, 77, 255, 0.26)',
                    '--border-hover': 'rgba(192, 77, 255, 0.82)',
                    '--text-main': '#f7edff',
                    '--text-muted': '#9a75b8',
                    '--specular-top': 'rgba(230, 190, 255, 0.28)',
                    '--table-aura': 'radial-gradient(ellipse at 50% 50%, rgba(192, 77, 255, 0.17) 0%, rgba(0, 255, 204, 0.06) 50%, transparent 75%)'
                }
            }
        };

        // Форми геометрії плашок (Hull Geometry)
        this.hulls = {
            'sleek': { name: 'Deep Glass', desc: 'Плавне оптичне скло' },
            'chamfer': { name: 'Cyber Chamfer', desc: 'Тактичні скошені кути' },
            'runic': { name: 'Runic Artifact', desc: 'Подвійна рамка з вузлами' },
            'organic': { name: 'Bio-Symbiotic', desc: 'Жива асиметрична форма' }
        };

        // Поверхневі матеріали та мікро-текстури
        this.textures = {
            'anodized-grain': { name: 'Анодований титан (Noise)' },
            'hex-matrix': { name: 'Гексагональна нано-броня' },
            'bio-membrane': { name: 'Органічні синапси Ірмінсуля' },
            'carbon-weave': { name: 'Переплетений стелс-карбон' },
            'topography': { name: 'Ізолінії гравітації' },
            'clean-crystal': { name: 'Чистий монокристал' }
        };

        this.state = {
            preset: 'irminsul-prime',
            hull: 'runic',
            texture: 'bio-membrane',
            bloom: 1.15,        // Інтенсивність світіння (0.0 - 2.2)
            refraction: 16,     // Глибина розмиття backdrop-filter (0 - 32px)
            spotlight: true,    // Реактивне підсвічування курсором
            breathing: true,    // Пульсація столу та кутових гліфів
            ecoMode: false
        };

        this.init();
    }

    init() {
        this.loadState();
        this.injectSVGFilters();
        this.injectEngineStyles();
        this.initSpotlightTracker();
        this.initBroadcastSync();
        this.observeEcoMode();
        this.applyAll();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.mountHUD());
        } else {
            this.mountHUD();
        }
    }

    loadState() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) this.state = { ...this.state, ...JSON.parse(raw) };
        } catch (e) {}
    }

    saveState() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
        } catch (e) {}
    }

    /**
     * Вбудовує невидимий SVG з фрактальним шумом та паттернами для преміальної текстури скла
     */
    injectSVGFilters() {
        if (document.getElementById('aether-atelier-svg-defs')) return;
        const svgContainer = document.createElement('div');
        svgContainer.id = 'aether-atelier-svg-defs';
        svgContainer.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;z-index:-1;';
        svgContainer.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <!-- Фрактальне зерно металу/скла -->
                    <filter id="aether-noise-filter">
                        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/>
                        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.055 0"/>
                    </filter>
                </defs>
            </svg>
        `;
        document.body ? document.body.appendChild(svgContainer) : document.addEventListener('DOMContentLoaded', () => document.body.appendChild(svgContainer));
    }

    /**
     * Головний шейдерний лист стилів
     */
    injectEngineStyles() {
        if (document.getElementById('aether-atelier-styles')) return;

        const style = document.createElement('style');
        style.id = 'aether-atelier-styles';
        style.textContent = `
            :root {
                --skin-blur: 16px;
                --skin-bloom: 1.15;
                --mouse-x: 50%;
                --mouse-y: 50%;
            }

            /* --- БАЗОВИЙ МАТЕРІАЛ ПЛАШОК (.glass-card, .top-bar) --- */
            .glass-card, .top-bar {
                position: relative;
                background: var(--bg-panel) !important;
                backdrop-filter: blur(var(--skin-blur)) saturate(145%) !important;
                -webkit-backdrop-filter: blur(var(--skin-blur)) saturate(145%) !important;
                border: 1px solid var(--border-base) !important;
                color: var(--text-main);
                box-shadow: 
                    0 14px 38px -6px rgba(0, 0, 0, 0.78),
                    0 0 calc(22px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.16),
                    inset 0 1px 0 0 var(--specular-top),
                    inset 0 0 calc(18px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.07) !important;
                transition: 
                    border-color 0.35s cubic-bezier(0.16, 1, 0.3, 1),
                    box-shadow 0.35s cubic-bezier(0.16, 1, 0.3, 1),
                    transform 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
            }

            .glass-card:hover {
                border-color: var(--border-hover) !important;
                box-shadow: 
                    0 18px 46px -4px rgba(0, 0, 0, 0.85),
                    0 0 calc(32px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.28),
                    inset 0 1px 0 0 rgba(255, 255, 255, 0.42),
                    inset 0 0 calc(24px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.14) !important;
            }

            /* --- ТЕКСТУРНИЙ ТА SPOTLIGHT ШАР (::before) --- */
            .glass-card::before {
                content: "";
                position: absolute;
                inset: 0;
                border-radius: inherit;
                pointer-events: none;
                z-index: 0;
                opacity: 0.9;
                transition: opacity 0.3s ease;
            }

            /* Реактивний Spotlight під курсором миші */
            body[data-aether-spotlight="true"]:not(.eco-mode) .glass-card::after {
                content: "";
                position: absolute;
                inset: 0;
                border-radius: inherit;
                pointer-events: none;
                z-index: 1;
                background: radial-gradient(
                    380px circle at var(--card-mouse-x, -500px) var(--card-mouse-y, -500px),
                    rgba(var(--neon-rgb), calc(0.16 * var(--skin-bloom))),
                    rgba(var(--secondary-rgb), 0.05) 40%,
                    transparent 70%
                );
                mix-blend-mode: screen;
            }

            /* --- ТЕКСТУРНІ ПАТТЕРНИ --- */
            body[data-aether-texture="anodized-grain"] .glass-card::before {
                background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 0),
                                  radial-gradient(rgba(var(--neon-rgb), 0.04) 1px, transparent 0);
                background-size: 6px 6px;
                background-position: 0 0, 3px 3px;
            }

            body[data-aether-texture="hex-matrix"] .glass-card::before {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='56' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.045'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
                background-size: 28px 49px;
            }

            body[data-aether-texture="bio-membrane"] .glass-card::before {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'%3E%3Cg fill='none' stroke='%23ffffff' stroke-opacity='0.045' stroke-width='1.1'%3E%3Cpath d='M0 80 C 40 50, 60 110, 100 80 C 130 55, 145 95, 160 80'/%3E%3Cpath d='M80 0 C 50 40, 110 60, 80 100 C 55 130, 95 145, 80 160'/%3E%3Ccircle cx='100' cy='80' r='2.5' fill='%23ffffff' fill-opacity='0.08'/%3E%3Ccircle cx='80' cy='100' r='2' fill='%23ffffff' fill-opacity='0.08'/%3E%3C/g%3E%3C/svg%3E");
                background-size: 140px 140px;
            }

            body[data-aether-texture="carbon-weave"] .glass-card::before {
                background: 
                    linear-gradient(27deg, rgba(255,255,255,0.03) 5px, transparent 5px) 0 5px,
                    linear-gradient(207deg, rgba(255,255,255,0.03) 5px, transparent 5px) 10px 0px,
                    linear-gradient(27deg, rgba(255,255,255,0.02) 5px, transparent 5px) 0px 10px,
                    linear-gradient(207deg, rgba(255,255,255,0.02) 5px, transparent 5px) 10px 5px;
                background-size: 20px 20px;
            }

            body[data-aether-texture="topography"] .glass-card::before {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'%3E%3Cg fill='none' stroke='%23ffffff' stroke-opacity='0.04' stroke-width='1'%3E%3Cpath d='M-20 40 Q 40 10 90 50 T 200 30'/%3E%3Cpath d='M-20 90 Q 50 60 110 100 T 200 85'/%3E%3Cpath d='M-20 140 Q 60 115 120 155 T 200 140'/%3E%3C/g%3E%3C/svg%3E");
                background-size: 180px 180px;
            }

            /* --- ГЕОМЕТРІЯ КОРПУСУ ПЛАШОК (HULL ARCHITECTURE) --- */
            /* 1. Sleek Glass */
            body[data-aether-hull="sleek"] .glass-card {
                border-radius: 14px !important;
            }

            /* 2. Cyber Chamfer (скошені тактичні кути) */
            body[data-aether-hull="chamfer"] .glass-card {
                border-radius: 3px !important;
                clip-path: polygon(
                    0 12px, 12px 0, 
                    calc(100% - 12px) 0, 100% 12px, 
                    100% calc(100% - 12px), calc(100% - 12px) 100%, 
                    12px 100%, 0 calc(100% - 12px)
                );
            }

            /* 3. Runic Artifact (подвійний контур і кутові дужки) */
            body[data-aether-hull="runic"] .glass-card {
                border-radius: 8px !important;
                outline: 1px solid rgba(var(--neon-rgb), 0.14);
                outline-offset: -5px;
                background-image: 
                    linear-gradient(to right, var(--neon-vine) 2px, transparent 2px),
                    linear-gradient(to bottom, var(--neon-vine) 2px, transparent 2px),
                    linear-gradient(to left, var(--neon-vine) 2px, transparent 2px),
                    linear-gradient(to top, var(--neon-vine) 2px, transparent 2px),
                    var(--bg-panel) !important;
                background-size: 12px 12px, 12px 12px, 12px 12px, 12px 12px, 100% 100% !important;
                background-position: top left, top left, bottom right, bottom right, center !important;
                background-repeat: no-repeat !important;
            }

            /* 4. Bio-Symbiotic (жива асиметрія) */
            body[data-aether-hull="organic"] .glass-card {
                border-radius: 20px 6px 20px 6px !important;
            }

            /* --- ІГРОВИЙ СТІЛ ТА ДИХАННЯ АУРИ --- */
            .game-table-oval {
                background-image: var(--table-aura) !important;
                border: 1px solid var(--border-base) !important;
                box-shadow: 
                    0 0 calc(50px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.18),
                    inset 0 0 calc(45px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.15) !important;
                transition: box-shadow 0.5s ease, border-color 0.5s ease !important;
            }

            @keyframes aetherAuraPulse {
                0%, 100% {
                    box-shadow: 
                        0 0 calc(45px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.15),
                        inset 0 0 calc(35px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.12);
                }
                50% {
                    box-shadow: 
                        0 0 calc(70px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.28),
                        inset 0 0 calc(55px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.22);
                }
            }

            body[data-aether-breathing="true"]:not(.eco-mode) .game-table-oval {
                animation: aetherAuraPulse 6s ease-in-out infinite !important;
            }

            /* --- СУМІСНІСТЬ ІЗ ECO-РЕЖИМОМ --- */
            body.eco-mode .glass-card,
            body.eco-mode .top-bar,
            body.eco-mode .game-table-oval,
            body[data-eco="true"] .glass-card {
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                background: var(--bg-panel-solid) !important;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.8) !important;
                animation: none !important;
                transition: none !important;
            }
            body.eco-mode .glass-card::before,
            body.eco-mode .glass-card::after {
                display: none !important;
            }

            /* ==========================================================
               ПРЕМІУМ HUD-ДОК КАСТОМІЗАЦІЇ (ATELIER DRAWER)
               ========================================================== */
            .aether-atelier-mount {
                position: relative;
                display: inline-flex;
                align-items: center;
                margin-left: 10px;
                z-index: 10000;
                font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
            }

            .atelier-orb-btn {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 6px 14px;
                border-radius: 999px;
                background: linear-gradient(135deg, rgba(var(--neon-rgb), 0.16), rgba(0, 0, 0, 0.65));
                border: 1px solid var(--border-base);
                color: var(--text-main);
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1.2px;
                text-transform: uppercase;
                cursor: pointer;
                box-shadow: 0 0 15px rgba(var(--neon-rgb), 0.2), inset 0 1px 0 var(--specular-top);
                transition: all 0.25s ease;
            }

            .atelier-orb-btn:hover {
                border-color: var(--neon-vine);
                box-shadow: 0 0 22px rgba(var(--neon-rgb), 0.45);
                transform: translateY(-1px);
            }

            .atelier-orb-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: var(--neon-vine);
                box-shadow: 0 0 10px var(--neon-vine);
            }

            .atelier-drawer {
                position: absolute;
                top: calc(100% + 12px);
                right: 0;
                width: 350px;
                padding: 18px;
                border-radius: 16px;
                background: linear-gradient(165deg, rgba(12, 16, 22, 0.95) 0%, rgba(5, 7, 10, 0.98) 100%);
                backdrop-filter: blur(24px);
                -webkit-backdrop-filter: blur(24px);
                border: 1px solid var(--border-hover);
                box-shadow: 
                    0 24px 60px rgba(0, 0, 0, 0.92),
                    0 0 35px rgba(var(--neon-rgb), 0.22),
                    inset 0 1px 0 rgba(255, 255, 255, 0.2);
                color: var(--text-main);
                display: none;
                flex-direction: column;
                gap: 16px;
                transform-origin: top right;
                animation: atelierSlideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
            }

            @keyframes atelierSlideIn {
                from { opacity: 0; transform: scale(0.95) translateY(-8px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }

            .atelier-drawer.open {
                display: flex;
            }

            .atelier-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                padding-bottom: 10px;
            }

            .atelier-title {
                font-size: 12px;
                font-weight: 800;
                letter-spacing: 1.8px;
                text-transform: uppercase;
                background: linear-gradient(90deg, var(--text-main), var(--neon-vine));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }

            .atelier-sub {
                font-size: 10px;
                color: var(--text-muted);
                letter-spacing: 0.5px;
            }

            .atelier-label {
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 1.4px;
                color: var(--text-muted);
                margin-bottom: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            /* Візуальні картки пресетів */
            .atelier-preset-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }

            .atelier-preset-card {
                position: relative;
                display: flex;
                flex-direction: column;
                gap: 5px;
                padding: 9px 10px;
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.025);
                border: 1px solid rgba(255, 255, 255, 0.08);
                cursor: pointer;
                text-align: left;
                transition: all 0.2s ease;
                overflow: hidden;
            }

            .atelier-preset-card:hover {
                background: rgba(255, 255, 255, 0.06);
                border-color: rgba(var(--neon-rgb), 0.45);
                transform: translateY(-1px);
            }

            .atelier-preset-card.active {
                background: linear-gradient(135deg, rgba(var(--neon-rgb), 0.18), rgba(0, 0, 0, 0.5));
                border-color: var(--neon-vine);
                box-shadow: 0 0 16px rgba(var(--neon-rgb), 0.25);
            }

            .preset-swatches {
                display: flex;
                align-items: center;
                gap: 5px;
            }

            .preset-dot {
                width: 11px;
                height: 11px;
                border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.35);
            }

            .preset-card-title {
                font-size: 11px;
                font-weight: 700;
                color: #fff;
            }

            .preset-card-desc {
                font-size: 9.5px;
                color: rgba(255, 255, 255, 0.55);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            /* Пігулки геометрії (Hull Selector) */
            .atelier-hull-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 6px;
            }

            .atelier-pill {
                padding: 7px 4px;
                border-radius: 8px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: var(--text-main);
                font-size: 10px;
                font-weight: 600;
                text-align: center;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .atelier-pill:hover {
                border-color: rgba(var(--neon-rgb), 0.5);
            }

            .atelier-pill.active {
                background: rgba(var(--neon-rgb), 0.2);
                border-color: var(--neon-vine);
                color: #fff;
                box-shadow: 0 0 12px rgba(var(--neon-rgb), 0.25);
            }

            /* Текстурні чіпи */
            .atelier-tex-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px;
            }

            /* Кастомні неонові слайдери */
            .atelier-slider-row {
                display: flex;
                flex-direction: column;
                gap: 5px;
            }

            .atelier-range {
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 5px;
                border-radius: 99px;
                background: rgba(255, 255, 255, 0.12);
                outline: none;
                cursor: pointer;
            }

            .atelier-range::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: var(--neon-vine);
                box-shadow: 0 0 10px var(--neon-vine);
                border: 2px solid #fff;
                cursor: pointer;
                transition: transform 0.15s ease;
            }

            .atelier-range::-webkit-slider-thumb:hover {
                transform: scale(1.2);
            }

            /* Перемикачі FX */
            .atelier-toggles {
                display: grid;
                grid-template-columns: 1fr 1fr 1fr;
                gap: 6px;
                padding-top: 8px;
                border-top: 1px solid rgba(255, 255, 255, 0.08);
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Живий трекінг курсора по картках .glass-card (Spotlight Shader Effect)
     */
    initSpotlightTracker() {
        let rafPending = false;
        document.addEventListener('mousemove', (e) => {
            if (this.state.ecoMode || !this.state.spotlight || rafPending) return;
            rafPending = true;
            requestAnimationFrame(() => {
                const cards = document.querySelectorAll('.glass-card');
                for (let i = 0; i < cards.length; i++) {
                    const rect = cards[i].getBoundingClientRect();
                    // Оновлюємо координати лише якщо курсор поблизу картки
                    if (
                        e.clientX >= rect.left - 120 &&
                        e.clientX <= rect.right + 120 &&
                        e.clientY >= rect.top - 120 &&
                        e.clientY <= rect.bottom + 120
                    ) {
                        cards[i].style.setProperty('--card-mouse-x', `${e.clientX - rect.left}px`);
                        cards[i].style.setProperty('--card-mouse-y', `${e.clientY - rect.top}px`);
                    }
                }
                rafPending = false;
            });
        }, { passive: true });
    }

    /**
     * Підтримка синхронізації теми від ГМа через існуючий BroadcastChannel Ентропії
     */
    initBroadcastSync() {
        try {
            this.channel = new BroadcastChannel(this.SYNC_CHANNEL);
            this.channel.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'AETHER_SKIN_FORCE_SYNC') {
                    this.state = { ...this.state, ...event.data.payload };
                    this.applyAll();
                }
            });
        } catch (e) {}
    }

    /**
     * Дозволяє ГМу транслювати поточний скін усім гравцям за столом
     */
    broadcastCurrentSkinToPlayers() {
        if (this.channel) {
            this.channel.postMessage({
                type: 'AETHER_SKIN_FORCE_SYNC',
                payload: this.state
            });
        }
    }

    /**
     * Застосовує всі параметри до DOM
     */
    applyAll() {
        const root = document.documentElement;
        const preset = this.presets[this.state.preset] || this.presets['irminsul-prime'];

        // 1. Встановлюємо CSS-змінні палітри
        Object.entries(preset.vars).forEach(([key, val]) => {
            root.style.setProperty(key, val);
        });

        // 2. Встановлюємо оптичні параметри
        root.style.setProperty('--skin-bloom', this.state.ecoMode ? '0' : this.state.bloom);
        root.style.setProperty('--skin-blur', this.state.ecoMode ? '0px' : `${this.state.refraction}px`);

        // 3. Встановлюємо дата-атрибути для шейдерів на <body>
        if (document.body) {
            document.body.dataset.aetherPreset = this.state.preset;
            document.body.dataset.aetherHull = this.state.hull;
            document.body.dataset.aetherTexture = this.state.texture;
            document.body.dataset.aetherSpotlight = String(Boolean(this.state.spotlight));
            document.body.dataset.aetherBreathing = String(Boolean(this.state.breathing));
            document.body.classList.toggle('eco-mode', Boolean(this.state.ecoMode));
        }

        this.syncHUDState();
        this.saveState();
    }

    /**
     * Публічне API для керування з коду гри / подій Рафаїла
     */
    setPreset(presetKey, applyRecommendedGeometry = true) {
        const p = this.presets[presetKey];
        if (!p) return;
        this.state.preset = presetKey;
        if (applyRecommendedGeometry) {
            this.state.texture = p.defaultTexture;
            this.state.hull = p.defaultHull;
        }
        this.applyAll();
    }

    setHull(hullKey) {
        if (!this.hulls[hullKey]) return;
        this.state.hull = hullKey;
        this.applyAll();
    }

    setTexture(texKey) {
        if (!this.textures[texKey]) return;
        this.state.texture = texKey;
        this.applyAll();
    }

    observeEcoMode() {
        const attach = () => {
            if (!document.body) return;
            const obs = new MutationObserver(() => {
                const isEco = document.body.classList.contains('eco-mode') || document.body.getAttribute('data-eco') === 'true';
                if (isEco !== this.state.ecoMode) {
                    this.state.ecoMode = isEco;
                    this.applyAll();
                }
            });
            obs.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-eco'] });
        };
        document.body ? attach() : document.addEventListener('DOMContentLoaded', attach);
    }

    /**
     * Монтує HUD-док у .top-bar або #aether-skin-slot
     */
    mountHUD() {
        if (document.getElementById('aether-atelier-mount')) return;

        const mount = document.createElement('div');
        mount.id = 'aether-atelier-mount';
        mount.className = 'aether-atelier-mount';

        const presetCardsHTML = Object.entries(this.presets).map(([key, p]) => `
            <button type="button" class="atelier-preset-card" data-preset="${key}">
                <div class="preset-swatches">
                    <span class="preset-dot" style="background:${p.colors[0]}"></span>
                    <span class="preset-dot" style="background:${p.colors[1]};box-shadow:0 0 6px ${p.colors[1]}"></span>
                    <span class="preset-dot" style="background:${p.colors[2]}"></span>
                </div>
                <div class="preset-card-title">${p.name}</div>
                <div class="preset-card-desc">${p.subtitle}</div>
            </button>
        `).join('');

        const hullPillsHTML = Object.entries(this.hulls).map(([key, h]) => `
            <button type="button" class="atelier-pill" data-hull="${key}" title="${h.desc}">
                ${h.name.split(' ')[1] || h.name}
            </button>
        `).join('');

        const texPillsHTML = Object.entries(this.textures).map(([key, t]) => `
            <button type="button" class="atelier-pill" data-tex="${key}">
                ${t.name}
            </button>
        `).join('');

        mount.innerHTML = `
            <button type="button" class="atelier-orb-btn" id="atelier-trigger-btn">
                <span class="atelier-orb-dot"></span>
                <span>ATELIER</span>
            </button>

            <div class="atelier-drawer" id="atelier-drawer">
                <div class="atelier-header">
                    <div>
                        <div class="atelier-title">Aether Visual Atelier</div>
                        <div class="atelier-sub">Shader & Hull Architecture v8.5</div>
                    </div>
                    <button type="button" class="atelier-pill" id="atelier-broadcast-btn" title="Синхронізувати цей скін усім гравцям за столом" style="padding:5px 9px;">
                        📡 GM Sync
                    </button>
                </div>

                <div>
                    <div class="atelier-label"><span>Хроматичні Матриці</span></div>
                    <div class="atelier-preset-grid">
                        ${presetCardsHTML}
                    </div>
                </div>

                <div>
                    <div class="atelier-label"><span>Геометрія Корпусу (Hull)</span></div>
                    <div class="atelier-hull-grid">
                        ${hullPillsHTML}
                    </div>
                </div>

                <div>
                    <div class="atelier-label"><span>Мікро-структура Поверхні</span></div>
                    <div class="atelier-tex-grid">
                        ${texPillsHTML}
                    </div>
                </div>

                <div class="atelier-slider-row">
                    <div class="atelier-label">
                        <span>Енергетичний Bloom</span>
                        <span id="atelier-bloom-val">115%</span>
                    </div>
                    <input type="range" class="atelier-range" id="atelier-bloom-slider" min="0" max="2.2" step="0.05" value="${this.state.bloom}">
                </div>

                <div class="atelier-slider-row">
                    <div class="atelier-label">
                        <span>Оптична Рефракція (Blur)</span>
                        <span id="atelier-blur-val">${this.state.refraction}px</span>
                    </div>
                    <input type="range" class="atelier-range" id="atelier-blur-slider" min="0" max="32" step="2" value="${this.state.refraction}">
                </div>

                <div class="atelier-toggles">
                    <button type="button" class="atelier-pill" id="atelier-toggle-spotlight">🔦 Spotlight</button>
                    <button type="button" class="atelier-pill" id="atelier-toggle-breathing">🌊 Дихання</button>
                    <button type="button" class="atelier-pill" id="atelier-toggle-eco">⚡ ECO</button>
                </div>
            </div>
        `;

        const slot = document.getElementById('aether-skin-slot') || document.querySelector('.top-bar');
        if (slot) {
            slot.appendChild(mount);
        } else {
            mount.style.position = 'fixed';
            mount.style.top = '14px';
            mount.style.right = '18px';
            document.body.appendChild(mount);
        }

        this.bindHUDEvents(mount);
        this.syncHUDState();
    }

    bindHUDEvents(mount) {
        const trigger = mount.querySelector('#atelier-trigger-btn');
        const drawer = mount.querySelector('#atelier-drawer');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            drawer.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!mount.contains(e.target)) drawer.classList.remove('open');
        });

        // Картки пресетів
        mount.querySelectorAll('[data-preset]').forEach(btn => {
            btn.addEventListener('click', () => this.setPreset(btn.dataset.preset, true));
        });

        // Геометрія корпусу
        mount.querySelectorAll('[data-hull]').forEach(btn => {
            btn.addEventListener('click', () => this.setHull(btn.dataset.hull));
        });

        // Текстури
        mount.querySelectorAll('[data-tex]').forEach(btn => {
            btn.addEventListener('click', () => this.setTexture(btn.dataset.tex));
        });

        // Слайдери
        mount.querySelector('#atelier-bloom-slider').addEventListener('input', (e) => {
            this.state.bloom = parseFloat(e.target.value);
            this.applyAll();
        });

        mount.querySelector('#atelier-blur-slider').addEventListener('input', (e) => {
            this.state.refraction = parseInt(e.target.value, 10);
            this.applyAll();
        });

        // Тогли ефектів
        mount.querySelector('#atelier-toggle-spotlight').addEventListener('click', () => {
            this.state.spotlight = !this.state.spotlight;
            this.applyAll();
        });

        mount.querySelector('#atelier-toggle-breathing').addEventListener('click', () => {
            this.state.breathing = !this.state.breathing;
            this.applyAll();
        });

        mount.querySelector('#atelier-toggle-eco').addEventListener('click', () => {
            this.state.ecoMode = !this.state.ecoMode;
            this.applyAll();
        });

        // Кнопка GM Sync
        const syncBtn = mount.querySelector('#atelier-broadcast-btn');
        syncBtn.addEventListener('click', () => {
            this.broadcastCurrentSkinToPlayers();
            const origText = syncBtn.textContent;
            syncBtn.textContent = '✓ Відправлено';
            setTimeout(() => { syncBtn.textContent = origText; }, 1400);
        });
    }

    syncHUDState() {
        const mount = document.getElementById('aether-atelier-mount');
        if (!mount) return;

        mount.querySelectorAll('[data-preset]').forEach(el => {
            el.classList.toggle('active', el.dataset.preset === this.state.preset);
        });

        mount.querySelectorAll('[data-hull]').forEach(el => {
            el.classList.toggle('active', el.dataset.hull === this.state.hull);
        });

        mount.querySelectorAll('[data-tex]').forEach(el => {
            el.classList.toggle('active', el.dataset.tex === this.state.texture);
        });

        const bloomVal = mount.querySelector('#atelier-bloom-val');
        if (bloomVal) bloomVal.textContent = `${Math.round(this.state.bloom * 100)}%`;

        const blurVal = mount.querySelector('#atelier-blur-val');
        if (blurVal) blurVal.textContent = `${this.state.refraction}px`;

        mount.querySelector('#atelier-toggle-spotlight')?.classList.toggle('active', Boolean(this.state.spotlight));
        mount.querySelector('#atelier-toggle-breathing')?.classList.toggle('active', Boolean(this.state.breathing));
        mount.querySelector('#atelier-toggle-eco')?.classList.toggle('active', Boolean(this.state.ecoMode));
    }
}

// Ініціалізація та глобальний експорт
window.AetherSkins = new AetherAtelierEngine();