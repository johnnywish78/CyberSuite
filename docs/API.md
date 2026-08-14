# CloudPilot API — v1 contract

The desktop renderer and the Android client both talk to the local
backend over this contract. The backend binds to `127.0.0.1:8765` by
default (override with `CLOUDPILOT_BACKEND_HOST` / `CLOUDPILOT_BACKEND_PORT`).

All responses are JSON. Errors are `{ "detail": "<message>" }` with an
appropriate status code. Credentials are accepted on write endpoints and
never echoed back.

## Health

| Method | Path | Response |
| ------ | ---- | -------- |
| GET | `/api/health` | `{status, service, version, pid, uptime_seconds, started_at}` |

`version` is read from `version.json` / `CLOUDPILOT_VERSION`; `pid` lets the
Electron shell adopt and stop an already-running backend.

## Cloudflare

Base path: `/api/v1/cloudflare`

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| GET | `/config` | — | `{provider, configured, account_id_configured, api_token_configured, proxy_configured}` |
| POST | `/config` | `{account_id, api_token}` | `{provider, configured: true}` |
| POST | `/config/proxy` | `{proxy}` | `{provider, proxy_configured}` |
| GET | `/status` | — | `{provider, ...account status}` (503 if unconfigured, 502 on provider failure) |
| GET | `/workers` | — | `{provider, account_id, count, workers: [...]}` |
| GET | `/workers/{name}` | — | `{provider, worker, deployments}` |
| GET | `/workers/{name}/deployments` | — | `{provider, worker_name, count, deployments: [...]}` |

## Cloudflare BPB

Base path: `/api/v1/cloudflare/bpb`

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| POST | `/deploy` | BPB deploy options | `{provider, deployment}` |
| GET | `/deployments` | — | `{provider, count, deployments: [...]}` |
| GET | `/deployments/{worker_name}` | — | `{provider, deployment}` |
| GET | `/deployments/{worker_name}/logs` | — | deployment logs |

## Railway (Avaco relay)

Base path: `/api/v1/railway`

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| GET | `/config` | — | `{provider, configured, api_token_configured}` |
| POST | `/config` | `{api_token}` | `{provider, configured: true}` |
| POST | `/deploy` | deploy options (see `backend/api/v1/railway.py`) | `{provider, deployment}` |
| POST | `/deployments/{relay_name}/redeploy` | — | `{provider, deployment}` |
| POST | `/deployments/{relay_name}/debug` | — | debug result |

## Network tools

Base path: `/api/v1/network`

All are `POST`; bodies and responses are documented in
`backend/api/v1/network.py`. Endpoints: `/scan`, `/domain-check`,
`/dns-test`, `/vless-modify`, `/sni-check`, `/dns-hunt`, `/xray-scan`,
`/akamai-scan`, `/netlify`, `/diagnostics`.

## Conventions

- Secrets never appear in responses or logs.
- Unconfigured providers return truthful states (`configured: false`),
  never fabricated "connected" results.
- All state-bearing stores live under the platform data directory in
  packaged builds (`backend/data` in development).