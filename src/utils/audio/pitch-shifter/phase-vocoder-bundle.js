// phase-vocoder-bundle.js
// Self-contained phase vocoder AudioWorklet processor - real-time pitch shifting
// No ES module imports (AudioWorklet.addModule does not support them)
// Algorithm: STFT + phase locking + overlap-add time-stretch + resampling

(() => {
  'use strict';

  const FFT_SIZE = 2048;
  const HOP = 512;
  const N_BITS = 11;
  const TWO_PI = 2 * Math.PI;
  const MEAN_HANN_SQ = 0.375;

  // ==================== FFT (iterative radix-2) ====================
  const revTable = new Uint32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    let r = 0, x = i;
    for (let b = 0; b < N_BITS; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    revTable[i] = r >>> 0;
  }
  const cosT = new Float32Array(FFT_SIZE / 2);
  const sinT = new Float32Array(FFT_SIZE / 2);
  for (let i = 0; i < FFT_SIZE / 2; i++) {
    const a = -TWO_PI * i / FFT_SIZE;
    cosT[i] = Math.cos(a);
    sinT[i] = Math.sin(a);
  }

  function fftForward(re, im) {
    const n = FFT_SIZE;
    for (let i = 0; i < n; i++) {
      const j = revTable[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    let m2 = 1;
    for (let s = 1; s <= N_BITS; s++) {
      const m = 1 << s;
      const step = n / m;
      for (let k = 0; k < n; k += m) {
        for (let j = 0; j < m2; j++) {
          const idx = j * step;
          const wr = cosT[idx], wi = sinT[idx];
          const i1 = k + j, i2 = i1 + m2;
          const xr = re[i2] * wr - im[i2] * wi;
          const xi = re[i2] * wi + im[i2] * wr;
          re[i2] = re[i1] - xr;
          im[i2] = im[i1] - xi;
          re[i1] += xr;
          im[i1] += xi;
        }
      }
      m2 <<= 1;
    }
  }

  function fftInverse(re, im) {
    for (let i = 0; i < FFT_SIZE; i++) im[i] = -im[i];
    fftForward(re, im);
    const inv = 1 / FFT_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) { re[i] *= inv; im[i] = -im[i] * inv; }
  }

  // ==================== Hann window ====================
  const hannWin = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    hannWin[i] = 0.5 * (1 - Math.cos(TWO_PI * i / (FFT_SIZE - 1)));
  }

  // ==================== Phase Vocoder Processor ====================
  class PhaseVocoderProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [{
        name: 'pitchFactor',
        defaultValue: 1,
        minValue: 0.5,
        maxValue: 2,
        automationRate: 'k-rate'
      }];
    }

    constructor() {
      super();
      this._chans = [];
    }

    _newChan() {
      return {
        inBuf: new Float32Array(FFT_SIZE),
        inAccum: 0,
        outBuf: new Float32Array(FFT_SIZE * 8),
        outWrite: 0,
        outRead: 0,
        primed: false,
        re: new Float32Array(FFT_SIZE),
        im: new Float32Array(FFT_SIZE),
        mag: new Float32Array(FFT_SIZE),
        lastPhase: new Float32Array(FFT_SIZE),
        sumPhase: new Float32Array(FFT_SIZE),
      };
    }

    process(inputs, outputs, parameters) {
      const input = inputs[0];
      const output = outputs[0];
      if (!output || output.length === 0) return true;
      const p = parameters.pitchFactor[0];
      const numCh = output.length;
      while (this._chans.length < numCh) this._chans.push(this._newChan());
      for (let c = 0; c < numCh; c++) {
        const inCh = (input && input.length > c) ? input[c] : null;
        this._processChan(this._chans[c], inCh, output[c], p);
      }
      return true;
    }

    _processChan(st, inCh, outCh, p) {
      const Q = 128;
      st.inBuf.copyWithin(0, Q);
      if (inCh) {
        st.inBuf.set(inCh, FFT_SIZE - Q);
      } else {
        st.inBuf.fill(0, FFT_SIZE - Q);
      }
      st.inAccum += Q;

      while (st.inAccum >= HOP) {
        this._processFrame(st, p);
        st.inAccum -= HOP;
      }

      if (!st.primed) {
        if (st.outWrite - st.outRead >= FFT_SIZE) {
          st.primed = true;
        } else {
          outCh.fill(0);
          return;
        }
      }
      for (let i = 0; i < Q; i++) {
        const idx = Math.floor(st.outRead);
        const frac = st.outRead - idx;
        outCh[i] = st.outBuf[idx] * (1 - frac) + st.outBuf[idx + 1] * frac;
        st.outRead += p;
      }

      if (st.outRead > FFT_SIZE * 2) {
        const shift = Math.floor(st.outRead) - FFT_SIZE;
        const len = st.outBuf.length;
        st.outBuf.copyWithin(0, shift);
        st.outBuf.fill(0, len - shift);
        st.outWrite -= shift;
        st.outRead -= shift;
      }
    }

    _processFrame(st, p) {
      for (let i = 0; i < FFT_SIZE; i++) {
        st.re[i] = st.inBuf[i] * hannWin[i];
        st.im[i] = 0;
      }
      fftForward(st.re, st.im);

      const synHop = Math.round(HOP * p);
      for (let k = 0; k < FFT_SIZE; k++) {
        const re = st.re[k], im = st.im[k];
        const mag = Math.sqrt(re * re + im * im);
        const phase = Math.atan2(im, re);
        let delta = phase - st.lastPhase[k];
        const expected = TWO_PI * k * HOP / FFT_SIZE;
        let dev = delta - expected;
        dev = dev - TWO_PI * Math.round(dev / TWO_PI);
        const trueFreq = (expected + dev) / HOP;
        st.sumPhase[k] += trueFreq * synHop;
        st.mag[k] = mag;
        st.lastPhase[k] = phase;
      }

      for (let k = 0; k < FFT_SIZE; k++) {
        st.re[k] = st.mag[k] * Math.cos(st.sumPhase[k]);
        st.im[k] = st.mag[k] * Math.sin(st.sumPhase[k]);
      }
      fftInverse(st.re, st.im);

      const norm = synHop / (FFT_SIZE * MEAN_HANN_SQ);
      const wPos = st.outWrite;
      for (let i = 0; i < FFT_SIZE; i++) {
        st.outBuf[wPos + i] += st.re[i] * hannWin[i] * norm;
      }
      st.outWrite += synHop;
    }
  }

  registerProcessor('phase-vocoder-processor', PhaseVocoderProcessor);
})();
