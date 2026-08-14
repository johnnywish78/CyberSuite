"use strict";

/* ============================================================
   Wish K E Cyber Panel — Settings view.
   Persists Cloudflare credentials and the outbound proxy through
   the backend. Credentials stay server-side and are never echoed.
   ============================================================ */

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