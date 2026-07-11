# Plan: True Square + FM Oscillators (Track 2, third slice)

> Implements [`specs/oscillators.md`](oscillators.md).
> Small, self-contained. One approved contract change (add `"fm"` to the wave_type enum). Stacks on `feat/sidechain-worklet`; rebase to `main` once the stack merges.

---

## Guiding constraints (from the spec)

- saw/cycle render byte-identical; only `square` changes (facade fix), `fm` is added.
- FM carrier flows through the existing filter -> ADSR -> `connectSynthVoice` chain (so master cutoff, transition sweeps, and sidechain all apply).
- Start AND stop both FM oscillators - no dangling nodes, no clicks.
- `wave_type: "fm"` additive/backward-compatible.
- `npm test` + `npm run test:e2e` green before commit.

---

## Milestone 1 - Enum + parser + UI (contract-level)

- **M1.1 - Schema:** add `"fm"` to `WAVE_TYPES` in `dsp-schema.js`.
- **M1.2 - Parser:** in `editSynthParams`, add `fm`/`metallic`/`metalico`/`bell`/`campana`/`growl` -> `wave_type = "fm"` (keep existing sine/saw/square branches; order so `fm` is checked alongside them without stealing "bright"/"techno" etc.).
- **M1.3 - UI:** `app.js` wave-name map gains `fm -> "FM"` (and keep cycle->Sine, square->Cuadrada, saw->Sierra).
- **M1.4 - Tests:** schema (`fm` valid; `triangle` invalid; saw/cycle/square valid); parser unit (fm/metallic/bell/campana/growl -> "fm"; square/retro -> "square").
  - *AC:* `npm test` green; existing wave tests unaffected.

---

## Milestone 2 - Renderer: true square + FM voice

- **M2.1 - Wave-type map:** replace the `waveType === 'saw' ? 'sawtooth' : 'sine'` ternary with an explicit map `{ saw:'sawtooth', cycle:'sine', square:'square' }` (default 'sawtooth'). This alone fixes the square facade. Depends on: nothing.
- **M2.2 - FM branch in `playSynthNote`:** when `wave_type === "fm"`, build carrier(sine) + modulator(sine) + `modGain`; wire `modulator -> modGain -> carrier.frequency`; set `modulator.frequency = freq * MOD_RATIO`, `modGain.gain = freq * MOD_INDEX` (module consts, e.g. 2.0 / 150). Connect `carrier -> filter` (the existing filter node). Start both at `time`; stop both at the same release time as the standard voice. All downstream (filter, resonance, cached filter node, ADSR gain, `connectSynthVoice`, stop) is shared - refactor so the oscillator-creation block is the only fork. Depends on: M2.1.
- **M2.3 - Tests** (fake ctx + createOscillator spy):
  - square -> osc.type 'square'; saw -> 'sawtooth'; cycle -> 'sine'.
  - fm -> two oscillators created + a mod gain; modulator connects to modGain, modGain connects to carrier.frequency (assert via connect spy targets); carrier connects to the filter; both oscillators start+stop.
  - fm voice still calls `connectSynthVoice` (routes through the duckable synth bus).
  Depends on: M2.2.

---

## Milestone 3 - E2E + verification

- **M3.1 - App smoke test extend:** submit "square retro" and "fm bell"; assert no page/console errors and the synth deck-state readout reflects the selected wave.
- **M3.2 - Offline-audio truth test** (`tests/e2e/oscillators-audio.spec.js`): with `OfflineAudioContext`, render (a) a `square` OscillatorNode vs. a `sine` baseline and assert the square has materially more high-harmonic energy (not a sine); (b) a hand-built FM carrier+modulator (mirroring the renderer's preset) vs. a plain sine, asserting the FM spectrum has sideband energy the sine lacks. Robust energy-ratio thresholds, not exact bins. Mirrors the reverb/sidechain audio-truth tests.
- **M3.3 - Manual E2E** (Chrome/Edge): real square audible; FM distinctly metallic; filter sweep + sidechain affect FM; no clicks; no console errors.

---

## Milestone 4 - Docs honesty

- **M4.1 - `spec.md`:** remove the §A.1 caveat "`wave_type: "square"` is accepted ... rendered as a sine wave"; update the synthesis §A.2 bullet to list saw/sine/square/FM; note `wave_type` enum now includes `fm`.
- **M4.2 - `README.md`:** mention the FM voice / real square in the synthesis highlight and the DSP-contract `wave_type` comment.

---

## Sequencing

```
M1 (enum/parser/ui) ─┐
                     ├─► M3 (E2E) ─► M4 (docs)
M2 (renderer)      ──┘
```

M1 and M2 are independent (contract/detection vs. audio node) and can be built in parallel, then verified together.

## Risks & mitigations

- **FM sounds thin/harsh across the range** → fixed preset (ratio 2.0, index ~150) chosen conservatively; Open Questions 1/2 flag revisiting in manual E2E; index scales with carrier freq so brightness tracks pitch.
- **Dangling modulator node / click** → modulator started and stopped in lockstep with the carrier; asserted in M2.3.
- **Parser keyword collision** (e.g. "bright"/"techno" already map to saw) → add fm keywords as distinct tokens; unit test asserts fm keywords win only for fm words and don't regress saw/square.
- **Backward-compat break from enum change** → additive only; M1.4 asserts saw/cycle/square configs still validate.

## Definition of done

`square` renders a real square wave; `fm` is an audibly distinct two-operator voice honoring filter/ADSR/cutoff/sidechain; `wave_type: "fm"` is backward-compatible across schema/parser/UI/engine; unit + E2E green with new coverage incl. an offline-audio timbre-difference test; the square-as-sine caveat is gone from `spec.md` and FM is documented.
