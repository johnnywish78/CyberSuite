"use strict";

/* ============================================================
   Wish K E Cyber Panel — Network Checker view.
   Clean-IP scans, domain checks, DNS tests, vless/netlify config
   generation and diagnostics. Pure renderers + runners that talk
   to the backend through the API client.
   ============================================================ */

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