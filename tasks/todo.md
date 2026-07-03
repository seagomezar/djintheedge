# TODO: Multitrack BrowserDJ AI

Task list for `plan.md`. Slice vertically, build bottom-up, review at each checkpoint.

## Phase 1: Foundation
- [x] **T1 (XS)** Forward `currentState` through the AI pipeline (`ai-manager.js`, `litert-lm.js`) - prove the accumulation pipe on the current contract.
- [x] **T2 (L)** Track-array contract + incremental parser rewrite (`parser.js`, `ai-manager.js`, `tests/audio-engine.test.js`) - additive add/edit/mute/remove, full-replace on reset, gibberish returns state unchanged.
- [x] **CHECKPOINT** `npm test` green; parser is sole producer of new contract.

## Phase 2: Core Feature Slices
- [x] **T3 (L)** Renderer + scheduler consume `tracks[]` by `id`/`type`; honor live mute click-free; remove `seq2` ordering (`audio-engine.js`, `elementary-renderer.js`, tests).
- [x] **T4 (M)** App wiring + state monitor on new contract; compute `changedTrackIds` via diff (`app.js`).
- [x] **T5 (L)** Step-grid UI: per-track rows, playhead, mute toggle, change-highlight pulse (`app.js`, `index.html`, `style.css`).
- [x] **CHECKPOINT** End-to-end prompt→parse→audio→grid verified via headless integration run; `npm test` green.

## Phase 3: Refinements & Cleanup
- [x] **T6 (M)** Per-track cutoff authority + cutoff-slider master-sweep semantics (`elementary-renderer.js`, `audio-engine.js`, `app.js`).
- [x] **T7 (S)** Loop length to 64 + `loop_steps` plumbing (`index.html`, `app.js`, `audio-engine.js`).
- [x] **T8 (M)** Remove dead `el.*` extraction path; deleted `elementary-core.js` + trimmed DSL tests.
- [x] **T9 (S)** Updated `spec.md` (A.1/A.2/A.3/A.4 + structure), systemPrompt schema, flipped design doc status.
- [x] **CHECKPOINT** All AC met; `npm test` green (15 tests); headless E2E clean.

## Notes
- Real browser visual QA still recommended (no chrome-devtools MCP in this environment); verified via `node --check`, headless pipeline run, and dev-server serve check.
- Deferred (out of scope, per plan): reverb, AudioWorklet migration, multi-deck mixing, solo.
