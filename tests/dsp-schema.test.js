import { describe, it, expect } from 'vitest';
import {
    validateDSP, isValidDSP, MIN_LOOP_STEPS, MAX_LOOP_STEPS
} from '../js/lib/dsp-schema.js';

/**
 * A valid spec A.1 fixture: drum + synth + a transition block, loop_steps 8.
 * Rebuilt fresh per call so mutations in one test never leak into another.
 */
const specA1Config = () => ({
    meta: { bpm: 124, scale: 'Am', loop_steps: 8, energy: 0.7 },
    tracks: [
        { id: 'kick', type: 'drum', role: 'kick', muted: false, pattern: [1, 0, 0, 0, 1, 0, 0, 0], sample_name: null },
        { id: 'hats', type: 'drum', role: 'hihat', muted: false, pattern: [0, 0, 1, 0, 0, 0, 1, 0], sample_name: 'my_hat' },
        { id: 'lead', type: 'synth', muted: false, wave_type: 'saw', filter_cutoff_hz: 1500, filter_resonance: 2.0, adsr: [0.01, 0.15, 0.7, 0.2], notes: [57, 0, 60, 0, 64, 0, 60, 0] }
    ],
    effects: { delay_feedback: 0.35, reverb_mix: 0.2 },
    transition: { active: true, current_step: 0, total_steps: 16, start_scale: 'Am', target_scale: 'Cm', start_cutoff: 1500, target_cutoff: 800, drum_exploding: true }
});

/** The trackConfig() shape used in tests/audio-engine.test.js (loop_steps 4). */
const trackConfig = () => ({
    meta: { bpm: 128, scale: 'Am', loop_steps: 4, energy: 0.6 },
    tracks: [
        { id: 'kick', type: 'drum', role: 'kick', muted: false, pattern: [1, 0, 0, 0], sample_name: null },
        { id: 'hats', type: 'drum', role: 'hihat', muted: false, pattern: [0, 0, 1, 0], sample_name: null },
        { id: 'lead', type: 'synth', muted: false, wave_type: 'saw', filter_cutoff_hz: 1200, filter_resonance: 2.5, adsr: [0.01, 0.1, 0.5, 0.2], notes: [60, 62, 64, 60] }
    ],
    effects: { delay_feedback: 0.4, reverb_mix: 0.2 },
    transition: null
});

describe('dsp-schema constants', () => {
    it('exposes the documented loop-step bounds', () => {
        expect(MIN_LOOP_STEPS).toBe(4);
        expect(MAX_LOOP_STEPS).toBe(64);
    });
});

describe('validateDSP accepts valid configs', () => {
    it('accepts the spec A.1 drum+synth+transition fixture', () => {
        const result = validateDSP(specA1Config());
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('accepts the audio-engine trackConfig() shape (loop_steps 4)', () => {
        const result = validateDSP(trackConfig());
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('accepts loop_steps at both bounds', () => {
        const atMin = trackConfig(); // already loop_steps 4
        expect(isValidDSP(atMin)).toBe(true);

        const atMax = specA1Config();
        atMax.meta.loop_steps = MAX_LOOP_STEPS;
        atMax.tracks[0].pattern = Array(MAX_LOOP_STEPS).fill(0);
        atMax.tracks[1].pattern = Array(MAX_LOOP_STEPS).fill(1);
        atMax.tracks[2].notes = Array(MAX_LOOP_STEPS).fill(60);
        expect(isValidDSP(atMax)).toBe(true);
    });

    it('accepts a null transition', () => {
        const cfg = specA1Config();
        cfg.transition = null;
        expect(isValidDSP(cfg)).toBe(true);
    });
});

describe('validateDSP rejects invalid configs', () => {
    const expectInvalid = (cfg) => {
        const result = validateDSP(cfg);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        // isValidDSP must agree with validateDSP().valid.
        expect(isValidDSP(cfg)).toBe(result.valid);
        return result;
    };

    it('rejects a non-object root', () => {
        expect(isValidDSP(null)).toBe(false);
        expect(isValidDSP(42)).toBe(false);
        expect(isValidDSP('nope')).toBe(false);
        expect(isValidDSP([])).toBe(false);
    });

    it('rejects a bad track type', () => {
        const cfg = trackConfig();
        cfg.tracks[0].type = 'bongo';
        expectInvalid(cfg);
    });

    it('rejects loop_steps below the minimum', () => {
        const cfg = trackConfig();
        cfg.meta.loop_steps = MIN_LOOP_STEPS - 1;
        expectInvalid(cfg);
    });

    it('rejects loop_steps above the maximum', () => {
        const cfg = specA1Config();
        cfg.meta.loop_steps = MAX_LOOP_STEPS + 1;
        expectInvalid(cfg);
    });

    it('rejects missing tracks', () => {
        const cfg = trackConfig();
        delete cfg.tracks;
        expectInvalid(cfg);
    });

    it('rejects empty tracks', () => {
        const cfg = trackConfig();
        cfg.tracks = [];
        expectInvalid(cfg);
    });

    it('rejects a synth with non-array notes', () => {
        const cfg = trackConfig();
        cfg.tracks[2].notes = 'not-an-array';
        expectInvalid(cfg);
    });

    it('rejects a bad wave_type', () => {
        const cfg = trackConfig();
        cfg.tracks[2].wave_type = 'triangle';
        expectInvalid(cfg);
    });

    it('rejects an adsr that is not length 4', () => {
        const cfg = trackConfig();
        cfg.tracks[2].adsr = [0.01, 0.1, 0.5];
        expectInvalid(cfg);
    });

    it('rejects a drum pattern whose length != loop_steps', () => {
        const cfg = trackConfig(); // loop_steps 4
        cfg.tracks[0].pattern = [1, 0, 0, 0, 1, 0]; // length 6
        expectInvalid(cfg);
    });

    it('rejects a drum pattern with non-0/1 values', () => {
        const cfg = trackConfig();
        cfg.tracks[0].pattern = [1, 2, 0, 0];
        expectInvalid(cfg);
    });

    it('rejects duplicate track ids', () => {
        const cfg = trackConfig();
        cfg.tracks[1].id = 'kick'; // collides with tracks[0]
        expectInvalid(cfg);
    });

    it('rejects a missing effects block', () => {
        const cfg = trackConfig();
        delete cfg.effects;
        expectInvalid(cfg);
    });
});
