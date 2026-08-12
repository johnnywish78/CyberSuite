"use strict";

const API = window.cloudpilot?.backendUrl || "http://127.0.0.1:8765";

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

const $ = (selector) => document.querySelector(selector);

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${name}`);
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle(
      "active",
      item.dataset.view === name
    );
  });

  const titles = {
    dashboard: "Dashboard",
    workers: "Workers",
    deployments: "Deployments",
    settings: "Settings",
  };

  $("#page-title").textContent = titles[name] || "Dashboard";
}

async function getJSON(path) {
  const response = await fetch(`${API}${path}`);

  if (!response.ok) {
    throw new Error(
      `${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

function renderWorkers(workers) {
  $("#dashboard-workers").innerHTML = workers.map((worker) => `
    <div class="worker-card">
      <div class="worker-name">${escapeHTML(worker.name)}</div>
      <div class="worker-meta">
        <span>${worker.compatibility_date || "No compatibility date"}</span>
        <span class="badge">
          ${worker.workers_dev_enabled ? "ACTIVE" : "DISABLED"}
        </span>
      </div>
    </div>
  `).join("");

  $("#workers-list").innerHTML = `
    <div class="table-row table-head">
      <div>Name</div>
      <div>Compatibility</div>
      <div>Workers.dev</div>
      <div>Status</div>
    </div>
    ${workers.map((worker) => `
      <div class="table-row">
        <div>${escapeHTML(worker.name)}</div>
        <div>${worker.compatibility_date || "—"}</div>
        <div>
          ${worker.workers_dev_enabled ? "Enabled" : "Disabled"}
        </div>
        <div>
          <span class="badge">READY</span>
        </div>
      </div>
    `).join("")}
  `;
}

function renderDeployments(deployments) {
  $("#deployments-list").innerHTML = `
    <div class="table-row table-head">
      <div>Worker</div>
      <div>Version</div>
      <div>Status</div>
      <div>Created</div>
    </div>
    ${deployments.map((deployment) => `
      <div class="table-row">
        <div>${escapeHTML(deployment.worker_name)}</div>
        <div>${escapeHTML(deployment.version_id || "—")}</div>
        <div>
          <span class="badge">
            ${escapeHTML(deployment.status || "UNKNOWN")}
          </span>
        </div>
        <div>${formatDate(deployment.created_on)}</div>
      </div>
    `).join("")}
  `;
}

function renderContractMode() {
  $("#data-mode").textContent = "CONTRACT MODE";

  $("#stat-connection").textContent = "Not Connected";
  $("#stat-connection").classList.add("muted");

  $("#stat-workers").textContent = CONTRACT_WORKERS.length;
  $("#stat-deployments").textContent = CONTRACT_DEPLOYMENTS.length;

  renderWorkers(CONTRACT_WORKERS);
  renderDeployments(CONTRACT_DEPLOYMENTS);
}

async function loadCloudflare() {
  try {
    const config = await getJSON("/api/v1/cloudflare/config");

    $("#config-account").textContent =
      config.account_id_configured
        ? "Configured"
        : "Not configured";

    $("#config-token").textContent =
      config.api_token_configured
        ? "Configured"
        : "Not configured";

    if (!config.configured) {
      renderContractMode();
      return;
    }

    const [status, workers] = await Promise.all([
      getJSON("/api/v1/cloudflare/status"),
      getJSON("/api/v1/cloudflare/workers"),
    ]);

    $("#data-mode").textContent = "LIVE API";
    $("#stat-connection").textContent =
      status.authenticated ? "Connected" : "Inactive";

    $("#stat-connection").classList.remove("muted");

    renderWorkers(workers.workers || []);

    let deployments = [];

    for (const worker of workers.workers || []) {
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

    $("#stat-workers").textContent =
      (workers.workers || []).length;

    $("#stat-deployments").textContent =
      deployments.length;

    renderDeployments(deployments);
  } catch (error) {
    console.warn("Cloudflare API unavailable:", error);
    renderContractMode();
  }
}

async function checkBackend() {
  try {
    const health = await getJSON("/api/health");

    $("#backend-status").textContent = "Online";
    $("#stat-backend").textContent = "Online";

    return health;
  } catch (error) {
    console.error("Backend unavailable:", error);

    $("#backend-status").textContent = "Offline";
    $("#stat-backend").textContent = "Offline";
  }
}

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

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString();
}

function bindNavigation() {
  document.querySelectorAll("[data-view]").forEach((item) => {
    item.addEventListener("click", () => {
      showView(item.dataset.view);
    });
  });

  document.querySelectorAll("[data-view-target]").forEach((item) => {
    item.addEventListener("click", () => {
      showView(item.dataset.viewTarget);
    });
  });

  $("#refresh-btn").addEventListener("click", async () => {
    await checkBackend();
    await loadCloudflare();
  });
}

async function init() {
  bindNavigation();

  renderContractMode();

  await checkBackend();
  await loadCloudflare();
}

document.addEventListener("DOMContentLoaded", init);
