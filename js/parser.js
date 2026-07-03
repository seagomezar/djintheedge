/**
 * Track-array NLP parser for BrowserDJ AI.
 *
 * Translates bilingual (English/Spanish) natural-language prompts into the
 * multitrack DSP contract:
 *
 *   {
 *     meta:  { bpm, scale, loop_steps, energy },
 *     tracks: [ { id, type:"drum", role, muted, pattern, sample_name }
 *             | { id, type:"synth", muted, wave_type, filter_cutoff_hz,
 *                 filter_resonance, adsr, notes } ],
 *     effects: { delay_feedback, reverb_mix },
 *     transition: null | { ... }
 *   }
 *
 * The parser is incremental by default: it starts from a deep copy of the
 * current state and mutates only the track(s) a prompt targets. Full-replace
 * phrases ("start over", "reset", "new techno track") rebuild a fresh template.
 * Unrecognized input returns the current state unchanged (never throws).
 */

/** Default loop length in steps (2 bars of sixteenths). */
export const DEFAULT_LOOP_STEPS = 32;
/** Hard ceiling on loop length. */
export const MAX_LOOP_STEPS = 64;
/** Soft cap on simultaneous tracks to keep the grid readable and audio stable. */
export const MAX_TRACKS = 8;

/**
 * Builds a fresh default loop template (kick + hats + lead) at the given length.
 * @param {number} loopSteps
 * @returns {object} a valid track-array DSP config
 */
export function defaultTemplate(loopSteps = DEFAULT_LOOP_STEPS) {
    const steps = clampLoopSteps(loopSteps);
    return {
        meta: { bpm: 120, scale: "Am", loop_steps: steps, energy: 0.6 },
        tracks: [
            {
                id: "kick", type: "drum", role: "kick", muted: false,
                pattern: fitPattern([1, 0, 0, 0], steps), sample_name: null
            },
            {
                id: "hats", type: "drum", role: "hihat", muted: false,
                pattern: fitPattern([0, 0, 1, 0], steps), sample_name: null
            },
            {
                id: "lead", type: "synth", muted: false,
                wave_type: "saw", filter_cutoff_hz: 1500, filter_resonance: 2.0,
                adsr: [0.01, 0.15, 0.7, 0.2],
                notes: fitNotes([57, 60, 64, 67, 64, 60, 57, 0], steps)
            }
        ],
        effects: { delay_feedback: 0.3, reverb_mix: 0.15 },
        transition: null
    };
}

/** Clamp a loop length into the supported 4-64 range, rounded to an integer. */
export function clampLoopSteps(n) {
    if (typeof n !== "number" || !isFinite(n)) return DEFAULT_LOOP_STEPS;
    return Math.max(4, Math.min(MAX_LOOP_STEPS, Math.round(n)));
}

/** Repeat/trim a 0/1 pattern to exactly `steps` length. */
function fitPattern(base, steps) {
    const out = [];
    for (let i = 0; i < steps; i++) out.push(base[i % base.length]);
    return out;
}

/** Repeat/trim a MIDI-note sequence to exactly `steps` length. */
function fitNotes(base, steps) {
    const out = [];
    for (let i = 0; i < steps; i++) out.push(base[i % base.length]);
    return out;
}

const SCALE_ROOTS = { 'C': 60, 'D': 62, 'E': 64, 'F': 65, 'G': 67, 'A': 57, 'B': 59 };

/**
 * Generates an arpeggiating lead sequence transposed to the root/mode,
 * fitted to `steps` length.
 */
export function generateScaleMelody(rootName, isMinor, steps = DEFAULT_LOOP_STEPS) {
    const rootMidi = SCALE_ROOTS[rootName] || 60;
    const intervals = isMinor ? [0, 2, 3, 5, 7, 8, 10, 12] : [0, 2, 4, 5, 7, 9, 11, 12];
    const contour = [0, 2, 4, 7, 4, 2, 0, 7, 0, 2, 4, 7, 4, 2, -1, -2];
    const melody = contour.map(idx => {
        if (idx === -1) return rootMidi - 12;
        if (idx === -2) return rootMidi - 5;
        return rootMidi + intervals[idx % intervals.length];
    });
    return fitNotes(melody, steps);
}

/** Find a track by id; returns undefined if absent. */
function findTrack(tracks, id) {
    return tracks.find(t => t.id === id);
}

/** Find the first synth track (the "lead" the user usually means). */
function findLead(tracks) {
    return findTrack(tracks, "lead") || tracks.find(t => t.type === "synth");
}

/** Genre note-contour presets, keyed by loop-independent 8-step motifs. */
const GENRE_MELODIES = {
    synthwave: [57, 57, 60, 57, 64, 57, 67, 57],
    house: [57, 60, 0, 57, 60, 62, 57, 0],
    ambient: [60, 64, 67, 72, 67, 64, 60, 0],
    techno: [57, 57, 57, 60, 62, 60, 57, 0]
};

/**
 * Parses a natural-language prompt into the track-array DSP contract.
 * @param {string} prompt
 * @param {object|null} currentState prior loop state to accumulate onto
 * @returns {object} a valid track-array DSP config
 */
export function parsePromptToDSP(prompt, currentState = null) {
    const text = (prompt || "").toLowerCase();

    // --- Full-replace detection ---------------------------------------------
    const isFullReplace =
        /\b(start over|reset|empez[ao]r de nuevo|reinicia|nuevo (track|beat|loop|tema)|new (track|beat|loop|song))\b/.test(text);

    // Base state: deep copy of current, or a fresh template.
    let config = (currentState && !isFullReplace)
        ? JSON.parse(JSON.stringify(currentState))
        : defaultTemplate();

    // Migrate/repair: guarantee the track-array shape even if a stale flat
    // object slipped in.
    if (!Array.isArray(config.tracks)) config = defaultTemplate();
    if (!config.meta) config.meta = defaultTemplate().meta;
    if (!config.effects) config.effects = { delay_feedback: 0.3, reverb_mix: 0.15 };

    let steps = clampLoopSteps(config.meta.loop_steps);

    // Track whether anything at all matched, so pure gibberish returns the
    // input unchanged.
    let touched = isFullReplace;

    // --- Global: loop length ------------------------------------------------
    const loopMatch = text.match(/(\d+)\s*(step|steps|pasos|paso)\s*(loop|bucle)?/);
    const wantsLonger = /\b(longer|larger|extend|m[aá]s largo|alarga)\b/.test(text);
    const wantsShorter = /\b(shorter|m[aá]s corto|acorta)\b/.test(text);
    if (loopMatch && /loop|bucle/.test(text)) {
        steps = clampLoopSteps(parseInt(loopMatch[1], 10));
        touched = true;
    } else if (wantsLonger) {
        steps = clampLoopSteps(steps * 2); touched = true;
    } else if (wantsShorter) {
        steps = clampLoopSteps(Math.round(steps / 2)); touched = true;
    }

    // --- Global: BPM --------------------------------------------------------
    const bpmMatch = text.match(/(\d+)\s*bpm/);
    if (bpmMatch) {
        config.meta.bpm = parseInt(bpmMatch[1], 10); touched = true;
    } else if (/\b(fast|r[aá]pido|acelera)\b/.test(text)) {
        config.meta.bpm = 132; touched = true;
    } else if (/\b(slow|lento|chill|relax)\b/.test(text)) {
        config.meta.bpm = 90; touched = true;
    }
    config.meta.bpm = Math.max(60, Math.min(220, config.meta.bpm));

    // --- Global: scale (retunes all synth tracks) ---------------------------
    const scaleMatch = text.match(/\b([a-g])\s*(minor|major|m|min|maj|menor|mayor)\b/);
    if (scaleMatch) {
        const root = scaleMatch[1].toUpperCase();
        const mode = scaleMatch[2] || '';
        const isMinor = /m|min|menor/.test(mode) && !/maj|mayor/.test(mode);
        config.meta.scale = root + (isMinor ? "m" : "");
        for (const t of config.tracks) {
            if (t.type === "synth") t.notes = generateScaleMelody(root, isMinor, steps);
        }
        touched = true;
    }

    // --- Global: effects ----------------------------------------------------
    if (/\b(delay|eco)\b/.test(text)) {
        if (/\b(no delay|sin delay|sin eco)\b/.test(text)) config.effects.delay_feedback = 0.0;
        else if (/\b(mucho|heavy|space|bastante)\b/.test(text)) config.effects.delay_feedback = 0.65;
        else if (/\b(poco|light|bajo)\b/.test(text)) config.effects.delay_feedback = 0.1;
        else config.effects.delay_feedback = 0.45;
        touched = true;
    }
    if (/\b(reverb|espacio|catedral)\b/.test(text)) {
        if (/\b(no reverb|sin reverb)\b/.test(text)) config.effects.reverb_mix = 0.0;
        else if (/\b(mucha|alta|cathedral)\b/.test(text)) config.effects.reverb_mix = 0.45;
        else config.effects.reverb_mix = 0.25;
        touched = true;
    }

    // --- Track add / remove / mute / edit -----------------------------------
    touched = applyTrackOps(text, config, steps) || touched;

    // --- Normalize all track lengths to the (possibly new) loop length ------
    config.meta.loop_steps = steps;
    for (const t of config.tracks) {
        if (t.type === "drum") t.pattern = fitPattern(t.pattern, steps);
        else t.notes = fitNotes(t.notes, steps);
    }

    // --- Transition parsing (global) ----------------------------------------
    const transition = parseTransition(text, config);
    if (transition) { config.transition = transition; touched = true; }

    // --- Energy recompute ---------------------------------------------------
    config.meta.energy = computeEnergy(config);

    // Gibberish: nothing matched -> return the input state unchanged.
    if (!touched && currentState) return JSON.parse(JSON.stringify(currentState));

    return config;
}

/** Build a synth track definition for a given role keyword. */
function makeSynthTrack(id, steps, opts = {}) {
    return {
        id, type: "synth", muted: false,
        wave_type: opts.wave_type || "saw",
        filter_cutoff_hz: opts.filter_cutoff_hz || 1500,
        filter_resonance: opts.filter_resonance || 2.0,
        adsr: opts.adsr || [0.01, 0.15, 0.7, 0.2],
        notes: fitNotes(opts.notes || [57, 0, 60, 0, 64, 0, 60, 0], steps)
    };
}

/**
 * Resolves add / remove / mute / edit intents against the track array.
 * Returns true if any track-level change was applied.
 */
function applyTrackOps(text, config, steps) {
    let changed = false;
    const tracks = config.tracks;

    // Which instrument does the prompt name?
    const mentionsBass = /\b(bass|bassline|bajo)\b/.test(text);
    const mentionsPad = /\b(pad|pads)\b/.test(text);
    const mentionsLead = /\b(lead|melod[ií]a|melody)\b/.test(text);
    const mentionsHats = /\b(hats|hi-?hats|platillos|charles)\b/.test(text);
    const mentionsKick = /\b(kick|bombo|bass drum)\b/.test(text);

    const isRemove = /\b(remove|delete|quita|elimina|drop)\b/.test(text);
    const isMute = /\b(mute|silencia|silenciar)\b/.test(text);
    const isUnmute = /\b(unmute|activa|reactiva|de-?silencia)\b/.test(text);
    const isAdd = /\b(add|a[ñn]ade|agrega|mete|pon)\b/.test(text);

    // Target list for mute/remove/unmute operations.
    const targetSelectors = [
        [mentionsBass, "bass"], [mentionsPad, "pad"], [mentionsLead, "lead"],
        [mentionsHats, "hats"], [mentionsKick, "kick"]
    ].filter(([m]) => m).map(([, id]) => id);

    // --- Remove ---
    if (isRemove && targetSelectors.length) {
        for (const id of targetSelectors) {
            const idx = tracks.findIndex(t => t.id === id);
            if (idx >= 0) { tracks.splice(idx, 1); changed = true; }
        }
        return changed;
    }

    // --- Mute / Unmute ---
    if ((isMute || isUnmute) && targetSelectors.length) {
        for (const id of targetSelectors) {
            const t = findTrack(tracks, id);
            if (t) { t.muted = isMute; changed = true; }
        }
        return changed;
    }

    // --- Add ---
    const capReached = tracks.length >= MAX_TRACKS;
    const tryAdd = (id, factory) => {
        if (findTrack(tracks, id)) {
            // Re-add of an existing role: unmute it instead of duplicating.
            const t = findTrack(tracks, id);
            if (t.muted) { t.muted = false; changed = true; }
            return;
        }
        if (capReached) return;
        tracks.push(factory());
        changed = true;
    };
    if (isAdd && mentionsBass) {
        tryAdd("bass", () => makeSynthTrack("bass", steps, {
            wave_type: "saw", filter_cutoff_hz: 600, filter_resonance: 4,
            adsr: [0.01, 0.1, 0.3, 0.2],
            notes: [33, 0, 33, 0, 36, 0, 33, 0]
        }));
    }
    if (isAdd && mentionsPad) {
        tryAdd("pad", () => makeSynthTrack("pad", steps, {
            wave_type: "cycle", filter_cutoff_hz: 1200, filter_resonance: 1.5,
            adsr: [0.4, 0.3, 0.8, 0.5],
            notes: [69, 0, 0, 0, 72, 0, 0, 0]
        }));
    }
    if (isAdd && mentionsLead && !findTrack(tracks, "lead")) {
        tryAdd("lead", () => makeSynthTrack("lead", steps));
    }
    if (isAdd && mentionsHats && !findTrack(tracks, "hats")) {
        tryAdd("hats", () => ({
            id: "hats", type: "drum", role: "hihat", muted: false,
            pattern: fitPattern([0, 0, 1, 0], steps), sample_name: null
        }));
    }
    if (isAdd && mentionsKick && !findTrack(tracks, "kick")) {
        tryAdd("kick", () => ({
            id: "kick", type: "drum", role: "kick", muted: false,
            pattern: fitPattern([1, 0, 0, 0], steps), sample_name: null
        }));
    }

    // --- Edit synth params (targets the lead unless another synth is named) ---
    changed = editSynthParams(text, config, mentionsBass, mentionsPad) || changed;

    // --- Edit drum patterns ---
    changed = editDrumPatterns(text, config, steps) || changed;

    // --- Genre motif application (only when a genre word is present) ---
    for (const [genre, motif] of Object.entries(GENRE_MELODIES)) {
        if (text.includes(genre)) {
            const lead = findLead(tracks);
            if (lead) { lead.notes = fitNotes(motif, steps); changed = true; }
        }
    }

    // --- Custom sample reference on the kick ---
    const sampleWords = text.match(/(?:sample|muestra|usar|usa el sample)\s+([a-z0-9_-]+)/);
    if (sampleWords) {
        const kick = findTrack(tracks, "kick") || tracks.find(t => t.type === "drum");
        if (kick) { kick.sample_name = sampleWords[1]; changed = true; }
    }

    return changed;
}

/** Which synth track a param-edit targets. */
function synthEditTarget(config, mentionsBass, mentionsPad) {
    if (mentionsBass) return findTrack(config.tracks, "bass");
    if (mentionsPad) return findTrack(config.tracks, "pad");
    return findLead(config.tracks);
}

/** Applies wave/cutoff/resonance/ADSR edits to the targeted synth track. */
function editSynthParams(text, config, mentionsBass, mentionsPad) {
    const t = synthEditTarget(config, mentionsBass, mentionsPad);
    if (!t) return false;
    let changed = false;

    if (/\b(sine|cycle|senoidal|soft|smooth)\b/.test(text)) { t.wave_type = "cycle"; changed = true; }
    else if (/\b(saw|diente de sierra|bright|techno)\b/.test(text)) { t.wave_type = "saw"; changed = true; }
    else if (/\b(square|cuadrada|retro)\b/.test(text)) { t.wave_type = "square"; changed = true; }

    const hzMatch = text.match(/(\d+)\s*hz/);
    if (hzMatch) { t.filter_cutoff_hz = parseInt(hzMatch[1], 10); changed = true; }
    else if (/\b(low|bajo|oscuro|dark|deep|darker)\b/.test(text)) { t.filter_cutoff_hz = 600; changed = true; }
    else if (/\b(high|alto|brillante|bright|open|abierto)\b/.test(text)) { t.filter_cutoff_hz = 3200; changed = true; }
    if (changed) t.filter_cutoff_hz = Math.max(100, Math.min(10000, t.filter_cutoff_hz));

    if (/\b(res|resonancia)\b/.test(text)) {
        if (/\b(mucho|alta|high)\b/.test(text)) { t.filter_resonance = 4.5; changed = true; }
        else if (/\b(poca|baja|low)\b/.test(text)) { t.filter_resonance = 1.1; changed = true; }
    }

    if (/\b(plucky|pluck|corto)\b/.test(text)) { t.adsr = [0.002, 0.08, 0.1, 0.05]; changed = true; }
    else if (/\b(pad|largo|slow attack)\b/.test(text)) { t.adsr = [0.4, 0.3, 0.8, 0.5]; changed = true; }

    return changed;
}

/** Applies drum-pattern edits to the kick/hats tracks. */
function editDrumPatterns(text, config, steps) {
    let changed = false;
    const kick = findTrack(config.tracks, "kick");
    const hats = findTrack(config.tracks, "hats");

    if (/\b(no percusion|no percussion|sin percusion|sin percussion|no drums?|sin bateria|quitar bateria)\b/.test(text)) {
        if (kick) { kick.pattern = fitPattern([0], steps); changed = true; }
        if (hats) { hats.pattern = fitPattern([0], steps); changed = true; }
        return changed;
    }

    if (hats) {
        const fastHats = /\b(fast hats|hats rapidas|hihats rapidas|techno hats)\b/.test(text)
            || (/\bhats?\b/.test(text) && /\b(fast|faster|r[aá]pid[ao]s?)\b/.test(text));
        if (fastHats) {
            hats.pattern = fitPattern([0, 1], steps); changed = true;
        } else if (/\b(no hats|sin hats|sin platillos)\b/.test(text)) {
            hats.pattern = fitPattern([0], steps); changed = true;
        }
    }
    if (kick) {
        if (/\b(break|breakbeat|hiphop|hip hop)\b/.test(text)) {
            kick.pattern = fitPattern([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0], steps); changed = true;
        } else if (/\b(double kick|fast kick|hardcore)\b/.test(text)) {
            kick.pattern = fitPattern([1, 0], steps); changed = true;
        } else if (/\b(no kick|sin bombo)\b/.test(text)) {
            kick.pattern = fitPattern([0], steps); changed = true;
        }
    }
    return changed;
}

/** Parses a multi-step transition request; returns a transition block or null. */
function parseTransition(text, config) {
    const stepsMatch = text.match(/(\d+)\s*(steps|pasos|paso|step)/);
    if (!stepsMatch || /loop|bucle/.test(text)) return null;

    const total_steps = parseInt(stepsMatch[1], 10);
    const lead = findLead(config.tracks);
    const startCutoff = lead ? lead.filter_cutoff_hz : 1500;
    let target_scale = config.meta.scale;

    const destScaleMatch = text.match(/(?:to|a|hasta)\s+([a-g])\s*(minor|major|m|min|maj|menor|mayor)?\b/);
    if (destScaleMatch) {
        const root = destScaleMatch[1].toUpperCase();
        const mode = destScaleMatch[2] || '';
        const isMinor = /m|min|menor/.test(mode) && !/maj|mayor/.test(mode);
        target_scale = root + (isMinor ? "m" : "");
    }

    let target_cutoff = startCutoff;
    if (/\b(brillian|brillante|bright|open)\b/.test(text)) target_cutoff = 4500;

    const drum_exploding = /\b(exploding|explotando|explosion|climax)\b/.test(text);

    return {
        active: true,
        current_step: 0,
        total_steps,
        start_scale: config.meta.scale,
        target_scale,
        start_cutoff: startCutoff,
        target_cutoff,
        drum_exploding
    };
}

/** Derives an energy scalar (0.1-1.0) from tempo, hats density, and brightness. */
function computeEnergy(config) {
    let energy = 0.5;
    if (config.meta.bpm > 128) energy += 0.2;
    const hats = config.tracks.find(t => t.role === "hihat");
    if (hats && hats.pattern.filter(x => x === 1).length > config.meta.loop_steps / 3) energy += 0.15;
    const lead = findLead(config.tracks);
    if (lead && lead.filter_cutoff_hz > 2000) energy += 0.15;
    return Math.max(0.1, Math.min(1.0, energy));
}
