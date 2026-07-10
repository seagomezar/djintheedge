import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebRenderer } from '../js/lib/elementary-renderer.js';

describe('WebRenderer simulation', () => {
    let renderer;

    beforeEach(() => {
        renderer = new WebRenderer();
    });

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

    it('render() applies meta, tracks, and effects from the track config', () => {
        renderer.render(trackConfig());
        expect(renderer.bpm).toBe(128);
        expect(renderer.loopLength).toBe(4);
        expect(renderer.tracks).toHaveLength(3);
        expect(renderer.tracks.map(t => t.id)).toEqual(['kick', 'hats', 'lead']);
        expect(renderer.delayFeedback).toBe(0.4);
    });

    it('scheduler schedules N track voices; muted tracks produce none', () => {
        const cfg = trackConfig();
        cfg.tracks[2].muted = true; // mute the lead

        // Fake the audio context enough to observe which voices fire.
        const fired = [];
        renderer.ctx = { currentTime: 0 };
        renderer.samples = {};
        renderer.playSyntheticKick = () => fired.push('kick');
        renderer.playSyntheticHihat = () => fired.push('hihat');
        renderer.playSynthNote = () => fired.push('synth');
        renderer.render(cfg);

        // Step 0: kick pattern[0]=1 fires; hats[0]=0; lead muted.
        renderer.scheduleStep(0, 0);
        expect(fired).toEqual(['kick']);

        // Step 2: hats[2]=1 fires; lead still muted -> no synth voice.
        fired.length = 0;
        renderer.scheduleStep(2, 0);
        expect(fired).toEqual(['hihat']);
    });

    it('scheduler plays synth notes for unmuted synth tracks', () => {
        const cfg = trackConfig();
        const fired = [];
        renderer.ctx = { currentTime: 0 };
        renderer.samples = {};
        renderer.playSyntheticKick = () => fired.push('kick');
        renderer.playSyntheticHihat = () => fired.push('hihat');
        renderer.playSynthNote = (n) => fired.push('synth:' + n);
        renderer.render(cfg);

        // Step 0: kick fires and lead note 60 plays.
        renderer.scheduleStep(0, 0);
        expect(fired).toContain('kick');
        expect(fired).toContain('synth:60');
    });
});

describe('NLP Semantic Parser (track-array contract)', () => {
    const findTrack = (cfg, id) => cfg.tracks.find(t => t.id === id);
    const lead = (cfg) => findTrack(cfg, 'lead') || cfg.tracks.find(t => t.type === 'synth');

    it('should parse BPM, wave type, and filter into the lead track', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');

        const r1 = parsePromptToDSP("make a fast synthwave beat at 135 bpm with low filter");
        expect(r1.meta.bpm).toBe(135);
        expect(lead(r1).wave_type).toBe('saw');
        expect(lead(r1).filter_cutoff_hz).toBe(600);

        const r2 = parsePromptToDSP("ritmo lento a 95 bpm con soft sine");
        expect(r2.meta.bpm).toBe(95);
        expect(lead(r2).wave_type).toBe('cycle');
    });

    it('should conform to the track-array schema with a default template', async () => {
        const { parsePromptToDSP, DEFAULT_LOOP_STEPS } = await import('../js/ai-manager.js');
        const cfg = parsePromptToDSP("house groove");
        expect(Array.isArray(cfg.tracks)).toBe(true);
        expect(cfg.meta.loop_steps).toBe(DEFAULT_LOOP_STEPS);
        for (const t of cfg.tracks) {
            expect(typeof t.id).toBe('string');
            if (t.type === 'drum') expect(t.pattern).toHaveLength(cfg.meta.loop_steps);
            else expect(t.notes).toHaveLength(cfg.meta.loop_steps);
        }
    });

    it('should clamp loop_steps to 4-64', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const big = parsePromptToDSP("128 step loop");
        expect(big.meta.loop_steps).toBe(64);
        const tiny = parsePromptToDSP("2 step loop");
        expect(tiny.meta.loop_steps).toBe(4);
    });

    it('additive: "add a bassline" adds one synth track, leaves others identical', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const base = parsePromptToDSP("techno at 128 bpm");
        const before = JSON.stringify(base.tracks);

        const withBass = parsePromptToDSP("add a bassline", base);
        expect(withBass.tracks.length).toBe(base.tracks.length + 1);
        expect(findTrack(withBass, 'bass')).toBeTruthy();
        expect(findTrack(withBass, 'bass').type).toBe('synth');
        // Pre-existing tracks are byte-identical.
        const keptBefore = base.tracks.map(t => t.id);
        const kept = withBass.tracks.filter(t => keptBefore.includes(t.id));
        expect(JSON.stringify(kept)).toBe(before);
    });

    it('edit: "make the hats faster" changes only the hats track', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const base = parsePromptToDSP("techno at 128 bpm");
        const kickBefore = JSON.stringify(findTrack(base, 'kick'));
        const leadBefore = JSON.stringify(lead(base));

        const edited = parsePromptToDSP("make the hats faster", base);
        expect(JSON.stringify(findTrack(edited, 'kick'))).toBe(kickBefore);
        expect(JSON.stringify(lead(edited))).toBe(leadBefore);
        expect(JSON.stringify(findTrack(edited, 'hats'))).not.toBe(JSON.stringify(findTrack(base, 'hats')));
    });

    it('mute: "mute the lead" sets only that flag', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const base = parsePromptToDSP("techno");
        const muted = parsePromptToDSP("mute the lead", base);
        expect(lead(muted).muted).toBe(true);
        expect(findTrack(muted, 'kick').muted).toBe(false);
    });

    it('remove: "remove the lead" drops the track', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const base = parsePromptToDSP("techno");
        const removed = parsePromptToDSP("remove the lead", base);
        expect(findTrack(removed, 'lead')).toBeUndefined();
    });

    it('full-replace: "start over" produces a fresh template', async () => {
        const { parsePromptToDSP, DEFAULT_LOOP_STEPS } = await import('../js/ai-manager.js');
        const base = parsePromptToDSP("techno at 180 bpm");
        const fresh = parsePromptToDSP("start over", base);
        expect(fresh.meta.bpm).toBe(120);
        expect(fresh.meta.loop_steps).toBe(DEFAULT_LOOP_STEPS);
        expect(fresh.tracks.map(t => t.id).sort()).toEqual(['hats', 'kick', 'lead']);
    });

    it('gibberish returns the current state unchanged', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const base = parsePromptToDSP("techno at 128 bpm");
        const after = parsePromptToDSP("asdf qwerty zxcv", base);
        expect(JSON.stringify(after)).toBe(JSON.stringify(base));
    });

    it('accumulates state: unmentioned params persist', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const base = parsePromptToDSP("fast dark synthwave at 140 bpm");
        expect(base.meta.bpm).toBe(140);
        const next = parsePromptToDSP("make it darker with low filter", base);
        expect(next.meta.bpm).toBe(140);
        expect(lead(next).filter_cutoff_hz).toBe(600);
    });

    it('null/malformed currentState yields a valid default template', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const fromNull = parsePromptToDSP("add delay", null);
        expect(Array.isArray(fromNull.tracks)).toBe(true);
        const fromFlat = parsePromptToDSP("add delay", { meta: { bpm: 100 }, dsp_graph: {} });
        expect(Array.isArray(fromFlat.tracks)).toBe(true);
    });

    it('defaults effects.sidechain to 0 on a fresh config', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const cfg = parsePromptToDSP("house groove");
        expect(cfg.effects.sidechain).toBe(0);
    });

    it('"add sidechain pumping" sets effects.sidechain to 0.7', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const cfg = parsePromptToDSP("add sidechain pumping");
        expect(cfg.effects.sidechain).toBe(0.7);
    });

    it('"light sidechain" sets effects.sidechain to 0.4', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const cfg = parsePromptToDSP("light sidechain");
        expect(cfg.effects.sidechain).toBe(0.4);
    });

    it('"no sidechain" turns sidechain off on a prior pumping state', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        const base = parsePromptToDSP("add sidechain pumping");
        expect(base.effects.sidechain).toBe(0.7);
        const off = parsePromptToDSP("no sidechain", base);
        expect(off.effects.sidechain).toBe(0);
    });
});

describe('WebRenderer reverb chain', () => {
    let renderer;

    // A parameter stub exposing the automation methods the renderer calls, with
    // spies so assertions can inspect scheduled values.
    const makeParam = () => ({
        value: 0,
        setValueAtTime: vi.fn(function (v) { this.value = v; return this; }),
        setTargetAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
    });

    // A generic AudioNode stub covering every node the reverb/delay chain wires.
    const makeNode = () => ({
        connect: vi.fn(),
        gain: makeParam(),
        frequency: makeParam(),
        delayTime: makeParam(),
        Q: makeParam(),
        buffer: null,
    });

    // Full fake AudioContext that drives the real initialize() wiring.
    const makeFakeCtx = () => ({
        sampleRate: 100,
        currentTime: 0,
        createGain: vi.fn(() => makeNode()),
        createAnalyser: vi.fn(() => makeNode()),
        createDelay: vi.fn(() => makeNode()),
        createConvolver: vi.fn(() => makeNode()),
        createBuffer: vi.fn((ch, len, sr) => ({
            numberOfChannels: ch,
            length: len,
            sampleRate: sr,
            _data: Array.from({ length: ch }, () => new Float32Array(len)),
            getChannelData(i) { return this._data[i]; },
        })),
    });

    beforeEach(async () => {
        renderer = new WebRenderer();
        const ctx = makeFakeCtx();
        await renderer.initialize(ctx);
        // Stop the real setInterval clock so it never ticks during assertions.
        clearInterval(renderer.schedulerIntervalId);
    });

    it('builds and installs the reverb impulse response on the convolver', () => {
        expect(renderer.reverbNode).toBeTruthy();
        expect(renderer.reverbNode.buffer).toBeTruthy();
        expect(renderer.reverbWetNode).toBeTruthy();
        expect(renderer.reverbSendNode).toBeTruthy();
    });

    it('ramps the wet-return gain to config.effects.reverb_mix via setTargetAtTime', () => {
        renderer.render({
            meta: { bpm: 120, loop_steps: 4 },
            tracks: [],
            effects: { delay_feedback: 0.3, reverb_mix: 0.4 },
        });
        expect(renderer.reverbWetNode.gain.setTargetAtTime).toHaveBeenCalled();
        const [value] = renderer.reverbWetNode.gain.setTargetAtTime.mock.calls[0];
        expect(value).toBe(0.4);
        expect(renderer.reverbMix).toBe(0.4);
    });

    it('ramps the wet-return gain to 0 when reverb_mix is 0 (fully dry)', () => {
        renderer.render({
            meta: { bpm: 120, loop_steps: 4 },
            tracks: [],
            effects: { delay_feedback: 0.3, reverb_mix: 0 },
        });
        expect(renderer.reverbWetNode.gain.setTargetAtTime).toHaveBeenCalled();
        const [value] = renderer.reverbWetNode.gain.setTargetAtTime.mock.calls[0];
        expect(value).toBe(0);
        expect(renderer.reverbMix).toBe(0);
    });

    it('connectVoice routes each voice to the dry, delay, and reverb sends', () => {
        const voiceGain = { connect: vi.fn() };
        renderer.connectVoice(voiceGain);
        expect(voiceGain.connect).toHaveBeenCalledWith(renderer.delayDryNode);
        expect(voiceGain.connect).toHaveBeenCalledWith(renderer.delayNode);
        expect(voiceGain.connect).toHaveBeenCalledWith(renderer.reverbSendNode);
    });

    it('builds the synth bus and routes it to the dry, delay, and reverb sends', () => {
        // initialize() creates synthBusNode and wires it via connectVoice, so it
        // must be connected to the same three sends every voice reaches.
        expect(renderer.synthBusNode).toBeTruthy();
        expect(renderer.synthBusNode.connect).toHaveBeenCalledWith(renderer.delayDryNode);
        expect(renderer.synthBusNode.connect).toHaveBeenCalledWith(renderer.delayNode);
        expect(renderer.synthBusNode.connect).toHaveBeenCalledWith(renderer.reverbSendNode);
    });

    it('render() sets sidechainDepth from config.effects.sidechain', () => {
        renderer.render({
            meta: { bpm: 120, loop_steps: 4 },
            tracks: [],
            effects: { delay_feedback: 0.3, reverb_mix: 0.15, sidechain: 0.7 },
        });
        expect(renderer.sidechainDepth).toBe(0.7);
    });

    it('connectSynthVoice routes a synth voice into the synth bus', () => {
        const voiceGain = { connect: vi.fn() };
        renderer.connectSynthVoice(voiceGain);
        expect(voiceGain.connect).toHaveBeenCalledWith(renderer.synthBusNode);
    });

    it('triggerSidechainDuck dips the bus to (1-depth) and ramps back to unity', () => {
        renderer.sidechainDepth = 0.7;
        const gain = renderer.synthBusNode.gain;
        gain.setValueAtTime.mockClear();
        gain.linearRampToValueAtTime.mockClear();
        gain.cancelScheduledValues.mockClear();

        renderer.triggerSidechainDuck(0, 0.1);

        expect(gain.cancelScheduledValues).toHaveBeenCalledWith(0);
        // Immediate dip to 1 - 0.7 = 0.3 at the kick onset.
        expect(gain.setValueAtTime).toHaveBeenCalledTimes(1);
        const [dipValue, dipTime] = gain.setValueAtTime.mock.calls[0];
        expect(dipValue).toBeCloseTo(0.3, 10);
        expect(dipTime).toBe(0);
        // Linear release back toward unity over 80% of the step (0.1 * 0.8).
        expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
        const [rampValue, rampTime] = gain.linearRampToValueAtTime.mock.calls[0];
        expect(rampValue).toBe(1.0);
        expect(rampTime).toBeCloseTo(0.08, 10);
    });

    it('triggerSidechainDuck schedules nothing when sidechainDepth is 0', () => {
        renderer.sidechainDepth = 0;
        const gain = renderer.synthBusNode.gain;
        gain.setValueAtTime.mockClear();
        gain.linearRampToValueAtTime.mockClear();
        gain.cancelScheduledValues.mockClear();

        renderer.triggerSidechainDuck(0, 0.1);

        expect(gain.setValueAtTime).not.toHaveBeenCalled();
        expect(gain.linearRampToValueAtTime).not.toHaveBeenCalled();
        expect(gain.cancelScheduledValues).not.toHaveBeenCalled();
    });

    it('scheduleStep ducks the synth bus when a kick fires with sidechain on', () => {
        renderer.render({
            meta: { bpm: 120, loop_steps: 4 },
            tracks: [
                { id: 'kick', type: 'drum', role: 'kick', muted: false, pattern: [1, 0, 0, 0], sample_name: null },
            ],
            effects: { delay_feedback: 0.3, reverb_mix: 0.15, sidechain: 0.7 },
        });
        // Silence voice synthesis so the test isolates the sidechain scheduling.
        renderer.playSyntheticKick = () => {};
        renderer.playSyntheticHihat = () => {};
        renderer.playSynthNote = () => {};

        const gain = renderer.synthBusNode.gain;
        gain.setValueAtTime.mockClear();

        // Step 0: kick pattern[0]=1 fires and must trigger the duck.
        renderer.scheduleStep(0, 0);

        expect(gain.setValueAtTime).toHaveBeenCalledTimes(1);
        const [dipValue] = gain.setValueAtTime.mock.calls[0];
        expect(dipValue).toBeCloseTo(0.3, 10);
    });
});

describe('AudioEngine WAV encoding (pure)', () => {
    let engine;

    beforeEach(async () => {
        const { AudioEngine } = await import('../js/audio-engine.js');
        engine = new AudioEngine();
    });

    it('mergeBuffers concatenates Float32Array chunks in order', () => {
        const a = new Float32Array([0.1, 0.2]);
        const b = new Float32Array([0.3, 0.4, 0.5]);
        const merged = engine.mergeBuffers([a, b], 5);
        expect(merged).toBeInstanceOf(Float32Array);
        expect(merged.length).toBe(5);
        expect(Array.from(merged)).toEqual(
            [0.1, 0.2, 0.3, 0.4, 0.5].map(v => Math.fround(v))
        );
    });

    it('encodeWAV returns an audio/wav Blob sized 44 + N*4 bytes', () => {
        const N = 8;
        const samplesL = new Float32Array(N).fill(0.5);
        const samplesR = new Float32Array(N).fill(-0.5);
        const blob = engine.encodeWAV(samplesL, samplesR, 44100);
        expect(blob.type).toBe('audio/wav');
        // 44-byte header + N stereo frames * 4 bytes/frame (2 channels * 16-bit).
        expect(blob.size).toBe(44 + N * 4);
    });

    it('encodeWAV writes a RIFF/WAVE header with 2 channels, correct rate and data length', async () => {
        const N = 8;
        const sampleRate = 44100;
        const samplesL = new Float32Array(N).fill(0.25);
        const samplesR = new Float32Array(N).fill(-0.25);
        const blob = engine.encodeWAV(samplesL, samplesR, sampleRate);

        // Read the bytes back. Blob.arrayBuffer() exists in this env; guard so the
        // assertion stays robust if it ever isn't.
        expect(typeof blob.arrayBuffer).toBe('function');
        const buffer = await blob.arrayBuffer();
        const view = new DataView(buffer);
        const readString = (offset, len) =>
            String.fromCharCode(...Array.from({ length: len }, (_, i) => view.getUint8(offset + i)));

        expect(readString(0, 4)).toBe('RIFF');
        expect(readString(8, 4)).toBe('WAVE');
        expect(readString(12, 4)).toBe('fmt ');
        expect(view.getUint16(20, true)).toBe(1);          // PCM
        expect(view.getUint16(22, true)).toBe(2);          // stereo
        expect(view.getUint32(24, true)).toBe(sampleRate); // sample rate
        expect(view.getUint32(28, true)).toBe(sampleRate * 4); // byte rate
        expect(view.getUint16(32, true)).toBe(4);          // block align
        expect(view.getUint16(34, true)).toBe(16);         // bits per sample
        expect(readString(36, 4)).toBe('data');
        expect(view.getUint32(40, true)).toBe(N * 4);      // data chunk length
        // Total RIFF size field = 36 + data length.
        expect(view.getUint32(4, true)).toBe(36 + N * 4);
        expect(buffer.byteLength).toBe(44 + N * 4);
    });
});

describe('AIManager pipeline forwards currentState', () => {
    it('generateDSPConfig threads currentState to the parser', async () => {
        const { AIManager } = await import('../js/ai-manager.js');
        const ai = new AIManager();
        // No navigator.gpu in the test env, so initialize() installs the mock engine.
        await ai.initialize();

        const base = await ai.generateDSPConfig("techno at 128 bpm");
        expect(base.meta.bpm).toBe(128);

        // Prompt with no BPM token: before the fix this reset to the default 120.
        const next = await ai.generateDSPConfig("add heavy delay", base);
        expect(next.meta.bpm).toBe(128);
    });
});

