"use strict";

/* ============================================================
   Wish K E Cyber Panel — Renderer
   Architecture: centralized app state, reusable components,
   per-module renderers. All existing functionality is preserved.
   ============================================================ */

const API = window.cloudpilot?.backendUrl || "http://127.0.0.1:8765";

/* ------------------------------------------------------------
   Contract fallback data (used when Cloudflare is not connected)
   ------------------------------------------------------------ */
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

/* ------------------------------------------------------------
   Centralized application state.
   Every UI component consumes this state — there is exactly ONE
   source of truth for backend and Cloudflare connection status.
   ------------------------------------------------------------ */
const AppState = {
  backend: {
    status: "starting", // starting | online | offline | error
    startedAt: null, // epoch ms of backend process start (for uptime)
    wasOnline: false,
  },
  cloudflare: {
    status: "checking", // checking | connected | not-connected | error
  },
  workers: null, // null = unknown, [] = empty, [..] = data
  deployments: null,
  mode: "CONTRACT", // CONTRACT MODE | LIVE API | ERROR
};

/* ------------------------------------------------------------
   View registry — titles + eyebrow shown in the global header.
   ------------------------------------------------------------ */
const VIEW_CONFIG = {
  dashboard: { title: "Dashboard", eyebrow: "CONTROL" },
  workers: { title: "Workers", eyebrow: "CLOUDFLARE" },
  deployments: { title: "Deployments", eyebrow: "CLOUDFLARE" },
  config: { title: "Config Builder", eyebrow: "CLOUDFLARE" },
  network: { title: "Network Checker", eyebrow: "NETWORK" },
  railway: { title: "Railway Relay", eyebrow: "NETWORK" },
  settings: { title: "Settings", eyebrow: "SYSTEM" },
};

/* ------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------ */
const $ = (selector) => document.querySelector(selector);

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatUptime(totalSeconds) {
  if (totalSeconds == null || totalSeconds < 0) return "--:--:--";
  const s = Math.floor(totalSeconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m ${pad(sec)}s`;
  return `${pad(h)}h ${pad(m)}m ${pad(sec)}s`;
}

async function getJSON(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postJSON(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function extractErrorDetail(message) {
  if (!message) return "unknown error";
  const text = String(message);
  const detail = text.match(/"detail":\s*"([^"]+)"/);
  return detail ? detail[1] : text;
}

/* ------------------------------------------------------------
   Reusable: status badge
   ------------------------------------------------------------ */
const BADGE_CLASS_MAP = {
  success: "success",
  active: "success",
  ready: "success",
  connected: "success",
  online: "success",
  deployed: "success",
  warning: "warning",
  disabled: "neutral",
  inactive: "neutral",
  unknown: "neutral",
  failed: "error",
  failure: "error",
  error: "error",
  blocked: "error",
  offline: "error",
  info: "info",
};

function statusBadge(status, label) {
  const key = String(status || "").toLowerCase();
  const cls = BADGE_CLASS_MAP[key] || "neutral";
  return `<span class="status-badge ${cls}">${escapeHTML(label || status || "UNKNOWN")}</span>`;
}

/* ------------------------------------------------------------
   Reusable: loading / empty / error state blocks
   ------------------------------------------------------------ */
function stateBlock(type, text) {
  const icon =
    type === "loading" ? '<div class="spinner"></div>' : "";
  const cls =
    type === "error" ? " state-error" : type === "empty" ? " state-empty" : "";
  return `<div class="state${cls}">${icon}<div class="state-title">${escapeHTML(text)}</div></div>`;
}

/* ------------------------------------------------------------
   Reusable: toast notifications
   ------------------------------------------------------------ */
function showToast(message, type = "info", ms = 3000) {
  const container = $("#toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-dot"></span><span>${escapeHTML(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity .3s";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 320);
  }, ms);
}

/* ------------------------------------------------------------
   Reusable: confirm dialog (promise-based)
   ------------------------------------------------------------ */
function confirmDialog({ title, text, confirmLabel = "Delete", danger = true }) {
  return new Promise((resolve) => {
    const root = $("#confirm-root");
    if (!root) return resolve(true);
    root.innerHTML = `
      <div class="confirm-overlay">
        <div class="confirm-dialog" role="dialog" aria-modal="true">
          <div class="confirm-title">${escapeHTML(title)}</div>
          <div class="confirm-text">${escapeHTML(text)}</div>
          <div class="confirm-actions">
            <button class="button secondary" data-confirm-cancel>Cancel</button>
            <button class="button ${danger ? "danger" : "primary"}" data-confirm-ok>${escapeHTML(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    const close = (result) => {
      root.innerHTML = "";
      resolve(result);
    };
    root.querySelector("[data-confirm-cancel]").addEventListener("click", () => close(false));
    root.querySelector("[data-confirm-ok]").addEventListener("click", () => close(true));
  });
}

/* ------------------------------------------------------------
   Reusable: recent activity feed
   Consumes REAL events only. UI architecture ready for a future
   activity backend without redesigning the page.
   ------------------------------------------------------------ */
function addActivity(event, status = "info") {
  const list = $("#activity-list");
  if (!list) return;
  const empty = list.querySelector(".activity-empty");
  if (empty) empty.remove();
  const item = document.createElement("div");
  item.className = "activity-item";
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  item.innerHTML = `
    <span class="activity-time">${time}</span>
    <span class="activity-event">${escapeHTML(event)}</span>
    ${statusBadge(status)}
  `;
  list.prepend(item);
  while (list.children.length > 20) list.lastChild.remove();
}

/* ------------------------------------------------------------
   Appearance (DARK / LIGHT only)
   ------------------------------------------------------------ */
const THEME_KEY = "cloudpilot-theme";

function applyTheme(theme) {
  const value = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = value;
  const label = $("#theme-toggle-label");
  if (label) label.textContent = value === "dark" ? "Dark" : "Light";
  document.querySelectorAll("[data-appearance]").forEach((el) => {
    el.classList.toggle("selected", el.dataset.appearance === value);
  });
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch {
    /* storage unavailable — theme still applies for the session */
  }
}

function initTheme() {
  let saved = "dark";
  try {
    saved = localStorage.getItem(THEME_KEY) || "dark";
  } catch {
    /* ignore */
  }
  applyTheme(saved);
}

/* ------------------------------------------------------------
   System clock + uptime (single interval)
   ------------------------------------------------------------ */
function updateSystemClock() {
  const now = new Date();
  $("#sys-date").textContent = now.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  $("#sys-time").textContent = now.toLocaleTimeString("en-GB", {
    hour12: false,
  });
  const uptime = $("#sys-uptime");
  if (AppState.backend.startedAt) {
    uptime.textContent = formatUptime(
      Math.floor((Date.now() - AppState.backend.startedAt) / 1000)
    );
  } else {
    uptime.textContent = "--:--:--";
  }
}

/* ------------------------------------------------------------
   Navigation
   ------------------------------------------------------------ */
function showView(name) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${name}`);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === name);
  });
  const cfg = VIEW_CONFIG[name] || VIEW_CONFIG.dashboard;
  $("#page-title").textContent = cfg.title;
  $("#page-eyebrow").textContent = cfg.eyebrow;
}

/* ------------------------------------------------------------
   Backend status — ONE source of truth for backend state.
   ------------------------------------------------------------ */
async function checkBackend() {
  const statusEl = $("#backend-status");
  const dot = $("#backend-dot");
  const stat = $("#stat-backend");

  try {
    const health = await getJSON("/api/health");
    AppState.backend.status = "online";
    let started = Date.parse(health.started_at);
    if (Number.isNaN(started)) {
      started = Date.now() - (health.uptime_seconds || 0) * 1000;
    }
    AppState.backend.startedAt = started;

    statusEl.textContent = "Online";
    statusEl.className = "online";
    dot.className = "status-dot online";
    stat.textContent = "Online";
    stat.classList.remove("muted");

    if (!AppState.backend.wasOnline) {
      AppState.backend.wasOnline = true;
      addActivity("Backend online · 127.0.0.1:8765", "success");
    }
    return health;
  } catch (error) {
    console.error("Backend unavailable:", error);
    AppState.backend.status = "offline";
    AppState.backend.startedAt = null;

    statusEl.textContent = "Offline";
    statusEl.className = "offline";
    dot.className = "status-dot offline";
    stat.textContent = "Offline";
    stat.classList.add("muted");
    return null;
  }
}

/* ------------------------------------------------------------
   Cloudflare status — ONE source of truth.
   All components (global banner, metric card) consume it.
   ------------------------------------------------------------ */
function setCloudflareState(status, message) {
  AppState.cloudflare.status = status;

  const card = $("#cf-global-status");
  const badge = $("#cf-status-badge");
  const title = $("#cf-status-title");
  const text = $("#cf-status-text");
  const icon = card.querySelector(".status-icon");
  const stat = $("#stat-connection");
  const action = $("#cf-global-action");

  card.classList.remove("connected", "connecting", "error");
  badge.className = "status-badge";

  switch (status) {
    case "connected":
      card.classList.add("connected");
      badge.classList.add("success");
      badge.textContent = "CONNECTED";
      title.textContent = "Cloudflare";
      text.textContent = "Live account data available.";
      icon.textContent = "✓";
      stat.textContent = "Connected";
      stat.classList.remove("muted");
      action.style.display = "none";
      break;

    case "not-connected":
      card.classList.add("connecting");
      badge.classList.add("warning");
      badge.textContent = "NOT CONNECTED";
      title.textContent = "Cloudflare is not connected";
      text.textContent =
        "Configure credentials to activate live account data.";
      icon.textContent = "!";
      stat.textContent = "Not Connected";
      stat.classList.add("muted");
      action.style.display = "";
      break;

    case "error":
      card.classList.add("error");
      badge.classList.add("error");
      badge.textContent = "ERROR";
      title.textContent = "Cloudflare connection failed";
      text.textContent = message || "Unable to reach the Cloudflare API.";
      icon.textContent = "!";
      stat.textContent = "Error";
      stat.classList.add("muted");
      action.style.display = "";
      break;

    default:
      card.classList.add("connecting");
      badge.classList.add("warning");
      badge.textContent = "CONNECTING";
      title.textContent = "Checking Cloudflare connection...";
      text.textContent = "Verifying credentials against the Cloudflare API.";
      icon.textContent = "…";
      stat.textContent = "Checking…";
      stat.classList.add("muted");
      action.style.display = "";
  }
}

function setDataMode(mode) {
  AppState.mode = mode;
  $("#data-mode").textContent = mode;
}

/* ------------------------------------------------------------
   Workers renderers
   ------------------------------------------------------------ */
function renderDashboardWorkers(workers) {
  const container = $("#dashboard-workers");
  if (workers === null) {
    container.innerHTML = stateBlock("loading", "Loading workers...");
    return;
  }
  if (!workers.length) {
    container.innerHTML = stateBlock("empty", "No workers found.");
    return;
  }
  container.innerHTML = workers.map((worker) => `
    <div class="worker-card">
      <div class="worker-name" title="${escapeHTML(worker.name)}">
        ${escapeHTML(worker.name)}
      </div>
      <div class="worker-meta">
        <span class="updated">Updated ${formatDate(worker.modified_on)}</span>
        ${statusBadge(worker.workers_dev_enabled ? "ACTIVE" : "DISABLED")}
      </div>
    </div>
  `).join("");
}

function renderWorkersTable(workers) {
  const container = $("#workers-list");
  if (workers === null) {
    container.innerHTML = stateBlock("loading", "Loading workers...");
    return;
  }
  if (!workers.length) {
    container.innerHTML = stateBlock("empty", "No workers found.");
    return;
  }
  container.innerHTML = `
    <div class="table-row table-head">
      <div>Name</div>
      <div>Compatibility</div>
      <div>Workers.dev</div>
      <div>Status</div>
    </div>
    ${workers.map((worker) => `
      <div class="table-row">
        <div title="${escapeHTML(worker.name)}">${escapeHTML(worker.name)}</div>
        <div>${worker.compatibility_date || "—"}</div>
        <div>${worker.workers_dev_enabled ? "Enabled" : "Disabled"}</div>
        <div>${statusBadge(worker.workers_dev_enabled ? "ACTIVE" : "DISABLED")}</div>
      </div>
    `).join("")}
  `;
}

/* ------------------------------------------------------------
   Deployments renderers
   ------------------------------------------------------------ */
function renderDeploymentsTable(deployments) {
  const container = $("#deployments-list");
  if (deployments === null) {
    container.innerHTML = stateBlock("loading", "Loading deployments...");
    return;
  }
  if (!deployments.length) {
    container.innerHTML = stateBlock("empty", "No deployments found.");
    return;
  }
  container.innerHTML = `
    <div class="table-row table-head">
      <div>Worker</div>
      <div>Version</div>
      <div>Status</div>
      <div>Created</div>
    </div>
    ${deployments.map((deployment) => `
      <div class="table-row">
        <div title="${escapeHTML(deployment.worker_name)}">${escapeHTML(deployment.worker_name)}</div>
        <div>${escapeHTML(deployment.version_id || "—")}</div>
        <div>${statusBadge(deployment.status || "UNKNOWN")}</div>
        <div>${formatDate(deployment.created_on)}</div>
      </div>
    `).join("")}
  `;
}

/* ------------------------------------------------------------
   Contract fallback mode
   ------------------------------------------------------------ */
function renderContractMode() {
  setDataMode("CONTRACT MODE");
  AppState.workers = CONTRACT_WORKERS;
  AppState.deployments = CONTRACT_DEPLOYMENTS;

  $("#stat-workers").textContent = AppState.workers.length;
  $("#stat-deployments").textContent = AppState.deployments.length;

  renderDashboardWorkers(AppState.workers);
  renderWorkersTable(AppState.workers);
  renderDeploymentsTable(AppState.deployments);
}

/* ------------------------------------------------------------
   Cloudflare module loader
   ------------------------------------------------------------ */
async function loadCloudflare() {
  setCloudflareState("checking");

  try {
    const config = await getJSON("/api/v1/cloudflare/config");

    $("#config-account").textContent = config.account_id_configured
      ? "Configured"
      : "Not configured";
    $("#config-token").textContent = config.api_token_configured
      ? "Configured"
      : "Not configured";
    $("#config-proxy").textContent = config.proxy_configured
      ? "Configured"
      : "Not configured";

    if (!config.configured) {
      setCloudflareState("not-connected");
      renderContractMode();
      return;
    }

    const [status, workers] = await Promise.all([
      getJSON("/api/v1/cloudflare/status"),
      getJSON("/api/v1/cloudflare/workers"),
    ]);

    setCloudflareState(
      status.authenticated ? "connected" : "not-connected"
    );

    AppState.workers = workers.workers || [];
    setDataMode("LIVE API");

    renderDashboardWorkers(AppState.workers);
    renderWorkersTable(AppState.workers);
    $("#stat-workers").textContent = AppState.workers.length;

    let deployments = [];
    for (const worker of AppState.workers) {
      try {
        const data = await getJSON(
          `/api/v1/cloudflare/workers/${encodeURIComponent(worker.name)}/deployments`
        );
        deployments.push(
          ...(data.deployments || []).map((item) => ({
            ...item,
            worker_name: worker.name,
          }))
        );
      } catch {
        // Keep the UI usable if one worker deployment endpoint fails.
      }
    }

    AppState.deployments = deployments;
    $("#stat-deployments").textContent = AppState.deployments.length;
    renderDeploymentsTable(AppState.deployments);

    addActivity(
      `Loaded ${AppState.workers.length} workers from Cloudflare`,
      "success"
    );
  } catch (error) {
    console.warn("Cloudflare API unavailable:", error);
    setCloudflareState("error", extractErrorDetail(error.message));
    setDataMode("ERROR");
    AppState.workers = null;
    AppState.deployments = null;
    renderDashboardWorkers(null);
    renderWorkersTable(null);
    renderDeploymentsTable(null);
    addActivity("Cloudflare API unavailable", "error");
  }
}

/* ------------------------------------------------------------
   Config Builder module
   ------------------------------------------------------------ */
function renderConfigDeployments(records) {
  const container = $("#config-deployments-list");

  if (!records.length) {
    container.innerHTML = `
      <div class="info-box">
        <strong>No panels installed yet.</strong>
        <p>
          Use step 1 to install your personal panel on your Cloudflare account.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = records.map((record) => `
    <div class="bpb-deployment">
      <div>
        <div class="bpb-deployment-name">
          ${escapeHTML(record.worker_name)}
        </div>
        <div class="section-subtitle">
          ${escapeHTML(record.host)}
        </div>
      </div>
      <div class="bpb-deployment-actions">
        <a class="button secondary"
           href="${escapeHTML(record.panel_url)}"
           target="_blank">Open panel</a>
        <a class="button secondary"
           href="${escapeHTML(record.panel_url)}#view-config"
           data-open-config="${escapeHTML(record.worker_name)}">View config</a>
        <button class="button secondary"
                data-logs="${escapeHTML(record.worker_name)}">Get logs</button>
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-open-config]").forEach((el) => {
    el.addEventListener("click", async (event) => {
      event.preventDefault();
      const record = records.find(
        (item) => item.worker_name === el.dataset.openConfig
      );
      if (record) renderConfigResults(record);
    });
  });

  container.querySelectorAll("[data-logs]").forEach((el) => {
    el.addEventListener("click", () => {
      fetchLogs(el.dataset.logs);
    });
  });
}

async function fetchLogs(workerName) {
  const box = $("#config-logs");
  const content = $("#config-logs-content");

  box.hidden = false;
  content.innerHTML = `
    <div class="info-box">
      Capturing a Workers Tail window (about 8s). Open the panel in a
      browser while this runs to generate traffic.
    </div>
  `;

  try {
    const payload = await getJSON(
      `/api/v1/cloudflare/bpb/deployments/${encodeURIComponent(workerName)}/logs`
    );

    const exceptions = payload.exceptions || [];
    const logs = payload.logs || [];

    if (!exceptions.length && !logs.length) {
      content.innerHTML = `
        <div class="info-box">
          No activity captured. Open the panel in a browser and try again —
          runtime errors will appear here.
        </div>
      `;
      return;
    }

    content.innerHTML = [
      ...exceptions.map((item) => `
        <div class="log-line log-error">
          <span class="log-level">EXCEPTION</span>
          <code>${escapeHTML(item.name)}: ${escapeHTML(item.message)}</code>
        </div>
        ${item.stack ? `
          <pre class="log-stack">${escapeHTML(item.stack)}</pre>
        ` : ""}
      `).join(""),
      ...logs.map((item) => `
        <div class="log-line">
          <span class="log-level">${escapeHTML(item.level.toUpperCase())}</span>
          <code>${escapeHTML(item.message)}</code>
        </div>
      `).join(""),
    ].join("");
  } catch (error) {
    content.innerHTML = `
      <div class="info-box error-box">${escapeHTML(error.message)}</div>
    `;
  }
}

function renderConfigResults(record) {
  $("#config-results").hidden = false;
  $("#config-error").hidden = true;

  $("#config-step-1").classList.remove("active");
  $("#config-step-2").classList.add("active");

  $("#config-host").textContent = record.host;

  const panelLink = $("#config-panel-link");
  panelLink.textContent = record.panel_url;
  panelLink.href = record.panel_url;

  const loginLink = $("#config-login-link");
  loginLink.textContent = record.login_url;
  loginLink.href = record.login_url;

  const subscriptions = record.subscriptions || {};

  $("#config-subscriptions").innerHTML =
    Object.entries(subscriptions).map(([type, apps]) => `
      <div class="sub-group">
        <div class="link-label">${escapeHTML(type)}</div>
        ${Object.entries(apps).map(([app, url]) => `
          <div class="copy-row">
            <span class="copy-app">${escapeHTML(app)}</span>
            <code class="copy-value">${escapeHTML(url)}</code>
            <button class="button secondary copy-btn"
                    data-copy="${escapeHTML(url)}">Copy</button>
          </div>
        `).join("")}
      </div>
    `).join("");

  const credentials = record.credentials || {};

  const credentialFields = [
    ["VLESS UUID", credentials.vl_uuid],
    ["Trojan password", credentials.trojan_password],
    ["Secure path", credentials.secure_path],
    ["Proxy mode", credentials.proxy_ip_mode],
    ["Proxy IPs", (credentials.proxy_ips || []).join(", ") || "default"],
  ];

  $("#config-credentials").innerHTML = credentialFields.map(
    ([label, value]) => `
      <div>
        <span class="config-label">${escapeHTML(label)}</span>
        <strong class="wrap-value">${escapeHTML(value ?? "")}</strong>
      </div>
    `
  ).join("");

  bindCopyButtonsIn($("#config-results"));
}

function bindCopyButtonsIn(scope) {
  scope.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        const label = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = label;
        }, 1500);
      } catch (error) {
        console.warn("Clipboard unavailable:", error);
      }
    });
  });
}

async function loadConfig() {
  $("#config-need-creds").hidden = true;

  try {
    const payload = await getJSON("/api/v1/cloudflare/bpb/deployments");
    renderConfigDeployments(payload.deployments || []);
  } catch (error) {
    console.warn("Config deployments unavailable:", error);
    $("#config-deployments-list").innerHTML = `
      <div class="info-box">
        <strong>Config API unavailable.</strong>
        <p>${escapeHTML(error.message || "Check backend / credentials.")}</p>
      </div>
    `;
  }
}

async function deployConfig() {
  const button = $("#config-deploy-btn");
  const status = $("#config-deploy-status");
  const errorBox = $("#config-error");

  errorBox.hidden = true;
  button.disabled = true;
  status.textContent = "Fetching worker and deploying...";

  try {
    const proxyIPs = ($("#config-proxy-ips").value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const apiToken = $("#config-api-token").value.trim();

    const payload = await postJSON("/api/v1/cloudflare/bpb/deploy", {
      worker_name: $("#config-worker-name").value.trim() || "cyber-panel",
      api_token: apiToken,
      proxy_ip_mode: $("#config-proxy-mode").value,
      proxy_ips: proxyIPs,
      doh_url: $("#config-doh").value.trim(),
    });

    status.textContent = "Installed successfully.";
    addActivity(`Panel "${payload.deployment.worker_name}" deployed`, "success");
    showToast("Panel installed successfully", "success");

    renderConfigResults(payload.deployment);
    await loadConfig();
  } catch (error) {
    console.error("Config deploy failed:", error);
    const detail = (error.message || "").split("detail").pop();
    errorBox.textContent = "Install failed. " + detail.replace(/[{}":]/g, " ");
    errorBox.hidden = false;
    status.textContent = "Install failed.";
    addActivity("Panel deployment failed", "error");
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------------------------------------
   Settings — Cloudflare credentials
   ------------------------------------------------------------ */
async function saveProxy() {
  const button = $("#cred-proxy-btn");
  const status = $("#cred-proxy-status");

  button.disabled = true;
  status.textContent = "Saving...";

  try {
    await postJSON("/api/v1/cloudflare/config/proxy", {
      proxy: $("#cred-proxy").value.trim(),
    });

    $("#cred-proxy").value = "";
    status.textContent = "Proxy saved.";
    addActivity("Cloudflare proxy updated", "info");

    await loadCloudflare();
  } catch (error) {
    console.error("Proxy save failed:", error);
    status.textContent = "Save failed: " + extractErrorDetail(error.message);
  } finally {
    button.disabled = false;
  }
}

async function saveCredentials() {
  const button = $("#cred-save-btn");
  const status = $("#cred-save-status");

  button.disabled = true;
  status.textContent = "Saving...";

  try {
    await postJSON("/api/v1/cloudflare/config", {
      account_id: $("#cred-account").value.trim(),
      api_token: $("#cred-token").value.trim(),
    });

    $("#cred-account").value = "";
    $("#cred-token").value = "";

    status.textContent = "Saved. Credentials are now active.";
    addActivity("Cloudflare credentials configured", "success");
    showToast("Cloudflare credentials saved", "success");

    await loadCloudflare();
  } catch (error) {
    console.error("Credential save failed:", error);
    status.textContent = "Save failed: " + extractErrorDetail(error.message);
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------------------------------------
   Network Checker module
   ------------------------------------------------------------ */
function renderNetworkResults(payload) {
  const container = $("#net-results");
  container.hidden = false;

  const results = payload.results || [];

  if (!results.length) {
    container.innerHTML = `
      <div class="network-results-card settings-card">
        <div class="section-title">Scan complete</div>
        <div class="section-subtitle">
          ${payload.scanned} IPs probed — none were reachable. Try a larger
          sample size or custom ranges.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="network-results-card settings-card">
      <div class="section-title">Clean IPs</div>
      <div class="network-summary">
        <span>Scanned: <b>${payload.scanned}</b></span>
        <span>Reachable: <b>${results.length}</b></span>
        <span>SNI: <b>${escapeHTML(payload.sni)}</b></span>
        <span>Port: <b>${payload.port}</b></span>
      </div>
      <div id="network-ip-list">
        ${results.map((item) => `
          <div class="network-ip-row">
            <span class="network-ip">${escapeHTML(item.ip)}</span>
            <span class="network-latency">${item.latency_ms} ms</span>
            <button class="button secondary copy-ip"
                    data-copy="${escapeHTML(item.ip)}">Copy</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  bindCopyButtonsIn(container);
}

async function runNetworkScan() {
  const button = $("#net-scan-btn");
  const status = $("#net-scan-status");
  const errorBox = $("#net-error");
  const results = $("#net-results");

  errorBox.hidden = true;
  results.hidden = true;
  button.disabled = true;
  status.textContent = "Scanning — this may take a while...";

  const ranges = ($("#net-ranges").value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  const sni = $("#net-sni").value.trim();

  try {
    const payload = await postJSON("/api/v1/network/scan", {
      ranges,
      snis: sni ? [sni] : [],
      sample_size: Number($("#net-sample").value),
      concurrency: Number($("#net-concurrency").value),
    });

    status.textContent = `Done. ${payload.reachable} clean IPs found.`;
    renderNetworkResults(payload);
    addActivity(`Clean-IP scan found ${payload.reachable} IPs`, "success");
  } catch (error) {
    console.error("Network scan failed:", error);
    errorBox.textContent = "Scan failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;
    status.textContent = "Scan failed.";
    addActivity("Clean-IP scan failed", "error");
  } finally {
    button.disabled = false;
  }
}

function renderDomainResults(payload) {
  const container = $("#net-domains-results");
  container.hidden = false;

  const results = payload.results || [];

  container.innerHTML = `
    <div class="network-results-card settings-card">
      <div class="section-title">Domain accessibility</div>
      <div class="network-summary">
        <span>Checked: <b>${payload.checked}</b></span>
        <span>Reachable: <b>${payload.reachable}</b></span>
        <span>Blocked: <b>${payload.blocked}</b></span>
      </div>
      ${results.map((item) => `
        <div class="domain-row">
          <span class="name">${escapeHTML(item.domain)}</span>
          <span class="latency">
            ${item.reachable ? `${item.latency_ms} ms` : "—"}
          </span>
          ${statusBadge(item.reachable ? "REACHABLE" : "BLOCKED")}
        </div>
      `).join("")}
    </div>
  `;
}

async function runDomainCheck() {
  const button = $("#net-domains-btn");
  const status = $("#net-domains-status");
  const errorBox = $("#net-domains-error");
  const results = $("#net-domains-results");

  errorBox.hidden = true;
  results.hidden = true;
  button.disabled = true;
  status.textContent = "Checking...";

  const domains = ($("#net-domains").value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    const payload = await postJSON("/api/v1/network/domain-check", { domains });

    status.textContent =
      `Done. ${payload.reachable} reachable, ${payload.blocked} blocked.`;
    renderDomainResults(payload);
    addActivity("Domain check completed", "info");
  } catch (error) {
    console.error("Domain check failed:", error);
    errorBox.textContent =
      "Domain check failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;
    status.textContent = "Failed.";
  } finally {
    button.disabled = false;
  }
}

function renderDnsResults(payload) {
  const container = $("#net-dns-results");
  container.hidden = false;

  const results = payload.results || [];

  container.innerHTML = `
    <div class="network-results-card settings-card">
      <div class="section-title">DNS latency</div>
      <div class="network-summary">
        <span>Tested: <b>${payload.tested}</b></span>
        <span>Sort: <b>fastest first</b></span>
      </div>
      ${results.map((item) => `
        <div class="dns-row">
          <span class="name">${escapeHTML(item.name)}</span>
          <code class="network-ip">${escapeHTML(item.ip)}</code>
          <span class="latency">
            ${item.reachable ? `${item.latency_ms} ms` : "—"}
          </span>
          ${statusBadge(item.reachable ? "OK" : "NO ANSWER")}
        </div>
      `).join("")}
    </div>
  `;
}

async function runDnsTest() {
  const button = $("#net-dns-btn");
  const status = $("#net-dns-status");
  const errorBox = $("#net-dns-error");
  const results = $("#net-dns-results");

  errorBox.hidden = true;
  results.hidden = true;
  button.disabled = true;
  status.textContent = "Testing DNS providers...";

  try {
    const payload = await postJSON("/api/v1/network/dns-test", {});
    status.textContent = "Done.";
    renderDnsResults(payload);
  } catch (error) {
    console.error("DNS test failed:", error);
    errorBox.textContent = "DNS test failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;
    status.textContent = "Failed.";
  } finally {
    button.disabled = false;
  }
}

function renderVlessResults(payload) {
  const container = $("#net-vless-results");
  container.hidden = false;

  const outputs = payload.outputs || [];

  container.innerHTML = `
    <div class="network-results-card settings-card">
      <div class="section-title">Generated configs</div>
      <div class="network-summary">
        <span>Clean IPs: <b>${payload.clean_ips.length}</b></span>
        <span>Total configs: <b>${payload.count}</b></span>
      </div>
      ${outputs.map((item) => `
        <div class="vless-result">
          <div class="vless-result-head">
            <span class="name">${escapeHTML(item.input)}</span>
            ${statusBadge(item.valid ? item.count + " configs" : "INVALID")}
          </div>
          ${item.valid ? `
            <div class="vless-lines">
              ${item.outputs.map((line) => `
                <div class="vless-line">
                  <code>${escapeHTML(line)}</code>
                  <button class="button secondary" data-copy="${escapeHTML(line)}">Copy</button>
                </div>
              `).join("")}
            </div>
          ` : `<div class="info-box error-box">${escapeHTML(item.error)}</div>`}
        </div>
      `).join("")}
    </div>
  `;

  bindCopyButtonsIn(container);
}

async function runVlessModify() {
  const button = $("#net-vless-btn");
  const status = $("#net-vless-status");
  const errorBox = $("#net-vless-error");
  const results = $("#net-vless-results");

  errorBox.hidden = true;
  results.hidden = true;
  button.disabled = true;
  status.textContent = "Generating...";

  const configs = ($("#net-vless-configs").value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  const ips = ($("#net-vless-ips").value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    const payload = await postJSON("/api/v1/network/vless-modify", {
      configs,
      ips,
    });

    status.textContent = `Done. ${payload.count} configs generated.`;
    renderVlessResults(payload);
  } catch (error) {
    console.error("Vless modify failed:", error);
    errorBox.textContent = "Generation failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;
    status.textContent = "Failed.";
  } finally {
    button.disabled = false;
  }
}

function renderSniResults(payload) {
  const container = $("#net-sni-results");
  container.hidden = false;

  container.innerHTML = `
    <div class="network-results-card settings-card">
      <div class="section-title">SNI spoof check</div>
      <div class="network-summary">
        <span>Host: <b>${escapeHTML(payload.host)}</b></span>
        <span>Decoy: <b>${escapeHTML(payload.decoy)}</b></span>
      </div>
      <div class="domain-row">
        <span class="name">Real SNI (${escapeHTML(payload.host)})</span>
        <span class="latency">
          ${payload.real_sni != null ? payload.real_sni + " ms" : "—"}
        </span>
        ${statusBadge(payload.real_sni != null ? "OK" : "BLOCKED")}
      </div>
      <div class="domain-row">
        <span class="name">Spoofed SNI (${escapeHTML(payload.decoy)})</span>
        <span class="latency">
          ${payload.spoofed_sni != null ? payload.spoofed_sni + " ms" : "—"}
        </span>
        ${statusBadge(payload.spoof_supported ? "SPOOF WORKS" : "NOT SPOOFABLE")}
      </div>
    </div>
  `;
}

async function runSniCheck() {
  const button = $("#net-sni-btn");
  const status = $("#net-sni-status");
  const errorBox = $("#net-sni-error");
  const results = $("#net-sni-results");

  errorBox.hidden = true;
  results.hidden = true;
  button.disabled = true;
  status.textContent = "Checking...";

  try {
    const payload = await postJSON("/api/v1/network/sni-check", {
      host: $("#net-sni-host").value.trim(),
      decoy: $("#net-sni-decoy").value.trim(),
    });

    status.textContent = payload.spoof_supported
      ? "SNI spoofing is supported on your connection."
      : "SNI spoofing is not possible.";

    renderSniResults(payload);
  } catch (error) {
    console.error("SNI check failed:", error);
    errorBox.textContent = "SNI check failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;
    status.textContent = "Failed.";
  } finally {
    button.disabled = false;
  }
}

function renderDnsHuntResults(payload) {
  const container = $("#net-dns-hunt-results");
  container.hidden = false;

  const results = payload.results || [];

  container.innerHTML = `
    <div class="network-results-card settings-card">
      <div class="section-title">DNS Hunter</div>
      <div class="network-summary">
        <span>Domain: <b>${escapeHTML(payload.domain)}</b></span>
        <span>Providers: <b>${payload.checked}</b></span>
      </div>
      ${results.map((item) => `
        <div class="dns-hunt-row">
          <span class="name">${escapeHTML(item.name)}</span>
          <code class="network-ip">${escapeHTML(item.ip)}</code>
          <span class="resolved">
            ${item.reachable ? escapeHTML(item.resolved.join(", ")) : "—"}
          </span>
          ${statusBadge(item.reachable ? `${item.latency_ms} ms` : "NO ANSWER")}
        </div>
      `).join("")}
    </div>
  `;
}

async function runDnsHunt() {
  const button = $("#net-dns-hunt-btn");
  const status = $("#net-dns-hunt-status");
  const errorBox = $("#net-dns-hunt-error");
  const results = $("#net-dns-hunt-results");

  errorBox.hidden = true;
  results.hidden = true;
  button.disabled = true;
  status.textContent = "Hunting...";

  try {
    const payload = await postJSON("/api/v1/network/dns-hunt", {
      domains: $("#net-dns-hunt-domain").value.trim()
        ? [$("#net-dns-hunt-domain").value.trim()]
        : [],
    });

    status.textContent = "Done.";
    renderDnsHuntResults(payload);
  } catch (error) {
    console.error("DNS hunt failed:", error);
    errorBox.textContent = "DNS hunt failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;
    status.textContent = "Failed.";
  } finally {
    button.disabled = false;
  }
}

function renderXrayResults(payload) {
  const container = $("#net-xray-results");
  container.hidden = false;

  const results = payload.results || [];

  container.innerHTML = `
    <div class="network-results-card settings-card">
      <div class="section-title">CDN Xray Scanner</div>
      <div class="network-summary">
        <span>Address: <b>${escapeHTML(payload.address)}</b></span>
        <span>Port: <b>${payload.port}</b></span>
        <span>SNI: <b>${escapeHTML(payload.sni)}</b></span>
        <span>Scanned: <b>${payload.scanned}</b></span>
        <span>Reachable: <b>${results.length}</b></span>
      </div>
      ${results.map((item) => `
        <div class="network-ip-row">
          <span class="network-ip">${escapeHTML(item.ip)}</span>
          <span class="network-latency">${item.latency_ms} ms</span>
          <button class="button secondary copy-ip"
                  data-copy="${escapeHTML(item.ip)}">Copy</button>
        </div>
      `).join("")}
    </div>
  `;

  bindCopyButtonsIn(container);
}

async function runXrayScan() {
  const button = $("#net-xray-btn");
  const status = $("#net-xray-status");
  const errorBox = $("#net-xray-error");
  const results = $("#net-xray-results");

  errorBox.hidden = true;
  results.hidden = true;
  button.disabled = true;
  status.textContent = "Scanning CDN — this may take a while...";

  try {
    const payload = await postJSON("/api/v1/network/xray-scan", {
      config: $("#net-xray-config").value,
      sample_size: Number($("#net-xray-sample").value),
    });

    status.textContent = `Done. ${payload.reachable} reachable IPs.`;
    renderXrayResults(payload);
  } catch (error) {
    console.error("Xray scan failed:", error);
    errorBox.textContent = "Xray scan failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;
    status.textContent = "Failed.";
  } finally {
    button.disabled = false;
  }
}

function renderAkamaiResults(payload) {
  const container = $("#net-akamai-results");
  container.hidden = false;

  const results = payload.results || [];

  container.innerHTML = `
    <div class="network-results-card settings-card">
      <div class="section-title">Akamai IP Scan</div>
      <div class="network-summary">
        <span>Scanned: <b>${payload.scanned}</b></span>
        <span>Reachable: <b>${results.length}</b></span>
        <span>SNI: <b>${escapeHTML(payload.sni)}</b></span>
      </div>
      ${results.map((item) => `
        <div class="akamai-row">
          <span class="network-ip">${escapeHTML(item.ip)}</span>
          <span class="network-latency">${item.latency_ms} ms</span>
          <button class="button secondary copy-ip"
                  data-copy="${escapeHTML(item.ip)}">Copy</button>
        </div>
      `).join("")}
    </div>
  `;

  bindCopyButtonsIn(container);
}

async function runAkamaiScan() {
  const button = $("#net-akamai-btn");
  const status = $("#net-akamai-status");
  const errorBox = $("#net-akamai-error");
  const results = $("#net-akamai-results");

  errorBox.hidden = true;
  results.hidden = true;
  button.disabled = true;
  status.textContent = "Scanning Akamai — this may take a while...";

  try {
    const payload = await postJSON("/api/v1/network/akamai-scan", {
      sample_size: Number($("#net-akamai-sample").value),
    });

    status.textContent = `Done. ${payload.reachable} reachable IPs.`;
    renderAkamaiResults(payload);
  } catch (error) {
    console.error("Akamai scan failed:", error);
    errorBox.textContent = "Akamai scan failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;
    status.textContent = "Failed.";
  } finally {
    button.disabled = false;
  }
}

function renderNetlifyResults(payload) {
  const container = $("#net-netlify-results");
  container.hidden = false;

  const configs = payload.configs || [];

  container.innerHTML = `
    <div class="network-results-card settings-card">
      <div class="section-title">Netlify configs</div>
      <div class="network-summary">
        <span>Generated: <b>${payload.count}</b></span>
      </div>
      ${configs.map((item) => `
        <div class="netlify-item">
          <div class="netlify-item-head">
            <span class="name">${escapeHTML(item.sni)} → ${escapeHTML(item.ip)}</span>
            <button class="button secondary" data-copy="${escapeHTML(item.content)}">Copy</button>
          </div>
          <pre>${escapeHTML(item.content)}</pre>
        </div>
      `).join("")}
    </div>
  `;

  bindCopyButtonsIn(container);
}

async function runNetlify() {
  const button = $("#net-netlify-btn");
  const status = $("#net-netlify-status");
  const errorBox = $("#net-netlify-error");
  const results = $("#net-netlify-results");

  errorBox.hidden = true;
  results.hidden = true;
  button.disabled = true;
  status.textContent = "Generating...";

  const snis = ($("#net-netlify-snis").value || "")
    .split("\n").map((item) => item.trim()).filter(Boolean);

  const ips = ($("#net-netlify-ips").value || "")
    .split("\n").map((item) => item.trim()).filter(Boolean);

  try {
    const payload = await postJSON("/api/v1/network/netlify", { snis, ips });

    status.textContent = `Done. ${payload.count} configs generated.`;
    renderNetlifyResults(payload);
  } catch (error) {
    console.error("Netlify generation failed:", error);
    errorBox.textContent = "Netlify generation failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;
    status.textContent = "Failed.";
  } finally {
    button.disabled = false;
  }
}

function renderDiagResults(payload) {
  const container = $("#net-diag-results");
  container.hidden = false;

  const sites = payload.sites || [];

  container.innerHTML = `
    <div class="network-results-card settings-card">
      <div class="section-title">Internet Diagnostics</div>
      <div class="network-summary">
        <span>Duration: <b>${payload.duration_ms} ms</b></span>
        <span>Targets: <b>${sites.length}</b></span>
      </div>

      <div class="diag-section">
        <div class="diag-section-title">DNS providers</div>
        ${(payload.dns.results || []).map((item) => `
          <div class="dns-row">
            <span class="name">${escapeHTML(item.name)}</span>
            <code class="network-ip">${escapeHTML(item.ip)}</code>
            <span class="latency">
              ${item.reachable ? `${item.latency_ms} ms` : "—"}
            </span>
            ${statusBadge(item.reachable ? "OK" : "NO ANSWER")}
          </div>
        `).join("")}
      </div>

      <div class="diag-section">
        <div class="diag-section-title">Sites</div>
        <div class="diag-targets">
          ${sites.map((item) => `
            <div class="diag-target">
              <div class="name">${escapeHTML(item.domain)}</div>
              <div class="meta">
                <span>TCP: ${item.tcp != null ? item.tcp + " ms" : "fail"}</span>
                <span>TLS: ${item.tls != null ? item.tls + " ms" : "fail"}</span>
                <code>${escapeHTML((item.resolved || []).join(", "))}</code>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

async function runDiag() {
  const button = $("#net-diag-btn");
  const status = $("#net-diag-status");
  const errorBox = $("#net-diag-error");
  const results = $("#net-diag-results");

  errorBox.hidden = true;
  results.hidden = true;
  button.disabled = true;
  status.textContent = "Running diagnostics...";

  const targets = ($("#net-diag-targets").value || "")
    .split(/[\n,]/).map((item) => item.trim()).filter(Boolean);

  try {
    const payload = await postJSON("/api/v1/network/diagnostics", { targets });

    status.textContent = "Done.";
    renderDiagResults(payload);
    addActivity("Network diagnostics completed", "info");
  } catch (error) {
    console.error("Diagnostics failed:", error);
    errorBox.textContent = "Diagnostics failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;
    status.textContent = "Failed.";
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------------------------------------
   Railway Relay module
   ------------------------------------------------------------ */
function renderRailwayDeployments(deployments) {
  const container = $("#rw-deployments-list");

  if (!deployments.length) {
    container.innerHTML = `
      <div class="info-box">
        <strong>No relays deployed yet.</strong>
        <p>
          Use the deploy card above to create your first Avaco Railway
          Relay with automatic project, source, variables and domain setup.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = deployments.map((record) => {
    const config = record.config || {};
    const host = record.host || "";
    const warnings = record.warnings || [];

    return `
      <div class="bpb-deployment">
        <div>
          <div class="bpb-deployment-name">
            ${escapeHTML(record.relay_name)}
          </div>
          <div class="section-subtitle">
            ${host
              ? `<a href="${escapeHTML(host)}" target="_blank">${escapeHTML(host)}</a>`
              : "No public domain attached"}
          </div>
          <div class="section-subtitle rw-config-line">
            Target: <code>${escapeHTML(config.TARGET_DOMAIN || "—")}</code>
            &nbsp;·&nbsp; Public path:
            <code>${escapeHTML(config.PUBLIC_RELAY_PATH || "—")}</code>
            &nbsp;·&nbsp; Relay path:
            <code>${escapeHTML(config.RELAY_PATH || "—")}</code>
          </div>
          <div class="section-subtitle rw-config-line">
            Timeout: <b>${config.UPSTREAM_TIMEOUT_MS ?? "—"}</b> ms
            &nbsp;·&nbsp; Max inflight: <b>${config.MAX_INFLIGHT ?? "—"}</b>
            &nbsp;·&nbsp; Relay key:
            ${record.relay_key_set ? "set" : "not set"}
          </div>
          ${warnings.length ? warnings.map((item) => `
            <div class="info-box error-box">${escapeHTML(item)}</div>
          `).join("") : ""}
        </div>
        <div class="bpb-deployment-actions">
          ${statusBadge(record.status || "unknown")}
          <button class="button secondary"
                  data-rw-debug="${escapeHTML(record.relay_name)}">Debug</button>
          <button class="button secondary"
                  data-rw-redeploy="${escapeHTML(record.relay_name)}">Redeploy</button>
          <button class="button secondary danger"
                  data-rw-delete="${escapeHTML(record.relay_name)}">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-rw-debug]").forEach((el) => {
    el.addEventListener("click", () => runRailwayDebug(el.dataset.rwDebug));
  });

  container.querySelectorAll("[data-rw-redeploy]").forEach((el) => {
    el.addEventListener("click", () => redeployRailway(el.dataset.rwRedeploy));
  });

  container.querySelectorAll("[data-rw-delete]").forEach((el) => {
    el.addEventListener("click", () => deleteRailway(el.dataset.rwDelete));
  });
}

async function loadRailway() {
  const errorBox = $("#rw-deploy-error");
  errorBox.hidden = true;

  try {
    const [config, deployments] = await Promise.all([
      getJSON("/api/v1/railway/config"),
      getJSON("/api/v1/railway/deployments"),
    ]);

    $("#rw-config-token").textContent = config.api_token_configured
      ? "Configured"
      : "Not configured";

    renderRailwayDeployments(deployments.deployments || []);

    if (config.api_token_configured) {
      try {
        const status = await getJSON("/api/v1/railway/status");
        const account = status.account || {};
        $("#rw-config-account").textContent =
          account.email || account.name || account.username || "Connected";
      } catch {
        $("#rw-config-account").textContent = "Check failed";
      }
    } else {
      $("#rw-config-account").textContent = "—";
    }
  } catch (error) {
    console.warn("Railway API unavailable:", error);
    $("#rw-config-token").textContent = "Error";
    $("#rw-deploy-error").textContent =
      "Railway API unavailable: " + extractErrorDetail(error.message);
    $("#rw-deploy-error").hidden = false;
  }
}

async function saveRailwayToken() {
  const button = $("#rw-save-token-btn");
  const status = $("#rw-save-token-status");
  const token = $("#rw-token").value.trim();

  button.disabled = true;
  status.textContent = "Saving...";

  try {
    await postJSON("/api/v1/railway/config", { api_token: token });

    $("#rw-token").value = "";
    status.textContent = "Token saved.";
    addActivity("Railway token configured", "info");

    await loadRailway();
  } catch (error) {
    console.error("Railway token save failed:", error);
    status.textContent = "Save failed: " + extractErrorDetail(error.message);
  } finally {
    button.disabled = false;
  }
}

async function deployRailway() {
  const button = $("#rw-deploy-btn");
  const status = $("#rw-deploy-status");
  const errorBox = $("#rw-deploy-error");

  errorBox.hidden = true;
  button.disabled = true;
  status.textContent = "Deploying to Railway — this may take a moment...";

  try {
    const payload = await postJSON("/api/v1/railway/deploy", {
      relay_name: $("#rw-name").value.trim() || "avaco-relay",
      api_token: $("#rw-token").value.trim(),
      target_domain: $("#rw-target").value.trim(),
      public_relay_path: $("#rw-public-path").value.trim(),
      relay_path: $("#rw-relay-path").value.trim(),
      relay_key: $("#rw-key").value.trim(),
      upstream_timeout_ms: Number($("#rw-timeout").value),
      max_inflight: Number($("#rw-inflight").value),
      region: $("#rw-region").value,
    });

    status.textContent = "Deployed successfully.";
    const record = payload.deployment || {};
    if (record.host) errorBox.hidden = true;
    addActivity(`Railway relay "${record.relay_name}" deployed`, "success");
    showToast("Railway relay deployed", "success");

    await loadRailway();
  } catch (error) {
    console.error("Railway deploy failed:", error);
    errorBox.textContent = "Deploy failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;
    status.textContent = "Deploy failed.";
  } finally {
    button.disabled = false;
  }
}

async function runRailwayDebug(relayName) {
  const box = $("#rw-debug-box");
  const content = $("#rw-debug-content");

  box.hidden = false;
  content.textContent = "Querying /__debug ...";

  try {
    const payload = await postJSON(
      `/api/v1/railway/deployments/${encodeURIComponent(relayName)}/debug`,
      {}
    );
    content.textContent = JSON.stringify(payload.debug, null, 2);
  } catch (error) {
    content.textContent = "Debug failed: " + extractErrorDetail(error.message);
  }
}

async function redeployRailway(relayName) {
  const status = $("#rw-deploy-status");

  status.textContent = `Redeploying ${relayName}...`;

  try {
    await postJSON(
      `/api/v1/railway/deployments/${encodeURIComponent(relayName)}/redeploy`,
      {}
    );
    status.textContent = "Redeploy triggered.";
    addActivity(`Redeploy triggered for "${relayName}"`, "info");
    await loadRailway();
  } catch (error) {
    console.error("Railway redeploy failed:", error);
    status.textContent = "Redeploy failed: " + extractErrorDetail(error.message);
  }
}

async function deleteRailway(relayName) {
  const confirmed = await confirmDialog({
    title: "Delete relay?",
    text: `Delete relay "${relayName}" from Railway? This cannot be undone.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;

  const status = $("#rw-deploy-status");
  status.textContent = "Deleting...";

  try {
    const response = await fetch(
      `${API}/api/v1/railway/deployments/${encodeURIComponent(relayName)}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      throw new Error(`${response.status}: ${await response.text()}`);
    }

    status.textContent = "Deleted.";
    addActivity(`Railway relay "${relayName}" deleted`, "info");
    await loadRailway();
  } catch (error) {
    console.error("Railway delete failed:", error);
    status.textContent = "Delete failed: " + extractErrorDetail(error.message);
  }
}

/* ------------------------------------------------------------
   Network tabs
   ------------------------------------------------------------ */
function bindNetTabs() {
  document.querySelectorAll("[data-net-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.netTab;
      document.querySelectorAll("[data-net-tab]").forEach((t) => {
        t.classList.toggle("active", t === tab);
      });
      document.querySelectorAll("[data-net-panel]").forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.netPanel === name);
      });
    });
  });
}

/* ------------------------------------------------------------
   Event wiring
   ------------------------------------------------------------ */
function bindNavigation() {
  document.querySelectorAll("[data-view]").forEach((item) => {
    item.addEventListener("click", () => showView(item.dataset.view));
  });

  document.querySelectorAll("[data-view-target]").forEach((item) => {
    item.addEventListener("click", () => showView(item.dataset.viewTarget));
  });

  $("#refresh-btn").addEventListener("click", async () => {
    await checkBackend();
    await loadCloudflare();
    await loadConfig();
    await loadRailway();
  });

  $("#theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "dark"
      ? "dark"
      : "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });

  document.querySelectorAll("[data-appearance]").forEach((el) => {
    el.addEventListener("click", () => applyTheme(el.dataset.appearance));
  });

  /* Workers search + refresh */
  $("#workers-search").addEventListener("input", (event) => {
    const q = (event.target.value || "").toLowerCase().trim();
    const all = AppState.workers || [];
    const filtered = q
      ? all.filter((w) => (w.name || "").toLowerCase().includes(q))
      : all;
    renderWorkersTable(filtered);
  });
  $("#workers-refresh").addEventListener("click", loadCloudflare);
  $("#deployments-refresh").addEventListener("click", loadCloudflare);

  /* Config Builder */
  $("#config-deploy-btn").addEventListener("click", deployConfig);
  $("#config-refresh").addEventListener("click", loadConfig);
  $("#config-logs-close").addEventListener("click", () => {
    $("#config-logs").hidden = true;
  });

  /* Settings */
  $("#cred-save-btn").addEventListener("click", saveCredentials);
  $("#cred-proxy-btn").addEventListener("click", saveProxy);

  /* Network Checker */
  $("#net-scan-btn").addEventListener("click", runNetworkScan);
  $("#net-domains-btn").addEventListener("click", runDomainCheck);
  $("#net-dns-btn").addEventListener("click", runDnsTest);
  $("#net-vless-btn").addEventListener("click", runVlessModify);
  $("#net-sni-btn").addEventListener("click", runSniCheck);
  $("#net-dns-hunt-btn").addEventListener("click", runDnsHunt);
  $("#net-xray-btn").addEventListener("click", runXrayScan);
  $("#net-akamai-btn").addEventListener("click", runAkamaiScan);
  $("#net-netlify-btn").addEventListener("click", runNetlify);
  $("#net-diag-btn").addEventListener("click", runDiag);

  /* Railway */
  $("#rw-save-token-btn").addEventListener("click", saveRailwayToken);
  $("#rw-deploy-btn").addEventListener("click", deployRailway);
  $("#rw-refresh").addEventListener("click", loadRailway);
  $("#rw-debug-close").addEventListener("click", () => {
    $("#rw-debug-box").hidden = true;
  });

  bindNetTabs();
}

/* ------------------------------------------------------------
   Bootstrap
   ------------------------------------------------------------ */
async function init() {
  initTheme();
  bindNavigation();

  updateSystemClock();
  setInterval(updateSystemClock, 1000);

  await checkBackend();
  await Promise.allSettled([
    loadCloudflare(),
    loadConfig(),
    loadRailway(),
  ]);
}

document.addEventListener("DOMContentLoaded", init);