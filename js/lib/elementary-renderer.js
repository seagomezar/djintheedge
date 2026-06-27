/**
 * Simulated WebRenderer for Elementary Audio.
 * Translates the virtual DSP graph into real-time Web Audio API node states
 * and runs a highly precise step sequencer scheduling loop.
 */

import { Node } from './elementary-core.js';

export class WebRenderer {
    constructor() {
        this.ctx = null;
        this.outputNode = null;
        
        // Virtual File System for local sample buffers
        this.samples = {};

        // DSP States parsed from the virtual graph
        this.bpm = 120;
        this.kickPattern = Array(16).fill(0);
        this.hihatPattern = Array(16).fill(0);
        this.synthSequence = Array(16).fill(0);
        this.synthWaveType = 'saw';
        this.filterResonance = 1.0;
        this.delayFeedback = 0.3;
        this.useCustomSample = false;
        this.sampleName = '';
        this.adsr = [0.01, 0.15, 0.7, 0.2]; // default A, D, S, R

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
     * Parses the virtual DSP tree to dynamically adjust synthesizer, sequencer, and FX configurations.
     */
    render(leftGraph, rightGraph) {
        if (!leftGraph) return;

        // 1. Walk the tree to find interesting DSP parameter settings
        const metroNodes = this.findNodesByType(leftGraph, 'metro');
        if (metroNodes.length > 0) {
            const parsedBPM = metroNodes[0].props.bpm;
            if (typeof parsedBPM === 'number' && parsedBPM > 0) {
                this.bpm = parsedBPM;
            }
        }

        // Find all seq2 nodes to extract patterns
        const seqNodes = this.findNodesByType(leftGraph, 'seq2');
        if (seqNodes.length >= 3) {
            // Match order of creation in audio-engine: kickSeq, hihatSeq, noteSeq
            this.kickPattern = seqNodes[0].props.seq || Array(16).fill(0);
            this.hihatPattern = seqNodes[1].props.seq || Array(16).fill(0);
            this.synthSequence = seqNodes[2].props.seq || Array(16).fill(0);
        } else if (seqNodes.length === 2) {
            // Fallback for drums only
            this.kickPattern = seqNodes[0].props.seq || Array(16).fill(0);
            this.hihatPattern = seqNodes[1].props.seq || Array(16).fill(0);
        }

        // Extract custom kick sample flags
        const sampleFlashNodes = this.findNodesByType(leftGraph, 'sampleFlash');
        if (sampleFlashNodes.length > 0) {
            this.useCustomSample = true;
            this.sampleName = sampleFlashNodes[0].props.path || '';
        } else {
            this.useCustomSample = false;
        }

        // Extract ADSR and Filter resonance
        const adsrNodes = this.findNodesByType(leftGraph, 'adsr');
        if (adsrNodes.length > 0) {
            const props = adsrNodes[0].props;
            if (props.a !== undefined) {
                this.adsr = [props.a, props.d, props.s, props.r];
            }
        }

        const svfNodes = this.findNodesByType(leftGraph, 'svf');
        if (svfNodes.length > 0) {
            const props = svfNodes[0].props;
            if (props.res !== undefined) {
                this.filterResonance = props.res;
            }
        }

        // Extract Synth Wave Type (saw vs. cycle/sine)
        const sawNodes = this.findNodesByType(leftGraph, 'saw');
        const cycleNodes = this.findNodesByType(leftGraph, 'cycle');
        if (sawNodes.length > 0) {
            this.synthWaveType = 'saw';
        } else if (cycleNodes.length > 0) {
            this.synthWaveType = 'cycle';
        }

        // Extract Delay feedback
        const delayNodes = this.findNodesByType(leftGraph, 'delay');
        if (delayNodes.length > 0) {
            const feedbackChild = delayNodes[0].children[2];
            if (feedbackChild && feedbackChild.type === 'const') {
                this.delayFeedback = feedbackChild.props.value;
            } else if (typeof feedbackChild === 'number') {
                this.delayFeedback = feedbackChild;
            }
            // Update delay feedback instantly
            if (this.delayFeedbackNode) {
                this.delayFeedbackNode.gain.setValueAtTime(this.delayFeedback, this.ctx.currentTime);
            }
        }
    }

    /**
     * Helper to recursively locate specific nodes by type.
     */
    findNodesByType(node, type, list = []) {
        if (!node) return list;
        if (node.type === type) {
            list.push(node);
        }
        if (node.children) {
            for (const child of node.children) {
                if (child instanceof Node) {
                    this.findNodesByType(child, type, list);
                }
            }
        }
        return list;
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
            this.currentStep = (this.currentStep + 1) % 16;
        }
    }

    scheduleStep(step, time) {
        const stepDuration = 60.0 / this.bpm / 4.0;

        // 1. Kick Drum
        const kickActive = this.kickPattern.length > 0 ? this.kickPattern[step % this.kickPattern.length] : 0;
        if (kickActive === 1) {
            if (this.useCustomSample && this.samples[this.sampleName]) {
                this.playSample(this.sampleName, time);
            } else {
                this.playSyntheticKick(time);
            }
        }

        // 2. Hi-hat
        const hihatActive = this.hihatPattern.length > 0 ? this.hihatPattern[step % this.hihatPattern.length] : 0;
        if (hihatActive === 1) {
            this.playSyntheticHihat(time);
        }

        // 3. Synthesizer Lead
        if (this.synthSequence.length > 0) {
            const midiNote = this.synthSequence[step % this.synthSequence.length];
            if (midiNote > 0) {
                this.playSynthNote(midiNote, time, stepDuration);
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
     * Synthesize lead synth note.
     */
    playSynthNote(midiNote, time, duration) {
        const osc = this.ctx.createOscillator();
        osc.type = this.synthWaveType === 'saw' ? 'sawtooth' : 'sine';

        // Frequency mapping
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        osc.frequency.setValueAtTime(freq, time);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        
        // Read manual/dynamic cutoff setting
        const currentCutoff = this.synthFilter ? this.synthFilter.frequency.value : 2000;
        filter.frequency.setValueAtTime(currentCutoff, time);
        filter.Q.setValueAtTime(this.filterResonance, time);
        
        // Cache node for manual updates
        this.synthFilter = filter;

        const gain = this.ctx.createGain();

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.delayDryNode);
        gain.connect(this.delayNode);

        // Apply ADSR Envelope
        let a = this.adsr[0];
        let d = this.adsr[1];
        const s = this.adsr[2];
        const r = this.adsr[3];
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
