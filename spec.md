# Spec: BrowserDJ AI - On-Device DJ Deck & Composer

> Status: Living document.
> This spec documents the application **as actually implemented today** (Section A) and the **forward-looking vision** it is built toward (Section B).
> Where the older `spec.md`, `plan.md`, and the PRD describe capabilities that are currently facades or stubs, this document says so plainly.

---

## Objective

BrowserDJ AI is a 100% client-side, offline-first DJ deck and procedural synthesizer composer that runs entirely in the browser.
A user drives a live musical performance by typing natural-language prompts (for example, "fast synthwave beat at 128 bpm with a dark filter and heavy delay"), which are translated into a deterministic DSP configuration and heard immediately.

**Who it is for:** live performers, bedroom producers, and creative technologists who want an instant, private, no-install music playground that works with no network connection.

**What success looks like:**
- A prompt changes the music in under 400ms.
- Audio plays continuously at 44.1kHz with no clicks, pops, or dropouts, even while parsing prompts.
- Everything runs offline with zero server calls and no API keys.
- The interface feels like a premium piece of cyber-synthwave hardware.

---

## Tech Stack

- **Core:** Vanilla HTML5, CSS3, ES6+ JavaScript modules. No UI framework.
- **Build/Dev:** Vite 5 (static serving, HMR, ESM resolution). `vite.config.js` sets COOP/COEP cross-origin-isolation headers (`same-origin` / `require-corp`) so a real WebGPU/`SharedArrayBuffer` model can be plugged in later.
- **Audio Engine:** Web Audio API, hand-built, presented through an Elementary-Audio-style declarative DSL (`el.*`). No external audio library.
- **"AI" Engine:** A `LiteRTLMEngine` facade plus a real, bilingual (Spanish/English) rule-based NLP parser. Every code path deterministically converges on the parser today (see Section A).
- **Testing:** Vitest.
- **Runtime dependencies:** none. Only `vite` and `vitest` as dev dependencies.

---

## Commands

```
Install:      npm install
Dev server:   npm run dev            # vite (defaults to http://localhost:5173)
Build:        npm run build          # vite build
Preview:      npm run preview        # serve the production build
Test:         npm test               # vitest run (single pass, CI-friendly)
Test (watch): npx vitest             # interactive watch mode
```

---

## Project Structure

```
djintheedge/
├── index.html                         # Single-page entry point; static DJ-console layout
├── style.css                          # Cyber-synthwave theme (Orbitron / Share Tech Mono)
├── vite.config.js                     # Vite config + COOP/COEP isolation headers
├── package.json                       # Scripts and dev deps
├── SPEC.md                            # This document (source of truth)
├── spec.md / plan.md / tasks.md       # Original planning docs (may overstate the AI capabilities)
├── BrowserDJ AI - PRD ....md          # Original product/engineering blueprint (Spanish)
├── js/
│   ├── app.js                         # UI orchestrator: DOM wiring, visualizer, state monitor, step-grid, telemetry
│   ├── ai-manager.js                  # AIManager facade (re-exports the parser)
│   ├── parser.js                      # parsePromptToDSP: the real, incremental track-array "brain"
│   ├── audio-engine.js                # AudioEngine: owns AudioContext, renderGraph bridge, WAV recording
│   ├── sample-loader.js               # SampleLoader: File System Access directory import
│   └── lib/
│       ├── elementary-renderer.js     # WebRenderer: consumes tracks[], real synth voices + lookahead scheduler + transitions
│       └── litert-lm.js               # LiteRTLMEngine facade (fake WebGPU/Gemma load, no real model)
└── tests/
    └── audio-engine.test.js           # Vitest: DSL core, renderer param extraction, NLP parser
```

---

## Code Style

- ES6 modules, `class`-based where a component owns state; free functions for pure logic (e.g. `parsePromptToDSP`).
- 4-space indentation, double quotes for strings, JSDoc on public methods.
- Escape any user-derived text before injecting into the DOM (see the history feed in `app.js`).
- User-facing strings are Spanish; identifiers, documentation, and this spec are English.

Representative snippet (`js/audio-engine.js`):

```javascript
export class AudioEngine {
    constructor() {
        this.ctx = null;
        this.core = null;          // simulated Elementary WebRenderer
        this.manualVolume = 0.8;
        this.manualCutoff = 2000;
    }

    /**
     * Initializes the Web Audio API context and the WebRenderer node.
     * @returns {Promise<void>}
     */
    async initialize() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (!this.ctx) {
            throw new Error("Web Audio API is not supported in this browser.");
        }
        this.core = new WebRenderer();
        // ... connect renderer output to destination and recording tap
    }
}
```

---

# Section A - Current State (What Is Actually Built)

This is the honest inventory - what a reader can verify by running the app and reading the source today.

## A.1 Data Contract (the DSP JSON)

A single JSON object flows from `AIManager` to `AudioEngine.renderGraph`. This is the central contract of the app.
It is a **track-array** model: layered instrument tracks over one shared tempo and loop length.

```jsonc
{
  "meta":  { "bpm": 124, "scale": "Am", "loop_steps": 32, "energy": 0.8 },
  "tracks": [
    { "id": "kick", "type": "drum",  "role": "kick",  "muted": false,
      "pattern": [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0],   // length == loop_steps, 0/1
      "sample_name": null },                              // custom kick sample id, or null
    { "id": "hats", "type": "drum",  "role": "hihat", "muted": false,
      "pattern": [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1],
      "sample_name": null },
    { "id": "lead", "type": "synth", "muted": false,
      "wave_type": "saw",            // "saw" | "cycle" | "square"
      "filter_cutoff_hz": 1450,
      "filter_resonance": 3.2,
      "adsr": [0.01, 0.15, 0.7, 0.2],
      "notes": [57,60,64,67, 64,60,57,0] }               // MIDI numbers, 0 = rest
  ],
  "effects": { "delay_feedback": 0.35, "reverb_mix": 0.2, "sidechain": 0.0 },
  "transition": null                 // or the transition block below
}
```

Rules:
- `type` is `"drum"` or `"synth"`. Drums have `role` (`kick` | `hihat`) and a 0/1 `pattern`. Synths have `notes` (MIDI, 0 = rest) plus `wave_type`, `filter_cutoff_hz`, `filter_resonance`, `adsr`.
- `pattern`/`notes` length equals `meta.loop_steps` (default 32, max 64). Shorter arrays still wrap via modulo in the scheduler.
- `id` is stable and unique; it is how prompts target a track and how the UI diffs changes for highlighting.
- Soft cap of ~8 tracks keeps the grid readable and audio stable.
- `effects` and `transition` stay global. `effects.sidechain` (0..1) is **optional** for backward compatibility - absent is treated as `0` (off).

Transition block (drives climax / scale morphing):

```jsonc
"transition": {
  "active": true,
  "current_step": 0,
  "total_steps": 16,
  "start_scale": "Am",  "target_scale": "Cm",
  "start_cutoff": 2000, "target_cutoff": 800,
  "drum_exploding": true
}
```

**Contract caveats that must be preserved (or deliberately fixed):**
- Tracks are addressed by `id`/`type`, not tree position - the old order-dependent `seq2` extraction contract is gone.
- `wave_type: "square"` is accepted by the parser but rendered as a sine wave.
- `filter_cutoff_hz` is now read per synth track to seed each voice's filter; the `manualCutoff` slider then acts as a live **master** sweep across all synth tracks, and the transition sweep animates them too.
- `effects.reverb_mix` drives a real convolution reverb send (a `ConvolverNode` with an in-code impulse response); it is ramped click-free on live changes and is included in the recorded WAV. See [`specs/reverb.md`](specs/reverb.md).

## A.2 Feature Inventory (works today)

- **Prompt parsing (real, primary feature):** bilingual regex/keyword engine `parsePromptToDSP` (in `js/parser.js`). It is **incremental/additive**: it starts from a deep copy of the current loop state and mutates only the track(s) a prompt targets - "add a bassline" adds a track, "make the hats faster" edits only the hats, "mute the lead" flips one flag, "remove the bass" drops a track. Full-replace phrases ("start over", "reset", "new techno track") rebuild a fresh template; gibberish returns the current state unchanged. Also extracts BPM (numeric or fast/slow/`lento`), scale + regenerated melody, genre presets, wave type, cutoff, resonance, ADSR presets, drum-pattern toggles, custom-sample references, delay/reverb keywords, loop length, and multi-step transition requests.
- **Multitrack (real):** the loop is a `tracks[]` array (drum + synth layers) over one shared tempo/loop length; tracks are independently addressable, editable, mutable, and removable, with a soft cap of ~8.
- **Sequencer (real):** variable-length (4-64 step) 16th-note sequencer using a standard lookahead scheduler (50ms `setInterval`, 100ms schedule-ahead window, sample-accurate `AudioContext.currentTime` timestamps, suspended-context catch-up guard). It iterates the track array by `id`/`type` and skips muted tracks at schedule time (live mute takes effect on the next step, click-free).
- **Synthesis (real):** synthetic kick (150→40Hz pitch drop), bandpassed-noise hi-hat, and per-synth-track filtered voices (oscillator → lowpass biquad → ADSR gain) spawned per step, each using its own track's wave/cutoff/resonance/ADSR.
- **Delay effect (real):** feedback delay chain (dry/wet/delay/feedback gains).
- **Reverb effect (real):** a global convolution reverb send (`ConvolverNode`) driven by `effects.reverb_mix`. The impulse response is generated in-code (decaying filtered noise via `js/lib/reverb-ir.js`) so no audio asset ships; the wet return is ramped click-free (`setTargetAtTime`) and sums into the output before the recording tap, so reverb is both visualized and captured in the exported WAV.
- **Sidechain ducking (real):** synth voices route through a shared synth bus; each kick hit ducks that bus by `effects.sidechain` (0..1) with a fast dip + linear release scheduled per-step (drums are the trigger and are not ducked). Click-free via `cancelScheduledValues` before each dip; `sidechain: 0` is fully transparent. See [`specs/sidechain-worklet.md`](specs/sidechain-worklet.md).
- **Local sample import (real):** `SampleLoader` uses the File System Access API (`showDirectoryPicker`) to import `.wav`/`.mp3`, decode to `AudioBuffer`, and register custom kicks.
- **WAV recording/export (real):** captures stereo Float32 via an `AudioWorkletNode` (the deprecated `ScriptProcessorNode` remains only as a fallback when `audioWorklet` is unavailable), encodes a real 16-bit PCM stereo WAV, and auto-downloads it.
- **Oscilloscope visualizer (real):** time-domain analyser rendered on canvas with a motion-blur trail and grid.
- **Transitions / climax / scale morphing (real):** interpolates filter cutoff across the transition, transposes the melody to the target scale at the midpoint, and (when `drum_exploding`) fires accelerating kick/hat rolls into a climax.
- **UI panels (real):** header metrics, three live sliders (master volume, master cutoff, loop length up to 64), an "AI Deck State" monitor (scale/tempo/synth/drums/FX with special Morfosis/Redoblando/Explosión states), a **per-track step-grid** (one row per track with lit cells, note names on synth rows, a moving playhead, per-track mute toggles, and a pulse-highlight on rows a prompt just changed), and a capped prompt-history feed.

## A.3 Known Facades, Stubs, and Gaps

Called out explicitly so nobody mistakes the facade for the feature.

- **LiteRT-LM / WebGPU / Gemma - real integration, model not yet bundled.** `litert-lm.js` is now a genuine MediaPipe (`@mediapipe/tasks-genai`) WebGPU wrapper with real OPFS model caching (`model-loader.js`), versioned prompt engineering (`prompt-template.js`), schema-validated output (`dsp-schema.js`), and a validate→repair→parser-fallback ladder in `ai-manager.js`. It goes live once the `@mediapipe/tasks-genai` dependency and a Gemma model binary are provisioned (Gate B1); until then the dynamic import fails gracefully and the app runs transparently on `parsePromptToDSP`, with the UI honestly labeled "AI OFFLINE (Parser)". The GPU-machine inference path is wired but not yet verified end-to-end. See [`specs/on-device-llm.md`](specs/on-device-llm.md) and its plan.
- **"DSP Load" telemetry is fake** (`Math.random()`), not a real per-block load measurement.
- **A deprecated `ScriptProcessorNode` recording path still exists as a fallback** (used only when `AudioWorklet` is unavailable); the primary path is now an `AudioWorkletNode`.

Previously listed here and now fixed (see the multitrack work): stateful loop accumulation is wired (`generateDSPConfig` forwards `currentState` to `parsePromptToDSP`, and incremental layering works), and the order-dependent `seq2` extraction contract is gone (the renderer consumes the track array directly; the `el.*` DSL param-extraction skin was removed).

## A.4 Test Coverage (today)

`tests/audio-engine.test.js` (Vitest) covers:
- `WebRenderer.render()` applying meta/tracks/effects from the track config, and the scheduler firing per-track voices while skipping muted tracks.
- `parsePromptToDSP`: BPM/wave/filter into the lead track, track-array schema conformance, `loop_steps` clamping to 4-64, additive add/edit/mute/remove, full-replace, gibberish-returns-unchanged, state accumulation, and null/malformed-state recovery.
- `AIManager.generateDSPConfig` forwarding `currentState` through the pipeline.

Not covered: transitions/climax audio, scheduler timing, WAV encoding, sample loading, delay FX, and all DOM/UI logic (step-grid, playhead, mute toggles are verified manually / via the headless integration run).

---

# Section B - The Bigger Vision (Roadmap)

The forward-looking direction, organized into four tracks. Each item lists concrete, testable success criteria so it can be specced and built incrementally. Nothing here is committed until scheduled into `plan.md`/`tasks.md`.

## Track 1 - Real On-Device LLM

Replace the facade with genuine local inference while keeping the NLP parser as an always-available fallback.
- Ship the WebGPU LiteRT-LM / Gemma path: stream the model binary to OPFS on first run, restore instantly on later runs, and use constrained JSON decoding so the model can only emit the DSP contract.
- Preserve the abort-on-new-prompt concurrency model (already scaffolded via `AbortController`).
- **Success:** with a supported GPU, a prompt produces valid schema-conforming JSON from the real model at TTFT < 400ms; with no GPU or no model, the parser fallback is transparent and the app is fully functional.

## Track 2 - Richer Audio Engine

Deepen synthesis and move DSP off the main thread.
- Reverb is now audible (done - see A.2); next, add sidechain/ducking and optional convolution-IR file loading.
- Add polyphony and more oscillator/wave types (true `square`, FM, wavetable).
- Migrate the real-time graph and recording tap to an **AudioWorklet**, retiring `ScriptProcessorNode`.
- Optionally make the Elementary DSL a real signal compiler rather than a param-extraction skin, removing the order-dependent `seq2` contract.
- **Success:** every parameter in the DSP contract is audibly honored; no audio glitches under load; DSP runs in an isolated worklet thread.

## Track 3 - Performance UX

Turn the composer into a live-DJ instrument.
- Beat-matched transitions between loops, MIDI and keyboard control, and a multi-deck mixer with a crossfader.
- Waveform scrubbing and cueing for imported samples.
- **Success:** a performer can beat-match and crossfade two decks live, and control core parameters from a MIDI device without touching the mouse.

## Track 4 - Shareability & Persistence

Make sessions durable and portable.
- Save/load sessions locally, a preset library, shareable set URLs that encode the DSP contract, and stems export alongside the master WAV.
- Package as an installable PWA for true offline use.
- **Success:** a user saves a set, reopens it days later offline, shares a URL that reproduces the exact loop, and installs the app to their home screen.

## Prerequisite Fixes (high-value, independent of the tracks)

- **Wire stateful loop accumulation** so `activeLoopState` actually reaches `parsePromptToDSP` and incremental layering works as intended.
- Make `filter_cutoff_hz` from the graph authoritative, or explicitly document manual-override precedence.
- Replace fake telemetry with a real per-block DSP-load metric, or remove the readout.

---

## Testing Strategy

- **Framework:** Vitest (`npm test` for CI, `npx vitest` for watch).
- **Unit (primary automated layer):** the pure logic - `parsePromptToDSP` (prompt → contract), the DSL `Node` builder, and `WebRenderer` param extraction. Every new parser rule ships with a test asserting the resulting JSON.
- **Contract tests:** assert that parser output always conforms to the DSP JSON schema in A.1, including on gibberish input (must return a valid default graph, never throw).
- **Manual E2E verification** in a modern browser (Chrome/Edge): load the app, confirm no console errors or audio-thread overloads, play a groove, submit several prompts, load a sample folder, run a transition, and record + play back the exported WAV.
- **Coverage direction:** grow automated coverage into transitions, scheduler timing, and WAV encoding; keep DOM/visual checks manual for now.
- When fixing a bug, first reproduce it end-to-end as a user would, then add a failing test, then fix.

---

## Boundaries

**Always:**
- Keep audio synthesis isolated from heavy main-thread computation; never block the audio path on parsing.
- On malformed or missing AI output, fall back to a valid default DSP graph rather than throwing.
- Escape user-derived text before inserting it into the DOM.
- Run `npm test` before committing; add tests for new parser rules and bug fixes.
- Keep the app fully functional offline with no API keys and no network dependency for the core loop.

**Ask first:**
- Adding any runtime dependency or npm package that changes the "pure web" architecture.
- Changing the DSP JSON contract (A.1) - it is shared between the parser and the engine.
- Persistence-layer or CI-config changes.

**Never:**
- Introduce audio glitches (clicks/pops) via abrupt node swaps.
- Hardcode secrets/API keys or require internet access for the core sequencer/audio loop.
- Present a facade as a real capability in user-facing copy without labeling it or actually implementing it.
- Remove or skip failing tests without approval.

---

## Success Criteria (system-level)

1. **Instant response:** a prompt changes the audio in < 400ms via parser or (future) local model.
2. **No pops/clicks:** the audio graph transitions smoothly, including during climax/transition sequences.
3. **Offline-first:** the full core experience works with no network and no keys.
4. **Recording export:** recording a mix produces a valid, playable 16-bit PCM WAV download.
5. **Sample import:** a local audio directory imports via `showDirectoryPicker()` and its samples are triggerable in the sequencer.
6. **Visual WOW:** the cyber-synthwave UI with a real-time oscilloscope and live deck-state monitor.
7. **Honest capability:** shipped features are real; remaining facades (fake DSP-load telemetry) are either implemented or clearly labeled until they are.

---

## Open Questions

1. **Real LLM priority:** is shipping genuine WebGPU/Gemma inference (Track 1) the top near-term goal, or is deepening the audio engine (Track 2) more valuable first?
2. **Language:** should `SPEC.md` and future docs stay English while the UI stays Spanish, or converge on one language?
3. **Facade cleanup:** should the fake telemetry and unlabeled facades be removed/relabeled now, or left until their real implementations land?
4. **DSL direction:** is it worth making the Elementary DSL a true signal compiler (Track 2), or is the current param-extraction skin acceptable long-term?
