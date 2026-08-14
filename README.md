# CloudPilot

Local control-plane for the Wish K E Cyber Panel desktop application.

CloudPilot manages Cloudflare (Workers + deployments), Cloudflare BPB
deployments and Avaco Railway relays from a single desktop app, backed
by a local FastAPI control plane. The same control-plane API is used by
the Electron desktop app, a Windows/Linux/Android client, and CI-built
installers.

## Platforms

| Platform | Installable artifact | Build host |
| -------- | -------------------- | ---------- |
| Linux    | `.deb` + `.AppImage` | local + CI |
| Windows  | NSIS `.exe` + portable `.exe` | CI |
| Android  | debug `.apk` (Gradle/Kotlin client) | CI |
| macOS    | structural support only (not a release target) | — |

## Architecture

```
Electron shell (desktop/main.js, preload.js)
        │  contextIsolation: true · nodeIntegration: false · sandbox: true
        ▼
Renderer (desktop/renderer/)
   app.js                 bootstrap, navigation, theme, system clock,
                          backend/Cloudflare state, orchestration
   state/app-state.js     single source of truth (AppState, VIEW_CONFIG,
                          contract fallback data)
   api/client.js          HTTP access to the local backend
   components/ui.js       shared DOM helpers (escaping, badges, toasts,
                          confirm dialog, activity feed, copy buttons)
   views/                 per-module renderers (workers, config,
                          settings, network, railway)
        │  fetch /api/v1/*
        ▼
FastAPI (backend/app.py) — bundled as a PyInstaller binary
   api/v1/                thin HTTP adapters: parsing, validation,
                          provider wiring, error → status translation,
                          credential persistence
   services/              orchestration + result normalization
                          (cloudflare_service, railway_service, bpb_service)
   providers/             external communication only
   settings.py            single owner of configuration
                          (env vars → settings → services/providers)
```

### Rules
- Dependencies point one way: Renderer → API → Services → Providers.
- Routers never orchestrate providers directly; services never depend on
  FastAPI request objects or the UI.
- Configuration is owned by `backend/settings.py` (read from `.env`).
- Credentials are stored server-side and never exposed to the renderer.
- All user-controlled values pass through `escapeHTML` before rendering.

## Running from source

- Backend: `uvicorn backend.app:app --host 127.0.0.1 --port 8765`
- Desktop: `npm start` (spawns the backend and opens Electron).
- Android emulator: point the client at `http://10.0.2.2:8765` (default).

The Electron shell always reaches for the same backend: in development it
spawns the project `.venv` Python; in packaged builds it runs the bundled
PyInstaller binary from `resources/backend/`. It reuses an already-healthy
backend, restarts a crashed one (up to 2 times) and shuts it down cleanly
on quit — no orphan processes.

## Building installers

Prerequisites: Node 20+, Python 3.14, a `.venv` with `requirements.txt`,
PyInstaller 6.x.

```bash
source .venv/bin/activate
npm install

# Linux: version sync → icons → PyInstaller backend → electron-builder
npm run build:linux

# Windows (cross-platform config; run on Windows or via CI)
npm run build:win

# Android (via CI: gradle/actions/setup-gradle + assembleDebug)
cd android && gradle assembleDebug
```

Artifacts land in `release/`; `npm run build` = `build:linux`.
`node scripts/sha256sums.js` writes `release/SHA256SUMS`.

## Versioning

`package.json#version` is the single source of truth. `scripts/sync-version.js`
generates `VERSION` + `version.json`, which the backend reads to report the
version on `/api/health` and in the desktop "About" panel.

## Tests

- `pytest -q` — backend contract, service, config, health, version,
  data-directory and no-secrets-in-logs suites.
- `node --check <file>` — renderer/shell syntax.
- Android static checks (XML well-formedness, resource-id coverage) run
  in CI before the Gradle build.

## License

MIT — see [LICENSE](LICENSE).