# Plan: Real On-Device LLM (Track 1)

> Implements [`specs/on-device-llm.md`](on-device-llm.md).
> Sequenced so the app is shippable and honest at every milestone: the schema/validation/fallback scaffolding lands and is fully tested **before** any real model or new dependency is introduced.
> Blocking gates ("ask first" from the spec) are called out inline - do not cross them without explicit approval.

---

## Guiding constraints (carried from the spec)

- `ai-manager.js` public interface (`initialize(onProgress)`, `generateDSPConfig(userPrompt, currentState)`) stays stable → `app.js` is untouched.
- Every output reaching the audio engine must pass `dsp-schema.isValidDSP()`.
- Parser fallback is a first-class, tested mode - never just a `catch`.
- No runtime dependency installed and no model binary committed without approval (Gates B1/B2).
- `npm test` green before each commit; new logic ships with its tests.

---

## Milestone 0 - Schema contract, extracted and tested (no deps, no model)

Goal: make the DSP contract executable and shared, with zero behavior change to the running app.

- **Task 0.1 - `js/lib/dsp-schema.js`.** Extract the §A.1 contract into a pure module exporting `isValidDSP(obj)` (boolean) and `validateDSP(obj)` (returns `{ valid, errors[] }`). Encodes: `meta` shape and ranges (`loop_steps` 4-64, numeric bpm/energy); `tracks` is a non-empty array; each track has a unique string `id` and `type ∈ {drum,synth}`; drums have `role ∈ {kick,hihat}` + numeric 0/1 `pattern`; synths have numeric `notes`, `wave_type ∈ {saw,cycle,square}`, numeric cutoff/resonance, 4-length `adsr`; `effects` and optional `transition` block shape.
  - *AC:* pure, no imports from the engine; hand-validation against the §A.1 fixture passes.
- **Task 0.2 - `tests/dsp-schema.test.js`.** Accepts the §A.1 drum+synth+transition fixture and the `trackConfig()` fixture from `audio-engine.test.js`. Rejects: bad `type`, `loop_steps` out of range, missing `tracks`, non-array `notes`, bad `wave_type`, malformed `adsr`.
  - *AC:* `npm test` green.
- **Task 0.3 - Parser conformance test.** Assert `parsePromptToDSP(...)` output passes `isValidDSP` for a spread of prompts (default template, genre presets, transition request, gibberish-with-state). This locks the "parser and LLM share one contract" invariant.
  - *AC:* green; if the parser emits anything the schema rejects, fix the **schema** to match documented reality (or file a parser bug) - do not loosen the schema silently. Log any discrepancy found.

Dependencies: none. **Fully shippable.** Commit after 0.3.

---

## Milestone 1 - Manager refactor to the fallback ladder (still no real model)

Goal: restructure `ai-manager.js` around the validate→repair→fallback pipeline from the spec, with the current mock engine still standing in for the real one. Behavior stays correct; structure becomes testable and ready to accept a real engine.

- **Task 1.1 - Engine abstraction seam.** Define the engine contract the manager depends on: `createConversation({systemPrompt, signal})` → `{ sendMessage(prompt, currentState) → { text } }`. Both the (future) real engine and the fallback mock satisfy it. Depends on: nothing.
- **Task 1.2 - Pipeline in `generateDSPConfig`.** Implement the ordered ladder: abort-in-flight → engine attempt → `JSON.parse` guarded → `validateDSP` → one repair retry → `parsePromptToDSP` fallback. Abort returns `null`; all other failures return a valid parser result. Fallback logs at `warn`. Depends on: 0.1, 1.1.
- **Task 1.3 - Repair step.** Given invalid model text + validation errors, re-issue one `sendMessage` asking for a corrected object (prompt lives in `prompt-template.js`, Task 2.x - until then, stub the repair call so the ladder falls straight through to the parser). Depends on: 1.2.
- **Task 1.4 - `tests/ai-manager.test.js`** with a mock engine injected: valid→passthrough (parser not called), malformed→repair→valid, repair-still-invalid→parser fallback (result validates), engine-throws→fallback, no-engine→parser + `onProgress(1.0)`, new-prompt-aborts-prior→`null`. Depends on: 1.2, 1.3.
  - *AC:* all six branches asserted; existing `audio-engine.test.js` still green; `app.js` unchanged.

Dependencies: Milestone 0. **Shippable** - app still runs on the parser, now with a real validation gate protecting the engine boundary.

Commit after 1.4.

---

## Milestone 2 - Prompt engineering module (no model yet, but exercised via mock)

Goal: version the system prompt + few-shot examples separately so they can be tested and iterated without touching manager logic.

- **Task 2.1 - `js/lib/prompt-template.js`.** Export `buildInferencePrompt(userPrompt, currentState)` and `buildRepairPrompt(badText, errors)`. Migrate the Spanish system prompt currently inlined in `ai-manager.js` here; add 2-4 few-shot `prompt → DSP JSON` examples covering add/edit/mute/transition, each example itself passing `isValidDSP`. Depends on: 0.1.
- **Task 2.2 - Tests.** Few-shot example JSON blocks all pass `isValidDSP`; `buildInferencePrompt` embeds `currentState` so incremental semantics are conveyed; `buildRepairPrompt` includes the validation errors. Depends on: 2.1.
- **Task 2.3 - Wire into manager.** `ai-manager.js` and the repair step (1.3) now use these builders instead of the inline string. Depends on: 1.3, 2.1.

Dependencies: Milestones 0-1. **Shippable** (mock engine consumes the real prompts harmlessly). Commit after 2.3.

---

## 🚧 GATE B1 - Dependency & model approval (blocking)

Before Milestone 3, get explicit approval on the spec's "ask first" items:
- Install `@mediapipe/tasks-genai` (crosses the zero-runtime-dep boundary).
- Pin the exact Gemma variant + quantization, its license, expected download size, and **where the binary lives** (vendored same-origin path vs. Git LFS vs. release asset) - and confirm MediaPipe WASM/loader assets are served locally, not from a CDN.

Do not install or download anything until this gate clears. Everything through Milestone 2 must already be committed and green so this gate is the only thing standing between us and a shippable parser-only app.

---

## Milestone 3 - Real MediaPipe engine + OPFS loader (behind the gate)

Goal: replace the facade with genuine WebGPU inference and real model caching.

- **Task 3.1 - `js/lib/model-loader.js`.** OPFS-backed: check for cached model → if absent, stream download from the pinned same-origin URL with monotonic `onProgress(0→1)` → persist to OPFS → return a handle/URL for MediaPipe. Surfaces a recoverable error (not a throw to the app) on download/quota failure. Depends on: Gate B1.
- **Task 3.2 - Rewrite `js/lib/litert-lm.js`** as a thin real wrapper over `@mediapipe/tasks-genai` (`FilesetResolver` + `LlmInference.createFromOptions`), satisfying the Task 1.1 engine contract. `create({modelPath,onProgress})` uses `model-loader.js`; `sendMessage` runs `generateResponse`, honoring the `AbortSignal`. Apply constrained/JSON decoding if the build exposes it (Open Question 2). Depends on: 3.1, 1.1.
- **Task 3.3 - `initialize()` real progress.** Route real loader progress to the existing UI bar; on WebGPU-absent or loader failure, install the parser fallback engine and fire `onProgress(1.0)` (current behavior preserved). Depends on: 3.2.
- **Task 3.4 - Loader tests** (`fetch` + OPFS mocked): monotonic progress; cached model restores with no network fetch; download failure → recoverable → triggers fallback path in the manager. Real inference stays manual-E2E (no WebGPU in Vitest). Depends on: 3.1.

Dependencies: Gate B1. Commit after 3.4.

---

## Milestone 4 - E2E verification, hardening, honesty cleanup

Goal: prove the real path in a browser and remove the last facades.

- **Task 4.1 - Manual E2E** (Chrome/Edge, per spec §Testing): first-run OPFS download with visible progress → real-model prompt yields audible music; reload restores from OPFS with no model network fetch; offline after first load; warm TTFT < 400ms; force-fallback (WebGPU off / missing model URL) leaves the app fully functional with no dead-end error; no console errors; playback never stalls during inference.
- **Task 4.2 - Update `spec.md` §A.3.** Move "LiteRT-LM / WebGPU / Gemma is a facade" out of the facade list into the real-features inventory; update the honesty note in `README.md`. Depends on: 4.1 passing.
- **Task 4.3 - (Optional, independent) fake telemetry.** Address the `Math.random()` "DSP Load" readout flagged in `spec.md` §A.3 - real metric or remove. Not required for this feature; sequence only if in scope.

Dependencies: Milestone 3. This is the milestone that lets us honestly claim the LLM is real.

---

## Sequencing & parallelism

```
M0 (schema)  ──►  M1 (ladder)  ──►  M2 (prompts)  ──►  [GATE B1]  ──►  M3 (real engine+loader)  ──►  M4 (E2E + honesty)
   │ shippable       │ shippable        │ shippable                         │
   └─ 0.1→0.2→0.3    └─ 1.1→1.2/1.3→1.4  └─ 2.1→2.2→2.3                      └─ 3.1→3.2→3.3, 3.4 ∥ 3.2
```

- M0-M2 need **no** new dependency and keep the app on the parser - they de-risk everything and are individually shippable.
- The only hard external gate (B1) sits between the safe scaffolding and the real model, so approval is requested exactly once, with all groundwork already proven.
- Within M3, loader (3.1) and its tests (3.4) can proceed alongside the engine wrapper (3.2).

## Risks & mitigations

- **Model too large / slow on consumer GPUs** → pin a small 4-bit variant at Gate B1; keep parser fallback as the guaranteed-fast path; consider opt-in download prompt (Open Question 5).
- **MediaPipe build lacks JSON/grammar constraints** → validate+repair+fallback ladder (already built in M1) is the safety net regardless (Open Question 2).
- **OPFS quota / eviction** → loader treats a missing cache as first-run and re-streams; never a hard failure.
- **Model ignores `currentState` additive semantics** → few-shot examples in M2 steer it; build a small prompt→expected-diff eval set (Open Question 4) before claiming parity.
- **Repo bloat from committing the binary** → resolved at Gate B1 (LFS / release asset / vendored), never a blind `git add`.

## Definition of done

All spec §Success Criteria met and verified: real inference emits §A.1-valid JSON, warm TTFT < 400ms, OPFS caching works offline, fallback is transparent, 100% of engine-bound outputs validate, no data egress beyond the one-time fetch, and no regressions (`audio-engine.test.js` + all new tests green, `app.js` unchanged). Facade removed from `spec.md`/`README.md`.
