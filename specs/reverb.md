# Spec: Audible Reverb (Track 2, first slice)

> Status: Feature spec, ready to plan.
> Scope: Make `effects.reverb_mix` audible by adding a real reverb node to the audio graph, closing the last labeled facade in the audio engine.
> Companion to the living inventory in [`spec.md`](../spec.md); inherits the DSP JSON contract (Section A.1) unchanged.

---

## Objective

Turn `effects.reverb_mix` from an inert, parsed-but-unheard parameter into a genuine audible effect, so the app's audio graph honors every parameter the DSP contract advertises.

**Why now:** `spec.md` §A.3 lists reverb as "not implemented in the audio graph (schema/UI only)" - the last remaining audio-graph facade after the on-device-LLM work. The parser already extracts `reverb_mix` (keywords: `reverb`/`espacio`/`catedral`), the UI already displays it ("rev N%" in the deck-state monitor), and the DSP contract already carries it. The only missing piece is the audio node. Closing this makes the engine honest end to end.

**Who it is for:** the same performers and producers - a reverb send materially changes the character of pads, leads, and drums and is table-stakes for the "premium hardware" feel.

**Success looks like:**
- Typing "add reverb" / "reverb catedral" / "mucho espacio" produces an audible reverb tail; "sin reverb" removes it.
- `reverb_mix` is honored proportionally: 0.0 is dry, higher values are progressively wetter.
- No clicks, pops, or dropouts when reverb changes live (parameter ramps, not abrupt swaps).
- Reverb is captured in the exported WAV (it sits before the recording tap).
- Fully offline, no new runtime dependency, no network.

### Non-goals

- Sidechain/ducking, convolution IR file loading, or multiple reverb algorithms (later Track 2 slices).
- Changing the DSP contract (`spec.md` §A.1) - `reverb_mix` already exists.
- AudioWorklet migration or retiring `ScriptProcessorNode` (separate Track 2 slice).
- Per-track reverb sends - reverb stays a global effect like delay.

---

## Approach (decisions)

- **Algorithm:** a synthetically generated impulse response driven through a `ConvolverNode`, built once at init. The IR is generated in-code (exponentially decaying filtered noise) so there is **no external audio file** and offline-first holds. This gives a natural, smooth tail without shipping binary assets.
- **Routing:** mirror the existing delay send/return topology. Add a parallel `reverbNode` (convolver) with a `reverbWetNode` gain, fed by a shared `reverbSendNode` that every voice connects to. The wet return sums into `outputNode`, which already feeds the analyser and the recording tap - so reverb is visualized and recorded for free.
- **Control:** `render()` reads `config.effects.reverb_mix` and ramps `reverbWetNode.gain` with `setTargetAtTime` (click-free). The dry path is the existing `outputNode` sum; reverb is purely additive wet, matching how `reverb_mix` reads as a "mix amount".
- **Consistency:** every voice-spawn site that currently does `gain.connect(delayDryNode); gain.connect(delayNode)` also gets `gain.connect(reverbSendNode)`. This is the one repetitive change; a small `connectVoice(node)` helper is introduced to avoid drift across the four spawn sites.

---

## Commands

No new scripts, no new dependencies. Inherits the existing toolchain:

```
Dev server:   npm run dev
Build:        npm run build
Test:         npm test           # vitest run
E2E:          npm run test:e2e   # playwright (browser)
```

---

## Project Structure

Contained entirely to the renderer, plus a small standalone IR helper for testability.

```
djintheedge/
├── js/lib/
│   ├── elementary-renderer.js    # CHANGED: reverb send/return nodes, connectVoice() helper,
│   │                             #          render() honors reverb_mix
│   └── reverb-ir.js              # NEW: pure buildImpulseResponse(ctx, seconds, decay) generator
└── tests/
    ├── audio-engine.test.js      # EXTENDED: render() sets reverb wet gain from reverb_mix;
    │                             #           voices connect to the reverb send
    └── reverb-ir.test.js         # NEW: IR generator shape/decay properties (pure, no AudioContext)
```

Design intent:
- `reverb-ir.js` is pure math over a channel buffer (length, exponential decay envelope), so it is unit-testable with a tiny fake buffer and never needs a real `AudioContext`.
- The renderer owns node wiring and lifecycle exactly as it already does for delay - no new abstraction layer.

---

## Code Style

Follows existing renderer conventions (`spec.md` §Code Style): ES6 class, 4-space indent, double quotes, JSDoc on public methods, English identifiers/comments. Node wiring mirrors the delay chain's existing structure and naming (`reverbNode`, `reverbWetNode`, `reverbSendNode`) so the graph reads consistently. Parameter changes use `AudioParam` ramps, never direct reassignment, to avoid zipper noise.

---

## Behavior

- On init, build the reverb chain once: `reverbSendNode -> reverbNode(convolver) -> reverbWetNode -> outputNode`. Default wet gain seeded from the default template's `reverb_mix` (0.15).
- Every voice connects to `reverbSendNode` in addition to the existing delay/dry sends.
- `render(config)`: if `config.effects.reverb_mix` is a number, ramp `reverbWetNode.gain` toward it (`setTargetAtTime`, short time constant) so live prompt changes are smooth.
- `reverb_mix = 0` yields silence on the wet return (fully dry). Values are used directly as the wet gain (the parser already caps them at ≤ 0.45).
- Reverb is global and independent of mute state per track (a muted track spawns no voice, so it naturally contributes nothing).

Invariant preserved: the dry signal path and existing delay behavior are unchanged; reverb is strictly additive.

---

## Testing Strategy

Vitest has no real `AudioContext`, so the existing suite fakes the nodes it needs (see `audio-engine.test.js`'s `renderer.ctx = { currentTime: 0 }` pattern). Reverb tests follow suit.

**Automated:**
- `reverb-ir.test.js` (pure): `buildImpulseResponse` returns a buffer of the expected length for a given sample rate/seconds; amplitude envelope is monotonically non-increasing (decaying); values stay within [-1, 1]. No AudioContext.
- `audio-engine.test.js` (extended), with a fake ctx exposing `createConvolver`/`createGain` spies:
  - `render()` with `effects.reverb_mix = 0.4` drives the reverb wet gain toward 0.4.
  - `reverb_mix = 0` drives the wet gain to 0.
  - A spawned voice connects to the reverb send node (assert the send node is among a voice gain's connect targets), proving reverb is actually wired, not just configured.
- All existing tests stay green (delay behavior, scheduler, parser) - reverb must not perturb them.

**Manual E2E (browser, Chrome/Edge):**
- Load the app, play the default groove, submit "reverb catedral" and confirm an audible tail; submit "sin reverb" and confirm it dries out.
- Confirm the deck-state "rev N%" readout matches what is heard.
- Record a mix with reverb on, play back the WAV, and confirm the tail is present in the file.
- No console errors, no audio-thread overload, no clicks when toggling reverb live.
- The Playwright smoke test is extended to assert a "reverb" prompt runs without page/console errors and updates the FX readout (audibility itself stays a manual check - headless audio can't be "heard", but wiring + no-error + UI state are asserted).

---

## Boundaries

**Always:**
- Keep reverb additive and the dry path unchanged; ramp parameters (no abrupt gain swaps → no clicks).
- Generate the impulse response in-code; no external audio asset, no network.
- Keep reverb before the recording tap so exports include it.
- Run `npm test` + `npm run test:e2e` before committing; extend tests for the new behavior.

**Ask first:**
- Any change to the DSP contract (not expected here - `reverb_mix` already exists).
- Switching to a file-based convolution IR (would introduce a binary asset / offline concern).
- Introducing a runtime dependency.

**Never:**
- Introduce audio clicks/pops via abrupt node swaps.
- Leave `reverb_mix` inert after this ships - the whole point is honesty.
- Regress or skip existing tests.

---

## Success Criteria

1. `reverb_mix` is audibly honored, proportional to its value; 0 is fully dry.
2. Live reverb changes are click-free.
3. Reverb is present in the exported WAV.
4. No new dependency; fully offline.
5. Existing unit + E2E suites stay green; new tests cover the IR generator, the wet-gain control, and the voice→send wiring.
6. `spec.md` §A.3 and `README.md` no longer list reverb as a facade.

---

## Open Questions

1. **IR character:** one fixed decay time, or should a prompt like "mucha reverb" / "catedral" also lengthen the tail (not just raise the wet mix)? Default: fixed ~2s tail, `reverb_mix` controls wet level only; revisit if it feels flat.
2. **Send topology:** wet-only additive send (chosen) vs. a true dry/wet crossfade like the delay's dry/wet split. Additive is simpler and matches "mix" semantics; confirm it sounds right in manual E2E.
3. **CPU:** a `ConvolverNode` with a ~2s stereo IR is cheap, but confirm no audible overload with many simultaneous voices during a climax roll.
