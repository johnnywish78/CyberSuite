"use strict";

/* ============================================================
   Wish K E Cyber Panel — Railway Relay view.
   Deploys and manages the Avaco XHTTP relay on Railway through the
   backend. The account token is stored server-side and is never
   exposed to the UI.
   ============================================================ */

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