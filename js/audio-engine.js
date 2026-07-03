/**
 * BrowserDJ Audio Engine.
 * Manages the AudioContext, the virtual WebRenderer, local sample registration,
 * and high-fidelity 16-bit stereo WAV recording.
 */

import { WebRenderer } from './lib/elementary-renderer.js';

export class AudioEngine {
    constructor() {
        this.ctx = null;
        this.core = null;
        this.outputNode = null;
        this.loadedSamples = {};
        
        // Manual slider overrides
        this._manualVolume = 0.8;
        this._manualCutoff = 2000;

        // Recording buffers & state
        this.isRecording = false;
        this.recordingProcessor = null;
        this.recordingBuffersL = [];
        this.recordingBuffersR = [];
        this.recordingLength = 0;
    }

    get manualVolume() {
        return this._manualVolume;
    }

    set manualVolume(val) {
        this._manualVolume = val;
        if (this.core && this.core.outputNode) {
            // Update gain node value dynamically
            this.core.outputNode.gain.setValueAtTime(val, this.ctx.currentTime);
        }
    }

    get manualCutoff() {
        return this._manualCutoff;
    }

    /**
     * The cutoff slider acts as a live MASTER cutoff: it sweeps every synth
     * track's filter node at once. Per-track base cutoffs (filter_cutoff_hz)
     * still seed a voice the first time it plays; thereafter the slider and the
     * transition sweep drive all live filter nodes together.
     */
    set manualCutoff(val) {
        this._manualCutoff = val;
        if (!this.core || !this.ctx) return;
        const filters = this.core.synthFilters || {};
        let any = false;
        for (const id in filters) {
            filters[id].frequency.setValueAtTime(val, this.ctx.currentTime);
            any = true;
        }
        // Fallback to the most-recent node if the per-track cache is empty.
        if (!any && this.core.synthFilter) {
            this.core.synthFilter.frequency.setValueAtTime(val, this.ctx.currentTime);
        }
    }

    get loopLength() {
        return this.core ? this.core.loopLength : 16;
    }

    set loopLength(val) {
        if (this.core) {
            this.core.loopLength = val;
        }
    }

    /**
     * Initializes the AudioContext and WebRenderer.
     */
    async initialize() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.core = new WebRenderer();

        // Initialize simulated Elementary WebRenderer node
        const node = await this.core.initialize(this.ctx, {
            numberOfInputs: 0,
            numberOfOutputs: 2,
            outputChannelCount: [2],
        });
        node.connect(this.ctx.destination);
        this.outputNode = node;
        
        // Apply default volume
        this.outputNode.gain.setValueAtTime(this._manualVolume, this.ctx.currentTime);
    }

    /**
     * Expose the visualizer analyser node.
     */
    get analyser() {
        return this.core ? this.core.analyser : null;
    }

    /**
     * Registers a local audio buffer and indexes it in the virtual filesytem.
     */
    registerSample(name, audioBuffer) {
        this.loadedSamples[name] = audioBuffer;
        this.core.updateVirtualFileSystem(this.loadedSamples);
    }

    /**
     * Applies a track-array DSP config to the renderer's live scheduler state.
     * Tracks are addressed by id/type - there is no positional node contract.
     * @param {object} config the track-array DSP contract
     */
    renderGraph(config) {
        if (!config) return;

        // Set the active transition schedule inside the core renderer clock.
        this.core.transition = config.transition || null;

        // Hand the config to the renderer, which reads meta/tracks/effects directly.
        this.core.render(config);
    }

    /**
     * Start or stop session recording.
     */
    toggleRecording(isRecording) {
        if (isRecording) {
            // Start recording
            this.recordingBuffersL = [];
            this.recordingBuffersR = [];
            this.recordingLength = 0;
            this.isRecording = true;

            // ScriptProcessor node to capture raw floats without stutters
            this.recordingProcessor = this.ctx.createScriptProcessor(4096, 2, 2);
            this.outputNode.connect(this.recordingProcessor);
            this.recordingProcessor.connect(this.ctx.destination);

            this.recordingProcessor.onaudioprocess = (e) => {
                if (!this.isRecording) return;
                const inputL = e.inputBuffer.getChannelData(0);
                const inputR = e.inputBuffer.getChannelData(1);
                
                this.recordingBuffersL.push(new Float32Array(inputL));
                this.recordingBuffersR.push(new Float32Array(inputR));
                this.recordingLength += inputL.length;
            };
        } else {
            // Stop recording
            this.isRecording = false;
            if (this.recordingProcessor) {
                this.recordingProcessor.disconnect();
                this.recordingProcessor.onaudioprocess = null;
                this.recordingProcessor = null;
            }

            // Export to WAV
            if (this.recordingLength > 0) {
                const samplesL = this.mergeBuffers(this.recordingBuffersL, this.recordingLength);
                const samplesR = this.mergeBuffers(this.recordingBuffersR, this.recordingLength);
                const wavBlob = this.encodeWAV(samplesL, samplesR, this.ctx.sampleRate);
                
                const url = URL.createObjectURL(wavBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `browser_dj_set_${Date.now()}.wav`;
                a.click();
            }
        }
    }

    /**
     * Merges a list of Float32Arrays into a single Float32Array.
     */
    mergeBuffers(channelBuffers, totalLength) {
        const result = new Float32Array(totalLength);
        let offset = 0;
        for (let i = 0; i < channelBuffers.length; i++) {
            const buffer = channelBuffers[i];
            result.set(buffer, offset);
            offset += buffer.length;
        }
        return result;
    }

    /**
     * Helper to write strings into DataViews.
     */
    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    /**
     * Encodes raw Float32 left/right channel arrays into standard 16-bit PCM WAV container.
     */
    encodeWAV(samplesL, samplesR, sampleRate) {
        const buffer = new ArrayBuffer(44 + samplesL.length * 2 * 2); // 2 channels
        const view = new DataView(buffer);

        /* RIFF identifier */
        this.writeString(view, 0, 'RIFF');
        /* file length */
        view.setUint32(4, 36 + samplesL.length * 2 * 2, true);
        /* RIFF type */
        this.writeString(view, 8, 'WAVE');
        /* format chunk identifier */
        this.writeString(view, 12, 'fmt ');
        /* format chunk length */
        view.setUint32(16, 16, true);
        /* sample format (raw PCM = 1) */
        view.setUint16(20, 1, true);
        /* channel count (stereo = 2) */
        view.setUint16(22, 2, true);
        /* sample rate */
        view.setUint32(24, sampleRate, true);
        /* byte rate (sample rate * block align) */
        view.setUint32(28, sampleRate * 4, true);
        /* block align (channels * bytes per sample) */
        view.setUint16(32, 4, true);
        /* bits per sample (16-bit) */
        view.setUint16(34, 16, true);
        /* data chunk identifier */
        this.writeString(view, 36, 'data');
        /* data chunk length */
        view.setUint32(40, samplesL.length * 2 * 2, true);

        // Interleave left and right channels, mapping Float32 to 16-bit Int16 PCM
        let offset = 44;
        for (let i = 0; i < samplesL.length; i++) {
            // Left
            let sampleL = Math.max(-1, Math.min(1, samplesL[i]));
            view.setInt16(offset, sampleL < 0 ? sampleL * 0x8000 : sampleL * 0x7FFF, true);
            offset += 2;

            // Right
            let sampleR = Math.max(-1, Math.min(1, samplesR[i]));
            view.setInt16(offset, sampleR < 0 ? sampleR * 0x8000 : sampleR * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }
}
