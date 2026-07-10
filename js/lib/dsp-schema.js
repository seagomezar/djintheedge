/**
 * DSP JSON contract schema and validator for BrowserDJ AI.
 *
 * This module is the single source of truth for "is this a valid DSP contract".
 * It is shared by the LLM inference path (to gate model output), the repair
 * step, and the test suite. The rule-based parser's output must also pass it.
 *
 * The contract (track-array model) is documented in spec.md Section A.1:
 *
 *   {
 *     meta:   { bpm, scale, loop_steps, energy },
 *     tracks: [ { id, type:"drum",  role, muted, pattern, sample_name }
 *             | { id, type:"synth", muted, wave_type, filter_cutoff_hz,
 *                 filter_resonance, adsr, notes } ],
 *     effects: { delay_feedback, reverb_mix },
 *     transition: null | { active, current_step, total_steps, ... }
 *   }
 */

/** Supported loop-length bounds (mirrors parser.js DEFAULT/MAX_LOOP_STEPS). */
export const MIN_LOOP_STEPS = 4;
export const MAX_LOOP_STEPS = 64;

/** Allowed enumerations. */
const TRACK_TYPES = ["drum", "synth"];
const DRUM_ROLES = ["kick", "hihat"];
const WAVE_TYPES = ["saw", "cycle", "square"];

/** True if `v` is a finite number. */
function isNum(v) {
    return typeof v === "number" && isFinite(v);
}

/** True if `v` is an array of finite numbers. */
function isNumArray(v) {
    return Array.isArray(v) && v.every(isNum);
}

/**
 * Validates a DSP config against the track-array contract.
 * Never throws; always returns a result object.
 *
 * @param {*} obj candidate config
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDSP(obj) {
    const errors = [];
    const fail = (msg) => errors.push(msg);

    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
        return { valid: false, errors: ["root: expected a plain object"] };
    }

    // --- meta ---------------------------------------------------------------
    const meta = obj.meta;
    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
        fail("meta: expected an object");
    } else {
        if (!isNum(meta.bpm)) fail("meta.bpm: expected a number");
        if (typeof meta.scale !== "string") fail("meta.scale: expected a string");
        if (!isNum(meta.loop_steps)) {
            fail("meta.loop_steps: expected a number");
        } else if (meta.loop_steps < MIN_LOOP_STEPS || meta.loop_steps > MAX_LOOP_STEPS) {
            fail(`meta.loop_steps: expected ${MIN_LOOP_STEPS}-${MAX_LOOP_STEPS}, got ${meta.loop_steps}`);
        }
        if ("energy" in meta && !isNum(meta.energy)) fail("meta.energy: expected a number when present");
    }

    const loopSteps = meta && isNum(meta.loop_steps) ? meta.loop_steps : null;

    // --- tracks -------------------------------------------------------------
    if (!Array.isArray(obj.tracks)) {
        fail("tracks: expected an array");
    } else if (obj.tracks.length === 0) {
        fail("tracks: expected at least one track");
    } else {
        const seenIds = new Set();
        obj.tracks.forEach((t, i) => {
            const at = `tracks[${i}]`;
            if (t === null || typeof t !== "object" || Array.isArray(t)) {
                fail(`${at}: expected an object`);
                return;
            }
            if (typeof t.id !== "string" || t.id.length === 0) {
                fail(`${at}.id: expected a non-empty string`);
            } else if (seenIds.has(t.id)) {
                fail(`${at}.id: duplicate id "${t.id}"`);
            } else {
                seenIds.add(t.id);
            }
            if (typeof t.muted !== "boolean") fail(`${at}.muted: expected a boolean`);
            if (!TRACK_TYPES.includes(t.type)) {
                fail(`${at}.type: expected one of ${TRACK_TYPES.join("|")}, got ${JSON.stringify(t.type)}`);
                return;
            }

            if (t.type === "drum") {
                if (!DRUM_ROLES.includes(t.role)) {
                    fail(`${at}.role: expected one of ${DRUM_ROLES.join("|")}, got ${JSON.stringify(t.role)}`);
                }
                if (!isNumArray(t.pattern)) {
                    fail(`${at}.pattern: expected an array of numbers`);
                } else {
                    if (!t.pattern.every(v => v === 0 || v === 1)) {
                        fail(`${at}.pattern: expected only 0/1 values`);
                    }
                    if (loopSteps !== null && t.pattern.length !== loopSteps) {
                        fail(`${at}.pattern: length ${t.pattern.length} != meta.loop_steps ${loopSteps}`);
                    }
                }
                if (!(t.sample_name === null || typeof t.sample_name === "string")) {
                    fail(`${at}.sample_name: expected string or null`);
                }
            } else { // synth
                if (!WAVE_TYPES.includes(t.wave_type)) {
                    fail(`${at}.wave_type: expected one of ${WAVE_TYPES.join("|")}, got ${JSON.stringify(t.wave_type)}`);
                }
                if (!isNum(t.filter_cutoff_hz)) fail(`${at}.filter_cutoff_hz: expected a number`);
                if (!isNum(t.filter_resonance)) fail(`${at}.filter_resonance: expected a number`);
                if (!isNumArray(t.adsr) || t.adsr.length !== 4) {
                    fail(`${at}.adsr: expected an array of 4 numbers`);
                }
                if (!isNumArray(t.notes)) {
                    fail(`${at}.notes: expected an array of numbers`);
                } else if (loopSteps !== null && t.notes.length !== loopSteps) {
                    fail(`${at}.notes: length ${t.notes.length} != meta.loop_steps ${loopSteps}`);
                }
            }
        });
    }

    // --- effects ------------------------------------------------------------
    const fx = obj.effects;
    if (fx === null || typeof fx !== "object" || Array.isArray(fx)) {
        fail("effects: expected an object");
    } else {
        if (!isNum(fx.delay_feedback)) fail("effects.delay_feedback: expected a number");
        if (!isNum(fx.reverb_mix)) fail("effects.reverb_mix: expected a number");
    }

    // --- transition (nullable) ---------------------------------------------
    const tr = obj.transition;
    if (!(tr === null || tr === undefined)) {
        if (typeof tr !== "object" || Array.isArray(tr)) {
            fail("transition: expected an object or null");
        } else {
            if (typeof tr.active !== "boolean") fail("transition.active: expected a boolean");
            if (!isNum(tr.total_steps)) fail("transition.total_steps: expected a number");
            if ("current_step" in tr && !isNum(tr.current_step)) fail("transition.current_step: expected a number when present");
            if (typeof tr.target_scale !== "string") fail("transition.target_scale: expected a string");
            if (!isNum(tr.target_cutoff)) fail("transition.target_cutoff: expected a number");
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Convenience boolean form of {@link validateDSP}.
 * @param {*} obj candidate config
 * @returns {boolean}
 */
export function isValidDSP(obj) {
    return validateDSP(obj).valid;
}
