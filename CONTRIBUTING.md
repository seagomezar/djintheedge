# Contributing to BrowserDJ AI

Thanks for your interest in improving BrowserDJ AI.
This project is a 100% client-side, offline-first DJ deck and procedural composer.
These guidelines keep the codebase consistent, the audio path glitch-free, and the documentation honest about what is real versus a facade.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Project architecture](#project-architecture)
- [Development workflow](#development-workflow)
- [Coding standards](#coding-standards)
- [Testing](#testing)
- [Commit and pull request guidelines](#commit-and-pull-request-guidelines)
- [The non-negotiable boundaries](#the-non-negotiable-boundaries)
- [Reporting bugs](#reporting-bugs)
- [Requesting features](#requesting-features)

## Ways to contribute

- **Report bugs** with clear reproduction steps (see [Reporting bugs](#reporting-bugs)).
- **Propose features** by opening an issue first so the direction can be discussed.
- **Improve documentation** - the README, `spec.md`, code comments, or these guidelines.
- **Write code** - fix bugs, extend the parser, deepen the audio engine, or work on a roadmap track from `spec.md` Section B.
- **Add tests** - the automated suite is deliberately growing; new parser rules and bug fixes should always ship with tests.

If you plan a non-trivial change, open an issue to discuss it before writing code. This avoids wasted effort and keeps the DSP contract and architecture coherent.

## Development setup

Requirements:

- [Node.js](https://nodejs.org/) 20 or newer.
- A Chromium-based browser (Chrome/Edge) for full feature support. The File System Access API (sample import) and cross-origin isolation headers are best supported there.

Steps:

```bash
git clone https://github.com/seagomezar/djintheedge.git
cd djintheedge
npm install
npm run dev        # http://localhost:5173
```

Useful scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the Vitest suite once (CI mode) |
| `npx vitest` | Vitest interactive watch mode |

## Project architecture

The heart of the app is a single JSON object - the **DSP contract** - that flows from the "AI" layer to the audio engine. It is fully documented in [`spec.md`](spec.md) (Section A.1). Read that before touching the parser or renderer.

- `js/parser.js` - `parsePromptToDSP`: the real, incremental parser. It mutates only the tracks a prompt targets.
- `js/lib/elementary-renderer.js` - `WebRenderer`: consumes the track array, schedules synth voices, drives transitions.
- `js/audio-engine.js` - owns the `AudioContext`, the render bridge, and WAV recording.
- `js/app.js` - UI orchestrator: DOM wiring, visualizer, step grid, telemetry.
- `js/sample-loader.js` - local sample import via the File System Access API.

`spec.md` is a living document and the source of truth. If your change affects behavior described there, update it in the same PR.

## Development workflow

1. Fork the repo and create a branch from `main` (e.g. `feat/reverb-node`, `fix/scheduler-drift`).
2. Make your change in small, focused commits.
3. Add or update tests (see [Testing](#testing)).
4. Run `npm test` and `npm run build` locally - both must pass.
5. Update `spec.md` / `README.md` if behavior or capabilities changed.
6. Open a pull request against `main`.

For bug fixes, follow this order: **reproduce the bug end-to-end as a user would, add a failing test, then fix it.** This ensures the fix addresses the real problem.

## Coding standards

- ES6 modules. Use `class`-based components where a piece owns state; use free functions for pure logic (e.g. `parsePromptToDSP`).
- 4-space indentation, double quotes for strings.
- JSDoc on public methods.
- **Escape any user-derived text before injecting it into the DOM** (see the history feed in `app.js`).
- **Language convention:** user-facing strings are Spanish; identifiers, comments, documentation, and specs are English.
- No runtime dependencies. The project ships with only `vite` and `vitest` as dev dependencies - keep it that way (see boundaries below).

## Testing

- Framework: [Vitest](https://vitest.dev/).
- The primary automated layer is pure logic: `parsePromptToDSP` (prompt -> contract), the DSL node builder, and `WebRenderer` param extraction.
- **Every new parser rule ships with a test** asserting the resulting JSON.
- **Contract tests** must assert that parser output always conforms to the DSP JSON schema, including on gibberish input (it must return a valid default graph, never throw).
- DOM/visual behavior (step grid, playhead, mute toggles) is verified manually for now. If you touch it, do a manual end-to-end pass in Chrome/Edge: load the app, confirm no console errors, play a groove, submit several prompts, import a sample folder, run a transition, and record + play back the exported WAV.

Run before every commit:

```bash
npm test
npm run build
```

## Commit and pull request guidelines

- Write clear, imperative commit messages (e.g. `fix: prevent scheduler drift on suspended context`). A [Conventional Commits](https://www.conventionalcommits.org/) style (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`) is encouraged.
- Keep PRs focused on one logical change.
- In the PR description, explain **what** changed and **why**, link any related issue, and note whether you updated `spec.md`.
- CI runs `npm run build` and `npm test` on every push and PR - make sure both pass.
- Do not remove or skip failing tests to make CI green without explicit maintainer approval.

## The non-negotiable boundaries

These rules protect the core experience. Violating them is grounds for requesting changes on a PR.

**Always:**

- Keep audio synthesis isolated from heavy main-thread computation; never block the audio path on parsing.
- On malformed or missing AI output, fall back to a valid default DSP graph rather than throwing.
- Escape user-derived text before inserting it into the DOM.
- Run `npm test` before committing; add tests for new parser rules and bug fixes.
- Keep the app fully functional offline, with no API keys and no network dependency for the core loop.

**Ask first (open an issue/discussion before the PR):**

- Adding any runtime dependency or npm package that changes the "pure web" architecture.
- Changing the DSP JSON contract - it is shared between the parser and the engine.
- Persistence-layer or CI-config changes.

**Never:**

- Introduce audio glitches (clicks/pops) via abrupt node swaps.
- Hardcode secrets/API keys or require internet access for the core sequencer/audio loop.
- Present a facade as a real capability in user-facing copy without labeling it or actually implementing it.
- Remove or skip failing tests without approval.

## Reporting bugs

Open an issue using the bug report template and include:

- What you did (the prompt or action) and what you expected.
- What actually happened, including any console errors.
- Your browser and version, and your OS.
- Reproduction steps - ideally the exact sequence of prompts.

## Requesting features

Open an issue using the feature request template. Describe the problem you want solved, not just the solution. If it maps to one of the roadmap tracks in `spec.md` Section B, mention which one.

---

Thank you for helping make BrowserDJ AI better.
