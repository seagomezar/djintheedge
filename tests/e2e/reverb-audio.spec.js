import { test, expect } from '@playwright/test';

/**
 * Real-browser audio-truth test for reverb. Headless Chromium has no speakers,
 * but it has a real Web Audio implementation and OfflineAudioContext, which
 * renders a graph to a PCM buffer we can inspect. We prove that a real
 * ConvolverNode fed the app's in-code impulse response actually smears a short
 * impulse into a decaying tail (i.e. reverb is audibly real, not inert).
 */
test('reverb ConvolverNode produces a decaying tail from the generated IR', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#prompt-input')).toBeEnabled({ timeout: 30_000 });

  const result = await page.evaluate(async () => {
    // Import the exact IR generator the app uses (same module, same code path).
    const { buildImpulseResponse } = await import('/djintheedge/js/lib/reverb-ir.js');

    const sampleRate = 44100;
    const seconds = 1.5;
    const offline = new OfflineAudioContext(2, Math.floor(sampleRate * seconds), sampleRate);

    // A single-sample impulse at t=0.
    const impulseBuf = offline.createBuffer(2, 1, sampleRate);
    impulseBuf.getChannelData(0)[0] = 1;
    impulseBuf.getChannelData(1)[0] = 1;
    const src = offline.createBufferSource();
    src.buffer = impulseBuf;

    const convolver = offline.createConvolver();
    convolver.buffer = buildImpulseResponse(offline, 1.0, 2.0);

    src.connect(convolver);
    convolver.connect(offline.destination);
    src.start(0);

    const rendered = await offline.startRendering();
    const ch = rendered.getChannelData(0);

    // Measure energy in an early window vs. a much later window. A dry impulse
    // would be silent after sample 1; a reverb tail keeps energy well beyond it.
    const rms = (from, to) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += ch[i] * ch[i];
      return Math.sqrt(sum / (to - from));
    };
    const early = rms(100, 4410);          // ~2ms..100ms
    const late = rms(sampleRate / 2, sampleRate / 2 + 4410); // ~500ms window
    return { early, late, length: ch.length };
  });

  // There must be real energy shortly after the impulse (the tail exists)...
  expect(result.early).toBeGreaterThan(0);
  // ...and it must decay: late energy is present but lower than early energy.
  expect(result.late).toBeGreaterThan(0);
  expect(result.late).toBeLessThan(result.early);
});
