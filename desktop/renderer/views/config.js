"use strict";

/* ============================================================
   Wish K E Cyber Panel — Config Builder view.
   Deploys and manages the personal BPB Panel on Cloudflare.
   ============================================================ */

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