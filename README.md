# BrowserDJ AI

> On-device AI DJ deck and procedural composer that runs 100% in the browser, offline, with no server calls and no API keys.

BrowserDJ AI turns natural-language prompts into live music.
You type something like `fast synthwave beat at 128 bpm with a dark filter and heavy delay`, and a deterministic DSP configuration is generated and heard immediately.
Everything - parsing, synthesis, sequencing, recording - happens locally in a single browser tab.

The interface is styled as a piece of cyber-synthwave hardware, with a real-time oscilloscope, a live "AI Deck State" monitor, and a per-track step grid.

## Highlights

- **Prompt-driven, incremental composition.** A bilingual (Spanish/English) rule-based parser mutates only the tracks a prompt targets: "add a bassline" adds a track, "make the hats faster" edits the hats, "mute the lead" flips a flag, "start over" rebuilds the loop.
- **Multitrack sequencer.** A variable-length (4-64 step) 16th-note sequencer with a sample-accurate lookahead scheduler drives layered drum and synth tracks over one shared tempo.
- **Real synthesis.** Synthetic kick, bandpassed-noise hi-hat, and per-track filtered synth voices, plus a feedback delay chain.
- **Local sample import.** Import a folder of `.wav`/`.mp3` files via the File System Access API and trigger them in the sequencer.
- **WAV recording/export.** Capture your mix and download a real 16-bit PCM stereo WAV.
- **Transitions & climax.** Interpolated filter sweeps, scale morphing, and accelerating drum rolls into a climax.
- **Offline-first.** No network dependency for the core loop; nothing leaves your machine.

## Status & honesty note

This is an active, evolving project. Some capabilities are real and some are deliberate facades pending real implementations. We label them plainly rather than overselling:

- **Real today:** the NLP prompt parser, multitrack sequencer, synthesis, delay, sample import, WAV export, visualizer, transitions, and UI.
- **Real inference wiring, model not yet bundled:** the on-device LLM path is now a genuine MediaPipe WebGPU integration (`js/lib/litert-lm.js`) with OPFS model caching, schema-validated output, and a repair-retry step. It becomes live once the `@mediapipe/tasks-genai` dependency and a Gemma model binary are provisioned; until then the app transparently and honestly runs on the rule-based parser (the header shows "AI OFFLINE (Parser)"). See [`specs/on-device-llm.md`](specs/on-device-llm.md).
- **Facade / not yet real:** reverb is schema/UI only (no audio node); the "DSP Load" telemetry is randomized, not measured.

See [`spec.md`](spec.md) for the full, honest inventory (Section A) and the roadmap (Section B).

## Quick start

Requirements: [Node.js](https://nodejs.org/) 20+ and a Chromium-based browser (Chrome/Edge) for full feature support (the File System Access API and cross-origin isolation).

```bash
git clone https://github.com/seagomezar/djintheedge.git
cd djintheedge
npm install
npm run dev        # start the Vite dev server (default: http://localhost:5173)
```

Other scripts:

```bash
npm run build      # production build into dist/
npm run preview    # serve the production build locally
npm test           # run the Vitest suite once (CI-friendly)
npx vitest         # interactive watch mode
```

## How it works

A single JSON object - the **DSP contract** - flows from the "AI" layer to the audio engine. It is a track-array model: layered instrument tracks over one shared tempo and loop length.

```jsonc
{
  "meta":  { "bpm": 124, "scale": "Am", "loop_steps": 32, "energy": 0.8 },
  "tracks": [
    { "id": "kick", "type": "drum",  "role": "kick",  "muted": false,
      "pattern": [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0], "sample_name": null },
    { "id": "lead", "type": "synth", "muted": false,
      "wave_type": "saw", "filter_cutoff_hz": 1450, "filter_resonance": 3.2,
      "adsr": [0.01, 0.15, 0.7, 0.2], "notes": [57,60,64,67, 64,60,57,0] }
  ],
  "effects": { "delay_feedback": 0.35, "reverb_mix": 0.2 },
  "transition": null
}
```

The parser (`js/parser.js`) is the "brain": it starts from the current loop state and applies only the changes a prompt implies. The renderer (`js/lib/elementary-renderer.js`) consumes the track array and schedules real synth voices. See [`spec.md`](spec.md) for the full contract and its invariants.

## Project structure

```
djintheedge/
├── index.html                    # Single-page entry point
├── style.css                     # Cyber-synthwave theme
├── vite.config.js                # Vite config + COOP/COEP isolation headers
├── js/
│   ├── app.js                    # UI orchestrator
│   ├── ai-manager.js             # AIManager facade
│   ├── parser.js                 # parsePromptToDSP: the real parser
│   ├── audio-engine.js           # AudioEngine: AudioContext, render bridge, WAV recording
│   ├── sample-loader.js          # SampleLoader: File System Access import
│   └── lib/
│       ├── elementary-renderer.js  # WebRenderer: synth voices + scheduler + transitions
│       └── litert-lm.js            # LiteRTLMEngine facade
└── tests/
    └── audio-engine.test.js      # Vitest suite
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, workflow, coding style, and the rules that keep the audio path glitch-free and the docs honest.
By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Please report it privately as described in [SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

Released under the [MIT License](LICENSE).
