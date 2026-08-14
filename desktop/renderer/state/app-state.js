"use strict";

/* ============================================================
   Wish K E Cyber Panel — Centralized application state.
   Every UI component consumes this state — there is exactly ONE
   source of truth for backend and Cloudflare connection status.
   ============================================================ */

const AppState = {
  backend: {
    status: "starting", // starting | online | offline | error
    startedAt: null, // epoch ms of backend process start (for uptime)
    wasOnline: false,
    version: null, // reported by the backend health endpoint
  },
  cloudflare: {
    status: "checking", // checking | connected | not-connected | error
  },
  workers: null, // null = unknown, [] = empty, [..] = data
  deployments: null,
  mode: "CONTRACT", // CONTRACT MODE | LIVE API | ERROR
};

/* View registry — titles + eyebrow shown in the global header. */
const VIEW_CONFIG = {
  dashboard: { title: "Dashboard", eyebrow: null },
  workers: { title: "Workers", eyebrow: "CLOUDFLARE" },
  deployments: { title: "Deployments", eyebrow: "CLOUDFLARE" },
  config: { title: "Config Builder", eyebrow: "CLOUDFLARE" },
  network: { title: "Network Checker", eyebrow: null },
  railway: { title: "Railway Relay", eyebrow: null },
  speedtest: { title: "Speedtest", eyebrow: null },
  settings: { title: "Settings", eyebrow: null },
};

/* Appearance storage key (DARK / LIGHT only). */
const THEME_KEY = "cloudpilot-theme";

/* Contract fallback data (used when Cloudflare is not connected). */
const CONTRACT_WORKERS = [
  {
    name: "edge-router",
    account_id: "contract-account",
    created_on: "2026-08-01T10:00:00Z",
    modified_on: "2026-08-10T12:00:00Z",
    compatibility_date: "2026-08-01",
    etag: "contract-etag-001",
    workers_dev_enabled: true,
    workers_dev_url: "https://edge-router.contract.workers.dev",
    metadata: {},
  },
  {
    name: "api-gateway",
    account_id: "contract-account",
    created_on: "2026-08-02T10:00:00Z",
    modified_on: "2026-08-09T16:00:00Z",
    compatibility_date: "2026-08-01",
    etag: "contract-etag-002",
    workers_dev_enabled: true,
    workers_dev_url: "https://api-gateway.contract.workers.dev",
    metadata: {},
  },
  {
    name: "health-check",
    account_id: "contract-account",
    created_on: "2026-08-03T10:00:00Z",
    modified_on: "2026-08-11T09:00:00Z",
    compatibility_date: "2026-08-01",
    etag: "contract-etag-003",
    workers_dev_enabled: false,
    workers_dev_url: null,
    metadata: {},
  },
];

const CONTRACT_DEPLOYMENTS = [
  {
    worker_name: "edge-router",
    deployment_id: "dep-001",
    version_id: "v12",
    status: "success",
    created_on: "2026-08-10T12:00:00Z",
  },
  {
    worker_name: "api-gateway",
    deployment_id: "dep-002",
    version_id: "v8",
    status: "success",
    created_on: "2026-08-09T16:00:00Z",
  },
  {
    worker_name: "health-check",
    deployment_id: "dep-003",
    version_id: "v4",
    status: "success",
    created_on: "2026-08-11T09:00:00Z",
  },
];