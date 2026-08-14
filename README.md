# CloudPilot

Local control-plane for the Wish K E Cyber Panel desktop application.

## Architecture

```
Electron shell (desktop/main.js, preload.js)
        │  contextIsolation: true · nodeIntegration: false
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
FastAPI (backend/app.py)
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

### Running
- Backend: `uvicorn backend.app:app --host 127.0.0.1 --port 8765`
- Desktop: `npm start` (spawns the backend and opens Electron).

### Tests
`pytest -q` runs the backend contract, service, config and health suites.
`node --check <file>` validates renderer scripts.
