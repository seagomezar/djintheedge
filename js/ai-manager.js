/**
 * AI Manager & NLP Parser for BrowserDJ AI.
 * Handles LiteRT-LM WebGPU sessions and contains the client-side
 * rule-based Natural Language Processing (NLP) parser fallback.
 */

import { LiteRTLMEngine } from './lib/litert-lm.js';

export class AIManager {
    constructor() {
        this.engine = null;
        this.currentAbortController = null;
        this.systemPrompt = `Eres un motor de traducción musical avanzado y estricto basado en Elementary Audio.
        Tu único objetivo es recibir descripciones de un DJ y transformarlas en configuraciones de síntesis, secuenciación y transiciones en formato JSON.
        
        Conceptos de Elementary Audio aplicados:
        1. Osciladores: 'cycle' representa ondas senoidales suaves, 'saw' representa ondas de sierra brillantes con muchos armónicos, 'square' representa ondas retro.
        2. Filtros: Filtro de paso bajo biquad (filter_cutoff_hz) que controla el brillo (desde 100Hz oscuros hasta 8000Hz brillantes) con resonancia controlada.
        3. Envolventes (ADSR): Ataques inmediatos para sonidos plucky (ej. [0.002, 0.08, 0.1, 0.05]) y ataques lentos para pads atmosféricos.
        4. Efectos: Eco/Delay (delay_feedback) y reverberación (reverb_mix).
        
        Soporte de Transiciones Temporales (Progressive Transitions):
        Si el usuario especifica una transición a lo largo de pasos (steps), debes incluir un bloque "transition" en tu respuesta JSON para indicar que los parámetros deben evolucionar dinámicamente.
        
        Esquema requerido:
        {
          "meta": { "bpm": number, "scale": string, "energy": number },
          "dsp_graph": {
            "drums": { "use_custom_sample": boolean, "sample_name": string, "kick_pattern": number[], "hihat_pattern": number[] },
            "synth_lead": { "wave_type": "saw"|"cycle"|"square", "filter_cutoff_hz": number, "filter_resonance": number, "adsr": number[], "notes_sequence": number[] },
            "effects": { "delay_feedback": number, "reverb_mix": number }
          },
          "transition": {
            "active": boolean,
            "total_steps": number,
            "target_scale": string,
            "target_cutoff": number,
            "drum_exploding": boolean
          }
        }
        
        REGLA CRÍTICA: Responde exclusivamente con el objeto JSON válido. No saludes, no expliques, no uses markdown fuera del JSON.`;
    }

    /**
     * Initializes the WebGPU/LiteRT engine. Fails back gracefully if WebGPU is unsupported.
     */
    async initialize(onProgress) {
        try {
            this.engine = await LiteRTLMEngine.create({
                modelPath: 'gemma-4-E2B-it-web.litertlm',
                storageMode: 'opfs',
                onProgress: onProgress
            });
        } catch (err) {
            console.warn("WebGPU initialization failed. Falling back to client-side NLP parser.", err);
            // Create a mock engine that skips GPU loading but uses the same message interface
            this.engine = {
                createConversation: async ({ signal }) => ({
                    sendMessage: async (prompt) => {
                        const dspJson = parsePromptToDSP(prompt);
                        return { text: JSON.stringify(dspJson, null, 2) };
                    }
                })
            };
            // Call onProgress(1.0) instantly to satisfy UI loaders
            if (onProgress) onProgress(1.0);
        }
    }

    /**
     * Translates a user prompt text into the target DSP configuration JSON.
     */
    async generateDSPConfig(userPrompt) {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            console.warn("Inferencia anterior abortada por nuevo comando.");
        }
        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;

        try {
            const conversation = await this.engine.createConversation({
                systemPrompt: this.systemPrompt,
                signal: signal
            });
            const response = await conversation.sendMessage(userPrompt);
            this.currentAbortController = null;
            return JSON.parse(response.text.trim());
        } catch (error) {
            if (error.name === 'AbortError') {
                return null;
            }
            console.error("AI Generation error, using local parser fallback directly:", error);
            // In case of any execution error, run the local NLP parser directly as a safety gate
            return parsePromptToDSP(userPrompt);
        }
    }
}

/**
 * Parses natural language descriptions into valid DSP JSON contracts.
 * Supports English and Spanish terms for BPM, scale, lead waveforms, filters, delay, and patterns.
 */
export function parsePromptToDSP(prompt, currentState = null) {
    const text = prompt.toLowerCase();

    // 1. Initialize variables from the current state (if present) or sensible defaults
    let bpm = currentState ? currentState.meta.bpm : 120;
    let scale = currentState ? currentState.meta.scale : "Am";
    let notes = currentState ? [...currentState.dsp_graph.synth_lead.notes_sequence] : [57, 60, 64, 67, 64, 60, 57, 0, 57, 60, 64, 67, 64, 60, 55, 0];
    let wave_type = currentState ? currentState.dsp_graph.synth_lead.wave_type : "saw";
    let filter_cutoff_hz = currentState ? currentState.dsp_graph.synth_lead.filter_cutoff_hz : 1500;
    let filter_resonance = currentState ? currentState.dsp_graph.synth_lead.filter_resonance : 2.0;
    let adsr = currentState ? [...currentState.dsp_graph.synth_lead.adsr] : [0.01, 0.15, 0.7, 0.2];
    
    let use_custom_sample = currentState ? currentState.dsp_graph.drums.use_custom_sample : false;
    let sample_name = currentState ? currentState.dsp_graph.drums.sample_name : "";
    let kick_pattern = currentState ? [...currentState.dsp_graph.drums.kick_pattern] : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    let hihat_pattern = currentState ? [...currentState.dsp_graph.drums.hihat_pattern] : [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
    
    let delay_feedback = currentState ? currentState.dsp_graph.effects.delay_feedback : 0.3;
    let reverb_mix = currentState ? currentState.dsp_graph.effects.reverb_mix : 0.15;

    // --- 1. BPM / Tempo Parsing ---
    const bpmMatch = text.match(/(\d+)\s*bpm/);
    if (bpmMatch) {
        bpm = parseInt(bpmMatch[1]);
    } else {
        if (text.includes("fast") || text.includes("rápido") || text.includes("rapido") || text.includes("acelera")) {
            bpm = 132;
        } else if (text.includes("slow") || text.includes("lento") || text.includes("chill") || text.includes("relax")) {
            bpm = 90;
        }
    }
    bpm = Math.max(60, Math.min(220, bpm));

    // --- 2. Scale & Notes Sequence Parsing ---
    const scaleMatches = text.match(/\b([a-g])\s*(minor|major|m|min|maj)?\b/);
    let scaleChanged = false;
    if (scaleMatches) {
        const root = scaleMatches[1].toUpperCase();
        const mode = scaleMatches[2] || '';
        const isMinor = mode.includes("m") || mode.includes("min") || text.includes("menor") || text.includes("minor");
        scale = root + (isMinor ? "m" : "");
        scaleChanged = true;
    }

    if (scaleChanged) {
        notes = generateScaleMelody(scale.replace("m", ""), scale.endsWith("m"));
    } else {
        // Only update melody style if explicitly requested
        if (text.includes("synthwave") || text.includes("cyberpunk") || text.includes("retro")) {
            notes = [57, 57, 60, 57, 64, 57, 67, 57, 57, 57, 60, 57, 64, 57, 67, 55];
        } else if (text.includes("house") || text.includes("disco") || text.includes("groove")) {
            notes = [57, 60, 0, 57, 60, 62, 57, 0, 57, 60, 0, 57, 60, 62, 55, 0];
        } else if (text.includes("ambient") || text.includes("chill") || text.includes("smooth")) {
            notes = [60, 64, 67, 72, 67, 64, 60, 0, 60, 64, 67, 72, 67, 64, 59, 0];
        } else if (text.includes("techno") || text.includes("dark")) {
            notes = [57, 57, 57, 60, 62, 60, 57, 0, 57, 57, 57, 60, 62, 60, 55, 0];
        }
    }

    // --- 3. Lead Synthesizer Parameters ---
    if (text.includes("sine") || text.includes("cycle") || text.includes("senoidal") || text.includes("soft") || text.includes("smooth")) {
        wave_type = "cycle";
    } else if (text.includes("saw") || text.includes("diente de sierra") || text.includes("bright") || text.includes("techno")) {
        wave_type = "saw";
    } else if (text.includes("square") || text.includes("cuadrada") || text.includes("retro")) {
        wave_type = "square";
    }

    const hzMatch = text.match(/(\d+)\s*hz/);
    if (hzMatch) {
        filter_cutoff_hz = parseInt(hzMatch[1]);
    } else {
        if (text.includes("low") || text.includes("bajo") || text.includes("oscuro") || text.includes("dark") || text.includes("deep")) {
            filter_cutoff_hz = 600;
        } else if (text.includes("high") || text.includes("alto") || text.includes("brillante") || text.includes("bright") || text.includes("open") || text.includes("abierto")) {
            filter_cutoff_hz = 3200;
        }
    }
    filter_cutoff_hz = Math.max(100, Math.min(10000, filter_cutoff_hz));

    if (text.includes("res") || text.includes("resonancia")) {
        if (text.includes("mucho") || text.includes("alta") || text.includes("high")) {
            filter_resonance = 4.5;
        } else if (text.includes("poca") || text.includes("baja") || text.includes("low")) {
            filter_resonance = 1.1;
        }
    }

    if (text.includes("plucky") || text.includes("pluck") || text.includes("corto")) {
        adsr = [0.002, 0.08, 0.1, 0.05];
    } else if (text.includes("pad") || text.includes("largo") || text.includes("slow attack")) {
        adsr = [0.4, 0.3, 0.8, 0.5];
    }

    // --- 4. Drums Sequencing ---
    const hasPercussionMentions = text.includes("percusion") || text.includes("percussion") || text.includes("drums") || text.includes("drum") || text.includes("bateria") || text.includes("bombo") || text.includes("hats") || text.includes("ritmo");
    const isNegatedPercussion = text.includes("no percusion") || text.includes("no percussion") || text.includes("sin percusion") || text.includes("sin percussion") || text.includes("no drum") || text.includes("sin bateria") || text.includes("quitar bateria");
    
    if (isNegatedPercussion) {
        kick_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        hihat_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    } else if (hasPercussionMentions) {
        if (text.includes("fast hats") || text.includes("hats rapidas") || text.includes("hihats rapidas") || text.includes("techno hats")) {
            hihat_pattern = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
        } else if (text.includes("no hats") || text.includes("sin hats") || text.includes("sin platillos")) {
            hihat_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        } else {
            hihat_pattern = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
        }

        if (text.includes("break") || text.includes("breakbeat") || text.includes("hiphop") || text.includes("hip hop")) {
            kick_pattern = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0];
        } else if (text.includes("double kick") || text.includes("fast kick") || text.includes("hardcore")) {
            kick_pattern = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
        } else if (text.includes("no kick") || text.includes("sin bombo")) {
            kick_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        } else {
            kick_pattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
        }
    }

    const sampleWords = text.match(/(?:sample|muestra|usar)\s+([a-z0-9_-]+)/);
    if (sampleWords) {
        use_custom_sample = true;
        sample_name = sampleWords[1];
    }

    // --- 5. Effects (Delay & Reverb) ---
    if (text.includes("delay") || text.includes("eco")) {
        if (text.includes("mucho") || text.includes("heavy") || text.includes("space") || text.includes("bastante")) {
            delay_feedback = 0.65;
        } else if (text.includes("poco") || text.includes("bajo") || text.includes("light")) {
            delay_feedback = 0.1;
        } else if (text.includes("no delay") || text.includes("sin delay") || text.includes("sin eco")) {
            delay_feedback = 0.0;
        } else {
            delay_feedback = 0.45;
        }
    }
    if (text.includes("reverb") || text.includes("espacio") || text.includes("catedral")) {
        if (text.includes("mucha") || text.includes("alta") || text.includes("cathedral")) {
            reverb_mix = 0.45;
        } else if (text.includes("no reverb") || text.includes("sin reverb")) {
            reverb_mix = 0.0;
        } else {
            reverb_mix = 0.25;
        }
    }

    // --- Energy calculation ---
    let energy = 0.5;
    if (bpm > 128) energy += 0.2;
    if (hihat_pattern.filter(x => x === 1).length > 6) energy += 0.15;
    if (filter_cutoff_hz > 2000) energy += 0.15;
    energy = Math.max(0.1, Math.min(1.0, energy));

    // --- 6. Transition Parsing ---
    let transition = null;
    const stepsMatch = text.match(/(\d+)\s*(steps|pasos|paso|step)/);
    if (stepsMatch) {
        const total_steps = parseInt(stepsMatch[1]);
        let target_scale = scale;
        
        // Detect destination scale (e.g. "to A major" or "a la mayor")
        const destScaleMatch = text.match(/(?:to|a|hasta)\s+([a-g])\s*(minor|major|m|min|maj|menor|mayor)?\b/);
        if (destScaleMatch) {
            const root = destScaleMatch[1].toUpperCase();
            const mode = destScaleMatch[2] || '';
            const isMinor = mode.includes("m") || mode.includes("min") || text.includes("menor") || text.includes("minor");
            target_scale = root + (isMinor ? "m" : "");
        } else if (text.includes("a major") || text.includes("a mayor")) {
            target_scale = "A";
        } else if (text.includes("a minor") || text.includes("a menor")) {
            target_scale = "Am";
        }
        
        let target_cutoff = filter_cutoff_hz;
        if (text.includes("brillian") || text.includes("brillante") || text.includes("bright") || text.includes("open")) {
            target_cutoff = 4500;
        }
        
        const drum_exploding = text.includes("exploding") || text.includes("explotando") || text.includes("explosion") || text.includes("climax");
        
        transition = {
            active: true,
            current_step: 0,
            total_steps,
            start_scale: scale,
            target_scale,
            start_cutoff: filter_cutoff_hz,
            target_cutoff,
            drum_exploding
        };
    }

    // Return mapped DSP structure
    return {
        meta: {
            bpm,
            scale,
            energy
        },
        dsp_graph: {
            drums: {
                use_custom_sample,
                sample_name,
                kick_pattern,
                hihat_pattern
            },
            synth_lead: {
                wave_type,
                filter_cutoff_hz,
                filter_resonance,
                adsr,
                notes_sequence: notes
            },
            effects: {
                delay_feedback,
                reverb_mix
            }
        },
        transition
    };
}

/**
 * Generates a 16-note arpeggiating lead sequence transposed to the root name and scale mode.
 */
function generateScaleMelody(rootName, isMinor) {
    const roots = { 'C': 60, 'D': 62, 'E': 64, 'F': 65, 'G': 67, 'A': 57, 'B': 59 };
    let rootMidi = roots[rootName] || 60;
    const intervals = isMinor ? [0, 2, 3, 5, 7, 8, 10, 12] : [0, 2, 4, 5, 7, 9, 11, 12];
    
    // Construct a beautiful 16-step arpeggiating pattern in the chosen scale
    const pattern = [0, 2, 4, 7, 4, 2, 0, 7, 0, 2, 4, 7, 4, 2, -1, -2];
    return pattern.map(idx => {
        if (idx === -1) return rootMidi - 12; // Octave below
        if (idx === -2) return rootMidi - 5; // Fifth below
        const interval = intervals[idx % intervals.length];
        return rootMidi + interval;
    });
}
