/**
 * AI Manager for BrowserDJ AI.
 *
 * Orchestrates the on-device LLM engine and the rule-based NLP parser through
 * a validate -> repair -> fallback ladder. Every value returned to the app is
 * either a schema-valid DSP config (see dsp-schema.js) or null (aborted). The
 * parser (`js/parser.js`) is a first-class, always-available fallback and the
 * correctness oracle - never merely an error path.
 *
 * Public interface (kept stable so app.js is untouched):
 *   - initialize(onProgress)
 *   - generateDSPConfig(userPrompt, currentState) -> Promise<object|null>
 */

import { LiteRTLMEngine } from "./lib/litert-lm.js";
import { validateDSP } from "./lib/dsp-schema.js";
import { buildRepairPrompt } from "./lib/prompt-template.js";
import {
    parsePromptToDSP, defaultTemplate,
    DEFAULT_LOOP_STEPS, MAX_LOOP_STEPS, MAX_TRACKS
} from "./parser.js";

// Re-exported so existing importers (app, tests) keep working.
export { parsePromptToDSP, defaultTemplate, DEFAULT_LOOP_STEPS, MAX_LOOP_STEPS, MAX_TRACKS };

/** How many times to ask the model to repair invalid output before falling back. */
const MAX_REPAIR_ATTEMPTS = 1;

/**
 * Extracts and parses a JSON object from raw model text. Models sometimes wrap
 * output in prose or code fences despite instructions; this recovers the first
 * balanced `{...}` object. Returns null if nothing parseable is found.
 * @param {string} text
 * @returns {object|null}
 */
export function extractJson(text) {
    if (typeof text !== "string") return null;
    const trimmed = text.trim();

    // Fast path: the whole thing is JSON.
    try {
        return JSON.parse(trimmed);
    } catch { /* fall through to extraction */ }

    // Strip markdown code fences if present.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1].trim() : trimmed;

    // Find the first balanced brace-delimited object.
    const start = candidate.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < candidate.length; i++) {
        const ch = candidate[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(candidate.slice(start, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

export class AIManager {
    constructor() {
        this.engine = null;
        this.usingRealModel = false;
        this.currentAbortController = null;
    }

    /**
     * Initializes the on-device LLM engine, falling back to the parser-only
     * mock engine if WebGPU/the model/the dependency are unavailable. Always
     * resolves; drives the UI loader via onProgress.
     * @param {(fraction:number)=>void} [onProgress]
     */
    async initialize(onProgress) {
        try {
            this.engine = await LiteRTLMEngine.create({ onProgress });
            this.usingRealModel = true;
        } catch (err) {
            console.warn("On-device LLM unavailable; using rule-based parser fallback.", err.message || err);
            this.engine = this._makeParserEngine();
            this.usingRealModel = false;
            if (onProgress) onProgress(1.0);
        }
    }

    /**
     * A parser-backed engine satisfying the same interface as the real engine.
     * This is the transparent fallback: same shape, no GPU, no model.
     */
    _makeParserEngine() {
        return {
            createConversation: async () => ({
                sendMessage: async (prompt, currentState = null) => ({
                    text: JSON.stringify(parsePromptToDSP(prompt, currentState))
                })
            })
        };
    }

    /**
     * Translates a prompt into a schema-valid DSP config.
     *
     * Ladder:
     *   1. Abort any in-flight inference (new prompt wins).
     *   2. Run the engine; extract + validate its JSON.
     *   3. On invalid output, ask the model to repair (up to MAX_REPAIR_ATTEMPTS).
     *   4. On repair failure / error / non-JSON, fall back to the parser.
     * Aborted inference returns null. The result always passes validateDSP
     * (or is null).
     *
     * @param {string} userPrompt
     * @param {object|null} currentState
     * @returns {Promise<object|null>}
     */
    async generateDSPConfig(userPrompt, currentState = null) {
        // 1. New prompt aborts the previous one.
        if (this.currentAbortController) {
            this.currentAbortController.abort();
        }
        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;

        try {
            const conversation = await this.engine.createConversation({ signal });

            // 2. First inference attempt.
            let response = await conversation.sendMessage(userPrompt, currentState);
            let candidate = extractJson(response.text);
            let result = validateDSP(candidate);
            if (result.valid) {
                this.currentAbortController = null;
                return candidate;
            }

            // 3. Repair attempts (only meaningful for the real model; the parser
            //    engine already returns valid output, so this loop is a no-op there).
            for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt++) {
                if (signal.aborted) return null;
                const repairPrompt = buildRepairPrompt(userPrompt, currentState, response.text, result.errors);
                response = await conversation.sendMessage(repairPrompt, currentState);
                candidate = extractJson(response.text);
                result = validateDSP(candidate);
                if (result.valid) {
                    this.currentAbortController = null;
                    return candidate;
                }
            }

            // 4. Model could not produce valid output -> parser fallback.
            console.warn("Model output failed validation after repair; using parser fallback.", result.errors);
            this.currentAbortController = null;
            return parsePromptToDSP(userPrompt, currentState);
        } catch (error) {
            if (error.name === "AbortError") {
                return null;
            }
            console.warn("AI generation error; using parser fallback.", error.message || error);
            this.currentAbortController = null;
            return parsePromptToDSP(userPrompt, currentState);
        }
    }
}
