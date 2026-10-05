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
                    sendMessage: async (prompt, state = null) => {
                        const dspJson = parsePromptToDSP(prompt, state);
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
    async generateDSPConfig(userPrompt, currentState = null) {
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
            const response = await conversation.sendMessage(userPrompt, currentState);
            this.currentAbortController = null;
            return JSON.parse(response.text.trim());
        } catch (error) {
            if (error.name === 'AbortError') {
                return null;
            }
            console.error("AI Generation error, using local parser fallback directly:", error);
            // In case of any execution error, run the local NLP parser directly as a safety gate
            return parsePromptToDSP(userPrompt, currentState);
        }
    }
}

/**
 * Parses natural language descriptions into valid DSP JSON contracts.
 * Supports English and Spanish terms for BPM, scale, lead waveforms, filters, delay, and patterns.
 */
export function parsePromptToDSP(prompt, currentState = null) {
    const text = prompt.toLowerCase().trim();

    // 1. Initialize variables from the current state (if present) or sensible defaults
    let bpm = currentState?.meta?.bpm ?? 120;
    let scale = currentState?.meta?.scale ?? "Am";
    let energy = currentState?.meta?.energy ?? 0.6;

    let use_custom_sample = currentState?.dsp_graph?.drums?.use_custom_sample ?? false;
    let sample_name = currentState?.dsp_graph?.drums?.sample_name ?? "";
    let kick_pattern = currentState?.dsp_graph?.drums?.kick_pattern 
        ? [...currentState.dsp_graph.drums.kick_pattern] 
        : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0];
    let hihat_pattern = currentState?.dsp_graph?.drums?.hihat_pattern 
        ? [...currentState.dsp_graph.drums.hihat_pattern] 
        : [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1];

    let wave_type = currentState?.dsp_graph?.synth_lead?.wave_type ?? "saw";
    let filter_cutoff_hz = currentState?.dsp_graph?.synth_lead?.filter_cutoff_hz ?? 2000;
    let filter_resonance = currentState?.dsp_graph?.synth_lead?.filter_resonance ?? 2.0;
    let adsr = currentState?.dsp_graph?.synth_lead?.adsr 
        ? [...currentState.dsp_graph.synth_lead.adsr] 
        : [0.01, 0.15, 0.7, 0.2];
    let notes = currentState?.dsp_graph?.synth_lead?.notes_sequence 
        ? [...currentState.dsp_graph.synth_lead.notes_sequence] 
        : [57, 60, 64, 67, 64, 60, 57, 0, 57, 60, 64, 67, 64, 60, 55, 0];

    let delay_feedback = currentState?.dsp_graph?.effects?.delay_feedback ?? 0.3;
    let reverb_mix = currentState?.dsp_graph?.effects?.reverb_mix ?? 0.15;

    // --- 2. Genre & Musical Preset Detection ---
    let genreMatched = false;
    if (text.includes("techno") || text.includes("industrial") || text.includes("rave") || text.includes("berghain")) {
        bpm = 132;
        kick_pattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
        hihat_pattern = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
        wave_type = "saw";
        filter_cutoff_hz = 1200;
        filter_resonance = 3.2;
        notes = generateScaleMelody(scale.replace("m", ""), true, 'techno');
        delay_feedback = 0.35;
        reverb_mix = 0.25;
        genreMatched = true;
    } else if (text.includes("house") || text.includes("disco") || text.includes("funky") || text.includes("funk")) {
        bpm = 124;
        kick_pattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
        hihat_pattern = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
        wave_type = "saw";
        filter_cutoff_hz = 2400;
        filter_resonance = 2.0;
        notes = generateScaleMelody(scale.replace("m", ""), scale.endsWith("m"), 'funk');
        delay_feedback = 0.25;
        reverb_mix = 0.25;
        genreMatched = true;
    } else if (text.includes("synthwave") || text.includes("cyberpunk") || text.includes("retrowave") || text.includes("80s")) {
        bpm = 118;
        kick_pattern = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
        hihat_pattern = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1];
        wave_type = "saw";
        filter_cutoff_hz = 2800;
        filter_resonance = 2.5;
        notes = generateScaleMelody(scale.replace("m", ""), true, 'arpeggio');
        delay_feedback = 0.45;
        reverb_mix = 0.35;
        genreMatched = true;
    } else if (text.includes("breakbeat") || text.includes("break") || text.includes("hiphop") || text.includes("hip hop") || text.includes("lofi") || text.includes("lo-fi") || text.includes("chillhop")) {
        bpm = 92;
        kick_pattern = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0];
        hihat_pattern = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1];
        wave_type = "cycle";
        filter_cutoff_hz = 950;
        adsr = [0.02, 0.18, 0.6, 0.3];
        notes = generateScaleMelody(scale.replace("m", ""), true, 'chords');
        delay_feedback = 0.25;
        reverb_mix = 0.35;
        genreMatched = true;
    } else if (text.includes("drum and bass") || text.includes("drum & bass") || text.includes("dnb") || text.includes("jungle")) {
        bpm = 170;
        kick_pattern = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
        hihat_pattern = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
        wave_type = "saw";
        filter_cutoff_hz = 2400;
        genreMatched = true;
    } else if (text.includes("ambient") || text.includes("chillout") || text.includes("meditat") || text.includes("atmosferic") || text.includes("atmospheric")) {
        bpm = 78;
        kick_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        hihat_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        wave_type = "cycle";
        filter_cutoff_hz = 1200;
        adsr = [0.35, 0.4, 0.85, 0.6];
        delay_feedback = 0.5;
        reverb_mix = 0.6;
        notes = generateScaleMelody(scale.replace("m", ""), scale.endsWith("m"), 'ambient');
        genreMatched = true;
    } else if (text.includes("reggaeton") || text.includes("reguetón") || text.includes("dembow") || text.includes("latino") || text.includes("urbano")) {
        bpm = 95;
        kick_pattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
        hihat_pattern = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0];
        wave_type = "saw";
        filter_cutoff_hz = 2200;
        genreMatched = true;
    } else if (text.includes("trance") || text.includes("edm") || text.includes("festival")) {
        bpm = 138;
        kick_pattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
        hihat_pattern = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
        wave_type = "saw";
        filter_cutoff_hz = 3800;
        adsr = [0.003, 0.09, 0.2, 0.1];
        delay_feedback = 0.45;
        reverb_mix = 0.4;
        genreMatched = true;
    }

    // --- 3. BPM / Tempo Parsing (Explicit & Relative) ---
    const bpmMatch = text.match(/(\d+)\s*bpm/) || text.match(/tempo\s*(?:a|en|de)?\s*(\d+)/) || text.match(/\ba\s*(\d+)\s*bpm\b/);
    if (bpmMatch) {
        bpm = parseInt(bpmMatch[1]);
    } else {
        // Relative tempo changes: Check deceleration first to prevent 'desacelera' matching 'acelera'
        if (text.includes("más lento") || text.includes("mas lento") || text.includes("mais lento") || text.includes("frena") || text.includes("slower") || text.includes("slow down") || text.includes("baja el tempo") || text.includes("bajar tempo") || text.includes("baja tempo") || text.includes("desacelera") || text.includes("diminui o tempo")) {
            bpm = Math.max(60, bpm - 12);
        } else if (text.includes("más rápido") || text.includes("mas rapido") || text.includes("mais rápido") || text.includes("mais rapido") || text.includes("acelera") || text.includes("faster") || text.includes("speed up") || text.includes("sube el tempo") || text.includes("subir tempo") || text.includes("sube tempo") || text.includes("aumenta el tempo") || text.includes("aumenta o tempo")) {
            bpm = Math.min(220, bpm + 12);
        } else if (!genreMatched) {
            if (text.includes("fast") || text.includes("rápido") || text.includes("rapido")) {
                bpm = 132;
            } else if (text.includes("slow") || text.includes("lento") || text.includes("chill") || text.includes("relax")) {
                bpm = 90;
            }
        }
    }
    bpm = Math.max(60, Math.min(220, bpm));

    // --- 4. Scale & Root Note Parsing (Letters & Solfege ES/EN/PT) ---
    const noteMap = {
        'do': 'C', 'dó': 'C', 're': 'D', 'ré': 'D', 'mi': 'E', 'fa': 'F', 'fá': 'F', 'sol': 'G', 'la': 'A', 'lá': 'A', 'si': 'B',
        'c': 'C', 'd': 'D', 'e': 'E', 'f': 'F', 'g': 'G', 'a': 'A', 'b': 'B'
    };

    // Disambiguate Spanish/Portuguese articles ('la', 'a', 'o') before nouns
    const sanitizedScaleText = text.replace(/\b(?:la|a|o)\s+(?:escala|musica|música|bateria|batería|melodia|melodía|cancao|canção|cancion|canción|percussion|percusion|percusión|percussao|percussão)\b/g, '## $1');
    
    // Note regex supporting accented solfege (dó, ré, fá, lá) with unicode-safe boundaries
    const notePattern = `(?:do|dó|re|ré|mi|fa|fá|sol|la|lá|si|[a-g])`;
    const modePattern = `(?:menor|mayor|minor|major|maior|m|min|maj)`;
    
    // Check 1: Explicit scale prefix (escala [em/en/de/a]?, tom [em/de]?, tono [en/de]?, scale [in/to/of]?, key [of/in]?, em, en)
    let scaleMatches = sanitizedScaleText.match(new RegExp(`(?:(?:escala|tom|tono|scale|key)\\s+(?:em|en|de|a|in|of|to)?|(?:em|en)\\s+)\\s*(${notePattern})(?:\\s+(${modePattern}))?(?=[^a-zA-ZáéíóúÁÉÍÓÚ0-9]|$)`));
    
    // Check 2: Note followed immediately by mode (e.g. "do mayor", "dó maior", "re menor", "ré menor", "c minor", "a major")
    if (!scaleMatches) {
        scaleMatches = sanitizedScaleText.match(new RegExp(`(?:^|[^a-zA-ZáéíóúÁÉÍÓÚ0-9])(${notePattern})\\s+(${modePattern})(?=[^a-zA-ZáéíóúÁÉÍÓÚ0-9]|$)`));
    }
    
    // Check 3: Short chord/key notation (e.g. "Am", "Dm", "Cmin", "Gmaj" — excludes bare "em" which is the PT preposition "in")
    if (!scaleMatches) {
        const chordMatch = sanitizedScaleText.match(/(?:^|\s)(?:([a-df-g])m|([a-g])(min|maj))(?:\s|$)/);
        if (chordMatch) {
            scaleMatches = [chordMatch[0], chordMatch[1] || chordMatch[2], chordMatch[3] || 'm'];
        }
    }

    let scaleChanged = false;
    if (scaleMatches) {
        const rawNote = scaleMatches[1];
        const root = noteMap[rawNote] || rawNote.toUpperCase();
        const mode = (scaleMatches[2] || '').trim();
        const isExplicitMajor = mode.includes("maj") || mode.includes("mayor") || mode.includes("major") || mode.includes("maior");
        const isExplicitMinor = mode === "m" || mode === "min" || mode.includes("menor") || mode.includes("minor");
        const isMinor = !isExplicitMajor && (isExplicitMinor || text.includes("menor") || text.includes("minor"));
        scale = root + (isMinor ? "m" : "");
        scaleChanged = true;
    }

    if (scaleChanged) {
        notes = generateScaleMelody(scale.replace("m", ""), scale.endsWith("m"));
    } else if (!genreMatched) {
        // Creative variations when the user asks for change / new melody
        if (text.includes("cambia la musica") || text.includes("cambiar la musica") || text.includes("cambia el ritmo") || text.includes("nueva melodia") || text.includes("nueva melodía") || text.includes("algo diferente") || text.includes("algo nuevo") || text.includes("sorprende") || text.includes("otra cosa") || text.includes("improvisa")) {
            // Pick an alternate melodic pattern within the current scale
            const styles = ['funk', 'techno', 'chords', 'arpeggio', 'ambient'];
            const randomStyle = styles[Math.floor(Math.random() * styles.length)];
            notes = generateScaleMelody(scale.replace("m", ""), scale.endsWith("m"), randomStyle);
        }
    }

    // --- 5. Lead Synthesizer Waveform ---
    if (text.includes("square") || text.includes("cuadrada") || text.includes("quadrada") || text.includes("retro") || text.includes("8-bit") || text.includes("8bit") || text.includes("arcade") || text.includes("chiptune")) {
        wave_type = "square";
    } else if (text.includes("saw") || text.includes("sierra") || text.includes("diente de sierra") || text.includes("dente de serra") || text.includes("serra") || text.includes("bright") || text.includes("brillante")) {
        wave_type = "saw";
    } else if (text.includes("sine") || text.includes("cycle") || text.includes("senoidal") || text.includes("soft") || text.includes("suave") || text.includes("onda suave")) {
        wave_type = "cycle";
    }

    // --- 6. Filter Cutoff (Explicit & Relative) ---
    const hzMatch = text.match(/(\d+)\s*(hz|hercios)/);
    if (hzMatch) {
        filter_cutoff_hz = parseInt(hzMatch[1]);
    } else {
        if (text.includes("low") || text.includes("filtro bajo") || text.includes("filtro baixo") || text.includes("oscuro") || text.includes("escuro") || text.includes("dark") || text.includes("deep") || text.includes("grave")) {
            filter_cutoff_hz = 600;
        } else if (text.includes("baja el filtro") || text.includes("abaixa o filtro") || text.includes("menos brillo") || text.includes("menos brilho") || text.includes("menos agudos") || text.includes("cerrado") || text.includes("fechado")) {
            filter_cutoff_hz = currentState ? Math.max(300, filter_cutoff_hz - 600) : 700;
        } else if (text.includes("high") || text.includes("filtro alto") || text.includes("brillante") || text.includes("brilhante") || text.includes("bright") || text.includes("abierto") || text.includes("aberto") || text.includes("open")) {
            filter_cutoff_hz = 3200;
        } else if (text.includes("sube el filtro") || text.includes("aumenta o filtro") || text.includes("abre o filtro") || text.includes("abrir o filtro") || text.includes("mas brillo") || text.includes("más brillo") || text.includes("mais brilho") || text.includes("agudos")) {
            filter_cutoff_hz = currentState ? Math.min(8000, filter_cutoff_hz + 800) : 3400;
        }
    }
    filter_cutoff_hz = Math.max(100, Math.min(10000, filter_cutoff_hz));

    if (text.includes("res") || text.includes("resonancia") || text.includes("ressonância") || text.includes("ressonancia")) {
        if (text.includes("mucho") || text.includes("muito") || text.includes("alta") || text.includes("high") || text.includes("sube")) {
            filter_resonance = 4.5;
        } else if (text.includes("poca") || text.includes("pouca") || text.includes("baja") || text.includes("baixa") || text.includes("low")) {
            filter_resonance = 1.1;
        }
    }

    if (text.includes("plucky") || text.includes("pluck") || text.includes("corto") || text.includes("curto") || text.includes("staccato") || text.includes("seco")) {
        adsr = [0.002, 0.08, 0.1, 0.05];
    } else if (text.includes("pad") || text.includes("largo") || text.includes("slow attack") || text.includes("manto")) {
        adsr = [0.35, 0.3, 0.8, 0.5];
    }

    // --- 7. Drums & Percussion Sequencing (Mute / Unmute / Roll ES/EN/PT) ---
    const isMutePercussion = text.includes("sin bateria") || text.includes("sin batería") || text.includes("sem bateria") || text.includes("tira a bateria") || text.includes("tirar a bateria") || text.includes("no drums") || text.includes("no drum") || text.includes("quita la bateria") || text.includes("quita la batería") || text.includes("quitar bateria") || text.includes("quitar batería") || text.includes("quitar percusion") || text.includes("quitar percusión") || text.includes("quita la percusion") || text.includes("quita la percusión") || text.includes("sin percusion") || text.includes("sin percusión") || text.includes("sem percussão") || text.includes("sem percussao") || text.includes("tira a percussão") || text.includes("no percussion") || text.includes("mute bateria") || text.includes("mute drums") || text.includes("apaga la bateria") || text.includes("silencia la bateria") || text.includes("silencia a bateria") || text.includes("muta a bateria") || text.includes("solo synth") || text.includes("só synth") || text.includes("so synth") || text.includes("solo sintetizador") || text.includes("só sintetizador") || text.includes("so sintetizador") || text.includes("sin ritmo") || text.includes("sem ritmo");
    
    if (isMutePercussion) {
        kick_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        hihat_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    } else {
        // Mute/Unmute individual layers
        if (text.includes("sin bombo") || text.includes("sem bumbo") || text.includes("tira o bumbo") || text.includes("no kick") || text.includes("quita el bombo") || text.includes("quitar bombo") || text.includes("silencia el bombo") || text.includes("apaga el bombo") || text.includes("mute kick")) {
            kick_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        } else if (text.includes("doble bombo") || text.includes("bumbo duplo") || text.includes("double kick") || text.includes("fast kick") || text.includes("hardcore")) {
            kick_pattern = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
        } else if (text.includes("pon bombo") || text.includes("bota bumbo") || text.includes("coloque bumbo") || text.includes("adiciona bumbo") || text.includes("agrega bombo") || text.includes("mete bombo") || text.includes("activa bombo") || text.includes("con bombo") || text.includes("com bumbo")) {
            kick_pattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
        }

        if (text.includes("sin hats") || text.includes("sem chimbal") || text.includes("sem pratos") || text.includes("tira o chimbal") || text.includes("sin platillos") || text.includes("no hats") || text.includes("no hihats") || text.includes("quita los platillos") || text.includes("apaga los platillos") || text.includes("silencia los platillos") || text.includes("mute hats")) {
            hihat_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        } else if (text.includes("fast hats") || text.includes("hats rapidas") || text.includes("chimbal rápido") || text.includes("chimbal rapido") || text.includes("platillos rapidos") || text.includes("techno hats")) {
            hihat_pattern = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
        } else if (text.includes("pon hats") || text.includes("bota chimbal") || text.includes("com chimbal") || text.includes("agrega hats") || text.includes("pon platillos") || text.includes("con platillos")) {
            hihat_pattern = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
        }

        if (text.includes("agrega bateria") || text.includes("adiciona bateria") || text.includes("bota bateria") || text.includes("coloque bateria") || text.includes("pon bateria") || text.includes("mete bateria") || text.includes("activa bateria") || text.includes("con bateria") || text.includes("com bateria") || text.includes("con percusion") || text.includes("com percussão") || text.includes("add drums") || text.includes("con ritmo") || text.includes("com ritmo")) {
            if (kick_pattern.every(v => v === 0)) {
                kick_pattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
            }
            if (hihat_pattern.every(v => v === 0)) {
                hihat_pattern = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
            }
        }

        // Drop / Climax
        if (text.includes("drop") || text.includes("el drop") || text.includes("o drop") || text.includes("haz un drop") || text.includes("faça um drop") || text.includes("faca um drop") || text.includes("virada") || text.includes("climax")) {
            kick_pattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
            hihat_pattern = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
            filter_cutoff_hz = 4500;
            wave_type = "saw";
            delay_feedback = 0.4;
            reverb_mix = 0.3;
        }
    }

    const sampleWords = text.match(/(?:sample|muestra|amostra|usar)\s+([a-z0-9_-]+)/);
    if (sampleWords) {
        use_custom_sample = true;
        sample_name = sampleWords[1];
    }

    // --- 8. Effects (Delay & Reverb) ---
    if (text.includes("delay") || text.includes("eco")) {
        if (text.includes("mas delay") || text.includes("más delay") || text.includes("mais delay") || text.includes("mucho delay") || text.includes("muito delay") || text.includes("heavy delay") || text.includes("bastante delay") || text.includes("mas eco") || text.includes("más eco") || text.includes("muito eco")) {
            delay_feedback = Math.min(0.85, delay_feedback + 0.25);
        } else if (text.includes("sin delay") || text.includes("sem delay") || text.includes("no delay") || text.includes("sin eco") || text.includes("sem eco") || text.includes("quita el delay") || text.includes("tira o delay") || text.includes("apaga el delay")) {
            delay_feedback = 0.0;
        } else if (text.includes("poco delay") || text.includes("pouco delay") || text.includes("menos delay")) {
            delay_feedback = 0.15;
        } else {
            delay_feedback = 0.45;
        }
    }

    if (text.includes("reverb") || text.includes("espacio") || text.includes("espaço") || text.includes("espaco") || text.includes("catedral") || text.includes("reverberacion") || text.includes("reverberación") || text.includes("reverberação") || text.includes("reverberacao")) {
        if (text.includes("mas reverb") || text.includes("más reverb") || text.includes("mais reverb") || text.includes("mucha reverb") || text.includes("muito reverb") || text.includes("aumenta o reverb") || text.includes("cathedral") || text.includes("catedral") || text.includes("espacial")) {
            reverb_mix = Math.min(0.75, reverb_mix + 0.25);
        } else if (text.includes("sin reverb") || text.includes("sem reverb") || text.includes("no reverb") || text.includes("sin espacio") || text.includes("sem espaço") || text.includes("quita la reverb") || text.includes("tira o reverb") || text.includes("apaga la reverb")) {
            reverb_mix = 0.0;
        } else if (text.includes("poca reverb") || text.includes("pouco reverb") || text.includes("menos reverb")) {
            reverb_mix = 0.1;
        } else {
            reverb_mix = 0.35;
        }
    }

    // --- 9. Energy Calculation ---
    energy = 0.5;
    if (bpm > 128) energy += 0.2;
    if (hihat_pattern.filter(x => x === 1).length > 6) energy += 0.15;
    if (filter_cutoff_hz > 2000) energy += 0.15;
    energy = Math.max(0.1, Math.min(1.0, energy));

    // --- 10. Transition Parsing ---
    let transition = null;
    const stepsMatch = text.match(/(\d+)\s*(steps|pasos|paso|step|passos|passo)/);
    if (stepsMatch) {
        const total_steps = parseInt(stepsMatch[1]);
        let target_scale = scale;
        
        // Detect destination scale (e.g. "to A major", "a la mayor", "para Fá maior", "a C minor", "a do mayor")
        const destScaleMatch = text.match(/(?:to|a|até|ate|hasta|para)\s+(?:tono|tom|escala)?\s*\b(do|dó|re|ré|mi|fa|fá|sol|la|lá|si|[a-g])\s*(menor|mayor|minor|major|maior|m|min|maj)?\b/);
        if (destScaleMatch) {
            const rawRoot = destScaleMatch[1];
            const root = noteMap[rawRoot] || rawRoot.toUpperCase();
            const mode = (destScaleMatch[2] || '').trim();
            const isExplicitMajor = mode.includes("maj") || mode.includes("mayor") || mode.includes("major") || mode.includes("maior");
            const isExplicitMinor = mode === "m" || mode === "min" || mode.includes("menor") || mode.includes("minor");
            const isMinor = !isExplicitMajor && (isExplicitMinor || text.includes("menor") || text.includes("minor"));
            target_scale = root + (isMinor ? "m" : "");
        } else if (text.includes("a major") || text.includes("a mayor") || text.includes("a maior") || text.includes("para maior")) {
            target_scale = scale.replace("m", "");
        } else if (text.includes("a minor") || text.includes("a menor") || text.includes("para menor")) {
            target_scale = scale.endsWith("m") ? scale : scale + "m";
        }
        
        let target_cutoff = filter_cutoff_hz;
        if (text.includes("brillian") || text.includes("brillante") || text.includes("brilhante") || text.includes("bright") || text.includes("open") || text.includes("abierto") || text.includes("aberto")) {
            target_cutoff = 4500;
        }
        
        const drum_exploding = text.includes("exploding") || text.includes("explotando") || text.includes("explosion") || text.includes("explosão") || text.includes("explosao") || text.includes("virada") || text.includes("climax");
        
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

    // Return updated DSP structure
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
 * Generates a 16-note lead sequence transposed to the root name and scale mode,
 * with support for diverse musical motion styles.
 */
export function generateScaleMelody(rootName, isMinor, style = 'arpeggio') {
    const roots = { 'C': 60, 'D': 62, 'E': 64, 'F': 65, 'G': 67, 'A': 57, 'B': 59 };
    let rootMidi = roots[rootName] || 60;
    const intervals = isMinor ? [0, 2, 3, 5, 7, 8, 10, 12] : [0, 2, 4, 5, 7, 9, 11, 12];
    
    let pattern;
    if (style === 'techno') {
        pattern = [0, 0, 2, 0, 3, 2, 0, -1, 0, 0, 2, 0, 4, 3, 2, 0];
    } else if (style === 'funk') {
        pattern = [0, 2, 0, 4, 0, 2, 4, 7, 0, 2, 0, 4, 2, 0, -1, -2];
    } else if (style === 'chords') {
        pattern = [0, 4, 7, 12, 7, 4, 0, 0, 2, 5, 9, 12, 9, 5, 2, 0];
    } else if (style === 'ambient') {
        pattern = [0, 0, 4, 0, 7, 0, 11, 0, 7, 0, 4, 0, 2, 0, 0, 0];
    } else {
        // Classic rolling arpeggio
        pattern = [0, 2, 4, 7, 4, 2, 0, 7, 0, 2, 4, 7, 4, 2, -1, -2];
    }

    return pattern.map(idx => {
        if (idx === 0 && style === 'ambient' && Math.random() > 0.5) return 0; // occasional rest
        if (idx === -1) return rootMidi - 12; // Octave below
        if (idx === -2) return rootMidi - 5; // Fifth below
        const interval = intervals[Math.abs(idx) % intervals.length];
        return rootMidi + (idx < 0 ? -interval : interval);
    });
}
