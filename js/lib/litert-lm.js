/**
 * Real on-device LLM engine wrapper (MediaPipe LLM Inference, WebGPU).
 *
 * Replaces the former facade. This class is a thin adapter over
 * `@mediapipe/tasks-genai` that satisfies the engine contract AIManager
 * depends on:
 *
 *     engine.createConversation({ systemPrompt, signal })
 *        -> { sendMessage(prompt, currentState) -> { text } }
 *
 * Design notes:
 *  - The MediaPipe dependency is imported *dynamically* so the app still loads
 *    and runs (on the parser fallback) when the package is not installed yet
 *    (Gate B1) or when WebGPU is unavailable. A load failure throws, and
 *    AIManager treats a throw as "use the parser".
 *  - The model binary is fetched/cached via model-loader.js (OPFS).
 *  - The prompt is built by prompt-template.js; this wrapper stays dumb about
 *    prompt content and schema.
 */

import { loadModel } from "./model-loader.js";
import { buildInferencePrompt } from "./prompt-template.js";

/** Default model configuration. The URL is same-origin so the app stays offline-first
 *  after first load; pin the concrete file/quantization at Gate B1. */
export const DEFAULT_MODEL_CONFIG = {
    // Same-origin path; the binary is provisioned out-of-band (LFS / release asset).
    modelUrl: "models/gemma-2-2b-it-gpu-int4.task",
    fileName: "gemma-2-2b-it-gpu-int4.task",
    maxTokens: 1024,
    // MediaPipe WASM/loader assets, served locally (not a CDN) to preserve offline-first.
    wasmBasePath: "mediapipe/wasm"
};

export class LiteRTLMEngine {
    /**
     * @param {object} llmInference the constructed MediaPipe LlmInference instance
     * @param {object} config resolved model config
     */
    constructor(llmInference, config) {
        this.llm = llmInference;
        this.config = config;
    }

    /**
     * Loads WASM + model and constructs the real inference engine.
     * Throws if WebGPU is unavailable, the dependency is missing, or the model
     * fails to load. AIManager catches the throw and falls back to the parser.
     *
     * @param {object} options
     * @param {(fraction:number)=>void} [options.onProgress]
     * @param {object} [options.config] override DEFAULT_MODEL_CONFIG
     * @returns {Promise<LiteRTLMEngine>}
     */
    static async create(options = {}) {
        const config = { ...DEFAULT_MODEL_CONFIG, ...(options.config || {}) };
        const onProgress = options.onProgress;

        if (typeof navigator === "undefined" || !navigator.gpu) {
            throw new Error("WebGPU is not available; on-device LLM disabled.");
        }

        // Dynamic import so a missing package does not break module load. The
        // specifier is held in a variable (and marked @vite-ignore) so neither
        // Vite's dev-server import-analysis nor the Rollup production build try
        // to statically resolve this optional peer dependency. When it is not
        // installed the runtime import rejects and we fall back to the parser
        // below.
        let genai;
        try {
            const genaiPkg = "@mediapipe/tasks-genai";
            genai = await import(/* @vite-ignore */ genaiPkg);
        } catch (err) {
            throw new Error("@mediapipe/tasks-genai is not installed; on-device LLM disabled.");
        }
        const { FilesetResolver, LlmInference } = genai;

        // Stream + cache the model binary (progress 0..~0.9 reserved for download).
        const { objectUrl, revoke } = await loadModel({
            modelUrl: config.modelUrl,
            fileName: config.fileName,
            onProgress: onProgress ? (f) => onProgress(f * 0.9) : undefined
        });

        // Resolve the local WASM assets and build the inference engine.
        const fileset = await FilesetResolver.forGenAiTasks(config.wasmBasePath);
        const llm = await LlmInference.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: objectUrl },
            maxTokens: config.maxTokens
        });

        // Once the runtime has ingested the model, free the multi-gigabyte Blob
        // held alive by the object URL to avoid memory bloat / OOM on-device.
        if (revoke) revoke();

        if (onProgress) onProgress(1);
        return new LiteRTLMEngine(llm, config);
    }

    /**
     * Opens a conversation. The system prompt is folded into each inference
     * prompt by prompt-template.js, so it is retained here only for parity with
     * the prior interface.
     */
    async createConversation(options = {}) {
        return new LiteRTLMConversation(this.llm, options.signal);
    }
}

class LiteRTLMConversation {
    constructor(llm, signal) {
        this.llm = llm;
        this.signal = signal;
    }

    /**
     * Runs a single inference. Builds the full prompt from the current state,
     * asks the model for the DSP JSON, and returns the raw text. Schema
     * validation and repair/fallback happen in AIManager, not here.
     *
     * @param {string} userPrompt
     * @param {object|null} currentState
     * @returns {Promise<{ text: string }>}
     */
    async sendMessage(userPrompt, currentState = null) {
        this._throwIfAborted();
        const prompt = buildInferencePrompt(userPrompt, currentState);
        const text = await this.llm.generateResponse(prompt);
        this._throwIfAborted();
        return { text };
    }

    _throwIfAborted() {
        if (this.signal && this.signal.aborted) {
            const err = new Error("Inference aborted by system controller.");
            err.name = "AbortError";
            throw err;
        }
    }
}
