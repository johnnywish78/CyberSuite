const { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage } = require('electron')
const path   = require('path')
const { spawn, execSync } = require('child_process')
const http   = require('http')
const fs     = require('fs')

const BACKEND_PORT = 8765          // پورت اختصاصی — با هیچ سرویسی تداخل نداره
const PROJECT_ROOT = path.join(__dirname, '..')
let   mainWindow   = null
let   backendProc  = null
let   tray         = null

// ── kill هر backend قبلی روی همین پورت ────────────────────────────────
function killPort(port) {
  try {
    const pids = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`).toString().trim()
    if (pids) {
      pids.split('\n').forEach(pid => {
        try { process.kill(parseInt(pid), 'SIGTERM') } catch {}
      })
    }
  } catch {}
}

// ── شروع Python backend ─────────────────────────────────────────────────
function startBackend() {
  killPort(BACKEND_PORT)

  const venvPy = path.join(PROJECT_ROOT, 'venv', 'bin', 'python')
  const pyBin  = fs.existsSync(venvPy) ? venvPy : 'python3'

  backendProc = spawn(pyBin, [
    '-m', 'uvicorn',
    'backend.app:app',
    '--host', '127.0.0.1',
    '--port', String(BACKEND_PORT),
    '--log-level', 'warning',
  ], {
    cwd:   PROJECT_ROOT,
    env:   { ...process.env, PYTHONPATH: PROJECT_ROOT },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  backendProc.stdout.on('data', d => console.log('[backend]', d.toString().trim()))
  backendProc.stderr.on('data', d => console.error('[backend]', d.toString().trim()))
  backendProc.on('exit', code => console.log('[backend] exited with code', code))

  console.log(`[main] Backend PID: ${backendProc.pid}`)
}

// ── منتظر بمان تا backend آماده بشه ────────────────────────────────────
function waitForBackend(retries = 30) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      http.get(`http://127.0.0.1:${BACKEND_PORT}/api/health`, res => {
        let body = ''
        res.on('data', d => body += d)
        res.on('end', () => resolve())
      }).on('error', () => {
        if (n <= 0) return reject(new Error('Backend timeout'))
        setTimeout(() => check(n - 1), 400)
      })
    }
    check(retries)
  })
}

// ── ساخت پنجره اصلی ─────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:          1320,
    height:         820,
    minWidth:       1100,
    minHeight:      680,
    frame:          false,          // custom title bar
    transparent:    false,
    backgroundColor:'#080810',
    title:          'Johnny CyberSuite X — All In One',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      backgroundThrottling: false,   // keep music + timers alive when minimized
    },
  })

  // بارگذاری UI
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'),
    { query: { port: String(BACKEND_PORT) } })

  // DevTools در حالت dev
  if (process.argv.includes('--dev'))
    mainWindow.webContents.openDevTools({ mode: 'detach' })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── IPC handlers ─────────────────────────────────────────────────────────
ipcMain.on('window:minimize',  () => mainWindow?.minimize())
ipcMain.on('window:maximize',  () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close',     () => mainWindow?.close())
ipcMain.on('window:fullscreen',() => mainWindow?.setFullScreen(!mainWindow.isFullScreen()))

ipcMain.handle('app:version',  () => app.getVersion())
ipcMain.handle('app:port',     () => BACKEND_PORT)

ipcMain.handle('shell:open', (_, url) => shell.openExternal(url))

// ── App lifecycle ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)   // بدون menu bar پیش‌فرض
  startBackend()

  try {
    await waitForBackend()
    console.log('[main] Backend ready ✓')
  } catch (e) {
    console.error('[main] Backend did not start in time:', e.message)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (backendProc) {
    backendProc.kill('SIGTERM')
    try { killPort(BACKEND_PORT) } catch {}
  }
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (backendProc) {
    backendProc.kill('SIGTERM')
    try { killPort(BACKEND_PORT) } catch {}
  }
})