/**
 * AETHER_v8.5_CORE_FINAL — Sovereign Material, Liquid Glass & Living Flora Studio
 * File: aether_skins.js
 * Features:
 *  - Scrollable Multi-Tab Atelier Drawer (Palettes, Optics & Hull, Living Flora, Custom Presets)
 *  - Procedural Canvas + SVG Living Vines Engine (0-100% density slider, wind sway, sap pulse, spores, blossoms)
 *  - 16 Reference-Grade Themes (Ruins in the Woods, Luxury Satin, Jewel Tones, Shades of Black, Liquid Glass, Sunset UI)
 *  - Custom Preset Saver (Name, Save, Load, Delete in localStorage) + Live Color Pickers
 *  - Full synchronization with existing Aether vines (--neon-vine, SVG strokes) & ECO-Mode
 */

class AetherSovereignStudio {
    constructor() {
        this.STORAGE_STATE_KEY = 'aether_v85_sovereign_state';
        this.STORAGE_PRESETS_KEY = 'aether_v85_custom_presets';
        this.SYNC_CHANNEL = 'entropia_ark_sync_channel';

        // 16 Пресетів, створених безпосередньо за палітрами з референсів
        this.builtInPresets = {
            // --- КАТЕГОРІЯ 1: FOREST & CRYSTALLINE FLORA (Референси 7, 13) ---
            'irminsul-sanctuary': {
                name: 'Irminsul Sanctuary',
                category: 'Forest & Flora',
                desc: 'Золота філігрань, смарагдовий мох і теплі лісові світлячки',
                colors: ['#07140e', '#38ef7d', '#ffd166'],
                config: {
                    bgPanel: 'rgba(9, 22, 16, 0.78)',
                    bgSolid: '#07140e',
                    primary: '#38ef7d',
                    secondary: '#ffd166',
                    surfaceTint: '#112a1e',
                    textMain: '#f2fff7',
                    textMuted: '#8ab89e',
                    hull: 'filigree',
                    glassRecipe: 'liquid-prism',
                    texture: 'marble-veins',
                    floraStyle: 'blossom-gold',
                    floraDensity: 65
                }
            },
            'biolume-geode': {
                name: 'Biolume Crystal Geode',
                category: 'Forest & Flora',
                desc: 'Глибокий індиго, бірюзовий кристал та аметистові спори',
                colors: ['#120b24', '#00f5d4', '#9b5de5'],
                config: {
                    bgPanel: 'rgba(18, 11, 36, 0.84)',
                    bgSolid: '#120b24',
                    primary: '#00f5d4',
                    secondary: '#9b5de5',
                    surfaceTint: '#1f143d',
                    textMain: '#ebfffc',
                    textMuted: '#8e7ab5',
                    hull: 'neumorphic',
                    glassRecipe: 'chromatic-edge',
                    texture: 'crystal-facets',
                    floraStyle: 'crystal-fern',
                    floraDensity: 75
                }
            },

            // --- КАТЕГОРІЯ 2: RUINS IN THE WOODS / DARK SOULS (Референс 3) ---
            'eldritch-amethyst': {
                name: 'Eldritch Amethyst',
                category: 'Ruins in the Woods',
                desc: 'Містичний темний оксамит, фіалковий туман і срібний контур',
                colors: ['#181021', '#b57edc', '#d8dbe2'],
                config: {
                    bgPanel: 'rgba(24, 16, 33, 0.85)',
                    bgSolid: '#160e1e',
                    primary: '#b57edc',
                    secondary: '#d8dbe2',
                    surfaceTint: '#2b1d3a',
                    textMain: '#f4effa',
                    textMuted: '#9882ac',
                    hull: 'filigree',
                    glassRecipe: 'velvet-matte',
                    texture: 'velvet-suede',
                    floraStyle: 'thorn-briar',
                    floraDensity: 50
                }
            },
            'profaned-plum': {
                name: 'Profaned Plum',
                category: 'Ruins in the Woods',
                desc: 'Глибокий винний оксамит, антична бронза та багряні лози',
                colors: ['#210c14', '#e05277', '#c9a275'],
                config: {
                    bgPanel: 'rgba(33, 12, 20, 0.86)',
                    bgSolid: '#1f0b12',
                    primary: '#e05277',
                    secondary: '#c9a275',
                    surfaceTint: '#381522',
                    textMain: '#fff0f3',
                    textMuted: '#b37b89',
                    hull: 'filigree',
                    glassRecipe: 'velvet-matte',
                    texture: 'velvet-suede',
                    floraStyle: 'blossom-gold',
                    floraDensity: 45
                }
            },
            'moonlit-abyss': {
                name: 'Moonlit Abyss',
                category: 'Ruins in the Woods',
                desc: 'Нічна безодня, крижане срібло та холодні примарні гілки',
                colors: ['#08111c', '#70a1cc', '#d4dde6'],
                config: {
                    bgPanel: 'rgba(8, 17, 28, 0.86)',
                    bgSolid: '#08111c',
                    primary: '#70a1cc',
                    secondary: '#d4dde6',
                    surfaceTint: '#122438',
                    textMain: '#eef5fc',
                    textMuted: '#7892ab',
                    hull: 'sleek',
                    glassRecipe: 'frost-heavy',
                    texture: 'anodized-noise',
                    floraStyle: 'thorn-briar',
                    floraDensity: 40
                }
            },

            // --- КАТЕГОРІЯ 3: LUXURY SATIN & MINERAL (Референси 1, 8) ---
            'luxury-abyssal-bronze': {
                name: 'Luxury Satin #01',
                category: 'Luxury & Mineral',
                desc: 'Петроль #09171E, тепла бронза #CEA17A та діагональний сатин',
                colors: ['#09171e', '#cea17a', '#3e4e56'],
                config: {
                    bgPanel: 'rgba(9, 23, 30, 0.88)',
                    bgSolid: '#09171e',
                    primary: '#cea17a',
                    secondary: '#527988',
                    surfaceTint: '#162c36',
                    textMain: '#f7f2ed',
                    textMuted: '#8fa1a8',
                    hull: 'chamfer',
                    glassRecipe: 'satin-sheen',
                    texture: 'diagonal-satin',
                    floraStyle: 'cyber-circuit',
                    floraDensity: 30
                }
            },
            'emerald-marble-gold': {
                name: 'Emerald & Stone Gold',
                category: 'Luxury & Mineral',
                desc: 'Імператорський смарагд #1E362D, чорний мармур і золоті жили',
                colors: ['#10211b', '#d4af37', '#2c6e58'],
                config: {
                    bgPanel: 'rgba(16, 33, 27, 0.86)',
                    bgSolid: '#10211b',
                    primary: '#d4af37',
                    secondary: '#409175',
                    surfaceTint: '#1e362d',
                    textMain: '#faf6eb',
                    textMuted: '#8da69c',
                    hull: 'filigree',
                    glassRecipe: 'satin-sheen',
                    texture: 'marble-veins',
                    floraStyle: 'blossom-gold',
                    floraDensity: 55
                }
            },
            'sage-sandstone': {
                name: 'Sage & Warm Sand',
                category: 'Luxury & Mineral',
                desc: 'Приглушена шавлія, теплий пісковик і м’яка матова оптика',
                colors: ['#1d282a', '#d9b99b', '#6b8e78'],
                config: {
                    bgPanel: 'rgba(29, 40, 42, 0.84)',
                    bgSolid: '#1d282a',
                    primary: '#d9b99b',
                    secondary: '#6b8e78',
                    surfaceTint: '#2b3b3e',
                    textMain: '#faf5f0',
                    textMuted: '#99aba6',
                    hull: 'bento-notched',
                    glassRecipe: 'velvet-matte',
                    texture: 'anodized-noise',
                    floraStyle: 'synapse-roots',
                    floraDensity: 35
                }
            },

            // --- КАТЕГОРІЯ 4: 10 SHADES OF BLACK & DARK MOOD (Референси 2, 4) ---
            'obsidian-velvet': {
                name: 'Obsidian Velvet #03',
                category: 'Shades of Black',
                desc: 'Абсолютний чорний онікс, платиновий відблиск і текстура вугілля',
                colors: ['#08090c', '#e2e8f0', '#475569'],
                config: {
                    bgPanel: 'rgba(10, 11, 14, 0.90)',
                    bgSolid: '#08090c',
                    primary: '#e2e8f0',
                    secondary: '#64748b',
                    surfaceTint: '#16181f',
                    textMain: '#f8fafc',
                    textMuted: '#7f8ea3',
                    hull: 'sleek',
                    glassRecipe: 'satin-sheen',
                    texture: 'carbon-weave',
                    floraStyle: 'thorn-briar',
                    floraDensity: 20
                }
            },
            'moss-black-09': {
                name: 'Moss Black #09',
                category: 'Shades of Black',
                desc: 'Темний базальт із лісовим підтоном та приглушеним нефритом',
                colors: ['#0f1412', '#76b59b', '#3b4a43'],
                config: {
                    bgPanel: 'rgba(15, 20, 18, 0.88)',
                    bgSolid: '#0f1412',
                    primary: '#76b59b',
                    secondary: '#4d6b5d',
                    surfaceTint: '#1c2622',
                    textMain: '#ebf5f0',
                    textMuted: '#7b9488',
                    hull: 'bento-notched',
                    glassRecipe: 'velvet-matte',
                    texture: 'velvet-suede',
                    floraStyle: 'synapse-roots',
                    floraDensity: 45
                }
            },
            'dark-mood-blue': {
                name: 'Dark Mood Midnight',
                category: 'Shades of Black',
                desc: 'Архітектурний індиго #0D1117, сталевий #3D5F8A та холодний фокус',
                colors: ['#0d1117', '#5882b8', '#a7b7c9'],
                config: {
                    bgPanel: 'rgba(13, 17, 23, 0.88)',
                    bgSolid: '#0d1117',
                    primary: '#6699d6',
                    secondary: '#a7b7c9',
                    surfaceTint: '#1c2430',
                    textMain: '#f0f6fc',
                    textMuted: '#798faf',
                    hull: 'chamfer',
                    glassRecipe: 'satin-sheen',
                    texture: 'diagonal-satin',
                    floraStyle: 'cyber-circuit',
                    floraDensity: 25
                }
            },

            // --- КАТЕГОРІЯ 5: LIQUID GLASS & SUNSET HORIZON (Референси 5, 9, 10, 11, 12) ---
            'liquid-glass-prism': {
                name: 'Liquid Glass Prism',
                category: 'Liquid & Bento UI',
                desc: 'Ультра-прозоре дисперсне скло з райдужним заломленням граней',
                colors: ['#131d31', '#38bdf8', '#f472b6'],
                config: {
                    bgPanel: 'rgba(22, 34, 56, 0.58)',
                    bgSolid: '#131d31',
                    primary: '#38bdf8',
                    secondary: '#f472b6',
                    surfaceTint: '#263c66',
                    textMain: '#ffffff',
                    textMuted: '#9cc2e6',
                    hull: 'sleek',
                    glassRecipe: 'liquid-prism',
                    texture: 'clean',
                    floraStyle: 'crystal-fern',
                    floraDensity: 35
                }
            },
            'sunset-horizon-ui': {
                name: 'Sunset Alpenglow UI',
                category: 'Liquid & Bento UI',
                desc: 'Теплий персиковий захід, сутінковий індиго та неоморфні сфери',
                colors: ['#1e1b29', '#ff9e7d', '#c084fc'],
                config: {
                    bgPanel: 'rgba(30, 27, 41, 0.82)',
                    bgSolid: '#1e1b29',
                    primary: '#ff9e7d',
                    secondary: '#c084fc',
                    surfaceTint: '#322b45',
                    textMain: '#fff5f0',
                    textMuted: '#a89bb8',
                    hull: 'neumorphic',
                    glassRecipe: 'chromatic-edge',
                    texture: 'anodized-noise',
                    floraStyle: 'blossom-gold',
                    floraDensity: 40
                }
            },
            'antariksa-bento-teal': {
                name: 'Antariksa Bento Teal',
                category: 'Liquid & Bento UI',
                desc: 'Глибокий космос #08333C, контрастні капсули та бірюзові лінії',
                colors: ['#062830', '#2dd4bf', '#e2f1f0'],
                config: {
                    bgPanel: 'rgba(6, 40, 48, 0.85)',
                    bgSolid: '#062830',
                    primary: '#2dd4bf',
                    secondary: '#e2f1f0',
                    surfaceTint: '#0d4450',
                    textMain: '#f0fdfa',
                    textMuted: '#78b3b0',
                    hull: 'bento-notched',
                    glassRecipe: 'satin-sheen',
                    texture: 'hex-grid',
                    floraStyle: 'synapse-roots',
                    floraDensity: 30
                }
            },

            // --- КАТЕГОРІЯ 6: JEWEL TONES (Референс 6) ---
            'jewel-garnet-gold': {
                name: 'Imperial Garnet & Brass',
                category: 'Jewel Tones',
                desc: 'Королівський гранат, стара латунь і глибоке внутрішнє сяйво',
                colors: ['#24070c', '#ff3355', '#e6b86a'],
                config: {
                    bgPanel: 'rgba(36, 7, 12, 0.86)',
                    bgSolid: '#24070c',
                    primary: '#ff3355',
                    secondary: '#e6b86a',
                    surfaceTint: '#420d16',
                    textMain: '#fff0f2',
                    textMuted: '#bd7e88',
                    hull: 'filigree',
                    glassRecipe: 'chromatic-edge',
                    texture: 'marble-veins',
                    floraStyle: 'thorn-briar',
                    floraDensity: 50
                }
            },
            'jewel-peacock-opal': {
                name: 'Peacock & Rainbow Opal',
                category: 'Jewel Tones',
                desc: 'Павичевий сапфір, смарагдова хвиля та опаловий перелив',
                colors: ['#061d24', '#00e5ff', '#00e676'],
                config: {
                    bgPanel: 'rgba(6, 29, 36, 0.82)',
                    bgSolid: '#061d24',
                    primary: '#00e5ff',
                    secondary: '#00e676',
                    surfaceTint: '#0d3845',
                    textMain: '#ebfeff',
                    textMuted: '#76b5bd',
                    hull: 'sleek',
                    glassRecipe: 'liquid-prism',
                    texture: 'crystal-facets',
                    floraStyle: 'crystal-fern',
                    floraDensity: 60
                }
            }
        };

        // Архітектура корпусів (Hull Styles) за референсами
        this.hulls = {
            'sleek': { name: 'Liquid Pill', desc: 'Оптичне скло з м’якими радіусами (Ref 12)' },
            'bento-notched': { name: 'Bento Capsule', desc: 'Ступінчасті капсули та подвійні контури (Ref 5)' },
            'filigree': { name: 'Gold Filigree', desc: 'Гравійована ювелірна рамка з кутовими вузлами (Ref 3, 7)' },
            'neumorphic': { name: 'Tactile Basin', desc: 'Об’ємний неоморфний рельєф із внутрішньою тінню (Ref 9, 10)' },
            'chamfer': { name: 'Luxury Bevel', desc: 'Скошені грані з діагональним металевим бліком (Ref 8)' }
        };

        // Рецепти заломлення скла (Liquid Glass Recipes)
        this.glassRecipes = {
            'liquid-prism': { name: 'Liquid Dispersion', desc: 'Подвійний хроматичний блік і глибока лінза' },
            'satin-sheen': { name: 'Anodized Satin', desc: 'Металізований діагональний перелив' },
            'velvet-matte': { name: 'Velvet Obsidian', desc: 'Глибокий матовий оксамит із м’яким поглинанням' },
            'chromatic-edge': { name: 'Sunset Rim Glow', desc: 'Яскравий двоколірний контур свічення' },
            'frost-heavy': { name: 'Nordic Frost', desc: 'Максимальна кристалічна матовість' }
        };

        // Поверхневі текстури плашок
        this.textures = {
            'clean': { name: 'Чистий монокристал' },
            'marble-veins': { name: 'Золоті прожилки каменю (Stone)' },
            'diagonal-satin': { name: 'Діагональний люкс-сатин (Luxury)' },
            'velvet-suede': { name: 'Оксамитове мікро-зерно (Velvet)' },
            'crystal-facets': { name: 'Кристалічні грані (Geode)' },
            'carbon-weave': { name: 'Карбонове плетіння (Carbon)' },
            'hex-grid': { name: 'Гексагональна сітка (Matrix)' },
            'anodized-noise': { name: 'Анодований титан (Grain)' }
        };

        // Види процедурної флори
        this.floraStyles = {
            'blossom-gold': { name: 'Лісові Ліани & Квіти (Ref 7)' },
            'crystal-fern': { name: 'Біо-Кристалічна Папороть (Ref 13)' },
            'synapse-roots': { name: 'Нейронне Коріння Ірмінсуля' },
            'thorn-briar': { name: 'Темні Шипи Руїн (Ref 3)' },
            'cyber-circuit': { name: 'Квантові Капіляри Ковчега' }
        };

        // Поточний активний стан
        this.state = {
            activePresetId: 'irminsul-sanctuary',
            activeTab: 'palettes',
            bgPanel: 'rgba(9, 22, 16, 0.78)',
            bgSolid: '#07140e',
            primary: '#38ef7d',
            secondary: '#ffd166',
            surfaceTint: '#112a1e',
            textMain: '#f2fff7',
            textMuted: '#8ab89e',
            hull: 'filigree',
            glassRecipe: 'liquid-prism',
            texture: 'marble-veins',
            blur: 18,
            bloom: 1.15,
            borderRadius: 16,
            borderOpacity: 0.38,
            // Параметри живої флори
            floraDensity: 65,          // 0 - 100% (повзунок кількості ліан на екрані)
            floraStyle: 'blossom-gold',
            floraGlow: 1.25,           // Яскравість свічення ліан
            floraSwaySpeed: 1.0,       // Швидкість живого коливання вітром
            floraSpores: true,         // Літаючі спори / світлячки
            floraCardWrap: true,       // Паростки навколо .glass-card
            spotlight: true,
            ecoMode: false
        };

        this.customPresets = {};
        this.vineNodes = [];
        this.spores = [];
        this.animFrameId = null;

        this.init();
    }

    init() {
        this.loadSavedData();
        this.injectStyles();
        this.initSpotlight();
        this.initBroadcastChannel();
        this.observeEcoMode();

        const bootDOM = () => {
            this.mountFloraCanvas();
            this.mountStudioHUD();
            this.applyAll(true);
            this.startFloraLoop();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bootDOM);
        } else {
            bootDOM();
        }
    }

    loadSavedData() {
        try {
            const rawPresets = localStorage.getItem(this.STORAGE_PRESETS_KEY);
            if (rawPresets) this.customPresets = JSON.parse(rawPresets);

            const rawState = localStorage.getItem(this.STORAGE_STATE_KEY);
            if (rawState) this.state = { ...this.state, ...JSON.parse(rawState) };
        } catch (e) {
            console.warn('[AetherSovereignStudio] Помилка читання localStorage:', e);
        }
    }

    saveState() {
        try {
            localStorage.setItem(this.STORAGE_STATE_KEY, JSON.stringify(this.state));
        } catch (e) {}
    }

    saveCustomPresetsToStorage() {
        try {
            localStorage.setItem(this.STORAGE_PRESETS_KEY, JSON.stringify(this.customPresets));
        } catch (e) {}
    }

    /**
     * Допоміжний конвертер HEX -> "R, G, B" для прозорих шейдерів
     */
    hexToRgbString(hex) {
        const clean = (hex || '#38ef7d').replace('#', '');
        const num = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `${r}, ${g}, ${b}`;
    }

    /**
     * Ін'єкція всіх CSS-правил (Матеріали, Оптика Liquid Glass, Bento-корпуси, Скрол-панель та пагони на картках)
     */
    injectStyles() {
        if (document.getElementById('aether-sovereign-styles')) return;
        const style = document.createElement('style');
        style.id = 'aether-sovereign-styles';
        style.textContent = `
            :root {
                --bg-panel: rgba(9, 22, 16, 0.78);
                --bg-panel-solid: #07140e;
                --neon-vine: #38ef7d;
                --neon-secondary: #ffd166;
                --surface-tint: #112a1e;
                --neon-rgb: 56, 239, 125;
                --secondary-rgb: 255, 209, 102;
                --text-main: #f2fff7;
                --text-muted: #8ab89e;
                --border-base: rgba(56, 239, 125, 0.35);
                --border-hover: rgba(56, 239, 125, 0.85);
                --skin-blur: 18px;
                --skin-bloom: 1.15;
                --skin-radius: 16px;
                --flora-glow: 1.25;
            }

            /* --- СИНХРОНІЗАЦІЯ ІСНУЮЧИХ ЛІАН ЕТЕРА --- */
            svg path[class*="vine"], svg path[id*="vine"], .vine-path, .aether-vine, .bio-vine {
                stroke: var(--neon-vine) !important;
                filter: drop-shadow(0 0 calc(8px * var(--flora-glow)) var(--neon-vine)) !important;
                transition: stroke 0.4s ease, filter 0.4s ease;
            }

            /* --- БАЗОВІ ПЛАШКИ (.glass-card, .top-bar) --- */
            .glass-card, .top-bar {
                position: relative;
                background: var(--bg-panel) !important;
                backdrop-filter: blur(var(--skin-blur)) saturate(160%) !important;
                -webkit-backdrop-filter: blur(var(--skin-blur)) saturate(160%) !important;
                border: 1px solid var(--border-base) !important;
                color: var(--text-main) !important;
                transition: 
                    background 0.35s ease,
                    border-color 0.35s ease,
                    box-shadow 0.35s ease,
                    border-radius 0.3s ease !important;
            }

            .glass-card {
                border-radius: var(--skin-radius) !important;
            }

            /* --- 5 РЕЦЕПТІВ ОПТИКИ СКЛА (GLASS RECIPES) --- */
            /* 1. Liquid Dispersion (Ref 12) */
            body[data-glass-recipe="liquid-prism"] .glass-card {
                background: linear-gradient(
                    135deg,
                    rgba(var(--neon-rgb), 0.14) 0%,
                    var(--bg-panel) 48%,
                    rgba(var(--secondary-rgb), 0.12) 100%
                ) !important;
                box-shadow: 
                    0 16px 40px -8px rgba(0, 0, 0, 0.75),
                    0 0 calc(22px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.18),
                    inset 0 1.5px 1px 0 rgba(255, 255, 255, 0.38),
                    inset 0 -1.5px 2px 0 rgba(var(--secondary-rgb), 0.28),
                    inset 0 0 calc(20px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.08) !important;
            }

            /* 2. Anodized Satin (Ref 8) */
            body[data-glass-recipe="satin-sheen"] .glass-card {
                background: linear-gradient(
                    115deg,
                    var(--bg-panel) 0%,
                    rgba(var(--neon-rgb), 0.10) 45%,
                    rgba(255, 255, 255, 0.06) 50%,
                    var(--bg-panel) 58%,
                    rgba(0, 0, 0, 0.92) 100%
                ) !important;
                box-shadow: 
                    0 18px 45px rgba(0, 0, 0, 0.85),
                    inset 0 1px 0 rgba(var(--neon-rgb), 0.45),
                    inset 0 0 0 1px rgba(255, 255, 255, 0.04) !important;
            }

            /* 3. Velvet Matte (Ref 2, 3) */
            body[data-glass-recipe="velvet-matte"] .glass-card {
                background: radial-gradient(
                    circle at 50% 0%,
                    var(--surface-tint) 0%,
                    var(--bg-panel-solid) 95%
                ) !important;
                box-shadow: 
                    0 14px 36px rgba(0, 0, 0, 0.9),
                    inset 0 0 28px rgba(0, 0, 0, 0.75),
                    inset 0 1px 0 rgba(var(--neon-rgb), 0.25) !important;
            }

            /* 4. Sunset Chromatic Rim (Ref 9, 10, 11) */
            body[data-glass-recipe="chromatic-edge"] .glass-card {
                box-shadow: 
                    0 16px 40px rgba(0, 0, 0, 0.8),
                    0 0 calc(24px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.22),
                    inset 0 2px 3px rgba(var(--neon-rgb), 0.35),
                    inset 0 -2px 4px rgba(var(--secondary-rgb), 0.30) !important;
            }

            /* 5. Nordic Frost */
            body[data-glass-recipe="frost-heavy"] .glass-card {
                backdrop-filter: blur(calc(var(--skin-blur) * 1.4)) brightness(1.08) saturate(180%) !important;
                -webkit-backdrop-filter: blur(calc(var(--skin-blur) * 1.4)) brightness(1.08) saturate(180%) !important;
                box-shadow: 
                    0 12px 34px rgba(0, 0, 0, 0.7),
                    inset 0 0 0 1px rgba(255, 255, 255, 0.18),
                    inset 0 0 24px rgba(var(--neon-rgb), 0.12) !important;
            }

            .glass-card:hover {
                border-color: var(--border-hover) !important;
            }

            /* --- 5 АРХІТЕКТУР КОРПУСУ (HULL STYLES) --- */
            /* 1. Bento Capsule (Ref 5) */
            body[data-hull="bento-notched"] .glass-card {
                border-radius: 18px !important;
                outline: 1px solid rgba(var(--neon-rgb), 0.22);
                outline-offset: -6px;
            }

            /* 2. Gold/Jewel Filigree (Ref 3, 7) */
            body[data-hull="filigree"] .glass-card {
                border-radius: 6px !important;
                outline: 1px solid rgba(var(--secondary-rgb), 0.32);
                outline-offset: -5px;
                background-image: 
                    radial-gradient(circle at 0 0, transparent 6px, var(--neon-vine) 6.5px, var(--neon-vine) 8px, transparent 8.5px),
                    radial-gradient(circle at 100% 0, transparent 6px, var(--neon-vine) 6.5px, var(--neon-vine) 8px, transparent 8.5px),
                    radial-gradient(circle at 0 100%, transparent 6px, var(--neon-vine) 6.5px, var(--neon-vine) 8px, transparent 8.5px),
                    radial-gradient(circle at 100% 100%, transparent 6px, var(--neon-vine) 6.5px, var(--neon-vine) 8px, transparent 8.5px) !important;
            }

            /* 3. Tactile Neumorphic Basin (Ref 9, 10) */
            body[data-hull="neumorphic"] .glass-card {
                border-radius: 22px !important;
                border: 1px solid rgba(255, 255, 255, 0.08) !important;
                box-shadow: 
                    10px 10px 24px rgba(0, 0, 0, 0.85),
                    -4px -4px 16px rgba(var(--neon-rgb), 0.08),
                    inset 2px 2px 5px rgba(255, 255, 255, 0.12),
                    inset -3px -3px 8px rgba(0, 0, 0, 0.75) !important;
            }

            /* 4. Luxury Bevel Chamfer (Ref 8) */
            body[data-hull="chamfer"] .glass-card {
                border-radius: 2px !important;
                clip-path: polygon(
                    0 11px, 11px 0,
                    calc(100% - 11px) 0, 100% 11px,
                    100% calc(100% - 11px), calc(100% - 11px) 100%,
                    11px 100%, 0 calc(100% - 11px)
                );
            }

            /* --- ПОВЕРХНЕВІ ТЕКСТУРИ (.glass-card::before) --- */
            .glass-card::before {
                content: "";
                position: absolute;
                inset: 0;
                border-radius: inherit;
                pointer-events: none;
                z-index: 0;
                opacity: 0.85;
            }

            /* Marble Stone Veins (Ref 1) */
            body[data-texture="marble-veins"] .glass-card::before {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'%3E%3Cg fill='none' stroke='%23ffffff' stroke-opacity='0.06' stroke-width='1.2'%3E%3Cpath d='M-10 40 Q 45 55 80 25 T 160 50 T 230 20'/%3E%3Cpath d='M80 25 Q 100 75 70 120 T 130 185' stroke-opacity='0.035'/%3E%3Cpath d='M-10 160 Q 60 140 110 175 T 230 150'/%3E%3C/g%3E%3C/svg%3E");
                background-size: 220px 220px;
            }

            /* Diagonal Satin Sheen (Ref 8) */
            body[data-texture="diagonal-satin"] .glass-card::before {
                background: repeating-linear-gradient(
                    -32deg,
                    transparent,
                    transparent 18px,
                    rgba(255, 255, 255, 0.025) 18px,
                    rgba(var(--neon-rgb), 0.04) 22px,
                    transparent 24px,
                    transparent 55px
                );
            }

            /* Velvet Suede Micro-Grain (Ref 2, 3) */
            body[data-texture="velvet-suede"] .glass-card::before {
                background-image: radial-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 0),
                                  radial-gradient(rgba(0, 0, 0, 0.35) 1px, transparent 0);
                background-size: 4px 4px;
                background-position: 0 0, 2px 2px;
            }

            /* Crystal Geode Facets (Ref 13) */
            body[data-texture="crystal-facets"] .glass-card::before {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'%3E%3Cg fill='none' stroke='%23ffffff' stroke-opacity='0.05' stroke-width='1'%3E%3Cpolygon points='70,5 130,45 110,125 30,125 10,45'/%3E%3Cline x1='70' y1='5' x2='70' y2='70'/%3E%3Cline x1='130' y1='45' x2='70' y2='70'/%3E%3Cline x1='110' y1='125' x2='70' y2='70'/%3E%3Cline x1='30' y1='125' x2='70' y2='70'/%3E%3Cline x1='10' y1='45' x2='70' y2='70'/%3E%3C/g%3E%3C/svg%3E");
                background-size: 140px 140px;
            }

            /* Carbon Weave */
            body[data-texture="carbon-weave"] .glass-card::before {
                background: 
                    linear-gradient(27deg, rgba(255,255,255,0.03) 5px, transparent 5px) 0 5px,
                    linear-gradient(207deg, rgba(255,255,255,0.03) 5px, transparent 5px) 10px 0px;
                background-size: 20px 20px;
            }

            /* Hex Grid */
            body[data-texture="hex-grid"] .glass-card::before {
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cpath fill='%23ffffff' fill-opacity='0.045' d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9z'/%3E%3C/svg%3E");
            }

            /* Anodized Noise */
            body[data-texture="anodized-noise"] .glass-card::before {
                background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 0);
                background-size: 6px 6px;
            }

            /* --- ОРГАНІЧНІ ПАРОСТКИ ЛІАН НА САМИХ КАРТКАХ (.glass-card::after) --- */
            body[data-flora-card-wrap="true"]:not(.eco-mode) .glass-card::after {
                content: "";
                position: absolute;
                inset: -2px;
                border-radius: inherit;
                pointer-events: none;
                z-index: 2;
                background: 
                    radial-gradient(320px circle at var(--card-mouse-x, -500px) var(--card-mouse-y, -500px), rgba(var(--neon-rgb), 0.16), transparent 65%),
                    linear-gradient(135deg, var(--neon-vine) 0%, transparent 18px) top left / 24px 24px no-repeat,
                    linear-gradient(-45deg, var(--neon-secondary) 0%, transparent 18px) bottom right / 24px 24px no-repeat;
                opacity: calc(0.55 * var(--flora-glow));
                filter: drop-shadow(0 0 6px var(--neon-vine));
            }

            /* --- ІГРОВИЙ СТІЛ (.game-table-oval) --- */
            .game-table-oval {
                background-image: radial-gradient(
                    ellipse at center,
                    rgba(var(--neon-rgb), 0.16) 0%,
                    rgba(var(--secondary-rgb), 0.06) 45%,
                    transparent 75%
                ) !important;
                border: 1px solid var(--border-base) !important;
                box-shadow: 
                    0 0 calc(48px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.2),
                    inset 0 0 calc(40px * var(--skin-bloom)) rgba(var(--neon-rgb), 0.14) !important;
            }

            /* --- ПОВНОЕКРАННИЙ ШАР ЖИВОЇ ФЛОРИ (CANVAS OVERLAY) --- */
            #aether-flora-canvas {
                position: fixed;
                inset: 0;
                width: 100vw;
                height: 100vh;
                pointer-events: none;
                z-index: 90;
                transition: opacity 0.4s ease;
            }

            body.eco-mode #aether-flora-canvas {
                display: none !important;
            }

            body.eco-mode .glass-card,
            body.eco-mode .top-bar,
            body.eco-mode .game-table-oval {
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                background: var(--bg-panel-solid) !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.8) !important;
            }

            /* =====================================================================
               STUDIO DRAWER UI (З ПРОКРУТКОЮ, ВКЛАДКАМИ ТА МЕНЕДЖЕРОМ ПРЕСЕТІВ)
               ===================================================================== */
            .aether-studio-mount {
                position: relative;
                display: inline-flex;
                align-items: center;
                margin-left: 10px;
                z-index: 10001;
                font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
            }

            .studio-trigger-btn {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 6px 14px;
                border-radius: 999px;
                background: linear-gradient(135deg, rgba(var(--neon-rgb), 0.22), rgba(0, 0, 0, 0.75));
                border: 1px solid var(--border-base);
                color: var(--text-main);
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1.1px;
                text-transform: uppercase;
                cursor: pointer;
                box-shadow: 0 0 16px rgba(var(--neon-rgb), 0.25), inset 0 1px 0 rgba(255,255,255,0.25);
                transition: all 0.2s ease;
            }

            .studio-trigger-btn:hover {
                border-color: var(--neon-vine);
                box-shadow: 0 0 24px rgba(var(--neon-rgb), 0.5);
                transform: translateY(-1px);
            }

            .studio-trigger-orb {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: linear-gradient(135deg, var(--neon-vine), var(--neon-secondary));
                box-shadow: 0 0 10px var(--neon-vine);
            }

            /* Головне вікно Студії з гарантованим внутрішнім скролом */
            .studio-drawer {
                position: fixed;
                top: 58px;
                right: 18px;
                width: 390px;
                max-width: calc(100vw - 28px);
                max-height: calc(100vh - 76px);
                display: none;
                flex-direction: column;
                border-radius: 18px;
                background: linear-gradient(165deg, rgba(14, 18, 24, 0.96) 0%, rgba(7, 9, 13, 0.98) 100%);
                backdrop-filter: blur(28px);
                -webkit-backdrop-filter: blur(28px);
                border: 1px solid var(--border-hover);
                box-shadow: 
                    0 28px 70px rgba(0, 0, 0, 0.92),
                    0 0 40px rgba(var(--neon-rgb), 0.22),
                    inset 0 1px 0 rgba(255, 255, 255, 0.22);
                color: var(--text-main);
                overflow: hidden;
                z-index: 10002;
                animation: studioPop 0.22s cubic-bezier(0.16, 1, 0.3, 1);
            }

            @keyframes studioPop {
                from { opacity: 0; transform: translateY(-10px) scale(0.97); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }

            .studio-drawer.open {
                display: flex;
            }

            /* Закріплена верхня шапка */
            .studio-header {
                padding: 14px 16px 10px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-shrink: 0;
            }

            .studio-brand {
                font-size: 12px;
                font-weight: 800;
                letter-spacing: 1.6px;
                text-transform: uppercase;
                background: linear-gradient(90deg, #fff, var(--neon-vine), var(--neon-secondary));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }

            .studio-subtitle {
                font-size: 10px;
                color: var(--text-muted);
            }

            /* Навігаційні вкладки */
            .studio-tabs {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 4px;
                padding: 8px 12px;
                background: rgba(0, 0, 0, 0.35);
                border-bottom: 1px solid rgba(255, 255, 255, 0.07);
                flex-shrink: 0;
            }

            .studio-tab-btn {
                padding: 7px 4px;
                border-radius: 8px;
                border: 1px solid transparent;
                background: transparent;
                color: var(--text-muted);
                font-size: 10.5px;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.2s ease;
                text-align: center;
            }

            .studio-tab-btn:hover {
                color: #fff;
                background: rgba(255, 255, 255, 0.05);
            }

            .studio-tab-btn.active {
                color: #fff;
                background: rgba(var(--neon-rgb), 0.18);
                border-color: var(--neon-vine);
                box-shadow: 0 0 12px rgba(var(--neon-rgb), 0.22);
            }

            /* Прокручуваний контейнер контенту */
            .studio-body {
                padding: 14px 16px 18px;
                overflow-y: auto;
                overflow-x: hidden;
                flex: 1 1 auto;
                display: flex;
                flex-direction: column;
                gap: 14px;
                scrollbar-width: thin;
                scrollbar-color: var(--neon-vine) rgba(255, 255, 255, 0.05);
            }

            .studio-body::-webkit-scrollbar {
                width: 6px;
            }
            .studio-body::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.04);
                border-radius: 6px;
            }
            .studio-body::-webkit-scrollbar-thumb {
                background: linear-gradient(180deg, var(--neon-vine), var(--neon-secondary));
                border-radius: 6px;
            }

            .studio-tab-pane {
                display: none;
                flex-direction: column;
                gap: 14px;
            }

            .studio-tab-pane.active {
                display: flex;
            }

            .studio-sec-label {
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 1.3px;
                color: var(--text-muted);
                margin-bottom: 6px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            /* Сітка карток пресетів */
            .studio-preset-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }

            .studio-preset-card {
                display: flex;
                flex-direction: column;
                gap: 5px;
                padding: 9px 10px;
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.08);
                cursor: pointer;
                text-align: left;
                transition: all 0.2s ease;
            }

            .studio-preset-card:hover {
                background: rgba(255, 255, 255, 0.07);
                border-color: rgba(var(--neon-rgb), 0.5);
                transform: translateY(-1px);
            }

            .studio-preset-card.active {
                background: linear-gradient(135deg, rgba(var(--neon-rgb), 0.22), rgba(0, 0, 0, 0.6));
                border-color: var(--neon-vine);
                box-shadow: 0 0 16px rgba(var(--neon-rgb), 0.25);
            }

            .swatch-bar {
                display: flex;
                align-items: center;
                gap: 5px;
            }

            .swatch-circle {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                border: 1px solid rgba(255,255,255,0.4);
            }

            .preset-name {
                font-size: 11px;
                font-weight: 700;
                color: #fff;
            }

            .preset-meta {
                font-size: 9.5px;
                color: rgba(255,255,255,0.55);
                line-height: 1.25;
            }

            /* Кастомні колор-пікери */
            .studio-color-row {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 8px;
            }

            .studio-color-box {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                padding: 7px;
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.08);
                font-size: 10px;
                color: var(--text-muted);
            }

            .studio-color-input {
                width: 100%;
                height: 26px;
                border: none;
                border-radius: 6px;
                background: transparent;
                cursor: pointer;
            }

            /* Пігулки вибору параметрів */
            .studio-pill-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px;
            }

            .studio-pill {
                padding: 8px 9px;
                border-radius: 9px;
                background: rgba(255, 255, 255, 0.035);
                border: 1px solid rgba(255, 255, 255, 0.09);
                color: var(--text-main);
                font-size: 10.5px;
                font-weight: 600;
                cursor: pointer;
                text-align: left;
                transition: all 0.18s ease;
            }

            .studio-pill:hover {
                border-color: rgba(var(--neon-rgb), 0.5);
                background: rgba(255, 255, 255, 0.07);
            }

            .studio-pill.active {
                background: rgba(var(--neon-rgb), 0.22);
                border-color: var(--neon-vine);
                color: #fff;
                box-shadow: 0 0 12px rgba(var(--neon-rgb), 0.22);
            }

            /* Слайдери */
            .studio-range {
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 6px;
                border-radius: 99px;
                background: rgba(255, 255, 255, 0.12);
                outline: none;
                cursor: pointer;
            }

            .studio-range::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 15px;
                height: 15px;
                border-radius: 50%;
                background: var(--neon-vine);
                box-shadow: 0 0 12px var(--neon-vine);
                border: 2px solid #fff;
                cursor: pointer;
            }

            /* Поле збереження пресета */
            .studio-save-bar {
                display: flex;
                gap: 6px;
            }

            .studio-text-input {
                flex: 1;
                padding: 8px 10px;
                border-radius: 8px;
                background: rgba(0, 0, 0, 0.5);
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: #fff;
                font-size: 11.5px;
                outline: none;
            }

            .studio-text-input:focus {
                border-color: var(--neon-vine);
            }

            .studio-action-btn {
                padding: 8px 12px;
                border-radius: 8px;
                border: 1px solid var(--neon-vine);
                background: rgba(var(--neon-rgb), 0.22);
                color: #fff;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .studio-action-btn:hover {
                background: rgba(var(--neon-rgb), 0.4);
                box-shadow: 0 0 14px rgba(var(--neon-rgb), 0.35);
            }

            .custom-preset-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 10px;
                border-radius: 9px;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }

            .custom-preset-del {
                background: rgba(255, 50, 80, 0.2);
                border: 1px solid rgba(255, 50, 80, 0.5);
                color: #ff8da1;
                border-radius: 6px;
                padding: 3px 8px;
                font-size: 10px;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Створює повноекранний Canvas для живих процедурних ліан, квітів, кристалів та спор
     */
    mountFloraCanvas() {
        if (document.getElementById('aether-flora-canvas')) return;
        const canvas = document.createElement('canvas');
        canvas.id = 'aether-flora-canvas';
        document.body.appendChild(canvas);
        this.floraCanvas = canvas;
        this.floraCtx = canvas.getContext('2d');

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            this.rebuildProceduralVines();
        };
        window.addEventListener('resize', resize);
        resize();
    }

    /**
     * Генерує органічні гілки ліан по периметру екрана відповідно до повзунка floraDensity (0 - 100)
     */
    rebuildProceduralVines() {
        if (!this.floraCanvas) return;
        const w = this.floraCanvas.width;
        const h = this.floraCanvas.height;
        const density = Number(this.state.floraDensity) || 0;

        this.vineNodes = [];
        this.spores = [];

        if (density <= 0) return;

        // Кількість головних стебел (від 2 до 28 залежно від повзунка)
        const branchCount = Math.max(2, Math.round((density / 100) * 28));
        const maxLen = 70 + (density / 100) * 190;

        for (let i = 0; i < branchCount; i++) {
            // Розміщуємо корені вздовж країв та кутів екрана
            const edge = i % 4;
            let startX, startY, baseAngle;

            if (edge === 0) { // Лівий край
                startX = 0;
                startY = (h * ((i * 73) % 100)) / 100;
                baseAngle = (Math.random() - 0.5) * 0.9;
            } else if (edge === 1) { // Правий край
                startX = w;
                startY = (h * ((i * 61) % 100)) / 100;
                baseAngle = Math.PI + (Math.random() - 0.5) * 0.9;
            } else if (edge === 2) { // Верхній край
                startX = (w * ((i * 53) % 100)) / 100;
                startY = 0;
                baseAngle = Math.PI / 2 + (Math.random() - 0.5) * 0.9;
            } else { // Нижній край
                startX = (w * ((i * 83) % 100)) / 100;
                startY = h;
                baseAngle = -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
            }

            const segments = [];
            let curX = startX;
            let curY = startY;
            let curAngle = baseAngle;
            const segCount = 12 + Math.floor((density / 100) * 14);
            const segLen = maxLen / segCount;

            for (let s = 0; s < segCount; s++) {
                curAngle += Math.sin(s * 0.7 + i) * 0.24;
                const nx = curX + Math.cos(curAngle) * segLen;
                const ny = curY + Math.sin(curAngle) * segLen;
                segments.push({
                    x: nx,
                    y: ny,
                    angle: curAngle,
                    ratio: 1 - s / segCount,
                    hasBlossom: s > 3 && (s % 4 === 0 || s === segCount - 1)
                });
                curX = nx;
                curY = ny;
            }

            this.vineNodes.push({
                startX,
                startY,
                phase: i * 1.3,
                thickness: 2.2 + (density / 100) * 2.4,
                segments
            });
        }

        // Спори / лісові світлячки (Ref 7, 13)
        const sporeCount = Math.round((density / 100) * 45);
        for (let i = 0; i < sporeCount; i++) {
            this.spores.push({
                x: Math.random() * w,
                y: Math.random() * h,
                r: 1.2 + Math.random() * 2.4,
                vx: (Math.random() - 0.5) * 0.35,
                vy: -0.15 - Math.random() * 0.4,
                phase: Math.random() * Math.PI * 2,
                isSecondary: i % 3 === 0
            });
        }
    }

    /**
     * Живий цикл анімації неонових ліан, руху соку, квітів та спор
     */
    startFloraLoop() {
        const render = (time) => {
            this.animFrameId = requestAnimationFrame(render);
            if (!this.floraCtx || !this.floraCanvas) return;

            const ctx = this.floraCtx;
            const w = this.floraCanvas.width;
            const h = this.floraCanvas.height;
            ctx.clearRect(0, 0, w, h);

            if (this.state.ecoMode || this.state.floraDensity <= 0) return;

            const t = time * 0.001 * this.state.floraSwaySpeed;
            const primaryColor = this.state.primary;
            const secondaryColor = this.state.secondary;
            const style = this.state.floraStyle;
            const glowMult = this.state.floraGlow;

            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // 1. Малюємо живі стебла ліан із вітровим коливанням
            for (let i = 0; i < this.vineNodes.length; i++) {
                const vine = this.vineNodes[i];
                ctx.beginPath();
                ctx.moveTo(vine.startX, vine.startY);

                let prevX = vine.startX;
                let prevY = vine.startY;

                for (let s = 0; s < vine.segments.length; s++) {
                    const seg = vine.segments[s];
                    const sway = Math.sin(t * 1.6 + vine.phase + s * 0.35) * (s * 0.85);
                    const sx = seg.x + Math.cos(seg.angle + Math.PI / 2) * sway;
                    const sy = seg.y + Math.sin(seg.angle + Math.PI / 2) * sway;

                    if (style === 'cyber-circuit') {
                        ctx.lineTo(sx, sy);
                    } else {
                        const midX = (prevX + sx) * 0.5;
                        const midY = (prevY + sy) * 0.5;
                        ctx.quadraticCurveTo(prevX, prevY, midX, midY);
                    }
                    prevX = sx;
                    prevY = sy;
                }

                ctx.strokeStyle = primaryColor;
                ctx.lineWidth = vine.thickness;
                ctx.shadowColor = primaryColor;
                ctx.shadowBlur = 12 * glowMult;
                ctx.globalAlpha = 0.72;
                ctx.stroke();

                // 2. Малюємо листя, золоті квіти (Ref 7), біо-кристали (Ref 13) та імпульси соку
                const pulseIdx = Math.floor(((t * 3 + vine.phase) % 1) * vine.segments.length);

                for (let s = 0; s < vine.segments.length; s++) {
                    const seg = vine.segments[s];
                    const sway = Math.sin(t * 1.6 + vine.phase + s * 0.35) * (s * 0.85);
                    const sx = seg.x + Math.cos(seg.angle + Math.PI / 2) * sway;
                    const sy = seg.y + Math.sin(seg.angle + Math.PI / 2) * sway;

                    // Імпульс енергії по ліані
                    if (s === pulseIdx) {
                        ctx.beginPath();
                        ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
                        ctx.fillStyle = '#ffffff';
                        ctx.shadowColor = secondaryColor;
                        ctx.shadowBlur = 14 * glowMult;
                        ctx.globalAlpha = 0.95;
                        ctx.fill();
                    }

                    if (!seg.hasBlossom) continue;

                    ctx.save();
                    ctx.translate(sx, sy);
                    ctx.rotate(seg.angle + Math.sin(t + s) * 0.2);

                    if (style === 'blossom-gold') {
                        // Квітуча лісова лоза з теплими бутонами (Ref 7)
                        ctx.fillStyle = secondaryColor;
                        ctx.shadowColor = secondaryColor;
                        ctx.shadowBlur = 10 * glowMult;
                        ctx.globalAlpha = 0.88;
                        for (let p = 0; p < 5; p++) {
                            ctx.rotate((Math.PI * 2) / 5);
                            ctx.beginPath();
                            ctx.ellipse(4.5, 0, 3.5, 1.8, 0, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    } else if (style === 'crystal-fern') {
                        // Кристалічні біо-грані (Ref 13)
                        ctx.fillStyle = s % 2 === 0 ? primaryColor : secondaryColor;
                        ctx.shadowColor = primaryColor;
                        ctx.shadowBlur = 12 * glowMult;
                        ctx.globalAlpha = 0.85;
                        ctx.beginPath();
                        ctx.moveTo(0, -6);
                        ctx.lineTo(5, 0);
                        ctx.lineTo(0, 6);
                        ctx.lineTo(-5, 0);
                        ctx.closePath();
                        ctx.fill();
                    } else if (style === 'thorn-briar') {
                        // Гострі готичні шипи (Ref 3)
                        ctx.fillStyle = primaryColor;
                        ctx.beginPath();
                        ctx.moveTo(0, 0);
                        ctx.lineTo(-4, -9);
                        ctx.lineTo(3, -2);
                        ctx.closePath();
                        ctx.fill();
                    } else {
                        // Сяючі синаптичні вузли
                        ctx.fillStyle = secondaryColor;
                        ctx.beginPath();
                        ctx.arc(0, 0, 3, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.restore();
                }
            }

            // 3. Літаючі спори / світлячки по Етеру
            if (this.state.floraSpores) {
                for (let i = 0; i < this.spores.length; i++) {
                    const sp = this.spores[i];
                    sp.x += sp.vx + Math.sin(t + sp.phase) * 0.2;
                    sp.y += sp.vy;

                    if (sp.y < -10) sp.y = h + 10;
                    if (sp.x < -10) sp.x = w + 10;
                    if (sp.x > w + 10) sp.x = -10;

                    const alpha = 0.35 + 0.55 * Math.abs(Math.sin(t * 1.8 + sp.phase));
                    const color = sp.isSecondary ? secondaryColor : primaryColor;

                    ctx.beginPath();
                    ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
                    ctx.fillStyle = color;
                    ctx.shadowColor = color;
                    ctx.shadowBlur = 10 * glowMult;
                    ctx.globalAlpha = alpha;
                    ctx.fill();
                }
            }

            ctx.restore();
        };

        this.animFrameId = requestAnimationFrame(render);
    }

    /**
     * Застосовує всі параметри палітри, скла, текстури та ліан
     */
    applyAll(rebuildFlora = false) {
        const root = document.documentElement;
        const neonRgb = this.hexToRgbString(this.state.primary);
        const secRgb = this.hexToRgbString(this.state.secondary);

        root.style.setProperty('--bg-panel', this.state.bgPanel);
        root.style.setProperty('--bg-panel-solid', this.state.bgSolid);
        root.style.setProperty('--neon-vine', this.state.primary);
        root.style.setProperty('--neon-secondary', this.state.secondary);
        root.style.setProperty('--surface-tint', this.state.surfaceTint);
        root.style.setProperty('--neon-rgb', neonRgb);
        root.style.setProperty('--secondary-rgb', secRgb);
        root.style.setProperty('--text-main', this.state.textMain);
        root.style.setProperty('--text-muted', this.state.textMuted);
        root.style.setProperty('--border-base', `rgba(${neonRgb}, ${this.state.borderOpacity})`);
        root.style.setProperty('--border-hover', `rgba(${neonRgb}, 0.88)`);
        root.style.setProperty('--skin-blur', this.state.ecoMode ? '0px' : `${this.state.blur}px`);
        root.style.setProperty('--skin-bloom', this.state.ecoMode ? '0' : String(this.state.bloom));
        root.style.setProperty('--skin-radius', `${this.state.borderRadius}px`);
        root.style.setProperty('--flora-glow', String(this.state.floraGlow));

        if (document.body) {
            document.body.dataset.hull = this.state.hull;
            document.body.dataset.glassRecipe = this.state.glassRecipe;
            document.body.dataset.texture = this.state.texture;
            document.body.dataset.floraCardWrap = String(Boolean(this.state.floraCardWrap));
            document.body.classList.toggle('eco-mode', Boolean(this.state.ecoMode));
        }

        // Оновлюємо також існуючі DOM-ліани Етера, якщо вони присутні на сторінці
        document.querySelectorAll('svg path[class*="vine"], .vine-svg path, .aether-vines path').forEach(el => {
            el.style.stroke = this.state.primary;
        });

        if (rebuildFlora) {
            this.rebuildProceduralVines();
        }

        this.syncHUDControls();
        this.saveState();
    }

    /**
     * Застосовує пресет (вбудований або кастомний)
     */
    applyPresetById(presetId) {
        const preset = this.builtInPresets[presetId] || this.customPresets[presetId];
        if (!preset) return;

        this.state = {
            ...this.state,
            ...preset.config,
            activePresetId: presetId
        };
        this.applyAll(true);
    }

    /**
     * Зберігає поточні налаштування як іменований пресет користувача
     */
    saveCustomPreset(customName) {
        const cleanName = (customName || '').trim() || `Custom Style #${Object.keys(this.customPresets).length + 1}`;
        const id = 'custom_' + Date.now();

        this.customPresets[id] = {
            name: cleanName,
            category: 'User Custom',
            desc: `${this.hulls[this.state.hull]?.name || 'Custom'} • Флора ${this.state.floraDensity}%`,
            colors: [this.state.bgSolid, this.state.primary, this.state.secondary],
            config: {
                bgPanel: this.state.bgPanel,
                bgSolid: this.state.bgSolid,
                primary: this.state.primary,
                secondary: this.state.secondary,
                surfaceTint: this.state.surfaceTint,
                textMain: this.state.textMain,
                textMuted: this.state.textMuted,
                hull: this.state.hull,
                glassRecipe: this.state.glassRecipe,
                texture: this.state.texture,
                blur: this.state.blur,
                bloom: this.state.bloom,
                borderRadius: this.state.borderRadius,
                borderOpacity: this.state.borderOpacity,
                floraDensity: this.state.floraDensity,
                floraStyle: this.state.floraStyle,
                floraGlow: this.state.floraGlow,
                floraSwaySpeed: this.state.floraSwaySpeed,
                floraSpores: this.state.floraSpores,
                floraCardWrap: this.state.floraCardWrap
            }
        };

        this.state.activePresetId = id;
        this.saveCustomPresetsToStorage();
        this.saveState();
        this.renderCustomPresetsList();
        this.syncHUDControls();
    }

    deleteCustomPreset(id) {
        delete this.customPresets[id];
        this.saveCustomPresetsToStorage();
        this.renderCustomPresetsList();
    }

    /**
     * Монтує головну панель Студії у .top-bar або #aether-skin-slot
     */
    mountStudioHUD() {
        if (document.getElementById('aether-studio-mount')) return;

        const mount = document.createElement('div');
        mount.id = 'aether-studio-mount';
        mount.className = 'aether-studio-mount';

        // Картки 16 пресетів
        const presetsHTML = Object.entries(this.builtInPresets).map(([id, p]) => `
            <button type="button" class="studio-preset-card" data-preset-id="${id}">
                <div class="swatch-bar">
                    <span class="swatch-circle" style="background:${p.colors[0]}"></span>
                    <span class="swatch-circle" style="background:${p.colors[1]};box-shadow:0 0 6px ${p.colors[1]}"></span>
                    <span class="swatch-circle" style="background:${p.colors[2]}"></span>
                </div>
                <div class="preset-name">${p.name}</div>
                <div class="preset-meta">${p.desc}</div>
            </button>
        `).join('');

        // Корпуси (Hulls)
        const hullsHTML = Object.entries(this.hulls).map(([k, h]) => `
            <button type="button" class="studio-pill" data-hull="${k}" title="${h.desc}">${h.name}</button>
        `).join('');

        // Рецепти скла
        const recipesHTML = Object.entries(this.glassRecipes).map(([k, r]) => `
            <button type="button" class="studio-pill" data-recipe="${k}" title="${r.desc}">${r.name}</button>
        `).join('');

        // Текстури
        const texturesHTML = Object.entries(this.textures).map(([k, t]) => `
            <button type="button" class="studio-pill" data-tex="${k}">${t.name}</button>
        `).join('');

        // Види Флори
        const floraStylesHTML = Object.entries(this.floraStyles).map(([k, f]) => `
            <button type="button" class="studio-pill" data-flora-style="${k}">${f.name}</button>
        `).join('');

        mount.innerHTML = `
            <button type="button" class="studio-trigger-btn" id="studio-trigger-btn">
                <span class="studio-trigger-orb"></span>
                <span>ATELIER STUDIO</span>
            </button>

            <div class="studio-drawer" id="studio-drawer">
                <div class="studio-header">
                    <div>
                        <div class="studio-brand">Aether Sovereign Studio</div>
                        <div class="studio-subtitle">16 Референс-Матриць • Жива Флора • Liquid Glass</div>
                    </div>
                    <button type="button" class="studio-action-btn" id="studio-gm-sync-btn" title="Транслювати цей візуал усім гравцям">
                        📡 GM Sync
                    </button>
                </div>

                <!-- 4 Вкладки навігації -->
                <div class="studio-tabs">
                    <button type="button" class="studio-tab-btn active" data-tab="palettes">🎨 Палітри</button>
                    <button type="button" class="studio-tab-btn" data-tab="optics">💎 Оптика</button>
                    <button type="button" class="studio-tab-btn" data-tab="flora">🌿 Флора</button>
                    <button type="button" class="studio-tab-btn" data-tab="presets">💾 Пресети</button>
                </div>

                <!-- ПРОКРУЧУВАНИЙ КОНТЕЙНЕР (SCROLLABLE BODY) -->
                <div class="studio-body">
                    
                    <!-- ВКЛАДКА 1: ПАЛІТРИ ТА ЖИВІ КОЛЬОРИ -->
                    <div class="studio-tab-pane active" data-pane="palettes">
                        <div>
                            <div class="studio-sec-label">
                                <span>Тонке налаштування кольорів (впливає і на ліани)</span>
                            </div>
                            <div class="studio-color-row">
                                <label class="studio-color-box">
                                    <span>Неон / Ліани</span>
                                    <input type="color" class="studio-color-input" id="ctrl-color-primary" value="${this.state.primary}">
                                </label>
                                <label class="studio-color-box">
                                    <span>Квіти / Блік</span>
                                    <input type="color" class="studio-color-input" id="ctrl-color-secondary" value="${this.state.secondary}">
                                </label>
                                <label class="studio-color-box">
                                    <span>Глибина фону</span>
                                    <input type="color" class="studio-color-input" id="ctrl-color-bg" value="${this.state.bgSolid}">
                                </label>
                            </div>
                        </div>

                        <div>
                            <div class="studio-sec-label"><span>Колекція пресетів за референсами (16)</span></div>
                            <div class="studio-preset-grid">
                                ${presetsHTML}
                            </div>
                        </div>
                    </div>

                    <!-- ВКЛАДКА 2: ОПТИКА СКЛА, КОРПУС ТА ТЕКСТУРИ -->
                    <div class="studio-tab-pane" data-pane="optics">
                        <div>
                            <div class="studio-sec-label"><span>Архітектура Корпусу (Hull Style)</span></div>
                            <div class="studio-pill-grid">${hullsHTML}</div>
                        </div>

                        <div>
                            <div class="studio-sec-label"><span>Рецепт Заломлення (Liquid Glass Recipe)</span></div>
                            <div class="studio-pill-grid">${recipesHTML}</div>
                        </div>

                        <div>
                            <div class="studio-sec-label"><span>Мікро-текстура Поверхні</span></div>
                            <div class="studio-pill-grid">${texturesHTML}</div>
                        </div>

                        <div>
                            <div class="studio-sec-label">
                                <span>Глибина розмиття скла (Blur)</span>
                                <span id="lbl-blur">${this.state.blur}px</span>
                            </div>
                            <input type="range" class="studio-range" id="ctrl-blur" min="0" max="36" step="2" value="${this.state.blur}">
                        </div>

                        <div>
                            <div class="studio-sec-label">
                                <span>Радіус скруглення (Radius Style)</span>
                                <span id="lbl-radius">${this.state.borderRadius}px</span>
                            </div>
                            <input type="range" class="studio-range" id="ctrl-radius" min="0" max="32" step="2" value="${this.state.borderRadius}">
                        </div>

                        <div>
                            <div class="studio-sec-label">
                                <span>Інтенсивність Свічення (Bloom)</span>
                                <span id="lbl-bloom">${Math.round(this.state.bloom * 100)}%</span>
                            </div>
                            <input type="range" class="studio-range" id="ctrl-bloom" min="0" max="2.2" step="0.05" value="${this.state.bloom}">
                        </div>
                    </div>

                    <!-- ВКЛАДКА 3: ЖИВА НЕОНОВА ФЛОРА ТА ЛІАНИ -->
                    <div class="studio-tab-pane" data-pane="flora">
                        <div>
                            <div class="studio-sec-label">
                                <span>🌿 Густота Неонової Флори по Етеру</span>
                                <span id="lbl-flora-density">${this.state.floraDensity}%</span>
                            </div>
                            <input type="range" class="studio-range" id="ctrl-flora-density" min="0" max="100" step="5" value="${this.state.floraDensity}">
                        </div>

                        <div>
                            <div class="studio-sec-label"><span>Біологічний Вид Ліан</span></div>
                            <div class="studio-pill-grid">${floraStylesHTML}</div>
                        </div>

                        <div>
                            <div class="studio-sec-label">
                                <span>Яскравість Біо-люмінесценції Ліан</span>
                                <span id="lbl-flora-glow">${Math.round(this.state.floraGlow * 100)}%</span>
                            </div>
                            <input type="range" class="studio-range" id="ctrl-flora-glow" min="0.2" max="2.5" step="0.1" value="${this.state.floraGlow}">
                        </div>

                        <div>
                            <div class="studio-sec-label">
                                <span>Швидкість Живого Коливання (Sway)</span>
                                <span id="lbl-flora-sway">${this.state.floraSwaySpeed.toFixed(1)}x</span>
                            </div>
                            <input type="range" class="studio-range" id="ctrl-flora-sway" min="0" max="2.5" step="0.1" value="${this.state.floraSwaySpeed}">
                        </div>

                        <div class="studio-pill-grid">
                            <button type="button" class="studio-pill" id="btn-toggle-spores">✨ Лісові Спори / Світлячки</button>
                            <button type="button" class="studio-pill" id="btn-toggle-card-wrap">🌱 Паростки на Плашках</button>
                        </div>
                    </div>

                    <!-- ВКЛАДКА 4: ЗБЕРЕЖЕННЯ ВЛАСНИХ ПРЕСЕТІВ -->
                    <div class="studio-tab-pane" data-pane="presets">
                        <div>
                            <div class="studio-sec-label"><span>Зберегти поточну комбінацію як новий пресет</span></div>
                            <div class="studio-save-bar">
                                <input type="text" class="studio-text-input" id="input-preset-name" placeholder="Назва (напр. Шепіт Ірмінсуля)...">
                                <button type="button" class="studio-action-btn" id="btn-save-preset">+ Зберегти</button>
                            </div>
                        </div>

                        <div>
                            <div class="studio-sec-label"><span>Мої збережені пресети</span></div>
                            <div id="custom-presets-container" style="display:flex;flex-direction:column;gap:8px;"></div>
                        </div>

                        <div style="padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
                            <button type="button" class="studio-pill" id="btn-toggle-eco" style="width:100%;text-align:center;">
                                ⚡ Енергозбереження (ECO-Mode)
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        `;

        const slot = document.getElementById('aether-skin-slot') || document.querySelector('.top-bar');
        if (slot) {
            slot.appendChild(mount);
        } else {
            mount.style.position = 'fixed';
            mount.style.top = '12px';
            mount.style.right = '18px';
            document.body.appendChild(mount);
        }

        this.bindHUDEvents(mount);
        this.renderCustomPresetsList();
        this.syncHUDControls();
    }

    bindHUDEvents(mount) {
        const trigger = mount.querySelector('#studio-trigger-btn');
        const drawer = mount.querySelector('#studio-drawer');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            drawer.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!mount.contains(e.target)) drawer.classList.remove('open');
        });

        // Перемикання вкладок
        mount.querySelectorAll('.studio-tab-btn').forEach(tabBtn => {
            tabBtn.addEventListener('click', () => {
                const target = tabBtn.dataset.tab;
                mount.querySelectorAll('.studio-tab-btn').forEach(b => b.classList.toggle('active', b === tabBtn));
                mount.querySelectorAll('.studio-tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === target));
            });
        });

        // Клік по 16 пресетах
        mount.querySelectorAll('[data-preset-id]').forEach(card => {
            card.addEventListener('click', () => this.applyPresetById(card.dataset.presetId));
        });

        // Живі колор-пікери (одразу фарбують і інтерфейс, і ліани)
        mount.querySelector('#ctrl-color-primary').addEventListener('input', (e) => {
            this.state.primary = e.target.value;
            this.applyAll(false);
        });

        mount.querySelector('#ctrl-color-secondary').addEventListener('input', (e) => {
            this.state.secondary = e.target.value;
            this.applyAll(false);
        });

        mount.querySelector('#ctrl-color-bg').addEventListener('input', (e) => {
            const hex = e.target.value;
            const rgb = this.hexToRgbString(hex);
            this.state.bgSolid = hex;
            this.state.bgPanel = `rgba(${rgb}, 0.84)`;
            this.applyAll(false);
        });

        // Корпуси, Оптика та Текстури
        mount.querySelectorAll('[data-hull]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.hull = btn.dataset.hull;
                this.applyAll(false);
            });
        });

        mount.querySelectorAll('[data-recipe]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.glassRecipe = btn.dataset.recipe;
                this.applyAll(false);
            });
        });

        mount.querySelectorAll('[data-tex]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.texture = btn.dataset.tex;
                this.applyAll(false);
            });
        });

        // Слайдери оптики
        mount.querySelector('#ctrl-blur').addEventListener('input', (e) => {
            this.state.blur = parseInt(e.target.value, 10);
            this.applyAll(false);
        });

        mount.querySelector('#ctrl-radius').addEventListener('input', (e) => {
            this.state.borderRadius = parseInt(e.target.value, 10);
            this.applyAll(false);
        });

        mount.querySelector('#ctrl-bloom').addEventListener('input', (e) => {
            this.state.bloom = parseFloat(e.target.value);
            this.applyAll(false);
        });

        // Повзунок густоти Неонової Флори
        mount.querySelector('#ctrl-flora-density').addEventListener('input', (e) => {
            this.state.floraDensity = parseInt(e.target.value, 10);
            this.applyAll(true);
        });

        // Вид флори
        mount.querySelectorAll('[data-flora-style]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.floraStyle = btn.dataset.floraStyle;
                this.applyAll(false);
            });
        });

        mount.querySelector('#ctrl-flora-glow').addEventListener('input', (e) => {
            this.state.floraGlow = parseFloat(e.target.value);
            this.applyAll(false);
        });

        mount.querySelector('#ctrl-flora-sway').addEventListener('input', (e) => {
            this.state.floraSwaySpeed = parseFloat(e.target.value);
            this.applyAll(false);
        });

        mount.querySelector('#btn-toggle-spores').addEventListener('click', () => {
            this.state.floraSpores = !this.state.floraSpores;
            this.applyAll(false);
        });

        mount.querySelector('#btn-toggle-card-wrap').addEventListener('click', () => {
            this.state.floraCardWrap = !this.state.floraCardWrap;
            this.applyAll(false);
        });

        // Збереження власного пресета
        const nameInput = mount.querySelector('#input-preset-name');
        mount.querySelector('#btn-save-preset').addEventListener('click', () => {
            this.saveCustomPreset(nameInput.value);
            nameInput.value = '';
        });

        mount.querySelector('#btn-toggle-eco').addEventListener('click', () => {
            this.state.ecoMode = !this.state.ecoMode;
            this.applyAll(false);
        });

        // GM Sync
        const syncBtn = mount.querySelector('#studio-gm-sync-btn');
        syncBtn.addEventListener('click', () => {
            if (this.channel) {
                this.channel.postMessage({ type: 'AETHER_SKIN_FORCE_SYNC', payload: this.state });
            }
            const orig = syncBtn.textContent;
            syncBtn.textContent = '✓ Синхронізовано';
            setTimeout(() => { syncBtn.textContent = orig; }, 1400);
        });
    }

    renderCustomPresetsList() {
        const container = document.getElementById('custom-presets-container');
        if (!container) return;

        const entries = Object.entries(this.customPresets);
        if (entries.length === 0) {
            container.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:8px 0;">У вас поки немає збережених кастомних пресетів. Налаштуйте кольори, оптику та флору й натисніть «+ Зберегти».</div>`;
            return;
        }

        container.innerHTML = entries.map(([id, p]) => `
            <div class="custom-preset-item">
                <div style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;" data-load-custom="${id}">
                    <span class="swatch-circle" style="background:${p.colors[1]};box-shadow:0 0 6px ${p.colors[1]}"></span>
                    <div>
                        <div style="font-size:11.5px;font-weight:700;color:#fff;">${p.name}</div>
                        <div style="font-size:9.5px;color:var(--text-muted);">${p.desc}</div>
                    </div>
                </div>
                <button type="button" class="custom-preset-del" data-del-custom="${id}">Видалити</button>
            </div>
        `).join('');

        container.querySelectorAll('[data-load-custom]').forEach(el => {
            el.addEventListener('click', () => this.applyPresetById(el.dataset.loadCustom));
        });

        container.querySelectorAll('[data-del-custom]').forEach(btn => {
            btn.addEventListener('click', () => this.deleteCustomPreset(btn.dataset.delCustom));
        });
    }

    syncHUDControls() {
        const mount = document.getElementById('aether-studio-mount');
        if (!mount) return;

        mount.querySelectorAll('[data-preset-id]').forEach(el => {
            el.classList.toggle('active', el.dataset.presetId === this.state.activePresetId);
        });

        mount.querySelectorAll('[data-hull]').forEach(el => {
            el.classList.toggle('active', el.dataset.hull === this.state.hull);
        });

        mount.querySelectorAll('[data-recipe]').forEach(el => {
            el.classList.toggle('active', el.dataset.recipe === this.state.glassRecipe);
        });

        mount.querySelectorAll('[data-tex]').forEach(el => {
            el.classList.toggle('active', el.dataset.tex === this.state.texture);
        });

        mount.querySelectorAll('[data-flora-style]').forEach(el => {
            el.classList.toggle('active', el.dataset.floraStyle === this.state.floraStyle);
        });

        const setVal = (sel, val) => { const el = mount.querySelector(sel); if (el) el.value = val; };
        const setTxt = (sel, txt) => { const el = mount.querySelector(sel); if (el) el.textContent = txt; };

        setVal('#ctrl-color-primary', this.state.primary);
        setVal('#ctrl-color-secondary', this.state.secondary);
        setVal('#ctrl-color-bg', this.state.bgSolid);
        setVal('#ctrl-blur', this.state.blur);
        setVal('#ctrl-radius', this.state.borderRadius);
        setVal('#ctrl-bloom', this.state.bloom);
        setVal('#ctrl-flora-density', this.state.floraDensity);
        setVal('#ctrl-flora-glow', this.state.floraGlow);
        setVal('#ctrl-flora-sway', this.state.floraSwaySpeed);

        setTxt('#lbl-blur', `${this.state.blur}px`);
        setTxt('#lbl-radius', `${this.state.borderRadius}px`);
        setTxt('#lbl-bloom', `${Math.round(this.state.bloom * 100)}%`);
        setTxt('#lbl-flora-density', `${this.state.floraDensity}%`);
        setTxt('#lbl-flora-glow', `${Math.round(this.state.floraGlow * 100)}%`);
        setTxt('#lbl-flora-sway', `${Number(this.state.floraSwaySpeed).toFixed(1)}x`);

        mount.querySelector('#btn-toggle-spores')?.classList.toggle('active', Boolean(this.state.floraSpores));
        mount.querySelector('#btn-toggle-card-wrap')?.classList.toggle('active', Boolean(this.state.floraCardWrap));
        mount.querySelector('#btn-toggle-eco')?.classList.toggle('active', Boolean(this.state.ecoMode));
    }

    initSpotlight() {
        let pending = false;
        document.addEventListener('mousemove', (e) => {
            if (this.state.ecoMode || pending) return;
            pending = true;
            requestAnimationFrame(() => {
                const cards = document.querySelectorAll('.glass-card');
                for (let i = 0; i < cards.length; i++) {
                    const r = cards[i].getBoundingClientRect();
                    if (e.clientX >= r.left - 100 && e.clientX <= r.right + 100 && e.clientY >= r.top - 100 && e.clientY <= r.bottom + 100) {
                        cards[i].style.setProperty('--card-mouse-x', `${e.clientX - r.left}px`);
                        cards[i].style.setProperty('--card-mouse-y', `${e.clientY - r.top}px`);
                    }
                }
                pending = false;
            });
        }, { passive: true });
    }

    initBroadcastChannel() {
        try {
            this.channel = new BroadcastChannel(this.SYNC_CHANNEL);
            this.channel.addEventListener('message', (ev) => {
                if (ev.data && ev.data.type === 'AETHER_SKIN_FORCE_SYNC') {
                    this.state = { ...this.state, ...ev.data.payload };
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
                    this.applyAll(false);
                }
            });
            obs.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-eco'] });
        };
        document.body ? attach() : document.addEventListener('DOMContentLoaded', attach);
    }
}

// Авто-ініціалізація
window.AetherSkins = new AetherSovereignStudio();