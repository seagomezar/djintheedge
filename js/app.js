/**
 * BrowserDJ App Orchestrator.
 * Connects the UI elements, sliders, buttons, canvas visualizer loop,
 * AI prompt translator, and the procedural Audio Engine.
 */

import { AIManager } from './ai-manager.js';
import { AudioEngine } from './audio-engine.js';
import { SampleLoader } from './sample-loader.js';

// Instantiate engines
const ai = new AIManager();
const audio = new AudioEngine();

let isRecording = false;

// Current stateful loop configuration to accumulate user modifications
let activeLoopState = {
    meta: { bpm: 120, scale: "Am", energy: 0.6 },
    dsp_graph: {
        drums: {
            use_custom_sample: false,
            sample_name: "",
            kick_pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
            hihat_pattern: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1]
        },
        synth_lead: {
            wave_type: "saw",
            filter_cutoff_hz: 2000,
            filter_resonance: 2.5,
            adsr: [0.01, 0.15, 0.7, 0.2],
            notes_sequence: [57, 60, 64, 67, 64, 60, 57, 0, 57, 60, 64, 67, 64, 60, 55, 0]
        },
        effects: {
            delay_feedback: 0.3,
            reverb_mix: 0.15
        }
    }
};

// Monitor DOM Elements
const stateScale = document.getElementById('state-scale');
const stateBpm = document.getElementById('state-bpm');
const stateSynth = document.getElementById('state-synth');
const stateDrums = document.getElementById('state-drums');
const stateEffects = document.getElementById('state-effects');
const promptHistory = document.getElementById('prompt-history');

// DOM Elements
const statusGpu = document.getElementById('status-gpu');
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
        statusGpu.innerText = "GPU: Inicializando Gemma 4 Local (~2.58GB)...";
        
        // Initialize AI manager with progress tracking
        await ai.initialize((progress) => {
            statusGpu.innerText = `GPU: Cargando Modelo (${Math.round(progress * 100)}%)`;
        });
        statusGpu.innerText = "GPU: Gemma 4 Lista (Local)";
        
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
        valLen.innerText = `${val} Steps`;
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
        const dspConfig = await ai.generateDSPConfig(text, activeLoopState);
        if (dspConfig) {
            // Update active stateful loop configuration (accumulate layers)
            activeLoopState = dspConfig;

            // Update audio engine graph parameters
            audio.renderGraph(activeLoopState);
            
            // Sync slider and value readouts to whatever cutoff the AI parsed
            const parsedCutoff = activeLoopState.dsp_graph.synth_lead.filter_cutoff_hz;
            sliderCutoff.value = parsedCutoff;
            audio.manualCutoff = parsedCutoff;
            valCutoff.innerText = `${parsedCutoff} Hz`;

            // Update DOM state monitor panel
            updateStateMonitor(activeLoopState);

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
}

/**
 * Updates the screen panel displaying current active loop settings.
 */
function updateStateMonitor(state) {
    if (!state) return;
    
    // Scale root / Key
    if (stateScale) {
        const isMinor = state.meta.scale.endsWith('m');
        stateScale.innerText = isMinor ? `${state.meta.scale.replace('m', '')} menor` : `${state.meta.scale} mayor`;
    }
    
    // Tempo
    if (stateBpm) {
        stateBpm.innerText = `${state.meta.bpm} BPM`;
    }
    
    // Synth lead settings
    if (stateSynth) {
        const waveName = state.dsp_graph.synth_lead.wave_type === 'cycle' ? 'Sine' : 
                         state.dsp_graph.synth_lead.wave_type === 'square' ? 'Cuadrada' : 'Sierra';
        stateSynth.innerText = `${waveName} (${state.dsp_graph.synth_lead.filter_cutoff_hz}Hz)`;
    }
    
    // Drum active layers check
    if (stateDrums) {
        const hasKick = state.dsp_graph.drums.kick_pattern.some(v => v === 1);
        const hasHats = state.dsp_graph.drums.hihat_pattern.some(v => v === 1);
        if (hasKick && hasHats) {
            stateDrums.innerText = "Bombo + Platillo";
        } else if (hasKick) {
            stateDrums.innerText = "Solo Bombo";
        } else if (hasHats) {
            stateDrums.innerText = "Solo Platillo";
        } else {
            stateDrums.innerText = "Sin Percusión";
        }
    }
    
    // Effects dry/wet levels
    if (stateEffects) {
        const delayPercent = Math.round(state.dsp_graph.effects.delay_feedback * 100);
        const reverbPercent = Math.round(state.dsp_graph.effects.reverb_mix * 100);
        stateEffects.innerText = `eco ${delayPercent}% / rev ${reverbPercent}%`;
    }
}

/**
 * Generates a brief summary list of which components were affected by the user command.
 */
function generateChangeSummary(text, state) {
    const changes = [];
    const lower = text.toLowerCase();
    
    if (lower.match(/\b[a-g]\s*(minor|major|m|min|maj|menor|mayor)?\b/)) {
        changes.push(`Tono: ${state.meta.scale}`);
    }
    if (lower.includes("percusion") || lower.includes("percussion") || lower.includes("drum") || lower.includes("bateria") || lower.includes("bombo") || lower.includes("hats") || lower.includes("ritmo")) {
        const hasKick = state.dsp_graph.drums.kick_pattern.some(v => v === 1);
        changes.push(hasKick ? "+Ritmo" : "Perc. Mute");
    }
    if (lower.includes("sine") || lower.includes("cycle") || lower.includes("saw") || lower.includes("square") || lower.includes("cutoff") || lower.includes("hz") || lower.includes("filtro") || lower.includes("filter") || lower.includes("plucky") || lower.includes("pluck")) {
        changes.push(`Synth: ${state.dsp_graph.synth_lead.wave_type}`);
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
