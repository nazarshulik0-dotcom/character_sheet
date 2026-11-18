/**
 * AETHER_v8.5_CORE_FINAL — Authentic Reference Materials, Locked-Seed Flora & 7 Reference Button Styles
 * File: aether_skins.js
 *
 * ФІНАЛЬНИЙ АПДЕЙТ:
 * - Усі фішки, 6 текстур, 7 стилів кнопок, 19 палітр та фіксовані ліани збережено 1-в-1.
 * - Відкрито шлях для всього Листа Персонажів (index.html) + синхронізація між index.html та aether.html (BroadcastChannel + postMessage + localStorage).
 * - Кнопка «ATELIER STUDIO» відображається ТІЛЬКИ у Майстра (GM-mode), а гравці автоматично бачать застосований візуал.
 */

class AetherAuthenticStudio {
    constructor() {
        this.STORAGE_STATE_KEY = 'aether_v85_authentic_state';
        this.STORAGE_PRESETS_KEY = 'aether_v85_authentic_presets';
        this.SYNC_CHANNEL = 'entropia_ark_sync_channel';

        // 1. СПРАВЖНІ ФІЗИЧНІ МАТЕРІАЛИ ТА ТЕКСТУРИ З ЧОТИРЬОХ РЕФЕРЕНСІВ
        this.materials = {
            'marble-gold-stone': {
                name: 'Stone & Gold Veins (Мармур)',
                ref: 'Референс SAGE/STONE — Чорний камінь із золотими прожилками',
                desc: 'Глибокий колотий сланець і мармур, пронизаний тонкими золотистими мінеральними жилами'
            },
            'emerald-water-caustics': {
                name: 'Emerald Marble & Water (Смарагд)',
                ref: 'Референс EMERALD — Смарагдовий камінь і сонячні відблиски на воді',
                desc: 'Поєднання темного малахітового мармуру з м’якими водяними каустиками по краях'
            },
            'sage-sand-shadows': {
                name: 'Sage & Sand Leaf Shadows (Травертин)',
                ref: 'Референс SAGE/SAND — Матовий пісковик і тіні оливкового листя',
                desc: 'Теплий природний вапняк і штукатурка з м’якими косими променями світла та тінями гілок'
            },
            'ruins-suede-parchment': {
                name: 'Ruins in the Woods (Замша & Туман)',
                ref: 'Референс RUINS IN THE WOODS — Оксамитова замша й ботанічне гравіювання',
                desc: 'Плямиста зістарена замша в стилі Dark Souls із тонкими золотими гілочками та місячним орнаментом'
            },
            'draped-velvet-folds': {
                name: 'Draped Velvet & Silk (Оксамит)',
                ref: 'Референс 10 SHADES OF BLACK / JEWEL TONES — Складки оксамиту',
                desc: 'М’які горизонтальні переливи важкої оксамитової тканини з глибоким поглинанням світла'
            },
            'flint-woven-linen': {
                name: 'Flint Woven Linen (Полотно #08)',
                ref: 'Референс SHADES OF BLACK #08 FLINT — Фактурне ткане полотно',
                desc: 'Тактильне переплетення грубої матової нитки з благородним мінеральним відтінком'
            }
        };

        // 1.5. 7 СТИЛІВ КНОПОК ТА ІНТЕРАКТИВНИХ ЕЛЕМЕНТІВ ІЗ РЕФЕРЕНСІВ
        this.buttonStyles = {
            'jewel-brass': {
                name: '👑 Jewel Brass & Silk',
                desc: 'Класичні благородні кнопки з м’яким внутрішнім переливом (Ref 6, 14)'
            },
            'sunset-orb': {
                name: '🔮 Sunset Spherical Lens',
                desc: 'Опуклі сферичні капсули та лінзи з верхнім сонячним бліком (Ref 9, 10, 11)'
            },
            'liquid-chip': {
                name: '💧 Liquid Glass Chip',
                desc: 'Прозорі акрилові фішки з подвійним райдужним контуром (Ref 12)'
            },
            'bento-pill': {
                name: '🍱 Antariksa Bento Pill',
                desc: 'Контрастні залиті пігулки з чіткою архітектурною тінню-сходинкою (Ref 5)'
            },
            'forest-filigree': {
                name: '⚜️ Lanm Gold Filigree',
                desc: 'Витончена подвійна ювелірна рамка з тонкими кутовими вузлами (Ref 7)'
            },
            'crystal-gem': {
                name: '💎 Biolume Crystal Gem',
                desc: 'Грановані шестикутні кристали у втиснутих неоморфних слотах (Ref 13)'
            },
            'luxury-bevel': {
                name: '📐 Luxury Satin Bevel',
                desc: 'Гострі скошені кути з діагональним металевим бліком і золотим кантом (Ref 8)'
            }
        };

        // 2. КОЛЕКЦІЯ АВТЕНТИЧНИХ ПАЛІТР ТОЧНО ЗА ТВОЇМИ 4 ФОТО-РЕФЕРЕНСАМИ
        this.palettes = {
            'ref-sage': {
                name: 'Sage (Оливкова Шавлія)', group: 'Earth & Stone',
                bgDeep: '#162024', bgMid: '#26353a', cardBg: 'rgba(28, 40, 44, 0.84)',
                primary: '#9ab09c', secondary: '#d6c5b3', textMain: '#f0f4f1', textMuted: '#8ea19e'
            },
            'ref-sand': {
                name: 'Sand (Теплий Травертин)', group: 'Earth & Stone',
                bgDeep: '#2b2118', bgMid: '#473729', cardBg: 'rgba(56, 43, 32, 0.84)',
                primary: '#e3c3a3', secondary: '#b8926a', textMain: '#fcf7f2', textMuted: '#bda691'
            },
            'ref-emerald': {
                name: 'Emerald (Смарагдова Вода)', group: 'Earth & Stone',
                bgDeep: '#071712', bgMid: '#102e24', cardBg: 'rgba(12, 36, 28, 0.84)',
                primary: '#4eb897', secondary: '#d4be8d', textMain: '#ecfaf5', textMuted: '#7aa898'
            },
            'ref-plum': {
                name: 'Plum (Темна Магнолія)', group: 'Earth & Stone',
                bgDeep: '#1f0d12', bgMid: '#3b1922', cardBg: 'rgba(46, 18, 26, 0.85)',
                primary: '#d4879c', secondary: '#d9b89a', textMain: '#faedf1', textMuted: '#b0808d'
            },
            'ref-stone': {
                name: 'Stone (Чорний Мармур & Золото)', group: 'Earth & Stone',
                bgDeep: '#12100e', bgMid: '#211d18', cardBg: 'rgba(26, 23, 19, 0.88)',
                primary: '#cfa363', secondary: '#8c6f46', textMain: '#f7f3eb', textMuted: '#9e9283'
            },
            'ruins-eldritch-amethyst': {
                name: 'Eldritch Amethyst', group: 'Ruins in the Woods',
                bgDeep: '#140d1c', bgMid: '#261a33', cardBg: 'rgba(30, 20, 41, 0.86)',
                primary: '#9e7bb5', secondary: '#c7b8d6', textMain: '#f3eef7', textMuted: '#8e7a9e'
            },
            'ruins-profaned-plum': {
                name: 'Profaned Plum', group: 'Ruins in the Woods',
                bgDeep: '#1c0a11', bgMid: '#33131f', cardBg: 'rgba(38, 14, 23, 0.86)',
                primary: '#b85d76', secondary: '#c4a47c', textMain: '#f7ebee', textMuted: '#9e6d7a'
            },
            'ruins-moonlit-abyss': {
                name: 'Moonlit Abyss', group: 'Ruins in the Woods',
                bgDeep: '#070f17', bgMid: '#102030', cardBg: 'rgba(13, 26, 40, 0.86)',
                primary: '#5a8ab0', secondary: '#b0c4d6', textMain: '#ebf2f7', textMuted: '#6d879e'
            },
            'ruins-frosted-night': {
                name: 'Frosted Night & Silver Mist', group: 'Ruins in the Woods',
                bgDeep: '#141f2b', bgMid: '#26384a', cardBg: 'rgba(30, 45, 60, 0.84)',
                primary: '#9eb5c9', secondary: '#dcdde0', textMain: '#f5f7fa', textMuted: '#8fa1b3'
            },
            'black-01-jet': {
                name: '01 Jet Black & Pearl', group: '10 Shades of Black',
                bgDeep: '#050608', bgMid: '#0d0f12', cardBg: 'rgba(12, 14, 18, 0.90)',
                primary: '#d8dee9', secondary: '#8892b0', textMain: '#f8fafc', textMuted: '#7c8594'
            },
            'black-02-midnight': {
                name: '02 Midnight Velvet', group: '10 Shades of Black',
                bgDeep: '#070d14', bgMid: '#101c29', cardBg: 'rgba(14, 24, 36, 0.88)',
                primary: '#8ab4f8', secondary: '#c9b38c', textMain: '#eff4fa', textMuted: '#76889c'
            },
            'black-04-charcoal': {
                name: '04 Charcoal Warm', group: '10 Shades of Black',
                bgDeep: '#141012', bgMid: '#241d20', cardBg: 'rgba(31, 24, 27, 0.88)',
                primary: '#c9a690', secondary: '#8c626b', textMain: '#f5efed', textMuted: '#968387'
            },
            'black-06-slate': {
                name: '06 Slate & Peacock Feather', group: '10 Shades of Black',
                bgDeep: '#181e24', bgMid: '#2b3540', cardBg: 'rgba(36, 44, 54, 0.86)',
                primary: '#9eb1c2', secondary: '#c4b08b', textMain: '#f2f5f8', textMuted: '#8d9ba8'
            },
            'black-09-moss': {
                name: '09 Moss Black', group: '10 Shades of Black',
                bgDeep: '#0d120f', bgMid: '#1a241e', cardBg: 'rgba(22, 30, 25, 0.88)',
                primary: '#87a896', secondary: '#c2b28f', textMain: '#edf2ef', textMuted: '#7c9186'
            },
            'jewel-03-garnet': {
                name: '03 Garnet & Antique Gold', group: '100 Jewel Tones',
                bgDeep: '#21060a', bgMid: '#3d0c14', cardBg: 'rgba(48, 9, 16, 0.86)',
                primary: '#e04f5f', secondary: '#d4af37', textMain: '#ffedf0', textMuted: '#b5767e'
            },
            'jewel-33-peacock': {
                name: '33 Peacock & 51 Gold', group: '100 Jewel Tones',
                bgDeep: '#051c24', bgMid: '#0b3542', cardBg: 'rgba(9, 43, 54, 0.85)',
                primary: '#2eb8b8', secondary: '#dba843', textMain: '#ebfaf9', textMuted: '#74a8a8'
            },
            'jewel-49-malachite': {
                name: '49 Malachite & 58 Bronze', group: '100 Jewel Tones',
                bgDeep: '#051f14', bgMid: '#0b3b27', cardBg: 'rgba(9, 48, 32, 0.86)',
                primary: '#29cc7a', secondary: '#cd7f32', textMain: '#ebfff4', textMuted: '#72b090'
            },
            'jewel-52-amber': {
                name: '52 Amber & 68 Espresso', group: '100 Jewel Tones',
                bgDeep: '#1a1008', bgMid: '#301e10', cardBg: 'rgba(40, 25, 13, 0.86)',
                primary: '#f59e0b', secondary: '#fcd34d', textMain: '#fffbeb', textMuted: '#b89772'
            },
            'jewel-96-royal-teal': {
                name: '96 Royal Teal & 100 Opal', group: '100 Jewel Tones',
                bgDeep: '#061a21', bgMid: '#0d313d', cardBg: 'rgba(11, 41, 51, 0.85)',
                primary: '#38bdf8', secondary: '#c084fc', textMain: '#f0f9ff', textMuted: '#7ea8bd'
            }
        };

        // 3. ТИПИ БОТАНІЧНИХ ЛІАН
        this.vineStyles = {
            'botanical-ivy': { name: 'Ботанічна Лоза з Листям (Жива класика)' },
            'ruins-filigree': { name: 'Гілки Руїн із Золотими Бруньками (Ref 3)' },
            'irminsul-veins': { name: 'Сяючі Прожилки Древа Ірмінсуль' },
            'olive-silhouette': { name: 'Тіні Оливкових Гілок (Ref SAGE)' }
        };

        this.state = {
            activeTab: 'materials',
            material: 'marble-gold-stone',
            buttonStyle: 'jewel-brass',
            paletteId: 'ref-stone',
            bgDeep: '#12100e',
            bgMid: '#211d18',
            cardBg: 'rgba(26, 23, 19, 0.88)',
            primary: '#cfa363',
            secondary: '#8c6f46',
            textMain: '#f7f3eb',
            textMuted: '#9e9283',
            textureStrength: 0.75,
            blur: 16,
            borderRadius: 12,
            borderGlow: 0.9,
            vineStyle: 'botanical-ivy',
            vineDensity: 50,
            vineReach: 220,
            vineThickness: 2.2,
            vineSway: true,
            vineSeed: 777,
            ecoMode: false
        };

        this.customPresets = {};
        this.init();
    }

    init() {
        this.loadStorage();
        this.injectSVGTextureDefs();
        this.injectAuthenticCSS();
        this.initCrossWindowSync();
        this.observeEcoAndGMStatus();

        const boot = () => {
            this.mountMasterBackdrop();
            this.mountHUD();
            this.rebuildMaterialAndVinesGeometry();
            this.updateColorsAndOpticsOnly();
            this.updateGMButtonVisibility();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
    }

    /**
     * Перевіряє, чи поточний користувач є Майстром (GM) у Листі Персонажів (index.html) або в Етері (aether.html)
     */
    isCurrentUserGM() {
        try {
            if (window.IS_GM === true || window.isGM === true || window.USER_ROLE === 'gm' || window.currentRole === 'gm') {
                return true;
            }
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('gm') === '1' || urlParams.get('role') === 'gm' || urlParams.get('mode') === 'gm') {
                return true;
            }
            const lsKeys = ['entropia_is_gm', 'aether_is_gm', 'vitruvius_gm', 'is_gm', 'gm_mode', 'user_role', 'role'];
            for (let i = 0; i < lsKeys.length; i++) {
                const val = (localStorage.getItem(lsKeys[i]) || '').toLowerCase();
                if (val === 'true' || val === '1' || val === 'gm' || val === 'master') return true;
            }
            if (document.body) {
                if (
                    document.body.classList.contains('gm-mode') ||
                    document.body.classList.contains('is-gm') ||
                    document.body.classList.contains('master-mode') ||
                    document.body.dataset.role === 'gm' ||
                    document.body.dataset.gm === 'true'
                ) {
                    return true;
                }
            }
            // Перевіряємо наявність активної консолі або перемикача ГМа в DOM
            const gmToggle = document.querySelector('#gm-toggle:checked, #gm-mode-toggle.active, .gm-switch.active, .gm-panel:not(.hidden)');
            if (gmToggle) return true;

            const gmCrownBtn = document.querySelector('[id*="gm"][class*="active"], [class*="gm-btn"].active');
            if (gmCrownBtn) return true;
        } catch (e) {}
        return false;
    }

    /**
     * Показує кнопку ATELIER STUDIO тільки Майстру, ховаючи її у звичайних гравців
     */
    updateGMButtonVisibility() {
        const mount = document.getElementById('aether-auth-mount');
        if (!mount) return;
        const isGM = this.isCurrentUserGM();
        mount.style.display = isGM ? 'inline-flex' : 'none';
        if (!isGM) {
            mount.querySelector('#auth-drawer')?.classList.remove('open');
        }
    }

    /**
     * Дозволяє примусово увімкнути/вимкнути видимість кнопки з коду index.html (напр. window.AetherSkins.setGMMode(true))
     */
    setGMMode(isGM) {
        if (document.body) {
            document.body.classList.toggle('gm-mode', Boolean(isGM));
        }
        this.updateGMButtonVisibility();
    }

    loadStorage() {
        try {
            const p = localStorage.getItem(this.STORAGE_PRESETS_KEY);
            if (p) this.customPresets = JSON.parse(p);
            const s = localStorage.getItem(this.STORAGE_STATE_KEY);
            if (s) this.state = { ...this.state, ...JSON.parse(s) };
        } catch (e) {}
    }

    saveStorage() {
        try {
            localStorage.setItem(this.STORAGE_STATE_KEY, JSON.stringify(this.state));
        } catch (e) {}
    }

    seededRandom(index) {
        const x = Math.sin(this.state.vineSeed * 997 + index * 131.7) * 10000;
        return x - Math.floor(x);
    }

    hexToRgb(hex) {
        const h = (hex || '#cfa363').replace('#', '');
        const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
        return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    }

    injectSVGTextureDefs() {
        if (document.getElementById('aether-authentic-svg-defs')) return;
        const wrap = document.createElement('div');
        wrap.id = 'aether-authentic-svg-defs';
        wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;z-index:-1;';
        wrap.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <filter id="tex-ruins-suede" x="0%" y="0%" width="100%" height="100%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="5" seed="12" result="cloud"/>
                        <feDiffuseLighting in="cloud" lighting-color="#ffffff" surfaceScale="2.4" result="diff">
                            <feDistantLight azimuth="135" elevation="52"/>
                        </feDiffuseLighting>
                        <feColorMatrix type="matrix" in="diff" values="
                            1 0 0 0 0
                            0 1 0 0 0
                            0 0 1 0 0
                            0 0 0 0.16 0"/>
                    </filter>

                    <filter id="tex-sand-travertine" x="0%" y="0%" width="100%" height="100%">
                        <feTurbulence type="turbulence" baseFrequency="0.08 0.14" numOctaves="4" seed="5" result="stone"/>
                        <feDiffuseLighting in="stone" lighting-color="#fff8eb" surfaceScale="1.9" result="lit">
                            <feDistantLight azimuth="45" elevation="45"/>
                        </feDiffuseLighting>
                        <feColorMatrix type="matrix" in="lit" values="
                            1 0 0 0 0
                            0 1 0 0 0
                            0 0 1 0 0
                            0 0 0 0.14 0"/>
                    </filter>

                    <filter id="tex-flint-linen" x="0%" y="0%" width="100%" height="100%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.65 0.12" numOctaves="2" result="weaveX"/>
                        <feTurbulence type="fractalNoise" baseFrequency="0.12 0.65" numOctaves="2" result="weaveY"/>
                        <feBlend mode="multiply" in="weaveX" in2="weaveY" result="cloth"/>
                        <feColorMatrix type="matrix" in="cloth" values="
                            1 0 0 0 0
                            0 1 0 0 0
                            0 0 1 0 0
                            0 0 0 0.13 0"/>
                    </filter>
                </defs>
            </svg>
        `;
        document.body ? document.body.appendChild(wrap) : document.addEventListener('DOMContentLoaded', () => document.body.appendChild(wrap));
    }

    injectAuthenticCSS() {
        if (document.getElementById('aether-authentic-css')) return;
        const style = document.createElement('style');
        style.id = 'aether-authentic-css';

        // Універсальні селектори як для aether.html, так і для всього Листа Персонажів (index.html)
        const CARDS = `.glass-card, .top-bar, .char-card, .character-sheet, .sheet-panel, .sheet-card, .stat-box, .stat-card, .skill-box, .wound-box, .inventory-panel, .npc-card, .hud-panel, .module-card, .panel-box`;
        const CARDS_BEFORE = `.glass-card::before, .char-card::before, .sheet-panel::before, .sheet-card::before, .stat-box::before, .stat-card::before, .hud-panel::before, .module-card::before`;
        const BTNS = `.glass-card button:not(.auth-raw), .top-bar button:not(.auth-raw), .char-card button:not(.auth-raw), .sheet-panel button:not(.auth-raw), .character-sheet button:not(.auth-raw), .stat-box button:not(.auth-raw), .btn:not(.auth-raw), button.action-btn:not(.auth-raw)`;
        const BTNS_HOVER = `.glass-card button:not(.auth-raw):hover, .top-bar button:not(.auth-raw):hover, .char-card button:not(.auth-raw):hover, .sheet-panel button:not(.auth-raw):hover, .character-sheet button:not(.auth-raw):hover, .stat-box button:not(.auth-raw):hover, .btn:not(.auth-raw):hover, button.action-btn:not(.auth-raw):hover`;

        style.textContent = `
            :root {
                --bg-deep: #12100e;
                --bg-mid: #211d18;
                --bg-panel: rgba(26, 23, 19, 0.88);
                --bg-panel-solid: #12100e;
                --neon-vine: #cfa363;
                --neon-secondary: #8c6f46;
                --primary-rgb: 207, 163, 99;
                --secondary-rgb: 140, 111, 70;
                --text-main: #f7f3eb;
                --text-muted: #9e9283;
                --border-base: rgba(207, 163, 99, 0.38);
                --border-hover: rgba(207, 163, 99, 0.88);
                --tex-strength: 0.75;
                --skin-blur: 16px;
                --skin-radius: 12px;
                --skin-glow: 0.9;
            }

            html, body {
                background: var(--bg-deep) !important;
                background-image: none !important;
                color: var(--text-main) !important;
            }

            .app-container, .main-container, .aether-wrapper, .table-wrapper, .vtt-background, .sheet-container, .char-sheet-wrapper, #app, main {
                background: transparent !important;
            }

            svg path[class*="vine"], svg path[id*="vine"], .vine-path, .aether-vine, .bio-vine, [class*="liana"] {
                stroke: var(--neon-vine) !important;
                filter: drop-shadow(0 0 calc(6px * var(--skin-glow)) var(--neon-vine)) !important;
                transition: stroke 0.3s ease, filter 0.3s ease !important;
            }

            #aether-authentic-backdrop {
                position: fixed;
                inset: 0;
                width: 100vw;
                height: 100vh;
                pointer-events: none !important;
                z-index: 0 !important;
                overflow: hidden;
                background: radial-gradient(ellipse at 50% 42%, var(--bg-mid) 0%, var(--bg-deep) 88%);
                transition: background 0.4s ease;
            }

            #aether-backdrop-grain {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                opacity: var(--tex-strength);
                pointer-events: none;
                mix-blend-mode: overlay;
            }

            body[data-material="ruins-suede-parchment"] #aether-backdrop-grain {
                filter: url(#tex-ruins-suede);
                background: radial-gradient(circle at 50% 50%, rgba(var(--primary-rgb), 0.35), rgba(0,0,0,0.85));
            }

            body[data-material="sage-sand-shadows"] #aether-backdrop-grain {
                filter: url(#tex-sand-travertine);
                background: linear-gradient(125deg, rgba(255,248,235,0.45) 0%, rgba(0,0,0,0.65) 100%);
            }

            body[data-material="flint-woven-linen"] #aether-backdrop-grain {
                filter: url(#tex-flint-linen);
                background: rgba(255,255,255,0.5);
            }

            body[data-material="draped-velvet-folds"] #aether-backdrop-grain {
                background: repeating-linear-gradient(
                    180deg,
                    rgba(0, 0, 0, 0.65) 0px,
                    rgba(var(--primary-rgb), 0.18) 38px,
                    rgba(255, 255, 255, 0.08) 54px,
                    rgba(var(--secondary-rgb), 0.14) 72px,
                    rgba(0, 0, 0, 0.72) 115px
                );
                mix-blend-mode: soft-light;
            }

            #aether-authentic-svg {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
            }

            ${CARDS}, .game-table-oval, header, nav {
                position: relative;
                z-index: 5;
            }

            @keyframes botanicalBreeze {
                0%, 100% { transform: rotate(0deg) scale(1); }
                50% { transform: rotate(0.85deg) scale(1.008); }
            }

            body[data-vine-sway="true"]:not(.eco-mode) .locked-vine-layer {
                transform-origin: center;
                animation: botanicalBreeze 10s ease-in-out infinite;
            }

            ${CARDS} {
                background: var(--bg-panel) !important;
                backdrop-filter: blur(var(--skin-blur)) saturate(135%) !important;
                -webkit-backdrop-filter: blur(var(--skin-blur)) saturate(135%) !important;
                border: 1px solid var(--border-base) !important;
                border-radius: var(--skin-radius) !important;
                color: var(--text-main) !important;
                box-shadow: 
                    0 16px 42px rgba(0, 0, 0, 0.82),
                    0 0 calc(20px * var(--skin-glow)) rgba(var(--primary-rgb), 0.16),
                    inset 0 1px 0 rgba(255, 255, 255, 0.18) !important;
                transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease !important;
            }

            ${CARDS}:hover {
                border-color: var(--border-hover) !important;
            }

            ${CARDS_BEFORE} {
                content: "";
                position: absolute;
                inset: 0;
                border-radius: inherit;
                pointer-events: none;
                z-index: 0;
                opacity: calc(var(--tex-strength) * 0.65);
            }

            body[data-material="marble-gold-stone"] :is(${CARDS})::before {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260' viewBox='0 0 260 260'%3E%3Cg fill='none' stroke='%23e6c280' stroke-opacity='0.22' stroke-width='1.1'%3E%3Cpath d='M-10 45 L 35 60 L 65 35 L 115 70 L 165 40 L 215 85 L 270 55'/%3E%3Cpath d='M65 35 L 85 95 L 60 155 L 105 215 L 95 270' stroke-opacity='0.14' stroke-width='0.8'/%3E%3Cpath d='M-10 190 L 55 165 L 110 195 L 185 155 L 270 185' stroke-opacity='0.18'/%3E%3C/g%3E%3C/svg%3E");
                background-size: 260px 260px;
            }

            body[data-material="emerald-water-caustics"] :is(${CARDS})::before {
                background: 
                    radial-gradient(circle at 85% 25%, rgba(var(--primary-rgb), 0.22) 0%, transparent 45%),
                    radial-gradient(circle at 20% 80%, rgba(var(--secondary-rgb), 0.16) 0%, transparent 50%);
            }

            body[data-material="draped-velvet-folds"] :is(${CARDS})::before {
                background: linear-gradient(
                    180deg,
                    rgba(255, 255, 255, 0.09) 0%,
                    rgba(var(--primary-rgb), 0.12) 22%,
                    rgba(0, 0, 0, 0.45) 52%,
                    rgba(var(--secondary-rgb), 0.10) 78%,
                    rgba(0, 0, 0, 0.6) 100%
                );
            }

            body[data-material="ruins-suede-parchment"] :is(${CARDS}) {
                outline: 1px solid rgba(var(--primary-rgb), 0.28);
                outline-offset: -5px;
            }
            body[data-material="ruins-suede-parchment"] :is(${CARDS})::before {
                background: radial-gradient(ellipse at 30% 20%, rgba(var(--primary-rgb), 0.16), transparent 60%),
                            radial-gradient(ellipse at 75% 85%, rgba(var(--secondary-rgb), 0.14), transparent 60%);
            }

            body[data-material="sage-sand-shadows"] :is(${CARDS})::before {
                background: linear-gradient(118deg, transparent 20%, rgba(255, 245, 225, 0.11) 42%, rgba(255, 245, 225, 0.03) 58%, transparent 75%);
            }

            body[data-material="flint-woven-linen"] :is(${CARDS})::before {
                background-image: 
                    repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px),
                    repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px);
            }

            /* 7 СТИЛІВ КНОПОК ТА ІНТЕРАКТИВНИХ КОНТРОЛІВ ІЗ РЕФЕРЕНСІВ (для Етера + Листа Персонажів) */
            ${BTNS} {
                position: relative;
                z-index: 2;
                color: var(--text-main) !important;
                cursor: pointer;
                transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
            }

            /* 1. JEWEL BRASS & SILK */
            body[data-btn-style="jewel-brass"] :is(${BTNS}) {
                background: linear-gradient(180deg, rgba(var(--primary-rgb), 0.25) 0%, rgba(var(--secondary-rgb), 0.12) 48%, rgba(0, 0, 0, 0.65) 100%) !important;
                border: 1px solid var(--border-base) !important;
                border-radius: 8px !important;
                box-shadow: 
                    inset 0 1px 0 rgba(255, 255, 255, 0.28),
                    inset 0 -1px 0 rgba(var(--secondary-rgb), 0.35),
                    0 4px 12px rgba(0, 0, 0, 0.5) !important;
            }
            body[data-btn-style="jewel-brass"] :is(${BTNS_HOVER}) {
                border-color: var(--neon-vine) !important;
                box-shadow: 
                    0 0 calc(15px * var(--skin-glow)) rgba(var(--primary-rgb), 0.42),
                    inset 0 1px 0 rgba(255, 255, 255, 0.45) !important;
                transform: translateY(-1px);
            }

            /* 2. SUNSET SPHERICAL ORB */
            body[data-btn-style="sunset-orb"] :is(${BTNS}) {
                border-radius: 999px !important;
                background: radial-gradient(
                    circle at 50% 16%,
                    rgba(255, 255, 255, 0.38) 0%,
                    rgba(var(--primary-rgb), 0.34) 48%,
                    rgba(var(--secondary-rgb), 0.18) 78%,
                    rgba(0, 0, 0, 0.65) 100%
                ) !important;
                border: 1px solid rgba(var(--primary-rgb), 0.6) !important;
                box-shadow: 
                    0 6px 16px rgba(0, 0, 0, 0.6),
                    0 0 calc(14px * var(--skin-glow)) rgba(var(--primary-rgb), 0.32),
                    inset 0 2px 3px rgba(255, 255, 255, 0.55),
                    inset 0 -3px 6px rgba(0, 0, 0, 0.5) !important;
            }
            body[data-btn-style="sunset-orb"] :is(${BTNS_HOVER}) {
                transform: translateY(-1.5px) scale(1.02);
                box-shadow: 
                    0 8px 20px rgba(0, 0, 0, 0.7),
                    0 0 calc(20px * var(--skin-glow)) rgba(var(--primary-rgb), 0.55),
                    inset 0 2px 4px rgba(255, 255, 255, 0.75) !important;
            }

            /* 3. LIQUID GLASS CHIP */
            body[data-btn-style="liquid-chip"] :is(${BTNS}) {
                border-radius: 14px !important;
                background: linear-gradient(
                    135deg,
                    rgba(255, 255, 255, 0.22) 0%,
                    rgba(var(--primary-rgb), 0.16) 50%,
                    rgba(var(--secondary-rgb), 0.22) 100%
                ) !important;
                backdrop-filter: blur(12px) !important;
                border: 1.5px solid rgba(255, 255, 255, 0.42) !important;
                box-shadow: 
                    0 8px 20px rgba(0, 0, 0, 0.45),
                    inset 0 2px 2px rgba(255, 255, 255, 0.65),
                    inset 0 -2px 3px rgba(var(--primary-rgb), 0.45) !important;
            }
            body[data-btn-style="liquid-chip"] :is(${BTNS_HOVER}) {
                border-color: #ffffff !important;
                box-shadow: 
                    0 10px 24px rgba(var(--primary-rgb), 0.35),
                    inset 0 2px 3px #ffffff,
                    inset 0 -2px 5px var(--neon-vine) !important;
                transform: translateY(-1px);
            }

            /* 4. ANTARIKSA BENTO PILL */
            body[data-btn-style="bento-pill"] :is(${BTNS}) {
                border-radius: 999px !important;
                background: linear-gradient(90deg, rgba(var(--primary-rgb), 0.32), rgba(var(--secondary-rgb), 0.25)) !important;
                border: 1.5px solid var(--neon-vine) !important;
                box-shadow: 0 3px 0 var(--neon-vine), 0 6px 14px rgba(0, 0, 0, 0.6) !important;
                font-weight: 700 !important;
                letter-spacing: 0.5px !important;
            }
            body[data-btn-style="bento-pill"] :is(${BTNS_HOVER}) {
                transform: translateY(-2px);
                box-shadow: 0 5px 0 var(--neon-vine), 0 10px 20px rgba(var(--primary-rgb), 0.35) !important;
            }

            /* 5. LANM & REAPUM GOLD FILIGREE */
            body[data-btn-style="forest-filigree"] :is(${BTNS}) {
                border-radius: 999px !important;
                background: rgba(8, 12, 10, 0.65) !important;
                border: 1px solid var(--neon-vine) !important;
                outline: 1px solid rgba(var(--secondary-rgb), 0.4);
                outline-offset: -4px;
                box-shadow: 
                    0 0 calc(12px * var(--skin-glow)) rgba(var(--primary-rgb), 0.25),
                    inset 0 0 10px rgba(var(--primary-rgb), 0.2) !important;
            }
            body[data-btn-style="forest-filigree"] :is(${BTNS_HOVER}) {
                background: rgba(var(--primary-rgb), 0.22) !important;
                outline-color: var(--neon-vine);
                box-shadow: 
                    0 0 calc(18px * var(--skin-glow)) rgba(var(--primary-rgb), 0.5),
                    inset 0 0 14px rgba(var(--primary-rgb), 0.35) !important;
            }

            /* 6. BIOLUME CRYSTAL GEM */
            body[data-btn-style="crystal-gem"] :is(${BTNS}) {
                border-radius: 4px !important;
                clip-path: polygon(10px 0%, calc(100% - 10px) 0%, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0% 50%);
                background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.42) 0%, rgba(10, 12, 20, 0.85) 50%, rgba(var(--secondary-rgb), 0.38) 100%) !important;
                border: none !important;
                box-shadow: inset 0 0 12px rgba(var(--primary-rgb), 0.45) !important;
                padding-left: 16px !important;
                padding-right: 16px !important;
            }
            body[data-btn-style="crystal-gem"] :is(${BTNS_HOVER}) {
                filter: brightness(1.25) drop-shadow(0 0 8px var(--neon-vine));
                transform: scale(1.03);
            }

            /* 7. LUXURY SATIN BEVEL */
            body[data-btn-style="luxury-bevel"] :is(${BTNS}) {
                border-radius: 2px !important;
                background: linear-gradient(
                    118deg,
                    rgba(0, 0, 0, 0.8) 0%,
                    rgba(var(--primary-rgb), 0.28) 45%,
                    rgba(255, 255, 255, 0.14) 50%,
                    rgba(0, 0, 0, 0.85) 100%
                ) !important;
                border: 1px solid rgba(var(--primary-rgb), 0.45) !important;
                border-bottom: 2.5px solid var(--neon-vine) !important;
                letter-spacing: 0.8px !important;
                box-shadow: 0 6px 16px rgba(0, 0, 0, 0.75) !important;
            }
            body[data-btn-style="luxury-bevel"] :is(${BTNS_HOVER}) {
                border-color: var(--neon-vine) !important;
                box-shadow: 0 8px 22px rgba(var(--primary-rgb), 0.35) !important;
                transform: translateY(-1px);
            }

            .game-table-oval {
                background: radial-gradient(
                    ellipse at center,
                    rgba(var(--primary-rgb), 0.16) 0%,
                    rgba(var(--secondary-rgb), 0.07) 52%,
                    rgba(0, 0, 0, 0.5) 100%
                ) !important;
                border: 1.5px solid var(--border-base) !important;
                box-shadow: 
                    0 0 calc(50px * var(--skin-glow)) rgba(var(--primary-rgb), 0.22),
                    inset 0 0 calc(38px * var(--skin-glow)) rgba(var(--primary-rgb), 0.14) !important;
            }

            body.eco-mode #aether-backdrop-grain,
            body.eco-mode #aether-authentic-svg { display: none !important; }
            body.eco-mode :is(${CARDS}) {
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                background: var(--bg-panel-solid) !important;
            }

            /* STUDIO HUD (Видимий тільки Майстру) */
            .aether-auth-mount {
                position: relative;
                display: none;
                align-items: center;
                margin-left: 10px;
                z-index: 99999;
                font-family: 'Georgia', system-ui, -apple-system, sans-serif;
            }

            .auth-trigger-btn {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 6px 14px;
                border-radius: 999px;
                background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.28), rgba(10, 10, 12, 0.9));
                border: 1px solid var(--neon-vine);
                color: var(--text-main);
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1.2px;
                cursor: pointer;
                box-shadow: 0 0 15px rgba(var(--primary-rgb), 0.28);
            }

            .auth-orb {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: var(--neon-vine);
                box-shadow: 0 0 8px var(--neon-vine);
            }

            .auth-drawer {
                position: fixed;
                top: 56px;
                right: 16px;
                width: 410px;
                max-width: calc(100vw - 24px);
                height: calc(100vh - 74px);
                max-height: 780px;
                display: none;
                flex-direction: column;
                border-radius: 16px;
                background: rgba(14, 13, 16, 0.97);
                backdrop-filter: blur(24px);
                border: 1px solid var(--neon-vine);
                box-shadow: 0 28px 70px rgba(0, 0, 0, 0.95), 0 0 30px rgba(var(--primary-rgb), 0.2);
                color: #f5f2eb;
                overflow: hidden;
                z-index: 99999;
                font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
            }

            .auth-drawer.open { display: flex; }

            .auth-header {
                padding: 13px 16px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-shrink: 0;
            }

            .auth-title {
                font-size: 12px;
                font-weight: 800;
                letter-spacing: 1.5px;
                text-transform: uppercase;
                color: var(--neon-vine);
            }

            .auth-tabs {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 4px;
                padding: 8px 12px;
                background: rgba(0, 0, 0, 0.45);
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                flex-shrink: 0;
            }

            .auth-tab {
                padding: 7px 4px;
                border-radius: 8px;
                border: 1px solid transparent;
                background: transparent;
                color: #a39e93;
                font-size: 10.5px;
                font-weight: 700;
                cursor: pointer;
                text-align: center;
            }

            .auth-tab.active {
                background: rgba(var(--primary-rgb), 0.22);
                border-color: var(--neon-vine);
                color: #fff;
            }

            .auth-scroll {
                flex: 1 1 auto;
                overflow-y: auto;
                overflow-x: hidden;
                padding: 14px 16px 24px;
                display: flex;
                flex-direction: column;
                gap: 14px;
                scrollbar-width: thin;
                scrollbar-color: var(--neon-vine) rgba(255,255,255,0.05);
            }
            .auth-scroll::-webkit-scrollbar { width: 6px; }
            .auth-scroll::-webkit-scrollbar-thumb { background: var(--neon-vine); border-radius: 6px; }

            .auth-pane { display: none; flex-direction: column; gap: 14px; }
            .auth-pane.active { display: flex; }

            .a-label {
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 1.2px;
                color: #a8a29e;
                margin-bottom: 6px;
                display: flex;
                justify-content: space-between;
            }

            .mat-card {
                padding: 10px 12px;
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.035);
                border: 1px solid rgba(255, 255, 255, 0.1);
                cursor: pointer;
                text-align: left;
                transition: all 0.18s ease;
            }
            .mat-card:hover { border-color: rgba(var(--primary-rgb), 0.55); }
            .mat-card.active {
                background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.24), rgba(0, 0, 0, 0.7));
                border-color: var(--neon-vine);
            }

            .pal-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 7px;
            }

            .pal-card {
                padding: 8px 9px;
                border-radius: 9px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.09);
                cursor: pointer;
                text-align: left;
                display: flex;
                flex-direction: column;
                gap: 5px;
            }
            .pal-card.active {
                border-color: var(--neon-vine);
                background: rgba(var(--primary-rgb), 0.2);
            }

            .a-pill-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
            .a-pill {
                padding: 8px 10px;
                border-radius: 8px;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #f5f2eb;
                font-size: 10.5px;
                font-weight: 600;
                cursor: pointer;
                text-align: left;
            }
            .a-pill.active {
                background: rgba(var(--primary-rgb), 0.25);
                border-color: var(--neon-vine);
                color: #fff;
            }

            .a-range {
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 6px;
                border-radius: 99px;
                background: rgba(255, 255, 255, 0.14);
                outline: none;
            }
            .a-range::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 15px;
                height: 15px;
                border-radius: 50%;
                background: var(--neon-vine);
                border: 2px solid #fff;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }

    mountMasterBackdrop() {
        if (document.getElementById('aether-authentic-backdrop')) return;
        const back = document.createElement('div');
        back.id = 'aether-authentic-backdrop';
        back.innerHTML = `
            <div id="aether-backdrop-grain"></div>
            <svg id="aether-authentic-svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice"></svg>
        `;
        document.body.prepend(back);
    }

    updateColorsAndOpticsOnly() {
        const root = document.documentElement;
        const pRgb = this.hexToRgb(this.state.primary);
        const sRgb = this.hexToRgb(this.state.secondary);

        root.style.setProperty('--bg-deep', this.state.bgDeep);
        root.style.setProperty('--bg-mid', this.state.bgMid);
        root.style.setProperty('--bg-panel', this.state.cardBg);
        root.style.setProperty('--bg-panel-solid', this.state.bgDeep);
        root.style.setProperty('--neon-vine', this.state.primary);
        root.style.setProperty('--neon-secondary', this.state.secondary);
        root.style.setProperty('--primary-rgb', pRgb);
        root.style.setProperty('--secondary-rgb', sRgb);
        root.style.setProperty('--text-main', this.state.textMain);
        root.style.setProperty('--text-muted', this.state.textMuted);
        root.style.setProperty('--border-base', `rgba(${pRgb}, 0.38)`);
        root.style.setProperty('--border-hover', `rgba(${pRgb}, 0.88)`);
        root.style.setProperty('--tex-strength', String(this.state.textureStrength));
        root.style.setProperty('--skin-blur', `${this.state.blur}px`);
        root.style.setProperty('--skin-radius', `${this.state.borderRadius}px`);
        root.style.setProperty('--skin-glow', String(this.state.borderGlow));

        if (document.body) {
            document.body.dataset.material = this.state.material;
            document.body.dataset.btnStyle = this.state.buttonStyle || 'jewel-brass';
            document.body.dataset.vineSway = String(Boolean(this.state.vineSway));
            document.body.classList.toggle('eco-mode', Boolean(this.state.ecoMode));
        }

        document.querySelectorAll('svg path[class*="vine"], svg path[id*="vine"], .vine-path, .aether-vine').forEach(el => {
            el.style.stroke = 'var(--neon-vine)';
        });

        this.syncHUD();
        this.saveStorage();
    }

    rebuildMaterialAndVinesGeometry() {
        const svg = document.getElementById('aether-authentic-svg');
        if (!svg) return;

        if (this.state.ecoMode) {
            svg.innerHTML = '';
            return;
        }

        const mat = this.state.material;
        let html = `
            <defs>
                <linearGradient id="authGoldVeinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:var(--neon-vine);stop-opacity:0.75"/>
                    <stop offset="50%" style="stop-color:var(--neon-secondary);stop-opacity:0.35"/>
                    <stop offset="100%" style="stop-color:var(--neon-vine);stop-opacity:0.65"/>
                </linearGradient>
                <radialGradient id="waterCausticGrad" cx="75%" cy="35%" r="55%">
                    <stop offset="0%" style="stop-color:var(--neon-vine);stop-opacity:0.25"/>
                    <stop offset="50%" style="stop-color:var(--neon-secondary);stop-opacity:0.10"/>
                    <stop offset="100%" style="stop-color:var(--bg-deep);stop-opacity:0"/>
                </radialGradient>
            </defs>
        `;

        if (mat === 'marble-gold-stone') {
            html += `
                <g fill="none" stroke="url(#authGoldVeinGrad)" opacity="${this.state.textureStrength}">
                    <path d="M-20,140 L110,175 L195,120 L340,185 L490,110 L680,195 L890,130 L1120,240 L1380,165 L1640,260 L1950,180" stroke-width="2.2"/>
                    <path d="M340,185 L390,310 L310,440 L420,590 L360,760 L480,940 L440,1100" stroke-width="1.4" stroke-dasharray="18 6 8 4"/>
                    <path d="M1120,240 L1060,390 L1180,530 L1110,710 L1260,890 L1210,1090" stroke-width="1.6"/>
                    <path d="M-30,820 L180,760 L360,835 L610,740 L840,860 L1110,710 L1450,830 L1710,740 L1960,840" stroke-width="2.0"/>
                    <path d="M195,120 L240,45 L290,-10 M680,195 L740,340 L890,380" stroke-width="0.9" opacity="0.65"/>
                </g>
            `;
        } else if (mat === 'emerald-water-caustics') {
            html += `
                <rect width="1920" height="1080" fill="url(#waterCausticGrad)"/>
                <g fill="none" stroke="var(--neon-vine)" opacity="${this.state.textureStrength * 0.45}">
                    <path d="M1250,-20 Q1380,180 1220,360 T1420,720 T1310,1100" stroke-width="3.5" opacity="0.4"/>
                    <path d="M1480,-20 Q1320,220 1540,440 T1380,820 T1590,1100" stroke-width="2.5" opacity="0.5"/>
                    <path d="M1680,-20 Q1540,260 1760,520 T1610,880 T1820,1100" stroke-width="3.0" opacity="0.45"/>
                    <path d="M-20,290 L180,220 L340,310 L590,190 L780,280" stroke="var(--neon-secondary)" stroke-width="1.4" opacity="0.5"/>
                </g>
            `;
        } else if (mat === 'sage-sand-shadows') {
            html += `
                <g opacity="${this.state.textureStrength * 0.65}">
                    <polygon points="350,0 980,0 1650,1080 820,1080" fill="var(--neon-secondary)" fill-opacity="0.09"/>
                    <polygon points="1050,0 1480,0 1920,720 1920,1080 1680,1080" fill="var(--neon-vine)" fill-opacity="0.07"/>
                    <g fill="var(--bg-deep)" opacity="0.55">
                        <path d="M0,0 Q180,90 340,240 M120,70 C150,40 210,50 230,90 C190,110 140,100 120,70 Z"/>
                        <ellipse cx="220" cy="145" rx="48" ry="16" transform="rotate(28 220 145)"/>
                        <ellipse cx="140" cy="195" rx="52" ry="15" transform="rotate(42 140 195)"/>
                        <ellipse cx="290" cy="215" rx="44" ry="14" transform="rotate(18 290 215)"/>
                    </g>
                </g>
            `;
        } else if (mat === 'ruins-suede-parchment') {
            html += `
                <g stroke="var(--neon-secondary)" fill="none" opacity="${this.state.textureStrength * 0.55}">
                    <line x1="560" y1="52" x2="1360" y2="52" stroke-width="1"/>
                    <line x1="560" y1="1032" x2="1360" y2="1032" stroke-width="1"/>
                    <circle cx="960" cy="1015" r="26" stroke-width="1.3"/>
                    <path d="M940,1005 A22,22 0 1,0 980,1005 A18,18 0 1,1 940,1005 Z" fill="var(--neon-secondary)"/>
                </g>
            `;
        }

        const density = Number(this.state.vineDensity) || 0;
        if (density > 0) {
            const branchCount = Math.max(2, Math.round((density / 100) * 20));
            const maxReach = Number(this.state.vineReach) || 220;
            const thick = Number(this.state.vineThickness) || 2.2;
            const vStyle = this.state.vineStyle;

            html += `<g class="locked-vine-layer">`;

            for (let i = 0; i < branchCount; i++) {
                const r1 = this.seededRandom(i * 11 + 1);
                const r2 = this.seededRandom(i * 11 + 2);
                const r3 = this.seededRandom(i * 11 + 3);
                const r4 = this.seededRandom(i * 11 + 4);

                const edge = i % 4;
                let x0, y0, x1, y1, x2, y2, xEnd, yEnd;

                if (edge === 0) {
                    x0 = -10;
                    y0 = 60 + r1 * 960;
                    xEnd = x0 + (0.45 + r2 * 0.55) * maxReach;
                    yEnd = y0 + (r3 - 0.5) * maxReach * 0.9;
                } else if (edge === 1) {
                    x0 = 1930;
                    y0 = 60 + r1 * 960;
                    xEnd = x0 - (0.45 + r2 * 0.55) * maxReach;
                    yEnd = y0 + (r3 - 0.5) * maxReach * 0.9;
                } else if (edge === 2) {
                    x0 = (i % 8 < 4 ? r1 * 550 : 1370 + r1 * 550);
                    y0 = -10;
                    xEnd = x0 + (r2 - 0.5) * maxReach;
                    yEnd = y0 + (0.4 + r3 * 0.6) * (maxReach * 0.75);
                } else {
                    x0 = (i % 8 < 4 ? r1 * 550 : 1370 + r1 * 550);
                    y0 = 1090;
                    xEnd = x0 + (r2 - 0.5) * maxReach;
                    yEnd = y0 - (0.4 + r3 * 0.6) * (maxReach * 0.75);
                }

                x1 = x0 + (xEnd - x0) * 0.35 + (r4 - 0.5) * 90;
                y1 = y0 + (yEnd - y0) * 0.25 - (r3 - 0.5) * 90;
                x2 = x0 + (xEnd - x0) * 0.72 - (r4 - 0.5) * 80;
                y2 = y0 + (yEnd - y0) * 0.78 + (r2 - 0.5) * 80;

                const strokeColor = vStyle === 'olive-silhouette' ? 'var(--bg-deep)' : 'url(#authGoldVeinGrad)';
                const leafColor = vStyle === 'ruins-filigree' ? 'var(--neon-secondary)' : 'var(--neon-vine)';

                html += `
                    <path d="M${x0.toFixed(1)},${y0.toFixed(1)} C${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} ${xEnd.toFixed(1)},${yEnd.toFixed(1)}"
                          fill="none" stroke="${strokeColor}" stroke-width="${thick}" stroke-linecap="round" opacity="0.78"/>
                `;

                const bx = (x1 + x2) * 0.5;
                const by = (y1 + y2) * 0.5;
                const bEndX = bx + (r3 - 0.5) * 95;
                const bEndY = by + (r4 - 0.5) * 95;
                html += `
                    <path d="M${bx.toFixed(1)},${by.toFixed(1)} Q${x2.toFixed(1)},${by.toFixed(1)} ${bEndX.toFixed(1)},${bEndY.toFixed(1)}"
                          fill="none" stroke="var(--neon-vine)" stroke-width="${(thick * 0.6).toFixed(1)}" stroke-linecap="round" opacity="0.55"/>
                `;

                const steps = 4;
                for (let s = 1; s <= steps; s++) {
                    const t = s / (steps + 1);
                    const lx = (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3 * xEnd;
                    const ly = (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * yEnd;
                    const angle = (Math.atan2(yEnd - y0, xEnd - x0) * 180) / Math.PI + (s % 2 === 0 ? 38 : -38);

                    if (vStyle === 'irminsul-veins') {
                        html += `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="${2.5 + (s % 2)}" fill="var(--neon-vine)" opacity="0.85"/>`;
                    } else {
                        html += `
                            <path d="M0,0 C5,-4 12,-4 16,0 C12,4 5,4 0,0 Z"
                                  fill="${leafColor}" opacity="0.72"
                                  transform="translate(${lx.toFixed(1)}, ${ly.toFixed(1)}) rotate(${angle.toFixed(1)})"/>
                        `;
                    }
                }
            }

            html += `</g>`;
        }

        svg.innerHTML = html;
    }

    selectPaletteOnly(palId) {
        const p = this.palettes[palId];
        if (!p) return;
        this.state.paletteId = palId;
        this.state.bgDeep = p.bgDeep;
        this.state.bgMid = p.bgMid;
        this.state.cardBg = p.cardBg;
        this.state.primary = p.primary;
        this.state.secondary = p.secondary;
        this.state.textMain = p.textMain;
        this.state.textMuted = p.textMuted;

        this.updateColorsAndOpticsOnly();
    }

    mountHUD() {
        if (document.getElementById('aether-auth-mount')) return;
        const mount = document.createElement('div');
        mount.id = 'aether-auth-mount';
        mount.className = 'aether-auth-mount gm-only';

        const materialsHTML = Object.entries(this.materials).map(([k, m]) => `
            <button type="button" class="mat-card auth-raw" data-mat="${k}">
                <div style="font-size:12px;font-weight:800;color:#fff;">${m.name}</div>
                <div style="font-size:10px;color:var(--neon-vine);font-weight:600;margin-top:2px;">${m.ref}</div>
                <div style="font-size:10px;color:#cbd5e1;margin-top:4px;line-height:1.35;">${m.desc}</div>
            </button>
        `).join('');

        const buttonStylesHTML = Object.entries(this.buttonStyles).map(([k, b]) => `
            <button type="button" class="a-pill auth-raw" data-bstyle="${k}" title="${b.desc}">
                <div style="font-size:10.5px;font-weight:700;color:#fff;">${b.name}</div>
                <div style="font-size:9px;color:#a8a29e;margin-top:2px;line-height:1.2;">${b.desc}</div>
            </button>
        `).join('');

        const palettesHTML = Object.entries(this.palettes).map(([k, p]) => `
            <button type="button" class="pal-card auth-raw" data-pal="${k}">
                <div style="display:flex;gap:5px;align-items:center;">
                    <span style="width:13px;height:13px;border-radius:50%;background:${p.bgDeep};border:1px solid rgba(255,255,255,0.4);"></span>
                    <span style="width:13px;height:13px;border-radius:50%;background:${p.primary};box-shadow:0 0 6px ${p.primary};"></span>
                    <span style="width:13px;height:13px;border-radius:50%;background:${p.secondary};"></span>
                </div>
                <div style="font-size:11px;font-weight:700;color:#fff;">${p.name}</div>
                <div style="font-size:9.5px;color:#a8a29e;">${p.group}</div>
            </button>
        `).join('');

        const vineTypesHTML = Object.entries(this.vineStyles).map(([k, v]) => `
            <button type="button" class="a-pill auth-raw" data-vstyle="${k}">${v.name}</button>
        `).join('');

        mount.innerHTML = `
            <button type="button" class="auth-trigger-btn auth-raw" id="auth-trigger-btn">
                <span class="auth-orb"></span>
                <span>ATELIER STUDIO</span>
            </button>

            <div class="auth-drawer" id="auth-drawer">
                <div class="auth-header">
                    <div>
                        <div class="auth-title">Aether Authentic Materials</div>
                        <div style="font-size:10px;color:#a8a29e;">Текстури • 7 Стилів Кнопок • Фіксовані Ліани</div>
                    </div>
                    <button type="button" class="a-pill auth-raw" id="auth-sync-btn" style="padding:5px 10px;">📡 GM Sync</button>
                </div>

                <div class="auth-tabs">
                    <button type="button" class="auth-tab auth-raw active" data-tab="materials">🪨 Текстури & UI</button>
                    <button type="button" class="auth-tab auth-raw" data-tab="palettes">🎨 Палітри</button>
                    <button type="button" class="auth-tab auth-raw" data-tab="vines">🌿 Ліани</button>
                    <button type="button" class="auth-tab auth-raw" data-tab="presets">💾 Пресети</button>
                </div>

                <div class="auth-scroll">
                    <div class="auth-pane active" data-pane="materials">
                        <div>
                            <div class="a-label"><span>🔘 Стиль Кнопок та Контролів (з референсів)</span></div>
                            <div class="a-pill-grid">${buttonStylesHTML}</div>
                        </div>

                        <div>
                            <div class="a-label"><span>🪨 Фізична фактура фону та плашок</span></div>
                            <div style="display:flex;flex-direction:column;gap:8px;">${materialsHTML}</div>
                        </div>

                        <div>
                            <div class="a-label">
                                <span>Насиченість рельєфу текстури</span>
                                <span id="lbl-tex-str">${Math.round(this.state.textureStrength * 100)}%</span>
                            </div>
                            <input type="range" class="a-range" id="rng-tex-str" min="0.1" max="1.4" step="0.05" value="${this.state.textureStrength}">
                        </div>

                        <div>
                            <div class="a-label"><span>Глибина розмиття скла (Blur)</span><span id="lbl-blur">${this.state.blur}px</span></div>
                            <input type="range" class="a-range" id="rng-blur" min="0" max="32" step="2" value="${this.state.blur}">
                        </div>

                        <div>
                            <div class="a-label"><span>М'яке сяйво рамок (Glow)</span><span id="lbl-glow">${Math.round(this.state.borderGlow * 100)}%</span></div>
                            <input type="range" class="a-range" id="rng-glow" min="0" max="2" step="0.1" value="${this.state.borderGlow}">
                        </div>
                    </div>

                    <div class="auth-pane" data-pane="palettes">
                        <div>
                            <div class="a-label"><span>Ручний підбір кольору (ліани НЕ скидаються!)</span></div>
                            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;">
                                <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;border-radius:8px;background:rgba(255,255,255,0.04);font-size:10px;">
                                    <span>Ліани / Акцент</span>
                                    <input type="color" id="clr-primary" value="${this.state.primary}" style="width:100%;height:24px;border:none;background:transparent;cursor:pointer;">
                                </label>
                                <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;border-radius:8px;background:rgba(255,255,255,0.04);font-size:10px;">
                                    <span>Листя / Золото</span>
                                    <input type="color" id="clr-secondary" value="${this.state.secondary}" style="width:100%;height:24px;border:none;background:transparent;cursor:pointer;">
                                </label>
                                <label style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;border-radius:8px;background:rgba(255,255,255,0.04);font-size:10px;">
                                    <span>Глибина фону</span>
                                    <input type="color" id="clr-bg" value="${this.state.bgDeep}" style="width:100%;height:24px;border:none;background:transparent;cursor:pointer;">
                                </label>
                            </div>
                        </div>

                        <div>
                            <div class="a-label"><span>Палітри з референсів (фіксують твої ліани!)</span></div>
                            <div class="pal-grid">${palettesHTML}</div>
                        </div>
                    </div>

                    <div class="auth-pane" data-pane="vines">
                        <div>
                            <div class="a-label"><span>Стиль Ботанічних Ліан</span></div>
                            <div class="a-pill-grid">${vineTypesHTML}</div>
                        </div>

                        <div>
                            <div class="a-label">
                                <span>🌿 Густота Ліан по периметру</span>
                                <span id="lbl-v-dens">${this.state.vineDensity}%</span>
                            </div>
                            <input type="range" class="a-range" id="rng-v-dens" min="0" max="100" step="5" value="${this.state.vineDensity}">
                        </div>

                        <div>
                            <div class="a-label">
                                <span>📏 Довжина проростання гілок</span>
                                <span id="lbl-v-reach">${this.state.vineReach}px</span>
                            </div>
                            <input type="range" class="a-range" id="rng-v-reach" min="80" max="450" step="10" value="${this.state.vineReach}">
                        </div>

                        <div>
                            <div class="a-label">
                                <span>Товщина стебла</span>
                                <span id="lbl-v-thick">${this.state.vineThickness}px</span>
                            </div>
                            <input type="range" class="a-range" id="rng-v-thick" min="1" max="5" step="0.2" value="${this.state.vineThickness}">
                        </div>

                        <div class="a-pill-grid">
                            <button type="button" class="a-pill auth-raw" id="btn-vine-sway">🍃 Плавне дихання гілок</button>
                            <button type="button" class="a-pill auth-raw" id="btn-vine-reroll" title="Генерує новий візерунок ТІЛЬКИ при натисканні цієї кнопки">🎲 Змінити узор гілок</button>
                        </div>
                    </div>

                    <div class="auth-pane" data-pane="presets">
                        <div>
                            <div class="a-label"><span>Зберегти поточні текстуру, кнопки, палітру та ліани</span></div>
                            <div style="display:flex;gap:6px;">
                                <input type="text" id="inp-preset-title" placeholder="Назва твого пресета..." style="flex:1;padding:8px;border-radius:8px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:11px;">
                                <button type="button" class="a-pill auth-raw" id="btn-save-preset" style="border-color:var(--neon-vine);">+ Зберегти</button>
                            </div>
                        </div>

                        <div>
                            <div class="a-label"><span>Збережені пресети</span></div>
                            <div id="auth-presets-list" style="display:flex;flex-direction:column;gap:7px;"></div>
                        </div>

                        <button type="button" class="a-pill auth-raw" id="btn-eco" style="text-align:center;margin-top:8px;">
                            ⚡ ECO-Режим (Вимкнути ефекти)
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Шукаємо слот як у aether.html, так і в index.html (Листі Персонажів)
        const slot = document.getElementById('aether-skin-slot') ||
                     document.querySelector('.gm-toolbar, .gm-controls, .top-bar, header, .header-bar');
        if (slot) {
            slot.appendChild(mount);
        } else {
            mount.style.position = 'fixed';
            mount.style.top = '12px';
            mount.style.right = '16px';
            document.body.appendChild(mount);
        }

        this.bindHUDEvents(mount);
        this.renderPresetsList();
        this.syncHUD();
        this.updateGMButtonVisibility();
    }

    /**
     * Транслює обраний Майстром візуал одночасно в index.html, у вбудований iframe aether.html та всім гравцям
     */
    broadcastSkinState() {
        const packet = { type: 'AETHER_SKIN_FORCE_SYNC', payload: this.state };
        if (this.channel) {
            try { this.channel.postMessage(packet); } catch (e) {}
        }
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(packet, '*');
            }
            document.querySelectorAll('iframe').forEach(ifr => {
                ifr.contentWindow?.postMessage(packet, '*');
            });
        } catch (e) {}
    }

    bindHUDEvents(mount) {
        const trigger = mount.querySelector('#auth-trigger-btn');
        const drawer = mount.querySelector('#auth-drawer');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            drawer.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!mount.contains(e.target)) drawer.classList.remove('open');
        });

        mount.querySelectorAll('.auth-tab').forEach(t => {
            t.addEventListener('click', () => {
                const target = t.dataset.tab;
                mount.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b === t));
                mount.querySelectorAll('.auth-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === target));
            });
        });

        mount.querySelectorAll('[data-bstyle]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.buttonStyle = btn.dataset.bstyle;
                this.updateColorsAndOpticsOnly();
                this.broadcastSkinState();
            });
        });

        mount.querySelectorAll('[data-mat]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.material = btn.dataset.mat;
                this.rebuildMaterialAndVinesGeometry();
                this.updateColorsAndOpticsOnly();
                this.broadcastSkinState();
            });
        });

        mount.querySelectorAll('[data-pal]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectPaletteOnly(btn.dataset.pal);
                this.broadcastSkinState();
            });
        });

        mount.querySelector('#clr-primary').addEventListener('input', (e) => {
            this.state.primary = e.target.value;
            this.updateColorsAndOpticsOnly();
        });
        mount.querySelector('#clr-secondary').addEventListener('input', (e) => {
            this.state.secondary = e.target.value;
            this.updateColorsAndOpticsOnly();
        });
        mount.querySelector('#clr-bg').addEventListener('input', (e) => {
            const hex = e.target.value;
            const rgb = this.hexToRgb(hex);
            this.state.bgDeep = hex;
            this.state.bgMid = hex;
            this.state.cardBg = `rgba(${rgb}, 0.85)`;
            this.updateColorsAndOpticsOnly();
        });

        mount.querySelector('#rng-tex-str').addEventListener('input', (e) => {
            this.state.textureStrength = parseFloat(e.target.value);
            this.rebuildMaterialAndVinesGeometry();
            this.updateColorsAndOpticsOnly();
        });
        mount.querySelector('#rng-blur').addEventListener('input', (e) => {
            this.state.blur = parseInt(e.target.value, 10);
            this.updateColorsAndOpticsOnly();
        });
        mount.querySelector('#rng-glow').addEventListener('input', (e) => {
            this.state.borderGlow = parseFloat(e.target.value);
            this.updateColorsAndOpticsOnly();
        });

        mount.querySelectorAll('[data-vstyle]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.vineStyle = btn.dataset.vstyle;
                this.rebuildMaterialAndVinesGeometry();
                this.syncHUD();
                this.saveStorage();
                this.broadcastSkinState();
            });
        });

        mount.querySelector('#rng-v-dens').addEventListener('input', (e) => {
            this.state.vineDensity = parseInt(e.target.value, 10);
            this.rebuildMaterialAndVinesGeometry();
            this.syncHUD();
            this.saveStorage();
        });

        mount.querySelector('#rng-v-reach').addEventListener('input', (e) => {
            this.state.vineReach = parseInt(e.target.value, 10);
            this.rebuildMaterialAndVinesGeometry();
            this.syncHUD();
            this.saveStorage();
        });

        mount.querySelector('#rng-v-thick').addEventListener('input', (e) => {
            this.state.vineThickness = parseFloat(e.target.value);
            this.rebuildMaterialAndVinesGeometry();
            this.syncHUD();
            this.saveStorage();
        });

        mount.querySelector('#btn-vine-sway').addEventListener('click', () => {
            this.state.vineSway = !this.state.vineSway;
            this.updateColorsAndOpticsOnly();
        });

        mount.querySelector('#btn-vine-reroll').addEventListener('click', () => {
            this.state.vineSeed = Math.floor(Math.random() * 100000);
            this.rebuildMaterialAndVinesGeometry();
            this.saveStorage();
            this.broadcastSkinState();
        });

        const inp = mount.querySelector('#inp-preset-title');
        mount.querySelector('#btn-save-preset').addEventListener('click', () => {
            const name = (inp.value || '').trim() || `Стиль #${Object.keys(this.customPresets).length + 1}`;
            const id = 'p_' + Date.now();
            this.customPresets[id] = { name, state: { ...this.state } };
            localStorage.setItem(this.STORAGE_PRESETS_KEY, JSON.stringify(this.customPresets));
            inp.value = '';
            this.renderPresetsList();
        });

        mount.querySelector('#btn-eco').addEventListener('click', () => {
            this.state.ecoMode = !this.state.ecoMode;
            this.rebuildMaterialAndVinesGeometry();
            this.updateColorsAndOpticsOnly();
        });

        const syncBtn = mount.querySelector('#auth-sync-btn');
        syncBtn.addEventListener('click', () => {
            this.broadcastSkinState();
            const orig = syncBtn.textContent;
            syncBtn.textContent = '✓ Синхронізовано';
            setTimeout(() => { syncBtn.textContent = orig; }, 1200);
        });
    }

    renderPresetsList() {
        const box = document.getElementById('auth-presets-list');
        if (!box) return;
        const entries = Object.entries(this.customPresets);
        if (!entries.length) {
            box.innerHTML = `<div style="font-size:10.5px;color:#a8a29e;">У вас ще немає збережених пресетів.</div>`;
            return;
        }
        box.innerHTML = entries.map(([id, item]) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);">
                <div style="cursor:pointer;flex:1;font-size:11px;font-weight:700;color:#fff;" data-load-p="${id}">${item.name}</div>
                <button type="button" class="auth-raw" data-del-p="${id}" style="background:rgba(255,60,80,0.2);border:1px solid rgba(255,60,80,0.5);color:#fda4af;border-radius:6px;padding:2px 8px;font-size:10px;cursor:pointer;">✕</button>
            </div>
        `).join('');

        box.querySelectorAll('[data-load-p]').forEach(el => {
            el.addEventListener('click', () => {
                const saved = this.customPresets[el.dataset.loadP]?.state;
                if (saved) {
                    this.state = { ...this.state, ...saved };
                    this.rebuildMaterialAndVinesGeometry();
                    this.updateColorsAndOpticsOnly();
                    this.broadcastSkinState();
                }
            });
        });

        box.querySelectorAll('[data-del-p]').forEach(btn => {
            btn.addEventListener('click', () => {
                delete this.customPresets[btn.dataset.delP];
                localStorage.setItem(this.STORAGE_PRESETS_KEY, JSON.stringify(this.customPresets));
                this.renderPresetsList();
            });
        });
    }

    syncHUD() {
        const m = document.getElementById('aether-auth-mount');
        if (!m) return;

        m.querySelectorAll('[data-bstyle]').forEach(el => el.classList.toggle('active', el.dataset.bstyle === (this.state.buttonStyle || 'jewel-brass')));
        m.querySelectorAll('[data-mat]').forEach(el => el.classList.toggle('active', el.dataset.mat === this.state.material));
        m.querySelectorAll('[data-pal]').forEach(el => el.classList.toggle('active', el.dataset.pal === this.state.paletteId));
        m.querySelectorAll('[data-vstyle]').forEach(el => el.classList.toggle('active', el.dataset.vstyle === this.state.vineStyle));

        const setV = (s, v) => { const el = m.querySelector(s); if (el) el.value = v; };
        const setT = (s, t) => { const el = m.querySelector(s); if (el) el.textContent = t; };

        setV('#clr-primary', this.state.primary);
        setV('#clr-secondary', this.state.secondary);
        setV('#clr-bg', this.state.bgDeep);
        setV('#rng-tex-str', this.state.textureStrength);
        setV('#rng-blur', this.state.blur);
        setV('#rng-glow', this.state.borderGlow);
        setV('#rng-v-dens', this.state.vineDensity);
        setV('#rng-v-reach', this.state.vineReach);
        setV('#rng-v-thick', this.state.vineThickness);

        setT('#lbl-tex-str', `${Math.round(this.state.textureStrength * 100)}%`);
        setT('#lbl-blur', `${this.state.blur}px`);
        setT('#lbl-glow', `${Math.round(this.state.borderGlow * 100)}%`);
        setT('#lbl-v-dens', `${this.state.vineDensity}%`);
        setT('#lbl-v-reach', `${this.state.vineReach}px`);
        setT('#lbl-v-thick', `${this.state.vineThickness}px`);

        m.querySelector('#btn-vine-sway')?.classList.toggle('active', Boolean(this.state.vineSway));
        m.querySelector('#btn-eco')?.classList.toggle('active', Boolean(this.state.ecoMode));
    }

    /**
     * Забезпечує миттєву синхронізацію між index.html (Листом Персонажів) та aether.html
     */
    initCrossWindowSync() {
        const applyIncoming = (payload) => {
            if (!payload) return;
            this.state = { ...this.state, ...payload };
            this.rebuildMaterialAndVinesGeometry();
            this.updateColorsAndOpticsOnly();
        };

        try {
            this.channel = new BroadcastChannel(this.SYNC_CHANNEL);
            this.channel.addEventListener('message', (e) => {
                if (e.data && e.data.type === 'AETHER_SKIN_FORCE_SYNC') {
                    applyIncoming(e.data.payload);
                }
            });
        } catch (e) {}

        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'AETHER_SKIN_FORCE_SYNC') {
                applyIncoming(e.data.payload);
            }
        });

        window.addEventListener('storage', (e) => {
            if (e.key === this.STORAGE_STATE_KEY && e.newValue) {
                try { applyIncoming(JSON.parse(e.newValue)); } catch (err) {}
            }
            this.updateGMButtonVisibility();
        });
    }

    /**
     * Слідкує за перемиканням ECO-режиму та входом/виходом у режим Майстра (GM-mode)
     */
    observeEcoAndGMStatus() {
        const attach = () => {
            if (!document.body) return;
            const obs = new MutationObserver(() => {
                const isEco = document.body.classList.contains('eco-mode') || document.body.getAttribute('data-eco') === 'true';
                if (isEco !== this.state.ecoMode) {
                    this.state.ecoMode = isEco;
                    this.rebuildMaterialAndVinesGeometry();
                    this.updateColorsAndOpticsOnly();
                }
                this.updateGMButtonVisibility();
            });
            obs.observe(document.body, { attributes: true, subtree: false, attributeFilter: ['class', 'data-eco', 'data-role', 'data-gm'] });
        };
        document.body ? attach() : document.addEventListener('DOMContentLoaded', attach);
    }
}

window.AetherSkins = new AetherAuthenticStudio();