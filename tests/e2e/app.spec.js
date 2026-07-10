import { test, expect } from '@playwright/test';

/**
 * Real-browser smoke test for BrowserDJ AI.
 *
 * Goal: prove the app is fully functional in headless Chromium WITHOUT WebGPU.
 * On load the app tries to load an on-device LLM via WebGPU; when that is
 * unavailable it must transparently fall back to the rule-based parser
 * (js/parser.js). The signal that fallback succeeded is that the prompt input
 * and send button become enabled and the audio engine reports "Engine Online".
 *
 * We collect every console message and page error so the run can assert there
 * are ZERO uncaught errors and ZERO console.error entries from app logic. The
 * app legitimately uses console.warn for the fallback path - warnings are fine.
 */

test('BrowserDJ AI boots via parser fallback and stays functional', async ({ page }) => {
  /** @type {{type: string, text: string}[]} */
  const consoleMessages = [];
  /** @type {string[]} */
  const pageErrors = [];

  page.on('console', (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.stack || err.message || String(err));
  });

  // 1. Navigate to the app (baseURL already includes the /djintheedge/ subpath).
  await page.goto('/');

  const promptInput = page.locator('#prompt-input');
  const btnSend = page.locator('#btn-send-prompt');
  const statusGpu = page.locator('#status-gpu');
  const statusAudio = page.locator('#status-audio');
  const trackGrid = page.locator('#track-grid');

  // 2. Wait for initialization to complete. Enabling the input controls is the
  //    definitive signal that init() ran all the way through (via fallback).
  await expect(promptInput).toBeEnabled({ timeout: 30_000 });
  await expect(btnSend).toBeEnabled({ timeout: 30_000 });

  // Audio engine must be online.
  await expect(statusAudio).toHaveText('Audio: Engine Online');

  // The GPU status must NOT be in an error state. On the fallback path the app
  // still reports the (mock) model as ready; the only failure text starts with
  // "Error:".
  const gpuText = await statusGpu.innerText();
  expect(gpuText.startsWith('Error')).toBe(false);
  expect(gpuText).not.toContain('no disponible');

  // Honesty: with no WebGPU the app must NOT claim the real model is loaded.
  // The status label and the header badge must reflect the parser fallback.
  expect(gpuText).not.toContain('Lista');
  await expect(page.locator('#ai-badge')).toContainText('Parser');

  // 3. The default groove renders: kick, hats, lead => at least 3 track rows.
  const rows = trackGrid.locator('.track-row');
  await expect(rows).toHaveCount(3, { timeout: 10_000 });
  const initialRowCount = await rows.count();
  expect(initialRowCount).toBeGreaterThanOrEqual(3);

  // 4. First prompt: add a bassline. Expect a new bass track row to appear.
  await promptInput.fill('add a bassline at 128 bpm');
  await btnSend.click();

  const bassRow = trackGrid.locator('.track-row[data-track-id="bass"]');
  await expect(bassRow).toHaveCount(1, { timeout: 10_000 });
  await expect(rows).toHaveCount(initialRowCount + 1);

  // Button text returns to its idle label after the (fast) parser round-trip.
  await expect(btnSend).toHaveText('Enviar Comando');
  await expect(btnSend).toBeEnabled();

  // BPM should have been applied by the parser.
  await expect(page.locator('#state-bpm')).toHaveText('128 BPM');

  // 5. Second prompt: make the hats faster. State must accumulate (bass stays).
  await promptInput.fill('make the hats faster');
  await btnSend.click();
  await expect(btnSend).toHaveText('Enviar Comando');
  await expect(bassRow).toHaveCount(1);

  // 6. Third prompt: mute the lead. Its row must reflect the muted state.
  await promptInput.fill('mute the lead');
  await btnSend.click();
  await expect(btnSend).toHaveText('Enviar Comando');

  const leadRow = trackGrid.locator('.track-row[data-track-id="lead"]');
  await expect(leadRow).toHaveClass(/\bmuted\b/, { timeout: 10_000 });
  // The mute toggle in a muted row shows the muted glyph.
  await expect(leadRow.locator('.track-mute')).toHaveText('🔇');

  // Screenshot for the record.
  await page.screenshot({
    path: 'tests/e2e/screenshot-after-prompts.png',
    fullPage: true,
  });

  // 7. CRITICAL: no uncaught page errors and no console.error entries.
  const consoleErrors = consoleMessages.filter((m) => m.type === 'error');
  const consoleWarnings = consoleMessages.filter((m) => m.type === 'warning');

  // Surface everything in the test output for the record.
  console.log('=== CONSOLE WARNINGS (' + consoleWarnings.length + ') ===');
  for (const w of consoleWarnings) console.log('[warn] ' + w.text);
  console.log('=== CONSOLE ERRORS (' + consoleErrors.length + ') ===');
  for (const e of consoleErrors) console.log('[error] ' + e.text);
  console.log('=== PAGE ERRORS (' + pageErrors.length + ') ===');
  for (const e of pageErrors) console.log('[pageerror] ' + e);

  expect(pageErrors, 'no uncaught page errors').toEqual([]);
  expect(consoleErrors.map((e) => e.text), 'no console.error from app logic').toEqual([]);
});
