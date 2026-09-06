/**
 * Simulated Elementary Audio core node representations.
 * Constructs Virtual DSP Nodes that WebRenderer compiles.
 */

export class Node {
    constructor(type, props = {}, children = []) {
        this.type = type;
        this.props = props;
        this.children = children.map(child => {
            if (typeof child === 'number') {
                return new Node('const', { value: child });
            }
            return child;
        });
    }
}

export const el = {
    cycle(hz) {
        return new Node('cycle', {}, [hz]);
    },
    saw(hz) {
        return new Node('saw', {}, [hz]);
    },
    square(hz) {
        return new Node('square', {}, [hz]);
    },
    noise() {
        return new Node('noise', {}, []);
    },
    reverb(props = {}, input) {
        return new Node('reverb', props, [input]);
    },
    metro(props = {}) {
        return new Node('metro', props, []);
    },
    seq2(props = {}, clock) {
        return new Node('seq2', props, [clock]);
    },
    adsr(a, d, s, r, gate) {
        return new Node('adsr', { a, d, s, r }, [gate]);
    },
    svf(props = {}, input) {
        return new Node('svf', props, [input]);
    },
    delay(props = {}, delaySmp, feedback, input) {
        return new Node('delay', props, [delaySmp, feedback, input]);
    },
    mul(...children) {
        return new Node('mul', {}, children);
    },
    add(...children) {
        return new Node('add', {}, children);
    },
    mtof(seq) {
        return new Node('mtof', {}, [seq]);
    },
    sm(val) {
        return new Node('sm', { value: val }, []);
    },
    sampleFlash(props = {}, seq) {
        return new Node('sampleFlash', props, [seq]);
    },
    ms2smp(ms) {
        return new Node('ms2smp', {}, [ms]);
    }
};
