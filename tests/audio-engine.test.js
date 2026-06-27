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
});

