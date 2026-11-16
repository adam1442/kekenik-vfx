# Contributing to Kekenik VFX

Thank you for your interest! Bug reports, documentation fixes, translations, samples and code are all welcome. By taking part you agree
to follow the [Code of Conduct](CODE_OF_CONDUCT.md). By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE).

## Ways to help

- Report a bug (use the issue form and paste the GPU diagnostics for startup or rendering problems).
- Suggest a feature, or pick something from [docs/ROADMAP.md](docs/ROADMAP.md). For larger changes, open an issue first.
- Improve the Persian translation or add a language ([docs/I18N_GUIDE.md](docs/I18N_GUIDE.md)).
- Add or improve sample projects, docs and tests.

## Setup

Requirements: Node.js 20.19+ (the version used by CI is in `.nvmrc`) and, for manual testing, a browser with WebGPU.

```bash
git clone https://github.com/adam1442/kekenik-vfx.git
cd kekenik-vfx
npm ci
npm run dev
```

Before opening a pull request run:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

(`npm run check` runs typecheck, lint, the i18n audit and the tests.)

## Code style

- TypeScript in strict mode; avoid `any` (ESLint warns). Formatting follows `.prettierrc` and `.editorconfig`
  (`npm run format`). Please do not reformat unrelated code.
- WGSL: keep shaders small, commented and defensive. Avoid reserved words as identifiers; see the rules in the developer guide.
- No `console.log` in committed code. Use the `consoleBus` logger for messages the user should see.
- Keep the app **client-side and offline-capable**: no analytics, telemetry, external fonts, CDNs or runtime network calls.
- GPU memory goes through `MemoryManager`; never await GPU read-backs in the render path.
- Write comments, text and documentation **in your own words**. Do not copy text from other software's documentation, and do not use
  other products' trademarks in the UI.
- New dependencies need a clear justification; pin exact versions and run `npm run notices`.

## Branches and pull requests

1. Fork the repository and create a topic branch from `main`: `feature/<short-name>`, `fix/<short-name>` or `docs/<short-name>`.
2. Keep pull requests focused. Fill in the pull request template.
3. CI (type check, lint, tests, build on LTS and current Node) must pass. Add or update tests for behavioural changes.
4. A maintainer reviews the change; squash-merge is used.

## Adding a node, gizmo, panel or exporter

Step-by-step instructions are in [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md): §3 nodes, §4 gizmos, §5 panels, §6 exporters.
After adding or changing nodes run `npm run docs:nodes` to regenerate [docs/NODE_REFERENCE.md](docs/NODE_REFERENCE.md). Parameter ids
are stored in project files: never rename them (bump the node `version` and add a migration instead).

## Testing

- `npm run test` runs Vitest; it needs no GPU. Put node tests next to the node (`src/nodes/<category>/<node>/<node>.test.ts`) and
  other tests in `tests/`.
- GPU behaviour is checked manually and with the development-only harness at `/#selftest` on `npm run dev` (see the developer guide).
- Include CPU reference implementations for new maths where practical.

## Internationalisation

- All user-visible text uses keys in `src/i18n/en.json` and a Persian value in `src/i18n/fa.json`; `npm run i18n:audit` and the tests
  catch hard-coded text and missing keys.
- Respect the RTL rules: the graph canvas, timeline, curve editor, histogram, numeric fields and viewports stay left-to-right. Never
  concatenate translated fragments.
- Persian contributions are very welcome. Machine translation should be reviewed by a speaker.

## Commit messages

Use short, imperative subjects (max ~72 characters), optionally prefixed with a type:
`feat: add radial blur node`, `fix: keep tiling when resizing`, `docs: explain flipbook export`, `test: ...`, `chore: ...`.
Add a body when the reason is not obvious, and reference issues (`Fixes #12`).
