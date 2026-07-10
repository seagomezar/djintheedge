# Spec: Real On-Device LLM (Track 1)

> Status: Feature spec, ready to plan.
> Scope: Replace the `LiteRTLMEngine` facade in `js/lib/litert-lm.js` with genuine in-browser LLM inference, while keeping the rule-based `parsePromptToDSP` parser as an always-available fallback.
> This is a focused companion to the living inventory in [`spec.md`](../spec.md).
> It does not restate the whole app; it inherits the DSP JSON contract (Section A.1 of `spec.md`) verbatim as its output target.

---

## Objective

Turn the on-device "AI" from a labeled facade into a real, private, offline LLM that translates natural-language DJ prompts into schema-valid DSP JSON, running entirely in the browser via WebGPU.

**Target users:** the same live performers, bedroom producers, and creative technologists the app already serves - now getting genuine language understanding (paraphrases, compound instructions, intent the regex parser misses) without giving up privacy, offline use, or the sub-400ms feel.

**Why now:** the app already ships COOP/COEP cross-origin-isolation headers, an `AbortController` concurrency model, a stable DSP JSON contract, and a UI that already renders a model-loading progress bar. The only fake part of the pipeline is the model itself. This is the highest-leverage remaining "honesty gap" called out in `spec.md` §A.3.

**Success looks like:**
- On a WebGPU-capable machine, a prompt produces valid, schema-conforming DSP JSON from a *real* local model, with time-to-first-token < 400ms after the model is warm.
- On first run the model binary streams to OPFS with visible progress; on later runs it restores from OPFS with no network call.
- With no WebGPU, no model, a load failure, or malformed model output, the `parsePromptToDSP` fallback is transparent - the app stays 100% functional and the user is never blocked.
- Nothing leaves the machine. No API keys, no server calls, no telemetry.

### Non-goals

- Multi-turn chat/memory beyond the single-prompt → DSP translation the app already does.
- Model fine-tuning or training.
- Replacing or rewriting the rule-based parser - it stays as the fallback and the correctness oracle.
- Changing the DSP JSON contract (`spec.md` §A.1). This feature must emit exactly that schema.
- Streaming token-by-token UI. We need the final JSON object, not a typewriter effect.

---

## Runtime & Approach (decisions)

- **Runtime:** MediaPipe LLM Inference (`@mediapipe/tasks-genai`), WebGPU backend, loading a Gemma `.task`/`.litertlm` bundle. Chosen because it matches the existing facade's naming/model path, caches to OPFS, and has a small, stable JS surface.
- **Model:** a small instruction-tuned Gemma variant (target ~2B, 4-bit) sized to load and run on consumer GPUs. Exact filename/quantization pinned during planning; the loader must treat the model URL/version as configuration, not a hardcoded literal scattered across files.
- **JSON safety:** constrained decoding where the runtime supports it, then **validate against the §A.1 schema**, then **one repair retry**, then **fall back to the parser**. The model is never trusted to be well-formed; the schema validator is the gate.
- **Fallback is first-class, not an error path:** parser fallback is a supported, tested mode - not just a `catch`.

---

## Commands

No new scripts. Inherits the existing toolchain from `package.json`:

```
Install:      npm install
Dev server:   npm run dev            # vite (http://localhost:5173); requires COOP/COEP headers already in vite.config.js
Build:        npm run build          # vite build
Preview:      npm run preview        # serve the production build
Test:         npm test               # vitest run (single pass, CI-friendly)
Test (watch): npx vitest
```

New dev/runtime notes:
- Adds one runtime dependency: `@mediapipe/tasks-genai`. This crosses the "pure web / no runtime deps" line in `spec.md` §Boundaries, so it is called out explicitly and must be confirmed before install (see Boundaries below).
- Requires a WebGPU-capable Chromium browser for the real path; the fallback path has no such requirement.
- The MediaPipe WASM/loader assets and the model binary must be served locally (bundled or vendored), not fetched from a CDN at runtime, to preserve the offline-first guarantee.

---

## Project Structure

Changes are contained to the AI layer. The audio engine, parser, sequencer, and UI are untouched except for the loader-status wiring that already exists.

```
djintheedge/
├── js/
│   ├── ai-manager.js                 # CHANGED: orchestrates real engine + fallback; owns schema validation & repair-retry
│   ├── parser.js                     # UNCHANGED: rule-based fallback + correctness oracle
│   └── lib/
│       ├── litert-lm.js              # REPLACED: real MediaPipe LlmInference wrapper (was the facade)
│       ├── model-loader.js           # NEW: OPFS streaming download, cache restore, progress reporting
│       ├── dsp-schema.js             # NEW: DSP JSON schema + validate()/isValidDSP() used by both LLM and tests
│       └── prompt-template.js        # NEW: system prompt + few-shot examples that steer the model to §A.1 JSON
├── tests/
│   ├── audio-engine.test.js          # UNCHANGED (existing coverage)
│   ├── dsp-schema.test.js            # NEW: schema validator accepts good contracts, rejects malformed ones
│   └── ai-manager.test.js            # NEW: engine-selection, validate→repair→fallback ladder, abort behavior (engine mocked)
└── specs/
    └── on-device-llm.md              # this spec
```

Design intent:
- `dsp-schema.js` becomes the single source of truth for "is this a valid DSP contract" and is shared by the LLM path, the repair step, and tests. The parser's output must also pass it.
- `model-loader.js` isolates all OPFS/download/caching so it can be tested and swapped without touching inference.
- `ai-manager.js` keeps its current public interface (`initialize(onProgress)`, `generateDSPConfig(userPrompt, currentState)`) so `app.js` needs no changes.

---

## Code Style

Follows the existing conventions (`spec.md` §Code Style):

- ES6 modules; `class`-based where a component owns state (engine wrapper, manager), free functions for pure logic (schema validation, prompt building).
- 4-space indentation, double quotes, JSDoc on public methods.
- User-facing strings stay Spanish; identifiers, comments, and this spec stay English.
- Escape any user-derived text before it touches the DOM (unchanged).
- The system prompt / few-shot examples live in `prompt-template.js`, not inlined as a giant string literal in the manager, so they can be versioned and tested.
- No secrets, no network endpoints, no analytics calls anywhere in the new code.
- Keep `generateDSPConfig` non-blocking to the audio thread - inference runs off the audio path; the sequencer keeps playing the last valid loop while a prompt is in flight.

---

## Behavior: the inference pipeline

`generateDSPConfig(userPrompt, currentState)` resolves in this order. Every prompt lands on exactly one branch and always returns either a valid DSP object or `null` (abort). It never throws to the caller and never returns malformed JSON.

1. **Abort in-flight.** A new prompt aborts the previous inference via the existing `AbortController`; the aborted call returns `null` (current behavior preserved).
2. **Engine ready?** If the real engine loaded, attempt real inference; otherwise go straight to the parser.
3. **Real inference.** Build the prompt from `prompt-template.js` + `currentState`, run constrained decoding, get text.
4. **Validate.** Parse the text and run it through `dsp-schema.isValidDSP()`. On success, return it.
5. **Repair retry (once).** On invalid output, re-prompt the model with the validation error and its own prior output asking for a corrected object. Validate again.
6. **Fallback.** If the repair still fails, or the model errored, or inference timed out, return `parsePromptToDSP(userPrompt, currentState)`. Log at `warn`, not `error` - this is an expected, supported mode.

Additional invariants:
- **Incremental semantics preserved.** The model receives `currentState` and is instructed to mutate only what the prompt targets (matching the parser's additive behavior). If it returns a wholesale replacement when only an edit was asked, that is a quality issue tracked separately, not a correctness failure - the output still validates.
- **Warm vs cold.** The < 400ms TTFT target applies once the model is loaded. First-run model download is a separate, progress-reported operation and is explicitly exempt from the 400ms budget.
- **Loading UX.** `initialize(onProgress)` drives the existing loading bar with *real* download/init progress from `model-loader.js`. On fallback, it resolves progress to complete instantly (current behavior) so the UI never hangs.

---

## Testing Strategy

Framework unchanged: Vitest (`npm test` for CI, `npx vitest` for watch). Node/Vitest has no WebGPU or OPFS, so the real engine and storage are **mocked** at their module boundary; the branching logic, validation, and fallback ladder are what we assert.

**Automated (must ship with the feature):**
- **Schema tests (`dsp-schema.test.js`):** the validator accepts every fixture from `spec.md` §A.1 (drum + synth tracks, transition block, effects), and rejects malformed variants (wrong `type`, pattern length ≠ `loop_steps` beyond the wrap rule, `loop_steps` out of the 4-64 range, missing `tracks`, non-array `notes`). `parsePromptToDSP` output is asserted to pass the validator - the parser and the LLM share one contract.
- **Manager ladder (`ai-manager.test.js`)**, engine mocked:
  - Real engine returns valid JSON → returned as-is, parser not called.
  - Real engine returns malformed JSON → repair retry invoked; repaired-valid → returned.
  - Repair still invalid → parser fallback returned, and the result validates.
  - Engine throws / rejects → parser fallback returned.
  - No engine (WebGPU unsupported / load failed) → parser used directly, `onProgress(1.0)` fired.
  - New prompt aborts prior inference → prior call returns `null`; abort is not treated as failure.
- **Loader tests (`model-loader.js`)** with OPFS + fetch mocked: progress callbacks are monotonic 0→1; a cached model restores without a network fetch; a download failure surfaces as a recoverable error that triggers fallback.
- Every new parser rule or schema change ships with a test (existing rule from `spec.md`).

**Manual E2E (browser, Chrome/Edge, per `spec.md` §Testing):**
- First run: model streams to OPFS with visible progress, then a prompt yields audible music from the real model.
- Reload: model restores from OPFS with the network tab showing no model fetch; verify offline (DevTools offline mode) still works after first load.
- Warm TTFT: measure prompt→audio-change latency < 400ms.
- Force fallback: disable WebGPU (or point the model URL at a missing file) and confirm the app is fully functional via the parser with no user-visible error state.
- No console errors, no audio-thread overload, and playback never stalls while a prompt is inferring.

**Bug protocol (from global + `spec.md`):** reproduce E2E as a user first, add a failing test, then fix.

---

## Boundaries

**Always:**
- Keep inference off the audio path; the sequencer keeps playing the last valid loop during inference.
- On malformed, missing, aborted, or errored model output, fall back to a valid default/parser DSP graph rather than throwing.
- Serve MediaPipe assets and the model binary locally so the app stays offline-first with no runtime network dependency after first load.
- Validate every model output against `dsp-schema.js` before it reaches the audio engine.
- Run `npm test` before committing; ship tests for the schema validator, the fallback ladder, and any new parser/schema change.
- Keep `ai-manager.js`'s public interface (`initialize`, `generateDSPConfig`) stable so `app.js` is untouched.

**Ask first (explicit approval required before doing):**
- **Installing `@mediapipe/tasks-genai`** or any other runtime dependency - this changes the "pure web, zero runtime deps" architecture in `spec.md` §Boundaries.
- Choosing/pinning the specific model file, quantization, and where its binary is hosted/vendored (size, license, and repo-bloat implications).
- Any change to the DSP JSON contract (`spec.md` §A.1) - it is shared by parser, LLM, schema, and engine.
- Committing a multi-hundred-MB/GB model binary into the git repo (prefer a separate artifact store / release asset / Git LFS decision).
- CI or persistence-config changes.

**Never:**
- Send prompts, model output, or any user data to a remote server; no API keys; no network dependency for the core loop after the one-time model fetch.
- Present the model as real in user-facing copy while it is still stubbed - the "honesty note" rule from `spec.md` stands until this ships for real.
- Let unvalidated model output reach the audio engine.
- Introduce audio clicks/pops or stall playback because inference is slow or failed.
- Remove or skip failing tests without approval.

---

## Success Criteria (feature-level)

1. **Real inference:** on a WebGPU machine, prompts are answered by a genuine local model emitting §A.1-conforming JSON (verifiable: disabling the parser fallback still produces valid music for well-formed prompts).
2. **Warm speed:** TTFT < 400ms once loaded; audio changes feel instant.
3. **OPFS caching:** first run downloads with real progress; subsequent runs restore from OPFS with zero model network fetch; works offline thereafter.
4. **Transparent fallback:** no WebGPU / no model / load failure / malformed output all resolve to a fully functional parser-driven experience with no dead-end error state.
5. **Contract safety:** 100% of outputs reaching the audio engine pass `dsp-schema.isValidDSP()`.
6. **Privacy:** network inspection shows no data leaving the machine beyond the one-time model/asset fetch.
7. **No regressions:** existing `audio-engine.test.js` and all manual E2E flows from `spec.md` still pass; `app.js` unchanged.

---

## Open Questions

1. **Model choice & hosting:** which exact Gemma variant/quantization, and do we vendor the binary in-repo (LFS), fetch from a pinned same-origin path on first run, or ship it as a release asset? Directly gated by the "ask first" items above.
2. **Constrained decoding depth:** does the chosen MediaPipe build expose grammar/JSON-mode constraints, or do we rely on prompt-engineering + validate + repair only? Affects how strict the schema step must be.
3. **Repair budget:** is one repair retry the right ceiling, or should it scale with remaining latency budget before the 400ms/parser-fallback cutoff?
4. **Incremental-edit fidelity:** how do we measure/guard that the model honors `currentState` additive semantics as reliably as the parser (a shared eval set of prompt→expected-diff cases)?
5. **Model size vs. UX:** what is the acceptable first-run download ceiling before we prompt the user to opt in to the download rather than starting it automatically?
