"use strict";

/* ============================================================
   Wish K E Cyber Panel — Renderer bootstrap.
   Wiring, navigation, theme, the single system clock, backend and
   Cloudflare state and cross-view orchestration. View-specific
   renderers live in views/, shared components in components/,
   state in state/, HTTP access in api/.
   ============================================================ */

/* ------------------------------------------------------------
   Appearance (DARK / LIGHT only)
   ------------------------------------------------------------ */
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
    AppState.backend.version = health.version || AppState.backend.version;
    const versionEl = $("#app-version");
    if (versionEl && AppState.backend.version) {
      versionEl.textContent = `v${AppState.backend.version}`;
    }
    const aboutVersion = $("#about-version");
    if (aboutVersion && AppState.backend.version) {
      aboutVersion.textContent = `v${AppState.backend.version}`;
    }
    const aboutBackend = $("#about-backend");
    if (aboutBackend) {
      aboutBackend.textContent = API.replace(/^https?:\/\//, "");
    }
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
    if (AppState.backend.wasOnline) {
      console.error("Backend unavailable:", error);
      addActivity("Backend connection lost", "error");
    }
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
  const aboutMode = $("#about-mode");
  if (aboutMode) aboutMode.textContent = mode;
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

  /* Quiet backend health poll — keeps uptime and connection state
     truthful when the backend restarts or crashes. */
  setInterval(checkBackend, 10000);

  await checkBackend();
  await Promise.allSettled([
    loadCloudflare(),
    loadConfig(),
    loadRailway(),
  ]);
}

document.addEventListener("DOMContentLoaded", init);