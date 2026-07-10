import { describe, it, expect, vi } from 'vitest';
import { AIManager, extractJson, parsePromptToDSP } from '../js/ai-manager.js';
import { isValidDSP } from '../js/lib/dsp-schema.js';

/** A schema-valid DSP config used as the "good" model output. */
const validConfig = () => ({
    meta: { bpm: 128, scale: 'Am', loop_steps: 8, energy: 0.6 },
    tracks: [
        { id: 'kick', type: 'drum', role: 'kick', muted: false, pattern: [1, 0, 0, 0, 1, 0, 0, 0], sample_name: null },
        { id: 'lead', type: 'synth', muted: false, wave_type: 'saw', filter_cutoff_hz: 1500, filter_resonance: 2.0, adsr: [0.01, 0.15, 0.7, 0.2], notes: [57, 0, 60, 0, 64, 0, 60, 0] }
    ],
    effects: { delay_feedback: 0.3, reverb_mix: 0.15 },
    transition: null
});

/**
 * Builds a mock engine whose conversation.sendMessage is a vi.fn() returning
 * the queued responses in order (last one repeats if exhausted). Returns both
 * the engine (to inject at ai.engine) and the spy (to assert call counts).
 */
function makeMockEngine(responses) {
    const sendMessage = vi.fn(async () => {
        const next = responses.length > 1 ? responses.shift() : responses[0];
        return next;
    });
    const engine = {
        createConversation: vi.fn(async () => ({ sendMessage }))
    };
    return { engine, sendMessage };
}

describe('extractJson', () => {
    it('parses plain JSON', () => {
        expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('parses JSON wrapped in ```json fences', () => {
        const text = 'Here you go:\n```json\n{"a":1,"b":2}\n```\nEnjoy.';
        expect(extractJson(text)).toEqual({ a: 1, b: 2 });
    });

    it('extracts JSON embedded in prose with leading/trailing text', () => {
        const text = 'Sure! {"meta":{"bpm":128}} that is the config.';
        expect(extractJson(text)).toEqual({ meta: { bpm: 128 } });
    });

    it('returns null for unparseable input', () => {
        expect(extractJson('no json at all')).toBeNull();
        expect(extractJson('')).toBeNull();
        expect(extractJson(null)).toBeNull();
        expect(extractJson(42)).toBeNull();
    });

    it('does not miscount braces inside string literals', () => {
        // A brace inside a string value must not close the object early.
        const text = 'Config: {"scale":"A} minor","bpm":120} done.';
        expect(extractJson(text)).toEqual({ scale: 'A} minor', bpm: 120 });
    });

    it('handles escaped quotes inside string literals', () => {
        const text = '{"note":"say \\"hi\\" {now}","n":1}';
        expect(extractJson(text)).toEqual({ note: 'say "hi" {now}', n: 1 });
    });
});

describe('AIManager generateDSPConfig ladder (injected mock engine)', () => {
    it('returns valid engine JSON as-is with no repair call', async () => {
        const config = validConfig();
        const ai = new AIManager();
        await ai.initialize();

        const { engine, sendMessage } = makeMockEngine([{ text: JSON.stringify(config) }]);
        ai.engine = engine; // inject the real-engine mock

        const result = await ai.generateDSPConfig('techno at 128 bpm');
        expect(result).toEqual(config);
        expect(sendMessage).toHaveBeenCalledTimes(1); // no repair
    });

    it('repairs malformed-then-valid output (two sendMessage calls)', async () => {
        const config = validConfig();
        const ai = new AIManager();
        await ai.initialize();

        const { engine, sendMessage } = makeMockEngine([
            { text: 'sorry, here is a broken answer {not json' },
            { text: JSON.stringify(config) }
        ]);
        ai.engine = engine;

        const result = await ai.generateDSPConfig('techno at 128 bpm');
        expect(result).toEqual(config);
        expect(sendMessage).toHaveBeenCalledTimes(2); // one repair
    });

    it('falls back to a valid parser config when repair still fails', async () => {
        const ai = new AIManager();
        await ai.initialize();

        const { engine, sendMessage } = makeMockEngine([
            { text: 'broken {not json' },
            { text: 'still broken }{}{' }
        ]);
        ai.engine = engine;

        const result = await ai.generateDSPConfig('techno at 128 bpm');
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(result).not.toBeNull();
        expect(isValidDSP(result)).toBe(true);
    });

    it('falls back to a valid parser config when the engine throws', async () => {
        const ai = new AIManager();
        await ai.initialize();

        ai.engine = {
            createConversation: vi.fn(async () => ({
                sendMessage: vi.fn(async () => { throw new Error('engine boom'); })
            }))
        };

        const result = await ai.generateDSPConfig('techno at 128 bpm');
        expect(result).not.toBeNull();
        expect(isValidDSP(result)).toBe(true);
    });

    it('resolves to null when inference is aborted (AbortError)', async () => {
        const ai = new AIManager();
        await ai.initialize();

        ai.engine = {
            createConversation: vi.fn(async () => ({
                sendMessage: vi.fn(async () => {
                    const err = new Error('Inference aborted by system controller.');
                    err.name = 'AbortError';
                    throw err;
                })
            }))
        };

        const result = await ai.generateDSPConfig('techno at 128 bpm');
        expect(result).toBeNull();
    });
});

describe('AIManager parser fallback (no WebGPU)', () => {
    it('initialize() calls onProgress with 1.0 and generateDSPConfig returns a valid config', async () => {
        const onProgress = vi.fn();
        const ai = new AIManager();
        await ai.initialize(onProgress); // no navigator.gpu -> parser fallback

        expect(onProgress).toHaveBeenCalledWith(1.0);
        expect(ai.usingRealModel).toBe(false);

        const result = await ai.generateDSPConfig('techno at 128 bpm');
        expect(result).not.toBeNull();
        expect(isValidDSP(result)).toBe(true);
        expect(result.meta.bpm).toBe(128);
    });

    it('forwards currentState to the parser (preserves base.meta.bpm)', async () => {
        const ai = new AIManager();
        await ai.initialize();

        const base = await ai.generateDSPConfig('techno at 128 bpm');
        expect(base.meta.bpm).toBe(128);

        // A prompt with no BPM token must not reset to the default 120.
        const next = await ai.generateDSPConfig('add heavy delay', base);
        expect(next.meta.bpm).toBe(base.meta.bpm);
        expect(next.meta.bpm).toBe(128);
    });
});
