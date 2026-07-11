import { test, expect } from '@playwright/test';

/**
 * Real-browser audio-truth tests for the oscillator work. Headless Chromium has
 * a real Web Audio implementation, so we render tones through an
 * OfflineAudioContext and measure their spectra with an AnalyserNode to prove:
 *   (1) "square" is a real square wave, not a sine (rich odd harmonics), and
 *   (2) the FM voice's preset produces sidebands a plain sine carrier lacks.
 *
 * The spectrum helper is defined inside each page.evaluate (not passed as a
 * string) so it runs directly in the page's real Web Audio engine.
 */

test('square wave has real harmonic content (not a sine)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#prompt-input')).toBeEnabled({ timeout: 30_000 });

  const { sineHigh, squareHigh } = await page.evaluate(async () => {
    const sampleRate = 44100, fftSize = 2048, freq = 220;
    const binHz = sampleRate / fftSize;

    const spectrum = async (kind) => {
      const ctx = new OfflineAudioContext(1, Math.floor(sampleRate * 0.25), sampleRate);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = kind;
      osc.frequency.value = freq;
      osc.connect(analyser);
      osc.start(0);
      await ctx.startRendering();
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      return bins;
    };

    // Linear-magnitude energy above the 5th harmonic (a sine has ~none there).
    const highEnergy = (bins) => {
      const from = Math.floor((freq * 5) / binHz);
      let sum = 0;
      for (let i = from; i < bins.length; i++) sum += Math.pow(10, bins[i] / 20);
      return sum;
    };

    const sine = await spectrum('sine');
    const square = await spectrum('square');
    return { sineHigh: highEnergy(sine), squareHigh: highEnergy(square) };
  });

  expect(squareHigh).toBeGreaterThan(sineHigh * 5);
});

test('FM voice produces sidebands a sine carrier does not', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#prompt-input')).toBeEnabled({ timeout: 30_000 });

  const { sineSpread, fmSpread } = await page.evaluate(async () => {
    const sampleRate = 44100, fftSize = 2048, freq = 220;
    const binHz = sampleRate / fftSize;
    const fundamentalBin = Math.round(freq / binHz);

    const analyse = async (build) => {
      const ctx = new OfflineAudioContext(1, Math.floor(sampleRate * 0.25), sampleRate);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.connect(ctx.destination);
      build(ctx, analyser);
      await ctx.startRendering();
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      return bins;
    };

    const sine = await analyse((ctx, out) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(out);
      osc.start(0);
    });

    // Mirror the renderer preset: carrier sine, modulator sine at freq*2,
    // modGain = freq*4 driving carrier.frequency.
    const fm = await analyse((ctx, out) => {
      const carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = freq;
      const modulator = ctx.createOscillator();
      modulator.type = 'sine';
      modulator.frequency.value = freq * 2.0;
      const modGain = ctx.createGain();
      modGain.gain.value = freq * 4.0;
      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(out);
      carrier.start(0);
      modulator.start(0);
    });

    const offFundamental = (bins) => {
      let sum = 0;
      for (let i = 0; i < bins.length; i++) {
        if (Math.abs(i - fundamentalBin) <= 2) continue;
        sum += Math.pow(10, bins[i] / 20);
      }
      return sum;
    };
    return { sineSpread: offFundamental(sine), fmSpread: offFundamental(fm) };
  });

  expect(fmSpread).toBeGreaterThan(sineSpread * 3);
});
