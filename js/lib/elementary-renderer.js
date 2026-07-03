/**
 * Simulated WebRenderer for Elementary Audio.
 * Consumes the track-array DSP contract directly (tracks addressed by id/type)
 * and runs a highly precise step-sequencer scheduling loop over real Web Audio nodes.
 */

export class WebRenderer {
    constructor() {
        this.ctx = null;
        this.outputNode = null;
        
        // Virtual File System for local sample buffers
        this.samples = {};

        // DSP States driven by the track-array contract
        this.bpm = 120;
        this.tracks = [];          // array of drum/synth track objects
        this.delayFeedback = 0.3;
        this.loopLength = 32;      // default loop length in steps
        this.transition = null;    // tracks progress-based audio parameter morphing

        // Per-synth-track filter node cache (keyed by track id) for live cutoff updates
        this.synthFilters = {};
        // Most-recent synth filter node; the manual cutoff slider drives this (see T6).
        this.synthFilter = null;

        // Web Audio Nodes
        this.analyser = null;
        this.delayNode = null;
        this.delayFeedbackNode = null;
        this.delayDryNode = null;
        this.delayWetNode = null;
        this.synthFilter = null;

        // Sequencer Clock state
        this.schedulerIntervalId = null;
        this.currentStep = 0;
        this.nextStepTime = 0.0;
        this.lookahead = 50.0; // milliseconds to check ahead
        this.scheduleAheadTime = 0.1; // seconds ahead to schedule

        // White noise buffer for Hi-hat synthesis
        this.noiseBuffer = null;
    }

    /**
     * Initializes the Web Audio API nodes.
     * Returns an AudioNode that can be connected to context destination.
     */
    async initialize(ctx, options = {}) {
        this.ctx = ctx;

        // Generate white noise buffer
        const bufferSize = 2 * this.ctx.sampleRate;
        this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        // Create main output proxy nodes
        this.outputNode = this.ctx.createGain();
        this.outputNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 512;
        this.outputNode.connect(this.analyser);

        // Create Delay FX chain
        this.delayDryNode = this.ctx.createGain();
        this.delayWetNode = this.ctx.createGain();
        this.delayNode = this.ctx.createDelay(2.0);
        this.delayFeedbackNode = this.ctx.createGain();

        // Delay routing
        this.delayDryNode.connect(this.outputNode);
        this.delayNode.connect(this.delayFeedbackNode);
        this.delayFeedbackNode.connect(this.delayNode); // loop
        this.delayNode.connect(this.delayWetNode);
        this.delayWetNode.connect(this.outputNode);

        // Configure default delay levels
        this.delayDryNode.gain.setValueAtTime(1.0, this.ctx.currentTime);
        this.delayWetNode.gain.setValueAtTime(0.3, this.ctx.currentTime); // wet mix level
        this.delayNode.delayTime.setValueAtTime(0.3, this.ctx.currentTime); // 300ms delay
        this.delayFeedbackNode.gain.setValueAtTime(0.3, this.ctx.currentTime);

        // Start scheduling clock
        this.nextStepTime = this.ctx.currentTime + 0.1;
        this.startScheduler();

        return this.outputNode;
    }

    /**
     * Updates virtual samples file system.
     */
    updateVirtualFileSystem(samples) {
        this.samples = samples;
    }

    /**
     * Applies a track-array DSP config to the live scheduler state.
     * Tracks are addressed by id/type - there is no positional node contract.
     * @param {object} config the track-array DSP contract
     */
    render(config) {
        if (!config) return;

        if (config.meta && typeof config.meta.bpm === 'number' && config.meta.bpm > 0) {
            this.bpm = config.meta.bpm;
        }
        if (config.meta && typeof config.meta.loop_steps === 'number') {
            this.loopLength = config.meta.loop_steps;
        }

        // Swap in the new track array (already validated/normalized by the parser).
        this.tracks = Array.isArray(config.tracks) ? config.tracks : [];

        // Global delay feedback.
        if (config.effects && typeof config.effects.delay_feedback === 'number') {
            this.delayFeedback = config.effects.delay_feedback;
            if (this.delayFeedbackNode) {
                this.delayFeedbackNode.gain.setValueAtTime(this.delayFeedback, this.ctx.currentTime);
            }
        }
    }

    /**
     * Start the interval scheduling clock.
     */
    startScheduler() {
        if (this.schedulerIntervalId) clearInterval(this.schedulerIntervalId);
        this.schedulerIntervalId = setInterval(() => {
            this.schedulerTick();
        }, this.lookahead);
    }

    /**
     * Check if we need to schedule steps.
     */
    schedulerTick() {
        // Prevent catch-up burst if context was suspended or thread lagged
        if (this.nextStepTime < this.ctx.currentTime) {
            this.nextStepTime = this.ctx.currentTime + 0.05;
        }

        while (this.nextStepTime < this.ctx.currentTime + this.scheduleAheadTime) {
            this.scheduleStep(this.currentStep, this.nextStepTime);
            
            // Advance step time based on BPM (sixteenth notes)
            const stepDuration = 60.0 / this.bpm / 4.0;
            this.nextStepTime += stepDuration;

            // Increment loop step
            this.currentStep = (this.currentStep + 1) % this.loopLength;
        }
    }

    generateScaleMelody(rootName, isMinor) {
        const roots = { 'C': 60, 'D': 62, 'E': 64, 'F': 65, 'G': 67, 'A': 57, 'B': 59 };
        let rootMidi = roots[rootName] || 60;
        const intervals = isMinor ? [0, 2, 3, 5, 7, 8, 10, 12] : [0, 2, 4, 5, 7, 9, 11, 12];
        
        const pattern = [0, 2, 4, 7, 4, 2, 0, 7, 0, 2, 4, 7, 4, 2, -1, -2];
        return pattern.map(idx => {
            if (idx === -1) return rootMidi - 12; // Octave below
            if (idx === -2) return rootMidi - 5; // Fifth below
            const interval = intervals[idx % intervals.length];
            return rootMidi + interval;
        });
    }

    scheduleStep(step, time) {
        const stepDuration = 60.0 / this.bpm / 4.0;

        // --- Progressive transition state (cutoff sweep, scale morph, climax) ---
        let morphSequence = null;       // overrides synth notes when a key change fires
        let explosion = null;           // { kickForce, hihatForce } drum climax overrides
        if (this.transition && this.transition.active) {
            this.transition.current_step++;
            const t = Math.min(1.0, this.transition.current_step / this.transition.total_steps);

            // 1. Interpolate cutoff on every live synth filter node.
            const currentCutoff = this.transition.start_cutoff + t * (this.transition.target_cutoff - this.transition.start_cutoff);
            for (const id in this.synthFilters) {
                this.synthFilters[id].frequency.setValueAtTime(currentCutoff, time);
            }

            // 2. Scale shift / key transposition (trigger at 50% progress).
            if (t >= 0.5 && this.transition.start_scale !== this.transition.target_scale) {
                const targetKey = this.transition.target_scale;
                morphSequence = this.generateScaleMelody(targetKey.replace("m", ""), targetKey.endsWith("m"));
            }

            // 3. Drum exploding climax build (accelerating roll on the last steps).
            if (this.transition.drum_exploding) {
                const stepsRemaining = this.transition.total_steps - this.transition.current_step;
                if (stepsRemaining < 64) {
                    if (stepsRemaining < 8) explosion = { kick: 1, hihat: 1 };
                    else if (stepsRemaining < 24) explosion = { kick: 1, hihat: (step % 2 === 0) ? 1 : 0 };
                    else if (stepsRemaining < 48) explosion = { kick: (step % 2 === 0) ? 1 : 0, hihat: null };
                }
            }

            if (t >= 1.0) this.transition.active = false;
        }

        // --- Iterate every track by id/type (no positional contract) ---
        for (const track of this.tracks) {
            if (track.muted) continue;

            if (track.type === "drum") {
                const pattern = track.pattern || [];
                let active = pattern.length > 0 ? pattern[step % pattern.length] : 0;

                // Apply climax overrides by role.
                if (explosion) {
                    if (track.role === "kick" && explosion.kick !== null) active = explosion.kick;
                    if (track.role === "hihat" && explosion.hihat !== null) active = explosion.hihat;
                }
                if (active !== 1) continue;

                if (track.role === "hihat") {
                    this.playSyntheticHihat(time);
                } else if (track.sample_name && this.samples[track.sample_name]) {
                    this.playSample(track.sample_name, time);
                } else {
                    this.playSyntheticKick(time);
                }
            } else if (track.type === "synth") {
                const notes = track.notes || [];
                let midiNote = notes.length > 0 ? notes[step % notes.length] : 0;
                if (morphSequence) midiNote = morphSequence[step % morphSequence.length];
                if (midiNote > 0) this.playSynthNote(midiNote, time, stepDuration, track);
            }
        }
    }

    /**
     * Synthesize kick drum.
     */
    playSyntheticKick(time) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.connect(gain);
        gain.connect(this.delayDryNode);
        gain.connect(this.delayNode);

        // Pitch envelope
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);

        // Amplitude envelope
        gain.gain.setValueAtTime(1.0, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

        osc.start(time);
        osc.stop(time + 0.16);
    }

    /**
     * Synthesize hi-hat noise burst.
     */
    playSyntheticHihat(time) {
        if (!this.noiseBuffer) return;

        const source = this.ctx.createBufferSource();
        source.buffer = this.noiseBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(8000, time);
        filter.Q.setValueAtTime(3.0, time);

        const gain = this.ctx.createGain();

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.delayDryNode);
        gain.connect(this.delayNode);

        gain.gain.setValueAtTime(0.25, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

        source.start(time);
        source.stop(time + 0.06);
    }

    /**
     * Synthesize a synth note for a given track.
     * @param {number} midiNote
     * @param {number} time
     * @param {number} duration
     * @param {object} track the synth track (wave_type, filter_cutoff_hz, filter_resonance, adsr)
     */
    playSynthNote(midiNote, time, duration, track = {}) {
        const waveType = track.wave_type || 'saw';
        const resonance = typeof track.filter_resonance === 'number' ? track.filter_resonance : 1.0;
        const adsr = Array.isArray(track.adsr) ? track.adsr : [0.01, 0.15, 0.7, 0.2];
        const trackId = track.id || 'lead';

        const osc = this.ctx.createOscillator();
        osc.type = waveType === 'saw' ? 'sawtooth' : 'sine';

        // Frequency mapping
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        osc.frequency.setValueAtTime(freq, time);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';

        // Per-track cutoff: reuse the track's last cached filter value (so live
        // slider/transition updates persist), else fall back to the track param.
        const cached = this.synthFilters[trackId];
        const currentCutoff = cached ? cached.frequency.value
            : (typeof track.filter_cutoff_hz === 'number' ? track.filter_cutoff_hz : 2000);
        filter.frequency.setValueAtTime(currentCutoff, time);
        filter.Q.setValueAtTime(resonance, time);

        // Cache node for live cutoff updates (per track + most-recent for the slider).
        this.synthFilters[trackId] = filter;
        this.synthFilter = filter;

        const gain = this.ctx.createGain();

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.delayDryNode);
        gain.connect(this.delayNode);

        // Apply ADSR Envelope
        let a = adsr[0];
        let d = adsr[1];
        const s = adsr[2];
        const r = adsr[3];
        const gateDuration = duration * 0.8; // let notes release cleanly

        // Adjust attack and decay if they exceed gate duration to prevent Web Audio overlapping errors
        const totalEnvelopeTime = a + d;
        if (gateDuration < totalEnvelopeTime) {
            const scale = gateDuration / totalEnvelopeTime;
            a *= scale;
            d *= scale;
        }

        gain.gain.setValueAtTime(0, time);
        // Attack
        gain.gain.linearRampToValueAtTime(0.4, time + a);
        // Decay to Sustain
        gain.gain.linearRampToValueAtTime(0.4 * s, time + a + d);
        // Hold Sustain until gate ends
        gain.gain.setValueAtTime(0.4 * s, time + gateDuration);
        // Release
        gain.gain.linearRampToValueAtTime(0.001, time + gateDuration + r);

        osc.start(time);
        osc.stop(time + gateDuration + r + 0.05);
    }

    /**
     * Play custom audio sample.
     */
    playSample(name, time) {
        const buffer = this.samples[name];
        if (!buffer) return;

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const gain = this.ctx.createGain();
        source.connect(gain);
        gain.connect(this.delayDryNode);
        gain.connect(this.delayNode);

        gain.gain.setValueAtTime(0.9, time);

        source.start(time);
    }
}
