/* tslint:disable */
/* eslint-disable */

export enum RaphaelActivityMode {
    Idle = 0,
    Awakening = 1,
    Listening = 2,
    Thinking = 3,
    Speaking = 4,
    QuarantineAlert = 5,
}

export enum RaphaelEvolutionStage {
    Dormant = 0,
    Active = 1,
    Manas = 2,
}

export class RaphaelWasmEngine {
    free(): void;
    [Symbol.dispose](): void;
    get_evolution_stage(): RaphaelEvolutionStage;
    constructor(particle_count: number);
    /**
     * Аналізує фрейм мікрофона і повертає:
     * 0 = тиша, 1 = гравець говорить, 2 = фраза завершена (миттєво відправляй запит!)
     */
    process_mic_vad_frame(pcm_frame: Float32Array | number[], frame_duration_ms: number): VadDecision;
    /**
     * Обробляє моно-буфер голосу (MP3 з маніфесту або ElevenLabs):
     * додає чистий фазовий мікро-даблер (ефект присутності ШІ Apex) і повертає RMS-енергію.
     */
    process_voice_dsp(samples: Float32Array, sample_rate: number): number;
    reset_vad(): void;
    set_activity_mode(mode: RaphaelActivityMode): void;
    set_awakening_phase(phase: number): void;
    set_evolution_stage(stage: RaphaelEvolutionStage): void;
    set_voice_energy(rms_energy: number): void;
    /**
     * Оновлює 3D-координати і повертає плоский масив для миттєвого малювання на Canvas:
     * кожні 7 чисел = [x2d, y2d, size, r, g, b, alpha]
     */
    step_and_project(dt_sec: number, canvas_w: number, canvas_h: number, pointer_x: number, pointer_y: number): Float32Array;
    /**
     * Приймає рядок стану з `irminsul.getFullState().raphael_state` ("Dormant" | "Active" | "Manas")
     */
    sync_with_irminsul_state(state_name: string): void;
    trigger_glitch(strength: number): void;
}

export enum VadDecision {
    Silence = 0,
    Speaking = 1,
    SpeechEndedTriggerSend = 2,
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_raphaelwasmengine_free: (a: number, b: number) => void;
    readonly raphaelwasmengine_get_evolution_stage: (a: number) => number;
    readonly raphaelwasmengine_new: (a: number) => number;
    readonly raphaelwasmengine_process_mic_vad_frame: (a: number, b: number, c: number, d: number) => number;
    readonly raphaelwasmengine_process_voice_dsp: (a: number, b: number, c: number, d: any, e: number) => number;
    readonly raphaelwasmengine_reset_vad: (a: number) => void;
    readonly raphaelwasmengine_set_activity_mode: (a: number, b: number) => void;
    readonly raphaelwasmengine_set_awakening_phase: (a: number, b: number) => void;
    readonly raphaelwasmengine_set_evolution_stage: (a: number, b: number) => void;
    readonly raphaelwasmengine_set_voice_energy: (a: number, b: number) => void;
    readonly raphaelwasmengine_step_and_project: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly raphaelwasmengine_sync_with_irminsul_state: (a: number, b: number, c: number) => void;
    readonly raphaelwasmengine_trigger_glitch: (a: number, b: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
