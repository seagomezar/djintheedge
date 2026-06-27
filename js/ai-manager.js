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
        this.systemPrompt = `Eres un motor de traducción musical estricto. Tu único objetivo es recibir descripciones de un DJ y transformarlas en configuraciones de síntesis y secuenciación en formato JSON.
        REGLA CRÍTICA: Responde exclusivamente con el objeto JSON válido. No saludes, no expliques, no uses markdown fuera del JSON.
        
        Esquema requerido:
        {
          "meta": { "bpm": number, "scale": string, "energy": number },
          "dsp_graph": {
            "drums": { "use_custom_sample": boolean, "sample_name": string, "kick_pattern": number[], "hihat_pattern": number[] },
            "synth_lead": { "wave_type": "saw"|"cycle", "filter_cutoff_hz": number, "filter_resonance": number, "adsr": number[], "notes_sequence": number[] },
            "effects": { "delay_feedback": number, "reverb_mix": number }
          }
        }`;
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
export function parsePromptToDSP(prompt) {
    const text = prompt.toLowerCase();

    // --- 1. BPM / Tempo Parsing ---
    let bpm = 120;
    const bpmMatch = text.match(/(\d+)\s*bpm/);
    if (bpmMatch) {
        bpm = parseInt(bpmMatch[1]);
    } else {
        if (text.includes("fast") || text.includes("rápido") || text.includes("rapido") || text.includes("acelera") || text.includes("techno")) {
            bpm = 132;
        } else if (text.includes("slow") || text.includes("lento") || text.includes("chill") || text.includes("downbeat") || text.includes("relax")) {
            bpm = 90;
        }
    }
    bpm = Math.max(60, Math.min(220, bpm)); // Clamp to sensible musical range

    // --- 2. Scale & Notes Sequence Parsing ---
    let scale = "Am";
    let notes = [57, 60, 64, 67, 64, 60, 57, 0, 57, 60, 64, 67, 64, 60, 55, 0]; // Default: A minor arpeggio (16 steps)
    
    // Check scale
    const scaleMatches = text.match(/\b([a-g])\s*(minor|major|m|min|maj)?\b/);
    if (scaleMatches) {
        const root = scaleMatches[1].toUpperCase();
        const mode = scaleMatches[2] || '';
        const isMinor = mode.includes("m") || mode.includes("min") || text.includes("menor") || text.includes("minor");
        scale = root + (isMinor ? "m" : "");
    }

    // Select note patterns based on style
    if (text.includes("synthwave") || text.includes("cyberpunk") || text.includes("retro")) {
        // Classic driving bassline / sequence (16 steps)
        notes = [57, 57, 60, 57, 64, 57, 67, 57, 57, 57, 60, 57, 64, 57, 67, 55];
    } else if (text.includes("house") || text.includes("disco") || text.includes("groove")) {
        // Offbeat groove (16 steps)
        notes = [57, 60, 0, 57, 60, 62, 57, 0, 57, 60, 0, 57, 60, 62, 55, 0];
    } else if (text.includes("ambient") || text.includes("chill") || text.includes("smooth")) {
        // Wide chord arpeggio (16 steps)
        notes = [60, 64, 67, 72, 67, 64, 60, 0, 60, 64, 67, 72, 67, 64, 59, 0];
    } else if (text.includes("techno") || text.includes("dark")) {
        // Hypnotic techno melody (16 steps)
        notes = [57, 57, 57, 60, 62, 60, 57, 0, 57, 57, 57, 60, 62, 60, 55, 0];
    }

    // --- 3. Lead Synthesizer Parameters ---
    let wave_type = "saw";
    if (text.includes("sine") || text.includes("cycle") || text.includes("senoidal") || text.includes("soft") || text.includes("smooth")) {
        wave_type = "cycle";
    }

    let filter_cutoff_hz = 1500;
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

    let filter_resonance = 2.0;
    if (text.includes("res") || text.includes("resonancia")) {
        if (text.includes("mucho") || text.includes("alta") || text.includes("high")) {
            filter_resonance = 4.5;
        } else if (text.includes("poca") || text.includes("baja") || text.includes("low")) {
            filter_resonance = 1.1;
        }
    }

    let adsr = [0.01, 0.15, 0.7, 0.2];
    if (text.includes("plucky") || text.includes("pluck") || text.includes("corto")) {
        adsr = [0.002, 0.08, 0.1, 0.05];
    } else if (text.includes("pad") || text.includes("largo") || text.includes("slow attack")) {
        adsr = [0.4, 0.3, 0.8, 0.5];
    }

    // --- 4. Drums Sequencing ---
    let use_custom_sample = false;
    let sample_name = "";

    // Kick drum pattern
    let kick_pattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; // 4-on-the-floor default
    if (text.includes("break") || text.includes("breakbeat") || text.includes("hiphop") || text.includes("hip hop")) {
        kick_pattern = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    } else if (text.includes("ambient") || text.includes("no kick") || text.includes("sin bombo") || text.includes("relax")) {
        kick_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    } else if (text.includes("double kick") || text.includes("fast kick") || text.includes("hardcore")) {
        kick_pattern = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    }

    // Hihat pattern
    let hihat_pattern = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]; // Offbeats default
    if (text.includes("fast hats") || text.includes("hats rapidas") || text.includes("hihats rapidas") || text.includes("techno hats")) {
        hihat_pattern = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
    } else if (text.includes("no hats") || text.includes("sin hats") || text.includes("ambient")) {
        hihat_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    }

    // Check custom sample trigger
    // E.g., user writes: "usa el sample bombo_808"
    const sampleWords = text.match(/(?:sample|muestra|usar)\s+([a-z0-9_-]+)/);
    if (sampleWords) {
        use_custom_sample = true;
        sample_name = sampleWords[1];
    }

    // --- 5. Effects (Delay & Reverb) ---
    let delay_feedback = 0.3;
    if (text.includes("delay") || text.includes("eco")) {
        if (text.includes("mucho") || text.includes("heavy") || text.includes("space") || text.includes("bastante")) {
            delay_feedback = 0.55;
        } else if (text.includes("poco") || text.includes("light")) {
            delay_feedback = 0.15;
        } else {
            const decimalMatch = text.match(/delay\s+(0\.\d+)/);
            if (decimalMatch) {
                delay_feedback = parseFloat(decimalMatch[1]);
            }
        }
    }
    delay_feedback = Math.max(0, Math.min(0.9, delay_feedback));

    let reverb_mix = 0.15;
    if (text.includes("reverb") || text.includes("espacio")) {
        if (text.includes("mucho") || text.includes("grande")) {
            reverb_mix = 0.45;
        } else if (text.includes("seco") || text.includes("dry")) {
            reverb_mix = 0.02;
        }
    }

    // --- Energy calculation ---
    let energy = 0.5;
    if (bpm > 128) energy += 0.2;
    if (hihat_pattern.filter(x => x === 1).length > 6) energy += 0.15;
    if (filter_cutoff_hz > 2000) energy += 0.15;
    energy = Math.max(0.1, Math.min(1.0, energy));

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
        }
    };
}
