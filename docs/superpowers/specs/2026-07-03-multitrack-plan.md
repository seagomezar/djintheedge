# Implementation Plan: Multitrack BrowserDJ AI

Companion to `2026-07-03-multitrack-design.md`. This is the vertically-sliced,
verifiable task breakdown for that approved design.

## Context

See the design doc for the full problem statement. In short: the current app is a single
16-step loop with one kick, one hi-hat, one synth lead in a flat `dsp_graph`; prompts
regenerate from defaults (the `activeLoopState`-is-dropped bug) so edits are neither
additive nor visible. This plan delivers a `tracks[]` model, an incremental parser, a
per-track step-grid that highlights changes, and loop lengths up to 64 steps, while
removing the fragile order-dependent `seq2` extraction contract.

The rule-based parser stays the engine. Reverb, AudioWorklet, and multi-deck mixing remain
deferred (SPEC.md Tracks 1-3).

## Architecture Decisions

- **New contract = `tracks[]` array** replacing the flat `dsp_graph`. This is the change
  the design authorizes under SPEC.md's "Ask first: changing the DSP JSON contract" boundary.
  Old and new shapes are not bridged - the flat shape is fully replaced.
- **Renderer consumes the track array directly** (`this.core.tracks`); the scheduler iterates
  by `id`/`type`. This removes the positional `seq2` extraction (`elementary-renderer.js`
  122-132). The `el.*` DSL playback path and `findNodesByType` extraction become dead code and
  are removed in a cleanup task.
- **Change visibility via UI diff**, not a parser side channel: `parsePromptToDSP` returns the
  pure contract; `app.js` diffs old vs new state by track `id` + field.
- **Design defaults:** loop length default 32 / max 64; soft cap ~8 tracks; mute only for v1
  (solo deferred).

## Target Data Contract

```jsonc
{
  "meta":  { "bpm": 124, "scale": "Am", "loop_steps": 32, "energy": 0.8 },
  "tracks": [
    { "id": "kick", "type": "drum",  "role": "kick",  "muted": false, "pattern": [1,0,0,0,...], "sample_name": null },
    { "id": "hats", "type": "drum",  "role": "hihat", "muted": false, "pattern": [0,0,1,0,...], "sample_name": null },
    { "id": "lead", "type": "synth", "muted": false, "wave_type": "cycle",
      "filter_cutoff_hz": 1450, "filter_resonance": 3, "adsr": [0.01,0.15,0.7,0.2], "notes": [57,60,64,67,...] }
  ],
  "effects": { "delay_feedback": 0.35, "reverb_mix": 0.2 },
  "transition": null
}
```

## Dependency Graph

```
Task 1: state-fix (forward currentState)  ── independent, unblocks nothing but proves the pipe
        │
Task 2: track-array contract + parser rewrite  ◄─ the foundation everything else builds on
        │        (parsePromptToDSP + generateDSPConfig + default template)
        ├──────────────► Task 3: renderer/engine consumes tracks[]  (audio path)
        │                        │
        │                        └──► Task 6: per-track cutoff + cutoff-slider semantics
        │
        ├──────────────► Task 4: app.js wiring + old→new state monitor  (glue, keeps app running)
        │                        │
        │                        └──► Task 5: step-grid UI + change highlighting  (visibility fix)
        │
        └──────────────► Task 7: loop-length slider to 64 + loop_steps plumbing
                         Task 8: DSL cleanup (remove dead el.* extraction path)
                         Task 9: SPEC.md + design doc status update
```

Build order is bottom-up: prove the pipe (T1), lay the contract (T2), then the audio and UI
slices (T3-T5) in parallel-capable order, then the refinements (T6-T9).

---

## Phase 1: Foundation

### Task 1: Forward `currentState` through the AI pipeline (prove the pipe)

**Description:** Fix the dropped-argument bug in isolation, before any contract change, so the
existing app still works and the accumulation pipe is demonstrably live. This is a tiny,
self-contained fix that de-risks everything after it.

**Acceptance criteria:**
- [ ] `AIManager.generateDSPConfig(userPrompt, currentState)` accepts and forwards `currentState`.
- [ ] The forward reaches `parsePromptToDSP(userPrompt, currentState)` on all three call sites:
      the mock engine (`ai-manager.js:61`), the litert-lm conversation (`litert-lm.js:76`),
      and the catch/fallback (`ai-manager.js:96`).
- [ ] With the *current* flat contract still in place, submitting "make the hats faster" after
      "dark synthwave" preserves the dark synth params (no reset to defaults).

**Verification:**
- [ ] `npm test` passes (existing suite still green - the flat contract is unchanged here).
- [ ] Manual: `npm run dev`, submit two chained prompts, confirm the second does not reset the first.

**Dependencies:** None.
**Files likely touched:** `js/ai-manager.js`, `js/lib/litert-lm.js`.
**Estimated scope:** XS (2 files, signature + forward).

### Task 2: Track-array contract + incremental parser rewrite

**Description:** Replace the flat `dsp_graph` contract with the `tracks[]` model everywhere the
parser produces it. Rewrite `parsePromptToDSP` to (a) deep-copy `currentState` or build a fresh
default template, (b) resolve which track(s) a prompt targets and mutate only those (add / edit /
remove / mute), (c) handle global edits (bpm, scale, effects, loop_steps), (d) treat
"start over / reset / new <genre> track" as full replace, (e) return the current state unchanged
on gibberish. Include the default template (kick + hats + lead, `loop_steps: 32`) and a soft
cap of ~8 tracks.

**Acceptance criteria:**
- [ ] `parsePromptToDSP` output always conforms to the track-array schema above; `loop_steps`
      clamped to 4-64; bpm 60-220; cutoff 100-10000 (ranges from design §Error Handling).
- [ ] "add a bassline" adds exactly one synth track (role/id `bass`) and leaves existing tracks
      byte-identical; "make the hats faster" changes only the hats track; "mute the lead" sets
      only that track's `muted`.
- [ ] Full-replace phrases ("start over", "reset", "new techno track") produce a fresh template.
- [ ] Gibberish / unrecognized input returns `currentState` unchanged (never throws, never wipes).
- [ ] `null`/malformed `currentState` yields the valid default template.

**Verification:**
- [ ] New Vitest cases in `tests/audio-engine.test.js` cover each bullet above; `npm test` green.
- [ ] The NLP tests that asserted the flat shape (`dsp_graph.synth_lead`, `dsp_graph.drums`) are
      rewritten to the track-array shape.

**Dependencies:** Task 1 (pipe must forward state first).
**Files likely touched:** `js/ai-manager.js`, `tests/audio-engine.test.js`.
**Estimated scope:** L (parser is the largest single rewrite - break further if a session runs long:
2a additive edit/global path, 2b add/remove/mute + full-replace + cap).

### Checkpoint: Foundation
- [ ] `npm test` passes with the new track-array parser tests.
- [ ] `parsePromptToDSP` is the sole producer of the new contract; no flat-shape output remains.
- [ ] Review with human before wiring the engine and UI.

---

## Phase 2: Core Feature Slices

### Task 3: Renderer + scheduler consume `tracks[]`

**Description:** Generalize the audio path to the track array. `audio-engine.renderGraph(config)`
stops building the positional `el.*` graph and instead sets `this.core.tracks = config.tracks`
(plus `meta`, `effects`, `transition`). `WebRenderer` gains a `tracks` field; `render()` no longer
does `findNodesByType`/`seq2` extraction. `schedulerTick`/`scheduleStep` iterate the tracks array:
drum tracks call `playSyntheticKick`/`playSyntheticHihat`/`playSample` by `role`; synth tracks call
`playSynthNote` with that track's params. Muted tracks are skipped at schedule time (live mute takes
effect next step, no full re-render - preserves click-free behavior). `loop_steps` drives loop length.

**Acceptance criteria:**
- [ ] A config with 3 tracks (kick, hats, lead) plays identically to today's default groove.
- [ ] Adding a 4th (bass) track produces an audible extra synth layer with no clicks/pops.
- [ ] `muted: true` on a track silences exactly that track and nothing else.
- [ ] The order-dependent `seq2` extraction (`elementary-renderer.js` 122-132) is gone; tracks are
      addressed by `id`/`type`.

**Verification:**
- [ ] Vitest: a `render()`-equivalent test asserts N tracks schedule N voice types and muted tracks
      produce none (per design §Testing).
- [ ] Manual E2E: play default groove, add bass then pad over prompts, mute/unmute live - no clicks.

**Dependencies:** Task 2.
**Files likely touched:** `js/audio-engine.js`, `js/lib/elementary-renderer.js`, `tests/audio-engine.test.js`.
**Estimated scope:** L.

### Task 4: App wiring + state monitor for the track model

**Description:** Update `app.js` so `activeLoopState` is the track-array template; `handlePromptSubmission`
diffs old vs new state by track `id`+field to compute `changedTrackIds` (passed to the grid in Task 5);
`updateStateMonitor` and `generateChangeSummary` read `state.tracks`/`state.meta` instead of
`state.dsp_graph`. Keep the existing transition (Morfosis/Redoblando/Explosión) readouts working.

**Acceptance criteria:**
- [ ] App boots and plays the default groove with no console errors on the new contract.
- [ ] The AI Deck State panel reflects track-based state (scale/tempo/synth/drums/FX) and transition states.
- [ ] `changedTrackIds` is computed correctly (added, edited, removed, muted tracks are detected).
- [ ] User-derived text is still HTML-escaped in the history feed (`addPromptToHistory`).

**Verification:**
- [ ] Manual: submit several prompts; confirm monitor + history update and no `dsp_graph` errors.

**Dependencies:** Task 2 (contract), can proceed in parallel with Task 3.
**Files likely touched:** `js/app.js`.
**Estimated scope:** M.

### Task 5: Multitrack step-grid UI + change highlighting (the visibility fix)

**Description:** Add a per-track step-grid to the AI Deck State panel: one row per track (labeled by
`id`/role), `loop_steps` cells with active steps lit; synth rows show note names on active steps; a
moving playhead column driven by the existing `current_step` poll in `drawVisualizer`; per-track mute
toggle writing back to `activeLoopState`. After a prompt, rows in `changedTrackIds` pulse/highlight
briefly. Add the DOM container in `index.html` and cyber-synthwave styles in `style.css` consistent
with the existing panel (neon teal `#00ffcc`, Share Tech Mono).

**Acceptance criteria:**
- [ ] Each track renders a row of `loop_steps` cells; active steps are visually lit; synth rows show note names.
- [ ] A playhead highlights the current step in sync with audio (uses `audio.core.currentStep`).
- [ ] Clicking a row's mute toggle mutes that track live (next step) and reflects state.
- [ ] After a prompt, exactly the changed rows pulse; unchanged rows do not.
- [ ] Grid is legible up to 64 steps and ~8 tracks; degrades gracefully on the 768px mobile breakpoint.

**Verification:**
- [ ] Manual E2E: add tracks over several prompts, watch each change highlight; scrub through a
      transition; confirm playhead tracks the beat; mute/unmute with no clicks.

**Dependencies:** Task 3 (audio must honor mute), Task 4 (`changedTrackIds` + poll).
**Files likely touched:** `js/app.js`, `index.html`, `style.css`.
**Estimated scope:** L.

### Checkpoint: Core Features
- [ ] End-to-end: prompt → additive parse → audio update → grid highlight works click-free.
- [ ] `npm test` green; no console errors in the browser.
- [ ] Review with human before refinements.

---

## Phase 3: Refinements & Cleanup

### Task 6: Per-track cutoff authority + cutoff-slider semantics

**Description:** Today `filter_cutoff_hz` in the graph is ignored; the single `manualCutoff` slider
drives one shared `synthFilter` (`spec.md` A.1 caveat). With multiple synth tracks, make each synth
voice use its own track's `filter_cutoff_hz` in `playSynthNote`. Define and document the cutoff
slider's new role (recommendation: it offsets/overrides the most-recently-added synth track, or acts
as a master scale factor) so the control stays meaningful. Preserve the transition cutoff sweep.

**Acceptance criteria:**
- [ ] Two synth tracks with different `filter_cutoff_hz` sound distinctly filtered.
- [ ] The cutoff slider has a documented, working effect; the transition sweep still animates cutoff.

**Verification:**
- [ ] Manual: add a dark bass + bright lead; confirm timbral difference; run a transition sweep.

**Dependencies:** Task 3.
**Files likely touched:** `js/lib/elementary-renderer.js`, `js/audio-engine.js`, `js/app.js`.
**Estimated scope:** M.

### Task 7: Loop length to 64 + `loop_steps` plumbing

**Description:** Raise the `#slider-len` max from 32 to 64 in `index.html`; wire the slider to
`meta.loop_steps` (and `core.loopLength`) so it is the source of truth; ensure the parser's
`loop_steps` edits and the slider stay consistent, and the grid re-renders to the new length.

**Acceptance criteria:**
- [ ] Slider ranges 4-64; changing it updates loop length, `meta.loop_steps`, and the grid width.
- [ ] A prompt that sets loop length (e.g. "64 step loop") moves the slider and grid to match.

**Verification:**
- [ ] Manual: sweep the slider and submit a loop-length prompt; confirm audio loop and grid agree.

**Dependencies:** Task 3, Task 5.
**Files likely touched:** `index.html`, `js/app.js`, `js/audio-engine.js`.
**Estimated scope:** S.

### Task 8: Remove dead `el.*` extraction path

**Description:** With the renderer consuming `tracks[]` directly (Task 3), the `el.*` graph build in
`renderGraph`, `findNodesByType`, and the `render()` param-extraction are no longer used for playback.
Remove the dead playback path and update/trim the DSL unit tests that only guarded it. Keep any DSL
pieces still referenced (e.g. sample registration) intact.

**Acceptance criteria:**
- [ ] No dead `seq2`/`findNodesByType` extraction remains in the playback path.
- [ ] `tests/audio-engine.test.js` no longer asserts the removed positional contract; remaining tests pass.

**Verification:**
- [ ] `npm test` green; grep confirms no lingering references to the removed extraction in the audio path.

**Dependencies:** Task 3 (must be proven working first).
**Files likely touched:** `js/audio-engine.js`, `js/lib/elementary-renderer.js`, `js/lib/elementary-core.js`, `tests/audio-engine.test.js`.
**Estimated scope:** M.

### Task 9: Update SPEC.md and design doc status

**Description:** Per design §"Impact on SPEC.md": rewrite `spec.md` A.1 to the track-array contract;
remove from A.3 the "stateful loop accumulation not wired" bug and the order-dependent `seq2` caveat
(both fixed); add multitrack + step-grid + live mute to the A.2 feature inventory. Flip the design doc
status to implemented. Follow the user's Markdown rule: one sentence per line in prose sections.

**Acceptance criteria:**
- [ ] `spec.md` A.1 documents the track-array contract; A.3 no longer lists the two fixed items; A.2 lists the new features.
- [ ] Design doc status reflects "implemented".

**Verification:**
- [ ] Read-through: spec matches shipped behavior; no stale flat-contract references remain.

**Dependencies:** Tasks 2-8 landed.
**Files likely touched:** `spec.md`, `docs/superpowers/specs/2026-07-03-multitrack-design.md`.
**Estimated scope:** S.

### Checkpoint: Complete
- [ ] All acceptance criteria met; `npm test` green; manual E2E clean (play, layer, mute, transition, record WAV).
- [ ] SPEC.md is honest about shipped vs deferred.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Removing the `seq2`/`el.*` path breaks playback subtly | High | Task 3 lands the new path and proves parity before Task 8 deletes the old one. |
| Parser rewrite regresses existing prompt behaviors | Med | Task 2 ships tests for each intent; port old NLP assertions to the new shape. |
| Live mute / track add causes audio clicks | Med | Honor mute at schedule time (next step), never abrupt node swaps (SPEC.md "Never"). |
| Grid unreadable at 64 steps × 8 tracks | Low | Task 5 AC requires legibility + mobile graceful degradation. |
| Contract change ripples wider than expected | Med | Task 1 isolates the pipe fix; Foundation checkpoint gates before engine/UI slices. |

## Out of Scope (deferred)

Real WebGPU/Gemma inference (Track 1), reverb + AudioWorklet migration (Track 2), multi-deck
mixing/crossfader + song sections (Track 3), solo (fast-follow after v1 mute).

## Verification (end-to-end)

1. `npm test` - all Vitest suites green (parser additive behavior, scheduler generalization, contract conformance).
2. `npm run dev`, then in Chrome/Edge: play the default groove (no console errors), submit
   "add a bassline" then "add a pad" and watch the grid rows appear and highlight, "mute the lead"
   live with no clicks, run a transition prompt (steps + exploding) and watch the sweep/climax,
   set a 64-step loop, then record a mix and play back the exported WAV.
3. Confirm the app remains fully offline with no network calls.
