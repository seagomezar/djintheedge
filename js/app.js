/**
 * BrowserDJ App Orchestrator.
 * Connects the UI elements, sliders, buttons, canvas visualizer loop,
 * AI prompt translator, and the procedural Audio Engine.
 */

import { AIManager } from './ai-manager.js';
import { AudioEngine } from './audio-engine.js';
import { SampleLoader } from './sample-loader.js';
import { TRANSLATIONS, t, applyI18n } from './i18n.js';

// Instantiate engines
const ai = new AIManager();
const audio = new AudioEngine();

let isRecording = false;
let currentLang = localStorage.getItem('browserdj_lang') || 'es';

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
const btnPlay = document.getElementById('btn-play');
const btnSamples = document.getElementById('btn-load-samples');
const btnRecord = document.getElementById('btn-record');
const stepLeds = document.querySelectorAll('.step-led');

// Hardware Faders
const sliderVol = document.getElementById('slider-vol');
const sliderCutoff = document.getElementById('slider-cutoff');
const sliderReverb = document.getElementById('slider-reverb');
const sliderDelay = document.getElementById('slider-delay');
const sliderLen = document.getElementById('slider-len');

const valVol = document.getElementById('val-vol');
const valCutoff = document.getElementById('val-cutoff');
const valReverb = document.getElementById('val-reverb');
const valDelay = document.getElementById('val-delay');
const valLen = document.getElementById('val-len');

// Track Mute Buttons
const btnMuteKick = document.getElementById('btn-mute-kick');
const btnMuteHats = document.getElementById('btn-mute-hats');
const btnMuteSynth = document.getElementById('btn-mute-synth');

// Morphing Transition Bar & Chips
const morphContainer = document.getElementById('morph-container');
const morphBar = document.getElementById('morph-bar');
const morphVal = document.getElementById('morph-val');
const chipBtns = document.querySelectorAll('.chip-btn');
const ledGpu = document.getElementById('led-gpu');
const ledAudio = document.getElementById('led-audio');

// Preserved patterns for instant unmuting
let savedKickPattern = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0];
let savedHihatPattern = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1];
let savedSynthSequence = [57, 60, 64, 67, 64, 60, 57, 0, 57, 60, 64, 67, 64, 60, 55, 0];

// Canvas Oscilloscope
const canvas = document.getElementById('oscilloscope');
const canvasCtx = canvas.getContext('2d');

/**
 * Changes active locale and updates dynamic and static UI elements.
 */
function setLanguage(lang) {
    if (!TRANSLATIONS[lang]) lang = 'es';
    currentLang = lang;
    localStorage.setItem('browserdj_lang', lang);

    // 1. Update language selector buttons & LEDs
    document.querySelectorAll('.lang-btn').forEach(btn => {
        const isActive = btn.dataset.lang === lang;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    // 2. Apply static DOM text translations
    applyI18n(lang);

    // 3. Update preset chips label & prompt
    const presets = TRANSLATIONS[lang]?.presets || TRANSLATIONS.es.presets;
    document.querySelectorAll('.chip-btn[data-preset-id]').forEach(btn => {
        const id = btn.dataset.presetId;
        const preset = presets.find(p => p.id === id);
        if (preset) {
            btn.innerText = preset.label;
            btn.dataset.prompt = preset.prompt;
        }
    });

    // 4. Update length readout
    if (valLen) {
        valLen.innerText = `${audio.loopLength || 16} ${t('step_unit', lang)}`;
    }

    // 5. Update play/pause button label if present
    if (btnPlay) {
        const btnText = btnPlay.querySelector('.btn-text');
        if (btnText) {
            btnText.innerText = audio.isPlaying ? t('transport_pause', lang) : t('transport_resume', lang);
        }
    }

    // 6. Update record button label if present
    if (btnRecord) {
        const recText = btnRecord.querySelector('.btn-text');
        if (recText) {
            recText.innerText = isRecording ? t('transport_rec_stop', lang) : t('transport_rec', lang);
        }
    }

    // 7. Update status monitors
    updateStateMonitor(activeLoopState);
}

/**
 * Initializes engines, resolves UI loading state, and starts loops.
 */
async function init() {
    try {
        // Initialize active locale and DOM texts
        setLanguage(currentLang);

        statusGpu.innerText = t('status_gpu_loading', currentLang);
        
        // Initialize AI manager with progress tracking
        await ai.initialize((progress) => {
            statusGpu.innerText = `${t('status_gpu_loading', currentLang).replace('...', '')} (${Math.round(progress * 100)}%)`;
        });
        statusGpu.innerText = t('status_gpu_ready', currentLang);
        if (ledGpu) ledGpu.classList.add('active');
        
        // Initialize Web Audio Engine
        statusAudio.innerText = t('status_audio_init', currentLang);
        await audio.initialize();
        statusAudio.innerText = t('status_audio_online', currentLang);
        if (ledAudio) ledAudio.classList.add('active');

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
        statusGpu.innerText = t('status_gpu_offline', currentLang);
        statusAudio.innerText = t('status_audio_error', currentLang);
        if (ledGpu) ledGpu.classList.remove('active');
        if (ledAudio) ledAudio.classList.remove('active');
    }
}

/**
 * Ensures the AudioContext is resumed (bypasses browser autoplay policy).
 */
async function ensureAudioResumed() {
    if (audio.ctx && audio.ctx.state === 'suspended') {
        try {
            await audio.ctx.resume();
            statusAudio.innerText = t('status_audio_online', currentLang);
        } catch (err) {
            console.error("Failed to resume AudioContext:", err);
        }
    }
}

/**
 * Connects DOM event handlers to engines.
 */
function setupEventListeners() {
    // 0. Locale / Language Selector Bank
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.dataset.lang;
            if (lang && lang !== currentLang) {
                setLanguage(lang);
            }
        });
    });

    // 1. Hardware Faders interaction
    if (sliderVol) {
        sliderVol.addEventListener('input', async (e) => {
            await ensureAudioResumed();
            const val = parseFloat(e.target.value);
            audio.manualVolume = val;
            valVol.innerText = `${Math.round(val * 100)}%`;
        });
    }

    if (sliderCutoff) {
        sliderCutoff.addEventListener('input', async (e) => {
            await ensureAudioResumed();
            const val = parseInt(e.target.value);
            audio.manualCutoff = val;
            activeLoopState.dsp_graph.synth_lead.filter_cutoff_hz = val;
            valCutoff.innerText = `${val} Hz`;
        });
    }

    if (sliderReverb) {
        sliderReverb.addEventListener('input', async (e) => {
            await ensureAudioResumed();
            const val = parseFloat(e.target.value);
            activeLoopState.dsp_graph.effects.reverb_mix = val;
            valReverb.innerText = `${Math.round(val * 100)}%`;
            audio.renderGraph(activeLoopState);
            updateStateMonitor(activeLoopState);
        });
    }

    if (sliderDelay) {
        sliderDelay.addEventListener('input', async (e) => {
            await ensureAudioResumed();
            const val = parseFloat(e.target.value);
            activeLoopState.dsp_graph.effects.delay_feedback = val;
            valDelay.innerText = `${Math.round(val * 100)}%`;
            audio.renderGraph(activeLoopState);
            updateStateMonitor(activeLoopState);
        });
    }

    if (sliderLen) {
        sliderLen.addEventListener('input', async (e) => {
            await ensureAudioResumed();
            const val = parseInt(e.target.value);
            audio.loopLength = val;
            valLen.innerText = `${val} ${t('step_unit', currentLang)}`;
        });
    }

    // 2. Track Mute / Solo Pills
    if (btnMuteKick) {
        btnMuteKick.addEventListener('click', async () => {
            await ensureAudioResumed();
            const hasKick = activeLoopState.dsp_graph.drums.kick_pattern.some(v => v === 1);
            if (hasKick) {
                savedKickPattern = [...activeLoopState.dsp_graph.drums.kick_pattern];
                activeLoopState.dsp_graph.drums.kick_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            } else {
                activeLoopState.dsp_graph.drums.kick_pattern = [...savedKickPattern];
            }
            audio.renderGraph(activeLoopState);
            updateStateMonitor(activeLoopState);
            updateMutePillsUI();
        });
    }

    if (btnMuteHats) {
        btnMuteHats.addEventListener('click', async () => {
            await ensureAudioResumed();
            const hasHats = activeLoopState.dsp_graph.drums.hihat_pattern.some(v => v === 1);
            if (hasHats) {
                savedHihatPattern = [...activeLoopState.dsp_graph.drums.hihat_pattern];
                activeLoopState.dsp_graph.drums.hihat_pattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            } else {
                activeLoopState.dsp_graph.drums.hihat_pattern = [...savedHihatPattern];
            }
            audio.renderGraph(activeLoopState);
            updateStateMonitor(activeLoopState);
            updateMutePillsUI();
        });
    }

    if (btnMuteSynth) {
        btnMuteSynth.addEventListener('click', async () => {
            await ensureAudioResumed();
            const hasSynth = activeLoopState.dsp_graph.synth_lead.notes_sequence.some(v => v > 0);
            if (hasSynth) {
                savedSynthSequence = [...activeLoopState.dsp_graph.synth_lead.notes_sequence];
                activeLoopState.dsp_graph.synth_lead.notes_sequence = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            } else {
                activeLoopState.dsp_graph.synth_lead.notes_sequence = [...savedSynthSequence];
            }
            audio.renderGraph(activeLoopState);
            updateStateMonitor(activeLoopState);
            updateMutePillsUI();
        });
    }

    // 3. Creative Suggestion Chips (1-Click prompt trigger)
    chipBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const prompt = btn.dataset.prompt;
            if (!prompt) return;
            promptInput.value = prompt;
            await handlePromptSubmission();
        });
    });

    // 4. Prompt submissions
    btnSend.addEventListener('click', handlePromptSubmission);
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handlePromptSubmission();
    });

    // 5. Play / Pause toggle
    if (btnPlay) {
        btnPlay.addEventListener('click', async () => {
            await ensureAudioResumed();
            const isPlaying = audio.togglePlay();
            const btnText = btnPlay.querySelector('.btn-text');
            const btnIcon = btnPlay.querySelector('.btn-icon');
            if (isPlaying) {
                if (btnText) btnText.innerText = t('transport_pause', currentLang);
                if (btnIcon) btnIcon.innerText = "⏸️";
                btnPlay.classList.remove('paused');
            } else {
                if (btnText) btnText.innerText = t('transport_resume', currentLang);
                if (btnIcon) btnIcon.innerText = "▶️";
                btnPlay.classList.add('paused');
            }
        });
    }

    // 6. Local samples pickers
    btnSamples.addEventListener('click', async () => {
        await ensureAudioResumed();
        await SampleLoader.loadSamplesFromDirectory(audio);
    });

    // 7. Mix recording toggle
    btnRecord.addEventListener('click', async () => {
        await ensureAudioResumed();
        isRecording = !isRecording;
        audio.toggleRecording(isRecording);
        const recText = btnRecord.querySelector('.btn-text');
        
        if (isRecording) {
            if (recText) recText.innerText = t('transport_rec_stop', currentLang);
            btnRecord.classList.add('recording');
        } else {
            if (recText) recText.innerText = t('transport_rec', currentLang);
            btnRecord.classList.remove('recording');
        }
    });
}

/**
 * Updates track mute button badges according to activeLoopState.
 */
function updateMutePillsUI() {
    const hasKick = activeLoopState.dsp_graph.drums.kick_pattern.some(v => v === 1);
    const hasHats = activeLoopState.dsp_graph.drums.hihat_pattern.some(v => v === 1);
    const hasSynth = activeLoopState.dsp_graph.synth_lead.notes_sequence.some(v => v > 0);

    if (btnMuteKick) {
        btnMuteKick.classList.toggle('active', hasKick);
        btnMuteKick.classList.toggle('muted', !hasKick);
    }
    if (btnMuteHats) {
        btnMuteHats.classList.toggle('active', hasHats);
        btnMuteHats.classList.toggle('muted', !hasHats);
    }
    if (btnMuteSynth) {
        btnMuteSynth.classList.toggle('active', hasSynth);
        btnMuteSynth.classList.toggle('muted', !hasSynth);
    }
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
    const sendSpan = btnSend.querySelector('span:first-child');
    if (sendSpan) sendSpan.innerText = t('btn_translating', currentLang);

    try {
        const dspConfig = await ai.generateDSPConfig(text, activeLoopState);
        if (dspConfig) {
            // Update active stateful loop configuration (accumulate layers)
            activeLoopState = dspConfig;

            // Update audio engine graph parameters
            audio.renderGraph(activeLoopState);
            
            // Sync all 5 sliders with new values
            const parsedCutoff = activeLoopState.dsp_graph.synth_lead.filter_cutoff_hz;
            if (sliderCutoff) {
                sliderCutoff.value = parsedCutoff;
                audio.manualCutoff = parsedCutoff;
                valCutoff.innerText = `${parsedCutoff} Hz`;
            }
            if (sliderReverb && activeLoopState.dsp_graph.effects.reverb_mix !== undefined) {
                sliderReverb.value = activeLoopState.dsp_graph.effects.reverb_mix;
                valReverb.innerText = `${Math.round(activeLoopState.dsp_graph.effects.reverb_mix * 100)}%`;
            }
            if (sliderDelay && activeLoopState.dsp_graph.effects.delay_feedback !== undefined) {
                sliderDelay.value = activeLoopState.dsp_graph.effects.delay_feedback;
                valDelay.innerText = `${Math.round(activeLoopState.dsp_graph.effects.delay_feedback * 100)}%`;
            }
            if (sliderLen) {
                sliderLen.value = audio.loopLength || 16;
                valLen.innerText = `${sliderLen.value} ${t('step_unit', currentLang)}`;
            }

            // Sync mute pills
            updateMutePillsUI();

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
        if (sendSpan) sendSpan.innerText = t('btn_execute', currentLang);
    }
}

/**
 * Launches a default beat on startup so the app is instantly playing.
 */
function loadDefaultGroove() {
    audio.renderGraph(activeLoopState);
    updateMutePillsUI();
    updateStateMonitor(activeLoopState);
}

/**
 * Updates the screen panel displaying current active loop settings.
 */
function updateStateMonitor(state) {
    if (!state) return;
    
    // Scale root / Key
    if (stateScale) {
        if (state.transition && state.transition.active) {
            const percent = Math.round((state.transition.current_step / state.transition.total_steps) * 100);
            stateScale.innerText = `${t('morphing_label', currentLang)}: ${percent}%`;
        } else {
            const isMinor = state.meta.scale.endsWith('m');
            const root = state.meta.scale.replace('m', '');
            const quality = isMinor ? t('scale_minor', currentLang) : t('scale_major', currentLang);
            stateScale.innerText = `${root} ${quality}`;
        }
    }
    
    // Tempo
    if (stateBpm) {
        if (state.transition && state.transition.active) {
            stateBpm.innerText = `${state.transition.current_step} / ${state.transition.total_steps} ${t('step_unit', currentLang).toLowerCase()}`;
        } else {
            stateBpm.innerText = `${state.meta.bpm} BPM`;
        }
    }
    
    // Synth lead settings
    if (stateSynth) {
        const waveKey = state.dsp_graph.synth_lead.wave_type === 'cycle' ? 'wave_cycle' : 
                         state.dsp_graph.synth_lead.wave_type === 'square' ? 'wave_square' : 'wave_saw';
        const waveName = t(waveKey, currentLang);
        
        if (state.transition && state.transition.active) {
            stateSynth.innerText = `${t('mapping_to', currentLang)} ${waveName.toUpperCase()}`;
        } else {
            stateSynth.innerText = `${waveName} (${state.dsp_graph.synth_lead.filter_cutoff_hz}Hz)`;
        }
    }
    
    // Drum active layers check
    if (stateDrums) {
        const hasKick = state.dsp_graph.drums.kick_pattern.some(v => v === 1);
        const hasHats = state.dsp_graph.drums.hihat_pattern.some(v => v === 1);
        
        if (state.transition && state.transition.active && state.transition.drum_exploding && (state.transition.total_steps - state.transition.current_step < 64)) {
            const remaining = state.transition.total_steps - state.transition.current_step;
            stateDrums.innerText = remaining < 8 ? "🔥 EXPLOSIÓN" : `⏳ REDOBLANDO (${remaining})`;
        } else {
            if (hasKick && hasHats) {
                stateDrums.innerText = t('drums_both', currentLang);
            } else if (hasKick) {
                stateDrums.innerText = t('drums_kick_only', currentLang);
            } else if (hasHats) {
                stateDrums.innerText = t('drums_hats_only', currentLang);
            } else {
                stateDrums.innerText = t('drums_muted', currentLang);
            }
        }
    }
    
    // Effects dry/wet levels
    if (stateEffects) {
        const delayPercent = Math.round(state.dsp_graph.effects.delay_feedback * 100);
        const reverbPercent = Math.round(state.dsp_graph.effects.reverb_mix * 100);
        const echoLabel = currentLang === 'en' ? 'dly' : (currentLang === 'pt' ? 'eco' : 'eco');
        stateEffects.innerText = `${echoLabel} ${delayPercent}% / rev ${reverbPercent}%`;
    }
}

/**
 * Generates a brief summary list of which components were affected by the user command.
 */
function generateChangeSummary(text, state) {
    const changes = [];
    const lower = text.toLowerCase();
    const isEn = currentLang === 'en';
    const isPt = currentLang === 'pt';
    
    // Genre detections
    if (lower.includes("techno") || lower.includes("industrial") || lower.includes("rave")) {
        changes.push(isEn ? "Genre: Techno" : (isPt ? "Gênero: Techno" : "Género: Techno"));
    } else if (lower.includes("house") || lower.includes("disco") || lower.includes("funky")) {
        changes.push(isEn ? "Genre: House" : (isPt ? "Gênero: House" : "Género: House"));
    } else if (lower.includes("synthwave") || lower.includes("cyberpunk") || lower.includes("80s")) {
        changes.push(isEn ? "Genre: Synthwave" : (isPt ? "Gênero: Synthwave" : "Género: Synthwave"));
    } else if (lower.includes("breakbeat") || lower.includes("hiphop") || lower.includes("lofi") || lower.includes("lo-fi")) {
        changes.push(isEn ? "Genre: Breakbeat / Lo-Fi" : (isPt ? "Gênero: Breakbeat / Lo-Fi" : "Género: Breakbeat / Lo-Fi"));
    } else if (lower.includes("drum and bass") || lower.includes("dnb") || lower.includes("jungle")) {
        changes.push(isEn ? "Genre: DnB" : (isPt ? "Gênero: DnB" : "Género: DnB"));
    } else if (lower.includes("ambient") || lower.includes("chill") || lower.includes("relax")) {
        changes.push(isEn ? "Genre: Ambient" : (isPt ? "Gênero: Ambient" : "Género: Ambient"));
    } else if (lower.includes("reggaeton") || lower.includes("reguetón") || lower.includes("dembow")) {
        changes.push(isEn ? "Genre: Reggaeton" : (isPt ? "Gênero: Reggaeton" : "Género: Reggaeton"));
    } else if (lower.includes("trance") || lower.includes("edm")) {
        changes.push(isEn ? "Genre: Trance" : (isPt ? "Gênero: Trance" : "Género: Trance"));
    }

    if (lower.match(/(\d+)\s*(steps|pasos|paso|step|passos|passo)/)) {
        changes.push(isEn ? "Scheduled Morph" : (isPt ? "Morfose Programada" : "Morfosis Programada"));
    }
    if (lower.match(/(?:tono|tom|escala|scale|key|en|em)?\s*\b(dó|do|ré|re|mi|fá|fa|sol|lá|la|si|[a-g])\s*(menor|mayor|minor|major|maior|m|min|maj)?\b/)) {
        changes.push(`${isEn ? 'Key' : (isPt ? 'Tom' : 'Tono')}: ${state.meta.scale}`);
    }
    if (lower.includes("sin bateria") || lower.includes("sin batería") || lower.includes("sem bateria") || lower.includes("no drums") || lower.includes("quita la bateria") || lower.includes("tira a bateria") || lower.includes("mute bateria")) {
        changes.push(isEn ? "Drums Mute" : (isPt ? "Sem Bateria" : "Sin Batería"));
    } else if (lower.includes("sin bombo") || lower.includes("sem bumbo") || lower.includes("no kick") || lower.includes("quita el bombo") || lower.includes("tira o bumbo")) {
        changes.push(isEn ? "Kick Mute" : (isPt ? "Sem Bumbo" : "Sin Bombo"));
    } else if (lower.includes("sin hats") || lower.includes("sem chimbal") || lower.includes("sin platillos") || lower.includes("no hats")) {
        changes.push(isEn ? "Hats Mute" : (isPt ? "Sem Chimbal" : "Sin Platillos"));
    } else if (lower.includes("fast hats") || lower.includes("techno hats") || lower.includes("chimbal rápido")) {
        changes.push(isEn ? "Fast Hats" : (isPt ? "Chimbal Rápido" : "Platillos Rápidos"));
    } else if (lower.includes("doble bombo") || lower.includes("bumbo duplo") || lower.includes("double kick")) {
        changes.push(isEn ? "Double Kick" : (isPt ? "Bumbo Duplo" : "Doble Bombo"));
    } else if (lower.includes("drop") || lower.includes("climax")) {
        changes.push("🔥 DROP!");
    } else if (lower.includes("percusion") || lower.includes("percussão") || lower.includes("percussion") || lower.includes("drum") || lower.includes("bateria") || lower.includes("bombo") || lower.includes("bumbo") || lower.includes("hats") || lower.includes("chimbal") || lower.includes("ritmo")) {
        const hasKick = state.dsp_graph.drums.kick_pattern.some(v => v === 1);
        changes.push(hasKick ? (isEn ? "+Rhythm" : (isPt ? "+Ritmo" : "+Ritmo")) : (isEn ? "Perc. Mute" : (isPt ? "Perc. Mudo" : "Perc. Mute")));
    }

    if (lower.includes("square") || lower.includes("cuadrada") || lower.includes("retro") || lower.includes("8-bit")) {
        changes.push(isEn ? "Synth: Square (8-bit)" : (isPt ? "Synth: Quadrada (8-bit)" : "Synth: Cuadrada (8-bit)"));
    } else if (lower.includes("saw") || lower.includes("sierra") || lower.includes("dente de serra")) {
        changes.push(isEn ? "Synth: Saw" : (isPt ? "Synth: Dente de serra" : "Synth: Sierra"));
    } else if (lower.includes("sine") || lower.includes("cycle") || lower.includes("senoidal") || lower.includes("soft") || lower.includes("suave")) {
        changes.push(isEn ? "Synth: Sine" : (isPt ? "Synth: Senoidal" : "Synth: Senoidal"));
    }

    if (lower.includes("filtro") || lower.includes("cutoff") || lower.includes("hz") || lower.includes("oscuro") || lower.includes("escuro") || lower.includes("dark") || lower.includes("brillante") || lower.includes("brilhante") || lower.includes("bright")) {
        changes.push(`${isEn ? 'Filter' : 'Filtro'}: ${state.dsp_graph.synth_lead.filter_cutoff_hz}Hz`);
    }

    if (lower.match(/(\d+)\s*bpm/) || lower.includes("fast") || lower.includes("rápido") || lower.includes("rapido") || lower.includes("mais rápido") || lower.includes("mais lento") || lower.includes("lento") || lower.includes("slow") || lower.includes("acelera") || lower.includes("tempo")) {
        changes.push(`${state.meta.bpm} BPM`);
    }
    if (lower.includes("delay") || lower.includes("eco")) {
        changes.push(`Delay: ${Math.round(state.dsp_graph.effects.delay_feedback * 100)}%`);
    }
    if (lower.includes("reverb") || lower.includes("espacio") || lower.includes("espaço") || lower.includes("catedral")) {
        changes.push(`Reverb: ${Math.round(state.dsp_graph.effects.reverb_mix * 100)}%`);
    }
    if (lower.includes("cambia la musica") || lower.includes("muda a musica") || lower.includes("muda a música") || lower.includes("nueva melodia") || lower.includes("nova melodia") || lower.includes("algo diferente") || lower.includes("algo nuevo") || lower.includes("algo novo") || lower.includes("sorprende") || lower.includes("surpreenda")) {
        changes.push(isEn ? "Melodic Variation" : (isPt ? "Variação Melódica" : "Variación Melódica"));
    }
    
    const fallback = isEn ? "✓ Parameter updated" : (isPt ? "✓ Parâmetro atualizado" : "✓ Parámetro actualizado");
    return changes.length > 0 ? `✓ ${changes.join(' | ')}` : fallback;
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
    if (activeLoopState && activeLoopState.transition) {
        if (audio.core && audio.core.transition && audio.core.transition.active) {
            activeLoopState.transition.current_step = audio.core.transition.current_step;
            activeLoopState.transition.active = audio.core.transition.active;
            
            // Trigger UI update during transition
            updateStateMonitor(activeLoopState);
        } else if (activeLoopState.transition.active && (!audio.core || !audio.core.transition || !audio.core.transition.active)) {
            // Transition completed: consolidate final state properties
            activeLoopState.transition.active = false;
            if (activeLoopState.transition.target_scale) {
                activeLoopState.meta.scale = activeLoopState.transition.target_scale;
            }
            if (activeLoopState.transition.target_cutoff) {
                activeLoopState.dsp_graph.synth_lead.filter_cutoff_hz = activeLoopState.transition.target_cutoff;
                sliderCutoff.value = activeLoopState.transition.target_cutoff;
                valCutoff.innerText = `${activeLoopState.transition.target_cutoff} Hz`;
            }
            updateStateMonitor(activeLoopState);
        }
    }

    // Animate Morphing Transition Progress Bar
    if (morphContainer && morphBar && morphVal) {
        if (activeLoopState && activeLoopState.transition && activeLoopState.transition.active) {
            const percent = Math.min(100, Math.round((activeLoopState.transition.current_step / activeLoopState.transition.total_steps) * 100));
            morphBar.style.width = `${percent}%`;
            morphVal.innerText = `${percent}%`;
            morphContainer.style.opacity = '1';
        } else {
            morphBar.style.width = '0%';
            morphVal.innerText = '0%';
            morphContainer.style.opacity = '0.5';
        }
    }

    // Animate step sequencer LED bar
    if (audio.core && stepLeds.length > 0) {
        const currentStep = audio.core.currentStep;
        stepLeds.forEach((led, idx) => {
            if (audio.isPlaying && idx === currentStep) {
                led.classList.add('active');
            } else {
                led.classList.remove('active');
            }
        });
    }

    const width = canvas.width;
    const height = canvas.height;

    // Clear with dark alpha overlay for vintage CRT phosphor persistence
    canvasCtx.fillStyle = 'rgba(28, 28, 24, 0.28)';
    canvasCtx.fillRect(0, 0, width, height);

    // Draw background amber grid marks
    drawVisualizerGrid(width, height);

    const analyser = audio.analyser;
    if (!analyser) return;

    // Capture sound waves
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    // Style the vector trace with warm amber CRT phosphor (#fea619)
    canvasCtx.lineWidth = 2.2;
    canvasCtx.strokeStyle = '#fea619';
    canvasCtx.shadowBlur = 6;
    canvasCtx.shadowColor = 'rgba(254, 166, 25, 0.55)';

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
 * Draws subtle amber CRT vector scope grid marks.
 */
function drawVisualizerGrid(width, height) {
    canvasCtx.lineWidth = 1;
    canvasCtx.strokeStyle = 'rgba(254, 166, 25, 0.10)';
    
    // Horizontal lines
    const horizontalDivs = 8;
    for (let i = 1; i < horizontalDivs; i++) {
        const y = (height / horizontalDivs) * i;
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, y);
        canvasCtx.lineTo(width, y);
        canvasCtx.stroke();
    }

    // Vertical lines (16-step subdivisions)
    const verticalDivs = 16;
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
