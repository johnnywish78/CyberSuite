const {
  app,
  BrowserWindow,
  shell,
} = require("electron");

const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

const BACKEND_HOST = "127.0.0.1";
const BACKEND_PORT = 8765;
const BACKEND_HEALTH_PATH = "/api/health";

let backendProcess = null;
let mainWindow = null;

function getPythonCommand() {
  if (process.env.CLOUDPILOT_PYTHON) {
    return process.env.CLOUDPILOT_PYTHON;
  }

  const projectVenv = path.join(
    __dirname,
    "..",
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python"
  );

  return projectVenv;
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const python = getPythonCommand();

    backendProcess = spawn(
      python,
      [
        "-m",
        "uvicorn",
        "backend.app:app",
        "--host",
        BACKEND_HOST,
        "--port",
        String(BACKEND_PORT),
      ],
      {
        cwd: path.join(__dirname, ".."),
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    backendProcess.stdout.on("data", (data) => {
      console.log(`[backend] ${data.toString().trim()}`);
    });

    backendProcess.stderr.on("data", (data) => {
      console.error(`[backend] ${data.toString().trim()}`);
    });

    backendProcess.on("error", (error) => {
      reject(
        new Error(`Failed to start backend: ${error.message}`)
      );
    });

    backendProcess.on("exit", (code, signal) => {
      console.log(
        `[backend] exited code=${code} signal=${signal}`
      );

      backendProcess = null;
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
              console.log(
                `[backend] healthy: ${body}`
              );
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
  if (!backendProcess) {
    return;
  }

  console.log("[backend] stopping...");

  backendProcess.kill("SIGTERM");

  const killTimer = setTimeout(() => {
    if (backendProcess) {
      console.log("[backend] force killing...");
      backendProcess.kill("SIGKILL");
    }
  }, 3000);

  backendProcess.once("exit", () => {
    clearTimeout(killTimer);
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
    console.log("[shell] starting backend...");

    await startBackend();

    console.log("[shell] backend ready");

    createWindow();

    console.log("[shell] Electron window ready");
  } catch (error) {
    console.error(
      `[shell] startup failed: ${error.message}`
    );

    stopBackend();

    app.quit();
  }
}

app.whenReady().then(bootstrap);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
