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
        this.cutoffFrequency = 2000; // persistent filter cutoff frequency
        this.delayFeedback = 0.3;
        this.reverbMix = 0.15;
        this.isPlaying = true; // playback state
        this.useCustomSample = false;
        this.sampleName = '';
        this.adsr = [0.01, 0.15, 0.7, 0.2]; // default A, D, S, R
        this.loopLength = 16; // default loop length in steps
        this.transition = null; // tracks progress-based audio parameter morphing

        // Web Audio Nodes
        this.analyser = null;
        this.delayNode = null;
        this.delayFeedbackNode = null;
        this.delayDryNode = null;
        this.delayWetNode = null;
        this.reverbConvolverNode = null;
        this.reverbWetNode = null;
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

        // Create Reverb FX chain (stereo convolution with synthetic impulse response)
        this.reverbWetNode = this.ctx.createGain();
        this.reverbWetNode.gain.setValueAtTime(this.reverbMix, this.ctx.currentTime);
        this.reverbConvolverNode = this.ctx.createConvolver();

        const sampleRate = this.ctx.sampleRate;
        const decayTime = 2.0;
        const irLength = Math.floor(sampleRate * decayTime);
        const impulseBuffer = this.ctx.createBuffer(2, irLength, sampleRate);
        const leftChannel = impulseBuffer.getChannelData(0);
        const rightChannel = impulseBuffer.getChannelData(1);

        for (let i = 0; i < irLength; i++) {
            const t = i / sampleRate;
            const decay = Math.exp(-t * 3.5);
            leftChannel[i] = (Math.random() * 2 - 1) * decay;
            rightChannel[i] = (Math.random() * 2 - 1) * decay;
        }
        this.reverbConvolverNode.buffer = impulseBuffer;
        this.reverbConvolverNode.connect(this.reverbWetNode);
        this.reverbWetNode.connect(this.outputNode);

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
            if (props.cutoff !== undefined) {
                if (typeof props.cutoff === 'number') {
                    this.cutoffFrequency = props.cutoff;
                } else if (props.cutoff instanceof Node && props.cutoff.props && typeof props.cutoff.props.value === 'number') {
                    this.cutoffFrequency = props.cutoff.props.value;
                }
            }
        }

        // Extract Synth Wave Type (square vs. saw vs. cycle/sine)
        const squareNodes = this.findNodesByType(leftGraph, 'square');
        const sawNodes = this.findNodesByType(leftGraph, 'saw');
        const cycleNodes = this.findNodesByType(leftGraph, 'cycle');
        if (squareNodes.length > 0) {
            this.synthWaveType = 'square';
        } else if (sawNodes.length > 0) {
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

        // Extract Reverb mix
        const reverbNodes = this.findNodesByType(leftGraph, 'reverb');
        if (reverbNodes.length > 0 && typeof reverbNodes[0].props.mix === 'number') {
            this.reverbMix = reverbNodes[0].props.mix;
            if (this.reverbWetNode) {
                this.reverbWetNode.gain.setValueAtTime(this.reverbMix, this.ctx.currentTime);
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
        if (!this.isPlaying) return;

        const stepDuration = 60.0 / this.bpm / 4.0;

        let kickActive = this.kickPattern.length > 0 ? this.kickPattern[step % this.kickPattern.length] : 0;
        let hihatActive = this.hihatPattern.length > 0 ? this.hihatPattern[step % this.hihatPattern.length] : 0;
        let midiNote = this.synthSequence.length > 0 ? this.synthSequence[step % this.synthSequence.length] : 0;

        // Apply Progressive Transitions (e.g. sweeps and explosions)
        if (this.transition && this.transition.active) {
            this.transition.current_step++;
            const t = Math.min(1.0, this.transition.current_step / this.transition.total_steps);

            // 1. Interpolate Biquad Filter Cutoff Frequency
            this.cutoffFrequency = this.transition.start_cutoff + t * (this.transition.target_cutoff - this.transition.start_cutoff);
            if (this.synthFilter) {
                this.synthFilter.frequency.setValueAtTime(this.cutoffFrequency, time);
            }

            // 2. Scale Shift / Key Transposition (trigger at 50% progress)
            if (t >= 0.5 && this.transition.start_scale !== this.transition.target_scale) {
                const targetKey = this.transition.target_scale;
                const newSequence = this.generateScaleMelody(targetKey.replace("m", ""), !targetKey.endsWith("m"));
                midiNote = newSequence[step % newSequence.length];
                if (t >= 1.0) {
                    this.synthSequence = newSequence;
                }
            }

            // 3. Drum Exploding Climax Build (Accelerating roll on last steps)
            if (this.transition.drum_exploding) {
                const stepsRemaining = this.transition.total_steps - this.transition.current_step;
                if (stepsRemaining < 64) {
                    this.synthWaveType = 'saw'; // Force saw oscillator for a bright, energetic build

                    if (stepsRemaining < 8) {
                        // Exploding climax trigger
                        kickActive = 1;
                        hihatActive = 1;
                    } else if (stepsRemaining < 24) {
                        // Accelerating kick/hat roll
                        kickActive = 1;
                        hihatActive = (step % 2 === 0) ? 1 : 0;
                    } else if (stepsRemaining < 48) {
                        // Double kick speed
                        kickActive = (step % 2 === 0) ? 1 : 0;
                    }
                }
            }

            // Deactivate transition on completion and persist target properties
            if (t >= 1.0) {
                this.transition.active = false;
                if (this.transition.target_cutoff) {
                    this.cutoffFrequency = this.transition.target_cutoff;
                }
                if (this.transition.target_scale) {
                    const targetKey = this.transition.target_scale;
                    this.synthSequence = this.generateScaleMelody(targetKey.replace("m", ""), !targetKey.endsWith("m"));
                }
            }
        }

        // 1. Kick Drum
        if (kickActive === 1) {
            if (this.useCustomSample && this.samples[this.sampleName]) {
                this.playSample(this.sampleName, time);
            } else {
                this.playSyntheticKick(time);
            }
        }

        // 2. Hi-hat
        if (hihatActive === 1) {
            this.playSyntheticHihat(time);
        }

        // 3. Synthesizer Lead
        if (midiNote > 0) {
            this.playSynthNote(midiNote, time, stepDuration);
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
        if (this.reverbConvolverNode) {
            gain.connect(this.reverbConvolverNode);
        }

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
        if (this.reverbConvolverNode) {
            gain.connect(this.reverbConvolverNode);
        }

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
        osc.type = this.synthWaveType === 'saw' ? 'sawtooth' : 
                   this.synthWaveType === 'square' ? 'square' : 'sine';

        // Frequency mapping
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        osc.frequency.setValueAtTime(freq, time);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        
        // Read persistent cutoff setting
        filter.frequency.setValueAtTime(this.cutoffFrequency, time);
        filter.Q.setValueAtTime(this.filterResonance, time);
        
        // Cache node for manual updates
        this.synthFilter = filter;

        const gain = this.ctx.createGain();

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.delayDryNode);
        gain.connect(this.delayNode);
        if (this.reverbConvolverNode) {
            gain.connect(this.reverbConvolverNode);
        }

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
        if (this.reverbConvolverNode) {
            gain.connect(this.reverbConvolverNode);
        }

        gain.gain.setValueAtTime(0.9, time);

        source.start(time);
    }

    play() {
        this.isPlaying = true;
    }

    pause() {
        this.isPlaying = false;
    }

    togglePlay() {
        this.isPlaying = !this.isPlaying;
        return this.isPlaying;
    }
}
