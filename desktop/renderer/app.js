/* ═══════════════════════════════════════════════════════════════════════
   Johnny CyberSuite X — app.js
   ═══════════════════════════════════════════════════════════════════════ */

/* global state ─────────────────────────────────────────────────────────── */
let API_PORT = 8765
let API      = `http://127.0.0.1:${API_PORT}`
let WS_BASE  = `ws://127.0.0.1:${API_PORT}`

const G = {                      // global app state
  themes:[], activeTheme:'cyberpunk-2077', activePage:'dashboard',
  aiHistory:[], vpnConnected:false, vpnName:'',
  statsWs:null, termWs:null,
  musicFiles:[], currentTrack:0, musicPlaying:false,
  audio: new Audio(),
  selectedTrpTheme: null,
  ncActive:'speedtest', ncLoaded:{}, ncConnTimer:null,
  // System Monitor
  monWs:null, monTab:'processes', monPollTimer:null, monLast:null,
  // VPN Center
  vpnPollTimer:null, vpnKS:false, vpnAC:false, vpnACProfile:null,
  procData:[], procSort:{key:'cpu',dir:-1}, procAuto:true, procPrimed:false,
  svcData:[], svcCounts:{}, svcSort:{key:'name',dir:1},
  g: {                           // graph history
    cpu:[], ram:[], gpu:[], net:[],   // stats bar
    dcpu:[],dram:[],dgpu:[],dnet:[],  // dashboard cards
    rup:[]                            // right-rail upload series
  }
}

const MAX = 60
function push(arr, v){ arr.push(v); if(arr.length>MAX) arr.shift() }
window.G = G   // expose for diagnostics / headless tests

// ═══════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════
async function init() {
  // resolve port
  const urlPort = new URLSearchParams(window.location.search).get('port')
  if (urlPort) setPort(urlPort)
  if (window.electron) try { setPort(await window.electron.getPort()) } catch {}

  initNavigation()
  initClock()
  initVpnTabs()
  initAiCenter()

  // Theme Engine — owns colors/glass/fx/animations/window effects and
  // calls back into the asset appliers (wallpaper / music / font / icons)
  ThemeEngine.init({
    wallpaper: applyThemeWallpaper,
    music:     applyThemeMusic,
    font:      applyThemeFont,
    icons:     applyThemeIcons,
  })
  ThemeEngine.on(onThemeChanged)

  // load asset registry (local files + online theme-assets manifest),
  // then render themes so thumbnails/fonts/etc. can use the online URLs
  loadAssetRegistry().catch(()=>{}).finally(() => loadThemes().catch(()=>{}))

  // connect stats WS
  connectStatsWs()

  // init terminal
  initTerminal()
  initTrpTabs()

  // init music
  initMusic()

  // background data
  loadGateway()
  setInterval(loadGateway, 60000)
  refreshIP()
  setInterval(refreshIP, 300000)      // public IP — cached server-side (5 min)
  refreshVPNHealth()
  setInterval(refreshVPNHealth, 60000)
  pingLoop()
  initMonitor()
  loadSettings()
  loadVpnProfiles()
  loadAssetCounts()
  railConnRefresh()
  setInterval(railConnRefresh, 5000)  // right-rail active connections
  railVpnRefresh()
  setInterval(railVpnRefresh, 10000)
}

function setPort(p) {
  API_PORT = parseInt(p)
  API      = `http://127.0.0.1:${API_PORT}`
  WS_BASE  = `ws://127.0.0.1:${API_PORT}`
}

// ═══════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════
function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchPage(btn.dataset.page)
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      if (btn.dataset.page === 'media')   loadMedia()
      if (btn.dataset.page === 'themes')  renderThemeCards('all')
      if (btn.dataset.page === 'about')   loadAboutSystemInfo()
      if (btn.dataset.page === 'monitor') monEnter()
      if (btn.dataset.page === 'vpn')     vpnEnter()
      if (btn.dataset.page === 'reports') loadReports()
    })
  })
}

function switchPage(page) {
  G.activePage = page
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'))
  document.getElementById(`page-${page}`)?.classList.add('active')
  // canvases on hidden pages are skipped by drawGraphs — refresh them now
  requestAnimationFrame(drawGraphs)
}

/* navigate from quick-tools / taskbar buttons; optionally open a sub-tab */
window.gotoPage = function(page, subTab) {
  const btn = document.querySelector(`.nav-btn[data-page="${page}"]`)
  if (btn) btn.click()
  else switchPage(page)
  if (subTab) {
    const t = document.querySelector(`.nc-tab[data-nc="${subTab}"]`)
    if (t) t.click()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CLOCK
// ═══════════════════════════════════════════════════════════════════════════
function initClock() { tick(); setInterval(tick,1000) }
function tick() {
  const n = new Date()
  sTxt('val-time', n.toTimeString().slice(0,8))
  sTxt('val-date', n.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}))
}

// ═══════════════════════════════════════════════════════════════════════════
//  STATS — WebSocket (live)
// ═══════════════════════════════════════════════════════════════════════════
function connectStatsWs() {
  try {
    const ws = new WebSocket(`${WS_BASE}/ws/stats`)
    ws.onopen    = () => setBadge('conn-badge','ONLINE','var(--net)')
    ws.onmessage = e => { try { updateStats(JSON.parse(e.data)) } catch {} }
    ws.onclose   = () => { setBadge('conn-badge','OFFLINE','var(--danger)'); setTimeout(connectStatsWs, 2000) }
    ws.onerror   = () => ws.close()
    G.statsWs = ws
  } catch { setTimeout(connectStatsWs, 3000) }
}

function updateStats(d) {
  // ── stats bar ────────────────────────────────────────────────────────
  sTxt('val-cpu',  `${num(d.cpu)}%`)
  sTxt('val-ram',  `${num(d.ram)}%`)
  sTxt('val-gpu',  `${num(d.gpu)}%`)
  sTxt('val-net',  `${d.dl?.toFixed(1)||0} Mbps`)
  sTxt('val-ip',   d.local_ip || '—')

  // ── dashboard cards ──────────────────────────────────────────────────
  sTxt('cv-cpu',   `${num(d.cpu)}%`)
  sTxt('cs-cpu',   `${d.cpu_model||'CPU'} | Temp ${num(d.cpu_temp)}°C`)
  sTxt('cv-ram',   `${num(d.ram)}%`)
  sTxt('cs-ram',   `${d.ram_used||0} / ${d.ram_total||0} GB`)
  sTxt('cv-gpu',   `${num(d.gpu)}%`)
  sTxt('cs-gpu',   d.gpu_name ? `${d.gpu_name} | Temp ${num(d.gpu_temp)}°C` : 'No GPU detected')
  sTxt('cv-net',   `${d.dl?.toFixed(1)||0} Mbps`)
  sTxt('cs-net',   `↑ ${d.ul?.toFixed(1)||0} Mbps`)
  sTxt('cv-uptime', fmtUptimeShort(d.uptime||0))
  sTxt('cv-disk',  `${num(d.disk_percent)}%`)
  sTxt('cs-disk',  `${d.disk_used||0} / ${d.disk_total||0} GB (/)`)
  const db = document.getElementById('dash-disk-bar')
  if (db) {
    db.style.width = `${d.disk_percent||0}%`
    db.style.background = (d.disk_percent||0) > 85 ? 'var(--danger)' : 'var(--accent)'
  }

  // ── status card (real health, not static) ────────────────────────────
  const issues = []
  if ((d.cpu||0) > 90)          issues.push('CPU high')
  if ((d.ram||0) > 90)          issues.push('RAM high')
  if ((d.cpu_temp||0) > 85)     issues.push('CPU hot')
  if ((d.disk_percent||0) > 92) issues.push('Disk full')
  const stEl = document.getElementById('cv-status')
  if (stEl) {
    stEl.textContent = issues.length ? 'WARNING' : 'OK'
    stEl.style.color = issues.length ? 'var(--danger)' : 'var(--net)'
  }
  sTxt('cs-status', issues.length ? issues.join(' · ') : 'All Systems Operational')

  // ── graph data (stats bar + dashboard cards) ─────────────────────────
  const dl = Math.min(d.dl||0, 200)
  push(G.g.cpu,d.cpu);push(G.g.ram,d.ram);push(G.g.gpu,d.gpu);push(G.g.net,dl)
  push(G.g.dcpu,d.cpu);push(G.g.dram,d.ram);push(G.g.dgpu,d.gpu);push(G.g.dnet,dl)
  push(G.g.rup, Math.min(d.ul||0,200))
  drawGraphs()

  // ── dashboard mini-monitor legend + taskbar temps ────────────────────
  sTxt('dm-cpu', `${num(d.cpu)}%`); sTxt('dm-ram', `${num(d.ram)}%`); sTxt('dm-gpu', `${num(d.gpu)}%`)
  sTxt('tb-cpu-temp', d.cpu_temp!=null ? `${num(d.cpu_temp)}°C` : '—°C')
  sTxt('tb-gpu-temp', d.gpu_temp!=null ? `${num(d.gpu_temp)}°C` : '—°C')
}

function fmtUptimeShort(sec) {
  const d = Math.floor(sec/86400), h = Math.floor((sec%86400)/3600), m = Math.floor((sec%3600)/60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  return `${h}h ${m}m ${sec%60}s`
}

// ═══════════════════════════════════════════════════════════════════════════
//  GRAPHS
// ═══════════════════════════════════════════════════════════════════════════
function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim() }

function drawGraph(id, data, color, maxVal=100) {
  const c = document.getElementById(id)
  if (!c || data.length < 2) return
  const W = c.offsetWidth || c.width, H = c.height
  c.width = W
  const ctx = c.getContext('2d')
  ctx.clearRect(0,0,W,H)
  const pts = data.map((v,i)=>({
    x: (i/(data.length-1))*W,
    y: H - (Math.min(v,maxVal)/maxVal)*(H-2) - 1
  }))
  // smooth path through midpoints
  const path = () => {
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i=1; i<pts.length-1; i++) {
      const mx=(pts[i].x+pts[i+1].x)/2, my=(pts[i].y+pts[i+1].y)/2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
    }
    ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y)
  }
  // gradient fill
  const gr = ctx.createLinearGradient(0,0,0,H)
  gr.addColorStop(0, hex4(color,.3)); gr.addColorStop(1, hex4(color,.02))
  ctx.beginPath(); ctx.moveTo(pts[0].x,H); ctx.lineTo(pts[0].x,pts[0].y)
  path()
  ctx.lineTo(pts[pts.length-1].x,H); ctx.closePath()
  ctx.fillStyle=gr; ctx.fill()
  // line
  ctx.beginPath(); path()
  ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.stroke()
}

function drawGraphs() {
  const cpu=cssVar('--cpu')||'#00e5ff', ram=cssVar('--ram')||'#ee00cc',
        gpu=cssVar('--gpu')||'#aa44ff', net=cssVar('--net')||'#00ff88'
  // stats bar is always visible
  drawGraph('graph-cpu',G.g.cpu,cpu); drawGraph('graph-ram',G.g.ram,ram)
  drawGraph('graph-gpu',G.g.gpu,gpu); drawGraph('graph-net',G.g.net,net,200)
  // right rail (always visible): download + upload overlay
  drawMultiGraph('rail-net-graph', [[G.g.net,net],[G.g.rup,ram]], 200)
  // page graphs: only render the active page (perf — skip hidden canvases)
  if (G.activePage === 'dashboard') {
    drawGraph('cg-cpu',G.g.dcpu,cpu);   drawGraph('cg-ram',G.g.dram,ram)
    drawGraph('cg-gpu',G.g.dgpu,gpu);   drawGraph('cg-net',G.g.dnet,net,200)
    drawMultiGraph('dash-mon-graph', [[G.g.dcpu,cpu],[G.g.dram,ram],[G.g.dgpu,gpu]], 100)
  }
}

/* several series on one canvas (dashboard system-monitor / rail network) */
function drawMultiGraph(id, series, maxVal=100) {
  const c = document.getElementById(id)
  if (!c) return
  const W = c.offsetWidth || c.width, H = c.offsetHeight || c.height
  if (!W || !H) return
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.clearRect(0,0,W,H)
  // subtle horizontal grid
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1
  for (let i=1;i<4;i++){ const y=H*i/4; ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke() }
  for (const [data,color] of series) {
    if (!data || data.length < 2) continue
    const pts = data.map((v,i)=>({
      x:(i/(data.length-1))*W,
      y:H-(Math.min(v||0,maxVal)/maxVal)*(H-2)-1
    }))
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y)
    for (let i=1;i<pts.length-1;i++){
      const mx=(pts[i].x+pts[i+1].x)/2,my=(pts[i].y+pts[i+1].y)/2
      ctx.quadraticCurveTo(pts[i].x,pts[i].y,mx,my)
    }
    ctx.lineTo(pts[pts.length-1].x,pts[pts.length-1].y)
    ctx.strokeStyle=color; ctx.lineWidth=1.4; ctx.stroke()
  }
}

function hex4(hex,a) {
  try {
    const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16)
    return `rgba(${r},${g},${b},${a})`
  } catch { return `rgba(255,255,255,${a})` }
}

// ═══════════════════════════════════════════════════════════════════════════
//  THEMES
// ═══════════════════════════════════════════════════════════════════════════

/* ── Asset Registry — loaded once at init ── */
let assetRegistry = { backgrounds:[], music:[], fonts:[], icons:[] }
let themeAssets   = {}    // online manifest: { <themeId>: {bg, font:{family,url}, icon, music} }

async function loadAssetRegistry() {
  const cats = ['backgrounds','music','fonts','icons']
  try {
    const results = await Promise.all(
      cats.map(c => fetch(`${API}/api/assets/${c}`).then(r => r.ok ? r.json() : []).catch(()=>[]))
    )
    cats.forEach((c,i) => { assetRegistry[c] = results[i] })
  } catch {}
  // online per-theme asset map (backgrounds/fonts/icons/music from the internet)
  try {
    themeAssets = await fetch(`${API}/api/theme-assets`).then(r => r.ok ? r.json() : {})
  } catch { themeAssets = {} }
  // manifest may arrive after the initial theme was applied → re-apply its assets
  if (G.activeTheme) {
    applyThemeWallpaper(G.activeTheme)
    applyThemeFont(G.activeTheme)
    applyThemeIcons(G.activeTheme)
  }
}

function findAssetForTheme(category, themeId) {
  return (assetRegistry[category]||[]).find(f => f.stem === themeId) || null
}

// Resolve an asset for a theme: prefer a LOCAL file in assets/, fall back to the
// online manifest URL. Returns { url (absolute), local, family? } or null.
const _ONLINE_KEY = { backgrounds:'bg', music:'music', fonts:'font', icons:'icon' }
function resolveAsset(category, themeId) {
  const local = findAssetForTheme(category, themeId)
  if (local) return { url: `${API}${local.url}`, local: true, stem: local.stem, ext: local.ext, name: local.name }
  const online = themeAssets[themeId]
  const val = online && online[_ONLINE_KEY[category]]
  if (!val) return null
  if (category === 'fonts') return { url: val.url, family: val.family, local: false }
  return { url: val, local: false }
}

/* ── Theme-linked asset functions (local file → online manifest fallback) ── */
function applyThemeWallpaper(id) {
  const asset = resolveAsset('backgrounds', id)
  if (asset) {
    const img = new Image()
    img.onload = () => {
      document.body.style.backgroundImage = `url('${asset.url}')`
      document.body.classList.add('has-wallpaper')
    }
    img.onerror = () => {
      document.body.style.backgroundImage = ''
      document.body.classList.remove('has-wallpaper')
    }
    img.src = asset.url
  } else {
    document.body.style.backgroundImage = ''
    document.body.classList.remove('has-wallpaper')
  }
}

let _currentMusicTheme = null
function applyThemeMusic(id) {
  const asset = resolveAsset('music', id)
  if (!asset) return             // no music → keep current track
  if (_currentMusicTheme === id) return
  _currentMusicTheme = id
  const title = asset.stem || asset.name || (G.themes.find(t=>t.id===id)?.name) || id
  Music.playThemeTrack(asset.url, title, `Theme: ${id}`)
}

let _themeFontStyle = null    // holds the injected <style> (local) or <link> (Google Fonts)
function applyThemeFont(id) {
  if (_themeFontStyle) { _themeFontStyle.remove(); _themeFontStyle = null }
  const local = findAssetForTheme('fonts', id)
  if (local) {
    const fmtMap = {woff2:'woff2',woff:'woff',otf:'opentype',ttf:'truetype'}
    const fmt = fmtMap[local.ext] || local.ext
    _themeFontStyle = document.createElement('style')
    _themeFontStyle.textContent = `@font-face{font-family:"theme-font-${id}";src:url("${API}${local.url}") format("${fmt}");font-display:swap;}`
    document.head.appendChild(_themeFontStyle)
    document.body.style.fontFamily = `"theme-font-${id}",'Courier New',monospace`
    return
  }
  const online = themeAssets[id] && themeAssets[id].font
  if (online && online.url && online.family) {
    _themeFontStyle = document.createElement('link')    // Google Fonts stylesheet
    _themeFontStyle.rel = 'stylesheet'
    _themeFontStyle.href = online.url
    document.head.appendChild(_themeFontStyle)
    document.body.style.fontFamily = `"${online.family}",'Courier New',monospace`
    return
  }
  document.body.style.fontFamily = ''
}

function applyThemeIcons(id) {
  const asset = resolveAsset('icons', id)
  if (!asset) return
  let favicon = document.querySelector('link[rel="icon"]')
  if (!favicon) {
    favicon = document.createElement('link')
    favicon.rel = 'icon'
    document.head.appendChild(favicon)
  }
  favicon.href = asset.url
}
/* ── Theme-change subscriber: live surfaces that can't use CSS vars ── */
function onThemeChanged(t) {
  // xterm.js colors follow the theme
  if (TERM) {
    TERM.options.theme = Object.assign({}, TERM.options.theme, {
      background: t.term_bg || '#030308',
      foreground: t.text    || '#c8c8e8',
      cursor:     t.accent  || '#ffff00',
    })
  }
  // canvas graphs repaint with the new palette
  requestAnimationFrame(drawGraphs)
}

async function loadThemes() {
  try {
    const r = await fetch(`${API}/api/themes`)
    if (r.ok) G.themes = await r.json()
  } catch {}
  if (!G.themes.length) G.themes = fallbackThemes()
  // custom themes saved by the user (Settings → stored server-side)
  try {
    const s = await api('GET','/api/settings')
    if (Array.isArray(s.custom_themes)) G.themes = [...G.themes, ...s.custom_themes]
  } catch {}
  ThemeEngine.registerAll(G.themes)
  renderThemesPage()
  renderTaskbar()
  renderTrpThemes()
  populateSettingsTheme()
  // theme may have been applied before the registry was ready → re-apply
  if (G.activeTheme) ThemeEngine.apply(G.activeTheme)
}

function applyTheme(id) {
  G.activeTheme = id
  ThemeEngine.apply(id)   // colors, glass, fx, animations, window effects + asset hooks
  document.querySelectorAll('[data-tid]').forEach(el =>
    el.classList.toggle('active-theme', el.dataset.tid === id))
  document.querySelectorAll('.tb-theme-btn').forEach(el =>
    el.classList.toggle('active', el.dataset.tid === id))
  setTimeout(drawGraphs, 60)
  api('PUT','/api/settings',{theme:id}).catch(()=>{})
  toast(`Theme: ${G.themes.find(t=>t.id===id)?.name||id}`)
}

/* register a user-defined theme at runtime and persist it */
window.addCustomTheme = async function(themeObj) {
  if (!themeObj || !themeObj.id) { toast('Custom theme needs an "id"'); return }
  themeObj.category = themeObj.category || 'Custom'
  G.themes = [...G.themes.filter(t => t.id !== themeObj.id), themeObj]
  ThemeEngine.register(themeObj)
  renderThemesPage(); renderTaskbar(); renderTrpThemes(); populateSettingsTheme()
  try {
    const s = await api('GET','/api/settings')
    const customs = (s.custom_themes || []).filter(t => t.id !== themeObj.id)
    await api('PUT','/api/settings',{ custom_themes: [...customs, themeObj] })
  } catch {}
  toast(`Custom theme added: ${themeObj.name || themeObj.id}`)
}

/* ── Themes Page ── */
function renderThemesPage() {
  const grid = document.getElementById('themes-grid')
  if (!grid) return
  const cats = [...new Set(G.themes.map(t=>t.category||'Other'))]
  grid.innerHTML = `
    <div id="theme-filter">
      <button class="tf-btn active" data-cat="all" onclick="filterThemes(this,'all')">All (${G.themes.length})</button>
      ${cats.map(c=>`<button class="tf-btn" data-cat="${c}" onclick="filterThemes(this,'${c}')">${c}</button>`).join('')}
      <input id="theme-search" class="cyber-input" placeholder="🔍 Search..."
        style="width:160px;margin-left:auto" oninput="filterThemes(null,'',this.value)">
      <button class="cyber-btn accent-btn" onclick="toggleThemeEditor()">＋ Custom Theme</button>
    </div>
    <div id="theme-editor" style="display:none"></div>
    <div id="theme-cards-grid"></div>`
  renderThemeEditor()
  renderThemeCards('all')
}

/* ── Custom Theme Editor ── */
const _editorFields = [
  ['bg','Background'],['sidebar','Sidebar'],['card','Card'],['border','Border'],
  ['accent','Accent'],['accent2','Accent 2'],['text','Text'],['dim','Dim'],
  ['cpu','CPU'],['ram','RAM'],['gpu','GPU'],['net','NET'],
]
function renderThemeEditor() {
  const ed = document.getElementById('theme-editor')
  if (!ed) return
  const base = ThemeEngine.get(G.activeTheme) || {}
  // <input type="color"> only accepts #rrggbb — coerce rgba/short values
  const asHex = v => {
    if (/^#[0-9a-f]{6}$/i.test(v||'')) return v
    const { r, g, b } = ThemeEngine.hexToRgb(v)
    const m = /rgba?\((\d+),(\d+),(\d+)/.exec(String(v||'').replace(/\s/g,''))
    return m ? '#'+[m[1],m[2],m[3]].map(x=>(+x).toString(16).padStart(2,'0')).join('')
             : '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('')
  }
  ed.innerHTML = `
    <div class="simple-card" style="margin-bottom:10px">
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <input class="cyber-input" id="cte-name" placeholder="Theme name" style="max-width:180px">
        <input class="cyber-input" id="cte-tagline" placeholder="Tagline (optional)" style="max-width:200px">
      </div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:8px">
        ${_editorFields.map(([k,lbl])=>`
          <label style="font-size:9px;color:var(--dim);display:flex;flex-direction:column;gap:2px">${lbl}
            <input type="color" id="cte-${k}" value="${asHex(base[k]||'#888888')}"
              style="width:100%;height:26px;border:1px solid var(--border);border-radius:4px;background:var(--card);cursor:pointer">
          </label>`).join('')}
      </div>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:8px;font-size:10px;color:var(--dim)">
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="cte-glass" checked> Glass</label>
        <label style="display:flex;align-items:center;gap:4px">Blur <input type="range" id="cte-blur" min="0" max="24" value="10" style="width:70px;accent-color:var(--accent)"></label>
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="cte-anim" checked> Animations</label>
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="cte-glow" checked> Glow</label>
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="cte-scan"> Scanlines</label>
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="cte-grid"> Grid</label>
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="cte-crt"> CRT</label>
      </div>
      <div style="display:flex;gap:8px">
        <button class="cyber-btn accent-btn" onclick="saveCustomTheme(true)">👁 Preview</button>
        <button class="cyber-btn accent-btn" onclick="saveCustomTheme(false)">💾 Save &amp; Apply</button>
      </div>
    </div>`
}
window.toggleThemeEditor = function() {
  const ed = document.getElementById('theme-editor')
  if (ed) ed.style.display = ed.style.display === 'none' ? 'block' : 'none'
}
function readEditorTheme() {
  const name = gVal('cte-name').trim() || 'My Theme'
  const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
  const t = { id, name, label: name, category: 'Custom', tagline: gVal('cte-tagline').trim() }
  _editorFields.forEach(([k]) => t[k] = gVal(`cte-${k}`))
  t.danger = '#ff3333'
  t.glass = { enabled: !!document.getElementById('cte-glass')?.checked,
              blur: parseInt(gVal('cte-blur')) || 10 }
  t.anim  = { enabled: !!document.getElementById('cte-anim')?.checked }
  t.fx = [['glow','cte-glow'],['scanlines','cte-scan'],['grid','cte-grid'],['crt','cte-crt']]
    .filter(([,eid]) => document.getElementById(eid)?.checked).map(([f]) => f)
  return t
}
window.saveCustomTheme = function(previewOnly) {
  const t = readEditorTheme()
  if (previewOnly) {
    ThemeEngine.register(t)
    ThemeEngine.apply(t.id)
    toast(`Preview: ${t.name} (not saved)`)
  } else {
    window.addCustomTheme(t)
    applyTheme(t.id)
  }
}

window.filterThemes = function(btn, cat, search='') {
  if (btn) {
    document.querySelectorAll('.tf-btn').forEach(b=>b.classList.remove('active'))
    btn.classList.add('active')
  }
  renderThemeCards(cat || 'all', search)
}

function renderThemeCards(cat='all', search='') {
  const grid = document.getElementById('theme-cards-grid')
  if (!grid) return
  const filtered = G.themes.filter(t=>{
    const mc = cat==='all' || t.category===cat
    const ms = !search || t.name.toLowerCase().includes(search.toLowerCase())
    return mc && ms
  })
  grid.innerHTML = filtered.map(t=>{
    const bgAsset = resolveAsset('backgrounds', t.id)
    const thumbHtml = bgAsset
      ? `<img class="tc-thumb" src="${bgAsset.url}" alt="" loading="lazy"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        +`<div class="tc-thumb-fallback" style="display:none;background:linear-gradient(135deg,${t.bg||'#111'},${t.accent||'#888'});color:${t.accent||'#fff'}">${(t.name||'T')[0]}</div>`
      : `<div class="tc-thumb-fallback" style="background:linear-gradient(135deg,${t.bg||'#111'},${t.accent||'#888'});color:${t.accent||'#fff'}">${(t.name||'T')[0]}</div>`
    return `
    <div class="theme-card ${t.id===G.activeTheme?'active-theme':''}"
         data-tid="${t.id}" onclick="applyTheme('${t.id}')">
      <div class="tc-preview" style="background:${t.bg||'#111'};border:2px solid ${t.accent||'#fff'}">
        <span style="color:${t.accent||'#fff'};font-size:18px;font-weight:900">${(t.name||'T')[0]}</span>
      </div>
      <div class="tc-info">
        <div class="tc-name" style="color:${t.accent||'#fff'}">${esc(t.name)}</div>
        <div class="tc-sub">${esc(t.tagline||'')}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <span class="tc-cat" style="color:${t.accent||'#888'}">${esc(t.category||'')}</span>
        ${t.id===G.activeTheme?'<span style="color:var(--net)">✔ Active</span>':''}
      </div>
      ${thumbHtml}
    </div>`
  }).join('')
}

/* ── Taskbar ── */
function renderTaskbar() {
  const bar = document.getElementById('taskbar-themes')
  if (!bar) return
  bar.innerHTML = G.themes.map(t=>`
    <button class="tb-theme-btn ${t.id===G.activeTheme?'active':''}"
      data-tid="${t.id}" title="${esc(t.name)}"
      style="${t.id===G.activeTheme?`border-bottom-color:${t.accent};color:${t.accent}`:''}"
      onclick="applyTheme('${t.id}')">${esc(t.label||t.name.split(' ')[0])}</button>`).join('')
}

/* ── Terminal right-panel themes ── */
function renderTrpThemes() {
  const list = document.getElementById('trp-themes-list')
  if (!list) return
  list.innerHTML = G.themes.map(t => {
    const imgExts = ['jpg','png','webp','jpeg']
    // Try local file assets/backgrounds/<id>.<ext> first, else the online manifest bg
    const imgSrcs = imgExts.map(e => `${API}/assets/backgrounds/${t.id}.${e}`)
    const onlineBg = (themeAssets[t.id]||{}).bg
    const startSrc = onlineBg || imgSrcs[0]
    const fallbackBg = `linear-gradient(135deg,${t.bg||'#111'} 0%,${hexAdd(t.accent||'#888',0.3)} 100%)`
    return `
    <div class="trp-theme-item ${t.id===G.activeTheme?'active-theme':''}" data-tid="${t.id}"
         onclick="selectTrpTheme(this,'${t.id}')">
      <div style="flex:1;display:flex;align-items:center;gap:7px;overflow:hidden">
        <div class="trp-dot" style="background:${t.accent||'#888'};flex-shrink:0"></div>
        <div style="overflow:hidden">
          <div style="color:${t.accent||'#fff'};font-size:10px;font-weight:bold;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</div>
          <div style="color:var(--dim);font-size:8px">${esc(t.category||'')}</div>
        </div>
      </div>
      <div class="trp-thumb" style="border-color:${t.accent||'#444'}55;background:${fallbackBg}"
           id="trp-img-${t.id}">
        <img src="${startSrc}"
          style="width:100%;height:100%;object-fit:cover;border-radius:3px"
          onerror="tryNextImg(this,'${t.id}',${onlineBg?0:1},'${t.accent||'#888'}')"
          alt="">
        ${t.id===G.activeTheme?'<span class="trp-active-tick">✓</span>':''}
      </div>
    </div>`
  }).join('')
  renderTrpMusic()
}

// Try next image extension if current fails
window.tryNextImg = function(img, themeId, idx, accent) {
  const exts = ['jpg','png','webp','jpeg','gif']
  if (idx < exts.length) {
    img.src = `${API}/assets/backgrounds/${themeId}.${exts[idx]}`
    img.onerror = () => tryNextImg(img, themeId, idx+1, accent)
  } else {
    // all failed → hide img, show letter
    img.style.display = 'none'
    const wrap = document.getElementById(`trp-img-${themeId}`)
    if (wrap && !wrap.querySelector('.trp-letter')) {
      const span = document.createElement('span')
      span.className = 'trp-letter'
      span.style.cssText = `color:${accent};font-size:14px;font-weight:900;text-shadow:0 0 8px ${accent}`
      span.textContent = (themeId||'?')[0].toUpperCase()
      wrap.appendChild(span)
    }
  }
}

function hexAdd(hex, opacity) {
  try {
    const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16)
    return `rgba(${r},${g},${b},${opacity})`
  } catch { return `rgba(128,128,128,${opacity})` }
}

async function renderTrpMusic() {
  const list = document.getElementById('trp-music-list')
  if (!list) return
  if (!G.musicFiles.length) {
    try { G.musicFiles = await api('GET','/api/assets/music') } catch {}
  }
  if (!G.musicFiles.length) {
    list.innerHTML='<div style="color:var(--dim);font-size:10px;padding:10px;text-align:center">📂 assets/music/<br>هیچ فایلی نیست</div>'
    return
  }
  list.innerHTML = G.musicFiles.map((f,i)=>`
    <div class="trp-music-item ${i===G.currentTrack?'trp-music-active':''}" onclick="playFromMedia(${i})">
      <span style="color:var(--accent);font-size:12px">${i===G.currentTrack?'▶':'♪'}</span>
      <div style="flex:1;overflow:hidden">
        <div style="font-size:9px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.stem||f.name)}</div>
        <div style="font-size:8px;color:var(--dim)">${f.ext} · ${fmtBytes(f.size)}</div>
      </div>
    </div>`).join('')
}

window.selectTrpTheme = function(el, id) {
  G.selectedTrpTheme = id
  window._selectedTrpTheme = id
  document.querySelectorAll('.trp-theme-item').forEach(i=>i.classList.remove('active-theme'))
  el.classList.add('active-theme')
  // preview: update apply button accent color
  const t = G.themes.find(x=>x.id===id)
  const btn = document.getElementById('trp-apply-btn')
  if (btn && t) btn.style.borderColor = t.accent||'var(--accent)'
}

function populateSettingsTheme() {
  const sel = document.getElementById('s-theme')
  if (!sel) return
  sel.innerHTML = G.themes.map(t=>
    `<option value="${t.id}" ${t.id===G.activeTheme?'selected':''}>${esc(t.name)}</option>`).join('')
}

// ═══════════════════════════════════════════════════════════════════════════
//  TERMINAL (xterm.js + WebSocket PTY)
// ═══════════════════════════════════════════════════════════════════════════
let TERM=null, FIT=null, TWS=null

function initTerminal() {
  if (typeof Terminal === 'undefined') {
    console.error('xterm.js not loaded'); return
  }
  TERM = new Terminal({
    cursorBlink:true, fontSize:13, fontFamily:"'Courier New',monospace",
    theme:{
      background:'#030308', foreground:'#c8c8e8',
      cursor: cssVar('--accent') || '#ffff00',
      selectionBackground:'#ffffff33',
      black:'#1a1a1a',red:'#ff5555',green:'#55ff55',yellow:'#ffff55',
      blue:'#6699ff',magenta:'#ff55ff',cyan:'#55ffff',white:'#cccccc',
      brightBlack:'#888888',brightRed:'#ff8888',brightGreen:'#88ff88',
      brightYellow:'#ffff88',brightBlue:'#88aaff',brightMagenta:'#ff88ff',
      brightCyan:'#88ffff',brightWhite:'#ffffff',
    }
  })
  FIT = new FitAddon.FitAddon()
  TERM.loadAddon(FIT)
  const wrap = document.getElementById('xterm-wrap')
  if (wrap) { TERM.open(wrap); setTimeout(()=>{ try{FIT.fit()}catch{} },150) }
  connectTermWs()
  TERM.onLineFeed(()=> sTxt('sb-lines', String(TERM.buffer.active.length)))
  new ResizeObserver(()=>{
    try{FIT.fit()}catch{}
    if(TWS?.readyState===1) TWS.send(JSON.stringify({type:'resize',rows:TERM.rows,cols:TERM.cols}))
  }).observe(wrap||document.body)
  document.getElementById('btn-new-tab')?.addEventListener('click', connectTermWs)
}

function connectTermWs() {
  if (TWS) { try{TWS.close()}catch{} }
  TWS = new WebSocket(`${WS_BASE}/ws/terminal`)
  TWS.binaryType = 'arraybuffer'
  TWS.onopen  = () => {
    TERM?.focus()
    TWS.send(JSON.stringify({type:'resize',rows:TERM?.rows||40,cols:TERM?.cols||140}))
    setRunning(true)
  }
  TWS.onmessage = e => TERM?.write(new Uint8Array(e.data))
  TWS.onclose   = () => { setRunning(false); setTimeout(connectTermWs, 3000) }
  TWS.onerror   = () => TWS.close()
  if (TERM) TERM.onData(d => { if(TWS?.readyState===1) TWS.send(new TextEncoder().encode(d)) })
}

function setRunning(on) {
  const b = document.querySelector('.running-badge')
  if (b) { b.textContent=on?'● RUNNING':'○ STOPPED'; b.style.color=on?'var(--net)':'var(--danger)' }
}

function initTrpTabs() {
  document.querySelectorAll('.trp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.trp-tab').forEach(t=>t.classList.remove('active'))
      tab.classList.add('active')
      document.querySelectorAll('.trp-panel').forEach(p=>p.classList.remove('active'))
      document.getElementById(`trpp-${tab.dataset.trp}`)?.classList.add('active')
    })
  })
  // Apply button in right panel
  document.getElementById('trp-apply-btn')?.addEventListener('click', ()=>{
    const id = G.selectedTrpTheme || G.activeTheme
    applyTheme(id)
    // flash feedback
    const btn = document.getElementById('trp-apply-btn')
    if(btn){ btn.textContent='✔ Applied!'; setTimeout(()=>btn.textContent='🎨 Apply Theme',1500) }
  })
}

// ── exposed to HTML onclick ──────────────────────────────────────────────
window.termClear = function() {
  TERM?.clear()
  if(TWS?.readyState===1) TWS.send(new TextEncoder().encode('clear\n'))
}
window.termStop = function() {
  if(TWS?.readyState===1) TWS.send(new TextEncoder().encode('\x03'))
}

// ═══════════════════════════════════════════════════════════════════════════
//  MUSIC PLAYER — full implementation lives in music-player.js (window.Music)
// ═══════════════════════════════════════════════════════��═══════════════════
function initMusic() {
  Music.init(G.audio)
}

// ═══════════════════════════════════════════════════════════════════════════
//  NETWORK CENTER — Speed Test, Ping, DNS, Whois, Port Scan, Traceroute,
//  Active Connections, Interfaces, WiFi, Diagnostics
// ════════════════════════════════════════════════════════════════════════════

/* tab switch */
window.ncTab = function(btn, name) {
  document.querySelectorAll('.nc-tab').forEach(t => t.classList.remove('active'))
  btn.classList.add('active')
  document.querySelectorAll('.nc-panel').forEach(p => p.classList.remove('active'))
  document.getElementById(`ncp-${name}`)?.classList.add('active')
  G.ncActive = name
  // lazy-load the read-only views the first time they're opened
  if (name === 'interfaces'  && !G.ncLoaded.interfaces)  { G.ncLoaded.interfaces = true;  ncInterfaces() }
  if (name === 'connections' && !G.ncLoaded.connections) { G.ncLoaded.connections = true; ncConnections() }
}

/* small helpers */
function ncSet(id, html){ const el=document.getElementById(id); if(el) el.innerHTML=html }
function ncSpin(id, msg='Working…'){ ncSet(id, `<div class="nc-spin">⋯ ${esc(msg)}</div>`) }
function ncErr(id, msg){ ncSet(id, `<div class="nc-error">✕ ${esc(msg)}</div>`) }
function ncBusy(id, on){ const b=document.getElementById(id); if(b){ b.disabled=on; b.style.opacity=on?'.5':'1' } }
function sigColor(pct){ return pct>=66?'var(--net)':pct>=33?'var(--accent)':'var(--danger)' }

/* ── SPEED TEST ── */
window.ncSpeedtest = async function() {
  ncBusy('nc-speed-btn', true)
  document.querySelectorAll('#nc-speed-dials .nc-dial').forEach(d=>d.classList.add('busy'))
  sTxt('sp-down','…'); sTxt('sp-up','…'); sTxt('sp-ping','…'); sTxt('sp-jit','…')
  ncSet('nc-speed-meta','<span>Measuring against Cloudflare — this takes ~15–30s…</span>')
  try {
    const r = await api('POST','/api/net/speedtest',{})
    sTxt('sp-down', r.download_mbps!=null ? r.download_mbps.toFixed(1) : '—')
    sTxt('sp-up',   r.upload_mbps  !=null ? r.upload_mbps.toFixed(1)  : '—')
    sTxt('sp-ping', r.ping_ms      !=null ? r.ping_ms.toFixed(0)      : '—')
    sTxt('sp-jit',  r.jitter_ms    !=null ? r.jitter_ms.toFixed(1)    : '—')
    const meta = []
    if (r.server)    meta.push(`Server: <b>${esc(r.server)}</b>`)
    if (r.client_ip) meta.push(`Client IP: <b>${esc(r.client_ip)}</b>`)
    if (r.bytes_down)meta.push(`↓ <b>${fmtBytes(r.bytes_down)}</b>`)
    if (r.bytes_up)  meta.push(`↑ <b>${fmtBytes(r.bytes_up)}</b>`)
    if (r.error)     meta.push(`<span style="color:var(--danger)">${esc(r.error)}</span>`)
    ncSet('nc-speed-meta', meta.join('') || 'Done.')
  } catch(e){ ncSet('nc-speed-meta', `<span style="color:var(--danger)">Error: ${esc(e.message)}</span>`) }
  finally {
    ncBusy('nc-speed-btn', false)
    document.querySelectorAll('#nc-speed-dials .nc-dial').forEach(d=>d.classList.remove('busy'))
  }
}

/* ── PING ── */
window.ncPing = async function() {
  const host = gVal('nc-ping-host')||'8.8.8.8', count = gVal('nc-ping-count')||'4'
  ncBusy('nc-ping-btn', true); ncSpin('nc-ping-result', `pinging ${host}…`)
  try {
    const r = await api('POST','/api/net/ping',{host, count:parseInt(count)})
    const s = r.stats||{}
    if (!s.transmitted) { ncErr('nc-ping-result', r.output||'no reply'); return }
    const lossCls = s.loss_pct===0?'nc-ok':s.loss_pct<100?'nc-warn':'nc-bad'
    let html = `
      <div class="nc-meta">
        <span>Target: <b>${esc(s.host)}</b>${s.resolved_ip&&s.resolved_ip!==s.host?` (<b>${esc(s.resolved_ip)}</b>)`:''}</span>
        <span>Sent <b>${s.transmitted}</b> · Recv <b>${s.received}</b> · <span class="nc-tag ${lossCls}">${s.loss_pct}% loss</span></span>
      </div>
      <div class="nc-dials" style="grid-template-columns:repeat(4,1fr)">
        <div class="nc-dial"><div class="nc-dial-lbl">MIN</div><div class="nc-dial-val net-col" style="font-size:24px">${s.min??'—'}</div><div class="nc-dial-unit">ms</div></div>
        <div class="nc-dial"><div class="nc-dial-lbl">AVG</div><div class="nc-dial-val accent" style="font-size:24px">${s.avg??'—'}</div><div class="nc-dial-unit">ms</div></div>
        <div class="nc-dial"><div class="nc-dial-lbl">MAX</div><div class="nc-dial-val accent2" style="font-size:24px">${s.max??'—'}</div><div class="nc-dial-unit">ms</div></div>
        <div class="nc-dial"><div class="nc-dial-lbl">MDEV</div><div class="nc-dial-val" style="font-size:24px">${s.mdev??'—'}</div><div class="nc-dial-unit">ms</div></div>
      </div>`
    if (s.rtts && s.rtts.length) {
      html += `<div class="nc-scroll"><table class="nc-table"><thead><tr><th>#</th><th>RTT (ms)</th><th></th></tr></thead><tbody>`
      const mx = Math.max(...s.rtts)
      html += s.rtts.map((t,i)=>`<tr><td>${i+1}</td><td class="nc-mono">${t}</td><td style="width:50%"><div class="nc-sig-wrap" style="width:100%"><div class="nc-sig" style="width:${mx?(t/mx*100):0}%;background:var(--accent)"></div></div></td></tr>`).join('')
      html += `</tbody></table></div>`
    }
    ncSet('nc-ping-result', html)
  } catch(e){ ncErr('nc-ping-result', e.message) }
  finally { ncBusy('nc-ping-btn', false) }
}

/* ── DNS ── */
window.ncDns = async function() {
  const domain = gVal('nc-dns-host')||'github.com'
  ncBusy('nc-dns-btn', true); ncSpin('nc-dns-result', `resolving ${domain}…`)
  try {
    const r = await api('POST','/api/net/dns',{domain})
    if (!r.ok) { ncErr('nc-dns-result', r.error||'no records found'); return }
    const rec = r.records||{}
    let html = `<div class="nc-meta"><span>Domain: <b>${esc(r.domain)}</b></span><span>Tool: <b>${esc(r.tool)}</b></span>${r.reverse?`<span>PTR: <b>${esc(r.reverse)}</b></span>`:''}</div>`
    html += `<div class="nc-scroll"><table class="nc-table"><thead><tr><th style="width:80px">TYPE</th><th>RECORD</th></tr></thead><tbody>`
    Object.keys(rec).forEach(type=>{
      rec[type].forEach(v=>{ html += `<tr><td><span class="nc-tag nc-warn">${esc(type)}</span></td><td class="nc-mono">${esc(v)}</td></tr>` })
    })
    html += `</tbody></table></div>`
    ncSet('nc-dns-result', html)
  } catch(e){ ncErr('nc-dns-result', e.message) }
  finally { ncBusy('nc-dns-btn', false) }
}

/* ── WHOIS ── */
window.ncWhois = async function() {
  const query = gVal('nc-whois-q')||'github.com'
  ncBusy('nc-whois-btn', true); ncSpin('nc-whois-result', `querying whois for ${query}…`)
  try {
    const r = await api('POST','/api/net/whois',{query})
    if (!r.ok) { ncErr('nc-whois-result', r.error||'no whois data'); return }
    const f = r.fields||{}
    let html = ''
    if (Object.keys(f).length) {
      html += `<div class="nc-card" style="margin-bottom:10px"><div class="nc-card-hd">📄 ${esc(r.query)}<span class="nc-sub">${esc((r.servers||[]).join(' → '))}</span></div>`
      html += Object.entries(f).map(([k,v])=>`<div class="nc-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')
      html += `</div>`
    }
    html += `<details><summary style="cursor:pointer;color:var(--dim);font-size:11px">▸ Raw WHOIS response</summary><div class="nc-raw">${esc(r.raw||'')}</div></details>`
    ncSet('nc-whois-result', html)
  } catch(e){ ncErr('nc-whois-result', e.message) }
  finally { ncBusy('nc-whois-btn', false) }
}

/* ── PORT SCANNER ── */
window.ncPortscan = async function() {
  const host = gVal('nc-scan-host')||'127.0.0.1', ports = gVal('nc-scan-ports').trim()
  ncBusy('nc-scan-btn', true); ncSpin('nc-scan-result', `scanning ${host}…`)
  try {
    const r = await api('POST','/api/net/portscan',{host, ports})
    if (!r.ok) { ncErr('nc-scan-result', r.error||'scan failed'); return }
    let html = `<div class="nc-meta">
        <span>Host: <b>${esc(r.host)}</b> (<b>${esc(r.resolved_ip)}</b>)</span>
        <span>Scanned <b>${r.scanned}</b> · <span class="nc-tag nc-ok">${r.open.length} open</span> · <span class="nc-tag nc-bad">${r.closed_count} closed</span></span>
        <span>${r.elapsed_s}s</span></div>`
    if (!r.open.length) { html += `<div class="nc-empty">No open ports found.</div>` }
    else {
      html += `<div class="nc-scroll"><table class="nc-table"><thead><tr><th style="width:80px">PORT</th><th style="width:120px">SERVICE</th><th>BANNER</th></tr></thead><tbody>`
      html += r.open.sort((a,b)=>a.port-b.port).map(p=>`<tr><td class="nc-mono"><span class="nc-tag nc-ok">${p.port}</span></td><td>${esc(p.service||'—')}</td><td class="nc-mono" style="color:var(--dim)">${esc(p.banner||'')}</td></tr>`).join('')
      html += `</tbody></table></div>`
    }
    ncSet('nc-scan-result', html)
  } catch(e){ ncErr('nc-scan-result', e.message) }
  finally { ncBusy('nc-scan-btn', false) }
}

/* ── TRACEROUTE ── */
window.ncTraceroute = async function() {
  const host = gVal('nc-trace-host')||'1.1.1.1', max = gVal('nc-trace-max')||'20'
  ncBusy('nc-trace-btn', true); ncSpin('nc-trace-result', `tracing route to ${host}…`)
  try {
    const r = await api('POST','/api/net/traceroute',{host, max_hops:parseInt(max)})
    if (!r.ok) { ncErr('nc-trace-result', r.error||'trace failed'); return }
    let html = `<div class="nc-meta"><span>Target: <b>${esc(r.host)}</b> (<b>${esc(r.target_ip)}</b>)</span><span>Hops: <b>${r.hops.length}</b></span><span>Tool: <b>${esc(r.tool)}</b></span></div>`
    html += `<div class="nc-scroll"><table class="nc-table"><thead><tr><th style="width:50px">HOP</th><th>ADDRESS</th><th style="width:120px">RTT</th></tr></thead><tbody>`
    html += r.hops.map(h=>{
      const addr = h.ip ? esc(h.ip) : '<span style="color:var(--dim)">* no reply</span>'
      const rtt  = h.rtt_ms!=null ? `${h.rtt_ms} ms` : '—'
      const fin  = h.final ? ' <span class="nc-tag nc-ok">target</span>' : ''
      return `<tr><td class="nc-mono">${h.ttl}</td><td class="nc-mono">${addr}${fin}</td><td class="nc-mono">${rtt}</td></tr>`
    }).join('')
    html += `</tbody></table></div>`
    ncSet('nc-trace-result', html)
  } catch(e){ ncErr('nc-trace-result', e.message) }
  finally { ncBusy('nc-trace-btn', false) }
}

/* ── ACTIVE CONNECTIONS ── */
window.ncConnections = async function() {
  ncBusy('nc-conn-btn', true)
  const el = document.getElementById('nc-conn-result')
  if (el && !el.innerHTML) ncSpin('nc-conn-result','reading sockets…')
  try {
    const r = await api('GET','/api/net/connections')
    if (!r.ok) { ncErr('nc-conn-result', r.error||'failed'); return }
    const c = r.counts||{}
    ncSet('nc-conn-summary', `<span>Total: <b>${r.total}</b></span>` +
      Object.entries(c).map(([k,v])=>`<span>${esc(k)}: <b>${v}</b></span>`).join(''))
    let html = `<div class="nc-scroll"><table class="nc-table"><thead><tr><th style="width:60px">PROTO</th><th>LOCAL</th><th>REMOTE</th><th style="width:110px">STATE</th><th>PROCESS</th></tr></thead><tbody>`
    html += r.connections.map(x=>{
      const stCls = x.status==='ESTABLISHED'?'nc-ok':x.status==='LISTEN'?'nc-warn':''
      return `<tr><td class="nc-mono">${esc(x.proto)}</td><td class="nc-mono">${esc(x.local||'—')}</td><td class="nc-mono">${esc(x.remote||'—')}</td><td><span class="nc-tag ${stCls}">${esc(x.status)}</span></td><td>${esc(x.process||'')}${x.pid?` <span style="color:var(--dim)">(${x.pid})</span>`:''}</td></tr>`
    }).join('')
    html += `</tbody></table></div>`
    ncSet('nc-conn-result', html)
  } catch(e){ ncErr('nc-conn-result', e.message) }
  finally { ncBusy('nc-conn-btn', false) }
}
window.ncConnAuto = function() {
  const on = document.getElementById('nc-conn-auto')?.checked
  clearInterval(G.ncConnTimer)
  if (on) { ncConnections(); G.ncConnTimer = setInterval(()=>{ if(G.activePage==='network'&&G.ncActive==='connections') ncConnections() }, 3000) }
}

/* ── INTERFACES ── */
window.ncInterfaces = async function() {
  ncBusy('nc-if-btn', true)
  const el = document.getElementById('nc-if-result')
  if (el && !el.innerHTML) ncSpin('nc-if-result','reading interfaces…')
  try {
    const r = await api('GET','/api/net/interfaces')
    if (!r.ok) { ncErr('nc-if-result', r.error||'failed'); return }
    let head = `<div class="nc-meta"><span>Host: <b>${esc(r.hostname)}</b></span><span>Gateway: <b>${esc(r.gateway||'—')}</b></span><span>Default: <b>${esc(r.default_iface||'—')}</b></span><span>DNS: <b>${esc((r.dns||[]).join(', ')||'—')}</b></span></div>`
    const cards = r.interfaces.map(i=>{
      const up = i.is_up ? '<span class="nc-tag nc-ok">UP</span>' : '<span class="nc-tag nc-bad">DOWN</span>'
      const def = i.is_default ? ' <span class="nc-tag nc-warn">default</span>' : ''
      const rows = []
      if (i.ipv4.length) rows.push(['IPv4', i.ipv4.join(', ')])
      if (i.netmask)     rows.push(['Netmask', i.netmask])
      if (i.ipv6.length) rows.push(['IPv6', i.ipv6.join('<br>')])
      if (i.mac)         rows.push(['MAC', i.mac])
      if (i.speed_mbps)  rows.push(['Link speed', `${i.speed_mbps} Mbps`])
      rows.push(['MTU', i.mtu])
      rows.push(['Traffic', `↓ ${fmtBytes(i.bytes_recv)} · ↑ ${fmtBytes(i.bytes_sent)}`])
      rows.push(['Packets', `↓ ${i.packets_recv.toLocaleString()} · ↑ ${i.packets_sent.toLocaleString()}`])
      if (i.errin||i.errout||i.dropin||i.dropout)
        rows.push(['Errors / Drops', `err ${i.errin+i.errout} · drop ${i.dropin+i.dropout}`])
      return `<div class="nc-card"><div class="nc-card-hd">🧩 ${esc(i.name)}${def}<span class="nc-sub">${up}</span></div>${
        rows.map(([k,v])=>`<div class="nc-row"><span class="k">${k}</span><span class="v nc-mono">${v}</span></div>`).join('')}</div>`
    }).join('')
    ncSet('nc-if-result', head + `<div class="nc-cards">${cards}</div>`)
  } catch(e){ ncErr('nc-if-result', e.message) }
  finally { ncBusy('nc-if-btn', false) }
}

/* ── WIFI ── */
window.ncWifi = async function() {
  ncBusy('nc-wifi-btn', true); ncSpin('nc-wifi-result','scanning for access points…')
  try {
    const r = await api('GET','/api/net/wifi')
    if (!r.networks || !r.networks.length) { ncErr('nc-wifi-result', r.error||'no networks found'); return }
    let html = `<div class="nc-meta"><span>Found <b>${r.networks.length}</b> networks</span><span>Tool: <b>${esc(r.tool)}</b></span></div>`
    html += `<div class="nc-scroll"><table class="nc-table"><thead><tr><th></th><th>SSID</th><th style="width:150px">SIGNAL</th><th style="width:80px">BAND</th><th style="width:60px">CHAN</th><th style="width:120px">SECURITY</th><th>BSSID</th></tr></thead><tbody>`
    html += r.networks.map(n=>{
      const star = n.in_use ? '<span class="nc-tag nc-ok">▶</span>' : ''
      const sig = n.signal||0
      return `<tr><td>${star}</td><td><b>${esc(n.ssid)}</b></td>
        <td><div class="nc-sig-wrap"><div class="nc-sig" style="width:${sig}%;background:${sigColor(sig)}"></div></div> <span class="nc-mono" style="font-size:10px">${sig}%</span></td>
        <td>${esc(n.band||'')}</td><td class="nc-mono">${esc(String(n.channel||''))}</td>
        <td>${esc(n.security||'Open')}</td><td class="nc-mono" style="color:var(--dim)">${esc(n.bssid||'')}</td></tr>`
    }).join('')
    html += `</tbody></table></div>`
    ncSet('nc-wifi-result', html)
  } catch(e){ ncErr('nc-wifi-result', e.message) }
  finally { ncBusy('nc-wifi-btn', false) }
}

/* ── DIAGNOSTICS ── */
window.ncDiagnostics = async function() {
  ncBusy('nc-diag-btn', true); ncSet('nc-diag-verdict',''); ncSpin('nc-diag-result','running checks…')
  try {
    const r = await api('POST','/api/net/diagnostics',{})
    const vIcon = {healthy:'✅',degraded:'⚠',problem:'⛔'}[r.verdict]||'•'
    ncSet('nc-diag-verdict', `<div class="nc-verdict ${r.verdict}">${vIcon} Network ${r.verdict.toUpperCase()} — ${r.passed}/${r.total} checks passed</div>`)
    let html = `<div class="nc-scroll"><table class="nc-table"><thead><tr><th style="width:40px"></th><th>CHECK</th><th>TARGET</th><th>RESULT</th></tr></thead><tbody>`
    html += r.checks.map(c=>`<tr><td>${c.ok?'<span class="nc-tag nc-ok">OK</span>':'<span class="nc-tag nc-bad">✕</span>'}</td><td>${esc(c.name)}</td><td class="nc-mono" style="color:var(--dim)">${esc(c.target)}</td><td class="nc-mono">${esc(c.detail)}</td></tr>`).join('')
    html += `</tbody></table></div>`
    ncSet('nc-diag-result', html)
  } catch(e){ ncErr('nc-diag-result', e.message) }
  finally { ncBusy('nc-diag-btn', false) }
}


/* ── VPN STATUS ── */
window.ncVPNStatus = async function() {
  ncBusy('nc-vpn-btn', true)

  try {
    const r = await api('GET','/api/net/vpn-status')

    let html = `
    <div class="nc-scroll">
    <table class="nc-table">
    <tbody>

    <tr>
      <td>Status</td>
      <td>
        ${
          r.proxy && r.proxy.active
          ? '<span class="nc-tag nc-ok">ACTIVE</span>'
          : '<span class="nc-tag nc-bad">OFF</span>'
        }
      </td>
    </tr>

    <tr>
      <td>Public IP</td>
      <td class="nc-mono">${esc(r.public_ip || 'unknown')}</td>
    </tr>

    <tr>
      <td>IPv6</td>
      <td>${r.ipv6 ? '✅ enabled' : '❌ disabled'}</td>
    </tr>

    <tr>
      <td>Cloudflare</td>
      <td>${r.cloudflare_like ? '☁️ detected' : '—'}</td>
    </tr>

    </tbody>
    </table>
    </div>
    `

    ncSet('nc-vpn-result', html)

  } catch(e) {
    ncErr('nc-vpn-result', e.message)
  }
  finally {
    ncBusy('nc-vpn-btn', false)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC IP (used by dashboard/init)
// ═══════════════════════════════════════════════════════════════════════════
window.refreshIP = async function() {
  try {
    const r = await api('GET','/api/network/publicip')
    // net-myip element was part of the old page; guard in case it's absent
    sTxt('net-myip', r.ip || '—')
  } catch { sTxt('net-myip','—') }
}


// ═══════════════════════════════════════════════════════════════════════════
//  VPN
// ═══════════════════════════════════════════════════════════════════════════
function initVpnTabs() {
  document.querySelectorAll('.ptab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'))
      tab.classList.add('active')
      document.querySelectorAll('.vform').forEach(f=>f.classList.toggle('active',f.dataset.form===tab.dataset.proto))
    })
  })
  vpnRefreshStatus()
}

// Called when the VPN page is opened — start the live poll loop
function vpnEnter() {
  loadVpnProfiles()
  vpnRefreshStatus()
  vpnRefreshKS()
  vpnRefreshAC()
  vpnRefreshIP(false)
  if (G.vpnPollTimer) clearInterval(G.vpnPollTimer)
  G.vpnPollTimer = setInterval(()=>{
    if (G.activePage !== 'vpn') { clearInterval(G.vpnPollTimer); G.vpnPollTimer=null; return }
    vpnRefreshStatus()
    vpnRefreshTraffic()
  }, 1000)
}

// ── live status / telemetry ────────────────────────────────────────────────
async function vpnRefreshStatus() {
  try {
    const s = await api('GET','/api/vpn/status')
    setVpnStatus(!!s.connected, s.name||'')
    sTxt('vpn-time-val', fmtDuration(s.duration||0))
    // kill-switch trip indicator
    const ksState=document.getElementById('vpn-ks-state')
    if (ksState) {
      if (s.killswitch_tripped) { ksState.textContent='TRIPPED'; ksState.style.color='var(--danger)' }
      else if (s.killswitch)    { ksState.textContent='armed';   ksState.style.color='var(--net)' }
      else                      { ksState.textContent='off';     ksState.style.color='var(--dim)' }
    }
    const ks=document.getElementById('vpn-ks'); if(ks) ks.checked=!!s.killswitch
    if (!s.connected) { sTxt('vpn-time-val','00:00:00') }
  } catch {}
}

async function vpnRefreshTraffic() {
  if (!G.vpnConnected) {
    sTxt('vpn-dn-val','▼ 0 B/s'); sTxt('vpn-up-val','▲ 0 B/s')
    return
  }
  try {
    const t = await api('GET','/api/vpn/traffic')
    sTxt('vpn-dn-val', `▼ ${fmtBytes(t.rx_rate||0)}/s`)
    sTxt('vpn-up-val', `▲ ${fmtBytes(t.tx_rate||0)}/s`)
    sTxt('vpn-dn-tot', fmtBytes(t.rx||0))
    sTxt('vpn-up-tot', fmtBytes(t.tx||0))
  } catch {}
}

async function vpnRefreshIP(force) {
  try {
    const r = await api('GET',`/api/vpn/ip${force?'?force=true':''}`)
    const ip = r.ip || '—'
    sTxt('vpn-ip-val', ip)
    sTxt('vpn-big-ip', `IP: ${ip}`)
  } catch { sTxt('vpn-ip-val','—') }
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec))
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60
  const p=n=>String(n).padStart(2,'0')
  return `${p(h)}:${p(m)}:${p(s)}`
}

// ── import OpenVPN / WireGuard ─────────────────────────────────────────────
window.vpnImport = async function() {
  const path = gVal('vpn-import-path').trim()
  if (!path) { vpnLog('Enter a config file path first.', true); return }
  vpnLog(`Importing ${path} ...`)
  try {
    const r = await api('POST','/api/vpn/import',{path})
    if (r.ok) {
      const pname = r.profile?.name || r.name || 'profile'
      vpnLog(`Imported "${pname}" (${r.protocol}) ✓`)
      const inp=document.getElementById('vpn-import-path'); if(inp) inp.value=''
      loadVpnProfiles()
    } else {
      vpnLog(`Import failed: ${r.error||'unknown error'}`, true)
    }
  } catch(e){ vpnLog(`Import failed: ${e.message}`, true) }
}

// ── kill switch ────────────────────────────────────────────────────────────
async function vpnRefreshKS() {
  try {
    const r = await api('GET','/api/vpn/killswitch')
    G.vpnKS = !!r.armed
    const ks=document.getElementById('vpn-ks'); if(ks) ks.checked=G.vpnKS
    const st=document.getElementById('vpn-ks-state')
    if(st && !r.tripped){ st.textContent=G.vpnKS?'armed':'off'; st.style.color=G.vpnKS?'var(--net)':'var(--dim)' }
  } catch {}
}
window.vpnKillSwitch = async function() {
  const ks=document.getElementById('vpn-ks'); const enable=!!ks?.checked
  try {
    const r = await api('POST','/api/vpn/killswitch',{enable})
    if (r.ok || r.armed!==undefined) {
      G.vpnKS=enable
      vpnLog(`Kill Switch ${enable?'armed':'disarmed'} ✓`)
    } else {
      if(ks) ks.checked=!enable
      vpnLog(`Kill Switch error: ${r.error||'failed'}`, true)
    }
    vpnRefreshKS()
  } catch(e){ if(ks) ks.checked=!enable; vpnLog(`Kill Switch error: ${e.message}`, true) }
}

// ── auto connect ───────────────────────────────────────────────────────────
async function vpnRefreshAC() {
  try {
    const r = await api('GET','/api/vpn/autoconnect')
    G.vpnACProfile = r.profile_id || null
    G.vpnAC = !!r.enabled
    const ac=document.getElementById('vpn-ac'); if(ac) ac.checked=G.vpnAC
    const st=document.getElementById('vpn-ac-state')
    if(st){ st.textContent=G.vpnAC?'on':'off'; st.style.color=G.vpnAC?'var(--net)':'var(--dim)' }
  } catch {}
}
window.vpnAutoConnect = async function() {
  const ac=document.getElementById('vpn-ac'); const enable=!!ac?.checked
  // enabling requires a target profile — use the selected/first nmcli profile
  let pid = G.vpnACProfile
  if (enable && !pid) {
    try {
      const profs = await api('GET','/api/vpn/profiles')
      const nm = profs.find(p=>p.nm_conn||p.nm_uuid) || profs[0]
      pid = nm?.id
    } catch {}
  }
  if (enable && !pid) {
    if(ac) ac.checked=false
    vpnLog('Auto Connect needs an imported OpenVPN/WireGuard profile first.', true)
    return
  }
  try {
    const r = await api('POST','/api/vpn/autoconnect',{profile_id:pid, enable})
    if (r.ok || r.enabled!==undefined) { vpnLog(`Auto Connect ${enable?'enabled':'disabled'} ✓`) }
    else { if(ac) ac.checked=!enable; vpnLog(`Auto Connect error: ${r.error||'failed'}`, true) }
    vpnRefreshAC()
  } catch(e){ if(ac) ac.checked=!enable; vpnLog(`Auto Connect error: ${e.message}`, true) }
}

window.vpnToggle = async function() {
  if (G.vpnConnected) {
    try { await api('POST','/api/vpn/disconnect',{}); setVpnStatus(false); vpnLog('Disconnected.'); vpnRefreshIP(true) }
    catch(e){ vpnLog(`Error: ${e.message}`,true) }
  } else {
    const proto = document.querySelector('.ptab.active')?.dataset.proto||'vless'
    const prof  = buildVpnProfile(proto)
    vpnLog(`Connecting via ${proto}...`)
    try {
      const saved = await api('POST','/api/vpn/profiles',{...prof,name:`Auto-${proto}`})
      const r     = await api('POST','/api/vpn/connect',{profile_id:saved.id})
      if (r.ok) { setVpnStatus(true,proto); vpnLog('Connected ✓'); vpnRefreshIP(true) }
      else       { vpnLog(`Error: ${r.error}`,true) }
    } catch(e){ vpnLog(`Error: ${e.message}`,true) }
  }
}
window.vpnSave = async function() {
  const proto = document.querySelector('.ptab.active')?.dataset.proto||'vless'
  const name  = prompt('Profile name:',proto)||proto
  try {
    await api('POST','/api/vpn/profiles',{...buildVpnProfile(proto),name})
    loadVpnProfiles(); vpnLog(`Saved: "${name}" ✓`)
  } catch(e){ vpnLog(`Error: ${e.message}`,true) }
}

function buildVpnProfile(proto) {
  const p={protocol:proto}
  if(proto==='vless'){p.server=gVal('vless-server');p.port=gVal('vless-port');p.uuid=gVal('vless-uuid');p.network=gVal('vless-net');p.security=gVal('vless-sec');p.path=gVal('vless-path');p.sni=gVal('vless-sni')}
  else if(proto==='shadowsocks'){p.server=gVal('ss-server');p.port=gVal('ss-port');p.password=gVal('ss-pass');p.method=gVal('ss-method');p.local_port=gVal('ss-local')}
  else if(proto==='trojan'){p.server=gVal('tj-server');p.port=gVal('tj-port');p.password=gVal('tj-pass');p.sni=gVal('tj-sni')}
  else if(proto==='openvpn'){p.config_file=gVal('ovpn-file')}
  else if(proto==='wireguard'){p.config_file=gVal('wg-file')}
  return p
}

function setVpnStatus(on, name='') {
  G.vpnConnected=on; G.vpnName=name
  const col=on?'var(--net)':'var(--danger)', txt=on?'CONNECTED':'DISCONNECTED'
  const dot=document.getElementById('vpn-big-dot'); if(dot) dot.style.color=col
  const st=document.getElementById('vpn-big-status'); if(st){st.textContent=txt;st.style.color=col}
  const btn=document.getElementById('vpn-toggle'); if(btn) btn.textContent=on?'✖ Disconnect':'⚡ Connect'
  const sl=document.getElementById('vpn-status-lbl'); if(sl){sl.textContent=on?'VPN ON':'VPN OFF';sl.style.color=col}
  sTxt('vpn-name-lbl',name||'—')
  sTxt('vpn-card-status',`VPN: ${on?`ON — ${name}`:'OFF'}`)
}

function vpnLog(msg, err=false) {
  const log=document.getElementById('vpn-log'); if(!log) return
  const d=document.createElement('div'); d.style.color=err?'var(--danger)':'var(--net)'
  d.textContent=`[${new Date().toLocaleTimeString()}] ${msg}`
  log.appendChild(d); log.scrollTop=log.scrollHeight
}

async function loadVpnProfiles() {
  try {
    const profs=await api('GET','/api/vpn/profiles')
    const el=document.getElementById('vpn-profiles'); if(!el) return
    el.innerHTML=profs.length?profs.map(p=>`
      <div class="vpn-profile-item">
        <span class="vpc-name">${esc(p.name||'—')}</span>
        <span class="vpc-proto" style="color:var(--accent)">${esc(p.protocol||'—')}</span>
        <button class="cyber-btn" onclick="connectProfile('${p.id}')">▶</button>
        <button class="cyber-btn" style="color:var(--danger)" onclick="deleteProfile('${p.id}')">✕</button>
      </div>`).join('')
      :'<div style="color:var(--dim);font-size:11px;padding:8px">No saved profiles</div>'
  } catch {}
}

window.connectProfile = async function(id) {
  vpnLog('Connecting...')
  try {
    const r=await api('POST','/api/vpn/connect',{profile_id:id})
    if(r.ok){ setVpnStatus(true,r.name||'Profile'); vpnLog('Connected ✓'); vpnRefreshIP(true) }
    else    { vpnLog(`Error: ${r.error}`,true) }
  } catch(e){ vpnLog(`Error: ${e.message}`,true) }
}
window.deleteProfile = async function(id) {
  if(!confirm('Delete this profile?')) return
  await api('DELETE',`/api/vpn/profiles/${id}`).catch(()=>{}); loadVpnProfiles()
}

// ═══════════════════════════════════════════════════════════════════════════
//  RIGHT RAIL — active connections + VPN status
// ═══════════════════════════════════════════════════════════════════════════
async function railConnRefresh() {
  const list = document.getElementById('rail-conn-list')
  if (!list) return
  try {
    const r = await api('GET','/api/net/connections')
    if (!r.ok) throw new Error(r.error||'')
    const est = r.connections.filter(c => c.status==='ESTABLISHED' && c.remote)
    sTxt('rail-conn-count', String(est.length))
    const shown = est.slice(0, 4)
    list.innerHTML = shown.length ? shown.map(c => {
      const ip = (c.remote||'').split(':')[0]
      return `<div class="rail-conn-item">
        <span style="color:var(--accent)">◉</span>
        <b>${esc(ip)}</b>
        <span class="rc-st">ESTABLISHED</span>
        <span class="rc-name">${esc(c.process||'')}</span>
      </div>`
    }).join('') : '<div class="rail-empty">no active connections</div>'
    sTxt('rail-conn-more', est.length > 4 ? `+${est.length-4} more connections` : '')
  } catch { list.innerHTML = '<div class="rail-empty">—</div>' }
}

async function railVpnRefresh() {
  try {
    const s = await api('GET','/api/vpn/status')
    const on = !!s.connected
    const st = document.getElementById('rail-vpn-state')
    if (st) { st.textContent = on ? `Connected — ${s.name||''}` : 'Not Connected'
              st.style.color = on ? 'var(--net)' : 'var(--danger)' }
    const btn = document.getElementById('rail-vpn-btn')
    if (btn) btn.textContent = on ? 'DISCONNECT' : 'CONNECT'
  } catch {}
  try {
    const r = await api('GET','/api/vpn/ip')
    sTxt('rail-vpn-ip', r.ip || '—')
    if (r.location || r.country) sTxt('rail-vpn-loc', r.location || r.country)
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
//  AI CENTER  — provider registry, streaming chat, conversations, tools
// ═══════════════════════════════════════════════════════════════════════════
G.aiProviders = []          // [{id,name,models,...}] from /api/ai/providers
G.aiCur = {                 // active chat session state
  id: null, provider: 'ollama', model: '', messages: [],
}
G.aiStream = null           // active WebSocket for streaming
G.aiStopFlag = false

function initAiCenter() {
  aiLoadProviders()
  aiLoadChats()
  // tab switch is wired via onclick; chat send wired in HTML keydown
}

async function aiLoadProviders() {
  try {
    G.aiProviders = await api('GET', '/api/ai/providers')
  } catch { G.aiProviders = [{id:'ollama',name:'Ollama',models:['llama3'],needs_key:false}] }
  const sel = document.getElementById('ai-provider')
  if (sel) {
    sel.innerHTML = G.aiProviders.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')
    // pick default from prefs (loaded from /prompts below) — fallback ollama
    let initial = null
    try { initial = (await api('GET','/api/ai/prompts')).default_provider } catch {}
    sel.value = initial || 'ollama'
  }
  await aiRefreshModels()
  await aiLoadPrefsAndKey()
}

async function aiRefreshModels() {
  const pid = gVal('ai-provider')
  const prov = G.aiProviders.find(p => p.id === pid)
  const sel = document.getElementById('ai-model')
  if (!sel || !prov) return
  sel.innerHTML = (prov.models.length ? prov.models : [prov.default_model])
    .map(m => `<option value="${m}">${esc(m)}</option>`).join('')
  // keep current model if present in the list
  if (G.aiCur.model && prov.models.includes(G.aiCur.model)) sel.value = G.aiCur.model
  else G.aiCur.model = prov.default_model, sel.value = prov.default_model
  // key field visibility + hint
  const key = document.getElementById('ai-key')
  if (key) key.placeholder = prov.needs_key ? 'paste API key, then 🔒' : 'not required for local'
  const hint = document.getElementById('ai-hint')
  if (hint) hint.textContent = prov.key_env_hint || ''
}

async function aiLoadPrefsAndKey() {
  try {
    const p = await api('GET','/api/ai/prompts')
    const id = p.default_provider || gVal('ai-provider')
    if (p.default_model) G.aiCur.model = p.default_model
    const prov = G.aiProviders.find(x => x.id === id)
    const modelSel = document.getElementById('ai-model')
    if (prov && modelSel && prov.models.includes(p.default_model)) modelSel.value = p.default_model
    const temp = document.getElementById('ai-temp'); if (temp) temp.value = p.temperature ?? 0.7
    // restore stored key for this provider
    const pInfo = (p.providers || {})[id] || {}
    const key = document.getElementById('ai-key')
    if (key && pInfo.has_key) key.value = '__stored__'
    G.aiCur.provider = id
  } catch {}
}

// ── provider / model / key changes ─────────────────────────────────────────
window.aiOnProvider = async function() {
  G.aiCur.provider = gVal('ai-provider')
  await aiRefreshModels()
  await aiSavePrefs()
}

window.aiSavePrefs = async function() {
  G.aiCur.provider = gVal('ai-provider'); G.aiCur.model = gVal('ai-model')
  try { await api('PUT','/api/ai/prompts',{
      default_provider: G.aiCur.provider, default_model: G.aiCur.model,
      temperature: parseFloat(gVal('ai-temp')) || 0.7 }) } catch {}
}

window.aiSaveKey = async function() {
  const pid = gVal('ai-provider')
  const key = gVal('ai-key')
  if (key === '__stored__') return
  try {
    await api('PUT','/api/ai/prompts',{ providers: { [pid]: { api_key: key } } })
    sVal('ai-key', '__stored__')
    toast(`Key stored for ${pid}`)
  } catch(e){ toast(`Key save failed: ${e.message}`) }
}

// ── conversations ───────────────────────────────────────────────────────────
async function aiLoadChats() {
  try {
    const chats = await api('GET','/api/ai/chats')
    const list = document.getElementById('ai-chat-list')
    if (!list) return
    list.innerHTML = chats.length ? chats.map(c => `
      <div class="ai-chat-item ${c.id===G.aiCur.id?'active':''}" data-cid="${c.id}"
           onclick="app.aiSelectChat('${c.id}')">
        <span class="ai-chat-title">${esc(c.title||'chat')}</span>
        <span class="ai-chat-meta">${c.message_count||0} msgs</span>
        <button class="ai-chat-del" onclick="app.aiDeleteChat('${c.id}');event.stopPropagation()">✕</button>
      </div>`).join('') : '<div style="color:var(--dim);font-size:10px;padding:10px;text-align:center">No chats yet</div>'
  } catch {}
}

window.aiNewChat = async function() {
  try {
    const c = await api('POST','/api/ai/chats',{
      title: 'New chat', provider: gVal('ai-provider'), model: gVal('ai-model') })
    G.aiCur = { id: c.id, provider: c.provider, model: c.model, messages: [] }
    aiResetChatDOM(); aiLoadChats()
  } catch(e){ toast(`New chat failed: ${e.message}`) }
}

window.aiSelectChat = async function(id) {
  try {
    const c = await api('GET', `/api/ai/chats/${id}`)
    G.aiCur = { id: c.id, provider: c.provider, model: c.model, messages: c.messages || [] }
    aiResetChatDOM()
    ;(c.messages||[]).forEach(m => aiMsg(m.role==='assistant'?'ai':'user', m.content))
    aiLoadChats()
  } catch(e){ toast(`Load failed: ${e.message}`) }
}

window.aiDeleteChat = async function(id) {
  if (!confirm('Delete this conversation?')) return
  try { await api('DELETE', `/api/ai/chats/${id}`); if (G.aiCur.id===id){ G.aiCur.id=null; G.aiCur.messages=[]; aiResetChatDOM() } aiLoadChats() }
  catch(e){ toast(`Delete failed: ${e.message}`) }
}

let _aiSaveTimer = null
function aiPersistActiveChat() {
  if (!G.aiCur.id) return
  clearTimeout(_aiSaveTimer)
  _aiSaveTimer = setTimeout(async () => {
    try {
      const title = (G.aiCur.messages.find(m=>m.role==='user')?.content||'chat').slice(0,60)
      await api('PUT', `/api/ai/chats/${G.aiCur.id}`, {
        title, provider: gVal('ai-provider'), model: gVal('ai-model'),
        messages: G.aiCur.messages })
      aiLoadChats()
    } catch {}
  }, 800)
}

function aiResetChatDOM() {
  const c = document.getElementById('ai-chat'); if (c) c.innerHTML = ''
}

// ── streaming chat ──────────────────────────────────────────────────────────
window.aiSend = async function() {
  const msg = gVal('ai-msg').trim(); if (!msg) return
  const pid = gVal('ai-provider'), model = gVal('ai-model'),
        key = gVal('ai-key')==='__stored__' ? '' : gVal('ai-key'),
        temp = parseFloat(gVal('ai-temp')) || 0.7
  sVal('ai-msg','')
  if (!G.aiCur.id) { await window.app.aiNewChat() }
  G.aiCur.messages.push({ role:'user', content: msg })
  aiMsg('user', msg)
  const bubble = aiMsg('thinking', '')
  G.aiStopFlag = false

  try {
    const ws = new WebSocket(`${WS_BASE}/api/ai/chat/stream`)
    G.aiStream = ws
    ws.onopen = () => ws.send(JSON.stringify({ provider: pid, model, api_key: key,
      temperature: temp, messages: G.aiCur.messages }))
    let acc = ''
    ws.onmessage = e => {
      let d; try { d = JSON.parse(e.data) } catch { return }
      if (d.delta) { acc += d.delta; aiFillBubble(bubble, acc) }
      if (d.error) { aiFillBubble(bubble, '⚠ ' + d.error, true) }
      if (d.done) { ws.close() }
    }
    ws.onclose = () => {
      G.aiStream = null
      if (acc) G.aiCur.messages.push({ role:'assistant', content: acc })
      aiPersistActiveChat()
    }
    ws.onerror = () => { aiFillBubble(bubble, '⚠ connection error', true); ws.close() }
  } catch(e) { aiFillBubble(bubble, '⚠ ' + e.message, true) }
}

window.aiStop = function() {
  G.aiStopFlag = true
  try { G.aiStream?.close() } catch {}
  G.aiStream = null
}

// ── tool tabs ───────────────────────────────────────────────────────────────
window.aiTab = function(btn, name) {
  document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'))
  btn.classList.add('active')
  document.querySelectorAll('.ai-panel').forEach(p => p.classList.remove('active'))
  document.getElementById(`aip-${name}`)?.classList.add('active')
  // sidebar only meaningful for chat
  document.getElementById('ai-sidebar')?.classList.toggle('hidden', name !== 'chat')
}

// ── AI tools ────────────────────────────────────────────────────────────────
async function _aiToolCommon(kind, opts={}) {
  const pid = gVal('ai-provider'), model = gVal('ai-model'),
        key = gVal('ai-key')==='__stored__' ? '' : gVal('ai-key'),
        temp = parseFloat(gVal('ai-temp')) || 0.7
  const body = { provider: pid, model, api_key: key, temperature: temp, ...opts }
  try { return await api('POST', `/api/ai/tool/${kind}`, body) }
  catch(e){ return { error: e.message } }
}

async function _aiRenderTool(outId, r) {
  const out = document.getElementById(outId)
  if (!out) return
  if (r.error) { out.innerHTML = `<span style="color:var(--danger)">⚠ ${esc(r.error)}</span>`; return }
  out.innerHTML = aiMarkdown(r.reply || '')
}

window.aiRunTool = async function(kind) {
  const spinner = el => { if(el) el.innerHTML='<em style="color:var(--dim)">⋯ working…</em>' }
  const out = document.getElementById(`ai-${kind==='termassist'?'term':(
    kind==='troubleshoot'?'net':kind==='sysan'?'sys':kind==='logs'?'log':
    kind==='command'?'cmd':kind==='code'?'code':kind)}-out`);
  const inputEl = {
    termassist:'ai-term-input', troubleshoot:'ai-net-input', sysan:'ai-sys-input',
    logs:'ai-log-input', command:'ai-cmd-input', code:'ai-code-input'
  }[kind]
  const input = document.getElementById(inputEl)?.value.trim() || ''
  const ctx = document.getElementById(inputEl)?.value

  // cmd & term have a special output (render a copy-to-terminal widget)
  if (kind === 'command' || kind === 'termassist') {
    spinner(out); const r = await _aiToolCommon(kind, { input })
    aiRenderCmd(out, r, kind); return
  }
  spinner(out)
  const opts = kind === 'logs' ? { input, context: { path: gVal('ai-log-path') } }
            : { input }
  const r = await _aiToolCommon(kind, opts)
  _aiRenderTool(out.id, r)
}

// show the auto-gathered context blobs for the net/sys/logs tools (no LLM call)
window.aiNetRefresh = async function() {
  const ctx = document.getElementById('ai-net-ctx')
  if (ctx) ctx.innerHTML = '<em style="color:var(--dim)">⋯ gathering diagnostics…</em>'
  const r = await _aiToolCommon('troubleshoot', { gather_only: true })
  if (ctx) ctx.innerHTML = r.error ? `<span style="color:var(--danger)">${esc(r.error)}</span>`
    : aiNetPreview(r.gathered)
}
window.aiSysRefresh = async function() {
  const ctx = document.getElementById('ai-sys-ctx')
  if (ctx) ctx.innerHTML = '<em style="color:var(--dim)">⋯ sampling live metrics…</em>'
  const r = await _aiToolCommon('sysan', { gather_only: true })
  if (ctx) ctx.innerHTML = r.error ? `<span style="color:var(--danger)">${esc(r.error)}</span>`
    : aiSysPreview(r.gathered)
}
window.aiLogRefresh = async function() {
  const ctx = document.getElementById('ai-log-ctx')
  if (ctx) ctx.innerHTML = '<em style="color:var(--dim)">⋯ tailing log…</em>'
  const r = await _aiToolCommon('logs', { gather_only: true, context: { path: gVal('ai-log-path') } })
  if (ctx) ctx.innerHTML = r.error ? `<span style="color:var(--danger)">${esc(r.error)}</span>`
    : aiLogPreview(r.gathered)
}

function aiNetPreview(g) {
  if (!g) return ''
  const diag = g.diagnostics || {}
  const snaps = g.snapshot || {}
  const rows = (diag.checks || []).map(c =>
    `<tr><td style="color:${c.ok?'var(--net)':'var(--danger)'}">${c.ok?'✓':'✕'}</td>
         <td>${esc(c.name)}</td><td style="color:var(--dim)">${esc(c.target||'')}</td>
         <td>${esc(c.detail||'')}</td></tr>`).join('')
  return `<div style="color:var(--dim);font-size:10px;margin-bottom:4px">Verdict: <b style="color:var(--text)">${esc(diag.verdict||'—')}</b> · ${esc(diag.passed||0)}/${esc(diag.total||0)} checks</div>
          <table class="nc-table" style="font-size:10px"><tbody>${rows}</tbody></table>
          <pre style="font-size:9px;color:var(--dim);margin-top:6px">CPU ${snaps.cpu??'—'}% · RAM ${snaps.ram??'—'}% · uptime ${snaps.uptime??'—'}s</pre>`
}
function aiSysPreview(g) {
  if (!g) return ''
  const s = g.snapshot || {}
  const f = (v,d=2)=> v==null?'—':(typeof v==='number'?v.toFixed(d):v)
  return `<div class="nc-cards">
    <div class="nc-card"><div class="nc-card-hd" style="font-size:10px">CPU</div>
      <div class="nc-row"><span class="k">load</span><span class="v">${(s.loadavg||[]).join('  ')||'—'}</span></div>
      <div class="nc-row"><span class="k">cpu</span><span class="v">${f(s.cpu)}% / ${f(s.cpu_temp,1)}°C (${s.cpu_count}c/${s.cpu_phys}p)</span></div></div>
    <div class="nc-card"><div class="nc-card-hd" style="font-size:10px">RAM/Disk</div>
      <div class="nc-row"><span class="k">ram</span><span class="v">${f(s.ram)}% · ${f(s.ram_used)} / ${f(s.ram_total)} GB</span></div>
      <div class="nc-row"><span class="k">swap</span><span class="v">${f(s.swap_used)} / ${f(s.swap_total)} GB</span></div>
      <div class="nc-row"><span class="k">disk</span><span class="v">${f(s.disk_percent)}% · ${f(s.disk_used)} / ${f(s.disk_total)} GB</span></div></div>
    <div class="nc-card"><div class="nc-card-hd" style="font-size:10px">Net</div>
      <div class="nc-row"><span class="k">down/up</span><span class="v">${f(s.net_down)} / ${f(s.net_up)} Mbps</span></div>
      <div class="nc-row"><span class="k">disk io</span><span class="v">r ${f(s.disk_read)} · w ${f(s.disk_write)} MB/s</span></div></div>
  </div>`
}

function aiLogPreview(g) {
  if (g.error) return `<span style="color:var(--danger)">${esc(g.error)}</span>`
  const lines = g.lines || []
  return `<div style="color:var(--dim);font-size:10px">${esc(g.source)} · ${lines.length} lines${g.truncated?' (tail)':''}</div>` +
         `<pre style="font-size:9px;color:var(--text);max-height:120px;overflow:auto;margin-top:4px">${esc(lines.slice(-20).join('\n'))}</pre>`
}

// render a command output with copy + send-to-terminal
function aiRenderCmd(outEl, r, kind) {
  if (r.error){ outEl.innerHTML = `<span style="color:var(--danger)">⚠ ${esc(r.error)}</span>`; return }
  const text = r.reply || ''
  // pull the first ```bash ... ``` block as the runnable command
  const m = text.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/i)
  const cmd = m ? m[1].trim() : ''
  const rest = m ? text.replace(m[0], '').trim() : text
  outEl.innerHTML = `
    ${cmd ? `<div class="ai-cmd-block">
      <pre class="ai-cmd-text">${esc(cmd)}</pre>
      <div class="ai-cmd-acts">
        <button class="cyber-btn" onclick="navigator.clipboard.writeText(${JSON.stringify(cmd)});toast('copied')">📋 Copy</button>
        <button class="cyber-btn accent-btn" onclick="app.aiCopyToTerminal(${JSON.stringify(cmd)})">⌽ To Terminal</button>
      </div></div>` : ''}
    <div class="output-area" style="margin-top:6px">${aiMarkdown(rest)}</div>`
}

window.aiCopyToTerminal = function(cmd) {
  if (!TWS || TWS.readyState !== 1) { toast('Terminal not connected'); return }
  TWS.send(new TextEncoder().encode(cmd + '\n'))
  toast('Sent to terminal')
}

// ── DOM helpers ─────────────────────────────────────────────────────────────
function aiMsg(role, text) {
  const chat = document.getElementById('ai-chat'); if (!chat) return null
  const div = document.createElement('div')
  div.className = `ai-msg ${role==='user'?'user':role==='err'?'err':'ai'}`
  div.id = (role === 'thinking') ? 'ai-thinking' : ''
  if (role === 'thinking') div.innerHTML = '<em style="color:var(--dim)">⋯ thinking…</em>'
  else div.innerHTML = `<strong>${role==='user'?'You':'AI'}:</strong> ${aiMarkdown(text)}`
  chat.appendChild(div); chat.scrollTop = chat.scrollHeight
  return div
}
function aiFillBubble(bubble, text, isError=false) {
  if (!bubble) return
  bubble.classList.toggle('err', !!isError)
  bubble.innerHTML = `<strong>${isError?'':'AI:'}</strong> ${aiMarkdown(text)}`
  const chat = document.getElementById('ai-chat'); if (chat) chat.scrollTop = chat.scrollHeight
}

// minimal markdown: code blocks + inline code + line breaks
function aiMarkdown(s='') {
  return String(s)
    // fenced code blocks
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_,lang,code) =>
      `<pre class="ai-code-block">${esc(code)}</pre>`)
    // inline code
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    // bold / bold*
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // headers
    .replace(/^###\s(.*)$/gm, '<div class="ai-h3">$1</div>')
    .replace(/^##\s(.*)$/gm, '<div class="ai-h2">$1</div>')
    // line breaks (escape first to avoid html injection inside text nodes)
    .replace(/\n/g, '<br>')
}

// ═══════════════════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
async function loadSettings() {
  try {
    const s=await api('GET','/api/settings')
    if(s.theme) applyTheme(s.theme)
    const k=s.api_keys||{}
    sVal('s-anthropic',k.anthropic||''); sVal('s-openai',k.openai||''); sVal('s-gemini',k.gemini||'')
    const t=s.terminal||{}; sVal('s-shell',t.shell||'/bin/bash'); sVal('s-fontsize',t.font_size||13)
    const sel=document.getElementById('s-theme'); if(sel&&s.theme) sel.value=s.theme
    // pre-fill AI key
    if(k.anthropic) sVal('ai-key',k.anthropic)
    else if(k.openai) sVal('ai-key',k.openai)
    else if(k.gemini) sVal('ai-key',k.gemini)
  } catch {}
}

window.saveSettings = async function() {
  try {
    const s={theme:gVal('s-theme'),terminal:{shell:gVal('s-shell'),font_size:parseInt(gVal('s-fontsize'))},api_keys:{anthropic:gVal('s-anthropic'),openai:gVal('s-openai'),gemini:gVal('s-gemini')}}
    await api('PUT','/api/settings',s)
    if(s.theme) applyTheme(s.theme)
    sTxt('settings-msg','✓ Settings saved!'); setTimeout(()=>sTxt('settings-msg',''),2000)
  } catch(e){ sTxt('settings-msg',`Error: ${e.message}`) }
}

// ═══════════════════════════════════════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════════════════════════════════════
window.generateReport = async function() {
  const out = document.getElementById('report-out')
  const btn = document.getElementById('rep-gen-btn')
  const fmt = document.getElementById('rep-format')?.value || 'pdf'
  const title = document.getElementById('rep-title')?.value?.trim() || 'CyberSuite X System Report'
  const includeCharts = !!document.getElementById('rep-charts')?.checked
  const sections = {}
  document.querySelectorAll('#rep-sections input[data-sec]').forEach(c => { sections[c.dataset.sec] = c.checked })
  if (!Object.values(sections).some(Boolean)) { if(out){out.style.color='var(--danger)';out.textContent='Select at least one section.'} return }
  if (out) { out.style.color='var(--net)'; out.textContent=`Generating ${fmt.toUpperCase()} report…` }
  if (btn) { btn.disabled = true; btn.textContent='⏳ Generating…' }
  try {
    const meta = await api('POST','/api/reports/generate',{ format:fmt, title, include_charts:includeCharts, sections })
    if (out) out.textContent = `✓ ${meta.format.toUpperCase()} report ready — ${fmtBytes(meta.file_size)}`
    await window.loadReports()
  } catch(e) {
    if (out) { out.style.color='var(--danger)'; out.textContent=`Error: ${e.message}` }
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='⚙ Generate Report' }
  }
}

function fmtBytes(n){ if(n==null)return'—'; if(n<1024)return n+' B'; if(n<1048576)return (n/1024).toFixed(1)+' KB'; return (n/1048576).toFixed(1)+' MB' }

window.loadReports = async function() {
  const list = document.getElementById('rep-list'); if(!list) return
  try {
    const reports = await api('GET','/api/reports')
    if (!reports.length) { list.innerHTML = '<p style="color:var(--dim);font-size:12px">No reports yet — generate one on the left.</p>'; return }
    const badge = { pdf:'#ff3366', html:'#00f0ff', json:'#a855f7', csv:'#00ff88' }
    list.innerHTML = reports.map(r => {
      const dt = (r.created_at||'').replace('T',' ').split('.')[0]
      const c = badge[r.format] || 'var(--accent)'
      const canView = r.format==='html' || r.format==='json' || r.format==='csv'
      return `<div class="rep-item">
        <span class="rep-fmt" style="background:${c}22;color:${c};border-color:${c}55">${(r.format||'').toUpperCase()}</span>
        <div class="rep-meta">
          <div class="rep-name">${escapeHtml(r.title)}</div>
          <div class="rep-sub">${dt} · ${fmtBytes(r.file_size)} · ${r.sections?.length||0} sections</div>
        </div>
        <div class="rep-actions">
          ${canView?`<button class="cyber-btn" onclick="app.viewReport('${r.filename}')" title="View">👁</button>`:''}
          <button class="cyber-btn" onclick="app.downloadReport('${r.filename}')" title="Download">⬇</button>
          <button class="cyber-btn" onclick="app.deleteReport('${r.filename}')" title="Delete">🗑</button>
        </div>
      </div>`
    }).join('')
  } catch(e) { list.innerHTML = `<p style="color:var(--danger);font-size:12px">Failed to load: ${e.message}</p>` }
}

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) }

window.downloadReport = async function(filename) {
  try {
    const r = await fetch(`${API}/api/reports/${encodeURIComponent(filename)}/download`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(()=>URL.revokeObjectURL(url), 4000)
  } catch(e) { alert('Download failed: '+e.message) }
}

window.viewReport = function(filename) {
  const url = `${API}/api/reports/${encodeURIComponent(filename)}/view`
  if (window.electron?.openExternal) window.electron.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

window.deleteReport = async function(filename) {
  if (!confirm('Delete this report?')) return
  try { await api('DELETE',`/api/reports/${encodeURIComponent(filename)}`); await window.loadReports() }
  catch(e){ alert('Delete failed: '+e.message) }
}

// ═══════════════════════════════════════════════════════════════════════════
//  BACKGROUND / MONITOR DATA
// ═══════════════════════════════════════════════════════════════════════════
async function loadGateway() {
  try { const r=await api('GET','/api/network/info'); sTxt('cv-gw',r.gateway||'—') } catch{}
}
function pingLoop(){ doPing(); setInterval(doPing,8000) }
async function doPing() {
  try {
    const r  = await api('POST','/api/network/ping',{host:'8.8.8.8',count:1})
    const m  = r.output.match(/time[=<]([\d.]+)/)
    const ms = m ? parseFloat(m[1]) : null
    const el = document.getElementById('cv-ping')
    if (ms !== null) {
      // show 1 decimal for sub-10ms, 0 decimal otherwise
      const disp = ms < 10 ? `${ms.toFixed(1)} ms` : `${ms.toFixed(0)} ms`
      sTxt('cv-ping', disp)
      sTxt('cs-ping', '8.8.8.8 (Google)')
      if (el) el.style.color = ms<50?'var(--net)':ms<150?'var(--accent)':'var(--danger)'
    } else if (r.ok) {
      sTxt('cv-ping','< 1 ms')
      if (el) el.style.color='var(--net)'
    } else {
      sTxt('cv-ping','timeout')
      if (el) el.style.color='var(--danger)'
    }
  } catch { sTxt('cv-ping','— ms') }
}
// ═══════════════════════════════════════════════════════════════════════════
//  SYSTEM MONITOR
// ═══════════════════════════════════════════════════════════════════════════
function initMonitor() {
  connectMonitorWs()
}

function connectMonitorWs() {
  try {
    const ws = new WebSocket(`${WS_BASE}/api/monitor/ws`)
    ws.onmessage = e => { try { monLive(JSON.parse(e.data)) } catch {} }
    ws.onclose   = () => { const dot=document.getElementById('mon-live-dot'); if(dot) dot.style.color='var(--danger)'; setTimeout(connectMonitorWs, 2500) }
    ws.onerror   = () => ws.close()
    G.monWs = ws
  } catch { setTimeout(connectMonitorWs, 3000) }
}

// called when user opens the Monitor page
function monEnter() {
  monTabLoad(G.monTab, true)
}

// live 1 Hz metrics → overview cards (only paint when page visible to save CPU)
function monLive(d) {
  G.monLast = d
  const dot = document.getElementById('mon-live-dot'); if (dot) dot.style.color = 'var(--net)'
  // taskbar fan chip (always visible, cheap)
  sTxt('tb-fan', (d.fans_available && d.fans?.length) ? `${d.fans[0].rpm} RPM` : '— RPM')
  if (G.activePage !== 'monitor') return
  const set = (id,v)=>sTxt(id,v)
  const bar = (id,pct,warn=85)=>{ const el=document.getElementById(id); if(el){ el.style.width=`${Math.min(pct||0,100)}%`; el.style.background=(pct||0)>warn?'var(--danger)':'' } }

  // CPU
  set('mon-cpu', `${num(d.cpu)}%`); bar('mon-cpu-bar', d.cpu, 90)
  set('mon-cpu-sub', `${d.cpu_count||'—'} cores (${d.cpu_phys||'—'} phys) · ${d.cpu_freq||'—'} MHz`)
  const cores = document.getElementById('mon-cores')
  if (cores && Array.isArray(d.cpu_percore)) {
    if (cores.children.length !== d.cpu_percore.length)
      cores.innerHTML = d.cpu_percore.map((_,i)=>`<div class="mon-core" title="core ${i}"><div class="mon-core-fill"></div></div>`).join('')
    d.cpu_percore.forEach((v,i)=>{ const f=cores.children[i]?.firstChild; if(f){ f.style.height=`${Math.min(v,100)}%`; f.style.background=v>90?'var(--danger)':'var(--cpu)' } })
  }
  // RAM
  set('mon-ram', `${num(d.ram)}%`); bar('mon-ram-bar', d.ram, 90)
  set('mon-ram-sub', `${d.ram_used||0} / ${d.ram_total||0} GB · ${d.ram_avail||0} free`)
  set('mon-swap-sub', `swap ${d.swap_used||0} / ${d.swap_total||0} GB (${num(d.swap)}%)`)
  // GPU
  const g = d.gpu||{}
  if (g.util != null) { set('mon-gpu', `${num(g.util)}%`); bar('mon-gpu-bar', g.util, 90) }
  else { set('mon-gpu', g.temp!=null?`${num(g.temp)}°C`:'—'); bar('mon-gpu-bar', g.temp||0, 95) }
  set('mon-gpu-sub', g.present ? (g.name||'GPU') : 'no GPU detected')
  set('mon-gpu-sub2', g.present ? [g.temp!=null?`${num(g.temp)}°C`:null, (g.mem_used!=null?`${(g.mem_used/1024).toFixed(1)}/${(g.mem_total/1024).toFixed(1)} GB`:null), g.util==null?'util n/a':null].filter(Boolean).join(' · ') : '')
  // DISK
  set('mon-disk', `${num(d.disk_percent)}%`); bar('mon-disk-bar', d.disk_percent, 90)
  set('mon-disk-sub', `${d.disk_used||0} / ${d.disk_total||0} GB`)
  set('mon-diskio-sub', `r ${d.disk_read||0} · w ${d.disk_write||0} MB/s`)
  // NET
  set('mon-net', `${(d.net_down||0).toFixed(1)}`)
  set('mon-net-dn', `▼ ${(d.net_down||0).toFixed(2)} Mbps`)
  set('mon-net-up', `▲ ${(d.net_up||0).toFixed(2)} Mbps`)
  // TEMP
  set('mon-temp', d.cpu_temp!=null?`${num(d.cpu_temp)}°C`:'—')
  set('mon-temp-cpu', `CPU ${d.cpu_temp!=null?num(d.cpu_temp)+'°C':'—'}`)
  set('mon-temp-gpu', `GPU ${g.temp!=null?num(g.temp)+'°C':'—'}`)
  set('mon-load', `load ${(d.loadavg||[]).map(x=>x.toFixed(2)).join('  ')||'—'}`)
  // BATTERY (honest — desktops report null)
  if (d.battery) {
    set('mon-batt', `${num(d.battery.percent)}%`)
    const secs = d.battery.secsleft
    set('mon-batt-sub', d.battery.plugged ? 'plugged in / charging' : (secs?`${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m left`:'on battery'))
  } else { set('mon-batt', 'N/A'); set('mon-batt-sub', 'no battery on this machine') }
  // FANS (honest — empty when hardware exposes none)
  if (d.fans_available && d.fans?.length) {
    set('mon-fan', `${d.fans.length}`)
    set('mon-fan-sub', d.fans.map(f=>`${f.label}: ${f.rpm} rpm`).join(' · '))
  } else { set('mon-fan', 'N/A'); set('mon-fan-sub', 'no fan sensors exposed') }
  // header uptime
  set('mon-uptime', fmtUptimeShort(d.uptime||0))

  // sensors tab is fed from live data too
  if (G.monTab === 'sensors') monRenderSensors(d)
}

// ── section tabs ─────────────────────────────────────────────────────────
window.monTab = function(btn, name) {
  document.querySelectorAll('.mon-tab').forEach(b=>b.classList.remove('active'))
  btn.classList.add('active')
  document.querySelectorAll('.mon-section').forEach(s=>s.classList.remove('active'))
  document.getElementById(`ms-${name}`)?.classList.add('active')
  G.monTab = name
  clearInterval(G.monPollTimer); G.monPollTimer=null
  monTabLoad(name, true)
}

function monTabLoad(name, immediate) {
  if (name === 'processes') {
    if (immediate) procRefresh()
    if (G.procAuto) G.monPollTimer = setInterval(()=>{ if(G.activePage==='monitor'&&G.monTab==='processes') procRefresh() }, 3000)
  } else if (name === 'services') {
    if (immediate) svcRefresh()
  } else if (name === 'disks') {
    if (immediate) disksRefresh()
    G.monPollTimer = setInterval(()=>{ if(G.activePage==='monitor'&&G.monTab==='disks') disksRefresh() }, 5000)
  } else if (name === 'network') {
    if (immediate) netRefresh()
    G.monPollTimer = setInterval(()=>{ if(G.activePage==='monitor'&&G.monTab==='network') netRefresh() }, 2000)
  } else if (name === 'sensors') {
    if (G.monLast) monRenderSensors(G.monLast)
  }
}

// ── PROCESSES ──────────────────────────────────────────────────────────────
async function procRefresh() {
  try {
    const r = await api('GET','/api/monitor/processes')
    if (!r.ok) return
    G.procData = r.processes; G.procPrimed = r.primed
    sTxt('proc-count', `${r.count} processes${r.primed?'':' · measuring CPU…'}`)
    procRender()
  } catch {}
}
window.procRefresh = procRefresh
window.procAuto = function(){ G.procAuto = document.getElementById('proc-auto').checked; clearInterval(G.monPollTimer); monTabLoad('processes', false) }
window.procSort = function(key){
  if (G.procSort.key===key) G.procSort.dir*=-1
  else G.procSort = {key, dir: (key==='name'||key==='username'||key==='status')?1:-1}
  document.querySelectorAll('#proc-table th').forEach(th=>{ th.classList.remove('sorted-asc','sorted-desc'); if(th.dataset.sort===key) th.classList.add(G.procSort.dir>0?'sorted-asc':'sorted-desc') })
  procRender()
}
window.procRender = function(){
  const el = document.getElementById('proc-rows'); if(!el) return
  const q = (document.getElementById('proc-search')?.value||'').toLowerCase().trim()
  const filt = document.getElementById('proc-filter')?.value||'all'
  let rows = G.procData
  if (q) rows = rows.filter(p=>String(p.pid).includes(q)||(p.name||'').toLowerCase().includes(q)||(p.username||'').toLowerCase().includes(q))
  if (filt!=='all') rows = rows.filter(p=>(p.status||'').toLowerCase()===filt)
  const {key,dir} = G.procSort
  rows = rows.slice().sort((a,b)=>{ let x=a[key],y=b[key]; if(typeof x==='string'){x=x.toLowerCase();y=(y||'').toLowerCase(); return x<y?-dir:x>y?dir:0} return ((x||0)-(y||0))*dir })
  el.innerHTML = rows.map(p=>{
    const cpuC = p.cpu>50?'var(--danger)':p.cpu>15?'var(--warn,#ffb300)':'var(--cpu)'
    return `<tr>
      <td class="dim">${p.pid}</td>
      <td class="mon-name" title="${esc(p.name)}">${esc(p.name)}</td>
      <td class="dim">${esc(p.username)}</td>
      <td class="num" style="color:${cpuC}">${p.cpu.toFixed(1)}</td>
      <td class="num" style="color:var(--ram)">${p.mem_percent.toFixed(1)}</td>
      <td class="num">${p.rss.toFixed(0)}</td>
      <td class="num dim">${p.threads}</td>
      <td class="dim">${esc(p.status)}</td>
      <td class="num"><button class="mon-kill" title="terminate" onclick="app.procKill(${p.pid},'${esc(p.name)}')">✕</button></td>
    </tr>`
  }).join('')
  const shown = rows.length, total = G.procData.length
  sTxt('proc-count', `${shown}${shown!==total?'/'+total:''} processes${G.procPrimed?'':' · measuring CPU…'}`)
}
window.procKill = async function(pid, name){
  if (!confirm(`Terminate process ${pid} (${name})?`)) return
  try {
    const r = await api('POST','/api/monitor/kill',{pid})
    if (r.ok) { toast(`Sent SIGTERM to ${pid} (${name})`); setTimeout(procRefresh, 400) }
    else toast(`Kill failed: ${r.error}`, 4000)
  } catch { toast('Kill request failed', 4000) }
}

// ── SERVICES ────────────────────────────────────────���────────────────────
async function svcRefresh() {
  try {
    const r = await api('GET','/api/monitor/services')
    if (!r.ok) { sTxt('svc-count', r.error||'systemctl unavailable'); document.getElementById('svc-rows').innerHTML=`<tr><td colspan="5" class="mon-note">${esc(r.error||'services unavailable')}</td></tr>`; return }
    G.svcData = r.services; G.svcCounts = r.counts||{}
    svcRender()
  } catch {}
}
window.svcRefresh = svcRefresh
window.svcSort = function(key){
  if (G.svcSort.key===key) G.svcSort.dir*=-1; else G.svcSort={key,dir:1}
  document.querySelectorAll('#svc-table th').forEach(th=>{ th.classList.remove('sorted-asc','sorted-desc'); if(th.dataset.sort===key) th.classList.add(G.svcSort.dir>0?'sorted-asc':'sorted-desc') })
  svcRender()
}
window.svcRender = function(){
  const el=document.getElementById('svc-rows'); if(!el) return
  const q=(document.getElementById('svc-search')?.value||'').toLowerCase().trim()
  const filt=document.getElementById('svc-filter')?.value||'all'
  let rows=G.svcData
  if (q) rows=rows.filter(s=>(s.name||'').toLowerCase().includes(q)||(s.description||'').toLowerCase().includes(q))
  if (filt!=='all') rows=rows.filter(s=> filt==='failed' ? (s.active==='failed'||s.sub==='failed') : s.sub===filt)
  const {key,dir}=G.svcSort
  rows=rows.slice().sort((a,b)=>{ let x=(a[key]||'').toLowerCase(),y=(b[key]||'').toLowerCase(); return x<y?-dir:x>y?dir:0 })
  const dot=s=> s.sub==='running'?'var(--net)':(s.active==='failed'||s.sub==='failed')?'var(--danger)':s.sub==='exited'?'var(--warn,#ffb300)':'var(--dim)'
  el.innerHTML=rows.map(s=>`<tr>
    <td class="mon-name" title="${esc(s.name)}"><span class="svc-dot" style="color:${dot(s)}">⬤</span>${esc(s.name)}</td>
    <td>${esc(s.active)}</td>
    <td class="dim">${esc(s.sub)}</td>
    <td class="mon-name dim" title="${esc(s.description)}">${esc(s.description)}</td>
    <td class="num">${s.sub==='running'
        ? `<button class="mon-svc-btn" onclick="app.svcAction('${esc(s.name)}','stop')">stop</button>`
        : `<button class="mon-svc-btn" onclick="app.svcAction('${esc(s.name)}','start')">start</button>`}
      <button class="mon-svc-btn" onclick="app.svcAction('${esc(s.name)}','restart')">↻</button></td>
  </tr>`).join('')
  const c=G.svcCounts
  sTxt('svc-count', `${rows.length}/${G.svcData.length} · ${c.running||0} running · ${c.failed||0} failed`)
}
window.svcAction = async function(name, action){
  if (action!=='restart' && !confirm(`${action} ${name}.service?`)) return
  try {
    const r=await api('POST','/api/monitor/service-action',{name,action})
    if (r.ok){ toast(`${action} ${name}: ok`); setTimeout(svcRefresh, 600) }
    else toast(`${action} ${name}: ${r.error}`, 4000)
  } catch { toast('service action failed', 4000) }
}

// ── DISKS ────────────────────────────────────────────────────────────────
async function disksRefresh(){
  try {
    const r=await api('GET','/api/monitor/disks'); if(!r.ok) return
    const el=document.getElementById('disk-rows')
    el.innerHTML=r.partitions.map(x=>`<div class="disk-item">
      <div style="display:flex;justify-content:space-between;font-size:11px">
        <span style="color:var(--accent)">${esc(x.mountpoint)} <span class="dim">(${esc(x.device)} · ${esc(x.fstype)})</span></span>
        <span class="dim">${x.used}/${x.total}GB · ${x.free}GB free · ${x.percent}%</span></div>
      <div class="disk-bar-wrap"><div class="disk-bar" style="width:${x.percent}%;background:${x.percent>85?'var(--danger)':'var(--accent)'}"></div></div>
    </div>`).join('') || '<div class="mon-note">no partitions</div>'
    sTxt('disk-count', `${r.partitions.length} partitions`)
    const io=document.getElementById('diskio-rows')
    io.innerHTML=Object.entries(r.io).map(([n,c])=>`<tr><td>${esc(n)}</td><td class="num">${c.read_mb}</td><td class="num">${c.write_mb}</td><td class="num dim">${c.read_count}</td><td class="num dim">${c.write_count}</td></tr>`).join('') || '<tr><td colspan="5" class="mon-note">no I/O data</td></tr>'
  } catch {}
}
window.disksRefresh = disksRefresh

// ── NETWORK ──────────────────────────────────────────────────────────────
async function netRefresh(){
  try {
    const r=await api('GET','/api/monitor/network'); if(!r.ok) return
    const el=document.getElementById('netif-rows')
    el.innerHTML=r.interfaces.map(i=>`<tr>
      <td class="mon-name">${esc(i.name)}</td>
      <td style="color:${i.is_up?'var(--net)':'var(--dim)'}">${i.is_up?'up':'down'}${i.speed?` <span class="dim">${i.speed}Mb</span>`:''}</td>
      <td class="dim">${esc(i.ipv4.join(', ')||'—')}</td>
      <td class="dim mono">${esc(i.mac||'—')}</td>
      <td class="num" style="color:var(--net)">${i.down_mbps.toFixed(2)}</td>
      <td class="num" style="color:var(--ram)">${i.up_mbps.toFixed(2)}</td>
      <td class="num dim">${fmtBytes(i.bytes_recv)}</td>
      <td class="num dim">${fmtBytes(i.bytes_sent)}</td>
      <td class="num" style="color:${(i.errin+i.errout)?'var(--danger)':'var(--dim)'}">${i.errin+i.errout}</td>
    </tr>`).join('')
    sTxt('net-count', `${r.interfaces.length} interfaces · ${r.interfaces.filter(i=>i.is_up).length} up`)
  } catch {}
}
window.netRefresh = netRefresh

// ── SENSORS ──────────────────────────────────────────────────────────────
function monRenderSensors(d){
  const t=document.getElementById('temp-rows')
  if (t) t.innerHTML=(d.temps||[]).map(x=>`<tr>
    <td>${esc(x.chip)}</td><td class="dim">${esc(x.label)}</td>
    <td class="num" style="color:${x.critical&&x.current>=x.critical?'var(--danger)':x.high&&x.current>=x.high?'var(--warn,#ffb300)':'var(--net)'}">${x.current!=null?x.current+'°C':'—'}</td>
    <td class="num dim">${x.high!=null?x.high+'°C':'—'}</td>
    <td class="num dim">${x.critical!=null?x.critical+'°C':'—'}</td></tr>`).join('') || '<tr><td colspan="5" class="mon-note">no temperature sensors</td></tr>'
  const f=document.getElementById('fan-rows')
  if (f) f.innerHTML=(d.fans_available&&d.fans?.length)? d.fans.map(x=>`${esc(x.label)}: <b>${x.rpm}</b> rpm`).join(' &nbsp;·&nbsp; ') : 'No fan sensors exposed by this hardware.'
  const b=document.getElementById('batt-rows')
  if (b) b.innerHTML=d.battery? `${num(d.battery.percent)}% · ${d.battery.plugged?'charging / plugged in':'on battery'}` : 'No battery present (desktop system).'
  sTxt('sens-count', `${(d.temps||[]).length} temp sensors`)
}


// ═══════════════════════════════════════════════════════════════════════════
//  ASSETS (Media Page)
// ═══════════════════════════════════════════════════════════════════════════
async function loadAssetCounts() {
  try {
    const c=await api('GET','/api/assets')
    sTxt('asset-count-music',`${c.music||0} tracks`)
    sTxt('asset-count-backgrounds',`${c.backgrounds||0} images`)
    sTxt('asset-count-fonts',`${c.fonts||0} fonts`)
    sTxt('asset-count-icons',`${c.icons||0} icons`)
  } catch{}
}

async function loadMedia() {
  loadMediaMusic(); loadMediaWallpapers(); loadMediaFonts(); loadMediaIcons()
}

/* ── Music Library (media page → full player UI) ── */
async function loadMediaMusic() {
  await Music.refresh()
  Music.enterPage()
}

/* ── Wallpapers ── */
async function loadMediaWallpapers() {
  const grid=document.getElementById('media-wallpaper-grid'); if(!grid) return
  grid.innerHTML='<div style="color:var(--dim)">Loading...</div>'
  try {
    const files=await api('GET','/api/assets/backgrounds')
    if(!files.length){grid.innerHTML='<div style="color:var(--dim)">هیچ تصویری در assets/backgrounds/ نیست<br>JPG، PNG، WebP اضافه کنید</div>';return}
    grid.innerHTML=`
      <div class="media-item" onclick="removeWallpaper()" style="border-color:var(--danger)">
        <span class="media-icon">✕</span><div class="media-info"><div class="media-name">Remove Wallpaper</div></div>
      </div>`+
      files.map(f=>`
        <div class="wallpaper-item" onclick="applyWallpaper('${API}${f.url}','${esc(f.stem||f.name)}')" title="${esc(f.name)}">
          <div class="wp-thumb" style="background:url('${API}${f.url}') center/cover no-repeat var(--card)"></div>
          <div class="wp-name">${esc(f.stem||f.name)}</div>
        </div>`).join('')
  } catch{grid.innerHTML='<div style="color:var(--danger)">Error loading wallpapers</div>'}
}

window.applyWallpaper = function(url, name) {
  document.body.style.cssText+=`;background-image:url('${url}');background-size:cover;background-position:center`
  document.getElementById('main-layout').style.backdropFilter='brightness(0.6)'
  toast(`Wallpaper: ${name}`)
}
window.removeWallpaper = function() {
  document.body.style.backgroundImage=''
  document.getElementById('main-layout').style.backdropFilter=''
  toast('Wallpaper removed')
}

/* ── Fonts ── */
async function loadMediaFonts() {
  const grid=document.getElementById('media-fonts-grid'); if(!grid) return
  grid.innerHTML='<div style="color:var(--dim)">Loading...</div>'
  try {
    const files=await api('GET','/api/assets/fonts')
    if(!files.length){grid.innerHTML='<div style="color:var(--dim)">هیچ فونتی در assets/fonts/ نیست<br>TTF، OTF، WOFF اضافه کنید</div>';return}
    // inject @font-face
    let style=document.getElementById('dynamic-fonts')
    if(!style){style=document.createElement('style');style.id='dynamic-fonts';document.head.appendChild(style)}
    style.textContent=files.map(f=>`@font-face{font-family:"${f.stem}";src:url("${API}${f.url}");}`).join('\n')
    grid.innerHTML=`<div class="media-item" onclick="resetFont()" style="border-color:var(--danger)"><span class="media-icon">↺</span><div class="media-info"><div class="media-name">Reset to Default</div></div></div>`+
      files.map(f=>`
        <div class="font-item" onclick="applyFont('${f.stem}')">
          <div class="font-preview" style="font-family:'${f.stem}',monospace">Aa — Johnny CyberSuite X — 123</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px">
            <span class="font-name">${esc(f.stem||f.name)}</span>
            <button class="cyber-btn" onclick="applyFont('${f.stem}');event.stopPropagation()">Apply</button>
          </div>
        </div>`).join('')
  } catch{grid.innerHTML='<div style="color:var(--danger)">Error loading fonts</div>'}
}

window.applyFont = function(fontName) {
  document.body.style.fontFamily=`"${fontName}",'Courier New',monospace`
  toast(`Font: ${fontName}`)
}
window.resetFont = function() { document.body.style.fontFamily=''; toast('Font reset') }

/* ── Icons ── */
async function loadMediaIcons() {
  const grid=document.getElementById('media-icons-grid'); if(!grid) return
  grid.innerHTML='<div style="color:var(--dim)">Loading...</div>'
  try {
    const files=await api('GET','/api/assets/icons')
    if(!files.length){grid.innerHTML='<div style="color:var(--dim)">هیچ آیکونی در assets/icons/ نیست<br>PNG، SVG اضافه کنید</div>';return}
    grid.innerHTML=files.map(f=>`
      <div class="icon-item" title="${esc(f.name)}">
        <img src="${API}${f.url}" alt="${esc(f.name)}" class="icon-preview" onerror="this.style.display='none'">
        <div class="icon-name">${esc(f.stem||f.name)}</div>
      </div>`).join('')
  } catch{grid.innerHTML='<div style="color:var(--danger)">Error loading icons</div>'}
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════════════════════
function toast(msg, ms=2500) {
  let el=document.getElementById('cs-toast')
  if(!el){el=document.createElement('div');el.id='cs-toast';el.style.cssText='position:fixed;bottom:54px;right:16px;background:var(--card);border:1px solid var(--accent);color:var(--accent);padding:7px 14px;border-radius:6px;font-size:11px;z-index:9999;transition:opacity .3s;pointer-events:none';document.body.appendChild(el)}
  el.textContent=msg; el.style.opacity='1'
  clearTimeout(el._t); el._t=setTimeout(()=>el.style.opacity='0',ms)
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONNECTION BADGE
// ═══════════════════════════════════════════════════════════════════════════
function setBadge(id, txt, col) {
  const el=document.getElementById(id)
  if(el){el.textContent=txt;el.style.color=col}
}

// ═══════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════
function sTxt(id,v){ const el=document.getElementById(id); if(el) el.textContent=v }
function sVal(id,v){ const el=document.getElementById(id); if(el) el.value=v }
function gVal(id){   const el=document.getElementById(id); return el?el.value:'' }
function num(v){     return (v||0).toFixed(0) }
function esc(s){     return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
function fmtBytes(b){ return b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'KB':(b/1048576).toFixed(1)+'MB' }
function outAppend(id,txt,err=false){
  const el=document.getElementById(id); if(!el) return
  const s=document.createElement('span'); s.style.color=err?'var(--danger)':'var(--net)'; s.textContent=txt
  el.appendChild(s); el.scrollTop=el.scrollHeight
}
async function refreshVPNHealth() {
  try {
    const r = await api('GET', '/api/net/vpn-status')
    const active = !!(r.proxy && r.proxy.active)

    const statusEl = document.getElementById('vpn-card-status')
    if (!statusEl) return

    const status = active ? 'ACTIVE' : 'OFF'
    const color = active ? 'var(--net)' : 'var(--danger)'
    const ip = r.public_ip || 'unknown'
    const ipv6 = r.ipv6 ? 'Enabled' : 'Disabled'
    const cloudflare = r.cloudflare_like ? 'Detected' : '—'

    statusEl.innerHTML = `
      <div style="color:${color};font-weight:700">
        VPN: ${status}
      </div>
      <div style="margin-top:3px">
        IP: ${esc(ip)}
      </div>
      <div style="margin-top:2px">
        IPv6: ${ipv6} · Cloudflare: ${cloudflare}
      </div>
    `
  } catch (e) {
    const statusEl = document.getElementById('vpn-card-status')
    if (!statusEl) return

    statusEl.textContent = 'VPN: Health check unavailable'
    statusEl.style.color = 'var(--dim)'
  }
}

async function api(method,path,body){
  const opts={method,headers:{'Content-Type':'application/json'}}
  if(body) opts.body=JSON.stringify(body)
  const r=await fetch(`${API}${path}`,opts)
  if(!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOCIAL LINKS
// ═══════════════════════════════════════════════════════════════════════════
window.openSocial = function(url) {
  if (window.electron?.openExternal) {
    window.electron.openExternal(url)
  } else {
    // fallback for browser testing
    window.open(url, '_blank', 'noopener')
  }
}

function fallbackThemes() {
  return [
    {id:'cyberpunk-2077',name:'Cyberpunk 2077',label:'Cyberpunk',category:'Gaming',tagline:'Night City — 2077',accent:'#ffff00',bg:'#080810'},
    {id:'gta-vi',name:'GTA VI',label:'GTA VI',category:'Gaming',tagline:'Leonida — 2025',accent:'#d4a017',bg:'#0d0a00'},
    {id:'gta-v',name:'GTA V',label:'GTA V',category:'Gaming',tagline:'Los Santos — 2013',accent:'#2a9fd6',bg:'#060a14'},
    {id:'gta-iv',name:'GTA IV',label:'GTA IV',category:'Gaming',tagline:'Liberty City — 2008',accent:'#ff8c00',bg:'#080c14'},
    {id:'death-stranding',name:'Death Stranding',label:'Death Stranding',category:'Gaming',tagline:'Bridges — Connect',accent:'#c8aa44',bg:'#050508'},
    {id:'harry-potter',name:'Harry Potter',label:'Harry Potter',category:'Fantasy',tagline:'Hogwarts — Magic',accent:'#c9a800',bg:'#080410'},
    {id:'the-matrix',name:'The Matrix',label:'Matrix',category:'Sci-Fi',tagline:'The Matrix — Reality',accent:'#00ff00',bg:'#000800'},
    {id:'game-of-thrones',name:'Game of Thrones',label:'GoT',category:'Fantasy',tagline:'Westeros — Chaos',accent:'#c0c0c0',bg:'#080808'},
    {id:'lost',name:'LOST',label:'LOST',category:'TV',tagline:'The Island — Lost',accent:'#00ff88',bg:'#040e08'},
    {id:'elden-ring',name:'Elden Ring',label:'Elden Ring',category:'Gaming',tagline:'Lands Between',accent:'#d4aa00',bg:'#080600'},
    {id:'dark-souls',name:'Dark Souls',label:'Dark Souls',category:'Gaming',tagline:'Praise the Sun',accent:'#ff6600',bg:'#060404'},
    {id:'ghost-of-tsushima',name:'Ghost of Tsushima',label:'GoT-J',category:'Gaming',tagline:'Tsushima — Honor',accent:'#cc6633',bg:'#080410'},
    {id:'horizon',name:'Horizon Zero Dawn',label:'Horizon',category:'Gaming',tagline:'Aloy — Machines',accent:'#ff6622',bg:'#060a08'},
    {id:'the-witcher',name:'The Witcher',label:'Witcher',category:'Gaming',tagline:'Continent — Geralt',accent:'#cc2222',bg:'#080410'},
    {id:'dune',name:'Dune',label:'Dune',category:'Sci-Fi',tagline:'Arrakis — Spice',accent:'#d4aa44',bg:'#0e0800'},
    {id:'blade-runner',name:'Blade Runner 2049',label:'Blade Runner',category:'Sci-Fi',tagline:'Los Angeles 2049',accent:'#ff6600',bg:'#08060e'},
    {id:'tron-legacy',name:'Tron Legacy',label:'Tron',category:'Sci-Fi',tagline:'The Grid — Programs',accent:'#00e5ff',bg:'#000810'},
    {id:'interstellar',name:'Interstellar',label:'Interstellar',category:'Sci-Fi',tagline:'Space — Time',accent:'#c8aa44',bg:'#030306'},
    {id:'alien',name:'Alien',label:'Alien',category:'Sci-Fi',tagline:'LV-426 — Xenomorph',accent:'#44ff44',bg:'#040804'},
    {id:'star-wars',name:'Star Wars',label:'Star Wars',category:'Sci-Fi',tagline:'Galaxy Far Away',accent:'#ffcc00',bg:'#060608'},
    {id:'dracula',name:'Dracula',label:'Dracula',category:'Code',tagline:'Dracula Official',accent:'#bd93f9',bg:'#282a36'},
    {id:'nord',name:'Nord',label:'Nord',category:'Code',tagline:'Arctic Cool Blues',accent:'#88c0d0',bg:'#2e3440'},
    {id:'monokai',name:'Monokai',label:'Monokai',category:'Code',tagline:'Classic Dark',accent:'#e6db74',bg:'#272822'},
    {id:'gruvbox',name:'Gruvbox',label:'Gruvbox',category:'Code',tagline:'Retro Groove',accent:'#d79921',bg:'#282828'},
    {id:'solarized',name:'Solarized Dark',label:'Solarized',category:'Code',tagline:'Precision Colors',accent:'#b58900',bg:'#002b36'},
    {id:'one-dark',name:'One Dark Pro',label:'One Dark',category:'Code',tagline:'Atom One Dark',accent:'#61afef',bg:'#282c34'},
    {id:'retrowave',name:'Retrowave',label:'Retrowave',category:'Retro',tagline:'80s Aesthetic',accent:'#ff71ce',bg:'#0d0221'},
    {id:'vaporwave',name:'Vaporwave',label:'Vaporwave',category:'Retro',tagline:'A E S T H E T I C',accent:'#ff6ec7',bg:'#150a20'},
    {id:'synthwave',name:'Synthwave',label:'Synthwave',category:'Retro',tagline:'Neon Dreams',accent:'#f92aad',bg:'#0a0015'},
    {id:'neon-tokyo',name:'Neon Tokyo',label:'Neon Tokyo',category:'Retro',tagline:'Tokyo Nights',accent:'#ff0080',bg:'#08081a'},
  ]
}

// ═══════════════════════════════════════════════════════════════════════════
//  MEDIA TAB SWITCH
// ═══════════════════════════════════════════════════════════════════════════
window.switchMedia = function(btn, tab) {
  document.querySelectorAll('.media-tab').forEach(t => t.classList.remove('active'))
  btn.classList.add('active')
  document.querySelectorAll('.media-tab-panel').forEach(p => p.classList.remove('active'))
  const panel = document.getElementById(`mtab-${tab}`)
  if (panel) panel.classList.add('active')
}

// ═══════════════════════════════════════════════════════════════════════════
//  ABOUT — SYSTEM INFO
// ═══════════════════════════════════════════════════════════════════════════
async function loadAboutSystemInfo() {
  const el = document.getElementById('about-sysinfo')
  if (!el) return
  el.innerHTML = '<div style="color:var(--dim);text-align:center;padding:20px">Loading system info...</div>'
  try {
    const info = await api('GET', '/api/system/info')
    el.innerHTML = buildSysInfoHTML(info)
  } catch (e) {
    el.innerHTML = `<div style="color:var(--danger);text-align:center;padding:20px">Error loading system info: ${esc(e.message)}</div>`
  }
}

function buildSysInfoHTML(d) {
  function fmtUptime(sec) {
    const days = Math.floor(sec / 86400)
    const hrs  = Math.floor((sec % 86400) / 3600)
    const mins = Math.floor((sec % 3600) / 60)
    return `${days}d ${hrs}h ${mins}m`
  }

  const sections = []

  // OS
  sections.push(`
    <div class="about-section">
      <div class="about-sec-title">🖥 Operating System</div>
      <div class="about-row"><span class="about-lbl">OS</span><span class="about-val">${esc(d.os_pretty || d.os || '—')}</span></div>
      <div class="about-row"><span class="about-lbl">Kernel</span><span class="about-val">${esc(d.kernel || '—')}</span></div>
      <div class="about-row"><span class="about-lbl">Architecture</span><span class="about-val">${esc(d.arch || '—')}</span></div>
      <div class="about-row"><span class="about-lbl">Hostname</span><span class="about-val">${esc(d.hostname || '—')}</span></div>
      <div class="about-row"><span class="about-lbl">Uptime</span><span class="about-val">${d.uptime ? fmtUptime(d.uptime) : '—'}</span></div>
      <div class="about-row"><span class="about-lbl">Desktop</span><span class="about-val">${esc(d.desktop || '—')}</span></div>
      <div class="about-row"><span class="about-lbl">Shell</span><span class="about-val">${esc(d.shell || '—')}</span></div>
    </div>`)

  // CPU
  sections.push(`
    <div class="about-section">
      <div class="about-sec-title">⬛ Processor (CPU)</div>
      <div class="about-row"><span class="about-lbl">Model</span><span class="about-val">${esc(d.cpu_model || '—')}</span></div>
      <div class="about-row"><span class="about-lbl">Cores / Threads</span><span class="about-val">${d.cpu_cores || '—'} / ${d.cpu_threads || '—'}</span></div>
      <div class="about-row"><span class="about-lbl">Frequency</span><span class="about-val">${d.cpu_freq ? d.cpu_freq + ' MHz' : '—'}</span></div>
      <div class="about-row"><span class="about-lbl">Temperature</span><span class="about-val">${d.cpu_temp ? d.cpu_temp + ' °C' : '—'}</span></div>
    </div>`)

  // RAM
  sections.push(`
    <div class="about-section">
      <div class="about-sec-title">💾 Memory (RAM)</div>
      <div class="about-row"><span class="about-lbl">Total</span><span class="about-val">${d.ram_total || '—'} GB</span></div>
      <div class="about-row"><span class="about-lbl">Used</span><span class="about-val">${d.ram_used || '—'} GB (${d.ram_percent || 0}%)</span></div>
      <div class="about-row"><span class="about-lbl">Available</span><span class="about-val">${d.ram_available || '—'} GB</span></div>
      <div class="about-row"><span class="about-lbl">Swap</span><span class="about-val">${d.swap_total || '—'} GB (Used: ${d.swap_used || '—'} GB)</span></div>
    </div>`)

  // GPU
  if (d.gpu_name) {
    sections.push(`
      <div class="about-section">
        <div class="about-sec-title">🎮 Graphics (GPU)</div>
        <div class="about-row"><span class="about-lbl">Model</span><span class="about-val">${esc(d.gpu_name)}</span></div>
        ${d.gpu_driver ? `<div class="about-row"><span class="about-lbl">Driver</span><span class="about-val">${esc(d.gpu_driver)}</span></div>` : ''}
        ${d.gpu_memory ? `<div class="about-row"><span class="about-lbl">Memory</span><span class="about-val">${esc(d.gpu_memory)}</span></div>` : ''}
      </div>`)
  }

  // Disk
  if (d.disks && d.disks.length) {
    const diskRows = d.disks.map(dk => `
      <div class="about-row">
        <span class="about-lbl">${esc(dk.mountpoint)}</span>
        <span class="about-val">${dk.used}/${dk.total} GB (${dk.percent}%) — ${esc(dk.device)}</span>
      </div>`).join('')
    sections.push(`
      <div class="about-section">
        <div class="about-sec-title">💿 Storage</div>
        ${diskRows}
      </div>`)
  }

  // Network
  if (d.network && d.network.length) {
    const netRows = d.network.map(n => `
      <div class="about-row">
        <span class="about-lbl">${esc(n.name)}</span>
        <span class="about-val">${esc(n.ip || '—')}${n.mac ? ' / ' + esc(n.mac) : ''}</span>
      </div>`).join('')
    sections.push(`
      <div class="about-section">
        <div class="about-sec-title">📡 Network Interfaces</div>
        ${netRows}
      </div>`)
  }

  return sections.join('')
}

// ═══════════════════════════════════════════════════════════════════════════
//  APP NAMESPACE (for HTML onclick handlers)
// ═══════════════════════════════════════════════════════════════════════════
window.app = {
  // Network Center
  ncTab:        (...a) => window.ncTab(...a),
  ncSpeedtest:  (...a) => window.ncSpeedtest(...a),
  ncPing:       (...a) => window.ncPing(...a),
  ncDns:        (...a) => window.ncDns(...a),
  ncWhois:      (...a) => window.ncWhois(...a),
  ncPortscan:   (...a) => window.ncPortscan(...a),
  ncTraceroute: (...a) => window.ncTraceroute(...a),
  ncConnections:(...a) => window.ncConnections(...a),
  ncConnAuto:   (...a) => window.ncConnAuto(...a),
  ncInterfaces: (...a) => window.ncInterfaces(...a),
  ncWifi:       (...a) => window.ncWifi(...a),
  ncDiagnostics:(...a) => window.ncDiagnostics(...a),
  ncVPNStatus:  (...a) => window.ncVPNStatus(...a),
  refreshIP:    (...a) => window.refreshIP(...a),
  // System Monitor
  monTab:       (...a) => window.monTab(...a),
  procRefresh:  (...a) => window.procRefresh(...a),
  procAuto:     (...a) => window.procAuto(...a),
  procSort:     (...a) => window.procSort(...a),
  procRender:   (...a) => window.procRender(...a),
  procKill:     (...a) => window.procKill(...a),
  svcRefresh:   (...a) => window.svcRefresh(...a),
  svcSort:      (...a) => window.svcSort(...a),
  svcRender:    (...a) => window.svcRender(...a),
  svcAction:    (...a) => window.svcAction(...a),
  disksRefresh: (...a) => window.disksRefresh(...a),
  netRefresh:   (...a) => window.netRefresh(...a),
  // VPN Center
  vpnToggle:    (...a) => window.vpnToggle(...a),
  vpnImport:    (...a) => window.vpnImport(...a),
  vpnKillSwitch:(...a) => window.vpnKillSwitch(...a),
  vpnAutoConnect:(...a)=> window.vpnAutoConnect(...a),
  // AI Center
  aiOnProvider:  (...a) => window.aiOnProvider(...a),
  aiSavePrefs:   (...a) => window.aiSavePrefs(...a),
  aiSaveKey:     (...a) => window.aiSaveKey(...a),
  aiSend:        (...a) => window.aiSend(...a),
  aiStop:        (...a) => window.aiStop(...a),
  aiTab:         (...a) => window.aiTab(...a),
  aiNewChat:     (...a) => window.aiNewChat(...a),
  aiSelectChat:  (...a) => window.aiSelectChat(...a),
  aiDeleteChat:  (...a) => window.aiDeleteChat(...a),
  aiRunTool:     (...a) => window.aiRunTool(...a),
  aiNetRefresh:  (...a) => window.aiNetRefresh(...a),
  aiSysRefresh:  (...a) => window.aiSysRefresh(...a),
  aiLogRefresh:  (...a) => window.aiLogRefresh(...a),
  aiCopyToTerminal:(...a)=> window.aiCopyToTerminal(...a),
  generateReport:(...a)=> window.generateReport(...a),
  loadReports:  (...a) => window.loadReports(...a),
  downloadReport:(...a)=> window.downloadReport(...a),
  viewReport:   (...a) => window.viewReport(...a),
  deleteReport: (...a) => window.deleteReport(...a),
  saveSettings: (...a) => window.saveSettings(...a),
}

// ═══════════════════════════════════════════════════════════════════════════
//  RESIZE + BOOT
// ═══════════════════════════════════════════════════════════════════════════
window.addEventListener('resize', ()=>{ try{FIT?.fit()}catch{}; drawGraphs() })
document.addEventListener('DOMContentLoaded', init)