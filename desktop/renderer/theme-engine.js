/* ═══════════════════════════════════════════════════════════════════════
   Johnny CyberSuite X — Theme Engine
   ─────────────────────────────────────────────────────────────────────────
   A single engine that owns EVERYTHING a theme changes:
     • Colors (all CSS variables, injected dynamically — no hardcoded CSS)
     • Background wallpaper        (via asset hook)
     • Glass effects               (backdrop blur + translucent surfaces)
     • Icons                       (favicon / theme icon via asset hook)
     • Music                       (via asset hook)
     • Animations                  (speed multiplier / on-off)
     • Accent colors               (+ derived shades & alpha variants)
     • Window effects              (border glow, vignette, radius)
   Themes are plain JSON objects → dynamic loading & future custom themes
   work out of the box: ThemeEngine.register({...}) + ThemeEngine.apply(id).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict'

  /* theme-JSON key → CSS variable */
  const VAR_MAP = {
    bg: '--bg', sidebar: '--sidebar', card: '--card', border: '--border',
    accent: '--accent', accent2: '--accent2', text: '--text', dim: '--dim',
    danger: '--danger', cpu: '--cpu', ram: '--ram', gpu: '--gpu', net: '--net',
    term_bg: '--term-bg', title_bg: '--title-bg', scrollbar: '--scroll',
  }

  const FX_ALL = ['glow', 'scanlines', 'grid', 'crt', 'particles']

  /* default visual-effect set per theme category (overridable per theme) */
  const CATEGORY_FX = {
    'Gaming':  ['glow', 'scanlines', 'particles'],
    'Sci-Fi':  ['glow', 'grid', 'particles'],
    'Retro':   ['glow', 'grid', 'scanlines'],
    'Fantasy': ['glow', 'particles'],
    'TV':      ['glow'],
    'Movies':  ['glow'],
    'Code':    [],
    'Custom':  ['glow'],
  }

  /* ── color helpers ──────────────────────────────────────────────────── */
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)) }

  function hexToRgb(hex) {
    let h = String(hex || '').replace('#', '')
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    const n = parseInt(h.slice(0, 6), 16)
    if (isNaN(n)) return { r: 136, g: 136, b: 136 }
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  function toHex(r, g, b) {
    return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')
  }
  /* multiply brightness: f<1 darken, f>1 lighten */
  function shade(hex, f) { const { r, g, b } = hexToRgb(hex); return toHex(r * f, g * f, b * f) }
  function withAlpha(hex, a) { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})` }

  /* ── contrast helpers (WCAG relative luminance) ─────────────────────── */
  /* per-channel linearization → relative luminance in [0,1] */
  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex)
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  /* WCAG contrast ratio between two colors, 1 (none) … 21 (black/white) */
  function contrast(fg, bg) {
    const a = luminance(fg), b = luminance(bg)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }
  /* push a foreground color away from its background until it clears `min`
     contrast — lightens on dark bg, darkens on light bg. Preserves hue. */
  function ensureContrast(fg, bg, min) {
    if (contrast(fg, bg) >= min) return fg
    const goLighter = luminance(bg) < 0.5
    let out = fg
    for (let i = 0; i < 24 && contrast(out, bg) < min; i++)
      out = shade(out, goLighter ? 1.08 : 0.92)
    /* if hue-preserving shading still fell short (very saturated colors on a
       mid bg), fall back to plain white / near-black — always readable. */
    if (contrast(out, bg) < min) out = goLighter ? '#ffffff' : '#0a0a0a'
    return out
  }

  /* ── engine ─────────────────────────────────────────────────────────── */
  const Engine = {
    themes: new Map(),
    hooks: {},          // { wallpaper(id), music(id), font(id), icons(id) }
    listeners: [],      // change callbacks: fn(theme)
    active: null,

    /* wire asset hooks once at boot */
    init(hooks) {
      this.hooks = hooks || {}
      this._ensureLayers()
    },

    /* subscribe to theme changes (terminal, graphs, plugins, …) */
    on(fn) { if (typeof fn === 'function') this.listeners.push(fn) },

    /* dynamic theme loading — register one theme or a whole list */
    register(t) { if (t && t.id) this.themes.set(t.id, this._normalize(t)) },
    registerAll(list) { (list || []).forEach(t => this.register(t)) },
    unregister(id) { this.themes.delete(id) },
    get(id) { return this.themes.get(id) || null },
    list() { return [...this.themes.values()] },

    /* fill in every derived / defaulted field so apply() never guesses */
    _normalize(t) {
      const n = { ...t }
      const bg = n.bg || '#0a0a0a', accent = n.accent || '#888888'
      n.sidebar   = n.sidebar   || shade(bg, 1.25)
      n.card      = n.card      || shade(bg, 1.6)
      n.border    = n.border    || shade(bg, 2.6)
      n.text      = n.text      || '#d0d0d8'
      n.dim       = n.dim       || withAlpha(n.text, 0.45)
      n.danger    = n.danger    || '#ff3333'
      n.cpu       = n.cpu       || accent
      n.ram       = n.ram       || n.accent2 || accent
      n.gpu       = n.gpu       || shade(accent, 0.75)
      n.net       = n.net       || '#00ff88'
      n.term_bg   = n.term_bg   || shade(bg, 0.55)
      n.title_bg  = n.title_bg  || shade(bg, 0.7)
      n.scrollbar = n.scrollbar || withAlpha(accent, 0.33)

      /* ── readability guard ──────────────────────────────────────────────
         Text sits on bg / sidebar / card; the *lightest* of those is the
         worst case for light text, so measure against it. Nudge `text` and
         `dim` until they clear a legibility floor — every theme reaches
         Cyberpunk-level readability without hand-tuning 34 palettes.
         Opt out per-theme with { "autocontrast": false }.                  */
      if (t.autocontrast !== false) {
        const surfaces = [n.bg, n.sidebar, n.card].filter(Boolean)
        const worst = surfaces.reduce((a, c) => luminance(c) > luminance(a) ? c : a, n.bg)
        n.text = ensureContrast(n.text, worst, 4.5)   // AA for primary text
        n.dim  = ensureContrast(n.dim,  worst, 3.0)   // subdued but legible
      }

      n.fx     = Array.isArray(t.fx) ? t.fx : (CATEGORY_FX[n.category] || ['glow'])
      n.glass  = Object.assign({ enabled: true, blur: 10, opacity: 0.72 }, t.glass || {})
      n.anim   = t.anim === false
        ? { enabled: false, mult: 1 }
        : Object.assign({ enabled: true, mult: 1 }, t.anim || {})
      n.window = Object.assign({ glow: 26, radius: 0 }, t.window || {})
      return n
    },

    /* ── the one entry point: apply a theme by id ─────────────────────── */
    apply(id) {
      const root = document.documentElement, body = document.body
      const t = this.get(id)
      root.setAttribute('data-theme', id)   // CSS fallback blocks still match
      this.active = id
      if (!t) { this._callAssetHooks(id); return null }

      /* 1 — colors + accents */
      for (const [key, cssVar] of Object.entries(VAR_MAP))
        if (t[key]) root.style.setProperty(cssVar, t[key])
      /* derived accent variants for effects */
      root.style.setProperty('--accent-soft',  withAlpha(t.accent  || '#888', 0.14))
      root.style.setProperty('--accent2-soft', withAlpha(t.accent2 || '#888', 0.14))

      /* 2 — glass effects */
      const glass = t.glass
      body.classList.toggle('glass-on', glass.enabled !== false)
      root.style.setProperty('--glass-blur', (glass.blur ?? 10) + 'px')
      root.style.setProperty('--glass-opacity', Math.round((glass.opacity ?? 0.72) * 100) + '%')

      /* 3 — visual effects (scanlines / grid / crt / glow / particles) */
      FX_ALL.forEach(f => body.classList.toggle('fx-' + f, t.fx.includes(f)))
      if (t.fx.includes('particles')) this._startParticles(t.accent || '#888888')
      else this._stopParticles()

      /* 4 — animations */
      body.classList.toggle('anim-off', t.anim.enabled === false)
      root.style.setProperty('--anim-mult', String(t.anim.mult || 1))

      /* 5 — window effects */
      body.classList.toggle('win-fx', (t.window.glow || 0) > 0)
      root.style.setProperty('--win-glow', (t.window.glow || 0) + 'px')
      root.style.setProperty('--win-radius', (t.window.radius || 0) + 'px')

      /* 6 — smooth crossfade pulse */
      this._pulse()

      /* 7 — theme-linked assets: wallpaper, music, font, icons */
      this._callAssetHooks(id)

      /* 8 — notify subscribers (terminal colors, graphs, plugins…) */
      this.listeners.forEach(fn => { try { fn(t) } catch {} })
      return t
    },

    _callAssetHooks(id) {
      const h = this.hooks
      ;['wallpaper', 'music', 'font', 'icons'].forEach(k => { try { h[k] && h[k](id) } catch {} })
    },

    /* overlay layers used by fx / window effects */
    _ensureLayers() {
      if (!document.getElementById('fx-layer')) {
        const l = document.createElement('div')
        l.id = 'fx-layer'
        l.innerHTML = '<div class="fxl fxl-scan"></div><div class="fxl fxl-beam"></div>'
                    + '<div class="fxl fxl-grid"></div>'
                    + '<div class="fxl fxl-crt"></div><div class="fxl fxl-win"></div>'
        document.body.appendChild(l)
      }
      if (!document.getElementById('fx-particles')) {
        const c = document.createElement('canvas')
        c.id = 'fx-particles'
        document.body.appendChild(c)
      }
      if (!document.getElementById('theme-fade')) {
        const f = document.createElement('div')
        f.id = 'theme-fade'
        document.body.appendChild(f)
      }
    },

    /* ── floating particles (ported from CyberNeon) ─────────────────── */
    _particles: null,
    _startParticles(accent) {
      const c = document.getElementById('fx-particles')
      if (!c) return
      this._stopParticles()
      const ctx = c.getContext('2d')
      c.width = innerWidth; c.height = innerHeight
      const N = 42
      const seed = i => (Math.sin(i * 999.7) + 1) / 2   // deterministic pseudo-random
      const dots = Array.from({ length: N }, (_, i) => ({
        x: seed(i) * c.width, y: seed(i + N) * c.height,
        r: 0.6 + seed(i + 2 * N) * 1.8,
        vx: (seed(i + 3 * N) - 0.5) * 0.35, vy: (seed(i + 4 * N) - 0.5) * 0.35,
      }))
      const state = { raf: 0 }
      const tick = () => {
        if (document.body.classList.contains('anim-off')) { state.raf = requestAnimationFrame(tick); return }
        ctx.clearRect(0, 0, c.width, c.height)
        ctx.fillStyle = withAlpha(accent, 0.5)
        for (const d of dots) {
          d.x = (d.x + d.vx + c.width) % c.width
          d.y = (d.y + d.vy + c.height) % c.height
          ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill()
        }
        state.raf = requestAnimationFrame(tick)
      }
      state.raf = requestAnimationFrame(tick)
      state.onResize = () => { c.width = innerWidth; c.height = innerHeight }
      addEventListener('resize', state.onResize)
      this._particles = state
    },
    _stopParticles() {
      const s = this._particles
      if (!s) return
      cancelAnimationFrame(s.raf)
      removeEventListener('resize', s.onResize)
      const c = document.getElementById('fx-particles')
      if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height)
      this._particles = null
    },

    _pulse() {
      const f = document.getElementById('theme-fade')
      if (!f) return
      f.classList.add('on')
      void f.offsetWidth                         // force reflow, then fade out
      requestAnimationFrame(() => f.classList.remove('on'))
    },

    /* exported color utilities (used by the custom-theme editor) */
    shade, withAlpha, hexToRgb,
  }

  window.ThemeEngine = Engine
})()
