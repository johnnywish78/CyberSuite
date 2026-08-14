"use strict";

/* ============================================================
   Wish K E Cyber Panel — API client.
   Single access point for the local FastAPI backend. The base URL
   is injected by the Electron preload bridge and never contains
   secrets.
   ============================================================ */

const API = window.cloudpilot?.backendUrl || "http://127.0.0.1:8765";

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