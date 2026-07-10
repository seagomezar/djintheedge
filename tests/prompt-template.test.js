import { describe, it, expect } from 'vitest';
import {
    SYSTEM_PROMPT, FEW_SHOT_EXAMPLES,
    buildInferencePrompt, buildRepairPrompt
} from '../js/lib/prompt-template.js';
import { validateDSP, isValidDSP } from '../js/lib/dsp-schema.js';

describe('SYSTEM_PROMPT', () => {
    it('is a non-empty string', () => {
        expect(typeof SYSTEM_PROMPT).toBe('string');
        expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
    });
});

describe('FEW_SHOT_EXAMPLES', () => {
    it('is a non-empty array of {prompt, state, output}', () => {
        expect(Array.isArray(FEW_SHOT_EXAMPLES)).toBe(true);
        expect(FEW_SHOT_EXAMPLES.length).toBeGreaterThan(0);
        for (const ex of FEW_SHOT_EXAMPLES) {
            expect(typeof ex.prompt).toBe('string');
            expect('state' in ex).toBe(true);
            expect(typeof ex.output).toBe('object');
        }
    });

    FEW_SHOT_EXAMPLES.forEach((ex, i) => {
        it(`example ${i + 1} ("${ex.prompt}") output passes isValidDSP`, () => {
            const result = validateDSP(ex.output);
            expect(
                result.valid,
                `FEW_SHOT_EXAMPLES[${i}].output failed validation:\n${result.errors.join('\n')}`
            ).toBe(true);
            expect(isValidDSP(ex.output)).toBe(true);
        });
    });
});

describe('buildInferencePrompt', () => {
    const someState = {
        meta: { bpm: 128, scale: 'Am', loop_steps: 8, energy: 0.6 },
        tracks: [
            { id: 'kick', type: 'drum', role: 'kick', muted: false, pattern: [1, 0, 0, 0, 1, 0, 0, 0], sample_name: null }
        ],
        effects: { delay_feedback: 0.3, reverb_mix: 0.15 },
        transition: null
    };

    it('includes the serialized current state and the user prompt text', () => {
        const prompt = buildInferencePrompt('add delay', someState);
        expect(prompt).toContain(JSON.stringify(someState));
        expect(prompt).toContain('add delay');
    });

    it('includes "null" for a null current state', () => {
        const prompt = buildInferencePrompt('add delay', null);
        expect(prompt).toContain('Estado actual: null');
        expect(prompt).toContain('add delay');
    });

    it('embeds the system prompt', () => {
        const prompt = buildInferencePrompt('techno', null);
        expect(prompt).toContain(SYSTEM_PROMPT);
    });
});

describe('buildRepairPrompt', () => {
    it('includes each provided error string and the bad text', () => {
        const errors = [
            'meta.loop_steps: expected 4-64, got 128',
            'tracks[0].pattern: expected only 0/1 values'
        ];
        const badText = '{ "meta": broken json here }';
        const prompt = buildRepairPrompt('techno at 128 bpm', null, badText, errors);

        expect(prompt).toContain(badText);
        for (const err of errors) {
            expect(prompt).toContain(err);
        }
    });

    it('serializes the current state into the repair prompt', () => {
        const state = { meta: { bpm: 120 }, tracks: [], effects: {}, transition: null };
        const prompt = buildRepairPrompt('slow it down', state, 'bad', ['some error']);
        expect(prompt).toContain(JSON.stringify(state));
    });
});
