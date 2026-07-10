/**
 * Synthetic impulse-response generator for the reverb ConvolverNode.
 *
 * The IR is generated entirely in code (exponentially decaying filtered noise)
 * so the app ships no binary audio asset and stays offline-first. The
 * buffer-filling math lives in a pure helper (`fillDecayNoise`) that takes an
 * injectable random source, so it is deterministic and testable without a real
 * AudioContext.
 */

/**
 * Fills a channel's sample array with white noise shaped by an exponential
 * decay envelope, producing a natural-sounding reverb tail.
 *
 * The envelope is `(1 - i/n)^decay`: it starts at 1.0 and falls monotonically
 * to 0.0 across the buffer. Larger `decay` values fall off faster (shorter
 * perceived tail).
 *
 * @param {Float32Array|number[]} channelData destination sample array (filled in place)
 * @param {number} decay envelope exponent (> 0); larger = faster falloff
 * @param {() => number} [randomFn] returns a value in [0, 1); injectable for tests
 * @returns {Float32Array|number[]} the same array, filled
 */
export function fillDecayNoise(channelData, decay = 2.0, randomFn = Math.random) {
    const n = channelData.length;
    for (let i = 0; i < n; i++) {
        // White noise in [-1, 1) scaled by a decaying envelope in [0, 1].
        const envelope = Math.pow(1 - i / n, decay);
        channelData[i] = (randomFn() * 2 - 1) * envelope;
    }
    return channelData;
}

/**
 * Builds a stereo reverb impulse response as an AudioBuffer.
 *
 * @param {BaseAudioContext} ctx the audio context (provides sampleRate + createBuffer)
 * @param {number} [seconds] tail length in seconds
 * @param {number} [decay] envelope exponent (> 0); larger = faster falloff
 * @returns {AudioBuffer}
 */
export function buildImpulseResponse(ctx, seconds = 2.0, decay = 2.0) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        fillDecayNoise(buffer.getChannelData(channel), decay);
    }
    return buffer;
}
