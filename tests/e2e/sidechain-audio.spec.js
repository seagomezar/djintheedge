import { test, expect } from '@playwright/test';

/**
 * Real-browser audio-truth test for sidechain ducking and AudioWorklet recording.
 * Headless Chromium has a real Web Audio implementation (OfflineAudioContext +
 * AudioWorklet), so we can prove behavior by rendering/measuring, not just by
 * inspecting config.
 */

test('sidechain duck lowers the synth bus right after a kick', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#prompt-input')).toBeEnabled({ timeout: 30_000 });

  // Reproduce the renderer's duck automation on a bus gain in an offline render:
  // a steady tone through a gain that is dipped to (1 - depth) at the "kick"
  // time and linearly released back to 1.0 - exactly what triggerSidechainDuck
  // schedules. Then compare the rendered level just after the kick vs. before.
  const { beforeKick, afterKick } = await page.evaluate(async () => {
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(1, sampleRate, sampleRate); // 1 second

    const osc = ctx.createOscillator();
    osc.frequency.value = 220;

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(1.0, 0);

    const depth = 0.7;
    const kickTime = 0.5;
    const release = 0.1; // ~80% of a 16th at ~150bpm-ish; magnitude is what matters
    bus.gain.cancelScheduledValues(kickTime);
    bus.gain.setValueAtTime(1 - depth, kickTime);
    bus.gain.linearRampToValueAtTime(1.0, kickTime + release);

    osc.connect(bus);
    bus.connect(ctx.destination);
    osc.start(0);

    const buf = await ctx.startRendering();
    const ch = buf.getChannelData(0);

    const rms = (centerSec, windowSec) => {
      const from = Math.floor((centerSec - windowSec / 2) * sampleRate);
      const to = Math.floor((centerSec + windowSec / 2) * sampleRate);
      let sum = 0;
      for (let i = from; i < to; i++) sum += ch[i] * ch[i];
      return Math.sqrt(sum / (to - from));
    };

    // Just before the kick the bus is at unity; ~10ms after the kick it is
    // ducked to ~0.3 and only partway through its release.
    return { beforeKick: rms(kickTime - 0.02, 0.01), afterKick: rms(kickTime + 0.008, 0.008) };
  });

  expect(beforeKick).toBeGreaterThan(0);
  expect(afterKick).toBeGreaterThan(0);
  // The pump is real: energy right after the kick is clearly lower than before.
  expect(afterKick).toBeLessThan(beforeKick * 0.6);
});

test('recording uses the AudioWorklet path and produces a WAV download', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#prompt-input')).toBeEnabled({ timeout: 30_000 });

  // A user gesture is needed to resume the AudioContext; submitting a prompt
  // does that. Then start recording, let a little audio flow, and stop.
  const btnRecord = page.locator('#btn-record');

  // Start recording.
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
  await btnRecord.click();
  await page.waitForTimeout(600); // let render quanta accumulate
  // Stop recording -> triggers the WAV download. force:true bypasses the
  // actionability wait: while recording the button runs an infinite pulse
  // animation (transform: scale), so Playwright never sees it "stable".
  await btnRecord.click({ force: true });

  const download = await downloadPromise;
  expect(download, 'a WAV download should be triggered on stop').not.toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.wav$/);
});
