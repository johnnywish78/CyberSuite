"use strict";

/* ============================================================
   Wish K E Cyber Panel — Reusable UI helpers and components.
   All escaping lives here so every user-controlled value rendered
   through the templates stays XSS-safe.
   ============================================================ */

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

function extractErrorDetail(message) {
  if (!message) return "unknown error";
  const text = String(message);
  const detail = text.match(/"detail":\s*"([^"]+)"/);
  return detail ? detail[1] : text;
}

/* Reusable: status badge */
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

/* Reusable: loading / empty / error state blocks */
function stateBlock(type, text) {
  const icon =
    type === "loading" ? '<div class="spinner"></div>' : "";
  const cls =
    type === "error" ? " state-error" : type === "empty" ? " state-empty" : "";
  return `<div class="state${cls}">${icon}<div class="state-title">${escapeHTML(text)}</div></div>`;
}

/* Reusable: toast notifications */
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

/* Reusable: confirm dialog (promise-based) */
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

/* Reusable: recent activity feed
   Consumes REAL events only. UI architecture ready for a future
   activity backend without redesigning the page. */
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

/* Reusable: copy-to-clipboard buttons inside a scope */
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