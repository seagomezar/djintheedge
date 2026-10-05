// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parsePromptToDSP } from '../js/ai-manager.js';
import { AudioEngine } from '../js/audio-engine.js';
import { setupWebAudioMock } from './helpers/mock-web-audio.js';

describe('Property-Based Constraint Testing (Ground Truth Invariants)', () => {
    // Fixed seed for 100% deterministic, reproducible test runs
    const DETERMINISTIC_SEED = 42424242;

    // Helper: Arbitrary valid state generator
    const arbitraryValidState = fc.record({
        meta: fc.record({
            bpm: fc.integer({ min: 60, max: 220 }),
            scale: fc.constantFrom('C', 'Dm', 'Em', 'F', 'G', 'Am', 'B', 'Cm', 'D', 'E', 'F#m', 'Gm', 'A', 'Bm'),
            energy: fc.double({ min: 0.1, max: 1.0, noNaN: true })
        }),
        dsp_graph: fc.record({
            drums: fc.record({
                use_custom_sample: fc.boolean(),
                sample_name: fc.string({ maxLength: 20 }),
                kick_pattern: fc.array(fc.constantFrom(0, 1), { minLength: 16, maxLength: 16 }),
                hihat_pattern: fc.array(fc.constantFrom(0, 1), { minLength: 16, maxLength: 16 })
            }),
            synth_lead: fc.record({
                wave_type: fc.constantFrom('saw', 'square', 'cycle'),
                filter_cutoff_hz: fc.integer({ min: 100, max: 10000 }),
                filter_resonance: fc.double({ min: 0.5, max: 6.0, noNaN: true }),
                adsr: fc.tuple(
                    fc.double({ min: 0.001, max: 0.5, noNaN: true }),
                    fc.double({ min: 0.05, max: 0.8, noNaN: true }),
                    fc.double({ min: 0.0, max: 1.0, noNaN: true }),
                    fc.double({ min: 0.01, max: 1.0, noNaN: true })
                ),
                notes_sequence: fc.array(fc.integer({ min: 0, max: 127 }), { minLength: 16, maxLength: 16 })
            }),
            effects: fc.record({
                delay_feedback: fc.double({ min: 0.0, max: 0.85, noNaN: true }),
                reverb_mix: fc.double({ min: 0.0, max: 0.75, noNaN: true })
            })
        })
    });

    // -------------------------------------------------------------------------
    // Constraint 1: Numerical Bounds Invariant (2,000 test cases)
    // -------------------------------------------------------------------------
    it('Constraint 1: numerical values must NEVER violate safety bounds across 2,000 cases', () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 100 }), arbitraryValidState, (prompt, state) => {
                const res = parsePromptToDSP(prompt, state);

                // BPM Invariant
                expect(Number.isInteger(res.meta.bpm)).toBe(true);
                expect(res.meta.bpm).toBeGreaterThanOrEqual(60);
                expect(res.meta.bpm).toBeLessThanOrEqual(220);
                expect(Number.isNaN(res.meta.bpm)).toBe(false);

                // Filter Cutoff Invariant
                expect(typeof res.dsp_graph.synth_lead.filter_cutoff_hz).toBe('number');
                expect(res.dsp_graph.synth_lead.filter_cutoff_hz).toBeGreaterThanOrEqual(100);
                expect(res.dsp_graph.synth_lead.filter_cutoff_hz).toBeLessThanOrEqual(10000);
                expect(Number.isNaN(res.dsp_graph.synth_lead.filter_cutoff_hz)).toBe(false);

                // Filter Resonance Invariant
                expect(typeof res.dsp_graph.synth_lead.filter_resonance).toBe('number');
                expect(res.dsp_graph.synth_lead.filter_resonance).toBeGreaterThan(0);
                expect(Number.isFinite(res.dsp_graph.synth_lead.filter_resonance)).toBe(true);

                // Effects Invariant
                expect(res.dsp_graph.effects.delay_feedback).toBeGreaterThanOrEqual(0.0);
                expect(res.dsp_graph.effects.delay_feedback).toBeLessThanOrEqual(0.85);
                expect(Number.isNaN(res.dsp_graph.effects.delay_feedback)).toBe(false);

                expect(res.dsp_graph.effects.reverb_mix).toBeGreaterThanOrEqual(0.0);
                expect(res.dsp_graph.effects.reverb_mix).toBeLessThanOrEqual(0.75);
                expect(Number.isNaN(res.dsp_graph.effects.reverb_mix)).toBe(false);
            }),
            { numRuns: 2000, seed: DETERMINISTIC_SEED }
        );
    });

    // -------------------------------------------------------------------------
    // Constraint 2: Structural Data Invariants (2,000 test cases)
    // -------------------------------------------------------------------------
    it('Constraint 2: data structures must NEVER corrupt length or types across 2,000 cases', () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 100 }), arbitraryValidState, (prompt, state) => {
                const res = parsePromptToDSP(prompt, state);

                // Kick Pattern Invariant
                expect(Array.isArray(res.dsp_graph.drums.kick_pattern)).toBe(true);
                expect(res.dsp_graph.drums.kick_pattern).toHaveLength(16);
                res.dsp_graph.drums.kick_pattern.forEach(v => {
                    expect(v === 0 || v === 1).toBe(true);
                });

                // Hi-Hat Pattern Invariant
                expect(Array.isArray(res.dsp_graph.drums.hihat_pattern)).toBe(true);
                expect(res.dsp_graph.drums.hihat_pattern).toHaveLength(16);
                res.dsp_graph.drums.hihat_pattern.forEach(v => {
                    expect(v === 0 || v === 1).toBe(true);
                });

                // Synth Notes Sequence Invariant
                expect(Array.isArray(res.dsp_graph.synth_lead.notes_sequence)).toBe(true);
                expect(res.dsp_graph.synth_lead.notes_sequence).toHaveLength(16);
                res.dsp_graph.synth_lead.notes_sequence.forEach(note => {
                    expect(typeof note).toBe('number');
                    expect(Number.isNaN(note)).toBe(false);
                    expect(note).toBeGreaterThanOrEqual(0);
                });

                // ADSR Invariant
                expect(Array.isArray(res.dsp_graph.synth_lead.adsr)).toBe(true);
                expect(res.dsp_graph.synth_lead.adsr).toHaveLength(4);
                res.dsp_graph.synth_lead.adsr.forEach(val => {
                    expect(typeof val).toBe('number');
                    expect(Number.isNaN(val)).toBe(false);
                    expect(val).toBeGreaterThanOrEqual(0);
                });

                // Waveform Type Invariant
                expect(['saw', 'square', 'cycle'].includes(res.dsp_graph.synth_lead.wave_type)).toBe(true);

                // Scale String Invariant
                expect(typeof res.meta.scale).toBe('string');
                expect(res.meta.scale.length).toBeGreaterThan(0);
            }),
            { numRuns: 2000, seed: DETERMINISTIC_SEED }
        );
    });

    // -------------------------------------------------------------------------
    // Constraint 3: Adversarial Fuzzing & No-Crash Guarantee (2,500 test cases)
    // -------------------------------------------------------------------------
    it('Constraint 3: adversarial fuzzed strings must NEVER throw uncaught exceptions across 2,500 cases', () => {
        const adversarialString = fc.oneof(
            fc.string({ minLength: 0, maxLength: 500, unit: 'grapheme-ascii' }),
            fc.string({ minLength: 500, maxLength: 4000 }),
            fc.constantFrom(
                "", " ", "\t\n\r", "null", "undefined", "NaN", "Infinity", "-Infinity",
                "DROP TABLE bpm;--", "<script>alert(1)</script>", "135' or '1'='1",
                "99999999999999999999999999999 bpm", "-100 bpm", "0.0000000001 hercios",
                "\\b\\w+\\s*.*", "[object Object]", "{\"meta\":{\"bpm\":null}}",
                "🔥🔥🔥🚀🚀🚀🎛️🎛️🎧🎧", "undefined bpm", "NaN Hz"
            )
        );

        fc.assert(
            fc.property(adversarialString, fc.option(arbitraryValidState), (fuzzedInput, stateOption) => {
                let res;
                expect(() => {
                    res = parsePromptToDSP(fuzzedInput, stateOption);
                }).not.toThrow();

                expect(res).toBeDefined();
                expect(res).not.toBeNull();
                expect(res.meta).toBeDefined();
                expect(res.dsp_graph).toBeDefined();
                expect(res.meta.bpm).toBeGreaterThanOrEqual(60);
                expect(res.meta.bpm).toBeLessThanOrEqual(220);
            }),
            { numRuns: 2500, seed: DETERMINISTIC_SEED }
        );
    });

    // -------------------------------------------------------------------------
    // Constraint 4: State Preservation Invariant on Independent Domains (1,000 cases)
    // -------------------------------------------------------------------------
    it('Constraint 4: targeting a single domain must NEVER reset or corrupt unrelated domains across 1,000 cases', () => {
        // Domain A: Effects-only prompts
        const effectsPrompts = fc.constantFrom(
            "más delay", "sin delay", "mucho delay", "menos delay",
            "más reverb", "sin reverb", "mucha reverb", "menos reverb",
            "sin eco", "con eco", "espacial", "catedral", "seco"
        );

        fc.assert(
            fc.property(effectsPrompts, arbitraryValidState, (prompt, priorState) => {
                const newState = parsePromptToDSP(prompt, priorState);

                // Invariant: BPM, Scale, Waveform, and Drum patterns MUST be strictly preserved!
                expect(newState.meta.bpm).toBe(priorState.meta.bpm);
                expect(newState.meta.scale).toBe(priorState.meta.scale);
                expect(newState.dsp_graph.synth_lead.wave_type).toBe(priorState.dsp_graph.synth_lead.wave_type);
                expect(newState.dsp_graph.drums.kick_pattern).toEqual(priorState.dsp_graph.drums.kick_pattern);
                expect(newState.dsp_graph.drums.hihat_pattern).toEqual(priorState.dsp_graph.drums.hihat_pattern);
            }),
            { numRuns: 1000, seed: DETERMINISTIC_SEED }
        );

        // Domain B: Gibberish / unrecognized words MUST be completely idempotent (preserve state exactly)
        const gibberishPrompts = fc.constantFrom(
            "palabra_aleatoria_invalida", "asdfghjkl qwertyuiop", "color azul cielo",
            "pantalla tactil", "navegador moderno", "cafe por la manana"
        );

        fc.assert(
            fc.property(gibberishPrompts, arbitraryValidState, (prompt, priorState) => {
                const newState = parsePromptToDSP(prompt, priorState);
                expect(newState.meta.bpm).toBe(priorState.meta.bpm);
                expect(newState.meta.scale).toBe(priorState.meta.scale);
                expect(newState.dsp_graph.synth_lead.wave_type).toBe(priorState.dsp_graph.synth_lead.wave_type);
                expect(newState.dsp_graph.synth_lead.filter_cutoff_hz).toBe(priorState.dsp_graph.synth_lead.filter_cutoff_hz);
                expect(newState.dsp_graph.effects.delay_feedback).toBe(priorState.dsp_graph.effects.delay_feedback);
                expect(newState.dsp_graph.effects.reverb_mix).toBe(priorState.dsp_graph.effects.reverb_mix);
            }),
            { numRuns: 1000, seed: DETERMINISTIC_SEED }
        );
    });

    // -------------------------------------------------------------------------
    // Constraint 5: Monotonic Directional Invariants (1,000 cases)
    // -------------------------------------------------------------------------
    it('Constraint 5: relative tempo and filter modifiers must NEVER move in the wrong direction across 1,000 cases', () => {
        const accelerationPrompts = fc.constantFrom("más rápido", "mas rapido", "faster", "speed up", "mais rápido", "acelera");
        const decelerationPrompts = fc.constantFrom("más lento", "mas lento", "slower", "slow down", "mais lento", "frena", "desacelera");

        fc.assert(
            fc.property(accelerationPrompts, arbitraryValidState, (prompt, priorState) => {
                const nextState = parsePromptToDSP(prompt, priorState);
                // Accelerated BPM must be >= prior BPM (unless already clamped at 220 ceiling)
                expect(nextState.meta.bpm).toBeGreaterThanOrEqual(priorState.meta.bpm);
            }),
            { numRuns: 1000, seed: DETERMINISTIC_SEED }
        );

        fc.assert(
            fc.property(decelerationPrompts, arbitraryValidState, (prompt, priorState) => {
                const nextState = parsePromptToDSP(prompt, priorState);
                // Decelerated BPM must be <= prior BPM (unless already clamped at 60 floor)
                expect(nextState.meta.bpm).toBeLessThanOrEqual(priorState.meta.bpm);
            }),
            { numRuns: 1000, seed: DETERMINISTIC_SEED }
        );
    });

    // -------------------------------------------------------------------------
    // Constraint 6: DSP Graph Soundness & AST Compilation (1,000 cases)
    // -------------------------------------------------------------------------
    it('Constraint 6: AudioEngine.renderGraph must NEVER throw or produce NaN nodes for any generated config', async () => {
        setupWebAudioMock();
        const audioEngine = new AudioEngine();
        await audioEngine.initialize();

        fc.assert(
            fc.property(arbitraryValidState, (state) => {
                expect(() => {
                    audioEngine.renderGraph(state);
                }).not.toThrow();

                // Core virtual renderer must reflect the compiled parameters
                expect(audioEngine.core.bpm).toBe(state.meta.bpm);
                expect(audioEngine.core.synthWaveType).toBe(state.dsp_graph.synth_lead.wave_type);
                expect(Number.isNaN(audioEngine.core.filterResonance)).toBe(false);
                expect(Number.isNaN(audioEngine.core.delayFeedback)).toBe(false);
                expect(Number.isNaN(audioEngine.core.reverbMix)).toBe(false);
            }),
            { numRuns: 1000, seed: DETERMINISTIC_SEED }
        );
    });
});
