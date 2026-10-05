import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parsePromptToDSP } from '../js/ai-manager.js';

describe('Differential Testing & Reference Oracle Comparison', () => {
    const DETERMINISTIC_SEED = 98765432;

    // -------------------------------------------------------------------------
    // System 1: Multilingual Semantic Differential Equivalence
    // Compares English, Spanish, and Portuguese parsers across randomly selected inputs
    // -------------------------------------------------------------------------
    it('System Comparison 1: multilingual prompts must yield isomorphic DSP contracts for identical intents', () => {
        // Arbitrary genre and musical intent configurations
        const arbitraryMusicalIntents = fc.record({
            bpm: fc.integer({ min: 70, max: 180 }),
            wave: fc.constantFrom(
                { id: 'saw', es: 'diente de sierra', en: 'sawtooth', pt: 'dente de serra' },
                { id: 'square', es: 'onda cuadrada', en: 'square wave', pt: 'onda quadrada' },
                { id: 'cycle', es: 'onda senoidal', en: 'sine wave', pt: 'onda senoidal' }
            ),
            scale: fc.constantFrom(
                { id: 'C', es: 'do mayor', en: 'C major', pt: 'dó maior' },
                { id: 'Dm', es: 're menor', en: 'D minor', pt: 'ré menor' },
                { id: 'Am', es: 'la menor', en: 'A minor', pt: 'lá menor' },
                { id: 'G', es: 'sol mayor', en: 'G major', pt: 'sol maior' },
                { id: 'Em', es: 'mi menor', en: 'E minor', pt: 'mi menor' }
            ),
            drums: fc.constantFrom(
                { id: 'mute_all', es: 'sin bateria', en: 'no drums', pt: 'sem bateria' },
                { id: 'mute_kick', es: 'sin bombo', en: 'no kick', pt: 'sem bumbo' },
                { id: 'mute_hats', es: 'sin platillos', en: 'no hats', pt: 'sem chimbal' }
            )
        });

        fc.assert(
            fc.property(arbitraryMusicalIntents, (intent) => {
                // Generate equivalent localized natural language sentences
                const promptES = `ritmo a ${intent.bpm} bpm con ${intent.wave.es} en escala ${intent.scale.es} y ${intent.drums.es}`;
                const promptEN = `beat at ${intent.bpm} bpm with ${intent.wave.en} in ${intent.scale.en} and ${intent.drums.en}`;
                const promptPT = `ritmo a ${intent.bpm} bpm com ${intent.wave.pt} em ${intent.scale.pt} e ${intent.drums.pt}`;

                const resultES = parsePromptToDSP(promptES);
                const resultEN = parsePromptToDSP(promptEN);
                const resultPT = parsePromptToDSP(promptPT);

                // Differential comparison: All 3 languages must produce identical core state
                expect(resultES.meta.bpm).toBe(intent.bpm);
                expect(resultEN.meta.bpm).toBe(intent.bpm);
                expect(resultPT.meta.bpm).toBe(intent.bpm);

                expect(resultES.dsp_graph.synth_lead.wave_type).toBe(intent.wave.id);
                expect(resultEN.dsp_graph.synth_lead.wave_type).toBe(intent.wave.id);
                expect(resultPT.dsp_graph.synth_lead.wave_type).toBe(intent.wave.id);

                expect(resultES.meta.scale).toBe(intent.scale.id);
                expect(resultEN.meta.scale).toBe(intent.scale.id);
                expect(resultPT.meta.scale).toBe(intent.scale.id);

                // Drum mute differential
                if (intent.drums.id === 'mute_all') {
                    expect(resultES.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
                    expect(resultEN.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
                    expect(resultPT.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
                    expect(resultES.dsp_graph.drums.hihat_pattern.every(v => v === 0)).toBe(true);
                    expect(resultEN.dsp_graph.drums.hihat_pattern.every(v => v === 0)).toBe(true);
                    expect(resultPT.dsp_graph.drums.hihat_pattern.every(v => v === 0)).toBe(true);
                } else if (intent.drums.id === 'mute_kick') {
                    expect(resultES.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
                    expect(resultEN.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
                    expect(resultPT.dsp_graph.drums.kick_pattern.every(v => v === 0)).toBe(true);
                } else if (intent.drums.id === 'mute_hats') {
                    expect(resultES.dsp_graph.drums.hihat_pattern.every(v => v === 0)).toBe(true);
                    expect(resultEN.dsp_graph.drums.hihat_pattern.every(v => v === 0)).toBe(true);
                    expect(resultPT.dsp_graph.drums.hihat_pattern.every(v => v === 0)).toBe(true);
                }
            }),
            { numRuns: 1000, seed: DETERMINISTIC_SEED }
        );
    });

    // -------------------------------------------------------------------------
    // System 2: Canonical Reference Oracle Comparison
    // Compares parser implementation against an independent Golden Reference Model
    // -------------------------------------------------------------------------
    it('System Comparison 2: parser matches canonical reference oracle on 1,500 randomized inputs', () => {
        // Golden Reference Model Definition
        const ReferenceOracle = {
            parseGenre(text) {
                const t = text.toLowerCase();
                if (t.includes('techno') || t.includes('berghain')) return { bpm: 132, wave: 'saw', cutoff: 1200 };
                if (t.includes('house') || t.includes('disco')) return { bpm: 124, wave: 'saw', cutoff: 2400 };
                if (t.includes('synthwave') || t.includes('retrowave')) return { bpm: 118, wave: 'saw', cutoff: 2800 };
                if (t.includes('breakbeat') || t.includes('hiphop') || t.includes('lofi')) return { bpm: 92, wave: 'cycle', cutoff: 950 };
                if (t.includes('ambient') || t.includes('chillout')) return { bpm: 78, wave: 'cycle', cutoff: 1200 };
                if (t.includes('reggaeton') || t.includes('dembow')) return { bpm: 95, wave: 'saw', cutoff: 2200 };
                if (t.includes('trance') || t.includes('edm')) return { bpm: 138, wave: 'saw', cutoff: 3800 };
                return null;
            },
            parseExplicitBpm(text) {
                const match = text.toLowerCase().match(/(\d+)\s*bpm/);
                if (match) {
                    const val = parseInt(match[1]);
                    return Math.max(60, Math.min(220, val));
                }
                return null;
            }
        };

        const genreTerms = fc.constantFrom(
            "techno berghain", "house funky", "synthwave 80s",
            "breakbeat lofi", "ambient relajante", "reggaeton dembow", "trance edm"
        );
        const optionalExplicitBpm = fc.option(fc.integer({ min: 50, max: 240 }));

        fc.assert(
            fc.property(genreTerms, optionalExplicitBpm, (genre, maybeBpm) => {
                const prompt = maybeBpm !== null ? `${genre} a ${maybeBpm} bpm` : genre;
                const parsed = parsePromptToDSP(prompt);

                const oracleGenre = ReferenceOracle.parseGenre(prompt);
                const oracleBpm = ReferenceOracle.parseExplicitBpm(prompt);

                // Expected BPM priority: explicit BPM overrides genre default
                const expectedBpm = oracleBpm !== null ? oracleBpm : oracleGenre.bpm;

                expect(parsed.meta.bpm).toBe(expectedBpm);
                expect(parsed.dsp_graph.synth_lead.wave_type).toBe(oracleGenre.wave);
            }),
            { numRuns: 1500, seed: DETERMINISTIC_SEED }
        );
    });

    // -------------------------------------------------------------------------
    // System 3: Normalization & Perturbation Invariance
    // Verifies that casing, spacing, and punctuation permutations do not alter semantic results
    // -------------------------------------------------------------------------
    it('System Comparison 3: parser is strictly invariant under casing, spacing, and punctuation noise', () => {
        const canonicalPrompts = fc.constantFrom(
            "techno a 135 bpm con filtro bajo",
            "onda cuadrada con mucho delay en re menor",
            "house a 124 bpm sin bombo",
            "ambient a 80 bpm con onda suave y mucha reverb",
            "ritmo rápido a 140 bpm con drop potente"
        );

        fc.assert(
            fc.property(canonicalPrompts, (canonical) => {
                const baseResult = parsePromptToDSP(canonical);

                // Perturbation 1: Random Upper / Lower casing
                const mixedCase = canonical.split('').map((char, i) => i % 2 === 0 ? char.toUpperCase() : char.toLowerCase()).join('');
                const mixedResult = parsePromptToDSP(mixedCase);

                expect(mixedResult.meta.bpm).toBe(baseResult.meta.bpm);
                expect(mixedResult.meta.scale).toBe(baseResult.meta.scale);
                expect(mixedResult.dsp_graph.synth_lead.wave_type).toBe(baseResult.dsp_graph.synth_lead.wave_type);
                expect(mixedResult.dsp_graph.synth_lead.filter_cutoff_hz).toBe(baseResult.dsp_graph.synth_lead.filter_cutoff_hz);
                expect(mixedResult.dsp_graph.effects.delay_feedback).toBe(baseResult.dsp_graph.effects.delay_feedback);

                // Perturbation 2: Redundant whitespace and tabs
                const noisySpacing = canonical.replace(/\s+/g, '    \t   ');
                const spacingResult = parsePromptToDSP(noisySpacing);

                expect(spacingResult.meta.bpm).toBe(baseResult.meta.bpm);
                expect(spacingResult.dsp_graph.synth_lead.wave_type).toBe(baseResult.dsp_graph.synth_lead.wave_type);

                // Perturbation 3: Extra punctuation marks (!, ?, ¡, ¿, ., ;)
                const punctuated = `¡¡¡${canonical}???!!...`;
                const punctResult = parsePromptToDSP(punctuated);

                expect(punctResult.meta.bpm).toBe(baseResult.meta.bpm);
                expect(punctResult.dsp_graph.synth_lead.wave_type).toBe(baseResult.dsp_graph.synth_lead.wave_type);
            }),
            { numRuns: 500, seed: DETERMINISTIC_SEED }
        );
    });

    // -------------------------------------------------------------------------
    // System 4: Sequential Pipeline vs Batch Composite Prompt Equivalence
    // Verifies that executing independent prompts sequentially produces isomorphic state to composite execution
    // -------------------------------------------------------------------------
    it('System Comparison 4: sequential composition matches atomic composite statements', () => {
        const tempoMods = fc.constantFrom("a 140 bpm", "a 90 bpm", "a 128 bpm", "a 110 bpm");
        const waveMods = fc.constantFrom("con onda cuadrada", "con onda senoidal", "con diente de sierra");
        const fxMods = fc.constantFrom("con mucho delay", "sin reverb", "con mucha reverb", "sin delay");

        fc.assert(
            fc.property(tempoMods, waveMods, fxMods, (tempo, wave, fx) => {
                // Method A: Sequential execution step-by-step
                let seqState = parsePromptToDSP(tempo);
                seqState = parsePromptToDSP(wave, seqState);
                seqState = parsePromptToDSP(fx, seqState);

                // Method B: Composite execution in a single prompt
                const compositePrompt = `${tempo} ${wave} ${fx}`;
                const compState = parsePromptToDSP(compositePrompt);

                // Both paths must converge on identical core parameters
                expect(seqState.meta.bpm).toBe(compState.meta.bpm);
                expect(seqState.dsp_graph.synth_lead.wave_type).toBe(compState.dsp_graph.synth_lead.wave_type);
                expect(seqState.dsp_graph.effects.delay_feedback).toBe(compState.dsp_graph.effects.delay_feedback);
                expect(seqState.dsp_graph.effects.reverb_mix).toBe(compState.dsp_graph.effects.reverb_mix);
            }),
            { numRuns: 500, seed: DETERMINISTIC_SEED }
        );
    });
});
