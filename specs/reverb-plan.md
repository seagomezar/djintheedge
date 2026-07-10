# Plan: Audible Reverb (Track 2, first slice)

> Implements [`specs/reverb.md`](reverb.md).
> Small, self-contained, single-PR scope. No dependency gate (unlike the LLM work) - nothing here needs approval beyond the merge.
> Sequenced so each step is independently verifiable and the audio graph is never left half-wired.

---

## Guiding constraints (from the spec)

- Reverb is global and strictly additive; the dry path and existing delay behavior stay byte-for-byte unchanged.
- Impulse response generated in-code (no binary asset, no network).
- All parameter changes ramp (`setTargetAtTime`) - no abrupt swaps, no clicks.
- Reverb sits before the recording tap (via `outputNode`) so exports include it.
- `npm test` + `npm run test:e2e` green before commit.

---

## Milestone 1 - Impulse response generator (pure, no AudioContext)

- **Task 1.1 - `js/lib/reverb-ir.js`.** Export `buildImpulseResponse(ctx, seconds = 2.0, decay = 2.0)` that creates a stereo buffer via `ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate)` and fills each channel with noise shaped by an exponential decay envelope `(1 - i/n)^decay`. Keep the buffer-filling math in a separate pure helper `fillDecayNoise(channelData, decay, randomFn)` so it is testable without a context (inject the random source to keep it deterministic in tests).
  - *AC:* pure module; no import of the renderer; deterministic when a seeded/stub random is passed.
- **Task 1.2 - `tests/reverb-ir.test.js`.** With a tiny fake buffer (plain arrays) and a stub random: envelope is monotonically non-increasing, length matches `sampleRate * seconds`, all values in [-1, 1], `decay` larger ⇒ faster falloff.
  - *AC:* `npm test` green.

Independently shippable (dead code until wired, but correct and tested).

---

## Milestone 2 - Wire the reverb chain into the renderer

- **Task 2.1 - Build nodes in `WebRenderer.initialize()`.** After the delay chain, create `reverbSendNode` (gain), `reverbNode = ctx.createConvolver()`, `reverbWetNode` (gain). Set `reverbNode.buffer = buildImpulseResponse(ctx)`. Route `reverbSendNode -> reverbNode -> reverbWetNode -> outputNode`. Seed `reverbWetNode.gain` to the default `reverb_mix` (0.15). Depends on: 1.1.
- **Task 2.2 - `connectVoice(node)` helper + call-site refactor.** Add a private `connectVoice(sourceGain)` that does the three sends (`delayDryNode`, `delayNode`, `reverbSendNode`) in one place, and replace the duplicated `connect` pairs in `playSyntheticKick`, `playSyntheticHihat`, `playSynthNote`, and `playSample`. This removes drift risk and is the single point where reverb send is guaranteed for every voice. Depends on: 2.1.
  - *AC:* every voice routes to all three sends; no behavioral change to dry/delay.
- **Task 2.3 - Honor `reverb_mix` in `render()`.** Mirror the existing `delay_feedback` block: if `config.effects.reverb_mix` is a number, `reverbWetNode.gain.setTargetAtTime(value, ctx.currentTime, 0.02)`. Depends on: 2.1.

---

## Milestone 3 - Tests + verification

- **Task 3.1 - Extend `tests/audio-engine.test.js`.** Using the existing fake-ctx pattern, add `createConvolver` and connect-spy support. Assert: `render({effects:{reverb_mix:0.4,...}})` ramps the wet gain toward 0.4; `reverb_mix:0` ramps to 0; a scheduled voice's gain connects to the reverb send node. Keep all existing tests green. Depends on: M2.
- **Task 3.2 - Extend the Playwright E2E** (`tests/e2e/app.spec.js`): submit "reverb catedral", assert no page/console errors and the `#state-effects` FX readout reflects a raised reverb percentage; then "sin reverb" lowers it. (Audibility remains a manual check - headless can't hear.) Depends on: M2.
- **Task 3.3 - Manual browser E2E** (Chrome/Edge): play groove → "reverb catedral" gives an audible tail → "sin reverb" dries out → record + play back WAV confirms the tail is in the file → no clicks when toggling live → no console errors. Depends on: M2.

---

## Milestone 4 - Honesty cleanup (docs)

- **Task 4.1 - Update `spec.md` §A.1** caveat ("effects.reverb_mix is parsed and displayed but there is no reverb node ... currently inert") and §A.3 ("Reverb is not implemented") to reflect that reverb is now real.
- **Task 4.2 - Update `README.md`** highlights + honesty note: move reverb from facade to real.

---

## Sequencing

```
M1 (IR gen)  ──►  M2 (wire renderer)  ──►  M3 (tests + E2E)  ──►  M4 (docs honesty)
  1.1→1.2           2.1→2.2, 2.1→2.3        3.1, 3.2, 3.3         4.1, 4.2
```

Single reviewer-sized PR. No external gate.

## Risks & mitigations

- **Clicks on live change** → `setTargetAtTime` ramp, never direct gain set; verified in manual E2E.
- **CPU under climax rolls** → one shared convolver, ~2s IR; confirm no overload in manual E2E (Open Question 3).
- **Fake-ctx test drift** → the connect-spy assertion proves real wiring, not just config, so a future refactor that drops the send is caught.
- **Recording omits reverb** → wet return sums into `outputNode` (the recording tap source), so it is included by construction; confirmed in manual WAV playback.

## Definition of done

`reverb_mix` audibly honored and proportional, click-free, present in exported WAV, no new dependency, all unit + E2E suites green with new coverage, and reverb removed from the facade lists in `spec.md`/`README.md`.
