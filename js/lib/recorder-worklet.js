/**
 * AudioWorkletProcessor that captures the stereo mix on the audio render
 * thread and posts raw Float32 blocks to the main thread for WAV encoding.
 *
 * Replaces the deprecated ScriptProcessorNode recording tap. This file runs in
 * the AudioWorkletGlobalScope: it has no module imports and only `registerProcessor`
 * is available. It is loaded at runtime via `audioWorklet.addModule(...)`.
 */

class RecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._recording = true;
        // The main thread can toggle capture without tearing down the node.
        this.port.onmessage = (e) => {
            if (e.data && e.data.type === "stop") this._recording = false;
            else if (e.data && e.data.type === "start") this._recording = true;
        };
    }

    /**
     * Called once per render quantum (128 frames). Copies the stereo input and
     * posts it to the main thread. Returns true to keep the node alive.
     */
    process(inputs) {
        const input = inputs[0];
        if (this._recording && input && input.length > 0) {
            const left = input[0];
            // Mono sources fill both channels; stereo uses its own right channel.
            const right = input.length > 1 ? input[1] : input[0];
            if (left && left.length) {
                // Copy: the input buffers are reused across quanta, so we must
                // not post references to them.
                const l = new Float32Array(left);
                const r = new Float32Array(right);
                this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
            }
        }
        return true;
    }
}

registerProcessor("recorder", RecorderProcessor);
