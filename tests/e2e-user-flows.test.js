// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWebAudioMock, MockAudioContext, MockAudioBuffer } from './helpers/mock-web-audio.js';
import { AudioEngine } from '../js/audio-engine.js';
import { AIManager, parsePromptToDSP } from '../js/ai-manager.js';
import { TRANSLATIONS, t, applyI18n } from '../js/i18n.js';

describe('End-to-End User Flows (Ground Truth Simulator)', () => {
    let audio;
    let ai;

    beforeEach(() => {
        setupWebAudioMock();
        audio = new AudioEngine();
        ai = new AIManager();
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        if (audio.core && audio.core.schedulerIntervalId) {
            clearInterval(audio.core.schedulerIntervalId);
        }
    });

    // -------------------------------------------------------------------------
    // Flow 1: Complete App Lifecycle: Boot -> Audio Context -> Initial Groove
    // -------------------------------------------------------------------------
    it('Flow 1: boots system, initializes Web Audio API, and renders default groove', async () => {
        // 1. Initialize Audio Engine
        await audio.initialize();
        expect(audio.ctx).toBeInstanceOf(MockAudioContext);
        expect(audio.ctx.state).toBe('running');
        expect(audio.core).toBeDefined();
        expect(audio.outputNode).toBeDefined();

        // 2. Initial state configuration (AP-808 Default Groove)
        const initialState = {
            meta: { bpm: 120, scale: "Am", energy: 0.6 },
            dsp_graph: {
                drums: {
                    use_custom_sample: false,
                    sample_name: "",
                    kick_pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
                    hihat_pattern: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1]
                },
                synth_lead: {
                    wave_type: "saw",
                    filter_cutoff_hz: 2000,
                    filter_resonance: 2.5,
                    adsr: [0.01, 0.15, 0.7, 0.2],
                    notes_sequence: [57, 60, 64, 67, 64, 60, 57, 0, 57, 60, 64, 67, 64, 60, 55, 0]
                },
                effects: {
                    delay_feedback: 0.3,
                    reverb_mix: 0.15
                }
            }
        };

        // 3. Render default graph
        audio.renderGraph(initialState);

        // Ground truth verifications on the running virtual renderer
        expect(audio.core.bpm).toBe(120);
        expect(audio.core.synthWaveType).toBe('saw');
        expect(audio.core.filterResonance).toBe(2.5);
        expect(audio.core.kickPattern).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0]);
        expect(audio.core.hihatPattern).toEqual([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1]);
        expect(audio.core.synthSequence).toHaveLength(16);
        expect(audio.core.isPlaying).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Flow 2: Multi-Turn Multilingual Live Jam Session (ES -> EN -> PT -> Climax)
    // -------------------------------------------------------------------------
    it('Flow 2: executes a multi-step conversational jam session across 3 languages with cumulative layer preservation', async () => {
        await audio.initialize();
        await ai.initialize();

        let state = {
            meta: { bpm: 120, scale: "Am", energy: 0.6 },
            dsp_graph: {
                drums: {
                    use_custom_sample: false,
                    sample_name: "",
                    kick_pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
                    hihat_pattern: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1]
                },
                synth_lead: {
                    wave_type: "saw",
                    filter_cutoff_hz: 2000,
                    filter_resonance: 2.5,
                    adsr: [0.01, 0.15, 0.7, 0.2],
                    notes_sequence: [57, 60, 64, 67, 64, 60, 57, 0, 57, 60, 64, 67, 64, 60, 55, 0]
                },
                effects: {
                    delay_feedback: 0.3,
                    reverb_mix: 0.15
                }
            }
        };

        // Turn 1 (Spanish): Switch to dark techno at 134 bpm with low cutoff
        const prompt1 = "estilo techno berghain a 134 bpm con filtro bajo y oscuro";
        state = await ai.generateDSPConfig(prompt1, state);
        audio.renderGraph(state);

        expect(state.meta.bpm).toBe(134);
        expect(state.dsp_graph.synth_lead.filter_cutoff_hz).toBe(600);
        expect(state.dsp_graph.synth_lead.wave_type).toBe('saw');
        expect(audio.core.bpm).toBe(134);
        expect(audio.core.kickPattern).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);

        // Turn 2 (English): Add heavy delay and switch to retro square wave
        // Invariant: BPM (134) and dark techno drum pattern MUST be preserved!
        const prompt2 = "add heavy delay and use a retro square wave";
        state = await ai.generateDSPConfig(prompt2, state);
        audio.renderGraph(state);

        expect(state.meta.bpm).toBe(134); // Preserved
        expect(state.dsp_graph.effects.delay_feedback).toBeGreaterThan(0.5); // Mutated
        expect(state.dsp_graph.synth_lead.wave_type).toBe('square'); // Mutated
        expect(state.dsp_graph.drums.kick_pattern).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]); // Preserved
        expect(audio.core.synthWaveType).toBe('square');

        // Turn 3 (Portuguese): Mute kick and change key to D minor
        // Invariant: Delay feedback and Square wave MUST be preserved!
        const prompt3 = "tira o bumbo e muda a escala para ré menor";
        state = await ai.generateDSPConfig(prompt3, state);
        audio.renderGraph(state);

        expect(state.meta.scale).toBe('Dm'); // Mutated
        expect(state.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true); // Muted
        expect(state.dsp_graph.drums.hihat_pattern.some(v => v === 1)).toBe(true); // Hi-hats still playing
        expect(state.dsp_graph.effects.delay_feedback).toBeGreaterThan(0.5); // Preserved
        expect(state.dsp_graph.synth_lead.wave_type).toBe('square'); // Preserved
        expect(state.dsp_graph.synth_lead.notes_sequence[0]).toBe(62); // Root D

        // Turn 4 (Climax Drop): Massive drop with 16th hats, saw wave, and wide open filter
        const prompt4 = "haz un drop potente";
        state = await ai.generateDSPConfig(prompt4, state);
        audio.renderGraph(state);

        expect(state.dsp_graph.drums.kick_pattern[0]).toBe(1); // Kick returned
        expect(state.dsp_graph.drums.hihat_pattern).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]); // Fast hats
        expect(state.dsp_graph.synth_lead.filter_cutoff_hz).toBe(4500); // Filter opened
        expect(state.dsp_graph.synth_lead.wave_type).toBe('saw');
        expect(audio.core.synthWaveType).toBe('saw');
    });

    // -------------------------------------------------------------------------
    // Flow 3: Physical Hardware Controls & Real-Time Parameter Override
    // -------------------------------------------------------------------------
    it('Flow 3: validates hardware faders and transport controls affect live engine immediately', async () => {
        await audio.initialize();
        audio.renderGraph({
            meta: { bpm: 120, scale: "Am", energy: 0.6 },
            dsp_graph: {
                drums: { kick_pattern: [1, 0, 0, 0], hihat_pattern: [0, 1, 0, 1] },
                synth_lead: { wave_type: 'saw', filter_cutoff_hz: 2000, filter_resonance: 2.0, adsr: [0.01, 0.1, 0.5, 0.2], notes_sequence: [60] },
                effects: { delay_feedback: 0.3, reverb_mix: 0.15 }
            }
        });

        // 1. Volume slider adjustment
        audio.manualVolume = 0.45;
        expect(audio.manualVolume).toBe(0.45);
        expect(audio.core.outputNode.gain.value).toBe(0.45);

        // 2. Cutoff slider adjustment
        audio.manualCutoff = 1450;
        expect(audio.manualCutoff).toBe(1450);
        expect(audio.core.cutoffFrequency).toBe(1450);

        // 3. Loop Length adjustment (4-step, 8-step, 16-step)
        audio.loopLength = 8;
        expect(audio.loopLength).toBe(8);
        expect(audio.core.loopLength).toBe(8);

        // 4. Transport Play / Pause toggle
        expect(audio.isPlaying).toBe(true);
        audio.pause();
        expect(audio.isPlaying).toBe(false);
        expect(audio.core.isPlaying).toBe(false);

        audio.play();
        expect(audio.isPlaying).toBe(true);
        expect(audio.core.isPlaying).toBe(true);

        const toggleResult = audio.togglePlay();
        expect(toggleResult).toBe(false);
        expect(audio.isPlaying).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Flow 4: Track Muting, Soloing, and Pattern Restoration Memory
    // -------------------------------------------------------------------------
    it('Flow 4: mutes and un-mutes individual channels without destroying underlying rhythm patterns', async () => {
        await audio.initialize();
        const initialKick = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0];
        const initialHats = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1];
        
        let state = parsePromptToDSP("estilo techno a 130 bpm");
        expect(state.dsp_graph.drums.kick_pattern.some(v => v === 1)).toBe(true);

        // Save pattern for memory restoration
        const savedKick = [...state.dsp_graph.drums.kick_pattern];

        // Mute Kick via prompt
        state = parsePromptToDSP("sin bombo", state);
        expect(state.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
        expect(state.dsp_graph.drums.hihat_pattern.some(v => v === 1)).toBe(true); // Hats intact

        // Unmute Kick via prompt
        state = parsePromptToDSP("con bombo", state);
        expect(state.dsp_graph.drums.kick_pattern.some(v => v === 1)).toBe(true);
        expect(state.dsp_graph.drums.hihat_pattern.some(v => v === 1)).toBe(true);

        // Mute whole percussion section
        state = parsePromptToDSP("solo synth y sin bateria", state);
        expect(state.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
        expect(state.dsp_graph.drums.hihat_pattern.every(v => v === 0)).toBe(true);
        expect(state.dsp_graph.synth_lead.notes_sequence.some(v => v > 0)).toBe(true); // Synth intact

        // Restore drums
        state = parsePromptToDSP("agrega bateria", state);
        expect(state.dsp_graph.drums.kick_pattern.some(v => v === 1)).toBe(true);
        expect(state.dsp_graph.drums.hihat_pattern.some(v => v === 1)).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Flow 5: Mechanical 3-Way Language Selector & DOM Translation Synchronization
    // -------------------------------------------------------------------------
    it('Flow 5: switches languages dynamically [EN | ES | PT] and updates localized UI without interrupting audio', async () => {
        // Set up test DOM elements mimicking index.html
        document.body.innerHTML = `
            <div id="status-gpu"></div>
            <div id="status-audio"></div>
            <div id="val-vol">80%</div>
            <div id="val-cutoff">2000 Hz</div>
            <div id="val-len">16 PASOS</div>
            <button id="btn-play"><span class="btn-text">PAUSA</span></button>
            <button id="btn-record"><span class="btn-text">REC MIX</span></button>
            <div class="lang-switch-bank">
                <button class="lang-btn" data-lang="en"></button>
                <button class="lang-btn active" data-lang="es"></button>
                <button class="lang-btn" data-lang="pt"></button>
            </div>
            <span data-i18n="fader_vol">VOLUMEN</span>
            <span data-i18n="fader_cutoff">FREC CORTE</span>
        `;

        // 1. Initial State: Spanish
        expect(t('fader_vol', 'es')).toBe('VOLUMEN');
        expect(t('fader_cutoff', 'es')).toBe('CORTE');

        // 2. Switch to English
        applyI18n('en');
        expect(document.querySelector('[data-i18n="fader_vol"]').textContent).toBe('VOLUME');
        expect(document.querySelector('[data-i18n="fader_cutoff"]').textContent).toBe('CUTOFF');
        expect(t('transport_pause', 'en')).toBe('PAUSE');
        expect(t('scale_minor', 'en')).toBe('minor');

        // 3. Switch to Portuguese
        applyI18n('pt');
        expect(document.querySelector('[data-i18n="fader_vol"]').textContent).toBe('VOLUME');
        expect(document.querySelector('[data-i18n="fader_cutoff"]').textContent).toBe('CORTE');
        expect(t('transport_pause', 'pt')).toBe('PAUSAR');
        expect(t('scale_minor', 'pt')).toBe('menor');

        // 4. Verify all presets have 3-language integrity
        ['es', 'en', 'pt'].forEach(lang => {
            const presets = TRANSLATIONS[lang].presets;
            expect(presets).toHaveLength(8);
            presets.forEach(p => {
                expect(p.id).toBeDefined();
                expect(p.label.length).toBeGreaterThan(0);
                expect(p.prompt.length).toBeGreaterThan(0);
            });
        });
    });

    // -------------------------------------------------------------------------
    // Flow 6: Progressive Morphing Transition Clock Execution
    // -------------------------------------------------------------------------
    it('Flow 6: initiates a progressive transition and steps through morphing clock', async () => {
        await audio.initialize();
        
        const transitionPrompt = "transición de 16 pasos a C mayor con explosion";
        const state = parsePromptToDSP(transitionPrompt);

        expect(state.transition).toBeDefined();
        expect(state.transition.active).toBe(true);
        expect(state.transition.total_steps).toBe(16);
        expect(state.transition.target_scale).toBe('C');
        expect(state.transition.drum_exploding).toBe(true);

        audio.renderGraph(state);
        expect(audio.core.transition).toEqual(state.transition);

        // Simulate 16 step clock iterations
        for (let step = 0; step < 16; step++) {
            audio.core.scheduleStep(step, audio.ctx.currentTime);
            audio.ctx.advanceTime(0.125); // Step advance
        }

        // Morph completed
        expect(audio.core.synthWaveType).toBeDefined();
    });

    // -------------------------------------------------------------------------
    // Flow 7: Session Recording & 16-Bit Stereo WAV Container Verification
    // -------------------------------------------------------------------------
    it('Flow 7: records audio stream, merges buffers, and produces valid standard 16-bit PCM WAV container', async () => {
        await audio.initialize();
        
        // Start recording
        audio.toggleRecording(true);
        expect(audio.isRecording).toBe(true);
        expect(audio.recordingProcessor).toBeDefined();

        // Simulate audio frames from audio process event
        const sampleCount = 512;
        const leftChannel = new Float32Array(sampleCount);
        const rightChannel = new Float32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
            leftChannel[i] = Math.sin((i / sampleCount) * Math.PI * 2) * 0.8;
            rightChannel[i] = Math.cos((i / sampleCount) * Math.PI * 2) * 0.8;
        }

        audio.recordingProcessor.simulateProcess({
            getChannelData: (c) => (c === 0 ? leftChannel : rightChannel)
        });

        expect(audio.recordingLength).toBe(sampleCount);
        expect(audio.recordingBuffersL).toHaveLength(1);

        // Stop recording and verify encodeWAV
        const mergedL = audio.mergeBuffers(audio.recordingBuffersL, audio.recordingLength);
        const mergedR = audio.mergeBuffers(audio.recordingBuffersR, audio.recordingLength);
        const wavBlob = audio.encodeWAV(mergedL, mergedR, audio.ctx.sampleRate);

        expect(wavBlob).toBeInstanceOf(Blob);
        expect(wavBlob.type).toBe('audio/wav');
        expect(wavBlob.size).toBe(44 + sampleCount * 2 * 2); // 44 byte header + stereo 16-bit PCM

        // Read binary header and verify RIFF / WAVE format specifications
        const arrayBuffer = await wavBlob.arrayBuffer();
        const dataView = new DataView(arrayBuffer);

        // 'RIFF' tag
        const riffTag = String.fromCharCode(dataView.getUint8(0), dataView.getUint8(1), dataView.getUint8(2), dataView.getUint8(3));
        expect(riffTag).toBe('RIFF');

        // 'WAVE' tag
        const waveTag = String.fromCharCode(dataView.getUint8(8), dataView.getUint8(9), dataView.getUint8(10), dataView.getUint8(11));
        expect(waveTag).toBe('WAVE');

        // 'fmt ' chunk
        const fmtTag = String.fromCharCode(dataView.getUint8(12), dataView.getUint8(13), dataView.getUint8(14), dataView.getUint8(15));
        expect(fmtTag).toBe('fmt ');

        // Audio Format = 1 (PCM)
        expect(dataView.getUint16(20, true)).toBe(1);
        // Channels = 2 (Stereo)
        expect(dataView.getUint16(22, true)).toBe(2);
        // Sample Rate = 44100
        expect(dataView.getUint32(24, true)).toBe(44100);
        // Bits per sample = 16
        expect(dataView.getUint16(34, true)).toBe(16);

        // 'data' chunk
        const dataTag = String.fromCharCode(dataView.getUint8(36), dataView.getUint8(37), dataView.getUint8(38), dataView.getUint8(39));
        expect(dataTag).toBe('data');
        expect(dataView.getUint32(40, true)).toBe(sampleCount * 4);
    });

    // -------------------------------------------------------------------------
    // Flow 8: Virtual Sample Registration & Custom Flash Playback
    // -------------------------------------------------------------------------
    it('Flow 8: registers custom audio sample in virtual filesystem and routes playback through sample flash node', async () => {
        await audio.initialize();

        // 1. Create and register a custom synthetic kick sample
        const customBuffer = new MockAudioBuffer(2, 4410, 44100);
        audio.registerSample('bombo_analogo_808', customBuffer);

        expect(audio.loadedSamples['bombo_analogo_808']).toBe(customBuffer);
        expect(audio.core.samples['bombo_analogo_808']).toBe(customBuffer);

        // 2. Parse user prompt referencing the loaded sample
        const prompt = "usa el sample bombo_analogo_808 a 128 bpm";
        const state = parsePromptToDSP(prompt);

        expect(state.dsp_graph.drums.use_custom_sample).toBe(true);
        expect(state.dsp_graph.drums.sample_name).toBe('bombo_analogo_808');

        // 3. Render graph and ensure core updates custom sample routing
        audio.renderGraph(state);
        expect(audio.core.useCustomSample).toBe(true);
        expect(audio.core.sampleName).toBe('bombo_analogo_808');
    });
});
