import { describe, it, expect, beforeEach, vi } from 'vitest';
import { el, Node } from '../js/lib/elementary-core.js';
import { WebRenderer } from '../js/lib/elementary-renderer.js';
import { AudioEngine } from '../js/audio-engine.js';

describe('Elementary Audio simulation core', () => {
    it('should construct node objects correctly', () => {
        const node = el.cycle(440);
        expect(node).toBeInstanceOf(Node);
        expect(node.type).toBe('cycle');
        expect(node.children[0]).toBeInstanceOf(Node);
        expect(node.children[0].type).toBe('const');
        expect(node.children[0].props.value).toBe(440);
    });

    it('should support multi-child structures', () => {
        const sum = el.add(el.noise(), el.cycle(220));
        expect(sum.type).toBe('add');
        expect(sum.children).toHaveLength(2);
        expect(sum.children[0].type).toBe('noise');
        expect(sum.children[1].type).toBe('cycle');
    });
});

describe('WebRenderer simulation', () => {
    let renderer;

    beforeEach(() => {
        renderer = new WebRenderer();
    });

    it('should find nodes by type recursively', () => {
        const root = el.mul(
            el.add(
                el.cycle(55),
                el.noise()
            ),
            el.sm(0.8)
        );

        const cycles = renderer.findNodesByType(root, 'cycle');
        expect(cycles).toHaveLength(1);
        expect(cycles[0].type).toBe('cycle');

        const noises = renderer.findNodesByType(root, 'noise');
        expect(noises).toHaveLength(1);

        const smooths = renderer.findNodesByType(root, 'sm');
        expect(smooths).toHaveLength(1);
        expect(smooths[0].props.value).toBe(0.8);
    });

    it('should parse graph configuration properties correctly', () => {
        // Construct mock graph similar to actual renderer
        const clock = el.metro({ bpm: 128 });
        const kickSeq = el.seq2({ seq: [1, 0, 0, 0], hold: false }, clock);
        const hihatSeq = el.seq2({ seq: [0, 0, 1, 0], hold: false }, clock);
        const noteSeq = el.seq2({ seq: [60, 62, 64, 60], hold: true }, clock);

        const synth = el.svf({ mode: 'lowpass', res: 2.5 }, el.mul(el.saw(110), el.adsr(0.01, 0.1, 0.5, 0.2, noteSeq)));
        const mix = el.add(kickSeq, hihatSeq, synth);

        renderer.render(mix, mix);

        expect(renderer.bpm).toBe(128);
        expect(renderer.kickPattern).toEqual([1, 0, 0, 0]);
        expect(renderer.hihatPattern).toEqual([0, 0, 1, 0]);
        expect(renderer.synthSequence).toEqual([60, 62, 64, 60]);
        expect(renderer.filterResonance).toBe(2.5);
        expect(renderer.synthWaveType).toBe('saw');
    });
});

describe('NLP Semantic Parser fallback', () => {
    // Import helper dynamically or since we imported it:
    // Wait, let's verify we import it at the top or do it locally
    it('should parse BPM and other details from simple statements', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        
        const result1 = parsePromptToDSP("make a fast synthwave beat at 135 bpm with low filter");
        expect(result1.meta.bpm).toBe(135);
        expect(result1.dsp_graph.synth_lead.wave_type).toBe('saw');
        expect(result1.dsp_graph.synth_lead.filter_cutoff_hz).toBe(600);

        const result2 = parsePromptToDSP("ritmo lento a 95 bpm con soft sine");
        expect(result2.meta.bpm).toBe(95);
        expect(result2.dsp_graph.synth_lead.wave_type).toBe('cycle');

        const result3 = parsePromptToDSP("usa el sample bombo_808");
        expect(result3.dsp_graph.drums.use_custom_sample).toBe(true);
        expect(result3.dsp_graph.drums.sample_name).toBe("bombo_808");
    });

    it('should accumulate and preserve state across multiple prompts', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');
        
        // Step 1: Set BPM to 142
        const state1 = parsePromptToDSP("pon el tempo en 142 bpm");
        expect(state1.meta.bpm).toBe(142);

        // Step 2: Add heavy delay, passing state1
        const state2 = parsePromptToDSP("mucho delay", state1);
        expect(state2.meta.bpm).toBe(142); // BPM MUST be preserved!
        expect(state2.dsp_graph.effects.delay_feedback).toBeGreaterThan(0.5);

        // Step 3: Mute drums, passing state2
        const state3 = parsePromptToDSP("quita la bateria", state2);
        expect(state3.meta.bpm).toBe(142); // BPM preserved
        expect(state3.dsp_graph.effects.delay_feedback).toBe(state2.dsp_graph.effects.delay_feedback); // Delay preserved
        expect(state3.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true); // Drums muted
        expect(state3.dsp_graph.drums.hihat_pattern.every(v => v === 0)).toBe(true);
    });

    it('should parse genres and apply stylistic musical templates', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');

        const techno = parsePromptToDSP("estilo techno berghain");
        expect(techno.meta.bpm).toBe(132);
        expect(techno.dsp_graph.synth_lead.wave_type).toBe('saw');
        expect(techno.dsp_graph.synth_lead.filter_cutoff_hz).toBe(1200);

        const ambient = parsePromptToDSP("musica ambient relajante");
        expect(ambient.meta.bpm).toBe(78);
        expect(ambient.dsp_graph.synth_lead.wave_type).toBe('cycle');
        expect(ambient.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
        expect(ambient.dsp_graph.effects.reverb_mix).toBeGreaterThan(0.4);
    });

    it('should parse Spanish solfege scale and square waveform', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');

        const doMayor = parsePromptToDSP("cambia la escala a do mayor con onda cuadrada retro");
        expect(doMayor.meta.scale).toBe('C');
        expect(doMayor.dsp_graph.synth_lead.wave_type).toBe('square');

        const reMenor = parsePromptToDSP("escala en re menor", doMayor);
        expect(reMenor.meta.scale).toBe('Dm');
        expect(reMenor.dsp_graph.synth_lead.wave_type).toBe('square'); // preserved
    });

    it('should handle relative adjustments in Spanish and English', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');

        const base = parsePromptToDSP("ritmo a 120 bpm");
        expect(base.meta.bpm).toBe(120);

        const faster = parsePromptToDSP("más rápido", base);
        expect(faster.meta.bpm).toBe(132);

        const slower = parsePromptToDSP("más lento", faster);
        expect(slower.meta.bpm).toBe(120);
    });

    it('should handle drop and transition specifications in prompts', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');

        const dropResult = parsePromptToDSP("haz un drop potente");
        expect(dropResult.dsp_graph.synth_lead.filter_cutoff_hz).toBe(4500);
        expect(dropResult.dsp_graph.synth_lead.wave_type).toBe('saw');

        const transitionResult = parsePromptToDSP("transición de 64 pasos a C mayor con explosion");
        expect(transitionResult.transition).not.toBeNull();
        expect(transitionResult.transition.active).toBe(true);
        expect(transitionResult.transition.total_steps).toBe(64);
        expect(transitionResult.transition.target_scale).toBe('C');
        expect(transitionResult.transition.drum_exploding).toBe(true);
    });

    it('should support muting and zeroing effects', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');

        const noFx = parsePromptToDSP("sin reverb y sin delay");
        expect(noFx.dsp_graph.effects.delay_feedback).toBe(0.0);
        expect(noFx.dsp_graph.effects.reverb_mix).toBe(0.0);
    });

    it('should generate variation when creative prompt is supplied', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');

        const base = parsePromptToDSP("algo bailable a 120 bpm");
        const variation = parsePromptToDSP("cambia la musica y haz algo diferente", base);
        expect(variation).toBeDefined();
        expect(variation.dsp_graph.synth_lead.notes_sequence).toBeDefined();
        expect(variation.dsp_graph.synth_lead.notes_sequence.length).toBe(16);
    });
});

describe('WebRenderer extensions (Square wave, Reverb, Cutoff, Transport)', () => {
    let renderer;

    beforeEach(() => {
        renderer = new WebRenderer();
    });

    it('should extract square wave and persistent cutoff from DSP graph', () => {
        const noteSeq = el.seq2({ seq: [60, 62], hold: true }, el.metro({ bpm: 120 }));
        const synth = el.svf({ mode: 'lowpass', cutoff: 850, res: 3.0 }, el.square(110));
        const reverbNode = el.reverb({ mix: 0.45 }, synth);

        renderer.render(reverbNode, reverbNode);

        expect(renderer.synthWaveType).toBe('square');
        expect(renderer.cutoffFrequency).toBe(850);
        expect(renderer.filterResonance).toBe(3.0);
        expect(renderer.reverbMix).toBe(0.45);
    });

    it('should toggle play and pause correctly', () => {
        expect(renderer.isPlaying).toBe(true);
        renderer.pause();
        expect(renderer.isPlaying).toBe(false);
        renderer.play();
        expect(renderer.isPlaying).toBe(true);
        renderer.togglePlay();
        expect(renderer.isPlaying).toBe(false);
    });
});

describe('Internationalization (i18n) Engine', () => {
    it('should have complete translation keys for es, en, and pt', async () => {
        const { TRANSLATIONS, t } = await import('../js/i18n.js');
        
        expect(TRANSLATIONS.es).toBeDefined();
        expect(TRANSLATIONS.en).toBeDefined();
        expect(TRANSLATIONS.pt).toBeDefined();

        const essentialKeys = [
            'brand_model', 'locale_label', 'telemetry_power', 'telemetry_audio',
            'transport_pause', 'transport_resume', 'mod1_title', 'mod2_title',
            'fader_vol', 'fader_cutoff', 'meter_scale', 'meter_tempo',
            'prompt_placeholder', 'btn_execute', 'btn_translating',
            'scale_minor', 'scale_major', 'wave_saw', 'wave_square', 'wave_cycle',
            'drums_both', 'drums_kick_only', 'drums_muted'
        ];

        ['es', 'en', 'pt'].forEach(lang => {
            essentialKeys.forEach(key => {
                expect(TRANSLATIONS[lang][key], `Missing ${key} in ${lang}`).toBeDefined();
                expect(typeof TRANSLATIONS[lang][key]).toBe('string');
                expect(TRANSLATIONS[lang][key].length).toBeGreaterThan(0);
            });
            expect(TRANSLATIONS[lang].presets).toHaveLength(8);
        });

        // Test t() translation helper
        expect(t('fader_vol', 'es')).toBe('VOLUMEN');
        expect(t('fader_vol', 'en')).toBe('VOLUME');
        expect(t('fader_vol', 'pt')).toBe('VOLUME');
        expect(t('non_existent_key', 'en')).toBe('non_existent_key');
    });
});

describe('Portuguese NLP Comprehension in Semantic Parser', () => {
    it('should parse Portuguese tempo, waveforms, and drum muting', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');

        const ptResult = parsePromptToDSP("ritmo techno a 135 bpm com dente de serra e sem bateria");
        expect(ptResult.meta.bpm).toBe(135);
        expect(ptResult.dsp_graph.synth_lead.wave_type).toBe('saw');
        expect(ptResult.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
        expect(ptResult.dsp_graph.drums.hihat_pattern.every(v => v === 0)).toBe(true);
    });

    it('should parse Portuguese relative tempo adjustments', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');

        const base = parsePromptToDSP("ritmo a 120 bpm");
        const faster = parsePromptToDSP("mais rápido", base);
        expect(faster.meta.bpm).toBe(132);

        const slower = parsePromptToDSP("mais lento", faster);
        expect(slower.meta.bpm).toBe(120);

        const accelerate = parsePromptToDSP("acelera", slower);
        expect(accelerate.meta.bpm).toBe(132);
    });

    it('should parse Portuguese scale, square wave, and transitions', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');

        const scaleResult = parsePromptToDSP("escala em ré menor com onda quadrada");
        expect(scaleResult.meta.scale).toBe('Dm');
        expect(scaleResult.dsp_graph.synth_lead.wave_type).toBe('square');

        const solMaior = parsePromptToDSP("escala de sol maior");
        expect(solMaior.meta.scale).toBe('G');

        const transResult = parsePromptToDSP("transição em 32 passos com explosão");
        expect(transResult.transition).not.toBeNull();
        expect(transResult.transition.active).toBe(true);
        expect(transResult.transition.total_steps).toBe(32);
        expect(transResult.transition.drum_exploding).toBe(true);
    });

    it('should parse selective Portuguese drum mutes (sem bumbo, sem chimbal, só sintetizador)', async () => {
        const { parsePromptToDSP } = await import('../js/ai-manager.js');

        const noKick = parsePromptToDSP("tira o bumbo");
        expect(noKick.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
        expect(noKick.dsp_graph.drums.hihat_pattern.some(v => v === 1)).toBe(true);

        const noHats = parsePromptToDSP("sem chimbal");
        expect(noHats.dsp_graph.drums.hihat_pattern.every(v => v === 0)).toBe(true);

        const synthOnly = parsePromptToDSP("só sintetizador");
        expect(synthOnly.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
        expect(synthOnly.dsp_graph.drums.hihat_pattern.every(v => v === 0)).toBe(true);
        expect(synthOnly.dsp_graph.synth_lead.notes_sequence.some(v => v > 0)).toBe(true);
    });
});

