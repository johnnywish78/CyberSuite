"use strict";

/* ============================================================
   Wish K E Cyber Panel — Workers & Deployments renderers.
   Pure renderers: they only consume AppState and write to the DOM.
   ============================================================ */

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