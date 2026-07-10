/* JotSON - client app (Vue 3, no build step) */
/* global Vue */

const { createApp } = Vue

const DEFAULT_LABEL_FIELDS = ['title', 'label', 'name', 'id']
const IMG_RE = /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i
const VID_RE = /\.(mp4|webm|mov|ogg)(\?.*)?$/i
const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

function typeOf(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v // string | number | boolean | object
}

/* JSON has no date type - dates/datetimes are strings detected by pattern. */
function dateKind(v) {
  if (DATE_ONLY_RE.test(v)) return 'date'
  if (DATETIME_RE.test(v)) return 'datetime'
  return null
}

function displayType(v) {
  const t = typeOf(v)
  if (t !== 'string') return t
  if (COLOR_RE.test(v)) return 'color'
  return dateKind(v) || 'string'
}

/* Native color inputs only accept #rrggbb - expand shorthand #rgb */
function toHex6(v) {
  const m = String(v).trim().match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)
  if (m) return ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase()
  return String(v).toLowerCase()
}

const pad2 = (n) => String(n).padStart(2, '0')

function youtubeEmbed(v) {
  const m = v.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/)
  return m ? 'https://www.youtube.com/embed/' + m[1] : null
}

function vimeoEmbed(v) {
  const m = v.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  return m ? 'https://player.vimeo.com/video/' + m[1] : null
}

const unfurlCache = new Map()

function relTime(d) {
  const diff = d.getTime() - Date.now()
  const units = [
    ['year', 31536e6],
    ['month', 2592e6],
    ['day', 864e5],
    ['hour', 36e5],
    ['minute', 6e4],
    ['second', 1e3]
  ]
  for (const [unit, ms] of units) {
    if (Math.abs(diff) >= ms || unit === 'second') {
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(diff / ms), unit)
    }
  }
}

function dateFormats(v, dk) {
  // Date-only values are anchored at local midnight for timestamp math
  const d = new Date(dk === 'date' ? v + 'T00:00:00' : v)
  if (isNaN(d)) return []
  return [
    { label: 'RFC 3339 (UTC)', value: d.toISOString() },
    { label: 'Unix', value: String(Math.floor(d.getTime() / 1000)) },
    { label: 'Unix (ms)', value: String(d.getTime()) },
    { label: 'UTC', value: d.toUTCString() },
    { label: 'Relative', value: relTime(d) }
  ]
}

function toLocalDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function toLocalDatetime(d) {
  return `${toLocalDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v))
}

function genId() {
  return crypto.randomUUID()
}

/* Recursively replace every string "id" field with a freshly generated one. */
function regenerateIds(node) {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    node.forEach(regenerateIds)
    return node
  }
  if (typeof node.id === 'string') node.id = genId()
  for (const k of Object.keys(node)) regenerateIds(node[k])
  return node
}

function blankClone(v) {
  const t = typeOf(v)
  if (t === 'string') return ''
  if (t === 'number') return 0
  if (t === 'boolean') return false
  if (t === 'null') return null
  if (t === 'array') return []
  const out = {}
  for (const k of Object.keys(v)) out[k] = blankClone(v[k])
  return out
}

function getNode(doc, path) {
  let node = doc
  for (const seg of path) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[seg]
    if (node === undefined) return undefined
  }
  return node
}

function serialize(doc) {
  return JSON.stringify(doc, null, 2) + '\n'
}

/* Number of lines a value occupies in 2-space pretty-printed JSON. */
function lineCount(v) {
  const t = typeOf(v)
  if (t !== 'object' && t !== 'array') return 1
  const children = t === 'array' ? v : Object.values(v)
  if (!children.length) return 1 // "{}" / "[]"
  let n = 2 // opening + closing brace lines
  for (const c of children) n += lineCount(c)
  return n
}

/* 0-based line where the node at `path` starts in serialize(doc). */
function lineOfPath(doc, path) {
  let line = 0
  let node = doc
  for (const seg of path) {
    const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node)
    let l = line + 1
    for (const k of keys) {
      if (k === seg) break
      l += lineCount(node[k])
    }
    line = l
    node = node[seg]
  }
  return line
}

function truncate(s, n) {
  s = String(s).replace(/\n/g, '↵ ')
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function friendlyLabel(v, fields = DEFAULT_LABEL_FIELDS) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  for (const f of fields) {
    if (v[f] !== undefined && v[f] !== null && typeof v[f] !== 'object') return String(v[f])
  }
  return null
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* Tokenize JSON text into highlighted HTML (strings/numbers/keywords/punct). */
function highlightJson(text) {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g
  let out = ''
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index))
    if (m[1] !== undefined) {
      const cls = m[2] ? 'hl-key' : 'hl-str'
      out += `<span class="${cls}">${escapeHtml(m[1])}</span>${m[2] ? escapeHtml(m[2]) : ''}`
    } else if (m[3] !== undefined) {
      out += `<span class="hl-num">${escapeHtml(m[3])}</span>`
    } else {
      out += `<span class="hl-kw">${escapeHtml(m[4])}</span>`
    }
    last = m.index + m[0].length
  }
  out += escapeHtml(text.slice(last))
  return out + '\n'
}

/* Line diff: trim common prefix/suffix, LCS on the middle when affordable. */
function diffLines(aText, bText) {
  const a = aText.split('\n')
  const b = bText.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const ops = []
  for (let i = 0; i < start; i++) ops.push({ kind: 'same', text: a[i] })

  if (midA.length * midB.length <= 400000) {
    // LCS dynamic programming
    const n = midA.length
    const m = midB.length
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ kind: 'same', text: midA[i] })
        i++
        j++
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ kind: 'del', text: midA[i++] })
      } else {
        ops.push({ kind: 'add', text: midB[j++] })
      }
    }
    while (i < n) ops.push({ kind: 'del', text: midA[i++] })
    while (j < m) ops.push({ kind: 'add', text: midB[j++] })
  } else {
    for (const line of midA) ops.push({ kind: 'del', text: line })
    for (const line of midB) ops.push({ kind: 'add', text: line })
  }

  for (let i = endA; i < a.length; i++) ops.push({ kind: 'same', text: a[i] })
  return ops
}

/* Group diff ops into hunks with `ctx` lines of context around changes. */
function buildHunks(ops, ctx = 2) {
  const keep = new Array(ops.length).fill(false)
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].kind !== 'same') {
      for (let j = Math.max(0, i - ctx); j <= Math.min(ops.length - 1, i + ctx); j++) keep[j] = true
    }
  }
  const hunks = []
  let cur = null
  for (let i = 0; i < ops.length; i++) {
    if (keep[i]) {
      if (!cur) {
        cur = []
        hunks.push(cur)
      }
      cur.push(ops[i])
    } else {
      cur = null
    }
  }
  return hunks
}

async function api(path, opts) {
  const res = await fetch(path, opts)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`)
  return data
}

createApp({
  data() {
    return {
      files: [],
      active: '',
      store: {}, // name -> { doc, diskText, prettyBase }
      dirtyMap: {},
      selPath: [],
      selPaths: (() => {
        // remembered selection per file, persisted across reloads
        try {
          return JSON.parse(localStorage.getItem('cms.selPaths')) || {}
        } catch {
          return {}
        }
      })(),
      view: 'columns',
      renameKeyName: '',
      editingKey: false,
      addingKeyAt: null,
      addKeyDraft: '',
      ctxMenu: { open: false, mode: 'main', x: 0, y: 0 },
      // raw view
      rawText: '',
      rawBase: '',
      // search
      searchOpen: false,
      searchQuery: '',
      searchSel: 0,
      searchIndex: null,
      // diff/save
      diffOpen: false,
      diffHunks: [],
      diffAdds: 0,
      diffDels: 0,
      pendingSaveText: '',
      saving: false,
      // misc
      settingsOpen: false,
      theme: localStorage.getItem('cms.theme') || 'dark',
      unfurl: { url: null, loading: false, data: null },
      unfurlTimer: null,
      inspWidth: Number(localStorage.getItem('cms.inspWidth')) || 360,
      config: { dataDir: '', publicDir: '', logo: null, logoLight: null, title: '', labelFields: 'title, label, name, id' },
      configPath: 'jotson.config.json',
      cfgDraft: { dataDir: '', publicDir: '', logo: '', logoLight: '', title: '', labelFields: '' },
      cfgSaving: false,
      labelFields: DEFAULT_LABEL_FIELDS,
      toasts: [],
      undoStacks: {}, // name -> { undo: [], redo: [] }
      lastSnap: { key: '', time: 0 }
    }
  },

  computed: {
    doc() {
      return this.store[this.active] ? this.store[this.active].doc : undefined
    },

    canUndo() {
      const stacks = this.undoStacks[this.active]
      return !!(stacks && stacks.undo.length)
    },

    canRenameKey() {
      return this.selPath.length > 0 && !this.parentIsArray
    },

    brandLogo() {
      if (this.theme === 'light' && this.config.logoLight) return this.config.logoLight
      return this.config.logo
    },

    ctxLabel() {
      if (!this.selPath.length) return this.active
      return truncate(this.segLabel(this.selPath[this.selPath.length - 1], this.selPath.length - 1), 28)
    },

    ctxKeyName() {
      return this.selPath.length ? String(this.selPath[this.selPath.length - 1]) : ''
    },

    /* "Duplicate into…" applies when the right-clicked key lives in an object that is an array item */
    ctxCanDupInto() {
      return (
        this.selPath.length >= 2 &&
        !this.parentIsArray &&
        typeof this.selPath[this.selPath.length - 2] === 'number' &&
        Array.isArray(getNode(this.doc, this.selPath.slice(0, -2)))
      )
    },

    ctxSiblings() {
      if (!this.ctxCanDupInto) return []
      const arr = getNode(this.doc, this.selPath.slice(0, -2))
      const srcIndex = this.selPath[this.selPath.length - 2]
      return arr
        .map((item, i) => ({
          i,
          label: truncate(friendlyLabel(item, this.labelFields) || `[${i}]`, 32),
          isObject: item !== null && typeof item === 'object' && !Array.isArray(item)
        }))
        .filter((s) => s.i !== srcIndex && s.isObject)
    },

    cfgDirty() {
      const c = this.config
      const d = this.cfgDraft
      const draftFields = (d.labelFields || '').split(',').map((f) => f.trim()).filter(Boolean)
      return (
        d.dataDir !== c.dataDir ||
        d.publicDir !== c.publicDir ||
        (d.logo || '') !== (c.logo || '') ||
        (d.logoLight || '') !== (c.logoLight || '') ||
        d.title !== c.title ||
        JSON.stringify(draftFields) !== JSON.stringify(c.labelFields || [])
      )
    },

    columns() {
      const cols = []
      if (this.doc === undefined) return cols
      let node = this.doc
      for (let d = 0; d <= this.selPath.length; d++) {
        const t = typeOf(node)
        if (t !== 'object' && t !== 'array') break
        const title = d === 0 ? this.active : this.segLabel(this.selPath[d - 1], d - 1)
        const entries = []
        if (t === 'array') {
          node.forEach((v, i) => {
            const vt = displayType(v)
            const fl = friendlyLabel(v, this.labelFields)
            entries.push({
              key: i,
              label: fl || `[${i}]`,
              type: vt,
              // Avoid repeating the friendly label in the preview slot
              preview: fl && vt === 'object' ? Object.keys(v).length + ' keys' : this.entryPreview(v, vt)
            })
          })
        } else {
          for (const k of Object.keys(node)) {
            const v = node[k]
            const vt = displayType(v)
            entries.push({ key: k, label: k, type: vt, preview: this.entryPreview(v, vt) })
          }
        }
        cols.push({ title: truncate(title, 30), type: t, entries })
        if (d < this.selPath.length) {
          node = node[this.selPath[d]]
          if (node === undefined) break
        }
      }
      return cols
    },

    selected() {
      if (this.doc === undefined) return null
      const v = getNode(this.doc, this.selPath)
      if (v === undefined) return null
      return { value: v, type: displayType(v) }
    },

    colorHex6() {
      return this.selected ? toHex6(this.selected.value) : '#000000'
    },

    /* datetime-local inputs hold minutes precision; keep any seconds/zone suffix intact */
    dtLocalValue() {
      return this.selected ? String(this.selected.value).slice(0, 16) : ''
    },

    dtSuffix() {
      const v = this.selected ? String(this.selected.value) : ''
      return v.length > 16 ? v.slice(16) : ''
    },

    parentIsArray() {
      if (!this.selPath.length) return false
      return typeOf(getNode(this.doc, this.selPath.slice(0, -1))) === 'array'
    },

    tipIndex() {
      return this.selPath.length ? this.selPath[this.selPath.length - 1] : -1
    },

    parentLength() {
      const p = getNode(this.doc, this.selPath.slice(0, -1))
      return Array.isArray(p) ? p.length : 0
    },

    preview() {
      if (!this.selected || typeOf(this.selected.value) !== 'string') return null
      const v = this.selected.value
      if (!v) return null
      if (IMG_RE.test(v)) return { kind: 'image', value: v, url: this.resolveUrl(v) }
      if (VID_RE.test(v)) return { kind: 'video', value: v, url: this.resolveUrl(v) }
      if (COLOR_RE.test(v)) return { kind: 'color', value: v }
      const embed = youtubeEmbed(v) || vimeoEmbed(v)
      if (embed) return { kind: 'embed', value: v, url: v, embedUrl: embed, internal: false }
      const dk = dateKind(v)
      if (dk) {
        const d = new Date(dk === 'date' ? v + 'T12:00:00' : v)
        if (!isNaN(d)) {
          const dateOpts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
          return {
            kind: 'date',
            value: v,
            dk,
            human:
              dk === 'date'
                ? d.toLocaleDateString('en-US', dateOpts)
                : d.toLocaleString('en-US', { ...dateOpts, hour: 'numeric', minute: '2-digit' }),
            formats: dateFormats(v, dk)
          }
        }
      }
      if (/^https?:\/\//.test(v)) return { kind: 'url', value: v, url: v, internal: false }
      if (/^\//.test(v)) return { kind: 'url', value: v, url: v, internal: true }
      if (v.includes('\n')) return { kind: 'multiline', value: v }
      return null
    },

    rawError() {
      try {
        JSON.parse(this.rawText)
        return null
      } catch (e) {
        return e.message
      }
    },

    rawohanged() {
      return this.rawText !== this.rawBase
    },

    rawHighlight() {
      if (this.rawText.length > 150000) return null
      return highlightJson(this.rawText)
    },

    searchResults() {
      const q = this.searchQuery.trim().toLowerCase()
      if (!q || !this.searchIndex) return []
      const tokens = q.split(/\s+/)
      const scored = []
      for (const entry of this.searchIndex) {
        let score = 0
        let ok = true
        for (const tok of tokens) {
          if (entry.key.includes(tok)) score += 5
          else if (entry.val.includes(tok)) score += 3
          else if (entry.pathStr.includes(tok)) score += 2
          else {
            ok = false
            break
          }
        }
        if (ok) scored.push({ score, entry })
      }
      scored.sort((x, y) => y.score - x.score)
      return scored.slice(0, 50).map((s) => s.entry)
    }
  },

  watch: {
    preview(p) {
      this.scheduleUnfurl(p)
    },
    searchQuery() {
      this.searchSel = 0
    },
    selPath() {
      this.syncRename()
      this.editingKey = false
      this.persistNav()
      this.$nextTick(() => {
        this.resizeStrEditor()
        const el = this.$refs.columnsEl
        if (el) el.scrollLeft = el.scrollWidth
      })
    },
    selected() {
      this.$nextTick(() => this.resizeStrEditor())
    }
  },

  async mounted() {
    document.body.classList.toggle('light', this.theme === 'light')
    window.addEventListener('keydown', this.onKeydown)
    window.addEventListener('beforeunload', (e) => {
      if (Object.values(this.dirtyMap).some(Boolean)) e.preventDefault()
    })
    // Close the settings popover on any click outside it (the ⚙ button handles its own toggle)
    window.addEventListener('click', (e) => {
      // Clicks inside the context menu are handled by its items (the submenu must survive them)
      if (!e.target.closest('.ctx-menu')) this.ctxMenu.open = false
      if (!this.settingsOpen) return
      if (e.target.closest('.settings-pop') || e.target.closest('button[title="Settings"]')) return
      this.closeSettings()
    })
    try {
      const { config, configPath } = await api('/api/config')
      this.config = config
      if (configPath) this.configPath = configPath
      this.setCfgDraft(config)
      if (config.labelFields && config.labelFields.length) this.labelFields = config.labelFields
      document.title = config.title === '' ? config.jotsonBrand : config.jotsonBrand + ' - ' + config.title
      const { files } = await api('/api/files')
      this.files = files
      await Promise.all(files.map((f) => this.loadFile(f.name)))
      if (files.length) {
        const saved = localStorage.getItem('cms.active')
        this.active = files.some((f) => f.name === saved) ? saved : files[0].name
        this.selPath = this.selPaths[this.active] || []
        this.sanitizeSelPath()
      }
    } catch (e) {
      this.toast('Failed to load: ' + e.message, 'error')
    }
  },

  methods: {
    /* ---------- loading / files ---------- */
    async loadFile(name) {
      const { text } = await api('/api/files/' + encodeURIComponent(name))
      // Normalize to LF internally; remember the file's EOL style to preserve it on save.
      // Strip a UTF-8 BOM if present (JSON.parse rejects it; saves are written without one).
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      const lfText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
      const doc = JSON.parse(lfText)
      this.store[name] = { doc, diskText: lfText, prettyBase: serialize(doc), eol }
      this.dirtyMap[name] = false
      if (!this.undoStacks[name]) this.undoStacks[name] = { undo: [], redo: [] }
      this.searchIndex = null
    },

    openFile(name) {
      if (name === this.active) return
      this.selPaths[this.active] = this.selPath
      this.active = name
      this.selPath = this.selPaths[name] || []
      this.sanitizeSelPath()
      this.persistNav()
      if (this.view === 'raw') this.enterRaw()
    },

    shortName(name) {
      return name.replace(/\.json$/, '')
    },

    isDirty(name) {
      return !!this.dirtyMap[name]
    },

    refreshDirty() {
      const s = this.store[this.active]
      if (s) this.dirtyMap[this.active] = serialize(s.doc) !== s.prettyBase
      this.searchIndex = null
    },

    /* ---------- columns / selection ---------- */
    entryPreview(v, vt) {
      if (vt === 'array') return v.length + (v.length === 1 ? ' item' : ' items')
      if (vt === 'object') {
        const fl = friendlyLabel(v, this.labelFields)
        return fl ? truncate(fl, 40) : Object.keys(v).length + ' keys'
      }
      if (vt === 'null') return 'null'
      if (vt === 'string') return truncate(v, 46)
      return String(v)
    },

    segLabel(seg, i) {
      if (typeof seg !== 'number') return seg
      const node = getNode(this.doc, this.selPath.slice(0, i + 1))
      const fl = friendlyLabel(node, this.labelFields)
      return fl ? `${seg} · ${truncate(fl, 24)}` : `[${seg}]`
    },

    typeGlyph(t) {
      return (
        {
          string: '“ ”',
          number: '#',
          boolean: '◐',
          null: '∅',
          object: '{}',
          array: '[]',
          date: '📅',
          datetime: '🕓',
          color: '🎨'
        }[t] || '?'
      )
    },

    isOnPath(ci, key) {
      return this.selPath[ci] === key
    },

    isTip(ci, key) {
      return ci === this.selPath.length - 1 && this.selPath[ci] === key
    },

    selectCell(ci, key) {
      // Clicking the cell already on the path selects that node itself (collapses the tail)
      if (this.selPath[ci] === key) {
        this.selPath = this.selPath.slice(0, ci + 1)
        return
      }
      // Switching to a sibling: keep the relative sub-path as far as it exists in the new node
      const base = [...this.selPath.slice(0, ci), key]
      for (const seg of this.selPath.slice(ci + 1)) {
        if (getNode(this.doc, [...base, seg]) === undefined) break
        base.push(seg)
      }
      this.selPath = base
    },

    /* Ctrl+Up/Down: jump to the previous/next sibling of the deepest array item
       on the current path, preserving the relative sub-path (e.g. photoUrl). */
    switchSibling(dir) {
      if (!this.selPath.length) return
      for (let i = this.selPath.length - 1; i >= 0; i--) {
        if (typeof this.selPath[i] !== 'number') continue
        const parent = getNode(this.doc, this.selPath.slice(0, i))
        if (!Array.isArray(parent)) continue
        const next = this.selPath[i] + dir
        if (next < 0 || next >= parent.length) return // clamp at the ends
        this.applySiblingSwitch(i, next)
        return
      }
      // Pure object path (no array anywhere): switch the tip's parent key,
      // e.g. themes.yw.brand_primary -> themes.fleet.brand_primary
      const i = Math.max(0, this.selPath.length - 2)
      const parent = getNode(this.doc, this.selPath.slice(0, i))
      if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) return
      const keys = Object.keys(parent)
      const idx = keys.indexOf(this.selPath[i]) + dir
      if (idx < 0 || idx >= keys.length) return // clamp at the ends
      this.applySiblingSwitch(i, keys[idx])
    },

    applySiblingSwitch(i, seg) {
      const base = [...this.selPath.slice(0, i), seg]
      for (const s of this.selPath.slice(i + 1)) {
        if (getNode(this.doc, [...base, s]) === undefined) break
        base.push(s)
      }
      this.selPath = base
    },

    copyPath() {
      let p = '$'
      for (const seg of this.selPath) {
        p += typeof seg === 'number' ? `[${seg}]` : `.${seg}`
      }
      navigator.clipboard.writeText(p)
      this.toast('Copied path: ' + p)
    },

    persistNav() {
      this.selPaths[this.active] = this.selPath
      localStorage.setItem('cms.selPaths', JSON.stringify(this.selPaths))
      localStorage.setItem('cms.active', this.active)
    },

    syncRename() {
      if (this.selPath.length && !this.parentIsArray) {
        this.renameKeyName = String(this.selPath[this.selPath.length - 1])
      } else {
        this.renameKeyName = ''
      }
    },

    resizeStrEditor() {
      const el = this.$refs.strEditor
      if (el) {
        el.style.height = 'auto'
        el.style.height = Math.min(el.scrollHeight + 2, 400) + 'px'
      }
    },

    resolveUrl(v) {
      // Site-relative media is served by the CMS server from the project's public/ dir
      return v.startsWith('/') ? '/site' + v : v
    },

    /* ---------- undo / snapshots ---------- */
    snapshot(coalesceKey) {
      const stacks = this.undoStacks[this.active]
      const now = Date.now()
      if (coalesceKey && this.lastSnap.key === this.active + '|' + coalesceKey && now - this.lastSnap.time < 900) {
        this.lastSnap.time = now
        return
      }
      stacks.undo.push(JSON.stringify(this.store[this.active].doc))
      if (stacks.undo.length > 100) stacks.undo.shift()
      stacks.redo = []
      this.lastSnap = { key: coalesceKey ? this.active + '|' + coalesceKey : '', time: now }
    },

    /* Trim the selection back to the nearest ancestor that still exists. */
    sanitizeSelPath() {
      const p = [...this.selPath]
      while (p.length && getNode(this.doc, p) === undefined) p.pop()
      this.selPath = p
    },

    undo() {
      const stacks = this.undoStacks[this.active]
      if (!stacks || !stacks.undo.length) return
      stacks.redo.push(JSON.stringify(this.store[this.active].doc))
      this.store[this.active].doc = JSON.parse(stacks.undo.pop())
      this.lastSnap = { key: '', time: 0 }
      this.sanitizeSelPath()
      this.refreshDirty()
      if (this.view === 'raw') this.enterRaw()
    },

    redo() {
      const stacks = this.undoStacks[this.active]
      if (!stacks || !stacks.redo.length) return
      stacks.undo.push(JSON.stringify(this.store[this.active].doc))
      this.store[this.active].doc = JSON.parse(stacks.redo.pop())
      this.lastSnap = { key: '', time: 0 }
      this.sanitizeSelPath()
      this.refreshDirty()
      if (this.view === 'raw') this.enterRaw()
    },

    /* ---------- editing ---------- */
    setValue(v) {
      if (!this.selPath.length) return
      this.snapshot('value:' + this.selPath.join('/'))
      const parent = getNode(this.doc, this.selPath.slice(0, -1))
      parent[this.selPath[this.selPath.length - 1]] = v
      this.refreshDirty()
      this.$nextTick(() => this.resizeStrEditor())
    },

    changeType(e) {
      const t = e.target.value
      if (!this.selPath.length || !this.selected) return
      const cur = this.selected.value
      const curT = this.selected.type
      if (t === curT) return
      // Converting a non-empty container destroys its contents - confirm first
      if (curT === 'object' || curT === 'array') {
        const count = curT === 'array' ? cur.length : Object.keys(cur).length
        const what = curT === 'array' ? 'items' : 'keys'
        if (count && !window.confirm(`Convert this ${curT} (${count} ${what}) to ${t}? Its contents will be lost.`)) {
          e.target.value = curT // roll the dropdown back
          return
        }
      }
      // date/datetime are stored as strings - switching between them and string is a value tweak
      let v
      if (t === 'string') {
        if (curT === 'date' || curT === 'datetime' || curT === 'color') return // already a string; detection is automatic
        v = curT === 'object' || curT === 'array' ? JSON.stringify(cur) : String(cur ?? '')
      } else if (t === 'color') {
        v = COLOR_RE.test(String(cur)) ? String(cur) : '#000000'
      } else if (t === 'date') {
        if (curT === 'datetime') v = String(cur).slice(0, 10)
        else {
          const d = new Date(cur)
          v = typeof cur === 'string' && !isNaN(d) ? toLocalDate(d) : toLocalDate(new Date())
        }
      } else if (t === 'datetime') {
        if (curT === 'date') v = cur + 'T12:00'
        else {
          const d = new Date(cur)
          v = typeof cur === 'string' && !isNaN(d) ? toLocalDatetime(d) : toLocalDatetime(new Date())
        }
      } else if (t === 'number') v = Number(cur) || 0
      else if (t === 'boolean') v = cur === 'false' ? false : Boolean(cur)
      else if (t === 'null') v = null
      else if (t === 'object') v = {}
      else v = []
      this.snapshot()
      const parent = getNode(this.doc, this.selPath.slice(0, -1))
      parent[this.selPath[this.selPath.length - 1]] = v
      this.refreshDirty()
    },

    addItemAt(ci) {
      this.pushItem(this.selPath.slice(0, ci))
    },

    pushItem(prefix) {
      const arr = getNode(this.doc, prefix)
      if (!Array.isArray(arr)) return
      this.snapshot()
      arr.push(arr.length ? regenerateIds(blankClone(arr[arr.length - 1])) : '')
      this.selPath = [...prefix, arr.length - 1]
      this.refreshDirty()
      this.toast('Added item - fields cloned from the last item, values blanked, fresh id generated')
    },

    addKeyAt(ci) {
      this.addingKeyAt = ci
      this.addKeyDraft = ''
      this.$nextTick(() => {
        // refs inside v-for are arrays; only one inline input exists at a time
        const el = this.$refs.inlineKeyInput
        const input = Array.isArray(el) ? el[0] : el
        if (input) input.focus()
      })
    },

    commitAddKey(ci) {
      const name = this.addKeyDraft.trim()
      if (!name) {
        this.cancelAddKey()
        return
      }
      const obj = getNode(this.doc, this.selPath.slice(0, ci))
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        this.cancelAddKey()
        return
      }
      if (name in obj) {
        this.toast(`Key "${name}" already exists`, 'error')
        return
      }
      this.snapshot()
      obj[name] = name === 'id' ? genId() : ''
      this.addingKeyAt = null
      this.addKeyDraft = ''
      // Select the new key so the inspector edits IT, not the parent object
      this.selPath = [...this.selPath.slice(0, ci), name]
      this.refreshDirty()
      this.$nextTick(() => this.$refs.strEditor && this.$refs.strEditor.focus())
    },

    cancelAddKey() {
      this.addingKeyAt = null
      this.addKeyDraft = ''
    },

    moveItem(dir) {
      if (!this.parentIsArray) return
      const parent = getNode(this.doc, this.selPath.slice(0, -1))
      const i = this.tipIndex
      const j = i + dir
      if (j < 0 || j >= parent.length) return
      this.snapshot()
      const [item] = parent.splice(i, 1)
      parent.splice(j, 0, item)
      this.selPath = [...this.selPath.slice(0, -1), j]
      this.refreshDirty()
    },

    /* ---------- context menu ---------- */
    openCtxMenu(e, ci, key) {
      // Target the exact node that was right-clicked (no tail preservation)
      this.selPath = [...this.selPath.slice(0, ci), key]
      this.ctxMenu = {
        open: true,
        mode: 'main',
        x: Math.min(e.clientX, window.innerWidth - 210),
        y: Math.min(e.clientY, window.innerHeight - 190)
      }
    },

    /* Copy the selected key (and value) into a sibling array item, e.g. Homecoming.featured → CONTINUUM */
    dupIntoSibling(destIndex) {
      this.ctxMenu.open = false
      const key = String(this.selPath[this.selPath.length - 1])
      const arrPath = this.selPath.slice(0, -2)
      const arr = getNode(this.doc, arrPath)
      const src = arr[this.selPath[this.selPath.length - 2]]
      const dest = arr[destIndex]
      if (dest === null || typeof dest !== 'object' || Array.isArray(dest)) return
      const destLabel = friendlyLabel(dest, this.labelFields) || `[${destIndex}]`
      const exists = key in dest
      if (exists && !window.confirm(`"${key}" already exists in "${destLabel}". Overwrite its value?`)) return
      this.snapshot()
      const value = regenerateIds(clone(src[key]))
      if (exists) {
        dest[key] = value // keep its current position
      } else {
        // Insert at the same relative position: after the nearest preceding source key the destination also has
        const srcKeys = Object.keys(src)
        let anchor = null
        for (let j = srcKeys.indexOf(key) - 1; j >= 0; j--) {
          if (srcKeys[j] in dest) {
            anchor = srcKeys[j]
            break
          }
        }
        const rebuilt = {}
        if (anchor === null) rebuilt[key] = value
        for (const k of Object.keys(dest)) {
          rebuilt[k] = dest[k]
          if (k === anchor) rebuilt[key] = value
        }
        for (const k of Object.keys(dest)) delete dest[k]
        Object.assign(dest, rebuilt)
      }
      this.selPath = [...arrPath, destIndex, key]
      this.refreshDirty()
      this.toast(`Copied "${key}" into "${destLabel}"${exists ? ' (overwrote existing value)' : ''}`)
    },

    ctxDuplicate() {
      this.ctxMenu.open = false
      if (this.parentIsArray) this.duplicateItem()
      else this.duplicateKey()
    },

    ctxCopyValue() {
      this.ctxMenu.open = false
      this.copyValue()
    },

    ctxCopyPath() {
      this.ctxMenu.open = false
      this.copyPath()
    },

    ctxDelete() {
      this.ctxMenu.open = false
      this.deleteNode()
    },

    /* Duplicate an object key as a sibling right below it: "key" -> "keyCopy" */
    duplicateKey() {
      if (!this.selPath.length || this.parentIsArray) return
      const key = this.selPath[this.selPath.length - 1]
      const parent = getNode(this.doc, this.selPath.slice(0, -1))
      let newKey = key + 'Copy'
      let n = 2
      while (newKey in parent) newKey = key + 'Copy' + n++
      this.snapshot()
      const value = regenerateIds(clone(parent[key]))
      const rebuilt = {}
      for (const k of Object.keys(parent)) {
        rebuilt[k] = parent[k]
        if (k === key) rebuilt[newKey] = value
      }
      for (const k of Object.keys(parent)) delete parent[k]
      Object.assign(parent, rebuilt)
      this.selPath = [...this.selPath.slice(0, -1), newKey]
      this.refreshDirty()
      this.toast(`Duplicated as "${newKey}" - rename as needed`)
    },

    duplicateItem() {
      if (!this.parentIsArray) return
      this.snapshot()
      const parent = getNode(this.doc, this.selPath.slice(0, -1))
      const i = this.tipIndex
      parent.splice(i + 1, 0, regenerateIds(clone(parent[i])))
      this.selPath = [...this.selPath.slice(0, -1), i + 1]
      this.refreshDirty()
      this.toast('Duplicated with fresh id fields (values otherwise copied)')
    },

    deleteNode() {
      if (!this.selPath.length) return
      const label = this.segLabel(this.selPath[this.selPath.length - 1], this.selPath.length - 1)
      if (!window.confirm(`Delete "${label}"?`)) return
      this.snapshot()
      const parent = getNode(this.doc, this.selPath.slice(0, -1))
      const key = this.selPath[this.selPath.length - 1]
      if (Array.isArray(parent)) parent.splice(key, 1)
      else delete parent[key]
      this.selPath = this.selPath.slice(0, -1)
      this.refreshDirty()
    },

    startRenameKey() {
      this.syncRename()
      this.editingKey = true
      this.$nextTick(() => {
        const el = this.$refs.keyNameInput
        if (el) {
          el.focus()
          el.select()
        }
      })
    },

    commitRename() {
      this.renameKey()
      this.editingKey = false
    },

    cancelRename() {
      this.editingKey = false
      this.syncRename()
    },

    renameKey() {
      const newKey = this.renameKeyName.trim()
      if (!this.selPath.length || this.parentIsArray || !newKey) return
      const oldKey = this.selPath[this.selPath.length - 1]
      if (newKey === oldKey) return
      const parent = getNode(this.doc, this.selPath.slice(0, -1))
      if (newKey in parent) {
        this.toast(`Key "${newKey}" already exists`, 'error')
        return
      }
      this.snapshot()
      // Rebuild to preserve key order
      const rebuilt = {}
      for (const k of Object.keys(parent)) {
        rebuilt[k === oldKey ? newKey : k] = parent[k]
        if (k === oldKey) delete parent[k]
      }
      for (const k of Object.keys(parent)) delete parent[k]
      Object.assign(parent, rebuilt)
      this.selPath = [...this.selPath.slice(0, -1), newKey]
      this.refreshDirty()
    },

    /* ---------- raw view ---------- */
    setView(v) {
      if (v === this.view) return
      if (v !== 'raw' && this.rawohanged && !this.rawError) {
        if (window.confirm('Apply raw edits to the document?')) this.applyRaw()
      }
      // Set the view first so the render is queued before enterRaw's $nextTick -
      // otherwise the callback fires before the textarea exists.
      this.view = v
      if (v === 'raw') this.enterRaw()
    },

    enterRaw() {
      this.rawText = serialize(this.doc)
      this.rawBase = this.rawText
      if (this.selPath.length) {
        const line = lineOfPath(this.doc, this.selPath)
        this.$nextTick(() => this.scrollRawToLine(line))
      }
    },

    scrollRawToLine(line) {
      const ta = this.$refs.rawTa
      if (!ta) return
      const lines = this.rawText.split('\n')
      let offset = 0
      for (let i = 0; i < line; i++) offset += lines[i].length + 1
      const text = lines[line] || ''
      const indent = text.match(/^\s*/)[0].length
      ta.focus()
      ta.setSelectionRange(offset + indent, offset + text.length)
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18
      ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 3)
      this.syncRawScroll()
    },

    formatRaw() {
      try {
        this.rawText = serialize(JSON.parse(this.rawText))
      } catch {
        /* button disabled when invalid */
      }
    },

    applyRaw() {
      if (this.rawError) return
      this.snapshot()
      this.store[this.active].doc = JSON.parse(this.rawText)
      this.rawBase = this.rawText
      this.sanitizeSelPath()
      this.refreshDirty()
      this.toast('Raw edits applied - use Save to write to disk')
    },

    syncRawScroll() {
      const ta = this.$refs.rawTa
      const hl = this.$refs.rawHl
      if (ta && hl) {
        hl.scrollTop = ta.scrollTop
        hl.scrollLeft = ta.scrollLeft
      }
    },

    /* ---------- search ---------- */
    buildSearchIndex() {
      const index = []
      for (const f of this.files) {
        const s = this.store[f.name]
        if (!s) continue
        const walk = (node, path) => {
          const t = typeOf(node)
          if (t === 'object') {
            for (const k of Object.keys(node)) walk(node[k], [...path, k])
          } else if (t === 'array') {
            node.forEach((v, i) => walk(v, [...path, i]))
          } else {
            const key = path.length ? String(path[path.length - 1]) : ''
            const pathLabel = path
              .map((seg) => (typeof seg === 'number' ? `[${seg}]` : seg))
              .join(' › ')
            index.push({
              file: f.name,
              path,
              pathLabel,
              key: key.toLowerCase(),
              val: String(node).toLowerCase(),
              pathStr: pathLabel.toLowerCase(),
              valuePreview: truncate(String(node), 80)
            })
          }
        }
        walk(s.doc, [])
      }
      this.searchIndex = index
    },

    openSearch() {
      if (!this.searchIndex) this.buildSearchIndex()
      this.searchOpen = true
      this.searchSel = 0
      this.$nextTick(() => this.$refs.searchInput && this.$refs.searchInput.focus())
    },

    gotoResult(r) {
      if (!r) return
      this.searchOpen = false
      this.view = 'columns'
      if (r.file !== this.active) {
        this.selPaths[this.active] = this.selPath
        this.active = r.file
      }
      this.selPath = [...r.path]
    },

    /* ---------- save / diff ---------- */
    requestSave() {
      if (!this.isDirty(this.active)) return
      if (this.view === 'raw' && this.rawohanged && !this.rawError) this.applyRaw()
      const s = this.store[this.active]
      this.pendingSaveText = serialize(s.doc)
      const ops = diffLines(s.diskText, this.pendingSaveText)
      this.diffHunks = buildHunks(ops)
      this.diffAdds = ops.filter((o) => o.kind === 'add').length
      this.diffDels = ops.filter((o) => o.kind === 'del').length
      this.diffOpen = true
    },

    async confirmSave() {
      this.saving = true
      try {
        const s = this.store[this.active]
        const outText = s.eol === '\r\n' ? this.pendingSaveText.replace(/\n/g, '\r\n') : this.pendingSaveText
        await api('/api/files/' + encodeURIComponent(this.active), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: outText })
        })
        s.diskText = this.pendingSaveText
        s.prettyBase = this.pendingSaveText
        this.dirtyMap[this.active] = false
        this.diffOpen = false
        this.toast(`Saved ${this.active}. Restart yarn dev to see changes on the site.`)
      } catch (e) {
        this.toast('Save failed: ' + e.message, 'error')
      } finally {
        this.saving = false
      }
    },

    /* ---------- inspector resize ---------- */
    startResize(e) {
      e.preventDefault()
      const startX = e.clientX
      const startW = this.inspWidth
      const move = (ev) => {
        const max = Math.max(360, Math.round(window.innerWidth * 0.6))
        this.inspWidth = Math.min(Math.max(startW + (startX - ev.clientX), 280), max)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.classList.remove('resizing')
        localStorage.setItem('cms.inspWidth', String(this.inspWidth))
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      document.body.classList.add('resizing')
    },

    resetResize() {
      this.inspWidth = 360
      localStorage.setItem('cms.inspWidth', '360')
    },

    /* ---------- config ---------- */
    setCfgDraft(config) {
      this.cfgDraft = {
        dataDir: config.dataDir,
        publicDir: config.publicDir,
        logo: config.logo || '',
        logoLight: config.logoLight || '',
        title: config.title,
        labelFields: (config.labelFields || DEFAULT_LABEL_FIELDS).join(', ')
      }
    },

    toggleSettings() {
      if (this.settingsOpen) this.closeSettings()
      else this.settingsOpen = true
    },

    closeSettings() {
      if (this.cfgDirty) {
        if (window.confirm('You have unsaved config changes. Save them?')) {
          this.saveConfig()
          return // saveConfig closes the panel on success, stays open on failure
        }
        this.setCfgDraft(this.config) // discard
      }
      this.settingsOpen = false
    },

    async saveConfig() {
      const dirsohanged =
        this.cfgDraft.dataDir !== this.config.dataDir || this.cfgDraft.publicDir !== this.config.publicDir
      if (dirsohanged && Object.values(this.dirtyMap).some(Boolean)) {
        if (!window.confirm('Changing directories reloads the app and discards unsaved edits. Continue?')) return
      }
      this.cfgSaving = true
      try {
        const { config, configPath } = await api('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...this.cfgDraft,
            labelFields: this.cfgDraft.labelFields.split(',').map((f) => f.trim()).filter(Boolean)
          })
        })
        this.config = config
        if (configPath) this.configPath = configPath
        this.labelFields = config.labelFields && config.labelFields.length ? config.labelFields : DEFAULT_LABEL_FIELDS
        this.setCfgDraft(config) // normalize the draft to what the server accepted
        document.title = config.title === '' ? config.jotsonBrand : config.jotsonBrand + ' - ' + config.title
        if (dirsohanged) {
          this.dirtyMap = {} // suppress the beforeunload guard; user already confirmed
          location.reload()
          return
        }
        this.settingsOpen = false
        this.toast('Config saved to ' + this.configPath)
      } catch (e) {
        this.toast('Config save failed: ' + e.message, 'error')
      } finally {
        this.cfgSaving = false
      }
    },

    /* ---------- theme ---------- */
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('cms.theme', this.theme)
      document.body.classList.toggle('light', this.theme === 'light')
    },

    /* ---------- link unfurling ---------- */
    scheduleUnfurl(p) {
      clearTimeout(this.unfurlTimer)
      if (!p || p.kind !== 'url' || p.internal) {
        this.unfurl = { url: null, loading: false, data: null }
        return
      }
      const target = p.url
      if (this.unfurl.url === target && (this.unfurl.data || this.unfurl.loading)) return
      const cached = unfurlCache.get(target)
      if (cached) {
        this.unfurl = { url: target, loading: false, data: cached }
        return
      }
      this.unfurl = { url: target, loading: true, data: null }
      // Debounce so typing a URL character-by-character doesn't spam requests
      this.unfurlTimer = setTimeout(async () => {
        try {
          const data = await api('/api/unfurl?url=' + encodeURIComponent(target))
          unfurlCache.set(target, data)
          if (this.unfurl.url === target) this.unfurl = { url: target, loading: false, data }
        } catch {
          if (this.unfurl.url === target) this.unfurl = { url: target, loading: false, data: null }
        }
      }, 500)
    },

    /* ---------- misc ---------- */
    async copyText(v) {
      try {
        await navigator.clipboard.writeText(v)
        this.toast('Copied: ' + truncate(v, 80))
      } catch {
        this.toast('Could not access the clipboard', 'error')
      }
    },

    copyValue() {
      if (!this.selected) return
      const v = this.selected.value
      this.copyText(v !== null && typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v))
    },

    toast(msg, kind = 'ok') {
      const id = Math.random().toString(36).slice(2)
      this.toasts.push({ id, msg, kind })
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id)
      }, 4000)
    },

    onKeydown(e) {
      const mod = e.ctrlKey || e.metaKey
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        this.openSearch()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        this.requestSave()
        return
      }
      if (e.key === 'Escape') {
        this.searchOpen = false
        this.diffOpen = false
        this.ctxMenu.open = false
        if (this.settingsOpen) this.closeSettings()
        return
      }
      if (mod && e.key.toLowerCase() === 'z' && !inField) {
        e.preventDefault()
        if (e.shiftKey) this.redo()
        else this.undo()
        return
      }
      // Ctrl+Up/Down: sibling switching - works even while editing a value,
      // so you can flip through array items without leaving the keyboard
      if (
        mod &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        this.view === 'columns' &&
        !this.searchOpen &&
        !this.diffOpen &&
        !this.settingsOpen
      ) {
        e.preventDefault()
        this.switchSibling(e.key === 'ArrowUp' ? -1 : 1)
        return
      }

      // Arrow navigation in column view when nothing is focused
      if (this.view !== 'columns' || inField || this.searchOpen || this.diffOpen) return
      if (e.key === 'Delete' && this.selPath.length) {
        e.preventDefault()
        this.deleteNode() // confirms with the key/item name
        return
      }
      if (e.key === 'ArrowLeft' && this.selPath.length) {
        e.preventDefault()
        this.selPath = this.selPath.slice(0, -1)
      } else if (e.key === 'ArrowRight' && this.selected) {
        const t = this.selected.type
        if (t === 'array' && this.selected.value.length) {
          e.preventDefault()
          this.selPath = [...this.selPath, 0]
        } else if (t === 'object' && Object.keys(this.selected.value).length) {
          e.preventDefault()
          this.selPath = [...this.selPath, Object.keys(this.selected.value)[0]]
        }
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.selPath.length) {
        e.preventDefault()
        const parent = getNode(this.doc, this.selPath.slice(0, -1))
        const cur = this.selPath[this.selPath.length - 1]
        const dir = e.key === 'ArrowUp' ? -1 : 1
        if (Array.isArray(parent)) {
          const next = cur + dir
          if (next >= 0 && next < parent.length) this.selPath = [...this.selPath.slice(0, -1), next]
        } else {
          const keys = Object.keys(parent)
          const next = keys.indexOf(cur) + dir
          if (next >= 0 && next < keys.length) this.selPath = [...this.selPath.slice(0, -1), keys[next]]
        }
      }
    }
  }
}).mount('#app')
