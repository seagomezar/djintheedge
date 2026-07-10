import { describe, it, expect } from 'vitest';
import { parsePromptToDSP } from '../js/ai-manager.js';
import { validateDSP, isValidDSP } from '../js/lib/dsp-schema.js';

/**
 * Contract check: the rule-based parser is the correctness oracle and the
 * always-available fallback, so every prompt it handles MUST yield a
 * schema-valid DSP config. If any of these fail, that is a module bug in the
 * parser (or a schema/parser drift) to REPORT, not to loosen.
 */
describe('parser output conforms to the DSP schema', () => {
    /** Assert-with-diagnostics helper so a failure prints the validation errors. */
    const expectValid = (config, label) => {
        const result = validateDSP(config);
        expect(
            result.valid,
            `parser output for ${label} failed validation:\n${result.errors.join('\n')}`
        ).toBe(true);
        expect(isValidDSP(config)).toBe(true);
    };

    it('validates a fresh "house groove"', () => {
        expectValid(parsePromptToDSP('house groove'), '"house groove"');
    });

    it('validates "techno at 128 bpm"', () => {
        expectValid(parsePromptToDSP('techno at 128 bpm'), '"techno at 128 bpm"');
    });

    it('validates "fast dark synthwave"', () => {
        expectValid(parsePromptToDSP('fast dark synthwave'), '"fast dark synthwave"');
    });

    it('validates "add a bassline" chained onto a prior state', () => {
        const base = parsePromptToDSP('techno at 128 bpm');
        expectValid(base, 'the prior "techno at 128 bpm" state');
        const withBass = parsePromptToDSP('add a bassline', base);
        expectValid(withBass, '"add a bassline" (chained)');
    });

    it('validates "transition to C minor over 16 steps with climax"', () => {
        const base = parsePromptToDSP('techno at 124 bpm');
        const withTransition = parsePromptToDSP('transition to C minor over 16 steps with climax', base);
        expectValid(withTransition, '"transition to C minor over 16 steps with climax"');
    });

    it('validates "128 step loop" (clamped)', () => {
        expectValid(parsePromptToDSP('128 step loop'), '"128 step loop"');
    });

    it('validates gibberish with a prior valid state ("asdf qwerty")', () => {
        const base = parsePromptToDSP('techno at 128 bpm');
        const after = parsePromptToDSP('asdf qwerty', base);
        expectValid(after, 'gibberish "asdf qwerty" with prior state');
    });

    it('validates "sidechain pumping techno"', () => {
        expectValid(parsePromptToDSP('sidechain pumping techno'), '"sidechain pumping techno"');
    });

    it('validates "no sidechain" chained onto a prior state', () => {
        const base = parsePromptToDSP('sidechain pumping techno');
        expectValid(base, 'the prior "sidechain pumping techno" state');
        const off = parsePromptToDSP('no sidechain', base);
        expectValid(off, '"no sidechain" (chained)');
    });
});
