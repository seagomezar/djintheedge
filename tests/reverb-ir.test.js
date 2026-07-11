import { describe, it, expect } from 'vitest';
import { fillDecayNoise, buildImpulseResponse } from '../js/lib/reverb-ir.js';

describe('fillDecayNoise', () => {
    it('returns the same array it was given (fills in place)', () => {
        const arr = new Float32Array(16);
        const result = fillDecayNoise(arr, 2.0, () => 1);
        expect(result).toBe(arr);
    });

    it('produces a monotonically non-increasing envelope when noise is held at max (randomFn => 1)', () => {
        // randomFn () => 1 yields raw value 2*1 - 1 = 1.0, so channel[i] === envelope.
        const n = 64;
        const arr = fillDecayNoise(new Float32Array(n), 2.0, () => 1);

        // First element: (1 - 0/n)^2 = 1.
        expect(arr[0]).toBeCloseTo(1.0, 6);
        // Last element approaches 0.
        expect(arr[n - 1]).toBeCloseTo(0, 2);

        // Each value must be <= the previous one (envelope only falls).
        for (let i = 1; i < n; i++) {
            expect(arr[i]).toBeLessThanOrEqual(arr[i - 1]);
        }
    });

    it('yields all zeros when noise is centered (randomFn => 0.5 -> raw 0)', () => {
        const arr = fillDecayNoise(new Float32Array(32), 2.0, () => 0.5);
        for (let i = 0; i < arr.length; i++) {
            expect(arr[i]).toBe(0);
        }
    });

    it('keeps every sample within [-1, 1] with a real random source', () => {
        const arr = fillDecayNoise(new Float32Array(2048), 2.0, Math.random);
        for (let i = 0; i < arr.length; i++) {
            expect(arr[i]).toBeGreaterThanOrEqual(-1);
            expect(arr[i]).toBeLessThanOrEqual(1);
        }
    });

    it('falls off faster for a larger decay exponent at the same mid index', () => {
        const n = 128;
        const mid = n / 2;
        const slow = fillDecayNoise(new Float32Array(n), 2, () => 1);
        const fast = fillDecayNoise(new Float32Array(n), 8, () => 1);
        // With raw value fixed at 1.0, the sample equals the envelope, so a
        // larger decay must yield a strictly smaller value at the midpoint.
        expect(fast[mid]).toBeLessThan(slow[mid]);
    });
});

describe('buildImpulseResponse', () => {
    const makeFakeCtx = (sampleRate) => ({
        sampleRate,
        createBuffer: (ch, len, sr) => ({
            numberOfChannels: ch,
            sampleRate: sr,
            length: len,
            _data: Array.from({ length: ch }, () => new Float32Array(len)),
            getChannelData(i) { return this._data[i]; }
        })
    });

    it('sizes the buffer to floor(sampleRate * seconds) and uses 2 channels', () => {
        const ctx = makeFakeCtx(100);
        const buffer = buildImpulseResponse(ctx, 2.0);
        expect(buffer.numberOfChannels).toBe(2);
        expect(buffer.getChannelData(0).length).toBe(Math.floor(100 * 2.0)); // 200
        expect(buffer.getChannelData(1).length).toBe(200);
    });

    it('fills both channels with non-zero decaying noise (real random)', () => {
        const ctx = makeFakeCtx(100);
        const buffer = buildImpulseResponse(ctx, 2.0);
        const anyNonZero = (data) => Array.from(data).some(v => v !== 0);
        expect(anyNonZero(buffer.getChannelData(0))).toBe(true);
        expect(anyNonZero(buffer.getChannelData(1))).toBe(true);
    });
});
