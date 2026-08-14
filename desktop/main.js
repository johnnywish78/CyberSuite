const {
  app,
  BrowserWindow,
  shell,
} = require("electron");

const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

const BACKEND_HOST = process.env.CLOUDPILOT_BACKEND_HOST || "127.0.0.1";
const BACKEND_PORT = Number(process.env.CLOUDPILOT_BACKEND_PORT) || 8765;
const BACKEND_HEALTH_PATH = "/api/health";
const BACKEND_RESTART_MAX = 2;

let backendProcess = null;
let backendPid = null;
let mainWindow = null;
let quitting = false;
let restartAttempts = 0;

if (process.platform === "win32") {
  app.setAppUserModelId("com.johnny.cloudpilot");
}

function backendExecutableName() {
  return process.platform === "win32"
    ? "cloudpilot-backend.exe"
    : "cloudpilot-backend";
}

function getBackendCommand() {
  if (app.isPackaged) {
    return {
      command: path.join(
        process.resourcesPath,
        "backend",
        backendExecutableName()
      ),
      args: [],
      cwd: process.resourcesPath,
    };
  }

  const python =
    process.env.CLOUDPILOT_PYTHON ||
    path.join(
      __dirname,
      "..",
      ".venv",
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "python.exe" : "python"
    );

  return {
    command: python,
    args: [
      "-m",
      "uvicorn",
      "backend.app:app",
      "--host",
      BACKEND_HOST,
      "--port",
      String(BACKEND_PORT),
    ],
    cwd: path.join(__dirname, ".."),
  };
}

function checkBackendHealthy(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: BACKEND_HOST,
        port: BACKEND_PORT,
        path: BACKEND_HEALTH_PATH,
        timeout: timeoutMs,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode === 200) {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve({});
            }
            return;
          }
          resolve(null);
        });
      }
    );

    request.on("error", () => resolve(null));
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
  });
}

function spawnBackend() {
  const { command, args, cwd } = getBackendCommand();

  console.log(`[backend] starting: ${command}`);

  backendProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      CLOUDPILOT_BACKEND_HOST: BACKEND_HOST,
      CLOUDPILOT_BACKEND_PORT: String(BACKEND_PORT),
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  backendPid = backendProcess.pid;

  backendProcess.stdout.on("data", (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr.on("data", (data) => {
    console.error(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.on("exit", (code, signal) => {
    console.log(`[backend] exited code=${code} signal=${signal}`);
    backendProcess = null;
    backendPid = null;

    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      maybeRestartBackend();
    }
  });
}

function startBackend() {
  return new Promise(async (resolve, reject) => {
    // A healthy backend already answering on the port (e.g. a leftover
    // from a crashed shell or a second launch) is adopted instead of
    // starting a duplicate process. The adopted pid is recorded so the
    // shell can still stop it on shutdown.
    const health = await checkBackendHealthy();
    if (health) {
      backendPid = health.pid || null;
      console.log("[backend] existing healthy backend detected, reusing it");
      resolve();
      return;
    }

    spawnBackend();

    backendProcess.once("error", (error) => {
      reject(new Error(`Failed to start backend: ${error.message}`));
    });

    waitForBackend()
      .then(resolve)
      .catch((error) => {
        stopBackend();
        reject(error);
      });
  });
}

function waitForBackend(timeoutMs = 15000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    function check() {
      const request = http.get(
        {
          host: BACKEND_HOST,
          port: BACKEND_PORT,
          path: BACKEND_HEALTH_PATH,
          timeout: 1000,
        },
        (response) => {
          let body = "";

          response.on("data", (chunk) => {
            body += chunk;
          });

          response.on("end", () => {
            if (response.statusCode === 200) {
              console.log(`[backend] healthy: ${body}`);
              resolve();
              return;
            }

            retry();
          });
        }
      );

      request.on("error", () => {
        retry();
      });

      request.on("timeout", () => {
        request.destroy();
        retry();
      });
    }

    function retry() {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(
            `Backend did not become healthy within ${timeoutMs}ms`
          )
        );
        return;
      }

      setTimeout(check, 250);
    }

    check();
  });
}

function stopBackend() {
  if (!backendProcess && !backendPid) {
    return;
  }

  const pid = backendProcess ? backendProcess.pid : backendPid;

  console.log(`[backend] stopping (pid=${pid})...`);

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    console.error(`[backend] SIGTERM failed: ${error.message}`);
  }

  const killTimer = setTimeout(() => {
    try {
      console.log(`[backend] force killing (pid=${pid})...`);
      process.kill(pid, "SIGKILL");
    } catch (error) {
      /* The process already exited. */
    }
  }, 3000);

  if (backendProcess) {
    backendProcess.once("exit", () => {
      clearTimeout(killTimer);
      backendProcess = null;
      backendPid = null;
    });
  } else {
    // Adopted backend: wait briefly, then clear the handle.
    setTimeout(() => {
      clearTimeout(killTimer);
      backendPid = null;
    }, 500);
  }
}

function maybeRestartBackend() {
  if (quitting) {
    return;
  }

  if (restartAttempts >= BACKEND_RESTART_MAX) {
    console.error("[backend] giving up after repeated crashes");
    return;
  }

  restartAttempts += 1;
  console.log(
    `[backend] restart attempt ${restartAttempts}/${BACKEND_RESTART_MAX}`
  );

  startBackend()
    .then(() => {
      console.log("[backend] restarted");
    })
    .catch((error) => {
      console.error(`[backend] restart failed: ${error.message}`);
    });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#080b12",

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(
    path.join(__dirname, "renderer", "index.html")
  );

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();

    if (url !== currentUrl && url.startsWith("http")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  try {
    console.log("========== CloudPilot ==========");
    console.log(`[shell] starting backend (${BACKEND_HOST}:${BACKEND_PORT})...`);

    await startBackend();

    console.log("[shell] backend ready");

    createWindow();

    console.log("[shell] Electron window ready");
  } catch (error) {
    console.error(`[shell] startup failed: ${error.message}`);

    quitting = true;
    stopBackend();

    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    stopBackend();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  process.on("SIGINT", () => app.quit());
  process.on("SIGTERM", () => app.quit());
}