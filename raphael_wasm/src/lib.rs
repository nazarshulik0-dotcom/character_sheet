use serde::{Deserialize, Serialize};
use std::f32::consts::{PI, TAU};
use wasm_bindgen::prelude::*;

// ============================================================================
// 1. СТАНИ ЕВОЛЮЦІЇ ТА РЕЖИМИ РОБОТИ РАФАЇЛА
// ============================================================================

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RaphaelEvolutionStage {
    Dormant = 0, // Спляча тьмяна геометрія (до активації Маяка I)
    Active = 1,  // Квантова Сфера (Маяки 1..8, сухий аналітичний режим)
    Manas = 2,   // Гуманоїдний бюст Манаса із золотим ядром (9/9 Маяків, злиття з Сіель)
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RaphaelActivityMode {
    Idle = 0,
    Awakening = 1, // Трифазна ініціалізація (Neo-Babylonian -> EN -> UK)
    Listening = 2, // Прийом голосу гравця
    Thinking = 3,  // Обробка RAG Ірмінсуля + запит до LLM
    Speaking = 4,  // Озвучення відповіді (MP3 або ElevenLabs)
    QuarantineAlert = 5, // Спрацював Fail-Safe Сіель
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadDecision {
    Silence = 0,
    Speaking = 1,
    SpeechEndedTriggerSend = 2, // Миттєвий тригер зупинки запису!
}

#[derive(Clone, Copy)]
struct Particle3D {
    // Координати у формі Квантової Сфери (Active)
    sphere_x: f32,
    sphere_y: f32,
    sphere_z: f32,
    // Координати у формі Гуманоїдного Бюста Манаса (Manas)
    manas_x: f32,
    manas_y: f32,
    manas_z: f32,
    // Поточні інтерпольовані координати
    cur_x: f32,
    cur_y: f32,
    cur_z: f32,
    phase: f32,
    speed: f32,
    role: u8, // 0 = оболонка/торс, 1 = золоте ядро Манаса/обличчя, 2 = хвильовий горизонт знизу
}

// ============================================================================
// 2. ГОЛОВНИЙ КЛАС RAPHAEL CORE ENGINE (RUST WASM)
// ============================================================================

#[wasm_bindgen]
pub struct RaphaelWasmEngine {
    evolution: RaphaelEvolutionStage,
    activity: RaphaelActivityMode,
    awakening_phase: u8, // 0 = не активна, 1 = Neo-Babylonian, 2 = English, 3 = Ukrainian

    particles: Vec<Particle3D>,
    render_buffer: Vec<f32>, // Плоский буфер [x, y, radius, r, g, b, alpha, ...] для 60-120 FPS Canvas

    morph_progress: f32, // 0.0 = Сфера, 1.0 = Гуманоїдний Бюст Манаса
    target_morph: f32,
    sim_time: f32,
    voice_energy: f32,
    glitch_intensity: f32,

    // DSP-лінія затримки для голографічного стерео-даблера у стилі "Apex"
    dsp_delay_buf: Vec<f32>,
    dsp_write_idx: usize,
    dsp_lfo_phase: f32,

    // Апаратний детектор голосової активності (VAD) — проти зависань мікрофона
    vad_noise_floor: f32,
    vad_is_speaking: bool,
    vad_speech_ms: f32,
    vad_silence_ms: f32,
}

#[wasm_bindgen]
impl RaphaelWasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(particle_count: usize) -> RaphaelWasmEngine {
        let count = particle_count.clamp(400, 4000);
        let mut engine = RaphaelWasmEngine {
            evolution: RaphaelEvolutionStage::Dormant,
            activity: RaphaelActivityMode::Idle,
            awakening_phase: 0,
            particles: Vec::with_capacity(count),
            render_buffer: Vec::with_capacity(count * 7),
            morph_progress: 0.0,
            target_morph: 0.0,
            sim_time: 0.0,
            voice_energy: 0.0,
            glitch_intensity: 0.0,
            dsp_delay_buf: vec![0.0; 2400], // ~50 мс буфер для 48kHz
            dsp_write_idx: 0,
            dsp_lfo_phase: 0.0,
            vad_noise_floor: 0.008,
            vad_is_speaking: false,
            vad_speech_ms: 0.0,
            vad_silence_ms: 0.0,
        };

        engine.generate_geometry(count);
        engine
    }

    // ------------------------------------------------------------------------
    // 1. ПРОЦЕДУРНА ГЕНЕРАЦІЯ ГЕОМЕТРІЇ (СФЕРА <-> БЮСТ МАНАСА З РЕФЕРЕНСУ)
    // ------------------------------------------------------------------------
    fn generate_geometry(&mut self, count: usize) {
        self.particles.clear();
        let mut rng_state: u64 = 0x517cc1b727220a95;

        let mut next_f32 = || -> f32 {
            rng_state ^= rng_state << 13;
            rng_state ^= rng_state >> 7;
            rng_state ^= rng_state << 17;
            ((rng_state & 0x00FF_FFFF) as f32) / 16777216.0
        };

        for i in 0..count {
            let u = next_f32();
            let v = next_f32();
            let theta = u * TAU;
            let phi = (2.0 * v - 1.0).acos();

            // А. Координати Квантової Сфери (стан Active)
            let radius_sphere = if i % 7 == 0 {
                0.45 + next_f32() * 0.15 // Внутрішнє ядро сфери
            } else {
                0.92 + next_f32() * 0.12 // Зовнішня оболонка
            };

            let sx = radius_sphere * phi.sin() * theta.cos();
            let sy = radius_sphere * phi.cos();
            let sz = radius_sphere * phi.sin() * theta.sin();

            // Б. Координати Гуманоїдного Бюста Манаса (стан Manas, як у відео Apex)
            let (mx, my, mz, role) = if i < (count * 22 / 100) {
                // 1. Голова та обличчя Манаса (верхній еліпсоїд + золота лицьова маска)
                let h_theta = (next_f32() - 0.5) * PI * 1.35;
                let h_phi = (next_f32() - 0.5) * PI * 0.95;
                let rx = 0.34 * h_phi.cos() * h_theta.sin();
                let ry = -0.62 + 0.42 * h_phi.sin();
                let rz = 0.36 * h_phi.cos() * h_theta.cos();
                // Передня частина обличчя світиться золотим ядром (role = 1)
                let is_face_glow = rz > 0.12 && ry > -0.78 && ry < -0.35 && rx.abs() < 0.22;
                (rx, ry, rz, if is_face_glow { 1 } else { 0 })
            } else if i < (count * 34 / 100) {
                // 2. Тепле золоте ядро у центрі грудей Манаса та шийний хребет
                let core_r = 0.22 * next_f32().cbrt();
                let rx = core_r * phi.sin() * theta.cos();
                let ry = 0.05 + core_r * phi.cos() * 1.2;
                let rz = 0.15 + core_r * phi.sin() * theta.sin();
                (rx, ry, rz, 1)
            } else if i < (count * 76 / 100) {
                // 3. Шия, плечі та верхній торс (біомеханічні волокна)
                let t = next_f32(); // 0 = шия, 1 = низ грудей
                let y_pos = -0.22 + t * 0.95;
                let shoulder_width = if y_pos < -0.05 {
                    0.22 // Шия
                } else {
                    0.88 * ((y_pos + 0.05) / 0.85).powf(0.45) // Розширення плечей
                };
                let x_spread = (next_f32() * 2.0 - 1.0) * shoulder_width;
                let chest_depth = 0.32 * (1.0 - (x_spread / (shoulder_width + 0.01)).powi(2)).max(0.1);
                let z_pos = (next_f32() * 2.0 - 1.0) * chest_depth;
                (x_spread, y_pos, z_pos, 0)
            } else {
                // 4. Хвильовий горизонт (спектральна площина біля основи бюста)
                let gx = (next_f32() * 2.0 - 1.0) * 1.45;
                let gz = (next_f32() * 2.0 - 1.0) * 0.95;
                let gy = 0.78 + (gx * 3.0).sin() * 0.05;
                (gx, gy, gz, 2)
            };

            self.particles.push(Particle3D {
                sphere_x: sx,
                sphere_y: sy,
                sphere_z: sz,
                manas_x: mx,
                manas_y: my,
                manas_z: mz,
                cur_x: sx,
                cur_y: sy,
                cur_z: sz,
                phase: next_f32() * TAU,
                speed: 0.4 + next_f32() * 1.2,
                role,
            });
        }
    }

    // ------------------------------------------------------------------------
    // 2. СИНХРОНІЗАЦІЯ СТАНІВ З IRMINSUL CORE ТА КЕРУВАННЯ ЕВОЛЮЦІЄЮ
    // ------------------------------------------------------------------------

    /// Приймає рядок стану з `irminsul.getFullState().raphael_state` ("Dormant" | "Active" | "Manas")
    pub fn sync_with_irminsul_state(&mut self, state_name: &str) {
        match state_name.trim().to_lowercase().as_str() {
            "dormant" => self.set_evolution_stage(RaphaelEvolutionStage::Dormant),
            "manas" => self.set_evolution_stage(RaphaelEvolutionStage::Manas),
            _ => self.set_evolution_stage(RaphaelEvolutionStage::Active),
        }
    }

    pub fn set_evolution_stage(&mut self, stage: RaphaelEvolutionStage) {
        self.evolution = stage;
        self.target_morph = match stage {
            RaphaelEvolutionStage::Dormant => 0.0,
            RaphaelEvolutionStage::Active => 0.0,
            RaphaelEvolutionStage::Manas => 1.0,
        };
    }

    pub fn get_evolution_stage(&self) -> RaphaelEvolutionStage {
        self.evolution
    }

    pub fn set_activity_mode(&mut self, mode: RaphaelActivityMode) {
        self.activity = mode;
        if mode == RaphaelActivityMode::QuarantineAlert {
            self.glitch_intensity = 1.0;
        }
    }

    pub fn set_awakening_phase(&mut self, phase: u8) {
        self.awakening_phase = phase.clamp(0, 3);
        if self.awakening_phase > 0 {
            self.activity = RaphaelActivityMode::Awakening;
            self.glitch_intensity = 0.45;
        } else if self.activity == RaphaelActivityMode::Awakening {
            self.activity = RaphaelActivityMode::Idle;
        }
    }

    pub fn set_voice_energy(&mut self, rms_energy: f32) {
        let clamped = rms_energy.clamp(0.0, 1.5);
        // Плавна інтерполяція огинаючої голосу для органічного світіння частинок
        self.voice_energy = self.voice_energy * 0.65 + clamped * 0.35;
    }

    pub fn trigger_glitch(&mut self, strength: f32) {
        self.glitch_intensity = strength.clamp(0.0, 1.0);
    }

    // ------------------------------------------------------------------------
    // 3. МАТЕМАТИКА КАДРУ (60-120 FPS МОРФІНГ СФЕРА <-> МАНАС У WASM)
    // ------------------------------------------------------------------------

    /// Оновлює 3D-координати і повертає плоский масив для миттєвого малювання на Canvas:
    /// кожні 7 чисел = [x2d, y2d, size, r, g, b, alpha]
    pub fn step_and_project(
        &mut self,
        dt_sec: f32,
        canvas_w: f32,
        canvas_h: f32,
        pointer_x: f32, // від -1.0 до 1.0
        pointer_y: f32, // від -1.0 до 1.0
    ) -> Vec<f32> {
        let dt = dt_sec.clamp(0.001, 0.05);
        self.sim_time += dt;

        // Плавний морфінг між Квантовою Сферою (0.0) та Бюстом Манаса (1.0)
        let morph_diff = self.target_morph - self.morph_progress;
        if morph_diff.abs() > 0.0005 {
            self.morph_progress += morph_diff * (dt * 2.2).min(1.0);
        } else {
            self.morph_progress = self.target_morph;
        }

        if self.glitch_intensity > 0.001 {
            self.glitch_intensity = (self.glitch_intensity - dt * 1.8).max(0.0);
        }

        let m = self.morph_progress;
        let cx = canvas_w * 0.5;
        let cy = canvas_h * 0.5;
        let base_scale = canvas_w.min(canvas_h) * 0.36;

        // Кут обертання: Сфера обертається на 360°, а Бюст Манаса дивиться на гравців і легко повертається за курсором
        let sphere_rot_y = self.sim_time * match self.activity {
            RaphaelActivityMode::Thinking => 1.65,
            RaphaelActivityMode::Speaking => 0.75,
            _ => 0.38,
        };
        let manas_rot_y = pointer_x.clamp(-0.6, 0.6) * 0.35 + (self.sim_time * 0.8).sin() * 0.08;
        let rot_y = sphere_rot_y * (1.0 - m) + manas_rot_y * m;
        let rot_x = pointer_y.clamp(-0.5, 0.5) * 0.22 * m;

        let (sin_y, cos_y) = rot_y.sin_cos();
        let (sin_x, cos_x) = rot_x.sin_cos();

        self.render_buffer.clear();

        for p in &mut self.particles {
            p.phase += dt * p.speed;

            // 1. Координати Сфери з органічним диханням
            let pulse = 1.0 + (self.sim_time * 2.2 + p.phase).sin() * 0.04 + self.voice_energy * 0.18;
            let sx = p.sphere_x * pulse;
            let sy = p.sphere_y * pulse;
            let sz = p.sphere_z * pulse;

            // 2. Координати Манаса з реакцією ядра та хвильового горизонту на голос
            let mut mx = p.manas_x;
            let mut my = p.manas_y;
            let mut mz = p.manas_z;

            if p.role == 1 {
                // Золоте ядро в грудях та обличчі Манаса пульсує в такт голосу!
                let vocal_boost = 1.0 + self.voice_energy * 0.32;
                mx *= vocal_boost;
                mz *= vocal_boost;
            } else if p.role == 2 {
                // Хвильова сітка внизу під бюстом (як у референсі Apex)
                let wave = (mx * 5.0 + self.sim_time * 3.5).sin() * (0.04 + self.voice_energy * 0.14);
                my += wave;
            }

            // Інтерполяція Сфера <-> Манас
            let raw_x = sx * (1.0 - m) + mx * m;
            let raw_y = sy * (1.0 - m) + my * m;
            let raw_z = sz * (1.0 - m) + mz * m;

            // 3D-поворот
            let rx1 = raw_x * cos_y - raw_z * sin_y;
            let rz1 = raw_x * sin_y + raw_z * cos_y;
            let ry2 = raw_y * cos_x - rz1 * sin_x;
            let rz2 = raw_y * sin_x + rz1 * cos_x;

            p.cur_x = rx1;
            p.cur_y = ry2;
            p.cur_z = rz2;

            // Перспективна проєкція
            let depth = 2.6 + rz2;
            if depth <= 0.1 {
                continue;
            }
            let persp = 2.2 / depth;

            let mut x2d = cx + rx1 * base_scale * persp;
            let mut y2d = cy + ry2 * base_scale * persp;

            if self.glitch_intensity > 0.01 {
                let jitter = (p.phase * 37.0).sin() * self.glitch_intensity * 14.0;
                x2d += jitter;
            }

            // Визначення кольору RGB залежно від стану еволюції та ролі частинки
            let (r, g, b) = match self.evolution {
                RaphaelEvolutionStage::Dormant => (100.0, 116.0, 139.0), // Тьмяний сіро-синій
                RaphaelEvolutionStage::Active => match self.activity {
                    RaphaelActivityMode::QuarantineAlert => (239.0, 68.0, 68.0), // Червоний карантин Сіель
                    RaphaelActivityMode::Thinking => (16.0, 185.0, 129.0),       // Смарагдовий аналіз
                    RaphaelActivityMode::Awakening => match self.awakening_phase {
                        1 => (168.0, 85.0, 247.0), // Фаза 1: Neo-Babylonian (фіолетовий)
                        2 => (59.0, 130.0, 246.0), // Фаза 2: English (синій)
                        _ => (34.0, 211.0, 238.0), // Фаза 3: Ukrainian (ціан)
                    },
                    _ => (34.0, 211.0, 238.0), // Холодний аналітичний ціан
                },
                RaphaelEvolutionStage::Manas => {
                    if p.role == 1 {
                        // Тепле золоте/бурштинове ядро Манаса та підсвітка обличчя
                        (251.0, 191.0, 36.0)
                    } else if p.role == 2 {
                        // Хвильовий горизонт
                        (56.0, 189.0, 248.0)
                    } else {
                        // Нейромережеві волокна силуету
                        (34.0, 211.0, 238.0)
                    }
                }
            };

            let size = (1.3 + (p.role == 1) as u8 as f32 * 0.9) * persp * (1.0 + self.voice_energy * 0.25);
            let alpha = ((1.3 - rz2 * 0.45) * if self.evolution == RaphaelEvolutionStage::Dormant { 0.35 } else { 0.88 }).clamp(0.12, 0.98);

            self.render_buffer.extend_from_slice(&[x2d, y2d, size, r, g, b, alpha]);
        }

        self.render_buffer.clone()
    }

    // ------------------------------------------------------------------------
    // 4. АУДІО-DSP У СТИЛІ «APEX» (ГОЛОГРАФІЧНИЙ ДАБЛЕР БЕЗ РАДІО-ХРИПІВ)
    // ------------------------------------------------------------------------

    /// Обробляє моно-буфер голосу (MP3 з маніфесту або ElevenLabs):
    /// додає чистий фазовий мікро-даблер (ефект присутності ШІ Apex) і повертає RMS-енергію.
    pub fn process_voice_dsp(&mut self, samples: &mut [f32], sample_rate: f32) -> f32 {
        if samples.is_empty() {
            self.set_voice_energy(0.0);
            return 0.0;
        }

        let sr = sample_rate.max(8000.0);
        let buf_len = self.dsp_delay_buf.len();
        let base_delay_samples = (sr * 0.014) as usize; // 14 мс — класичний Haas/Chorus зсув для голосу ШІ
        let lfo_inc = TAU * 0.85 / sr; // Повільна модуляція 0.85 Гц

        let mut sum_sq = 0.0;

        for s in samples.iter_mut() {
            let clean_in = *s;
            sum_sq += clean_in * clean_in;

            self.dsp_lfo_phase = (self.dsp_lfo_phase + lfo_inc) % TAU;
            let mod_offset = (self.dsp_lfo_phase.sin() * (sr * 0.0018)) as isize;
            let delay_len = (base_delay_samples as isize + mod_offset).clamp(16, (buf_len - 2) as isize) as usize;

            let read_idx = (self.dsp_write_idx + buf_len - delay_len) % buf_len;
            let delayed_voice = self.dsp_delay_buf[read_idx];

            // Записуємо в лінію затримки з легким зворотним зв'язком 12%
            self.dsp_delay_buf[self.dsp_write_idx] = clean_in + delayed_voice * 0.12;
            self.dsp_write_idx = (self.dsp_write_idx + 1) % buf_len;

            // Змішуємо 82% кришталево чистого основного голосу + 24% об'ємного дубля
            let mixed = clean_in * 0.84 + delayed_voice * 0.24;
            // М'який сатуратор-лімітер, щоб ніколи не було кліпінгу
            *s = mixed.clamp(-0.98, 0.98);
        }

        let rms = (sum_sq / (samples.len() as f32)).sqrt();
        self.set_voice_energy((rms * 4.2).min(1.2));
        rms
    }

    // ------------------------------------------------------------------------
    // 5. МИТТЄВИЙ RUST VAD (ЩОБ МІКРОФОН НІКОЛИ НЕ ВИСІВ ПО 2 ХВИЛИНИ)
    // ------------------------------------------------------------------------

    pub fn reset_vad(&mut self) {
        self.vad_is_speaking = false;
        self.vad_speech_ms = 0.0;
        self.vad_silence_ms = 0.0;
    }

    /// Аналізує фрейм мікрофона і повертає:
    /// 0 = тиша, 1 = гравець говорить, 2 = фраза завершена (миттєво відправляй запит!)
    pub fn process_mic_vad_frame(&mut self, pcm_frame: &[f32], frame_duration_ms: f32) -> VadDecision {
        if pcm_frame.is_empty() {
            return VadDecision::Silence;
        }

        let mut sum_sq = 0.0;
        for &s in pcm_frame {
            sum_sq += s * s;
        }
        let rms = (sum_sq / (pcm_frame.len() as f32)).sqrt();
        self.set_voice_energy((rms * 5.0).min(1.0));

        let threshold = (self.vad_noise_floor * 2.8).max(0.015);

        if rms > threshold {
            self.vad_is_speaking = true;
            self.vad_speech_ms += frame_duration_ms;
            self.vad_silence_ms = 0.0;
            VadDecision::Speaking
        } else {
            if !self.vad_is_speaking {
                // Плавно адаптуємо поріг фонового шуму кімнати
                self.vad_noise_floor = self.vad_noise_floor * 0.95 + rms * 0.05;
                return VadDecision::Silence;
            }

            self.vad_silence_ms += frame_duration_ms;

            // Якщо гравець говорив хоча б 250 мс і зробив паузу 880 мс — миттєво закриваємо запис!
            if self.vad_speech_ms >= 250.0 && self.vad_silence_ms >= 880.0 {
                self.reset_vad();
                return VadDecision::SpeechEndedTriggerSend;
            }

            VadDecision::Speaking
        }
    }
}