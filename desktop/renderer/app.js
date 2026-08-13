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
    config: "Config Builder",
    network: "Network Checker",
    railway: "Railway Relay",
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

async function postJSON(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${response.status}: ${text}`
    );
  }

  return text ? JSON.parse(text) : {};
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

    $("#config-proxy").textContent =
      config.proxy_configured ? "Configured" : "Not configured";

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

    $("#data-mode").textContent = "ERROR";
    $("#stat-connection").textContent = "Unavailable";
    $("#stat-connection").classList.add("muted");
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

  bindCopyButtons();
}

function bindCopyButtons() {
  $("#config-results").querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = "Copy";
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
    const payload = await getJSON(
      "/api/v1/cloudflare/bpb/deployments"
    );

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

    const payload = await postJSON(
      "/api/v1/cloudflare/bpb/deploy",
      {
        worker_name:
          $("#config-worker-name").value.trim() || "cyber-panel",
        api_token: apiToken,
        proxy_ip_mode: $("#config-proxy-mode").value,
        proxy_ips: proxyIPs,
        doh_url: $("#config-doh").value.trim(),
      }
    );

    status.textContent = "Installed successfully.";

    renderConfigResults(payload.deployment);
    await loadConfig();
  } catch (error) {
    console.error("Config deploy failed:", error);

    const detail = (error.message || "").split(
      "detail"
    ).pop();

    errorBox.textContent =
      "Install failed. " + detail.replace(/[{}":]/g, " ");
    errorBox.hidden = false;

    status.textContent = "Install failed.";
  } finally {
    button.disabled = false;
  }
}

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

    await loadCloudflare();
  } catch (error) {
    console.error("Proxy save failed:", error);
    status.textContent =
      "Save failed: " + extractErrorDetail(error.message);
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

    await loadCloudflare();
  } catch (error) {
    console.error("Credential save failed:", error);
    status.textContent =
      "Save failed: " + extractErrorDetail(error.message);
  } finally {
    button.disabled = false;
  }
}

function extractErrorDetail(message) {
  if (!message) return "unknown error";
  const text = String(message);
  const detail = text.match(/"detail":\s*"([^"]+)"/);
  return detail ? detail[1] : text;
}

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

  container.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = "Copy";
        }, 1500);
      } catch (error) {
        console.warn("Clipboard unavailable:", error);
      }
    });
  });
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

    status.textContent =
      `Done. ${payload.reachable} clean IPs found.`;

    renderNetworkResults(payload);
  } catch (error) {
    console.error("Network scan failed:", error);

    errorBox.textContent =
      "Scan failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;

    status.textContent = "Scan failed.";
  } finally {
    button.disabled = false;
  }
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
          <span class="badge ${item.reachable ? "" : "blocked"}">
            ${item.reachable ? "REACHABLE" : "BLOCKED"}
          </span>
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
    const payload = await postJSON("/api/v1/network/domain-check", {
      domains,
    });

    status.textContent =
      `Done. ${payload.reachable} reachable, ${payload.blocked} blocked.`;

    renderDomainResults(payload);
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
          <span class="badge ${item.reachable ? "" : "blocked"}">
            ${item.reachable ? "OK" : "NO ANSWER"}
          </span>
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

    errorBox.textContent =
      "DNS test failed: " + extractErrorDetail(error.message);
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
            <span class="badge">${item.valid ? item.count + " configs" : "INVALID"}</span>
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

    status.textContent =
      `Done. ${payload.count} configs generated.`;

    renderVlessResults(payload);
  } catch (error) {
    console.error("Vless modify failed:", error);

    errorBox.textContent =
      "Generation failed: " + extractErrorDetail(error.message);
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
        <span class="badge ${payload.real_sni != null ? "" : "blocked"}">
          ${payload.real_sni != null ? "OK" : "BLOCKED"}
        </span>
      </div>
      <div class="domain-row">
        <span class="name">Spoofed SNI (${escapeHTML(payload.decoy)})</span>
        <span class="latency">
          ${payload.spoofed_sni != null ? payload.spoofed_sni + " ms" : "—"}
        </span>
        <span class="badge ${payload.spoof_supported ? "" : "blocked"}">
          ${payload.spoof_supported ? "SPOOF WORKS" : "NOT SPOOFABLE"}
        </span>
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

    status.textContent =
      payload.spoof_supported
        ? "SNI spoofing is supported on your connection."
        : "SNI spoofing is not possible.";

    renderSniResults(payload);
  } catch (error) {
    console.error("SNI check failed:", error);

    errorBox.textContent =
      "SNI check failed: " + extractErrorDetail(error.message);
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
          <span class="badge ${item.reachable ? "" : "blocked"}">
            ${item.reachable ? `${item.latency_ms} ms` : "NO ANSWER"}
          </span>
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
      domains: $("#net-dns-hunt-domain").value.trim() ? [$("#net-dns-hunt-domain").value.trim()] : [],
    });

    status.textContent = "Done.";

    renderDnsHuntResults(payload);
  } catch (error) {
    console.error("DNS hunt failed:", error);

    errorBox.textContent =
      "DNS hunt failed: " + extractErrorDetail(error.message);
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

    status.textContent =
      `Done. ${payload.reachable} reachable IPs.`;

    renderXrayResults(payload);
  } catch (error) {
    console.error("Xray scan failed:", error);

    errorBox.textContent =
      "Xray scan failed: " + extractErrorDetail(error.message);
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

    status.textContent =
      `Done. ${payload.reachable} reachable IPs.`;

    renderAkamaiResults(payload);
  } catch (error) {
    console.error("Akamai scan failed:", error);

    errorBox.textContent =
      "Akamai scan failed: " + extractErrorDetail(error.message);
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
    const payload = await postJSON("/api/v1/network/netlify", {
      snis,
      ips,
    });

    status.textContent =
      `Done. ${payload.count} configs generated.`;

    renderNetlifyResults(payload);
  } catch (error) {
    console.error("Netlify generation failed:", error);

    errorBox.textContent =
      "Netlify generation failed: " + extractErrorDetail(error.message);
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
            <span class="badge ${item.reachable ? "" : "blocked"}">
              ${item.reachable ? "OK" : "NO ANSWER"}
            </span>
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
    const payload = await postJSON("/api/v1/network/diagnostics", {
      targets,
    });

    status.textContent = "Done.";

    renderDiagResults(payload);
  } catch (error) {
    console.error("Diagnostics failed:", error);

    errorBox.textContent =
      "Diagnostics failed: " + extractErrorDetail(error.message);
    errorBox.hidden = false;

    status.textContent = "Failed.";
  } finally {
    button.disabled = false;
  }
}

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
          <span class="badge rw-status">${escapeHTML(record.status || "unknown")}</span>
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
    el.addEventListener("click", () => {
      runRailwayDebug(el.dataset.rwDebug);
    });
  });

  container.querySelectorAll("[data-rw-redeploy]").forEach((el) => {
    el.addEventListener("click", () => {
      redeployRailway(el.dataset.rwRedeploy);
    });
  });

  container.querySelectorAll("[data-rw-delete]").forEach((el) => {
    el.addEventListener("click", () => {
      deleteRailway(el.dataset.rwDelete);
    });
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

    $("#rw-config-token").textContent =
      config.api_token_configured ? "Configured" : "Not configured";

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

    await loadRailway();
  } catch (error) {
    console.error("Railway token save failed:", error);
    status.textContent =
      "Save failed: " + extractErrorDetail(error.message);
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
      relay_name:
        $("#rw-name").value.trim() || "avaco-relay",
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
    const host = record.host || "";

    if (host) {
      errorBox.hidden = true;
    }

    await loadRailway();
  } catch (error) {
    console.error("Railway deploy failed:", error);
    errorBox.textContent =
      "Deploy failed: " + extractErrorDetail(error.message);
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
    content.textContent =
      "Debug failed: " + extractErrorDetail(error.message);
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
    await loadRailway();
  } catch (error) {
    console.error("Railway redeploy failed:", error);
    status.textContent =
      "Redeploy failed: " + extractErrorDetail(error.message);
  }
}

async function deleteRailway(relayName) {
  if (!window.confirm(`Delete relay "${relayName}" from Railway?`)) {
    return;
  }

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
    await loadRailway();
  } catch (error) {
    console.error("Railway delete failed:", error);
    status.textContent =
      "Delete failed: " + extractErrorDetail(error.message);
  }
}

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

  $("#config-deploy-btn").addEventListener("click", deployConfig);
  $("#config-refresh").addEventListener("click", loadConfig);
  $("#cred-save-btn").addEventListener("click", saveCredentials);
  $("#cred-proxy-btn").addEventListener("click", saveProxy);
  $("#config-logs-close").addEventListener("click", () => {
    $("#config-logs").hidden = true;
  });
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

  $("#rw-save-token-btn").addEventListener("click", saveRailwayToken);
  $("#rw-deploy-btn").addEventListener("click", deployRailway);
  $("#rw-refresh").addEventListener("click", loadRailway);
  $("#rw-debug-close").addEventListener("click", () => {
    $("#rw-debug-box").hidden = true;
  });

  bindNetTabs();
}

async function init() {
  bindNavigation();

  await checkBackend();
  await loadCloudflare();
  await loadConfig();
  await loadRailway();
}

document.addEventListener("DOMContentLoaded", init);
