/**
 * High-fidelity Web Audio API Mock for End-to-End browser testing in Node/Happy-DOM.
 * Implements real clock progression, audio buffer allocation, node graph connections,
 * and parameter automation methods (setValueAtTime, etc.).
 */

export class MockAudioParam {
    constructor(defaultValue = 1.0) {
        this.value = defaultValue;
        this.timeline = [];
    }

    setValueAtTime(value, time) {
        this.value = value;
        this.timeline.push({ type: 'setValueAtTime', value, time });
    }

    linearRampToValueAtTime(value, time) {
        this.value = value;
        this.timeline.push({ type: 'linearRampToValueAtTime', value, time });
    }

    exponentialRampToValueAtTime(value, time) {
        this.value = value;
        this.timeline.push({ type: 'exponentialRampToValueAtTime', value, time });
    }
}

export class MockAudioNode {
    constructor(context) {
        this.context = context;
        this.connectedTo = [];
    }

    connect(destination) {
        this.connectedTo.push(destination);
        return destination;
    }

    disconnect(destination) {
        if (destination) {
            this.connectedTo = this.connectedTo.filter(d => d !== destination);
        } else {
            this.connectedTo = [];
        }
    }
}

export class MockGainNode extends MockAudioNode {
    constructor(context) {
        super(context);
        this.gain = new MockAudioParam(1.0);
    }
}

export class MockDelayNode extends MockAudioNode {
    constructor(context, maxDelayTime = 1.0) {
        super(context);
        this.delayTime = new MockAudioParam(0.3);
    }
}

export class MockBiquadFilterNode extends MockAudioNode {
    constructor(context) {
        super(context);
        this.frequency = new MockAudioParam(2000);
        this.Q = new MockAudioParam(1.0);
        this.type = 'lowpass';
    }
}

export class MockConvolverNode extends MockAudioNode {
    constructor(context) {
        super(context);
        this.buffer = null;
    }
}

export class MockAnalyserNode extends MockAudioNode {
    constructor(context) {
        super(context);
        this.fftSize = 512;
        this.frequencyBinCount = 256;
    }

    getByteTimeDomainData(array) {
        for (let i = 0; i < array.length; i++) {
            array[i] = 128 + Math.round(Math.sin(i * 0.1) * 30);
        }
    }

    getByteFrequencyData(array) {
        for (let i = 0; i < array.length; i++) {
            array[i] = Math.max(0, 100 - i);
        }
    }
}

export class MockOscillatorNode extends MockAudioNode {
    constructor(context) {
        super(context);
        this.type = 'sine';
        this.frequency = new MockAudioParam(440);
        this.started = false;
        this.stopped = false;
    }

    start(time = 0) {
        this.started = true;
    }

    stop(time = 0) {
        this.stopped = true;
    }
}

export class MockAudioBufferSourceNode extends MockAudioNode {
    constructor(context) {
        super(context);
        this.buffer = null;
        this.playbackRate = new MockAudioParam(1.0);
        this.loop = false;
        this.started = false;
        this.stopped = false;
    }

    start(time = 0) {
        this.started = true;
    }

    stop(time = 0) {
        this.stopped = true;
    }
}

export class MockAudioBuffer {
    constructor(numberOfChannels, length, sampleRate) {
        this.numberOfChannels = numberOfChannels;
        this.length = length;
        this.sampleRate = sampleRate;
        this.duration = length / sampleRate;
        this._channels = [];
        for (let c = 0; c < numberOfChannels; c++) {
            this._channels.push(new Float32Array(length));
        }
    }

    getChannelData(channelIndex) {
        return this._channels[channelIndex] || new Float32Array(this.length);
    }

    copyFromChannel(destination, channelNumber, startInChannel = 0) {
        const source = this.getChannelData(channelNumber);
        destination.set(source.subarray(startInChannel, startInChannel + destination.length));
    }

    copyToChannel(source, channelNumber, startInChannel = 0) {
        const target = this.getChannelData(channelNumber);
        target.set(source, startInChannel);
    }
}

export class MockScriptProcessorNode extends MockAudioNode {
    constructor(context, bufferSize = 4096, numberOfInputChannels = 2, numberOfOutputChannels = 2) {
        super(context);
        this.bufferSize = bufferSize;
        this.numberOfInputChannels = numberOfInputChannels;
        this.numberOfOutputChannels = numberOfOutputChannels;
        this.onaudioprocess = null;
    }

    simulateProcess(inputBuffer, outputBuffer) {
        if (this.onaudioprocess) {
            this.onaudioprocess({
                inputBuffer: inputBuffer || new MockAudioBuffer(this.numberOfInputChannels, this.bufferSize, this.context.sampleRate),
                outputBuffer: outputBuffer || new MockAudioBuffer(this.numberOfOutputChannels, this.bufferSize, this.context.sampleRate),
                playbackTime: this.context.currentTime
            });
        }
    }
}

export class MockAudioContext {
    constructor() {
        this.sampleRate = 44100;
        this.currentTime = 0.0;
        this.state = 'running';
        this.destination = new MockAudioNode(this);
    }

    createGain() {
        return new MockGainNode(this);
    }

    createDelay(maxDelayTime = 1.0) {
        return new MockDelayNode(this, maxDelayTime);
    }

    createBiquadFilter() {
        return new MockBiquadFilterNode(this);
    }

    createConvolver() {
        return new MockConvolverNode(this);
    }

    createAnalyser() {
        return new MockAnalyserNode(this);
    }

    createOscillator() {
        return new MockOscillatorNode(this);
    }

    createBufferSource() {
        return new MockAudioBufferSourceNode(this);
    }

    createBuffer(channels, length, sampleRate) {
        return new MockAudioBuffer(channels, length, sampleRate);
    }

    createScriptProcessor(bufferSize, numberOfInputChannels, numberOfOutputChannels) {
        return new MockScriptProcessorNode(this, bufferSize, numberOfInputChannels, numberOfOutputChannels);
    }

    async decodeAudioData(arrayBuffer) {
        return new MockAudioBuffer(2, 44100, 44100);
    }

    async resume() {
        this.state = 'running';
    }

    async suspend() {
        this.state = 'suspended';
    }

    async close() {
        this.state = 'closed';
    }

    advanceTime(seconds) {
        this.currentTime += seconds;
    }
}

export function setupWebAudioMock() {
    globalThis.AudioContext = MockAudioContext;
    globalThis.webkitAudioContext = MockAudioContext;
    if (typeof window !== 'undefined') {
        window.AudioContext = MockAudioContext;
        window.webkitAudioContext = MockAudioContext;
    }
}
