# Tasks: BrowserDJ AI On-Device DJ Deck

## Task 1: Scaffolding and Vite Setup

**Description:** Set up the basic Node.js project configuration, install Vite as a dev dependency, configure `vite.config.js` to serve ESM modules, and create the basic empty folder structure for the source files.

**Acceptance criteria:**
- [ ] `package.json` is initialized with a start script mapping to `vite`.
- [ ] `vite.config.js` is created and correctly configured.
- [ ] Empty placeholder modules for `js/app.js`, `js/ai-manager.js`, `js/audio-engine.js`, and `js/sample-loader.js` are created.

**Verification:**
- [ ] Build succeeds: `npx vite build` (verifies Vite can resolve empty scaffolding).
- [ ] Manual check: Run `npx vite` and verify that the dev server starts and serves from `localhost` without errors.

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `vite.config.js`
- `index.html` (created/stubbed)
- `style.css` (created/stubbed)
- `js/app.js` (created)
- `js/ai-manager.js` (created)
- `js/audio-engine.js` (created)
- `js/sample-loader.js` (created)

**Estimated scope:** Small (1-2 configuration files plus stubs)

---

## Task 2: Simulated Functional Audio DSP Engine

**Description:** Build a pure Web Audio API-based implementation of the Elementary Audio DSL inside `js/lib/elementary-renderer.js` and `js/lib/elementary-core.js`. Implement the `AudioEngine` in `js/audio-engine.js` using these simulations, featuring a precise Web Audio clock/sequencer to play kick patterns, hi-hat noise bursts, and synthesizer lead scales smoothly and click-free.

**Acceptance criteria:**
- [ ] `js/lib/elementary-core.js` and `js/lib/elementary-renderer.js` provide working functional APIs mapping to `el.cycle`, `el.noise`, `el.metro`, `el.seq2`, `el.adsr`, `el.svf`, `el.delay`, and `el.mul`/`el.add` summing.
- [ ] `AudioEngine` initializes an `AudioContext`, processes virtual JSON graph updates, and maintains a precise playback scheduler based on BPM.
- [ ] Swapping parameters or notes does not produce audio clicks, stutters, or pops.

**Verification:**
- [ ] Manual check: Create a temporary test harness in `js/app.js` that boots the AudioEngine and plays a loop. Ensure audio is synthesized cleanly.

**Dependencies:** Task 1

**Files likely touched:**
- `js/lib/elementary-core.js`
- `js/lib/elementary-renderer.js`
- `js/audio-engine.js`

**Estimated scope:** Medium (3 files)

---

## Task 3: Local Sample Import

**Description:** Implement `js/sample-loader.js` to read local folders using `window.showDirectoryPicker()`. Decode audio files (WAV, MP3) into memory buffers and register them with the audio engine's simulated virtual file system.

**Acceptance criteria:**
- [ ] Directory Picker opens, loads, and processes files recursively or iteratively.
- [ ] Decodes file streams using `ctx.decodeAudioData` into `AudioBuffer` objects.
- [ ] Registers buffers to the simulated WebRenderer virtual file system by sample name.

**Verification:**
- [ ] Manual check: Run sample loading using sample audio files in the browser and verify the buffers print to the console when loaded.

**Dependencies:** Task 2

**Files likely touched:**
- `js/sample-loader.js`
- `js/audio-engine.js`

**Estimated scope:** Small (2 files)

---

### Checkpoint 1: Foundation & Audio Engine
- [ ] Vite dev server loads the application scaffolding.
- [ ] Sound engine runs procedural synthesis (kick rhythm, hihats, synth melody) cleanly.
- [ ] User can trigger a folder picker to load local sample files, resolving them to memory audio buffers.

---

## Task 4: AI Model Manager & NLP Semantic Fallback

**Description:** Create `js/ai-manager.js` to manage the LiteRT-LM WebGPU initialization (providing the standard conversation and prompt API hooks). Implement a robust client-side semantic regex-based NLP engine that parses prompts (extracting BPM, scale, lead synth waveform, filter cutoff, delay feedback, and rhythm complexity) and produces the correct DSP JSON contract.

**Acceptance criteria:**
- [ ] AI Manager initializes successfully and checks for WebGPU support.
- [ ] Semantic parser detects key natural language tokens:
  - BPM (e.g., "120 bpm", "fast", "lento")
  - Synth lead type ("saw", "sine", "triangle", "cycle")
  - Cutoff frequency ("lowpass 800hz", "filtro de 1500")
  - Drum pattern triggers ("four to the floor", "kick on every beat")
- [ ] Returns a valid JSON matching the PRD Section 6 schema.

**Verification:**
- [ ] Manual check: Write test cases in console output processing various test phrases (e.g., "acelera a 140 bpm con filtro bajo y delay", "slow synthwave 90 bpm") and verify correct JSON schema outputs.

**Dependencies:** Task 1

**Files likely touched:**
- `js/ai-manager.js`
- `js/lib/litert-lm.js` (created)

**Estimated scope:** Medium (2 files)

---

## Task 5: Cyberpunk UI & Visualizer Canvas

**Description:** Design a gorgeous dark cyber-synthwave DJ console UI with glowing buttons, animated canvas oscilloscope/spectrum visualizer, custom vertical range inputs for Master Vol and Filter Cutoff, and a text input deck.

**Acceptance criteria:**
- [ ] HTML file structure implements the layout from the blueprint.
- [ ] CSS includes premium theme variables, glowing borders, custom typography (e.g., fonts from Google Fonts or monospace), visualizer canvas scaling, and micro-interactions.
- [ ] Canvas oscilloscope draws real-time time-domain or frequency data at 60fps using an `AnalyserNode` from the audio engine.

**Verification:**
- [ ] Manual check: Open the browser, check visual appearance, check layout responsiveness, and verify oscilloscope updates dynamically.

**Dependencies:** Task 2, Task 4

**Files likely touched:**
- `index.html`
- `style.css`
- `js/app.js`

**Estimated scope:** Medium (3 files)

---

## Task 6: Recording Mixdown & Integration

**Description:** Integrate the AI manager, audio engine, sample loader, and UI elements. Connect the audio output destination to a MediaRecorder to record the performance stream, converting it to a high-quality PCM WAV file download on stop.

**Acceptance criteria:**
- [ ] Entering text and hitting submit calls the AI parser and updates the synthesizer/drum audio.
- [ ] Manual sliders update master gain and synth cutoff frequency instantly in the Web Audio context.
- [ ] Clicking "Grabar Mix" captures audio and successfully downloads a playable `.wav` file on stop.

**Verification:**
- [ ] Manual check: Perform a mix session, adjust sliders, trigger a prompt change, record the session, download the WAV file, and confirm it plays back.

**Dependencies:** Task 3, Task 5

**Files likely touched:**
- `js/app.js`
- `js/audio-engine.js`

**Estimated scope:** Small (2 files)

---

### Checkpoint 2: Final Integration and Release
- [ ] Application compiles and builds cleanly without Vite or syntax errors.
- [ ] Oscilloscope shows real-time wave synthesis visual feedback.
- [ ] Typing a prompt dynamically changes the sound and style of the music playing offline.
- [ ] Custom samples are successfully loaded and override default kick/hihat sounds.
- [ ] Mixdown records and exports a playable high-quality WAV.
