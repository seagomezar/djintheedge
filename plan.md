# Implementation Plan: BrowserDJ AI On-Device DJ Deck

## Overview
We will implement **BrowserDJ AI** as a client-side web application. The core challenge is integrating natural language AI parsing (with an instant NLP semantic fallback + WebGPU placeholder hooks) with a real-time procedural synthesizer and sampler engine. The app will be served via Vite and feature a high-fidelity cyberpunk visualizer console.

---

## Architecture Decisions
1. **Vite Tooling**: We will configure a lightweight, vanilla ESM Vite project. This lets us use clean imports and serve static assets securely while supporting standard JS dev patterns.
2. **Elementary Audio DSL Simulation**: Since `@elementary/web-renderer` requires commercial licensing and standard packages, we will create our own custom simulation library (`js/lib/elementary-renderer.js` and `js/lib/elementary-core.js`) that models the Elementary functional graph declaration DSL. Under the hood, this simulator will construct standard Web Audio API nodes (Oscillators, Gain nodes, BiquadFilters, Delays) and schedule note-triggers using a highly precise Web Audio AudioWorklet-free step-sequencer scheduler. This ensures zero pops/clicks, is 100% offline-compatible, and runs immediately out of the box.
3. **Double-Engine AI Manager**: We will build an AI manager that attempts to instantiate the LiteRTLMEngine for WebGPU if present, but defaults to a highly optimized regex-based semantic parser. The parser will extract BPM, scale, lead synth type, cutoff frequency, feedback, and trigger patterns, immediately mapping typical phrases to the DSP JSON schema.
4. **Recording (WAV format)**: We will route our main DSP mixer output to a `MediaStreamAudioDestinationNode`, capture the stream via a `MediaRecorder` using WAV/PCM container mapping (or high-quality Ogg/WebM converted to download), and automatically prompt download.

---

## Task List

### Phase 1: Foundation & Audio DSP Engine
Dependencies: None.

#### Task 1: Scaffolding and Vite Setup
- **Description**: Initialize the project structure, dependencies (`vite`), and create the configuration files.
- **Acceptance criteria**:
  - `package.json` contains `vite` as a dev dependency.
  - `vite.config.js` is set up to allow local serving.
  - Basic file structure is populated with blank files for `js/` modules.
- **Verification**:
  - `npm install` and running the dev server completes without errors.
- **Files likely touched**:
  - `package.json`
  - `vite.config.js`
- **Estimated scope**: Small (2 files)

#### Task 2: Functional Audio DSP Engine (`elementary-renderer.js`, `elementary-core.js`, `audio-engine.js`)
- **Description**: Build the Web Audio API backend implementing the declarative `el.*` graph DSL (supporting oscillators, noise, ADSR envelopes, filters, delay, master gain, and a step-sequencer clock).
- **Acceptance criteria**:
  - Custom `el` objects provide helpers (`el.cycle`, `el.metro`, `el.seq2`, `el.adsr`, `el.noise`, `el.mul`, `el.add`, `el.svf`, `el.delay`).
  - Audio scheduler runs in real time, triggering drum patterns (kick, hihat) and lead synthesizer melodies based on BPM.
  - Graph transitions are clean and click-free.
- **Verification**:
  - Verify synth audio plays correctly without pops or stuttering when updating the virtual graph parameters.
- **Files likely touched**:
  - `js/lib/elementary-core.js`
  - `js/lib/elementary-renderer.js`
  - `js/audio-engine.js`
- **Estimated scope**: Medium (3 files)

#### Task 3: Local Sample Import (`sample-loader.js`)
- **Description**: Build the directory file-loader using the modern File System Access API (`showDirectoryPicker()`).
- **Acceptance criteria**:
  - Clicking sample button launches a directory explorer.
  - Decodes and registers files ending in `.wav`/`.mp3` as custom sample buffers.
  - Registers them in the simulated virtual file system of the audio engine.
- **Verification**:
  - Load a local directory of audio files, ensure they are indexed, and can be triggered in the sequencer pattern.
- **Files likely touched**:
  - `js/sample-loader.js`
  - `js/audio-engine.js`
- **Estimated scope**: Small (2 files)

### Checkpoint: Foundation & Audio Engine
- [ ] Vite dev server loads.
- [ ] Procedural sound plays smoothly (kick, hihat, synth lead) on user interaction.
- [ ] User can import a folder of audio files, which get decoded without errors.

---

### Phase 2: AI Parser & Cyberpunk UI
Dependencies: Phase 1.

#### Task 4: AI Model Manager & Advanced NLP Semantic Fallback (`ai-manager.js`)
- **Description**: Write `ai-manager.js` to initialize the WebGPU LiteRT-LM engine. If WebGPU is not supported, fall back to a highly capable regex-based NLP engine that parses natural language and constructs valid JSON contracts.
- **Acceptance criteria**:
  - Detects WebGPU availability.
  - NLP semantic parser converts queries like:
    - `"make a fast synthwave beat at 135 bpm with low filter"`
    - `"ritmo house lento a 120 bpm con bastante delay"`
    into valid JSON matching the PRD Section 6 schema.
  - Fallback runs under 50ms and recovers gracefully from gibberish.
- **Verification**:
  - Create manual tests verifying the outputs of various user prompts against the target JSON schema.
- **Files likely touched**:
  - `js/ai-manager.js`
  - `js/lib/litert-lm.js`
- **Estimated scope**: Medium (2 files)

#### Task 5: High-Fidelity Cyberpunk UI & Visualizer Canvas (`index.html`, `style.css`, `app.js`)
- **Description**: Complete the UI template with a premium dark cyber-synthwave design, custom glowing animations, responsive sliders (Volume, Cutoff), and a Canvas oscilloscope/spectrum visualizer connected to the audio engine.
- **Acceptance criteria**:
  - Gorgeous responsive dark grid layout with neon green (`#00ffcc`) and pink accents.
  - Canvas oscilloscope updates at 60fps showing the playing audio waveform.
  - Keyboard focus and interactive elements feel tactile with hover effects.
- **Verification**:
  - Visual check of CSS styling, layout responsiveness, and oscilloscope canvas drawing updates.
- **Files likely touched**:
  - `index.html`
  - `style.css`
  - `js/app.js`
- **Estimated scope**: Medium (3 files)

#### Task 6: Recording Mixdown & Integration (`app.js`, `audio-engine.js`)
- **Description**: Wire all parts together. Prompt submissions must feed through the AI manager and update the audio graph. Sliders must map to DSP parameters. Add full session recording to a downloadable high-quality WAV.
- **Acceptance criteria**:
  - Inputting a prompt updates the audio playback in real-time.
  - Sliders modify cutoff filter and master volume dynamically.
  - Recording starts/stops cleanly, exporting a downloadable `.wav` file.
- **Verification**:
  - Perform a live mix, record, stop, and download the resulting file. Play back the downloaded file to verify audio contents.
- **Files likely touched**:
  - `js/app.js`
  - `js/audio-engine.js`
- **Estimated scope**: Small (2 files)

### Checkpoint: Complete System Verification
- [ ] Visualizer updates smoothly in real time.
- [ ] User prompts correctly change the BPM, melody, patterns, and effects of the music.
- [ ] Mixing and recording work, generating a playable WAV download.
- [ ] All code styles match specification guidelines.

---

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| **Elementary Audio licensing / load errors** | High | Implement a pure, robust Web Audio API scheduler simulating the exact DSL, decoupling from external CDN packages. |
| **WebGPU not supported on client device** | Medium | Seamless fallback to a regex-based NLP engine that immediately processes prompts client-side. |
| **Audio stutters during prompt parsing** | High | Execute all AI parsing asynchronously, and decouple scheduling from the Main thread (using requestAnimationFrame or Web Audio timers). |

---

## Open Questions
- None (resolved in specify phase: custom Web Audio simulation of `el` DSL and default NLP parser fallback approved).
