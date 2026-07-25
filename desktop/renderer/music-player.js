/* ═══════════════════════════════════════════════════════════════════════
   Johnny CyberSuite X — Music Player
   ─────────────────────────────────────────────────────────────────────────
   Full-featured player over one shared <audio> element:
     • Playlist (from assets/music via backend API)
     • Local files, album covers (assets/music/<stem>.jpg|png|webp → fallback art)
     • Progress bar + seek, time display
     • Repeat (off / all / one), Shuffle
     • 6-band Web-Audio equalizer with presets
     • Volume + mute, persisted settings
     • Background playback (backgroundThrottling off + MediaSession keys)
     • Spectrum visualizer (player) + mini waveform (right rail)
   Exposes window.Music; keeps the old global names (musicPP, musicPrev,
   musicNext, playTrack, playFromMedia) so existing HTML keeps working.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict'

  const LS_KEY = 'cs-music-prefs'
  const EQ_BANDS = [60, 150, 400, 1000, 2400, 15000]
  const EQ_PRESETS = {
    'Flat':       [0, 0, 0, 0, 0, 0],
    'Bass Boost': [7, 5, 2, 0, 0, 1],
    'Treble':     [0, 0, 0, 2, 5, 7],
    'Vocal':      [-2, 0, 3, 4, 2, -1],
    'Electronic': [5, 3, 0, -1, 3, 5],
    'Rock':       [4, 2, -1, 1, 3, 4],
  }
  const COVER_EXTS = ['jpg', 'png', 'webp', 'jpeg']

  const M = {
    files: [],            // [{name, stem, ext, size, url}]
    order: [],            // play order (indices into files) — shuffled or linear
    pos: 0,               // position within order
    playing: false,
    repeat: 'off',        // off | all | one
    shuffle: false,
    muted: false,
    volume: 0.75,
    eqOn: true,
    eqGains: EQ_PRESETS['Flat'].slice(),
    eqPreset: 'Flat',
    themeTrack: null,     // {url, title, artist} injected by the theme engine
    audio: null,
    // web-audio graph (built lazily on first play — autoplay policy)
    ctx: null, srcNode: null, filters: [], analyser: null,
    _vizRaf: 0, _durCache: {},

    /* ── init ─────────────────────────────────────────────────────────── */
    init(audio) {
      this.audio = audio
      audio.crossOrigin = 'anonymous'          // needed for the analyser graph
      this._loadPrefs()
      audio.volume = this.muted ? 0 : this.volume

      audio.addEventListener('timeupdate', () => this._onTime())
      audio.addEventListener('ended',      () => this._onEnded())
      audio.addEventListener('loadedmetadata', () => this._onTime())
      audio.addEventListener('play',  () => this._setPlaying(true))
      audio.addEventListener('pause', () => this._setPlaying(false))

      document.getElementById('vol-slider')?.addEventListener('input', e => this.setVolume(e.target.value / 100))
      document.getElementById('mp-vol')?.addEventListener('input',    e => this.setVolume(e.target.value / 100))
      ;['music-prog', 'mp-prog'].forEach(id =>
        document.getElementById(id)?.addEventListener('input', e => this.seekPct(e.target.value)))

      this._mediaSession()
      this._syncVolumeUI()
      this._syncModeUI()
      this.refresh()
      // repaint visualizer colors when the theme changes
      if (window.ThemeEngine) ThemeEngine.on(() => this._renderEqUI())
    },

    async refresh() {
      try { this.files = await api('GET', '/api/assets/music') } catch { this.files = [] }
      window.G && (G.musicFiles = this.files)     // keep legacy readers working
      this._rebuildOrder()
      this.renderPlaylist()
      this._syncLabels()
    },

    /* ── playback core ────────────────────────────────────────────────── */
    _rebuildOrder(keepCurrent) {
      const cur = keepCurrent ? this.trackIndex() : null
      this.order = this.files.map((_, i) => i)
      if (this.shuffle) {
        // deterministic-ish Fisher-Yates is fine here; Math.random ok in renderer
        for (let i = this.order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[this.order[i], this.order[j]] = [this.order[j], this.order[i]]
        }
      }
      if (cur != null) {
        const p = this.order.indexOf(cur)
        if (p > 0) { this.order.splice(p, 1); this.order.unshift(cur) }
        this.pos = 0
      }
    },

    trackIndex() { return this.order.length ? this.order[this.pos] : -1 },
    track()      { return this.files[this.trackIndex()] || null },

    playAt(fileIdx) {
      if (!this.files.length) return
      this.themeTrack = null
      const p = this.order.indexOf(fileIdx)
      this.pos = p >= 0 ? p : 0
      this._load(true)
    },

    _load(autoplay) {
      const t = this.track()
      if (!t) return
      this._ensureGraph()
      this.audio.src = `${API}${t.url}`
      this.audio.load()
      window.G && (G.currentTrack = this.trackIndex())
      this._syncLabels()
      this.renderPlaylist()
      if (autoplay) this.audio.play().catch(() => {})
    },

    toggle() {
      if (this.audio.paused) {
        if (!this.audio.src && this.files.length) { this._load(true); return }
        this._ensureGraph()
        this.audio.play().catch(() => {})
      } else this.audio.pause()
    },

    next(fromEnded) {
      if (!this.order.length) return
      if (this.pos + 1 < this.order.length) { this.pos++; this._load(true) }
      else if (this.repeat === 'all' || !fromEnded) { this.pos = 0; this._load(true) }
      else this._setPlaying(false)                    // repeat off: stop at end
    },
    prev() {
      if (!this.order.length) return
      if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return }
      this.pos = (this.pos - 1 + this.order.length) % this.order.length
      this._load(true)
    },

    _onEnded() {
      if (this.repeat === 'one') { this.audio.currentTime = 0; this.audio.play().catch(()=>{}); return }
      this.next(true)
    },

    /* ── modes ────────────────────────────────────────────────────────── */
    cycleRepeat() {
      this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off'
      this._savePrefs(); this._syncModeUI()
      toast(`Repeat: ${this.repeat}`)
    },
    toggleShuffle() {
      this.shuffle = !this.shuffle
      this._rebuildOrder(true)
      this._savePrefs(); this._syncModeUI(); this.renderPlaylist()
      toast(this.shuffle ? 'Shuffle: on' : 'Shuffle: off')
    },

    setVolume(v) {
      this.volume = Math.min(1, Math.max(0, v))
      this.muted = false
      this.audio.volume = this.volume
      this._savePrefs(); this._syncVolumeUI()
    },
    toggleMute() {
      this.muted = !this.muted
      this.audio.volume = this.muted ? 0 : this.volume
      this._savePrefs(); this._syncVolumeUI()
    },

    seekPct(pct) {
      if (this.audio.duration) this.audio.currentTime = (pct / 100) * this.audio.duration
    },

    /* ── theme-linked track (called from applyThemeMusic) ─────────────── */
    playThemeTrack(url, title, artist) {
      const wasPlaying = this.playing
      this.themeTrack = { url, title, artist }
      this._ensureGraph()
      this.audio.src = url
      this.audio.load()
      this._syncLabels()
      if (wasPlaying) this.audio.play().catch(() => {})
    },

    /* ── equalizer (Web Audio) ────────────────────────────────────────── */
    _ensureGraph() {
      if (this.ctx) { this.ctx.resume?.().catch(()=>{}); return }
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)()
        this.srcNode = this.ctx.createMediaElementSource(this.audio)
        this.filters = EQ_BANDS.map((f, i) => {
          const flt = this.ctx.createBiquadFilter()
          flt.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
          flt.frequency.value = f
          flt.Q.value = 1
          flt.gain.value = this.eqOn ? this.eqGains[i] : 0
          return flt
        })
        this.analyser = this.ctx.createAnalyser()
        this.analyser.fftSize = 128
        let node = this.srcNode
        for (const f of this.filters) { node.connect(f); node = f }
        node.connect(this.analyser)
        this.analyser.connect(this.ctx.destination)
        this._startViz()
      } catch { this.ctx = null }   // graph is an enhancement — audio still plays
    },

    setEqGain(band, db) {
      this.eqGains[band] = +db
      this.eqPreset = 'Custom'
      if (this.filters[band] && this.eqOn) this.filters[band].gain.value = +db
      this._savePrefs(); this._renderEqUI(true)
    },
    setEqPreset(name) {
      if (!EQ_PRESETS[name]) return
      this.eqPreset = name
      this.eqGains = EQ_PRESETS[name].slice()
      this.filters.forEach((f, i) => f.gain.value = this.eqOn ? this.eqGains[i] : 0)
      this._savePrefs(); this._renderEqUI()
    },
    toggleEq() {
      this.eqOn = !this.eqOn
      this.filters.forEach((f, i) => f.gain.value = this.eqOn ? this.eqGains[i] : 0)
      this._savePrefs(); this._renderEqUI()
    },

    /* ── visualizer ───────────────────────────────────────────────────── */
    _startViz() {
      cancelAnimationFrame(this._vizRaf)
      const buf = new Uint8Array(this.analyser.frequencyBinCount)
      const draw = () => {
        this._vizRaf = requestAnimationFrame(draw)
        if (!this.playing) return
        this.analyser.getByteFrequencyData(buf)
        this._drawBars('mp-viz', buf, 48)
        this._drawBars('rail-viz', buf, 28)
      }
      draw()
    },
    _drawBars(id, buf, nBars) {
      const c = document.getElementById(id)
      if (!c || !c.offsetParent) return                  // skip hidden canvases
      const W = c.offsetWidth, H = c.offsetHeight
      if (!W || !H) return
      if (c.width !== W) c.width = W
      if (c.height !== H) c.height = H
      const ctx = c.getContext('2d')
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0ff'
      const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#f0f'
      ctx.clearRect(0, 0, W, H)
      const step = Math.floor(buf.length / nBars) || 1
      const bw = W / nBars
      for (let i = 0; i < nBars; i++) {
        const v = buf[i * step] / 255
        const h = Math.max(2, v * H)
        const g = ctx.createLinearGradient(0, H - h, 0, H)
        g.addColorStop(0, accent2); g.addColorStop(1, accent)
        ctx.fillStyle = g
        ctx.globalAlpha = 0.35 + v * 0.65
        ctx.fillRect(i * bw + 1, H - h, bw - 2, h)
      }
      ctx.globalAlpha = 1
    },

    /* ── UI sync ──────────────────────────────────────────────────────── */
    _setPlaying(on) {
      this.playing = on
      window.G && (G.musicPlaying = on)
      ;['music-pp', 'mp-play'].forEach(id => {
        const el = document.getElementById(id)
        if (el) el.textContent = on ? '⏸' : '▶'
      })
      document.getElementById('mp-cover-wrap')?.classList.toggle('spinning', on)
      document.getElementById('music-art')?.classList.toggle('pulse', on)
    },

    _onTime() {
      const a = this.audio
      const pct = a.duration ? (a.currentTime / a.duration) * 100 : 0
      ;['music-prog', 'mp-prog'].forEach(id => {
        const el = document.getElementById(id)
        if (el && document.activeElement !== el) el.value = pct
      })
      sTxt('mp-cur', fmtTime(a.currentTime))
      sTxt('mp-dur', fmtTime(a.duration))
    },

    _syncLabels() {
      let title, artist
      if (this.themeTrack) { title = this.themeTrack.title; artist = this.themeTrack.artist }
      else {
        const t = this.track()
        title = t ? (t.stem || t.name) : 'No Track'
        artist = t ? `Track ${this.pos + 1}/${this.order.length}` : `assets/music (${this.files.length})`
      }
      ;['music-track', 'mp-title'].forEach(id => sTxt(id, title))
      ;['music-artist', 'mp-artist'].forEach(id => sTxt(id, artist))
      this._loadCover()
      this._mediaSessionMeta(title, artist)
    },

    _syncModeUI() {
      const rep = document.getElementById('mp-repeat')
      if (rep) {
        rep.classList.toggle('on', this.repeat !== 'off')
        rep.textContent = this.repeat === 'one' ? '🔂' : '🔁'
        rep.title = `Repeat: ${this.repeat}`
      }
      const sh = document.getElementById('mp-shuffle')
      if (sh) sh.classList.toggle('on', this.shuffle)
    },

    _syncVolumeUI() {
      ;['vol-slider', 'mp-vol'].forEach(id => {
        const el = document.getElementById(id)
        if (el) el.value = this.muted ? 0 : this.volume * 100
      })
      const mute = document.getElementById('mp-mute')
      if (mute) mute.textContent = this.muted || this.volume === 0 ? '🔇' : this.volume < 0.5 ? '🔉' : '🔊'
    },

    /* album cover: assets/music/<stem>.jpg|png|webp, else generated art */
    _loadCover() {
      const wrap = document.getElementById('mp-cover')
      const t = this.track()
      if (!wrap) return
      const fallback = () => {
        wrap.style.backgroundImage = ''
        wrap.classList.add('mp-cover-fallback')
        wrap.textContent = '♪'
      }
      if (!t || this.themeTrack) { fallback(); return }
      let i = 0
      const tryNext = () => {
        if (i >= COVER_EXTS.length) { fallback(); return }
        const url = `${API}/assets/music/${encodeURIComponent(t.stem)}.${COVER_EXTS[i++]}`
        const img = new Image()
        img.onload = () => {
          wrap.classList.remove('mp-cover-fallback')
          wrap.textContent = ''
          wrap.style.backgroundImage = `url('${url}')`
        }
        img.onerror = tryNext
        img.src = url
      }
      tryNext()
    },

    /* ── playlist rendering (media page + right-rail trp panel) ───────── */
    renderPlaylist() {
      const list = document.getElementById('mp-playlist')
      if (list) {
        if (!this.files.length) {
          list.innerHTML = '<div class="mp-empty">📂 assets/music/ خالی است<br>MP3، OGG، WAV یا FLAC اضافه کنید</div>'
        } else {
          const cur = this.trackIndex()
          list.innerHTML = this.order.map((fi, oi) => {
            const f = this.files[fi]
            const active = fi === cur
            return `<div class="mp-item ${active ? 'active' : ''}" onclick="Music.playAt(${fi})">
              <span class="mp-item-ico">${active && this.playing ? '<span class="mp-eq-anim"><i></i><i></i><i></i></span>' : (oi + 1)}</span>
              <div class="mp-item-info">
                <div class="mp-item-name">${esc(f.stem || f.name)}</div>
                <div class="mp-item-meta">${f.ext.toUpperCase()} · ${fmtBytes(f.size)} · <span id="mp-dur-${fi}">${this._durCache[fi] || '—'}</span></div>
              </div>
              <span class="mp-item-act">${active ? '▶' : ''}</span>
            </div>`
          }).join('')
          this._fillDurations()
        }
      }
      sTxt('mp-count', `${this.files.length} tracks`)
      // legacy terminal-panel list
      if (typeof renderTrpMusic === 'function') renderTrpMusic()
    },

    /* lazily read duration metadata, one probe at a time */
    async _fillDurations() {
      for (let i = 0; i < this.files.length; i++) {
        if (this._durCache[i]) { continue }
        const dur = await new Promise(res => {
          const a = new Audio()
          a.preload = 'metadata'
          a.onloadedmetadata = () => res(a.duration)
          a.onerror = () => res(null)
          a.src = `${API}${this.files[i].url}`
        })
        if (dur) {
          this._durCache[i] = fmtTime(dur)
          sTxt(`mp-dur-${i}`, this._durCache[i])
        } else this._durCache[i] = '—'
      }
    },

    _renderEqUI(skipSliders) {
      const box = document.getElementById('mp-eq-bands')
      if (!box) return
      if (!box.children.length || !skipSliders) {
        box.innerHTML = this.eqGains.map((g, i) => `
          <div class="mp-eq-band">
            <input type="range" class="mp-eq-slider" min="-10" max="10" step="1" value="${g}"
              oninput="Music.setEqGain(${i}, this.value)">
            <span class="mp-eq-freq">${EQ_BANDS[i] >= 1000 ? (EQ_BANDS[i]/1000)+'k' : EQ_BANDS[i]}</span>
          </div>`).join('')
      }
      const sel = document.getElementById('mp-eq-preset')
      if (sel) {
        if (!sel.children.length)
          sel.innerHTML = Object.keys(EQ_PRESETS).map(p => `<option>${p}</option>`).join('') + '<option>Custom</option>'
        sel.value = this.eqPreset
      }
      const tog = document.getElementById('mp-eq-toggle')
      if (tog) { tog.classList.toggle('on', this.eqOn); tog.textContent = this.eqOn ? 'EQ ON' : 'EQ OFF' }
      box.classList.toggle('disabled', !this.eqOn)
    },

    /* ── OS media keys (background playback control) ──────────────────── */
    _mediaSession() {
      if (!('mediaSession' in navigator)) return
      navigator.mediaSession.setActionHandler('play',          () => this.toggle())
      navigator.mediaSession.setActionHandler('pause',         () => this.toggle())
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prev())
      navigator.mediaSession.setActionHandler('nexttrack',     () => this.next())
    },
    _mediaSessionMeta(title, artist) {
      if (!('mediaSession' in navigator)) return
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title || 'CyberSuite', artist: artist || '', album: 'Johnny CyberSuite X',
        })
      } catch {}
    },

    /* ── persistence ──────────────────────────────────────────────────── */
    _savePrefs() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({
          volume: this.volume, muted: this.muted, repeat: this.repeat,
          shuffle: this.shuffle, eqOn: this.eqOn, eqGains: this.eqGains, eqPreset: this.eqPreset,
        }))
      } catch {}
    },
    _loadPrefs() {
      try {
        const p = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
        if (typeof p.volume === 'number') this.volume = p.volume
        this.muted   = !!p.muted
        this.repeat  = ['off','all','one'].includes(p.repeat) ? p.repeat : 'off'
        this.shuffle = !!p.shuffle
        this.eqOn    = p.eqOn !== false
        if (Array.isArray(p.eqGains) && p.eqGains.length === EQ_BANDS.length) this.eqGains = p.eqGains
        this.eqPreset = p.eqPreset || 'Flat'
      } catch {}
    },

    /* called when the Media page opens */
    enterPage() {
      this._syncModeUI(); this._syncVolumeUI(); this._renderEqUI()
      this._syncLabels(); this.renderPlaylist()
    },
  }

  function fmtTime(s) {
    if (!s || !isFinite(s)) return '0:00'
    const m = Math.floor(s / 60), sec = Math.floor(s % 60)
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  /* legacy global API (HTML onclick handlers) */
  window.Music = M
  window.musicPP    = () => M.toggle()
  window.musicPrev  = () => M.prev()
  window.musicNext  = () => M.next()
  window.playTrack  = i => M.playAt(i)
  window.playFromMedia = i => M.playAt(i)
})()
