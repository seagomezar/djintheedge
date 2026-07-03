/**
 * AI Manager for BrowserDJ AI.
 * Handles the LiteRT-LM WebGPU session facade and threads the current loop
 * state through to the rule-based NLP parser (`js/parser.js`), which it
 * re-exports for backward compatibility.
 */

import { LiteRTLMEngine } from './lib/litert-lm.js';
import { parsePromptToDSP, defaultTemplate, DEFAULT_LOOP_STEPS, MAX_LOOP_STEPS, MAX_TRACKS } from './parser.js';

// Re-exported so existing importers (litert-lm, app, tests) keep working.
export { parsePromptToDSP, defaultTemplate, DEFAULT_LOOP_STEPS, MAX_LOOP_STEPS, MAX_TRACKS };

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
        
        Esquema requerido (modelo multipista / track-array):
        {
          "meta": { "bpm": number, "scale": string, "loop_steps": number, "energy": number },
          "tracks": [
            { "id": string, "type": "drum", "role": "kick"|"hihat", "muted": boolean, "pattern": number[], "sample_name": string|null },
            { "id": string, "type": "synth", "muted": boolean, "wave_type": "saw"|"cycle"|"square", "filter_cutoff_hz": number, "filter_resonance": number, "adsr": number[], "notes": number[] }
          ],
          "effects": { "delay_feedback": number, "reverb_mix": number },
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
                    sendMessage: async (prompt, currentState = null) => {
                        const dspJson = parsePromptToDSP(prompt, currentState);
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
