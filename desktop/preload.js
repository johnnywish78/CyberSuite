const { contextBridge, ipcRenderer } = require("electron");

const BACKEND_HOST = process.env.CLOUDPILOT_BACKEND_HOST || "127.0.0.1";
const BACKEND_PORT = Number(process.env.CLOUDPILOT_BACKEND_PORT) || 8765;
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;

contextBridge.exposeInMainWorld("cloudpilot", {
  backendUrl: BACKEND_URL,
  speedtest: {
    show: (rect) => ipcRenderer.send("speedtest:show", rect),
    hide: () => ipcRenderer.send("speedtest:hide"),
  },
});