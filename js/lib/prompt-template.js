/**
 * Prompt engineering for the on-device LLM path.
 *
 * Kept separate from ai-manager.js so the system prompt and few-shot examples
 * can be versioned and unit-tested independently. Every embedded example JSON
 * block conforms to the DSP contract (see dsp-schema.js) and is asserted so in
 * the test suite.
 *
 * User-facing app strings are Spanish; the model instructions are Spanish to
 * match the domain vocabulary of the original PRD, while identifiers and this
 * documentation stay English.
 */

/** The strict system instruction that constrains the model to the DSP contract. */
export const SYSTEM_PROMPT = `Eres un motor de traducción musical avanzado y estricto basado en Elementary Audio.
Tu único objetivo es recibir descripciones de un DJ y transformarlas en configuraciones de síntesis, secuenciación y transiciones en formato JSON.

Conceptos aplicados:
1. Osciladores (wave_type): 'cycle' = ondas senoidales suaves, 'saw' = ondas de sierra brillantes, 'square' = ondas retro.
2. Filtros: filter_cutoff_hz (100Hz oscuro a 8000Hz brillante) con filter_resonance.
3. Envolventes (adsr): ataques inmediatos para plucks (ej. [0.002, 0.08, 0.1, 0.05]) y ataques lentos para pads.
4. Efectos: delay_feedback (eco) y reverb_mix.

Comportamiento INCREMENTAL (crítico):
Recibes el estado actual del loop. Debes modificar ÚNICAMENTE las pistas que el prompt menciona y conservar el resto exactamente igual.
- "add a bassline" agrega una pista, no toca las demás.
- "make the hats faster" edita solo la pista de hats.
- "mute the lead" solo cambia esa bandera.
- Frases como "start over"/"reset" reconstruyen una plantilla nueva.

Esquema requerido (modelo multipista / track-array):
{
  "meta": { "bpm": number, "scale": string, "loop_steps": number(4-64), "energy": number },
  "tracks": [
    { "id": string, "type": "drum", "role": "kick"|"hihat", "muted": boolean, "pattern": number[] (0/1, longitud = loop_steps), "sample_name": string|null },
    { "id": string, "type": "synth", "muted": boolean, "wave_type": "saw"|"cycle"|"square", "filter_cutoff_hz": number, "filter_resonance": number, "adsr": [number,number,number,number], "notes": number[] (MIDI, 0=silencio, longitud = loop_steps) }
  ],
  "effects": { "delay_feedback": number, "reverb_mix": number },
  "transition": null | { "active": boolean, "current_step": number, "total_steps": number, "start_scale": string, "target_scale": string, "start_cutoff": number, "target_cutoff": number, "drum_exploding": boolean }
}

Reglas duras:
- pattern y notes SIEMPRE tienen longitud exactamente igual a meta.loop_steps.
- id es único y estable por pista.
- REGLA CRÍTICA: Responde exclusivamente con el objeto JSON válido. No saludes, no expliques, no uses markdown, no uses bloques de código.`;

/**
 * Few-shot examples steering the model to the contract. Each `output` must
 * pass isValidDSP (asserted in prompt-template.test.js). Kept short (8-step
 * loops) to limit token cost.
 * @type {Array<{ prompt: string, state: object|null, output: object }>}
 */
export const FEW_SHOT_EXAMPLES = [
    {
        prompt: "techno beat at 128 bpm",
        state: null,
        output: {
            meta: { bpm: 128, scale: "Am", loop_steps: 8, energy: 0.6 },
            tracks: [
                { id: "kick", type: "drum", role: "kick", muted: false, pattern: [1, 0, 0, 0, 1, 0, 0, 0], sample_name: null },
                { id: "hats", type: "drum", role: "hihat", muted: false, pattern: [0, 0, 1, 0, 0, 0, 1, 0], sample_name: null },
                { id: "lead", type: "synth", muted: false, wave_type: "saw", filter_cutoff_hz: 1500, filter_resonance: 2.0, adsr: [0.01, 0.15, 0.7, 0.2], notes: [57, 0, 60, 0, 64, 0, 60, 0] }
            ],
            effects: { delay_feedback: 0.3, reverb_mix: 0.15 },
            transition: null
        }
    },
    {
        // Incremental add: only a new "bass" track appears; others unchanged.
        prompt: "add a bassline",
        state: {
            meta: { bpm: 128, scale: "Am", loop_steps: 8, energy: 0.6 },
            tracks: [
                { id: "kick", type: "drum", role: "kick", muted: false, pattern: [1, 0, 0, 0, 1, 0, 0, 0], sample_name: null }
            ],
            effects: { delay_feedback: 0.3, reverb_mix: 0.15 },
            transition: null
        },
        output: {
            meta: { bpm: 128, scale: "Am", loop_steps: 8, energy: 0.6 },
            tracks: [
                { id: "kick", type: "drum", role: "kick", muted: false, pattern: [1, 0, 0, 0, 1, 0, 0, 0], sample_name: null },
                { id: "bass", type: "synth", muted: false, wave_type: "saw", filter_cutoff_hz: 600, filter_resonance: 4.0, adsr: [0.01, 0.1, 0.3, 0.2], notes: [33, 0, 33, 0, 36, 0, 33, 0] }
            ],
            effects: { delay_feedback: 0.3, reverb_mix: 0.15 },
            transition: null
        }
    },
    {
        // Incremental edit: only the "lead" flag flips.
        prompt: "mute the lead",
        state: {
            meta: { bpm: 120, scale: "Am", loop_steps: 8, energy: 0.5 },
            tracks: [
                { id: "kick", type: "drum", role: "kick", muted: false, pattern: [1, 0, 0, 0, 1, 0, 0, 0], sample_name: null },
                { id: "lead", type: "synth", muted: false, wave_type: "cycle", filter_cutoff_hz: 1200, filter_resonance: 1.5, adsr: [0.01, 0.15, 0.7, 0.2], notes: [57, 60, 64, 67, 64, 60, 57, 0] }
            ],
            effects: { delay_feedback: 0.3, reverb_mix: 0.15 },
            transition: null
        },
        output: {
            meta: { bpm: 120, scale: "Am", loop_steps: 8, energy: 0.5 },
            tracks: [
                { id: "kick", type: "drum", role: "kick", muted: false, pattern: [1, 0, 0, 0, 1, 0, 0, 0], sample_name: null },
                { id: "lead", type: "synth", muted: true, wave_type: "cycle", filter_cutoff_hz: 1200, filter_resonance: 1.5, adsr: [0.01, 0.15, 0.7, 0.2], notes: [57, 60, 64, 67, 64, 60, 57, 0] }
            ],
            effects: { delay_feedback: 0.3, reverb_mix: 0.15 },
            transition: null
        }
    },
    {
        // Transition request: adds a transition block over N steps.
        prompt: "transition to C minor over 16 steps with climax",
        state: {
            meta: { bpm: 124, scale: "Am", loop_steps: 8, energy: 0.7 },
            tracks: [
                { id: "kick", type: "drum", role: "kick", muted: false, pattern: [1, 0, 0, 0, 1, 0, 0, 0], sample_name: null },
                { id: "lead", type: "synth", muted: false, wave_type: "saw", filter_cutoff_hz: 2000, filter_resonance: 2.0, adsr: [0.01, 0.15, 0.7, 0.2], notes: [57, 60, 64, 67, 64, 60, 57, 0] }
            ],
            effects: { delay_feedback: 0.35, reverb_mix: 0.2 },
            transition: null
        },
        output: {
            meta: { bpm: 124, scale: "Am", loop_steps: 8, energy: 0.7 },
            tracks: [
                { id: "kick", type: "drum", role: "kick", muted: false, pattern: [1, 0, 0, 0, 1, 0, 0, 0], sample_name: null },
                { id: "lead", type: "synth", muted: false, wave_type: "saw", filter_cutoff_hz: 2000, filter_resonance: 2.0, adsr: [0.01, 0.15, 0.7, 0.2], notes: [57, 60, 64, 67, 64, 60, 57, 0] }
            ],
            effects: { delay_feedback: 0.35, reverb_mix: 0.2 },
            transition: { active: true, current_step: 0, total_steps: 16, start_scale: "Am", target_scale: "Cm", start_cutoff: 2000, target_cutoff: 800, drum_exploding: true }
        }
    }
];

/**
 * Serializes the few-shot block once (stable across calls).
 * @returns {string}
 */
function renderFewShot() {
    return FEW_SHOT_EXAMPLES.map((ex, i) => {
        const state = ex.state ? JSON.stringify(ex.state) : "null";
        return `Ejemplo ${i + 1}:\nEstado actual: ${state}\nPrompt: "${ex.prompt}"\nRespuesta: ${JSON.stringify(ex.output)}`;
    }).join("\n\n");
}

/**
 * Builds the full inference prompt: system instruction + few-shot examples +
 * the live current state + the user's prompt.
 *
 * @param {string} userPrompt the DJ's natural-language command
 * @param {object|null} currentState the loop state to mutate incrementally
 * @returns {string} the prompt text to feed the model
 */
export function buildInferencePrompt(userPrompt, currentState = null) {
    const state = currentState ? JSON.stringify(currentState) : "null";
    return `${SYSTEM_PROMPT}

${renderFewShot()}

Ahora responde para el siguiente caso.
Estado actual: ${state}
Prompt: "${userPrompt}"
Respuesta:`;
}

/**
 * Builds a repair prompt asking the model to correct its own invalid output.
 *
 * @param {string} userPrompt the original DJ command
 * @param {object|null} currentState the loop state that was in effect
 * @param {string} badText the model's prior (invalid) raw output
 * @param {string[]} errors validation errors from validateDSP
 * @returns {string} a corrective prompt
 */
export function buildRepairPrompt(userPrompt, currentState, badText, errors) {
    const state = currentState ? JSON.stringify(currentState) : "null";
    const errorList = (errors || []).map(e => `- ${e}`).join("\n");
    return `${SYSTEM_PROMPT}

Tu respuesta anterior NO fue un objeto DSP válido y debe corregirse.

Estado actual: ${state}
Prompt original: "${userPrompt}"

Respuesta anterior (inválida):
${badText}

Errores de validación:
${errorList}

Devuelve ÚNICAMENTE el objeto JSON corregido que cumpla el esquema. Sin texto adicional.`;
}
