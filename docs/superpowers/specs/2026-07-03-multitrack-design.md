# Design: Multitrack BrowserDJ AI

Date: 2026-07-03
Status: Implemented. See `2026-07-03-multitrack-plan.md` for the task breakdown that shipped this.

## Problem

Three user-reported problems with the current single-loop app:

1. **Sequences are too short.** The loop is a single 16-step pattern; it feels brief and repetitive.
2. **Prompt changes are not visible.** A user cannot see how their prompt altered the sequence. This is worsened by a real bug: `app.js` passes `activeLoopState` into `generateDSPConfig`, but that method ignores the second argument, so `parsePromptToDSP` always runs with `currentState = null`. Every prompt regenerates from defaults, so non-scale edits silently reset the rest of the loop.
3. **Not multitrack.** There is exactly one kick lane, one hi-hat lane, and one synth lead, all baked into a flat DSP-JSON object. A user cannot layer instruments.

## Goals

- Represent the loop as **layered instrument tracks** over one shared tempo and loop length.
- Make prompts **incremental/additive**: "add a bassline" adds a track and leaves others alone; "make the hats faster" edits only the hats. State persists and accumulates across prompts.
- Make every prompt change **visible** via a per-track step-grid that highlights what changed.
- Support **longer sequences** (loop length up to 64 steps).

## Non-Goals

- Multi-deck DJ mixing / crossfader (deferred - Track 3 of SPEC.md).
- Song sections / timeline arrangement (deferred - Track 3 of SPEC.md).
- Real WebGPU/Gemma inference (deferred - Track 1 of SPEC.md). The rule-based parser remains the engine.
- Reverb implementation and AudioWorklet migration (deferred - Track 2 of SPEC.md), though the track model should not block them.

## Design

### 1. Data model - track array

Replace the flat `dsp_graph` (fixed `drums.kick`, `drums.hihat`, `synth_lead`) with a `tracks` array. Each track is self-contained and independently addressable.

```jsonc
{
  "meta": { "bpm": 124, "scale": "Am", "loop_steps": 32, "energy": 0.8 },
  "tracks": [
    { "id": "kick",  "type": "drum",  "role": "kick",  "muted": false,
      "pattern": [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0],
      "sample_name": null },
    { "id": "hats",  "type": "drum",  "role": "hihat", "muted": false,
      "pattern": [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1],
      "sample_name": null },
    { "id": "bass",  "type": "synth", "muted": false,
      "wave_type": "saw", "filter_cutoff_hz": 600, "filter_resonance": 4,
      "adsr": [0.01,0.1,0.3,0.2], "notes": [33,0,33,0, /* ... */ ] },
    { "id": "lead",  "type": "synth", "muted": false,
      "wave_type": "cycle", "filter_cutoff_hz": 1450, "filter_resonance": 3,
      "adsr": [0.01,0.15,0.7,0.2], "notes": [57,60,64,67, /* ... */ ] }
  ],
  "effects": { "delay_feedback": 0.35, "reverb_mix": 0.2 },
  "transition": null
}
```

Rules:
- `type` is `"drum"` or `"synth"`. Drums have `role` (`kick` | `hihat` | future `snare`/`clap`) and `pattern` (0/1). Synths have `notes` (MIDI, 0 = rest) plus `wave_type`, `filter_cutoff_hz`, `filter_resonance`, `adsr`.
- `pattern`/`notes` length equals `meta.loop_steps` (default 32, max 64). Shorter arrays wrap via modulo (preserves current behavior).
- `id` is stable and unique; it is how prompts target a track and how the UI diffs changes.
- `effects` and `transition` stay global (unchanged semantics from today).

This deprecates the flat contract in `SPEC.md` A.1. `SPEC.md` A.1 will be updated to the track-array contract once implemented.

### 2. Incremental parser - `parsePromptToDSP(prompt, currentState)`

- Fix `AIManager.generateDSPConfig` to forward `currentState` (it currently drops the second argument), and fix `app.js` to keep `activeLoopState` as the accumulating source of truth.
- The parser starts from a **deep copy of `currentState`** (or a fresh default template if `currentState` is null or the prompt is a full-replace command).
- **Intent: additive by default.** The parser resolves which track(s) a prompt targets and mutates only those:
  - Track add: phrases like "add a bass / bassline / pad / lead / add hats" push a new track (or unmute/replace an existing one of that role).
  - Track edit: "make the hats faster", "darker lead", "louder kick" edit the matching track's fields only.
  - Track remove/mute: "remove the lead", "mute the bass" set `muted` or drop the track.
  - Global edits: BPM, scale, effects, loop length apply to `meta`/`effects` as today.
- **Full replace** is explicit: "start over", "new techno track", "reset" builds a fresh template.
- The parser returns a `changedTrackIds: string[]` alongside the config (or the UI diffs old vs new state) so the UI can highlight changes. Chosen approach: **UI diffs old vs new `activeLoopState`** - keeps the parser output equal to the pure contract and avoids a side channel.
- Gibberish input must return the current state unchanged (never throw, never wipe the loop).

### 3. Multitrack step-grid UI - the visibility fix

Augment the "AI Deck State" panel with a **step-grid**:
- One row per track, labeled by `id`/role. Each row shows `loop_steps` cells; active steps light up. Synth rows show note names on active steps.
- A moving playhead column indicates the current step (driven by the existing `current_step` poll already used for the visualizer).
- Per-track **mute** (and optionally solo) toggles that write back into `activeLoopState` and re-render.
- After a prompt, track rows whose content changed **pulse/highlight** briefly (diff of old vs new state by `id` + field), so the user sees exactly what the prompt did.
- Keep the existing transition states (Morfosis / Redoblando / Explosión) as an overlay/badge.

### 4. Engine - `elementary-renderer.js` generalization

- The lookahead scheduler already iterates steps; generalize `schedulerTick` to loop over the `tracks` array instead of hardcoded kick/hat/lead. For each active step: drum tracks call `playSyntheticKick`/`playSyntheticHihat`/`playSample`; synth tracks call `playSynthNote` with that track's params.
- Honor `meta.loop_steps` up to 64 (existing modulo-wrap logic extends naturally).
- This removes the fragile **order-dependent `seq2` contract** (kick, hihat, notes by node order) documented in `SPEC.md` A.1 - tracks are addressed by `id`/`type`, not tree position.
- `audio-engine.renderGraph(config)` maps the track array into whatever the renderer consumes. If the `el.*` DSL layer is kept, it builds one sub-graph per track; the renderer reads per-track params rather than positional `seq2` extraction.
- Per-track `muted` is honored at schedule time (skip scheduling muted tracks). Live mute from the UI takes effect on the next step without a full re-render, to preserve click-free behavior.

### Data flow

```
prompt ──► app.handlePromptSubmission
            │  (passes activeLoopState)
            ▼
       ai.generateDSPConfig(prompt, activeLoopState)
            │  (forwards currentState)
            ▼
       parsePromptToDSP(prompt, currentState)  ──►  new config (track array)
            │
   app diffs old vs new by track id/field ──► changedTrackIds
            │
            ├──► activeLoopState = new config          (state persists/accumulates)
            ├──► audio.renderGraph(config)             (engine updates, click-free)
            └──► renderStepGrid(config, changedTrackIds)  (highlight changes)
```

## Error Handling

- Parser never throws on user input; on unrecognized input it returns the current state unchanged.
- Malformed/missing config falls back to a valid default template (existing boundary in SPEC.md).
- Track edits validate ranges (BPM 60-220, cutoff 100-10000, loop_steps 4-64) and clamp, as the parser does today.
- Mute-all / empty loop is allowed (silence) but must not crash the scheduler.

## Testing Strategy

- **Unit (Vitest), primary:**
  - `parsePromptToDSP` additive behavior: "add a bassline" adds exactly one synth track and leaves existing tracks byte-identical; "make hats faster" changes only the hats track; "mute the lead" sets only that flag.
  - Full-replace phrases produce a fresh template.
  - Gibberish returns the input state unchanged.
  - Contract conformance: output always matches the track-array schema; `loop_steps` clamped to 4-64.
  - Scheduler generalization: `render()` schedules N tracks; muted tracks produce no voices.
- **Manual E2E:** play a groove, add bass then pad over several prompts, watch the grid highlight each change, mute/unmute tracks live with no clicks, run a transition, record + play back the WAV.

## Impact on SPEC.md

On implementation, update SPEC.md:
- A.1 data contract → track-array schema (this doc).
- A.3 → remove "stateful loop accumulation not wired" and the order-dependent `seq2` caveat (both fixed here).
- Feature inventory → add multitrack + step-grid + live mute.

## Open Questions (non-blocking; sensible defaults chosen)

1. Solo (in addition to mute)? Default: mute only for v1; solo is a fast follow.
2. Max track count cap? Default: soft cap ~8 tracks to keep the grid readable and audio stable.
3. Default loop length? Default: 32 steps (2 bars) - the "short sequences" fix - configurable 4-64 via the existing slider.
