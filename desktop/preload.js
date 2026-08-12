const { contextBridge } = require("electron");

const BACKEND_URL = "http://127.0.0.1:8765";

contextBridge.exposeInMainWorld("cloudpilot", {
  backendUrl: BACKEND_URL,
});
