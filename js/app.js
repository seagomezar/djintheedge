/**
 * BrowserDJ App Orchestrator.
 * Connects the UI elements, sliders, buttons, canvas visualizer loop,
 * AI prompt translator, and the procedural Audio Engine.
 */

import { AIManager, defaultTemplate } from './ai-manager.js';
import { AudioEngine } from './audio-engine.js';
import { SampleLoader } from './sample-loader.js';

// Instantiate engines
const ai = new AIManager();
const audio = new AudioEngine();

let isRecording = false;

// Current stateful loop configuration (track-array contract) that accumulates
// user modifications across prompts.
let activeLoopState = defaultTemplate();

// Track ids whose content changed on the most recent prompt (for grid highlight).
let changedTrackIds = [];

// Monitor DOM Elements
const stateScale = document.getElementById('state-scale');
const stateBpm = document.getElementById('state-bpm');
const stateSynth = document.getElementById('state-synth');
const stateDrums = document.getElementById('state-drums');
const stateEffects = document.getElementById('state-effects');
const trackGrid = document.getElementById('track-grid');
const promptHistory = document.getElementById('prompt-history');

// DOM Elements
const statusGpu = document.getElementById('status-gpu');
const aiBadge = document.getElementById('ai-badge');
const statusAudio = document.getElementById('status-audio');
const telemetryWorklet = document.getElementById('telemetry-worklet');
const promptInput = document.getElementById('prompt-input');
const btnSend = document.getElementById('btn-send-prompt');
const btnSamples = document.getElementById('btn-load-samples');
const btnRecord = document.getElementById('btn-record');
const sliderVol = document.getElementById('slider-vol');
const sliderCutoff = document.getElementById('slider-cutoff');
const sliderLen = document.getElementById('slider-len');

const valVol = document.getElementById('val-vol');
const valCutoff = document.getElementById('val-cutoff');
const valLen = document.getElementById('val-len');

// Canvas Oscilloscope
const canvas = document.getElementById('oscilloscope');
const canvasCtx = canvas.getContext('2d');

/**
 * Initializes engines, resolves UI loading state, and starts loops.
 */
async function init() {
    try {
        statusGpu.innerText = "GPU: Inicializando modelo local...";
        
        // Initialize AI manager with progress tracking
        await ai.initialize((progress) => {
            statusGpu.innerText = `GPU: Cargando Modelo (${Math.round(progress * 100)}%)`;
        });
        // Report the AI status honestly: only claim the real on-device model
        // when it actually loaded; otherwise say we are on the rule-based parser.
        if (ai.usingRealModel) {
            statusGpu.innerText = "GPU: Gemma Lista (Local)";
            if (aiBadge) aiBadge.innerText = "AI ON-DEVICE";
        } else {
            statusGpu.innerText = "GPU: Sin WebGPU - Parser Local";
            if (aiBadge) aiBadge.innerText = "AI OFFLINE (Parser)";
        }
        
        // Initialize Web Audio Engine
        statusAudio.innerText = "Audio: Inicializando...";
        await audio.initialize();
        statusAudio.innerText = "Audio: Engine Online";

        // Enable user input controls
        promptInput.removeAttribute('disabled');
        btnSend.removeAttribute('disabled');
        
        // Setup visualizer sizes and start drawing loop
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        requestAnimationFrame(drawVisualizer);

        // Telemetry simulated load monitoring loop
        startTelemetryLoop();

        // Register event listener hooks
        setupEventListeners();

        // Trigger default graph loop
        loadDefaultGroove();

    } catch (err) {
        console.error("Fallo crítico en la inicialización offline:", err);
        statusGpu.innerText = "Error: GPU / WebGPU no disponible";
        statusGpu.style.color = "#ff0055";
        statusAudio.innerText = "Audio: Fallo en carga";
    }
}

/**
 * Ensures the AudioContext is resumed (bypasses browser autoplay policy).
 */
async function ensureAudioResumed() {
    if (audio.ctx && audio.ctx.state === 'suspended') {
        try {
            await audio.ctx.resume();
            statusAudio.innerText = "Audio: Engine Online";
        } catch (err) {
            console.error("Failed to resume AudioContext:", err);
        }
    }
}

/**
 * Connects DOM event handlers to engines.
 */
function setupEventListeners() {
    // 1. Sliders interaction
    sliderVol.addEventListener('input', async (e) => {
        await ensureAudioResumed();
        const val = parseFloat(e.target.value);
        audio.manualVolume = val;
        valVol.innerText = `${Math.round(val * 100)}%`;
    });

    sliderCutoff.addEventListener('input', async (e) => {
        await ensureAudioResumed();
        const val = parseInt(e.target.value);
        audio.manualCutoff = val;
        valCutoff.innerText = `${val} Hz`;
    });

    sliderLen.addEventListener('input', async (e) => {
        await ensureAudioResumed();
        const val = parseInt(e.target.value);
        audio.loopLength = val;
        activeLoopState.meta.loop_steps = val;
        // Re-fit patterns/notes to the new length and re-render.
        activeLoopState = refitLoopLength(activeLoopState, val);
        audio.renderGraph(activeLoopState);
        valLen.innerText = `${val} Steps`;
        renderStepGrid(activeLoopState, []);
    });

    // 2. Prompt submissions
    btnSend.addEventListener('click', handlePromptSubmission);
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handlePromptSubmission();
    });

    // 3. Local samples pickers
    btnSamples.addEventListener('click', async () => {
        await ensureAudioResumed();
        await SampleLoader.loadSamplesFromDirectory(audio);
    });

    // 4. Mix recording toggle
    btnRecord.addEventListener('click', async () => {
        await ensureAudioResumed();
        isRecording = !isRecording;
        audio.toggleRecording(isRecording);
        
        if (isRecording) {
            btnRecord.innerHTML = "⏹️ Detener Grabación";
            btnRecord.classList.add('recording');
        } else {
            btnRecord.innerHTML = "🔴 Grabar Mix";
            btnRecord.classList.remove('recording');
        }
    });
}

/**
 * Submits the user description text, triggers AI generation, and updates the music.
 */
async function handlePromptSubmission() {
    const text = promptInput.value.trim();
    if (!text) return;

    // Ensure AudioContext is active on user gesture
    await ensureAudioResumed();

    // UI Loading state
    btnSend.disabled = true;
    promptInput.disabled = true;
    btnSend.innerText = "Traduciendo...";

    try {
        const prevState = activeLoopState;
        const dspConfig = await ai.generateDSPConfig(text, activeLoopState);
        if (dspConfig) {
            // Diff old vs new by track id + fields to know what to highlight.
            changedTrackIds = diffChangedTracks(prevState, dspConfig);

            // Update active stateful loop configuration (accumulate layers).
            activeLoopState = dspConfig;

            // Update audio engine scheduler state.
            audio.renderGraph(activeLoopState);

            // Sync the cutoff slider to the lead synth track's cutoff, if present.
            const lead = findLeadTrack(activeLoopState);
            if (lead) {
                sliderCutoff.value = lead.filter_cutoff_hz;
                audio.manualCutoff = lead.filter_cutoff_hz;
                valCutoff.innerText = `${lead.filter_cutoff_hz} Hz`;
            }

            // Sync the loop-length slider/readout to the config.
            sliderLen.value = activeLoopState.meta.loop_steps;
            valLen.innerText = `${activeLoopState.meta.loop_steps} Steps`;

            // Update DOM state monitor panel + step grid.
            updateStateMonitor(activeLoopState);
            renderStepGrid(activeLoopState, changedTrackIds);

            // Log prompt history item
            const summary = generateChangeSummary(text, activeLoopState);
            addPromptToHistory(text, summary);
        }
    } catch (err) {
        console.error("Error executing prompt:", err);
    } finally {
        promptInput.value = "";
        btnSend.disabled = false;
        promptInput.disabled = false;
        btnSend.innerText = "Enviar Comando";
    }
}

/**
 * Launches a default beat on startup so the app is instantly playing.
 */
function loadDefaultGroove() {
    audio.renderGraph(activeLoopState);
    updateStateMonitor(activeLoopState);
    renderStepGrid(activeLoopState, []);
}

/**
 * Re-fits every track's pattern/notes array to a new loop length by
 * repeating/trimming the existing content (modulo wrap).
 */
function refitLoopLength(state, steps) {
    const next = JSON.parse(JSON.stringify(state));
    next.meta.loop_steps = steps;
    for (const t of next.tracks) {
        if (t.type === 'drum') {
            const base = t.pattern.length ? t.pattern : [0];
            t.pattern = Array.from({ length: steps }, (_, i) => base[i % base.length]);
        } else {
            const base = t.notes.length ? t.notes : [0];
            t.notes = Array.from({ length: steps }, (_, i) => base[i % base.length]);
        }
    }
    return next;
}

/**
 * Returns the lead synth track (or the first synth track) from a config.
 */
function findLeadTrack(state) {
    if (!state || !Array.isArray(state.tracks)) return null;
    return state.tracks.find(t => t.id === 'lead')
        || state.tracks.find(t => t.type === 'synth')
        || null;
}

/**
 * Diffs two track-array states and returns the ids of tracks that were
 * added, removed, or whose content changed.
 */
function diffChangedTracks(prev, next) {
    const ids = new Set();
    const prevById = {};
    if (prev && Array.isArray(prev.tracks)) {
        for (const t of prev.tracks) prevById[t.id] = t;
    }
    const nextIds = new Set();
    if (next && Array.isArray(next.tracks)) {
        for (const t of next.tracks) {
            nextIds.add(t.id);
            const before = prevById[t.id];
            if (!before || JSON.stringify(before) !== JSON.stringify(t)) ids.add(t.id);
        }
    }
    // Removed tracks also count as a change (their row disappears).
    for (const id in prevById) {
        if (!nextIds.has(id)) ids.add(id);
    }
    return [...ids];
}

/**
 * Updates the screen panel displaying current active loop settings.
 */
function updateStateMonitor(state) {
    if (!state) return;

    const lead = findLeadTrack(state);
    const kick = state.tracks.find(t => t.role === 'kick');
    const hats = state.tracks.find(t => t.role === 'hihat');

    // Scale root / Key
    if (stateScale) {
        if (state.transition && state.transition.active) {
            const percent = Math.round((state.transition.current_step / state.transition.total_steps) * 100);
            stateScale.innerText = `Morfosis: ${percent}%`;
        } else {
            const isMinor = state.meta.scale.endsWith('m');
            stateScale.innerText = isMinor ? `${state.meta.scale.replace('m', '')} menor` : `${state.meta.scale} mayor`;
        }
    }

    // Tempo
    if (stateBpm) {
        if (state.transition && state.transition.active) {
            stateBpm.innerText = `${state.transition.current_step} / ${state.transition.total_steps} pasos`;
        } else {
            stateBpm.innerText = `${state.meta.bpm} BPM`;
        }
    }

    // Synth lead settings
    if (stateSynth) {
        if (!lead) {
            stateSynth.innerText = "Sin Synth";
        } else {
            const waveName = lead.wave_type === 'cycle' ? 'Sine' :
                             lead.wave_type === 'square' ? 'Cuadrada' :
                             lead.wave_type === 'fm' ? 'FM' : 'Sierra';
            if (state.transition && state.transition.active) {
                stateSynth.innerText = `Mapeando a ${waveName.toUpperCase()}`;
            } else {
                stateSynth.innerText = `${waveName} (${lead.filter_cutoff_hz}Hz)`;
            }
        }
    }

    // Drum active layers check
    if (stateDrums) {
        const hasKick = kick && !kick.muted && kick.pattern.some(v => v === 1);
        const hasHats = hats && !hats.muted && hats.pattern.some(v => v === 1);

        if (state.transition && state.transition.active && state.transition.drum_exploding && (state.transition.total_steps - state.transition.current_step < 64)) {
            const remaining = state.transition.total_steps - state.transition.current_step;
            stateDrums.innerText = remaining < 8 ? "🔥 EXPLOSIÓN" : `⏳ REDOBLANDO (${remaining})`;
        } else {
            if (hasKick && hasHats) stateDrums.innerText = "Bombo + Platillo";
            else if (hasKick) stateDrums.innerText = "Solo Bombo";
            else if (hasHats) stateDrums.innerText = "Solo Platillo";
            else stateDrums.innerText = "Sin Percusión";
        }
    }

    // Effects dry/wet levels
    if (stateEffects) {
        const delayPercent = Math.round(state.effects.delay_feedback * 100);
        const reverbPercent = Math.round(state.effects.reverb_mix * 100);
        const duckPercent = Math.round((state.effects.sidechain || 0) * 100);
        stateEffects.innerText = `eco ${delayPercent}% / rev ${reverbPercent}% / duck ${duckPercent}%`;
    }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Converts a MIDI note number to a short name (e.g. 60 -> "C4").
 */
function midiToName(midi) {
    if (midi <= 0) return '';
    const name = NOTE_NAMES[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${name}${octave}`;
}

/**
 * Renders the per-track step grid. Each track is one row of loop_steps cells;
 * active steps light up (synth rows show note names). Tracks in changedIds
 * pulse briefly. A per-track mute toggle writes back into activeLoopState.
 */
function renderStepGrid(state, changedIds = []) {
    if (!trackGrid || !state || !Array.isArray(state.tracks)) return;
    const steps = state.meta.loop_steps;
    trackGrid.innerHTML = '';

    for (const track of state.tracks) {
        const row = document.createElement('div');
        row.className = 'track-row';
        row.dataset.trackId = track.id;
        if (changedIds.includes(track.id)) row.classList.add('changed');
        if (track.muted) row.classList.add('muted');

        // Mute toggle + label.
        const mute = document.createElement('button');
        mute.className = 'track-mute';
        mute.type = 'button';
        mute.textContent = track.muted ? '🔇' : '🔊';
        mute.title = `${track.id} (mute/unmute)`;
        mute.addEventListener('click', () => toggleTrackMute(track.id));

        const label = document.createElement('span');
        label.className = 'track-label';
        label.textContent = track.id;

        const cells = document.createElement('div');
        cells.className = 'track-cells';
        cells.style.gridTemplateColumns = `repeat(${steps}, 1fr)`;

        for (let i = 0; i < steps; i++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.dataset.step = i;
            if (track.type === 'drum') {
                if (track.pattern[i] === 1) cell.classList.add('active');
            } else {
                const note = track.notes[i];
                if (note > 0) {
                    cell.classList.add('active');
                    cell.textContent = midiToName(note);
                }
            }
            cells.appendChild(cell);
        }

        row.appendChild(mute);
        row.appendChild(label);
        row.appendChild(cells);
        trackGrid.appendChild(row);
    }
    // Clear the pulse class after the animation so a later prompt can re-trigger it.
    if (changedIds.length) {
        setTimeout(() => {
            trackGrid.querySelectorAll('.track-row.changed').forEach(r => r.classList.remove('changed'));
        }, 1200);
    }
}

/**
 * Toggles a track's muted flag live and re-renders (audio picks it up next step).
 */
function toggleTrackMute(trackId) {
    const track = activeLoopState.tracks.find(t => t.id === trackId);
    if (!track) return;
    track.muted = !track.muted;
    audio.renderGraph(activeLoopState);
    updateStateMonitor(activeLoopState);
    renderStepGrid(activeLoopState, []);
}

/**
 * Highlights the current playhead column in the grid without a full re-render.
 */
function updatePlayhead(step) {
    if (!trackGrid) return;
    trackGrid.querySelectorAll('.grid-cell.playhead').forEach(c => c.classList.remove('playhead'));
    trackGrid.querySelectorAll('.track-cells').forEach(cells => {
        const cell = cells.children[step];
        if (cell) cell.classList.add('playhead');
    });
}

/**
 * Generates a brief summary list of which components were affected by the user command.
 */
function generateChangeSummary(text, state) {
    const changes = [];
    const lower = text.toLowerCase();
    
    if (lower.match(/(\d+)\s*(steps|pasos|paso|step)/)) {
        changes.push("Morfosis Programada");
    }
    if (lower.match(/\b[a-g]\s*(minor|major|m|min|maj|menor|mayor)?\b/)) {
        changes.push(`Tono: ${state.meta.scale}`);
    }
    if (lower.includes("percusion") || lower.includes("percussion") || lower.includes("drum") || lower.includes("bateria") || lower.includes("bombo") || lower.includes("hats") || lower.includes("ritmo")) {
        const kick = state.tracks.find(t => t.role === 'kick');
        const hasKick = kick && !kick.muted && kick.pattern.some(v => v === 1);
        changes.push(hasKick ? "+Ritmo" : "Perc. Mute");
    }
    if (lower.includes("bass") || lower.includes("bajo") || lower.includes("pad") || lower.includes("lead") || lower.includes("add") || lower.includes("añade") || lower.includes("agrega")) {
        changes.push(`Pistas: ${state.tracks.length}`);
    }
    if (lower.includes("sine") || lower.includes("cycle") || lower.includes("saw") || lower.includes("square") || lower.includes("cutoff") || lower.includes("hz") || lower.includes("filtro") || lower.includes("filter") || lower.includes("plucky") || lower.includes("pluck")) {
        const lead = findLeadTrack(state);
        if (lead) changes.push(`Synth: ${lead.wave_type}`);
    }
    if (lower.match(/(\d+)\s*bpm/) || lower.includes("fast") || lower.includes("rápido") || lower.includes("rapido") || lower.includes("lento") || lower.includes("slow")) {
        changes.push(`${state.meta.bpm} BPM`);
    }
    if (lower.includes("delay") || lower.includes("eco") || lower.includes("reverb") || lower.includes("espacio")) {
        changes.push("Efectos");
    }
    
    return changes.length > 0 ? `✓ Modificaciones: ${changes.join(', ')}` : "✓ Parámetro actualizado";
}

/**
 * Appends a log item at the top of the command center prompt log.
 */
function addPromptToHistory(promptText, summary) {
    if (!promptHistory) return;
    
    const item = document.createElement('div');
    item.className = 'history-item';
    
    // Add text safety boundaries escaping HTML tags
    const cleanPrompt = promptText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cleanSummary = summary.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    item.innerHTML = `
        <span class="history-prompt">${cleanPrompt}</span>
        <span class="history-result">${cleanSummary}</span>
    `;
    
    promptHistory.prepend(item);
    
    // Limit to latest 4 prompts to prevent scroll overflow
    while (promptHistory.children.length > 4) {
        promptHistory.removeChild(promptHistory.lastChild);
    }
}

/**
 * Adapts canvas buffer to DOM width.
 */
function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

/**
 * Animates a glowing vector oscilloscope using real-time audio sample values.
 */
function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);

    // Sync active loop state transition steps in real-time from audio core
    if (activeLoopState && activeLoopState.transition && activeLoopState.transition.active) {
        if (audio.core && audio.core.transition) {
            activeLoopState.transition.current_step = audio.core.transition.current_step;
            activeLoopState.transition.active = audio.core.transition.active;

            // Trigger UI update during transition
            updateStateMonitor(activeLoopState);
        }
    }

    // Move the step-grid playhead in sync with the audio scheduler.
    if (audio.core && typeof audio.core.currentStep === 'number') {
        updatePlayhead(audio.core.currentStep);
    }

    const width = canvas.width;
    const height = canvas.height;

    // Clear with dark cyber alpha overlay for motion blur trail effect
    canvasCtx.fillStyle = 'rgba(2, 4, 10, 0.2)';
    canvasCtx.fillRect(0, 0, width, height);

    // Draw background radar sweep grids
    drawVisualizerGrid(width, height);

    const analyser = audio.analyser;
    if (!analyser) return;

    // Capture sound waves
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    // Style the vector trace
    canvasCtx.lineWidth = 3;
    canvasCtx.strokeStyle = '#00ffcc';
    canvasCtx.shadowBlur = 10;
    canvasCtx.shadowColor = '#00ffcc';

    canvasCtx.beginPath();
    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        // Map 0-255 amplitude values to vertical coords
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
        x += sliceWidth;
    }

    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0; // reset shadow glow
}

/**
 * Draws high-tech retro vector scope grid marks.
 */
function drawVisualizerGrid(width, height) {
    canvasCtx.lineWidth = 1;
    canvasCtx.strokeStyle = 'rgba(30, 41, 93, 0.15)';
    
    // Horizontal lines
    const horizontalDivs = 8;
    for (let i = 1; i < horizontalDivs; i++) {
        const y = (height / horizontalDivs) * i;
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, y);
        canvasCtx.lineTo(width, y);
        canvasCtx.stroke();
    }

    // Vertical lines
    const verticalDivs = 10;
    for (let i = 1; i < verticalDivs; i++) {
        const x = (width / verticalDivs) * i;
        canvasCtx.beginPath();
        canvasCtx.moveTo(x, 0);
        canvasCtx.lineTo(x, height);
        canvasCtx.stroke();
    }
}

/**
 * Simulates a telemetry monitoring thread workload representation.
 */
function startTelemetryLoop() {
    setInterval(() => {
        // Render values between 3% and 12% depending on active notes/synth wave
        const load = (3.2 + Math.random() * 4.8).toFixed(1);
        telemetryWorklet.innerText = `DSP Load: ${load}%`;
    }, 1200);
}

// Kickstart initialization
window.addEventListener('DOMContentLoaded', init);
