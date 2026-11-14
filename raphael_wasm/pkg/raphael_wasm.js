/* @ts-self-types="./raphael_wasm.d.ts" */

/**
 * @enum {0 | 1 | 2 | 3 | 4 | 5}
 */
export const RaphaelActivityMode = Object.freeze({
    Idle: 0, "0": "Idle",
    Awakening: 1, "1": "Awakening",
    Listening: 2, "2": "Listening",
    Thinking: 3, "3": "Thinking",
    Speaking: 4, "4": "Speaking",
    QuarantineAlert: 5, "5": "QuarantineAlert",
});

/**
 * @enum {0 | 1 | 2}
 */
export const RaphaelEvolutionStage = Object.freeze({
    Dormant: 0, "0": "Dormant",
    Active: 1, "1": "Active",
    Manas: 2, "2": "Manas",
});

export class RaphaelWasmEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RaphaelWasmEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_raphaelwasmengine_free(ptr, 0);
    }
    /**
     * @returns {RaphaelEvolutionStage}
     */
    get_evolution_stage() {
        const ret = wasm.raphaelwasmengine_get_evolution_stage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} particle_count
     */
    constructor(particle_count) {
        const ret = wasm.raphaelwasmengine_new(particle_count);
        this.__wbg_ptr = ret;
        RaphaelWasmEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Аналізує фрейм мікрофона і повертає:
     * 0 = тиша, 1 = гравець говорить, 2 = фраза завершена (миттєво відправляй запит!)
     * @param {Float32Array | number[]} pcm_frame
     * @param {number} frame_duration_ms
     * @returns {VadDecision}
     */
    process_mic_vad_frame(pcm_frame, frame_duration_ms) {
        const val2 = +frame_duration_ms;
        const ptr0 = passArrayF32ToWasm0(pcm_frame, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.raphaelwasmengine_process_mic_vad_frame(this.__wbg_ptr, ptr0, len0, val2);
        return ret;
    }
    /**
     * Обробляє моно-буфер голосу (MP3 з маніфесту або ElevenLabs):
     * додає чистий фазовий мікро-даблер (ефект присутності ШІ Apex) і повертає RMS-енергію.
     * @param {Float32Array} samples
     * @param {number} sample_rate
     * @returns {number}
     */
    process_voice_dsp(samples, sample_rate) {
        const val2 = +sample_rate;
        var ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.raphaelwasmengine_process_voice_dsp(this.__wbg_ptr, ptr0, len0, samples, val2);
        return ret;
    }
    reset_vad() {
        wasm.raphaelwasmengine_reset_vad(this.__wbg_ptr);
    }
    /**
     * @param {RaphaelActivityMode} mode
     */
    set_activity_mode(mode) {
        wasm.raphaelwasmengine_set_activity_mode(this.__wbg_ptr, mode);
    }
    /**
     * @param {number} phase
     */
    set_awakening_phase(phase) {
        wasm.raphaelwasmengine_set_awakening_phase(this.__wbg_ptr, phase);
    }
    /**
     * @param {RaphaelEvolutionStage} stage
     */
    set_evolution_stage(stage) {
        wasm.raphaelwasmengine_set_evolution_stage(this.__wbg_ptr, stage);
    }
    /**
     * @param {number} rms_energy
     */
    set_voice_energy(rms_energy) {
        wasm.raphaelwasmengine_set_voice_energy(this.__wbg_ptr, rms_energy);
    }
    /**
     * Оновлює 3D-координати і повертає плоский масив для миттєвого малювання на Canvas:
     * кожні 7 чисел = [x2d, y2d, size, r, g, b, alpha]
     * @param {number} dt_sec
     * @param {number} canvas_w
     * @param {number} canvas_h
     * @param {number} pointer_x
     * @param {number} pointer_y
     * @returns {Float32Array}
     */
    step_and_project(dt_sec, canvas_w, canvas_h, pointer_x, pointer_y) {
        const ret = wasm.raphaelwasmengine_step_and_project(this.__wbg_ptr, dt_sec, canvas_w, canvas_h, pointer_x, pointer_y);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Приймає рядок стану з `irminsul.getFullState().raphael_state` ("Dormant" | "Active" | "Manas")
     * @param {string} state_name
     */
    sync_with_irminsul_state(state_name) {
        const ptr0 = passStringToWasm0(state_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.raphaelwasmengine_sync_with_irminsul_state(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} strength
     */
    trigger_glitch(strength) {
        wasm.raphaelwasmengine_trigger_glitch(this.__wbg_ptr, strength);
    }
}
if (Symbol.dispose) RaphaelWasmEngine.prototype[Symbol.dispose] = RaphaelWasmEngine.prototype.free;

/**
 * @enum {0 | 1 | 2}
 */
export const VadDecision = Object.freeze({
    Silence: 0, "0": "Silence",
    Speaking: 1, "1": "Speaking",
    SpeechEndedTriggerSend: 2, "2": "SpeechEndedTriggerSend",
});
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_copy_to_typed_array_680b191e71920dc1: function(arg0, arg1, arg2) {
            new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./raphael_wasm_bg.js": import0,
    };
}

const RaphaelWasmEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_raphaelwasmengine_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('raphael_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
