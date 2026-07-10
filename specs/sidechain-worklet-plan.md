# Plan: Sidechain Ducking + AudioWorklet Recording (Track 2, second slice)

> Implements [`specs/sidechain-worklet.md`](sidechain-worklet.md).
> Two independent features in one slice; sequenced so each is separately verifiable. Stacks on `feat/reverb` (shares `elementary-renderer.js` / `audio-engine.js`); rebase to `main` once #4 merges.
> One approved contract change (optional `effects.sidechain`); no other gates.

---

## Guiding constraints (from the spec)

- Duck only the synth bus; drums are the trigger and stay un-ducked.
- All gain changes use `cancelScheduledValues` + ramps - no clicks.
- Recording output byte-compatible; worklet is a capture-mechanism swap with a ScriptProcessor fallback.
- `effects.sidechain` optional, default 0, backward compatible.
- `npm test` + `npm run test:e2e` green before each commit.

---

## Feature A - Sidechain ducking

### Milestone A1 - Contract + parser + schema
- **A1.1 - Schema:** in `dsp-schema.js`, validate `effects.sidechain` only when present: must be a number in [0, 1]. Absent = valid (backward compat, mirrors `meta.energy`).
- **A1.2 - Template default:** add `sidechain: 0` to the default `effects` in `parser.js` (`defaultTemplate` and the repair path).
- **A1.3 - Parser rule:** `sidechain`/`pumping`/`bombeo` → `effects.sidechain = 0.7` (`light`/`subtle`/`suave` → 0.4); `no sidechain`/`sin sidechain`/`sin bombeo` → 0. Mark `touched`.
- **A1.4 - Tests:** schema (absent/valid/out-of-range), parser conformance (sidechain prompts stay schema-valid), parser unit (keyword → value, negation → 0).
  - *AC:* `npm test` green; existing tests unaffected (absent field stays valid).

### Milestone A2 - Renderer signal path + duck envelope
- **A2.1 - synthBusNode:** in `initialize()`, create `synthBusNode` (gain, unity) and route it to the dry/delay/reverb sends via the existing `connectVoice` logic. Add `this.sidechainDepth = 0`.
- **A2.2 - Route synths through the bus:** synth voices connect their output to `synthBusNode` instead of calling `connectVoice` directly; drums/samples keep calling `connectVoice`. (Introduce a small `connectSynthVoice(gain)` that connects to `synthBusNode`; keep `connectVoice` for drums.) Depends on: A2.1.
- **A2.3 - render() reads depth:** `this.sidechainDepth = effects.sidechain ?? 0`. Depends on: A1.
- **A2.4 - Duck on kick:** in `scheduleStep`, when a kick fires and `sidechainDepth > 0`, on `synthBusNode.gain`: `cancelScheduledValues(time)`, `setValueAtTime(1 - sidechainDepth, time)`, `linearRampToValueAtTime(1.0, time + release)` where `release ≈ stepDuration * 0.8`. No scheduling when depth is 0. Depends on: A2.1, A2.3.
- **A2.5 - Tests** (fake-ctx + spies): `render({effects:{sidechain:0.7}})` sets `sidechainDepth`; a synth voice connects to `synthBusNode`, and `synthBusNode` connects to the sends; a kick step with depth>0 schedules the dip+release on the bus gain; depth 0 schedules nothing. Depends on: A2.2, A2.4.

### Milestone A3 - UI
- **A3.1 - FX readout:** in `app.js` `updateStateMonitor`, append "duck N%" to the effects line (`eco N% / rev N% / duck N%`), reading `state.effects.sidechain` (default 0). Depends on: A1.

---

## Feature B - AudioWorklet recording

### Milestone B1 - Worklet processor
- **B1.1 - `js/lib/recorder-worklet.js`:** an `AudioWorkletProcessor` that, in `process(inputs)`, copies the stereo input channels and posts them to the main thread via `this.port.postMessage({ l, r })` (transferring the buffers), returning `true` to stay alive. Self-contained, `registerProcessor('recorder', ...)`. No imports.

### Milestone B2 - Engine integration
- **B2.1 - Lazy module load:** in `AudioEngine`, on first `toggleRecording(true)`, `await this.ctx.audioWorklet.addModule(new URL('./lib/recorder-worklet.js', import.meta.url))` once (guard with a flag). Depends on: B1.1.
- **B2.2 - Worklet recorder node:** create an `AudioWorkletNode(ctx, 'recorder')`, connect `outputNode -> recorderNode` (and, since worklet nodes with no output still need a graph pull, connect `recorderNode -> destination` through a zero-gain sink, or set the node to have 1 output that is silent). Accumulate posted chunks into `recordingBuffersL/R` via `recorderNode.port.onmessage`. Set `this.recorderMode = 'worklet'`. Depends on: B2.1.
- **B2.3 - Fallback:** if `!this.ctx.audioWorklet`, keep the existing `ScriptProcessorNode` path and set `this.recorderMode = 'scriptprocessor'`. Depends on: B2.2.
- **B2.4 - Stop/encode unchanged:** on `toggleRecording(false)`, disconnect the recorder node, merge buffers, `encodeWAV`, download - identical to today. Depends on: B2.2.
- **B2.5 - Tests:** `encodeWAV`/`mergeBuffers` are pure and already exist - add a unit test for them if not covered (feed known Float32 arrays, assert WAV header bytes + length). Worklet wiring itself is browser-only (E2E). Depends on: B2.4.

---

## Milestone C - E2E + verification

- **C1 - Playwright** (`tests/e2e/app.spec.js` extend): "sidechain pumping" → FX readout shows raised "duck %"; "no sidechain" → "duck 0%"; zero page/console errors.
- **C2 - Recording E2E:** click record, submit a prompt, click stop; assert a download is initiated and `window`-observable `audio.recorderMode === 'worklet'` (expose a minimal read-only hook, or assert via a `page.on('download')` event). No errors.
- **C3 - Offline-audio truth test** (new `tests/e2e/sidechain-audio.spec.js`): render kick+synth through `OfflineAudioContext` with sidechain on; sample the synth-bus-derived output right after a kick vs. between kicks; assert post-kick level < between-kick level (the pump is real). Mirrors the reverb audio-truth test.
- **C4 - Manual E2E** (Chrome/Edge): hear the pump; "no sidechain" removes it; record+playback WAV has pump+FX; DevTools shows `AudioWorkletNode`, no `ScriptProcessorNode`, in the recording path; no clicks.

---

## Milestone D - Docs honesty

- **D1 - `spec.md`:** §A.2 add sidechain as real; update the WAV-recording bullet to say capture is via `AudioWorkletNode` (ScriptProcessor is a labeled fallback); §A.3 remove/soften the "deprecated ScriptProcessorNode" gap; update §A.1 effects shape to include optional `sidechain`.
- **D2 - `README.md`:** add sidechain to highlights + real-today list; note worklet recording.

---

## Sequencing

```
Feature A:  A1 ─► A2 ─► A3
Feature B:  B1 ─► B2
            (A and B are independent; can build in parallel)
                         └──► C (E2E) ──► D (docs)
```

A and B touch different concerns (renderer vs. engine) and can be built concurrently, then verified together in C. Docs last.

## Risks & mitigations

- **Sidechain clicks / stacking on fast kicks** → `cancelScheduledValues` before each dip; ramp release; verified by the A2.5 "no stacking" assertion and C3 audio-truth test.
- **Worklet module URL resolution under Vite base subpath** → use `new URL('./lib/recorder-worklet.js', import.meta.url)` so the path is resolved relative to the module, not the origin; verify in C2.
- **Worklet node with no output getting garbage-collected / not pulled** → keep a live graph reference and connect through a silent sink so the render quantum runs; verify capture actually accumulates in C2.
- **Backward-compat break from the contract change** → `sidechain` is optional in the schema; existing fixtures/tests (which omit it) must stay green - A1.4 asserts this explicitly.
- **Double feature in one PR** → keep commits per-feature so review can follow A vs. B; the two are cleanly separable.

## Definition of done

Sidechain audibly ducks the synth bus in sync with the kick (proportional, 0 = transparent, click-free); recording runs through an `AudioWorkletNode` with an unchanged, valid WAV and a ScriptProcessor fallback; `effects.sidechain` is optional/backward-compatible across schema+parser+UI+engine; unit + E2E suites green with new coverage (including an offline-audio pump-truth test); docs updated so neither sidechain nor worklet recording is misrepresented.
