/**
 * AETHER_v8.5_CORE_FINAL — Reference Masterpiece Skin & Environment Engine
 * File: aether_skins.js
 * Key Fixes:
 *  - ZERO LAG (100% GPU-accelerated CSS/SVG layers, no heavy Canvas shadowBlur loops)
 *  - NON-DESTRUCTIVE PALETTE SWITCHING (changing colors never resets your Hull, Background, or Flora settings)
 *  - BACKGROUND-ONLY FLORA & CRYSTALS (strictly behind UI in empty table spaces, never blocks buttons/text)
 *  - FULL SCENE & ELEMENT TRANSFORMATION (transforms global backgrounds, buttons, orbs, inputs, cards & table)
 */

class AetherReferenceEngine {
    constructor() {
        this.STORAGE_STATE_KEY = 'aether_v85_ref_master_state';
        this.STORAGE_PRESETS_KEY = 'aether_v85_ref_custom_presets';
        this.SYNC_CHANNEL = 'entropia_ark_sync_channel';

        // 1. ARCHETYPES (Повні візуальні образи прямо з твоїх референсів — міняють ВСЕ: фон, кнопки, орби, картки)
        this.archetypes = {
            'sunset-alpenglow': {
                name: 'Sunset Alpenglow UI',
                ref: 'Референс 9, 10, 11 (Гірський захід & Сфери)',
                desc: 'Панорамний сутінковий фон з силуетами гір, опуклі сферичні орби-індикатори та м’які неоморфні слоти'
            },
            'liquid-glass-os': {
                name: 'Liquid Glass Foundations',
                ref: 'Референс 12 (Дисперсне оптичне скло)',
                desc: 'Товсті акрилові лінзи з подвійним райдужним заломленням граней, круглі фішки-кнопки та чиста геометрія'
            },
            'antariksa-bento': {
                name: 'Antariksa Bento Capsule',
                ref: 'Референс 5 (Контрастні Bento-капсули)',
                desc: 'Архітектурні блоки з вирізами, контрастні світлі плашки заголовків, пігулки-кнопки та тонкі треки'
            },
            'forest-filigree': {
                name: 'Lanm & Reapum Filigree',
                ref: 'Референс 7 (Золоті стели в лісі)',
                desc: 'Витончені скляні стели з подвійною золотою рамкою, тонкими астро-кільцями та живими гілками позаду'
            },
            'biolume-geode': {
                name: 'Biolume Crystal Geode',
                ref: 'Референс 13 (Кристалічні друзи & Неоморфізм)',
                desc: 'Глибокі втиснуті слоти, грановані кристалічні акценти у вільних зонах столу та біо-сяйво'
            },
            'luxury-satin': {
                name: 'Luxury Diagonal Satin',
                ref: 'Референс 1, 8 (Сатиновий метал & Мармур)',
                desc: 'Гострі преміальні грані з діагональним металевим бліком, мармурові жили на тлі та тонкі золоті розділювачі'
            }
        };

        // 2. PALETTES (18 точних кольорових палітр із твоїх референсів — міняють ТІЛЬКИ кольори, нічого не скидають!)
        this.palettes = {
            // Із Референсів 9, 10, 11 (Sunset UI)
            'alpenglow-peach': {
                name: 'Alpenglow Peach & Dusk',
                group: 'Sunset & Liquid',
                bgDeep: '#161421', bgMid: '#282138', cardBg: 'rgba(32, 27, 46, 0.78)',
                primary: '#ff9e7d', secondary: '#c084fc', textMain: '#fff6f2', textMuted: '#a699b8'
            },
            // Із Референсу 12 (Liquid Glass)
            'prism-sky-coral': {
                name: 'Liquid Prism Sky & Coral',
                group: 'Sunset & Liquid',
                bgDeep: '#0f172a', bgMid: '#1e293b', cardBg: 'rgba(25, 38, 64, 0.62)',
                primary: '#38bdf8', secondary: '#fb923c', textMain: '#f8fafc', textMuted: '#94a3b8'
            },
            // Із Референсу 5 (Antariksa)
            'antariksa-teal': {
                name: 'Antariksa Cosmic Teal',
                group: 'Sunset & Liquid',
                bgDeep: '#041f26', bgMid: '#08333c', cardBg: 'rgba(8, 51, 60, 0.84)',
                primary: '#2dd4bf', secondary: '#e2f1f0', textMain: '#f0fdfa', textMuted: '#86bdb8'
            },
            // Із Референсу 7 (Forest Filigree)
            'forest-gold-rose': {
                name: 'Enchanted Gold & Blossom',
                group: 'Forest & Geode',
                bgDeep: '#08120e', bgMid: '#12241b', cardBg: 'rgba(12, 26, 20, 0.74)',
                primary: '#ffd166', secondary: '#ff8da1', textMain: '#fdfbf7', textMuted: '#9eb8a8'
            },
            // Із Референсу 13 (Biolume Crystal)
            'crystal-cyan-violet': {
                name: 'Crystal Geode Cyan & Violet',
                group: 'Forest & Geode',
                bgDeep: '#100a20', bgMid: '#1c1236', cardBg: 'rgba(24, 15, 46, 0.82)',
                primary: '#00f5d4', secondary: '#9b5de5', textMain: '#ebfffc', textMuted: '#8f7db5'
            },
            'irminsul-emerald': {
                name: 'Irminsul Bio-Emerald',
                group: 'Forest & Geode',
                bgDeep: '#04120b', bgMid: '#0a2618', cardBg: 'rgba(8, 28, 18, 0.78)',
                primary: '#00ff88', secondary: '#00d4ff', textMain: '#ecfff5', textMuted: '#72ab8e'
            },
            // Із Референсу 1 (Sage, Sand, Emerald, Plum, Stone)
            'mineral-sage': {
                name: 'Mineral Sage & Olive',
                group: 'Mineral & Luxury',
                bgDeep: '#141e22', bgMid: '#213136', cardBg: 'rgba(28, 42, 46, 0.82)',
                primary: '#a3bfa8', secondary: '#d9c3b0', textMain: '#f2f7f4', textMuted: '#8da39b'
            },
            'mineral-sand-gold': {
                name: 'Warm Sand & Travertine',
                group: 'Mineral & Luxury',
                bgDeep: '#1f1914', bgMid: '#332921', cardBg: 'rgba(46, 37, 29, 0.82)',
                primary: '#e6c5a3', secondary: '#c29b70', textMain: '#fcf8f2', textMuted: '#b8a38f'
            },
            'mineral-stone-vein': {
                name: 'Black Stone & Gold Vein',
                group: 'Mineral & Luxury',
                bgDeep: '#100f0d', bgMid: '#1c1a16', cardBg: 'rgba(24, 22, 18, 0.86)',
                primary: '#d4af37', secondary: '#8c7355', textMain: '#faf6ed', textMuted: '#9e9280'
            },
            // Із Референсу 8 (Luxury Color)
            'luxury-01-petrol': {
                name: 'Luxury #01 Petrol & Bronze',
                group: 'Mineral & Luxury',
                bgDeep: '#061014', bgMid: '#09171e', cardBg: 'rgba(9, 23, 30, 0.86)',
                primary: '#cea17a', secondary: '#3e4e56', textMain: '#f7f2ed', textMuted: '#8799a1'
            },
            'luxury-05-forest': {
                name: 'Luxury #05 Imperial Green',
                group: 'Mineral & Luxury',
                bgDeep: '#0d1a15', bgMid: '#1e362d', cardBg: 'rgba(22, 42, 35, 0.85)',
                primary: '#b59e7a', secondary: '#4d7a68', textMain: '#f4f7f5', textMuted: '#8ba399'
            },
            'luxury-08-crimson': {
                name: 'Luxury #08 Velvet Ruby',
                group: 'Mineral & Luxury',
                bgDeep: '#1c040b', bgMid: '#380816', cardBg: 'rgba(46, 7, 18, 0.85)',
                primary: '#ff4d6d', secondary: '#e0b1cb', textMain: '#fff0f3', textMuted: '#bd7e8d'
            },
            // Із Референсу 3 (Ruins in the Woods)
            'ruins-amethyst': {
                name: 'Eldritch Amethyst',
                group: 'Ruins & Shades of Black',
                bgDeep: '#110b17', bgMid: '#1f1529', cardBg: 'rgba(27, 18, 36, 0.85)',
                primary: '#b57edc', secondary: '#d8dbe2', textMain: '#f5f0fa', textMuted: '#9681ab'
            },
            'ruins-plum': {
                name: 'Profaned Plum',
                group: 'Ruins & Shades of Black',
                bgDeep: '#1a0910', bgMid: '#2e101c', cardBg: 'rgba(38, 13, 23, 0.85)',
                primary: '#d96b8a', secondary: '#c9a275', textMain: '#faedf0', textMuted: '#ab7987'
            },
            'ruins-frosted-night': {
                name: 'Frosted Night & Silver Mist',
                group: 'Ruins & Shades of Black',
                bgDeep: '#0b131e', bgMid: '#182638', cardBg: 'rgba(20, 33, 48, 0.84)',
                primary: '#8bb4db', secondary: '#d8dde3', textMain: '#f0f5fa', textMuted: '#8298b0'
            },
            // Із Референсу 2 & 4 (10 Shades of Black & Dark Mood Blue)
            'black-obsidian-03': {
                name: 'Obsidian & Silver #03',
                group: 'Ruins & Shades of Black',
                bgDeep: '#050608', bgMid: '#0d0f14', cardBg: 'rgba(13, 15, 20, 0.88)',
                primary: '#e2e8f0', secondary: '#64748b', textMain: '#f8fafc', textMuted: '#7f8ea3'
            },
            'black-moss-09': {
                name: 'Moss Black #09',
                group: 'Ruins & Shades of Black',
                bgDeep: '#0a0e0c', bgMid: '#151c19', cardBg: 'rgba(19, 26, 23, 0.88)',
                primary: '#7fa896', secondary: '#495e54', textMain: '#edf5f1', textMuted: '#7b9187'
            },
            'dark-mood-blue': {
                name: 'Dark Mood Midnight Blue',
                group: 'Ruins & Shades of Black',
                bgDeep: '#090d14', bgMid: '#121820', cardBg: 'rgba(18, 24, 34, 0.86)',
                primary: '#5e88bf', secondary: '#a7b7c9', textMain: '#f0f6fc', textMuted: '#798faf'
            }
        };

        // 3. SCENIC BACKGROUNDS (Заповнюють ту саму порожню область Етера позаду карток!)
        this.scenicBgs = {
            'alpenglow-mountains': { name: 'Гірський Горизонт (Ref 9, 10)' },
            'marble-gold-stone': { name: 'Мармур із Золотими Жилами (Ref 1)' },
            'luxury-satin-beams': { name: 'Діагональні Сатинові Промені (Ref 8)' },
            'velvet-ruins-fog': { name: 'Оксамитовий Туман Руїн (Ref 3)' },
            'cosmic-bento-grid': { name: 'Топографія Космосу (Ref 5)' },
            'deep-obsidian-void': { name: 'Чистий Глибокий Онікс (Ref 2)' }
        };

        // 4. FLORA & AMBIENT ARTIFACTS (Малюються ТІЛЬКИ на фоні у вільних кутах/краях, не перекривають кнопки!)
        this.floraTypes = {
            'golden-vines': { name: 'Тонкі Золоті Лози з Бутонами (Ref 7)' },
            'crystal-clusters': { name: 'Кристалічні Друзи по Кутах (Ref 13)' },
            'irminsul-roots': { name: 'Біо-Коріння Ірмінсуля' },
            'ruins-thorns': { name: 'Містичні Гілки Руїн (Ref 3)' },
            'none': { name: 'Без Флори (Чистий Фон)' }
        };

        // Дефолтний стан (кожен шар незалежний!)
        this.state = {
            activeTab: 'archetypes',
            archetype: 'sunset-alpenglow',
            paletteId: 'alpenglow-peach',
            scenicBg: 'alpenglow-mountains',
            // Кольори (оновлюються при виборі палітри або пікерами)
            bgDeep: '#161421',
            bgMid: '#282138',
            cardBg: 'rgba(32, 27, 46, 0.78)',
            primary: '#ff9e7d',
            secondary: '#c084fc',
            textMain: '#fff6f2',
            textMuted: '#a699b8',
            // Оптика та геометрія
            blur: 18,
            radius: 18,
            glow: 1.0,
            surfacePattern: 'satin', // 'clean', 'satin', 'marble', 'velvet', 'hex'
            // Флора позаду інтерфейсу
            floraType: 'golden-vines',
            floraDensity: 45,        // 0 - 100% (обрамлення по периметру екрана позаду UI)
            ambientSpores: true,     // CSS-світлячки у фоні
            ecoMode: false
        };

        this.customPresets = {};
        this.init();
    }

    init() {
        this.loadStorage();
        this.injectMasterCSS();
        this.initBroadcastSync();
        this.observeEcoMode();

        const boot = () => {
            this.mountScenicBackdrop();
            this.mountHUD();
            this.applyAll(true);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
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

    hexToRgb(hex) {
        const h = (hex || '#ff9e7d').replace('#', '');
        const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
        return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    }

    /**
     * Ін'єкція високопродуктивного CSS (нуль лагів, повна трансформація фону, кнопок, орбів та карток)
     */
    injectMasterCSS() {
        if (document.getElementById('aether-ref-master-css')) return;
        const style = document.createElement('style');
        style.id = 'aether-ref-master-css';
        style.textContent = `
            :root {
                --bg-deep: #161421;
                --bg-mid: #282138;
                --bg-panel: rgba(32, 27, 46, 0.78);
                --bg-panel-solid: #161421;
                --neon-vine: #ff9e7d;
                --neon-secondary: #c084fc;
                --primary-rgb: 255, 158, 125;
                --secondary-rgb: 192, 132, 252;
                --text-main: #fff6f2;
                --text-muted: #a699b8;
                --border-base: rgba(255, 158, 125, 0.32);
                --border-hover: rgba(255, 158, 125, 0.85);
                --skin-blur: 18px;
                --skin-radius: 18px;
                --skin-glow: 1;
            }

            /* =================================================================
               1. ГЛОБАЛЬНИЙ АТМОСФЕРНИЙ BACKDROP (ЗАПОВНЮЄ ПОРОЖНІ ЗОНИ ЕТЕРА)
               Строго позаду всіх елементів керування (pointer-events: none; z-index: 0)
               ================================================================= */
            body, html {
                background-color: var(--bg-deep) !important;
                color: var(--text-main) !important;
            }

            #aether-scenic-backdrop {
                position: fixed;
                inset: 0;
                width: 100vw;
                height: 100vh;
                pointer-events: none !important;
                z-index: 0 !important;
                overflow: hidden;
                transition: background 0.5s ease;
            }

            /* Переконуємось, що всі панелі та ігровий стіл лежать ПОВЕРХ фону і флори */
            .top-bar, .glass-card, .game-table-oval, [class*="panel"], [class*="sidebar"], [class*="modal"] {
                position: relative;
                z-index: 5;
            }

            /* --- СЦЕНІЧНІ ФОНИ ЗА РЕФЕРЕНСАМИ --- */
            /* А. Гірський захід із сонцем/місяцем (Ref 9, 10, 11) */
            #aether-scenic-backdrop[data-scene="alpenglow-mountains"] {
                background: 
                    radial-gradient(circle at 50% 34%, rgba(var(--primary-rgb), 0.42) 0%, rgba(var(--secondary-rgb), 0.18) 28%, transparent 62%),
                    linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-mid) 55%, var(--bg-deep) 100%);
            }

            /* Б. Мармур із золотими/мінеральними жилами (Ref 1) */
            #aether-scenic-backdrop[data-scene="marble-gold-stone"] {
                background: 
                    radial-gradient(ellipse at 20% 20%, rgba(var(--primary-rgb), 0.15) 0%, transparent 55%),
                    radial-gradient(ellipse at 80% 80%, rgba(var(--secondary-rgb), 0.12) 0%, transparent 55%),
                    linear-gradient(135deg, var(--bg-deep) 0%, var(--bg-mid) 50%, var(--bg-deep) 100%);
            }

            /* В. Діагональні промені Luxury Satin (Ref 8) */
            #aether-scenic-backdrop[data-scene="luxury-satin-beams"] {
                background: 
                    repeating-linear-gradient(
                        -28deg,
                        rgba(255, 255, 255, 0.015) 0px,
                        rgba(var(--primary-rgb), 0.06) 2px,
                        transparent 3px,
                        transparent 90px
                    ),
                    linear-gradient(145deg, var(--bg-deep) 0%, var(--bg-mid) 48%, #040507 100%);
            }

            /* Г. Оксамитовий туман Руїн (Ref 3) */
            #aether-scenic-backdrop[data-scene="velvet-ruins-fog"] {
                background: 
                    radial-gradient(circle at 50% 15%, rgba(var(--secondary-rgb), 0.16) 0%, transparent 50%),
                    radial-gradient(circle at 15% 85%, rgba(var(--primary-rgb), 0.18) 0%, transparent 55%),
                    radial-gradient(circle at 85% 80%, rgba(var(--primary-rgb), 0.14) 0%, transparent 55%),
                    var(--bg-deep);
            }

            /* Д. Топографія Космосу Antariksa (Ref 5) */
            #aether-scenic-backdrop[data-scene="cosmic-bento-grid"] {
                background: 
                    radial-gradient(circle at 50% 50%, rgba(var(--primary-rgb), 0.18) 0%, transparent 68%),
                    linear-gradient(rgba(var(--primary-rgb), 0.04) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(var(--primary-rgb), 0.04) 1px, transparent 1px),
                    var(--bg-deep);
                background-size: 100% 100%, 48px 48px, 48px 48px;
            }

            /* Е. Чистий Глибокий Онікс (Ref 2) */
            #aether-scenic-backdrop[data-scene="deep-obsidian-void"] {
                background: radial-gradient(circle at 50% 50%, var(--bg-mid) 0%, var(--bg-deep) 85%);
            }

            /* Вбудований SVG-шар гір, мармурових жил та живої флори (GPU-прискорений) */
            #aether-scenic-svg {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
            }

            @keyframes gentleFloraSway {
                0%, 100% { transform: rotate(0deg) scale(1); }
                50% { transform: rotate(1.2deg) scale(1.015); }
            }

            .scenic-flora-group {
                transform-origin: center;
                animation: gentleFloraSway 9s ease-in-out infinite;
                will-change: transform;
            }

            @keyframes sporeFloat {
                0%, 100% { transform: translateY(0px); opacity: 0.35; }
                50% { transform: translateY(-14px); opacity: 0.9; }
            }

            .scenic-spore {
                animation: sporeFloat 6s ease-in-out infinite;
            }

            /* Синхронізація існуючих ліан Етера з новою палітрою */
            svg path[class*="vine"], svg path[id*="vine"], .vine-path, .aether-vine {
                stroke: var(--neon-vine) !important;
                transition: stroke 0.35s ease;
            }

            /* =================================================================
               2. ТРАНСФОРМАЦІЯ КАРТОК, КНОПОК ТА СФЕР ПІД 6 ОБРАЗІВ З РЕФЕРЕНСІВ
               ================================================================= */
            .glass-card, .top-bar {
                background: var(--bg-panel) !important;
                backdrop-filter: blur(var(--skin-blur)) saturate(150%) !important;
                -webkit-backdrop-filter: blur(var(--skin-blur)) saturate(150%) !important;
                border: 1px solid var(--border-base) !important;
                color: var(--text-main) !important;
                border-radius: var(--skin-radius) !important;
                transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease !important;
            }

            /* Поверхневі мікро-текстури на плашках */
            .glass-card::before {
                content: "";
                position: absolute;
                inset: 0;
                border-radius: inherit;
                pointer-events: none;
                z-index: 0;
                opacity: 0.75;
            }

            body[data-pattern="satin"] .glass-card::before {
                background: linear-gradient(125deg, rgba(255,255,255,0.07) 0%, transparent 42%, rgba(var(--primary-rgb), 0.06) 100%);
            }
            body[data-pattern="marble"] .glass-card::before {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Cpath d='M0 40 Q 60 65 110 20 T 200 50 M40 200 Q 90 130 150 160 T 200 110' fill='none' stroke='%23ffffff' stroke-opacity='0.06' stroke-width='1.2'/%3E%3C/svg%3E");
                background-size: 200px 200px;
            }
            body[data-pattern="velvet"] .glass-card::before {
                background: radial-gradient(circle at 50% 0%, rgba(var(--primary-rgb), 0.12), rgba(0,0,0,0.45));
            }
            body[data-pattern="hex"] .glass-card::before {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cpath fill='%23ffffff' fill-opacity='0.04' d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9z'/%3E%3C/svg%3E");
            }

            /* --- ОБРАЗ 1: SUNSET ALPENGLOW UI (Референси 9, 10, 11) --- */
            body[data-archetype="sunset-alpenglow"] .glass-card {
                box-shadow: 
                    0 18px 42px rgba(0, 0, 0, 0.75),
                    inset 0 1.5px 1px rgba(255, 255, 255, 0.28),
                    inset 0 -2px 12px rgba(var(--primary-rgb), 0.14) !important;
            }
            /* Кнопки та індикатори перетворюються на об'ємні сферичні лінзи з бліком зверху */
            body[data-archetype="sunset-alpenglow"] .glass-card button:not(.studio-raw),
            body[data-archetype="sunset-alpenglow"] .top-bar button:not(.studio-raw) {
                border-radius: 999px !important;
                background: radial-gradient(circle at 50% 18%, rgba(255,255,255,0.32), rgba(var(--primary-rgb), 0.28) 55%, rgba(0,0,0,0.55) 100%) !important;
                border: 1px solid rgba(var(--primary-rgb), 0.55) !important;
                box-shadow: 
                    0 4px 14px rgba(0,0,0,0.5),
                    0 0 calc(12px * var(--skin-glow)) rgba(var(--primary-rgb), 0.3),
                    inset 0 2px 2px rgba(255,255,255,0.45) !important;
                color: var(--text-main) !important;
            }

            /* --- ОБРАЗ 2: LIQUID GLASS OS (Референс 12) --- */
            body[data-archetype="liquid-glass-os"] .glass-card {
                background: linear-gradient(
                    135deg,
                    rgba(var(--primary-rgb), 0.20) 0%,
                    var(--bg-panel) 50%,
                    rgba(var(--secondary-rgb), 0.18) 100%
                ) !important;
                border: 1.5px solid rgba(255, 255, 255, 0.32) !important;
                box-shadow: 
                    0 20px 50px rgba(0, 0, 0, 0.65),
                    0 0 calc(25px * var(--skin-glow)) rgba(var(--primary-rgb), 0.25),
                    inset 0 2px 2px rgba(255, 255, 255, 0.6),
                    inset 0 -2px 4px rgba(var(--secondary-rgb), 0.45) !important;
            }
            body[data-archetype="liquid-glass-os"] .glass-card button:not(.studio-raw) {
                border-radius: 14px !important;
                background: linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.06)) !important;
                border: 1px solid rgba(255,255,255,0.38) !important;
                box-shadow: inset 0 1px 1px rgba(255,255,255,0.6), 0 6px 14px rgba(0,0,0,0.35) !important;
            }

            /* --- ОБРАЗ 3: ANTARIKSA BENTO CAPSULE (Референс 5) --- */
            body[data-archetype="antariksa-bento"] .glass-card {
                border-radius: 22px !important;
                border: 2px solid var(--neon-vine) !important;
                outline: 1px solid rgba(var(--secondary-rgb), 0.35);
                outline-offset: -7px;
                box-shadow: 0 14px 32px rgba(0, 0, 0, 0.8) !important;
            }
            body[data-archetype="antariksa-bento"] .glass-card button:not(.studio-raw) {
                border-radius: 999px !important;
                background: var(--neon-secondary) !important;
                color: var(--bg-deep) !important;
                font-weight: 800 !important;
                letter-spacing: 0.6px !important;
                border: 2px solid var(--neon-vine) !important;
                box-shadow: 0 4px 0 var(--neon-vine) !important;
            }

            /* --- ОБРАЗ 4: LANM & REAPUM FOREST FILIGREE (Референс 7) --- */
            body[data-archetype="forest-filigree"] .glass-card {
                border-radius: 6px !important;
                border: 1px solid var(--neon-vine) !important;
                outline: 1px solid rgba(var(--primary-rgb), 0.42);
                outline-offset: -5px;
                box-shadow: 
                    0 16px 44px rgba(0, 0, 0, 0.85),
                    0 0 calc(20px * var(--skin-glow)) rgba(var(--primary-rgb), 0.22),
                    inset 0 0 24px rgba(var(--primary-rgb), 0.10) !important;
            }
            body[data-archetype="forest-filigree"] .glass-card button:not(.studio-raw) {
                border-radius: 999px !important;
                background: rgba(0, 0, 0, 0.45) !important;
                border: 1px solid var(--neon-vine) !important;
                box-shadow: inset 0 0 8px rgba(var(--primary-rgb), 0.28) !important;
            }

            /* --- ОБРАЗ 5: BIOLUME CRYSTAL GEODE (Референс 13) --- */
            body[data-archetype="biolume-geode"] .glass-card {
                border-radius: 20px !important;
                border: 1px solid rgba(var(--secondary-rgb), 0.45) !important;
                box-shadow: 
                    10px 10px 28px rgba(0, 0, 0, 0.9),
                    -4px -4px 16px rgba(var(--primary-rgb), 0.08),
                    inset 2px 2px 6px rgba(0, 0, 0, 0.75),
                    inset -1px -1px 2px rgba(var(--primary-rgb), 0.3) !important;
            }
            body[data-archetype="biolume-geode"] .glass-card button:not(.studio-raw) {
                clip-path: polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0% 50%);
                background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.35), rgba(var(--secondary-rgb), 0.35)) !important;
                border: none !important;
                padding-left: 14px !important;
                padding-right: 14px !important;
            }

            /* --- ОБРАЗ 6: LUXURY DIAGONAL SATIN (Референс 1, 8) --- */
            body[data-archetype="luxury-satin"] .glass-card {
                border-radius: 2px !important;
                border: 1px solid rgba(var(--primary-rgb), 0.5) !important;
                border-bottom: 3px solid var(--neon-vine) !important;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.92), inset 0 1px 0 rgba(255, 255, 255, 0.25) !important;
            }
            body[data-archetype="luxury-satin"] .glass-card button:not(.studio-raw) {
                border-radius: 2px !important;
                background: linear-gradient(115deg, rgba(var(--primary-rgb), 0.28), rgba(0,0,0,0.8)) !important;
                border: 1px solid var(--neon-vine) !important;
                text-transform: uppercase !important;
                letter-spacing: 1px !important;
            }

            /* --- ОВАЛ ІГРОВОГО СТОЛУ (.game-table-oval) --- */
            .game-table-oval {
                background: radial-gradient(
                    ellipse at center,
                    rgba(var(--primary-rgb), 0.18) 0%,
                    rgba(var(--secondary-rgb), 0.08) 48%,
                    rgba(0, 0, 0, 0.4) 100%
                ) !important;
                border: 1.5px solid var(--border-base) !important;
                box-shadow: 
                    0 0 calc(55px * var(--skin-glow)) rgba(var(--primary-rgb), 0.24),
                    inset 0 0 calc(40px * var(--skin-glow)) rgba(var(--primary-rgb), 0.16) !important;
            }

            /* --- ECO-РЕЖИМ --- */
            body.eco-mode #aether-scenic-svg { display: none !important; }
            body.eco-mode .glass-card, body.eco-mode .top-bar {
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                background: var(--bg-panel-solid) !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.85) !important;
            }

            /* =================================================================
               3. ПАНЕЛЬ НАЛАШТУВАНЬ (STUDIO DRAWER З ПОВНИМ СКРОЛОМ)
               ================================================================= */
            .aether-master-mount {
                position: relative;
                display: inline-flex;
                align-items: center;
                margin-left: 10px;
                z-index: 99999;
                font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
            }

            .master-orb-btn {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 6px 14px;
                border-radius: 999px;
                background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.28), rgba(0, 0, 0, 0.8));
                border: 1px solid var(--neon-vine);
                color: var(--text-main);
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1px;
                cursor: pointer;
                box-shadow: 0 0 16px rgba(var(--primary-rgb), 0.3);
            }

            .master-orb-dot {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: linear-gradient(135deg, var(--neon-vine), var(--neon-secondary));
                box-shadow: 0 0 8px var(--neon-vine);
            }

            .master-drawer {
                position: fixed;
                top: 56px;
                right: 16px;
                width: 400px;
                max-width: calc(100vw - 24px);
                height: calc(100vh - 74px);
                max-height: 760px;
                display: none;
                flex-direction: column;
                border-radius: 18px;
                background: rgba(12, 14, 20, 0.96);
                backdrop-filter: blur(24px);
                -webkit-backdrop-filter: blur(24px);
                border: 1px solid var(--neon-vine);
                box-shadow: 0 24px 64px rgba(0, 0, 0, 0.92), 0 0 32px rgba(var(--primary-rgb), 0.22);
                color: #f8fafc;
                overflow: hidden;
                z-index: 99999;
            }

            .master-drawer.open {
                display: flex;
            }

            .master-header {
                padding: 13px 16px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-shrink: 0;
            }

            .master-title {
                font-size: 12px;
                font-weight: 800;
                letter-spacing: 1.4px;
                text-transform: uppercase;
                color: var(--neon-vine);
            }

            .master-tabs {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 4px;
                padding: 8px 12px;
                background: rgba(0, 0, 0, 0.45);
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                flex-shrink: 0;
            }

            .master-tab {
                padding: 7px 4px;
                border-radius: 8px;
                border: 1px solid transparent;
                background: transparent;
                color: #94a3b8;
                font-size: 10.5px;
                font-weight: 700;
                cursor: pointer;
                text-align: center;
            }

            .master-tab.active {
                background: rgba(var(--primary-rgb), 0.22);
                border-color: var(--neon-vine);
                color: #fff;
            }

            .master-scroll-body {
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

            .master-scroll-body::-webkit-scrollbar { width: 6px; }
            .master-scroll-body::-webkit-scrollbar-thumb {
                background: var(--neon-vine);
                border-radius: 6px;
            }

            .master-pane {
                display: none;
                flex-direction: column;
                gap: 14px;
            }
            .master-pane.active { display: flex; }

            .sec-lbl {
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 1.2px;
                color: #94a3b8;
                margin-bottom: 6px;
                display: flex;
                justify-content: space-between;
            }

            .archetype-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .archetype-card {
                padding: 10px 12px;
                border-radius: 11px;
                background: rgba(255, 255, 255, 0.035);
                border: 1px solid rgba(255, 255, 255, 0.1);
                cursor: pointer;
                text-align: left;
                transition: all 0.18s ease;
            }
            .archetype-card:hover {
                border-color: rgba(var(--primary-rgb), 0.55);
                background: rgba(255, 255, 255, 0.06);
            }
            .archetype-card.active {
                background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.22), rgba(0, 0, 0, 0.65));
                border-color: var(--neon-vine);
                box-shadow: 0 0 14px rgba(var(--primary-rgb), 0.25);
            }

            .arch-name { font-size: 12px; font-weight: 800; color: #fff; }
            .arch-ref { font-size: 10px; color: var(--neon-vine); font-weight: 600; margin-top: 2px; }
            .arch-desc { font-size: 10px; color: #cbd5e1; margin-top: 4px; line-height: 1.35; }

            .palette-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 7px;
            }

            .palette-card {
                padding: 8px 9px;
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.09);
                cursor: pointer;
                text-align: left;
                display: flex;
                flex-direction: column;
                gap: 5px;
            }
            .palette-card.active {
                border-color: var(--neon-vine);
                background: rgba(var(--primary-rgb), 0.18);
            }

            .swatches { display: flex; gap: 5px; align-items: center; }
            .sw-dot { width: 13px; height: 13px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.4); }

            .pill-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px;
            }

            .m-pill {
                padding: 8px 9px;
                border-radius: 9px;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #f1f5f9;
                font-size: 10.5px;
                font-weight: 600;
                cursor: pointer;
                text-align: left;
            }
            .m-pill.active {
                background: rgba(var(--primary-rgb), 0.24);
                border-color: var(--neon-vine);
                color: #fff;
            }

            .m-range {
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 6px;
                border-radius: 99px;
                background: rgba(255, 255, 255, 0.14);
                outline: none;
            }
            .m-range::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 15px;
                height: 15px;
                border-radius: 50%;
                background: var(--neon-vine);
                border: 2px solid #fff;
                cursor: pointer;
            }

            .color-pickers-row {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 7px;
            }
            .c-pick-box {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                padding: 6px;
                border-radius: 9px;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.08);
                font-size: 10px;
            }
            .c-pick-box input {
                width: 100%;
                height: 24px;
                border: none;
                background: transparent;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Створює фоновий сценічний шар (#aether-scenic-backdrop) строго ПОЗАДУ інтерфейсу
     */
    mountScenicBackdrop() {
        if (document.getElementById('aether-scenic-backdrop')) return;
        const backdrop = document.createElement('div');
        backdrop.id = 'aether-scenic-backdrop';
        backdrop.innerHTML = `<svg id="aether-scenic-svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice"></svg>`;
        document.body.prepend(backdrop);
    }

    /**
     * Генерує легку векторну сцену (гори Sunset UI, золоті жили мармуру, кристалічні друзи або ліани)
     * Викликається ТІЛЬКИ при зміні налаштувань (0% навантаження на CPU під час гри!)
     */
    renderScenicSVG() {
        const svg = document.getElementById('aether-scenic-svg');
        const backdrop = document.getElementById('aether-scenic-backdrop');
        if (!svg || !backdrop) return;

        backdrop.setAttribute('data-scene', this.state.scenicBg);

        if (this.state.ecoMode) {
            svg.innerHTML = '';
            return;
        }

        const pColor = this.state.primary;
        const sColor = this.state.secondary;
        const density = Number(this.state.floraDensity) || 0;
        let html = `
            <defs>
                <linearGradient id="mountainGrad1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${pColor}" stop-opacity="0.22"/>
                    <stop offset="100%" stop-color="${this.state.bgDeep}" stop-opacity="0.95"/>
                </linearGradient>
                <linearGradient id="mountainGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${sColor}" stop-opacity="0.18"/>
                    <stop offset="100%" stop-color="${this.state.bgDeep}" stop-opacity="0.98"/>
                </linearGradient>
                <linearGradient id="vineGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="${pColor}"/>
                    <stop offset="100%" stop-color="${sColor}"/>
                </linearGradient>
            </defs>
        `;

        // 1. Сценічні елементи фону (відповідно до обраного фону з референсів)
        if (this.state.scenicBg === 'alpenglow-mountains') {
            // Сонце/Місяць та багатошарові гори з Референсів 9, 10, 11
            html += `
                <circle cx="960" cy="360" r="170" fill="${pColor}" fill-opacity="0.18"/>
                <circle cx="960" cy="360" r="115" fill="${pColor}" fill-opacity="0.28"/>
                <circle cx="1010" cy="340" r="32" fill="#ffffff" fill-opacity="0.45"/>
                <path d="M0,1080 L0,690 L240,520 L450,650 L710,430 L960,590 L1230,410 L1490,610 L1720,470 L1920,620 L1920,1080 Z" fill="url(#mountainGrad2)"/>
                <path d="M0,1080 L0,780 L180,670 L390,770 L620,580 L890,740 L1140,560 L1410,730 L1660,610 L1920,740 L1920,1080 Z" fill="url(#mountainGrad1)"/>
            `;
        } else if (this.state.scenicBg === 'marble-gold-stone') {
            // Золоті прожилки на темному мармурі з Референсу 1 (STONE / EMERALD)
            html += `
                <g stroke="url(#vineGrad)" fill="none" stroke-opacity="0.28">
                    <path d="M-50,180 Q320,240 580,90 T1180,220 T1970,80" stroke-width="2"/>
                    <path d="M580,90 Q720,380 510,640 T890,1100" stroke-width="1.2"/>
                    <path d="M-40,840 Q420,710 880,920 T1960,760" stroke-width="1.8"/>
                    <path d="M1180,220 Q1340,510 1620,440 T1970,680" stroke-width="1.1"/>
                </g>
            `;
        }

        // 2. Неонова флора або кристали (ТІЛЬКИ по краях/кутах на задньому плані, щоб не перекривати UI!)
        if (density > 0 && this.state.floraType !== 'none') {
            const count = Math.max(2, Math.round((density / 100) * 16));
            html += `<g class="scenic-flora-group">`;

            for (let i = 0; i < count; i++) {
                // Розміщуємо лише вздовж лівого та правого обрамлення і в кутах (поза межами центру столу)
                const isLeft = i % 2 === 0;
                const baseX = isLeft ? -10 : 1930;
                const dir = isLeft ? 1 : -1;
                const baseY = 80 + ((i * 137) % 920);
                const reachX = baseX + dir * (110 + (density * 2.2) + ((i * 47) % 120));
                const reachY = baseY + ((i % 3 === 0 ? -1 : 1) * (60 + (i * 19) % 90));
                const ctrlX = baseX + dir * (70 + (density * 1.1));
                const ctrlY = baseY - 50 + ((i * 31) % 100);

                if (this.state.floraType === 'crystal-clusters') {
                    // Кристалічні друзи по периметру (Референс 13)
                    const cSize = 24 + (density * 0.35);
                    html += `
                        <g transform="translate(${baseX + dir * 45}, ${baseY}) rotate(${dir * (25 + (i * 15) % 45)})" opacity="0.65">
                            <polygon points="0,-${cSize * 1.8} ${cSize * 0.55},0 0,${cSize * 0.4} -${cSize * 0.55},0" fill="url(#vineGrad)" stroke="${pColor}" stroke-width="1.2"/>
                            <polygon points="${cSize * 0.4},-${cSize * 1.1} ${cSize * 0.95},0 ${cSize * 0.3},${cSize * 0.3}" fill="${sColor}" fill-opacity="0.5"/>
                        </g>
                    `;
                } else {
                    // Витончені органічні лози з бутонами (Референс 7) або коріння Ірмінсуля
                    const strokeW = 1.6 + (density / 100) * 1.8;
                    html += `
                        <path d="M${baseX},${baseY} Q${ctrlX},${ctrlY} ${reachX},${reachY}" 
                              fill="none" stroke="url(#vineGrad)" stroke-width="${strokeW}" stroke-linecap="round" opacity="0.65"/>
                        <path d="M${(baseX + ctrlX) / 2},${(baseY + ctrlY) / 2} Q${ctrlX},${reachY} ${(ctrlX + reachX) / 2},${reachY + 35}" 
                              fill="none" stroke="${pColor}" stroke-width="${strokeW * 0.6}" stroke-linecap="round" opacity="0.45"/>
                    `;

                    if (this.state.floraType === 'golden-vines') {
                        // Квітучі бутони та світлові вузли як на Референсі 7
                        html += `
                            <circle cx="${reachX}" cy="${reachY}" r="4.5" fill="${sColor}" opacity="0.85"/>
                            <circle cx="${(ctrlX + reachX) / 2}" cy="${(ctrlY + reachY) / 2}" r="3" fill="${pColor}" opacity="0.75"/>
                        `;
                    } else if (this.state.floraType === 'irminsul-roots') {
                        html += `
                            <circle cx="${reachX}" cy="${reachY}" r="3.5" fill="${pColor}" opacity="0.8"/>
                        `;
                    }
                }
            }
            html += `</g>`;
        }

        // 3. М'які фонові світлячки / спори (анімуються чистим CSS без навантаження)
        if (this.state.ambientSpores && density > 0) {
            const spCount = Math.min(24, Math.round(density * 0.25));
            for (let s = 0; s < spCount; s++) {
                const sx = 60 + ((s * 173) % 1800);
                const sy = 60 + ((s * 131) % 960);
                const sr = 1.5 + (s % 3);
                const delay = (s * 0.4).toFixed(1);
                const col = s % 2 === 0 ? pColor : sColor;
                html += `<circle class="scenic-spore" cx="${sx}" cy="${sy}" r="${sr}" fill="${col}" style="animation-delay:${delay}s"/>`;
            }
        }

        svg.innerHTML = html;
    }

    /**
     * Застосовує поточні параметри без взаємного скидання шарів
     */
    applyAll(rebuildSVG = false) {
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
        root.style.setProperty('--border-base', `rgba(${pRgb}, 0.36)`);
        root.style.setProperty('--border-hover', `rgba(${pRgb}, 0.88)`);
        root.style.setProperty('--skin-blur', `${this.state.blur}px`);
        root.style.setProperty('--skin-radius', `${this.state.radius}px`);
        root.style.setProperty('--skin-glow', String(this.state.glow));

        if (document.body) {
            document.body.dataset.archetype = this.state.archetype;
            document.body.dataset.pattern = this.state.surfacePattern;
            document.body.classList.toggle('eco-mode', Boolean(this.state.ecoMode));
        }

        if (rebuildSVG) {
            this.renderScenicSVG();
        }

        this.syncHUD();
        this.saveStorage();
    }

    /**
     * Вибір Кольорової Палітри — змінює ТІЛЬКИ кольори (не скидає Архетип, Фон чи Флору!)
     */
    selectPaletteOnly(paletteId) {
        const pal = this.palettes[paletteId];
        if (!pal) return;
        this.state.paletteId = paletteId;
        this.state.bgDeep = pal.bgDeep;
        this.state.bgMid = pal.bgMid;
        this.state.cardBg = pal.cardBg;
        this.state.primary = pal.primary;
        this.state.secondary = pal.secondary;
        this.state.textMain = pal.textMain;
        this.state.textMuted = pal.textMuted;
        this.applyAll(true);
    }

    /**
     * Вибір Архетипу UI — змінює геометрію карток, кнопок та сфер (не скидає твою палітру, якщо ти сам не попросиш!)
     */
    selectArchetype(archKey) {
        if (!this.archetypes[archKey]) return;
        this.state.archetype = archKey;
        this.applyAll(false);
    }

    /**
     * Збереження повного пресета користувача
     */
    saveUserPreset(name) {
        const title = (name || '').trim() || `Мій Образ #${Object.keys(this.customPresets).length + 1}`;
        const id = 'usr_' + Date.now();
        this.customPresets[id] = {
            name: title,
            snapshot: { ...this.state }
        };
        try {
            localStorage.setItem(this.STORAGE_PRESETS_KEY, JSON.stringify(this.customPresets));
        } catch (e) {}
        this.renderUserPresets();
    }

    mountHUD() {
        if (document.getElementById('aether-master-mount')) return;
        const mount = document.createElement('div');
        mount.id = 'aether-master-mount';
        mount.className = 'aether-master-mount';

        const archHTML = Object.entries(this.archetypes).map(([k, a]) => `
            <button type="button" class="archetype-card studio-raw" data-arch="${k}">
                <div class="arch-name">${a.name}</div>
                <div class="arch-ref">${a.ref}</div>
                <div class="arch-desc">${a.desc}</div>
            </button>
        `).join('');

        const palHTML = Object.entries(this.palettes).map(([k, p]) => `
            <button type="button" class="palette-card studio-raw" data-pal="${k}">
                <div class="swatches">
                    <span class="sw-dot" style="background:${p.bgDeep}"></span>
                    <span class="sw-dot" style="background:${p.primary};box-shadow:0 0 6px ${p.primary}"></span>
                    <span class="sw-dot" style="background:${p.secondary}"></span>
                </div>
                <div style="font-size:11px;font-weight:700;color:#fff;">${p.name}</div>
                <div style="font-size:9.5px;color:#94a3b8;">${p.group}</div>
            </button>
        `).join('');

        const scenesHTML = Object.entries(this.scenicBgs).map(([k, s]) => `
            <button type="button" class="m-pill studio-raw" data-scene="${k}">${s.name}</button>
        `).join('');

        const floraHTML = Object.entries(this.floraTypes).map(([k, f]) => `
            <button type="button" class="m-pill studio-raw" data-flora="${k}">${f.name}</button>
        `).join('');

        mount.innerHTML = `
            <button type="button" class="master-orb-btn studio-raw" id="master-trigger-btn">
                <span class="master-orb-dot"></span>
                <span>ATELIER v8.5</span>
            </button>

            <div class="master-drawer" id="master-drawer">
                <div class="master-header">
                    <div>
                        <div class="master-title">Aether Reference Studio</div>
                        <div style="font-size:10px;color:#94a3b8;">Незалежні шари • 60 FPS • Фонові сцени</div>
                    </div>
                    <button type="button" class="m-pill studio-raw" id="master-sync-btn" style="padding:5px 10px;">📡 GM Sync</button>
                </div>

                <div class="master-tabs">
                    <button type="button" class="master-tab studio-raw active" data-tab="archetypes">🏛️ Образ UI</button>
                    <button type="button" class="master-tab studio-raw" data-tab="palettes">🎨 Палітра</button>
                    <button type="button" class="master-tab studio-raw" data-tab="scenery">🌄 Фон & Флора</button>
                    <button type="button" class="master-tab studio-raw" data-tab="presets">💾 Пресети</button>
                </div>

                <div class="master-scroll-body">
                    <!-- ВКЛАДКА 1: 6 АРХІТЕКТУРНИХ ОБРАЗІВ ІЗ РЕФЕРЕНСІВ -->
                    <div class="master-pane active" data-pane="archetypes">
                        <div>
                            <div class="sec-lbl"><span>Обери глобальний дизайн-образ (кнопки, сфери, плашки)</span></div>
                            <div class="archetype-list">${archHTML}</div>
                        </div>

                        <div>
                            <div class="sec-lbl"><span>Мікро-текстура скляних панелей</span></div>
                            <div class="pill-grid">
                                <button type="button" class="m-pill studio-raw" data-pat="satin">Діагональний Сатин</button>
                                <button type="button" class="m-pill studio-raw" data-pat="marble">Мармурові Жили</button>
                                <button type="button" class="m-pill studio-raw" data-pat="velvet">Матовий Оксамит</button>
                                <button type="button" class="m-pill studio-raw" data-pat="hex">Гексагональна Сітка</button>
                                <button type="button" class="m-pill studio-raw" data-pat="clean">Чиста Лінза</button>
                            </div>
                        </div>

                        <div>
                            <div class="sec-lbl"><span>Заломлення скла (Blur)</span><span id="val-blur">${this.state.blur}px</span></div>
                            <input type="range" class="m-range" id="rng-blur" min="0" max="32" step="2" value="${this.state.blur}">
                        </div>

                        <div>
                            <div class="sec-lbl"><span>Інтенсивність Сяйва (Glow)</span><span id="val-glow">${Math.round(this.state.glow * 100)}%</span></div>
                            <input type="range" class="m-range" id="rng-glow" min="0" max="2" step="0.1" value="${this.state.glow}">
                        </div>
                    </div>

                    <!-- ВКЛАДКА 2: 18 ПАЛІТР (НЕ СКИДАЮТЬ ОБРАЗ ТА ФОН!) -->
                    <div class="master-pane" data-pane="palettes">
                        <div>
                            <div class="sec-lbl"><span>Ручний підбір (одразу фарбує UI, гори та ліани)</span></div>
                            <div class="color-pickers-row">
                                <label class="c-pick-box">
                                    <span>Акцент / Ліани</span>
                                    <input type="color" id="pk-primary" value="${this.state.primary}">
                                </label>
                                <label class="c-pick-box">
                                    <span>Другий тон</span>
                                    <input type="color" id="pk-secondary" value="${this.state.secondary}">
                                </label>
                                <label class="c-pick-box">
                                    <span>Глибина фону</span>
                                    <input type="color" id="pk-bg" value="${this.state.bgDeep}">
                                </label>
                            </div>
                        </div>

                        <div>
                            <div class="sec-lbl"><span>18 Палітр з референсів (міняють лише кольори!)</span></div>
                            <div class="palette-grid">${palHTML}</div>
                        </div>
                    </div>

                    <!-- ВКЛАДКА 3: СЦЕНІЧНИЙ ФОН ТА ДЕЛІКАТНА ФОНОВА ФЛОРА -->
                    <div class="master-pane" data-pane="scenery">
                        <div>
                            <div class="sec-lbl"><span>Глобальний Фон Етера (заповнює порожні зони)</span></div>
                            <div class="pill-grid">${scenesHTML}</div>
                        </div>

                        <div>
                            <div class="sec-lbl"><span>Фоновий Декор у Вільних Зонах (не заважає кнопкам!)</span></div>
                            <div class="pill-grid">${floraHTML}</div>
                        </div>

                        <div>
                            <div class="sec-lbl">
                                <span>🌿 Густота Фонової Флори / Кристалів</span>
                                <span id="val-flora">${this.state.floraDensity}%</span>
                            </div>
                            <input type="range" class="m-range" id="rng-flora" min="0" max="100" step="5" value="${this.state.floraDensity}">
                        </div>

                        <button type="button" class="m-pill studio-raw" id="btn-spores" style="text-align:center;">
                            ✨ Фонові світлячки / спори у вільних зонах
                        </button>
                    </div>

                    <!-- ВКЛАДКА 4: ЗБЕРЕЖЕННЯ ПРЕСЕТІВ ТА ECO -->
                    <div class="master-pane" data-pane="presets">
                        <div>
                            <div class="sec-lbl"><span>Зберегти свою комбінацію</span></div>
                            <div style="display:flex;gap:6px;">
                                <input type="text" id="inp-save-name" placeholder="Назва пресета..." style="flex:1;padding:8px;border-radius:8px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:11px;">
                                <button type="button" class="m-pill studio-raw" id="btn-save-custom" style="border-color:var(--neon-vine);">+ Зберегти</button>
                            </div>
                        </div>

                        <div>
                            <div class="sec-lbl"><span>Мої збережені пресети</span></div>
                            <div id="user-presets-list" style="display:flex;flex-direction:column;gap:7px;"></div>
                        </div>

                        <button type="button" class="m-pill studio-raw" id="btn-eco-mode" style="text-align:center;margin-top:8px;">
                            ⚡ ECO-Режим (Максимальна продуктивність)
                        </button>
                    </div>
                </div>
            </div>
        `;

        const slot = document.getElementById('aether-skin-slot') || document.querySelector('.top-bar');
        if (slot) slot.appendChild(mount);
        else {
            mount.style.position = 'fixed';
            mount.style.top = '12px';
            mount.style.right = '16px';
            document.body.appendChild(mount);
        }

        this.bindEvents(mount);
        this.renderUserPresets();
        this.syncHUD();
    }

    bindEvents(mount) {
        const trigger = mount.querySelector('#master-trigger-btn');
        const drawer = mount.querySelector('#master-drawer');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            drawer.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!mount.contains(e.target)) drawer.classList.remove('open');
        });

        // Вкладки
        mount.querySelectorAll('.master-tab').forEach(t => {
            t.addEventListener('click', () => {
                const tab = t.dataset.tab;
                mount.querySelectorAll('.master-tab').forEach(b => b.classList.toggle('active', b === t));
                mount.querySelectorAll('.master-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab));
            });
        });

        // Вибір Архетипу UI
        mount.querySelectorAll('[data-arch]').forEach(btn => {
            btn.addEventListener('click', () => this.selectArchetype(btn.dataset.arch));
        });

        // Вибір Палітри (НЕ скидає Архетип та Фон!)
        mount.querySelectorAll('[data-pal]').forEach(btn => {
            btn.addEventListener('click', () => this.selectPaletteOnly(btn.dataset.pal));
        });

        // Вибір Фонової Сцени
        mount.querySelectorAll('[data-scene]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.scenicBg = btn.dataset.scene;
                this.applyAll(true);
            });
        });

        // Вибір Типу Флори
        mount.querySelectorAll('[data-flora]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.floraType = btn.dataset.flora;
                this.applyAll(true);
            });
        });

        // Патерн плашок
        mount.querySelectorAll('[data-pat]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.surfacePattern = btn.dataset.pat;
                this.applyAll(false);
            });
        });

        // Колор-пікери
        mount.querySelector('#pk-primary').addEventListener('input', (e) => {
            this.state.primary = e.target.value;
            this.applyAll(true);
        });
        mount.querySelector('#pk-secondary').addEventListener('input', (e) => {
            this.state.secondary = e.target.value;
            this.applyAll(true);
        });
        mount.querySelector('#pk-bg').addEventListener('input', (e) => {
            const hex = e.target.value;
            const rgb = this.hexToRgb(hex);
            this.state.bgDeep = hex;
            this.state.bgMid = hex;
            this.state.cardBg = `rgba(${rgb}, 0.80)`;
            this.applyAll(true);
        });

        // Слайдери
        mount.querySelector('#rng-blur').addEventListener('input', (e) => {
            this.state.blur = parseInt(e.target.value, 10);
            this.applyAll(false);
        });
        mount.querySelector('#rng-glow').addEventListener('input', (e) => {
            this.state.glow = parseFloat(e.target.value);
            this.applyAll(false);
        });
        mount.querySelector('#rng-flora').addEventListener('input', (e) => {
            this.state.floraDensity = parseInt(e.target.value, 10);
            this.applyAll(true);
        });

        mount.querySelector('#btn-spores').addEventListener('click', () => {
            this.state.ambientSpores = !this.state.ambientSpores;
            this.applyAll(true);
        });

        mount.querySelector('#btn-eco-mode').addEventListener('click', () => {
            this.state.ecoMode = !this.state.ecoMode;
            this.applyAll(true);
        });

        // Збереження власного пресета
        const inpName = mount.querySelector('#inp-save-name');
        mount.querySelector('#btn-save-custom').addEventListener('click', () => {
            this.saveUserPreset(inpName.value);
            inpName.value = '';
        });

        // GM Sync
        const syncBtn = mount.querySelector('#master-sync-btn');
        syncBtn.addEventListener('click', () => {
            if (this.channel) {
                this.channel.postMessage({ type: 'AETHER_SKIN_FORCE_SYNC', payload: this.state });
            }
            const orig = syncBtn.textContent;
            syncBtn.textContent = '✓ Відправлено';
            setTimeout(() => { syncBtn.textContent = orig; }, 1200);
        });
    }

    renderUserPresets() {
        const box = document.getElementById('user-presets-list');
        if (!box) return;
        const list = Object.entries(this.customPresets);
        if (!list.length) {
            box.innerHTML = `<div style="font-size:10.5px;color:#94a3b8;">Немає збережених пресетів.</div>`;
            return;
        }
        box.innerHTML = list.map(([id, item]) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:9px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);">
                <div style="cursor:pointer;flex:1;font-size:11px;font-weight:700;color:#fff;" data-load-usr="${id}">${item.name}</div>
                <button type="button" class="studio-raw" data-del-usr="${id}" style="background:rgba(255,60,80,0.2);border:1px solid rgba(255,60,80,0.5);color:#fda4af;border-radius:6px;padding:3px 8px;font-size:10px;cursor:pointer;">✕</button>
            </div>
        `).join('');

        box.querySelectorAll('[data-load-usr]').forEach(el => {
            el.addEventListener('click', () => {
                const snap = this.customPresets[el.dataset.loadUsr]?.snapshot;
                if (snap) {
                    this.state = { ...this.state, ...snap };
                    this.applyAll(true);
                }
            });
        });

        box.querySelectorAll('[data-del-usr]').forEach(btn => {
            btn.addEventListener('click', () => {
                delete this.customPresets[btn.dataset.delUsr];
                localStorage.setItem(this.STORAGE_PRESETS_KEY, JSON.stringify(this.customPresets));
                this.renderUserPresets();
            });
        });
    }

    syncHUD() {
        const m = document.getElementById('aether-master-mount');
        if (!m) return;

        m.querySelectorAll('[data-arch]').forEach(el => el.classList.toggle('active', el.dataset.arch === this.state.archetype));
        m.querySelectorAll('[data-pal]').forEach(el => el.classList.toggle('active', el.dataset.pal === this.state.paletteId));
        m.querySelectorAll('[data-scene]').forEach(el => el.classList.toggle('active', el.dataset.scene === this.state.scenicBg));
        m.querySelectorAll('[data-flora]').forEach(el => el.classList.toggle('active', el.dataset.flora === this.state.floraType));
        m.querySelectorAll('[data-pat]').forEach(el => el.classList.toggle('active', el.dataset.pat === this.state.surfacePattern));

        const setV = (s, v) => { const el = m.querySelector(s); if (el) el.value = v; };
        const setT = (s, t) => { const el = m.querySelector(s); if (el) el.textContent = t; };

        setV('#pk-primary', this.state.primary);
        setV('#pk-secondary', this.state.secondary);
        setV('#pk-bg', this.state.bgDeep);
        setV('#rng-blur', this.state.blur);
        setV('#rng-glow', this.state.glow);
        setV('#rng-flora', this.state.floraDensity);

        setT('#val-blur', `${this.state.blur}px`);
        setT('#val-glow', `${Math.round(this.state.glow * 100)}%`);
        setT('#val-flora', `${this.state.floraDensity}%`);

        m.querySelector('#btn-spores')?.classList.toggle('active', Boolean(this.state.ambientSpores));
        m.querySelector('#btn-eco-mode')?.classList.toggle('active', Boolean(this.state.ecoMode));
    }

    initBroadcastSync() {
        try {
            this.channel = new BroadcastChannel(this.SYNC_CHANNEL);
            this.channel.addEventListener('message', (e) => {
                if (e.data && e.data.type === 'AETHER_SKIN_FORCE_SYNC') {
                    this.state = { ...this.state, ...e.data.payload };
                    this.applyAll(true);
                }
            });
        } catch (e) {}
    }

    observeEcoMode() {
        const attach = () => {
            if (!document.body) return;
            const obs = new MutationObserver(() => {
                const isEco = document.body.classList.contains('eco-mode') || document.body.getAttribute('data-eco') === 'true';
                if (isEco !== this.state.ecoMode) {
                    this.state.ecoMode = isEco;
                    this.applyAll(true);
                }
            });
            obs.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-eco'] });
        };
        document.body ? attach() : document.addEventListener('DOMContentLoaded', attach);
    }
}

window.AetherSkins = new AetherReferenceEngine();