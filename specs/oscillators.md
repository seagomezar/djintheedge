# Spec: True Square + FM Oscillators (Track 2, third slice)

> Status: Feature spec, ready to plan.
> Scope: (1) render `wave_type: "square"` as a real square wave (closing a documented facade); (2) add a new `wave_type: "fm"` two-oscillator FM voice.
> Companion to [`spec.md`](../spec.md); stacks on `feat/sidechain-worklet`.

---

## Objective

Deepen synthesis timbre and close the last oscillator facade:

1. **True square** - `spec.md` §A.1 admits "`wave_type: "square"` is accepted by the parser but rendered as a sine wave." Render a real square wave so the retro/`cuadrada` timbre is honest.
2. **FM voice** - add a fourth `wave_type`, `"fm"`, a classic two-operator FM voice (carrier + modulator) for metallic/bell/growl textures the current single-oscillator palette can't produce.

**Why now:** true square is a one-line honesty fix in the same vein as reverb/sidechain; FM is the highest-value timbral addition from the Track 2 "more oscillator/wave types" item and composes cleanly with the existing per-voice filter + ADSR path.

**Who it is for:** the same performers/producers - a real square and an FM voice materially widen the sound-design range from prompts.

**Success looks like:**
- "square"/"retro"/"cuadrada" produces an audible square wave (not a sine).
- "fm"/"metallic"/"bell"/"growl" selects the FM voice and sounds distinctly different from saw/sine/square.
- The FM voice honors the same per-track filter, resonance, ADSR, sidechain-bus routing, and transition cutoff sweeps as other synths.
- `wave_type: "fm"` is backward-compatible: existing configs (saw/cycle/square) validate and render unchanged.
- No clicks; fully offline; no new dependency.

### Non-goals

- Wavetable oscillators, user-drawn waveforms, or per-prompt FM ratio/depth control (fixed musical FM preset this slice; a later slice can expose ratio/depth).
- Polyphony (separate slice).
- Changing any non-oscillator part of the contract.

---

## Approach (decisions)

### True square
- In `playSynthNote`, map `wave_type` to the real Web Audio oscillator type: `saw → "sawtooth"`, `cycle → "sine"`, `square → "square"`. (Currently everything non-saw falls back to sine.)

### FM voice
- `wave_type: "fm"` builds a two-oscillator voice: a **carrier** (sine) at the note frequency and a **modulator** (sine) whose output drives the carrier's `frequency` `AudioParam` via a `modGain`. Fixed musical preset: `modRatio` (modulator freq = carrier freq x ratio) and `modIndex` (modGain = carrier freq x index) chosen for a rich but usable timbre (e.g. ratio 2.0, index ~150). The carrier then flows into the **same** per-track lowpass filter -> ADSR gain -> sends path as every other synth, so filter/resonance/ADSR/cutoff-sweep/sidechain all apply unchanged.
- Voice bookkeeping (start/stop of both oscillators, cleanup) mirrors the existing single-oscillator lifecycle. The modulator starts/stops with the carrier.

### Shared enum
- Add `"fm"` to the `WAVE_TYPES` enum in `dsp-schema.js`. Parser detects `fm`/`metallic`/`metalico`/`bell`/`campana`/`growl`. UI name map gains "FM".

---

## Commands

No new scripts, no new dependencies. Existing `npm run dev` / `build` / `test` / `test:e2e`.

---

## Project Structure

Contained to the renderer plus the three enum/parse/display touch points.

```
djintheedge/
├── js/
│   ├── lib/
│   │   ├── elementary-renderer.js   # CHANGED: real square mapping; FM two-osc voice branch in playSynthNote
│   │   └── dsp-schema.js            # CHANGED: WAVE_TYPES gains "fm"
│   ├── parser.js                    # CHANGED: fm/metallic/bell/growl -> wave_type "fm"
│   └── app.js                       # CHANGED: wave-name map gains "FM"
└── tests/
    ├── audio-engine.test.js         # EXTENDED: square maps to 'square' osc; fm builds 2 oscillators + mod gain, routes through filter; parser fm keywords
    └── dsp-schema.test.js           # EXTENDED: "fm" valid; unknown wave_type still invalid; saw/cycle/square still valid
```

Design intent: FM is a self-contained branch inside `playSynthNote` that reuses the existing filter/ADSR/send tail, so no new node-graph plumbing outside the voice.

---

## Code Style

Existing conventions (ES6 class, 4-space indent, double quotes, JSDoc, English identifiers / Spanish UI). The FM branch shares the filter/ADSR/routing code with the standard branch rather than duplicating it - only oscillator creation differs. Oscillator `type` selection uses a small explicit map, not a chained ternary, now that there are four cases.

---

## Behavior

- `playSynthNote(midiNote, time, duration, track)`:
  - Compute carrier `freq` from the MIDI note (unchanged).
  - If `wave_type !== "fm"`: create one oscillator, set `.type` from the wave map (`sawtooth`/`sine`/`square`), connect to the filter (unchanged path).
  - If `wave_type === "fm"`: create carrier (sine) + modulator (sine) + `modGain`; `modulator -> modGain -> carrier.frequency`; set `modulator.frequency = freq * modRatio` and `modGain.gain = freq * modIndex`; connect `carrier -> filter`. Start both oscillators at `time`, stop both at the same release time as the standard voice.
  - Everything after the oscillator (filter, resonance, cached filter node, ADSR gain envelope, `connectSynthVoice`, stop scheduling) is shared.
- Filter-cutoff caching, the master-cutoff slider, transition sweeps, and sidechain ducking all continue to work because the FM carrier uses the identical downstream chain.

Invariants preserved: saw/cycle render exactly as before; square now differs (real square vs. prior sine) - this is the intended facade fix, called out in docs.

---

## Testing Strategy

Vitest fakes the AudioContext (existing pattern); FM is verified by asserting the node graph the voice builds. Audibility is a manual/offline-render check.

**Automated (unit):**
- `dsp-schema.test.js`: `wave_type: "fm"` valid; `saw`/`cycle`/`square` still valid; an unknown wave_type (e.g. `"triangle"`) still invalid.
- Parser unit: `parsePromptToDSP("fm bell lead")` (and "metallic", "growl", Spanish "campana"/"metalico") sets the target synth's `wave_type` to `"fm"`; "square"/"retro" still set `"square"`.
- `audio-engine.test.js` (fake ctx with `createOscillator` spy):
  - `playSynthNote` with `wave_type:"square"` sets the created oscillator's `.type` to `"square"` (regression against the old sine facade).
  - `wave_type:"saw"` -> `"sawtooth"`, `wave_type:"cycle"` -> `"sine"`.
  - `wave_type:"fm"` creates **two** oscillators and a modulator gain, connects modulator->modGain->carrier.frequency, and still connects the carrier through the filter to the synth bus (assert connect targets). Both oscillators get `start`/`stop`.

**Automated (E2E):**
- App smoke test: submit "fm bell" and "square retro" prompts; assert no page/console errors and the deck-state synth readout reflects the wave (e.g. shows "FM" / "Cuadrada").
- Offline-audio truth test (new or extended `oscillators-audio.spec.js`): render a short note for `square` and for `fm` through an `OfflineAudioContext`; assert (a) the square render has significant energy in higher harmonics vs. a pure sine baseline (proving it is not a sine), and (b) the FM render's spectrum differs measurably from a plain sine carrier (sidebands present). Keep assertions robust (energy-ratio thresholds, not exact bins).

**Manual E2E (Chrome/Edge):** hear a real square on "square"; hear a distinct metallic/bell timbre on "fm"; confirm filter sweep + sidechain still affect the FM voice; no clicks; no console errors.

---

## Boundaries

**Always:**
- Keep saw/cycle rendering byte-identical; only square changes (facade fix) and fm is added.
- Route the FM carrier through the existing filter/ADSR/send chain - no parallel path that bypasses sidechain or the master cutoff.
- Ramp/schedule cleanly; start and stop both FM oscillators to avoid dangling nodes or clicks.
- `wave_type: "fm"` additive and backward-compatible.
- `npm test` + `npm run test:e2e` green before commit; extend tests for both wave changes.

**Ask first (already approved: adding "fm" to the wave_type enum):**
- Any further contract change (e.g. exposing FM ratio/depth as fields).
- Introducing a runtime dependency.

**Never:**
- Leave `square` rendering as a sine after this ships.
- Introduce clicks or dangling oscillator nodes.
- Break saw/cycle/square-config backward compatibility or existing tests.

---

## Success Criteria

1. `square` renders a real square wave (facade closed); saw/cycle unchanged.
2. `fm` selects an audibly distinct two-operator FM voice that honors filter, ADSR, master cutoff, transition sweeps, and sidechain.
3. `wave_type: "fm"` is backward-compatible; schema/parser/UI/engine agree.
4. No clicks, no dangling nodes; fully offline; no new dependency.
5. Unit + E2E suites green with new coverage (incl. an offline-audio timbre-difference test); `spec.md` §A.1 caveat about square-as-sine removed and FM documented.

---

## Open Questions

1. **FM preset values:** one fixed ratio/index for all FM notes, or scale the index with note/energy? Default: fixed ratio 2.0, index ~150; revisit in manual E2E if it sounds thin or harsh across the range.
2. **FM + `filter_cutoff_hz` default:** FM already has strong harmonic content; should the default cutoff for an FM voice be higher so the sidebands are audible? Default: reuse the track's cutoff; adjust only if manual E2E shows it muffled.
3. **More types later:** wavetable / true triangle as a follow-up slice, or is saw/cycle/square/fm a sufficient palette?
