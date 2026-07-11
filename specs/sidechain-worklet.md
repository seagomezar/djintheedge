# Spec: Sidechain Ducking + AudioWorklet Recording (Track 2, second slice)

> Status: Feature spec, ready to plan.
> Scope: (1) add prompt-controlled sidechain ducking driven by a new `effects.sidechain` contract field; (2) migrate the WAV recording tap off the deprecated `ScriptProcessorNode` to an `AudioWorkletNode`.
> Companion to [`spec.md`](../spec.md) and the reverb slice ([`specs/reverb.md`](reverb.md)); stacks on the `feat/reverb` branch.

---

## Objective

Deepen the audio engine along two independent axes:

1. **Sidechain ducking** - the classic "pumping" effect where each kick momentarily ducks the melodic/harmonic bus, giving the groove its breathing motion. Prompt-controlled and honest (a real contract field, parsed, displayed, and audible).
2. **AudioWorklet recording** - retire the deprecated `ScriptProcessorNode` (flagged in `spec.md` §A.3) in favor of an `AudioWorkletNode`, moving sample capture off the main thread onto the audio render thread where it belongs.

**Why now:** both are the named remaining items in Track 2 after reverb. Sidechain is the highest-impact missing synthesis feature for a DJ tool; the worklet migration removes the last deprecated audio API and is a prerequisite for any future off-main-thread DSP.

**Who it is for:** the same performers/producers - pumping sidechain is a defining sound of house/techno, and glitch-free recording matters for exports.

**Success looks like:**
- "sidechain" / "pumping" / "bombeo" produces an audible, kick-synced duck on the synth bus; "no sidechain" removes it; the amount is proportional to `effects.sidechain`.
- Recording produces the same valid 16-bit PCM stereo WAV as before, now captured via an `AudioWorkletNode`, with no `ScriptProcessorNode` remaining in the graph.
- No clicks/pops; the sequencer never stalls; fully offline; no new runtime dependency.

### Non-goals

- Ducking anything other than the synth/melodic bus (drums stay un-ducked - they are the trigger).
- Configurable sidechain attack/release curves via prompt (fixed musical envelope this slice).
- Moving synthesis/scheduling into the worklet (that is the deferred "full graph" scope).
- Changing WAV format, sample rate, or the export UX.

---

## Approach (decisions)

### Sidechain
- **Contract:** add `effects.sidechain` (0..1) as an **optional** field - validated only when present (like `meta.energy`), defaulting to `0` in the template so existing configs and tests stay valid. `0` = off, higher = deeper duck.
- **Signal path:** route all synth voices through a new shared `synthBusNode` (a gain) instead of connecting each voice's output directly to the sends. Drums keep connecting straight to the sends (they trigger, they don't duck). On each kick step, apply a fast gain dip + release envelope to `synthBusNode.gain`, scaled by `effects.sidechain`. This is envelope-follower-free (scheduler-driven), which is deterministic and cheap, and matches how the sequencer already schedules everything at precise times.
- **Parser:** keywords `sidechain` / `pumping` / `bombeo` set `effects.sidechain` (e.g. 0.7); `no sidechain` / `sin sidechain` sets `0`; `light`/`subtle` variants a smaller value.
- **UI:** extend the deck-state FX readout ("eco N% / rev N%") to include "duck N%".

### AudioWorklet recording
- Add a worklet processor module (`js/lib/recorder-worklet.js`) that receives audio blocks on the render thread and posts Float32 chunks to the main thread via `port.postMessage`. `AudioEngine` registers the module (`audioWorklet.addModule`), creates an `AudioWorkletNode` recorder, taps `outputNode` into it, accumulates posted chunks, and encodes the WAV exactly as today.
- **Graceful capability check:** if `audioWorklet` is unavailable (very old browsers), keep the existing `ScriptProcessorNode` path as a fallback so recording never hard-fails. The worklet is the default; the ScriptProcessor becomes the labeled legacy fallback rather than the primary path.

---

## Commands

No new scripts, no new dependencies. Existing toolchain (`npm run dev` / `build` / `test` / `test:e2e`). Note: worklet modules must be served as real files (Vite serves `js/lib/recorder-worklet.js` directly); the module is loaded by URL at runtime via `addModule`.

---

## Project Structure

```
djintheedge/
├── js/
│   ├── audio-engine.js           # CHANGED: AudioWorklet recorder (ScriptProcessor kept as fallback)
│   ├── parser.js                 # CHANGED: sidechain keyword -> effects.sidechain
│   ├── app.js                    # CHANGED: FX readout adds "duck N%"
│   └── lib/
│       ├── elementary-renderer.js  # CHANGED: synthBusNode + kick-synced duck envelope; render() reads effects.sidechain
│       ├── dsp-schema.js           # CHANGED: optional effects.sidechain (0..1) validation
│       └── recorder-worklet.js     # NEW: AudioWorkletProcessor that posts captured PCM blocks
└── tests/
    ├── audio-engine.test.js      # EXTENDED: render() sets sidechain depth; kick step ducks synth bus; synth voices route via synthBusNode
    ├── dsp-schema.test.js        # EXTENDED: sidechain optional + range validation
    ├── dsp-schema-parser-conformance.test.js  # EXTENDED: sidechain prompts still schema-valid
    └── e2e/app.spec.js           # EXTENDED: sidechain prompt updates FX readout; recording still works (worklet path)
```

Design intent: sidechain is a renderer concern (node graph + scheduled envelope); the worklet recorder is an `AudioEngine` concern (capture/encode). They share no code and can be reviewed/tested independently.

---

## Code Style

Existing conventions (ES6 class, 4-space indent, double quotes, JSDoc, English identifiers / Spanish UI). Parameter automation uses `AudioParam` ramps with `cancelScheduledValues` guarding rapid updates (as established in the reverb slice). The worklet processor is a small, self-contained `AudioWorkletProcessor` subclass with no external imports (worklet global scope has no module resolution beyond `registerProcessor`).

---

## Behavior

### Sidechain
- Synth voices connect to `synthBusNode`; `synthBusNode` connects to the dry/delay/reverb sends. Drums connect to the sends directly (unchanged).
- `render()`: read `effects.sidechain` (default 0) into `this.sidechainDepth`.
- In `scheduleStep`, when a kick voice fires and `sidechainDepth > 0`, schedule on `synthBusNode.gain`: an immediate dip to `1 - sidechainDepth` at kick time, then a linear release back to 1.0 over a musical fraction of the step (e.g. ~80% of a step). `cancelScheduledValues` first so consecutive kicks don't stack.
- `sidechain = 0` leaves `synthBusNode.gain` at 1.0 (no automation scheduled) - fully transparent.

### AudioWorklet recording
- On first `toggleRecording(true)`, lazily `await audioWorklet.addModule(<recorder-worklet url>)` once, then build the `AudioWorkletNode`. Subsequent toggles reuse it.
- The node taps `outputNode` (post-FX, so recordings include delay/reverb/sidechain) and posts stereo Float32 blocks; the main thread accumulates them exactly like the current buffers, then `encodeWAV` unchanged on stop.
- If `audioWorklet` is missing, fall back to the existing `ScriptProcessorNode` path.

Invariant: the recorded output and WAV encoding are byte-compatible with today's behavior; only the capture mechanism changes.

---

## Testing Strategy

Vitest has no real `AudioContext`/worklet, so node graph and scheduling are asserted via the existing fake-ctx + spy pattern; worklet wiring is verified in the browser E2E.

**Automated (unit):**
- `dsp-schema.test.js`: `effects.sidechain` absent → still valid (backward compat); present in [0..1] → valid; present but non-number or out of range → invalid.
- `dsp-schema-parser-conformance.test.js`: "sidechain pumping techno" and "no sidechain" outputs pass `isValidDSP`.
- `audio-engine.test.js`:
  - `render({effects:{sidechain:0.7,...}})` sets `renderer.sidechainDepth === 0.7`.
  - A synth voice's output routes to `synthBusNode` (connect spy), and `synthBusNode` routes to the sends - proving the bus is inserted.
  - Firing a kick step with `sidechainDepth > 0` schedules a dip on `synthBusNode.gain` (spy on `setValueAtTime`/`linearRampToValueAtTime`); with `sidechainDepth === 0`, no automation is scheduled.
- Parser unit test: sidechain keywords set the expected `effects.sidechain` value; `no sidechain` → 0.

**Automated (E2E, Playwright, headless Chromium):**
- Submit "sidechain pumping" → FX readout shows a raised "duck N%", no page/console errors; "no sidechain" → "duck 0%".
- Recording round-trip: start recording, submit a prompt, stop recording, and assert a WAV download is triggered without errors (the worklet path runs in real Chromium, which supports `audioWorklet`). Assert no `ScriptProcessorNode` deprecation path was taken by checking a debug flag the engine sets (e.g. `audio.recorderMode === 'worklet'`) exposed via a test hook, OR assert via console that the worklet branch ran. (Audibility of pumping remains a manual check.)
- Optional offline-audio truth test (like the reverb slice): render a kick+synth graph through an `OfflineAudioContext` with sidechain on and assert the synth-bus level is lower right after a kick than between kicks.

**Manual E2E (Chrome/Edge):** hear the pump on "sidechain pumping"; confirm "no sidechain" removes it; record a mix and confirm the WAV plays back with the pump and FX present; no clicks; DevTools shows an `AudioWorkletNode` (no `ScriptProcessorNode`) in the recording path.

---

## Boundaries

**Always:**
- Keep drums un-ducked (they are the trigger); duck only the synth bus.
- Ramp/schedule all gain changes with `cancelScheduledValues` guards - no clicks.
- Keep recording output byte-compatible; worklet is a capture-mechanism swap only.
- Keep a working fallback if `audioWorklet` is unavailable so recording never hard-fails.
- `effects.sidechain` optional + backward compatible; default 0.
- `npm test` + `npm run test:e2e` green before commit; extend tests for both features.

**Ask first (this slice already has approval for the one contract change):**
- Any further DSP-contract change beyond adding optional `effects.sidechain`.
- Introducing a runtime dependency.
- Removing the `ScriptProcessorNode` fallback entirely (keep it as labeled legacy this slice).

**Never:**
- Duck the drum bus or introduce clicks via abrupt gain swaps.
- Break recording or change the WAV format.
- Leave `effects.sidechain` inert after this ships.
- Regress or skip existing tests.

---

## Success Criteria

1. `effects.sidechain` audibly ducks the synth bus in sync with the kick, proportional to its value; 0 is transparent.
2. Recording uses an `AudioWorkletNode` (ScriptProcessor only as fallback); WAV output unchanged and valid.
3. No clicks; no sequencer stalls; fully offline; no new dependency.
4. `effects.sidechain` is backward-compatible (absent = valid); schema, parser, UI, and engine all agree.
5. Unit + E2E suites green with new coverage; `spec.md` §A.2/§A.3 updated (ScriptProcessor no longer the primary recording path; sidechain now real).

---

## Open Questions

1. **Duck envelope shape:** linear release (chosen for simplicity) vs. exponential - confirm which feels more musical in manual E2E.
2. **Duck timing vs. loop length:** release as a fixed fraction of one step, or a fixed ms time independent of BPM? Default: fraction of a step so it scales with tempo.
3. **Worklet fallback longevity:** keep the ScriptProcessor fallback indefinitely, or drop it in a later slice once worklet support is universal in the target browsers?
