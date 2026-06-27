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
