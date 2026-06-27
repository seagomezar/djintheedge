# Spec: BrowserDJ AI - On-Device DJ Deck & Composer

## Objective
We are building **BrowserDJ AI**, a client-side, offline-first DJ deck and procedural synthesizer composer that runs 100% in the browser. Users will be able to control the musical performance in real-time by writing natural language prompts (e.g., "make a fast synthwave beat with heavy delay and a 128 BPM kick"), which are translated into dynamic DSP graphs and sequencer patterns.

### Key Features & User Stories
1. **Prompt-to-Music (Offline AI)**: A user inputs a description. The system parses it offline and instantly updates the playing drums, synthesizer melody, cutoff filter, and audio effects.
2. **Zero-Latency Audio**: The audio plays smoothly at 44.1kHz without pops, cracks, or UI-driven thread blockages.
3. **Local Audio Integration**: A user loads a directory of local audio samples (WAV/MP3) which are integrated directly into the sequencer.
4. **Mix Recording**: A user can record their performance session and download a high-fidelity WAV file.
5. **Premium Interactive UI**: A futuristic, glowing dark cyber-synthwave style UI with a real-time oscilloscope/spectrum visualizer, physical sliders, and interactive controls.

---

## Tech Stack
- **Core**: Vanilla HTML5, CSS3, ES6+ JavaScript Modules
- **Audio Engine**: Web Audio API implementing the **Elementary Audio** functional/declarative DSL model.
- **AI Engine**: Hybrid LiteRT-LM framework:
  1. *Actual Engine*: WebGPU-based LiteRT-LM engine (MediaPipe LLM Inference model, e.g. Gemma 2B/4B).
  2. *Intelligent Semantic Fallback*: Client-side rule-based Natural Language Processing (NLP) parser that processes user inputs instantly and generates valid DSP contracts, ensuring the application is fully functional out of the box even without a 2.58GB WebGPU model download.
- **Dev Tooling**: Vite for static serving, HMR, and clean ES module resolution.

---

## Commands
We will use Vite as our local dev server and builder:
- **Initialize Project**: `npm init -y` and `npm install -D vite`
- **Run Dev Server**: `npx vite --port 5173`
- **Build**: `npx vite build`
- **Preview Build**: `npx vite preview`

---

## Project Structure
```
djintheedge/
├── index.html                           # Main entry point
├── style.css                            # Premium CSS stylesheet
├── package.json                         # Node config
├── vite.config.js                       # Vite configurations
├── spec.md                              # This specification
├── js/
│   ├── app.js                           # App entry point & UI coordinator
│   ├── ai-manager.js                    # LiteRT-LM or Semantic Fallback parser
│   ├── audio-engine.js                  # Web Audio API engine & Elementary Audio simulation
│   ├── sample-loader.js                 # Local directory file system access wrapper
│   └── lib/
│       ├── elementary-renderer.js       # Elementary WebRenderer facade
│       ├── elementary-core.js           # Elementary node definitions (el)
│       └── litert-lm.js                 # WebGPU LiteRT-LM model loader/facade
└── tests/                               # Test suite (if applicable)
```

---

## Code Style
We will write modular, clean, and well-typed JavaScript using ES6 Modules.
Example from `audio-engine.js`:
```javascript
export class AudioEngine {
    constructor() {
        this.ctx = null;
        this.core = null;
        this.manualVolume = 0.8;
    }

    /**
     * Initializes the Web Audio API context and WebRenderer node.
     * @returns {Promise<void>}
     */
    async initialize() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (!this.ctx) {
            throw new Error("Web Audio API is not supported in this browser.");
        }
        // Core initialization logic
    }
}
```

---

## Testing Strategy
1. **Manual Visual and Audio Verification**: Load the application in a modern browser (Chrome/Edge) with WebGPU and Web Audio API enabled.
2. **Console Verification**: Ensure no Web Audio thread overloads, memory leaks, or console errors are printed.
3. **Mock Validation**: Verify the semantic NLP parser correctly converts a variety of natural language inputs into valid JSON contracts conforming to Section 6 of the PRD.

---

## Boundaries
- **Always**:
  - Keep audio synthesis completely isolated from main-thread computational blocks.
  - Implement a fallback DSP configuration if the AI returns malformed JSON.
  - Use absolute absolute paths or relative standard paths for files.
- **Ask first**:
  - Adding complex npm packages that alter the "Pure Web" runtime architecture.
- **Never**:
  - Allow audio glitches (clicks/pops) due to abrupt node swaps.
  - Hardcode API keys or require external internet access for the core sequencer/audio loop.

---

## Success Criteria
1. **Visual WOW Factor**: The user interface uses professional cyber-synthwave aesthetics (dark slate, neon accents, neon glow, custom sliders, responsive spectrum analyzer canvas).
2. **Instant Response**: Text prompts are translated to audio changes in < 400ms (either via the fallback parser or active WebGPU session).
3. **No Pops/Clicks**: Audio transitions smoothly when the graph changes.
4. **Recording Export**: A user records a mix, and downloading it outputs a valid WAV file.
5. **Sample Import**: Local audio directories can be imported using `showDirectoryPicker()` and mapped into the sequencer.

---

## Open Questions
1. **Elementary Audio libraries**: Since `elementary-renderer.js` and `elementary-core.js` are proprietary libraries, we will build a highly robust, pure Web Audio API-based implementation of the `el` DSL (oscillators, noise, ADSR envelope, SVF filter, delay, sequencer) directly within our `js/lib/` folder. This guarantees that the code runs out-of-the-box and offline without licensing or missing-dependency errors. Is this approach acceptable?
2. **Local Model File**: Gemma 4 (LiteRT) files are large. We will implement both the WebGPU-based model loader and a smart regex/semantic natural language parser fallback. The fallback will parse natural language parameters (e.g. "bpm", "lead", "filter") locally in microseconds. Should the fallback be enabled automatically if WebGPU or the model file is not available?
