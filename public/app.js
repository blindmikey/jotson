/* JotSON - client app (Vue 3, no build step) */
/* global Vue */

const { createApp } = Vue

const DEFAULT_LABEL_FIELDS = ['title', 'label', 'name', 'id']
const DEFAULT_ID_FIELDS = ['id']
// Above this on-disk size a file counts as "huge": the exact dirty verify (a full
// stringify) is skipped, the raw view is blocked, and undo memory is byte-budgeted
const HUGE_FILE_BYTES = 20 * 1024 * 1024
const SNAPSHOT_BUDGET_BYTES = 256 * 1024 * 1024
// Columns render at most this many rows before a "show more" tail - huge collections
// would otherwise build hundreds of thousands of DOM nodes and stall every re-render
const COL_RENDER_CAP = 500
const JOTSON_BRAND = '{J𝘰𝓉SON}' // internal branding - not part of the per-project config
const IMG_RE = /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i
const VID_RE = /\.(mp4|webm|mov|ogg)(\?.*)?$/i
// Local media path (not an http URL): detected as the "file" type, which adds upload support
const FILE_RE = /^(?!https?:\/\/)[^\n]+\.(png|jpe?g|webp|gif|svg|avif|ico|mp4|webm|mov|ogg|mp3|wav|pdf)(\?.*)?$/i
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
  if (FILE_RE.test(v)) return 'file'
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

/* Search-index paths are stored as shared trie nodes ({seg, up} chains) instead of one
   array per entry - "reference, don't copy" is what keeps 100 MB-class indexes in memory */
function triePath(t) {
  const segs = []
  for (let n = t; n; n = n.up) segs.push(n.seg)
  return segs.reverse()
}

function trieLabel(t) {
  return triePath(t)
    .map((seg) => (typeof seg === 'number' ? `[${seg}]` : seg))
    .join(' › ')
}


/* Run cb after the next paint - with a timer fallback, since rAF never fires in
   backgrounded tabs and the work must still happen there */
function afterPaint(cb) {
  let done = false
  const run = () => {
    if (done) return
    done = true
    cb()
  }
  requestAnimationFrame(() => requestAnimationFrame(run))
  setTimeout(run, 150)
}

/* Schedule the next background work slice one frame away, so rendering (and the
   user's keystrokes) always get their share of each frame; timer fallback keeps the
   work moving in backgrounded tabs where rAF never fires */
function nextSlice(cb) {
  let done = false
  const run = () => {
    if (done) return
    done = true
    cb()
  }
  requestAnimationFrame(run)
  setTimeout(run, 40)
}

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

/* Diff the changed middle window (after prefix/suffix trim) into ops */
function midDiffOps(midA, midB, ops) {
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
}

function splitTrimmed(aText, bText) {
  const a = aText.split('\n')
  const b = bText.split('\n')
  // A missing final newline on one side would block the suffix trim entirely, turning
  // a one-line edit into a whole-file diff - normalize the trailing empty line away
  if (a[a.length - 1] === '' || b[b.length - 1] === '') {
    if (a[a.length - 1] === '') a.pop()
    if (b[b.length - 1] === '') b.pop()
  }
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  return { a, b, start, endA, endB }
}

/* Line diff: trim common prefix/suffix, LCS on the middle when affordable. */
function diffLines(aText, bText) {
  const { a, b, start, endA, endB } = splitTrimmed(aText, bText)
  const ops = []
  for (let i = 0; i < start; i++) ops.push({ kind: 'same', text: a[i] })
  midDiffOps(a.slice(start, endA), b.slice(start, endB), ops)
  for (let i = endA; i < a.length; i++) ops.push({ kind: 'same', text: a[i] })
  return ops
}

/* Pretty-print a fragment of minified JSON without parsing it: a token walk that
   inserts newlines and relative indentation, string-safe. The fragment starts
   mid-document so the depth is relative, but two fragments sharing a prefix indent
   identically - which is all a diff needs to align */
function prettifyFragment(s) {
  let out = ''
  let depth = 0
  let inStr = false
  const pad = () => '  '.repeat(Math.max(0, depth))
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      out += c
      if (c === '\\') {
        out += s[++i] || ''
        continue
      }
      if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
    } else if (c === '{' || c === '[') {
      depth++
      out += c + '\n' + pad()
    } else if (c === '}' || c === ']') {
      depth--
      out += '\n' + pad() + c
    } else if (c === ',') {
      out += c + '\n' + pad()
    } else if (c === ':') {
      out += ': '
    } else {
      out += c
    }
  }
  return out
}

/* Minified huge files: locate the changed region with a char scan (no full-document
   pretty conversion - serialize + reparse + reserialize costs ~10s at 150 MB), then
   fake a pretty diff by prettifying just the excerpts and line-diffing those */
function diffCharsWindowed(aText, bText, ctx = 400) {
  if (aText === bText) return { adds: 0, dels: 0, ops: [] }
  const maxP = Math.min(aText.length, bText.length)
  let p = 0
  while (p < maxP && aText.charCodeAt(p) === bText.charCodeAt(p)) p++
  let sfx = 0
  const maxS = maxP - p
  while (sfx < maxS && aText.charCodeAt(aText.length - 1 - sfx) === bText.charCodeAt(bText.length - 1 - sfx)) sfx++
  const aRegion = aText.length - sfx - p
  const bRegion = bText.length - sfx - p
  // Widespread changes (first-save of oddly-formatted data, mass edits): summary only
  if (aRegion > 100000 || bRegion > 100000) {
    return { adds: bRegion, dels: aRegion, ops: [], units: 'characters' }
  }
  // Excerpt window; snap the start to a `,"` boundary so the tokenizer (very likely)
  // starts outside a string - both texts share the prefix, so one snap fits both
  let from = Math.max(0, p - ctx)
  if (from > 0) {
    const snap = aText.indexOf(',"', from)
    if (snap !== -1 && snap < p) from = snap + 1
  }
  const aEnd = Math.min(aText.length, aText.length - sfx + ctx)
  const bEnd = Math.min(bText.length, bText.length - sfx + ctx)
  const prettyA = prettifyFragment(aText.slice(from, aEnd))
  const prettyB = prettifyFragment(bText.slice(from, bEnd))
  const ops = []
  if (from > 0) ops.push({ kind: 'same', text: '…' })
  ops.push(...diffLines(prettyA, prettyB))
  if (aEnd < aText.length || bEnd < bText.length) ops.push({ kind: 'same', text: '…' })
  let adds = 0
  let dels = 0
  for (const o of ops) {
    if (o.kind === 'add') adds++
    else if (o.kind === 'del') dels++
  }
  return { adds, dels, ops }
}

/* Huge-file variant: finds the changed region by CHARACTER scan (no line-splitting of
   the full 160 MB texts - that alone costs seconds and two 6M-element arrays), widens
   to line boundaries, and line-diffs only the differing window plus context */
function diffLinesWindowed(aText, bText, ctx = 3) {
  // Normalize the trailing-newline asymmetry (same reasoning as splitTrimmed)
  const aNL = aText.endsWith('\n')
  const bNL = bText.endsWith('\n')
  if (aNL !== bNL) {
    if (aNL) aText = aText.slice(0, -1)
    else bText = bText.slice(0, -1)
  }
  if (aText === bText) return { adds: 0, dels: 0, ops: [] }
  // common char prefix
  const maxP = Math.min(aText.length, bText.length)
  let p = 0
  while (p < maxP && aText.charCodeAt(p) === bText.charCodeAt(p)) p++
  // common char suffix, not overlapping the prefix
  let s = 0
  const maxS = maxP - p
  while (s < maxS && aText.charCodeAt(aText.length - 1 - s) === bText.charCodeAt(bText.length - 1 - s)) s++
  // widen to whole lines (prefix region is identical in both texts)
  const lineStart = aText.lastIndexOf('\n', p - 1) + 1
  let aEnd = aText.indexOf('\n', aText.length - s)
  if (aEnd === -1) aEnd = aText.length
  let bEnd = bText.indexOf('\n', bText.length - s)
  if (bEnd === -1) bEnd = bText.length
  const midAText = aText.slice(lineStart, aEnd)
  const midBText = bText.slice(lineStart, bEnd)
  // A changed region spanning a huge share of the file (e.g. first-save normalization):
  // don't materialize millions of line ops - count newlines and let the summary render
  if (midAText.length > 4000000 || midBText.length > 4000000) {
    const countLines = (t) => {
      if (!t.length) return 0
      let n = 1
      for (let i = t.indexOf('\n'); i !== -1; i = t.indexOf('\n', i + 1)) n++
      return n
    }
    return { adds: countLines(midBText), dels: countLines(midAText), ops: [] }
  }
  const ops = []
  // leading context lines
  let cStart = lineStart
  for (let i = 0; i < ctx && cStart > 0; i++) cStart = aText.lastIndexOf('\n', cStart - 2) + 1
  if (cStart < lineStart) {
    for (const line of aText.slice(cStart, lineStart - 1).split('\n')) ops.push({ kind: 'same', text: line })
  }
  midDiffOps(midAText.length ? midAText.split('\n') : [], midBText.length ? midBText.split('\n') : [], ops)
  // trailing context lines
  let cEnd = aEnd
  for (let i = 0; i < ctx && cEnd < aText.length; i++) {
    const nx = aText.indexOf('\n', cEnd + 1)
    cEnd = nx === -1 ? aText.length : nx
  }
  if (cEnd > aEnd) {
    for (const line of aText.slice(aEnd + 1, cEnd).split('\n')) ops.push({ kind: 'same', text: line })
  }
  let adds = 0
  let dels = 0
  for (const o of ops) {
    if (o.kind === 'add') adds++
    else if (o.kind === 'del') dels++
  }
  return { adds, dels, ops }
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
      booting: true, // drives the centered load spinner until the first doc renders
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
      searchQuery: '', // the input's live value
      searchTerm: '', // what results are computed from - debounced behind searchQuery on big indexes
      searchResults: [], // filled by the chunked, cancellable scan in runSearch
      searching: false,
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
      config: { dataDir: '', publicDir: '', uploadDir: '', logo: null, logoLight: null, title: '', labelFields: 'title, label, name, id' },
      jotsonBrand: JOTSON_BRAND,
      configPath: 'jotson.config.json',
      version: null,
      update: null, // { latest, command } when a newer version is on npm
      refsNoticeDismissed: localStorage.getItem('cms.refsNotice') === '1',
      uploading: false,
      fileTypeOverride: null, // "file:path" of a string manually switched to the file type
      mediaScan: null, // { loading, orphans: [{name,size,mtime}] } - unused-uploads scan state
      // References: id index across all loaded files, rebuilt lazily after edits
      refIndex: null, // { targets: Map<id, [{file,path,label,field}]>, referrers: Map<id, [{file,path}]> }
      refTypeOverride: null, // "file:path" of a string manually switched to the reference type
      refPicker: { open: false, query: '', collection: null, sel: 0 },
      colLimits: {}, // "<file>|<column path>" -> extra rows granted via "show more"
      colStarts: {}, // "<file>|<column path>" -> window start granted via "show earlier"
      pendingWriteText: '', // what confirmSave writes (minified for compact files)
      diffTooBig: false,
      diffPreparing: false,
      diffUnits: 'lines', // 'characters' when a minified huge file diffs char-wise
      cfgDraft: { dataDir: '', publicDir: '', uploadDir: '', logo: '', logoLight: '', title: '', labelFields: '', idFields: '', references: false },
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

    canRedo() {
      const stacks = this.undoStacks[this.active]
      return !!(stacks && stacks.redo.length)
    },

    idFieldsList() {
      return this.config.idFields && this.config.idFields.length ? this.config.idFields : DEFAULT_ID_FIELDS
    },

    /* Any loaded file over the huge threshold - some features are gated off at scale */
    hugeProject() {
      for (const f of this.files) {
        const s = this.store[f.name]
        if (s && s.diskText.length > HUGE_FILE_BYTES) return true
      }
      return false
    },

    /* References are per-project opt-IN: projects with non-unique ids (e.g. per-file
       incrementing numbers) would otherwise show spurious cross-file references.
       Force-disabled in huge projects: the id index build is synchronous and would
       block for seconds (or exhaust memory) on 100 MB-class files */
    refsEnabled() {
      return this.config.references === true && !this.hugeProject
    },

    /* One-time heads-up (this release): references now exist but default off */
    showRefsNotice() {
      return this.files.length > 0 && !this.refsEnabled && !this.refsNoticeDismissed && !this.hugeProject
    },

    typeOptions() {
      return [
        'string',
        'color',
        'date',
        'datetime',
        'file',
        ...(this.refsEnabled ? ['reference'] : []),
        'number',
        'boolean',
        'null',
        'object',
        'array'
      ]
    },

    /* Cached size label for the selected container. Must be a computed, not an inline
       template expression: Object.keys on a 520k-key object costs ~700 ms, and template
       expressions re-run on every root re-render (i.e. every keystroke anywhere) */
    selectedSize() {
      if (!this.selected) return ''
      const v = this.selected.value
      const t = typeOf(v)
      if (t === 'array') return v.length + (v.length === 1 ? ' item' : ' items')
      if (t === 'object') {
        const n = Object.keys(v).length
        return n + (n === 1 ? ' key' : ' keys')
      }
      return ''
    },

    /* Field rows for the inspector's object overview, capped - a huge object (like a
       34k-key root) must not render tens of thousands of input rows */
    objFields() {
      if (!this.selected || typeOf(this.selected.value) !== 'object') return null
      const v = this.selected.value
      const keys = Object.keys(v)
      if (!keys.length) return null
      const shown = keys.slice(0, 100)
      return {
        entries: shown.map((k) => ({ k, v: v[k] })),
        hidden: keys.length - shown.length
      }
    },

    /* The selected node is a string under an idFields key (identity, not reference) */
    isIdKey() {
      if (!this.selected || !this.selPath.length) return false
      const key = this.selPath[this.selPath.length - 1]
      return typeof key === 'string' && this.idFieldsList.includes(key) && typeof this.selected.value === 'string'
    },

    /* Target info for the selected reference: resolved targets, broken/ambiguous flags */
    refInfo() {
      if (!this.selected || this.selected.type !== 'reference') return null
      const id = this.selected.value
      const targets = id ? this.getRefIndex().targets.get(id) || [] : []
      return { id, targets, broken: !targets.length, ambiguous: targets.length > 1 }
    },

    /* When an id-bearing object is selected: everything that references it */
    reverseRefs() {
      if (!this.refsEnabled) return null
      if (!this.selected || typeOf(this.selected.value) !== 'object') return null
      let id = null
      for (const f of this.idFieldsList) {
        const v = this.selected.value[f]
        if (typeof v === 'string' && v) {
          id = v
          break
        }
      }
      if (!id) return null
      return { id, refs: this.getRefIndex().referrers.get(id) || [] }
    },

    /* Arrays of id-bearing objects, grouped for the picker's browse view */
    refCollections() {
      const groups = new Map()
      for (const [id, list] of this.getRefIndex().targets) {
        for (const t of list) {
          if (typeof t.path[t.path.length - 1] !== 'number') continue // collections are arrays
          const parent = t.path.slice(0, -1)
          const key = t.file + '|' + parent.join('.')
          if (!groups.has(key)) {
            groups.set(key, { key, file: t.file, label: parent.length ? this.pathLabelOf(parent) : this.shortName(t.file), items: [] })
          }
          groups.get(key).items.push({ id, label: t.label, file: t.file, path: t.path, pathLabel: this.pathLabelOf(t.path) })
        }
      }
      return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))
    },

    refPickerResults() {
      if (!this.refPicker.open) return []
      const q = this.refPicker.query.trim().toLowerCase()
      let items
      if (this.refPicker.collection) {
        items = this.refPicker.collection.items
      } else {
        items = []
        for (const [id, list] of this.getRefIndex().targets) {
          for (const t of list) items.push({ id, label: t.label, file: t.file, path: t.path, pathLabel: this.pathLabelOf(t.path) })
        }
      }
      if (q) {
        const tokens = q.split(/\s+/)
        items = items.filter((it) => {
          const hay = (it.label + ' ' + it.id + ' ' + it.pathLabel + ' ' + it.file).toLowerCase()
          return tokens.every((tok) => hay.includes(tok))
        })
      }
      return items.slice(0, 200)
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
      const draftIdFields = (d.idFields || '').split(',').map((f) => f.trim()).filter(Boolean)
      return (
        d.dataDir !== c.dataDir ||
        d.publicDir !== c.publicDir ||
        (d.uploadDir || '') !== (c.uploadDir || '') ||
        (d.logo || '') !== (c.logo || '') ||
        (d.logoLight || '') !== (c.logoLight || '') ||
        d.title !== c.title ||
        JSON.stringify(draftFields) !== JSON.stringify(c.labelFields || []) ||
        JSON.stringify(draftIdFields) !== JSON.stringify(c.idFields || DEFAULT_ID_FIELDS) ||
        d.references !== (c.references === true)
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
        const keys = t === 'array' ? null : Object.keys(node)
        const total = t === 'array' ? node.length : keys.length
        // Render a window of rows, not everything: positioned around the selection when
        // it sits deep in the collection (search jumps to row 400k must not render 400k
        // cells), expandable both ways via the "show earlier / show more" tail cells
        const limitKey = this.active + '|' + this.selPath.slice(0, d).join('.')
        const winLen = COL_RENDER_CAP + (this.colLimits[limitKey] || 0)
        let winStart = this.colStarts[limitKey] || 0
        const selSeg = d < this.selPath.length ? this.selPath[d] : undefined
        if (selSeg !== undefined) {
          const selIdx = t === 'array' ? (typeof selSeg === 'number' ? selSeg : -1) : keys.indexOf(selSeg)
          if (selIdx >= 0 && (selIdx < winStart || selIdx >= winStart + winLen)) {
            winStart = Math.max(0, selIdx - 100)
          }
        }
        const winEnd = Math.min(total, winStart + winLen)
        const entries = []
        if (t === 'array') {
          for (let i = winStart; i < winEnd; i++) {
            const v = node[i]
            let vt = displayType(v)
            if (vt === 'string' && this.isRefString(v, i)) vt = 'reference'
            const fl = friendlyLabel(v, this.labelFields)
            // Items read as their value: references as their target ("Jane Doe"), other
            // primitives as themselves ("red", 42) - "[i]" only when there's nothing to show
            const valLabel =
              vt === 'reference'
                ? this.refTargetLabel(v)
                : vt !== 'object' && vt !== 'array' && vt !== 'null' && String(v).trim()
                  ? truncate(String(v), 40)
                  : null
            entries.push({
              key: i,
              label: valLabel || fl || `[${i}]`,
              type: vt,
              // Primitives show their index in the subtle right-hand slot; objects keep
              // the more useful "N keys" there
              preview:
                vt === 'object'
                  ? Object.keys(v).length + (Object.keys(v).length === 1 ? ' key' : ' keys')
                  : valLabel !== null
                    ? `[${i}]`
                    : this.entryPreview(v, vt)
            })
          }
        } else {
          for (let i = winStart; i < winEnd; i++) {
            const k = keys[i]
            const v = node[k]
            let vt = displayType(v)
            if (vt === 'string' && this.isRefString(v, k)) vt = 'reference'
            entries.push({
              key: k,
              label: k,
              type: vt,
              preview: vt === 'reference' ? '→ ' + this.refTargetLabel(v) : this.entryPreview(v, vt)
            })
          }
        }
        cols.push({
          title: truncate(title, 30),
          type: t,
          entries,
          total,
          hiddenBefore: winStart,
          hidden: total - winEnd,
          winStart,
          limitKey
        })
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
      let type = displayType(v)
      // A string converted to "file" via the dropdown keeps the upload editor for this
      // session even before its value matches FILE_RE (e.g. an empty string pre-upload)
      if (type === 'string' && this.fileTypeOverride === this.active + ':' + this.selPath.join('/')) type = 'file'
      // Data-driven reference detection: a string equal to a known id (except under an
      // idFields key, which is an identity, not a reference); dropdown override pre-pick
      if (this.refsEnabled && type === 'string' && this.selPath.length) {
        const key = this.selPath[this.selPath.length - 1]
        if (this.isRefString(v, key) || this.refTypeOverride === this.active + ':' + this.selPath.join('/')) type = 'reference'
      }
      return { value: v, type }
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

  },

  watch: {
    preview(p) {
      this.scheduleUnfurl(p)
    },
    // Keystrokes land in the input instantly; the scan runs after a short pause on big
    // indexes (and the scan itself is chunked, so it never blocks continued typing)
    searchQuery(q) {
      this._lastTyped = performance.now() // background slices back off while typing
      clearTimeout(this._searchDebounce)
      const big = this.searchIndex && this.searchIndex.length > 20000
      if (!big) {
        this.searchTerm = q
        return
      }
      this._searchDebounce = setTimeout(() => {
        this.searchTerm = q
      }, 180)
    },

    searchTerm(q) {
      this.runSearch(q)
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
    },

    // A column can appear without the selection moving (e.g. converting a value to
    // object/array) - growth alone also scrolls the new column into view
    columns(nv, ov) {
      if (nv.length > (ov ? ov.length : 0)) {
        this.$nextTick(() => {
          const el = this.$refs.columnsEl
          if (el) el.scrollLeft = el.scrollWidth
        })
      }
    },

    // Keep the current history entry's state at the live position so back/forward
    // (which only jumps/file-switches push) always returns to where you really were
    selPath: {
      deep: true,
      handler() {
        if (!this._navRestoring && history.state) history.replaceState(this.navState(), '')
        // Any navigation keeps the right-most (newest) column in view, and each
        // column scrolled to its on-path cell (search jumps can select row 20,000)
        this.$nextTick(() => {
          const el = this.$refs.columnsEl
          if (!el) return
          el.scrollLeft = el.scrollWidth
          for (const cell of el.querySelectorAll('.cell.selected, .cell.tip')) {
            cell.scrollIntoView({ block: 'nearest' })
          }
        })
      }
    },
    active() {
      if (!this._navRestoring && history.state) history.replaceState(this.navState(), '')
    }
  },

  async mounted() {
    document.body.classList.toggle('light', this.theme === 'light')
    window.addEventListener('keydown', this.onKeydown)
    window.addEventListener('beforeunload', (e) => {
      if (Object.values(this.dirtyMap).some(Boolean)) e.preventDefault()
    })
    window.addEventListener('click', (e) => {
      // Clicks inside the context menu are handled by its items (the submenu must survive them)
      if (!e.target.closest('.ctx-menu')) this.ctxMenu.open = false
    })
    // Close the settings popover when a press STARTS outside it. Keyed to mousedown, not
    // click: selecting text in a settings input and releasing outside must not dismiss it
    window.addEventListener('mousedown', (e) => {
      if (!this.settingsOpen) return
      if (e.target.closest('.settings-pop') || e.target.closest('button[title="Settings"]')) return
      this.closeSettings()
    })
    try {
      api('/api/version')
        .then((v) => {
          this.version = v.version
          if (v.updateAvailable) this.update = { latest: v.latest, command: v.updateCommand }
        })
        .catch(() => {}) // offline or registry hiccup - no update notice
      const { config, configPath } = await api('/api/config')
      this.config = config
      if (configPath) this.configPath = configPath
      this.setCfgDraft(config)
      if (config.labelFields && config.labelFields.length) this.labelFields = config.labelFields
      document.title = config.title === '' ? JOTSON_BRAND : JOTSON_BRAND + ' - ' + config.title
      const { files } = await api('/api/files')
      this.files = files
      // Load files independently - one unreadable/malformed file must not blank the app
      await Promise.all(
        files.map((f) =>
          this.loadFile(f.name).catch((e) => this.toast(`Failed to load ${f.name}: ${e.message}`, 'error', 8000))
        )
      )
      const loaded = files.filter((f) => this.store[f.name])
      if (loaded.length) {
        const saved = localStorage.getItem('cms.active')
        this.active = loaded.some((f) => f.name === saved) ? saved : loaded[0].name
        this.selPath = this.selPaths[this.active] || []
        this.sanitizeSelPath()
      }
      // Browser back/forward across jumps and file switches. The current entry's state
      // tracks the live position (replaceState in watchers); jumps push a new entry.
      this._navRestoring = false
      history.replaceState(this.navState(), '')
      window.addEventListener('popstate', (e) => {
        const st = e.state
        if (!st || !st.file || !this.store[st.file]) return
        this._navRestoring = true
        this.view = 'columns'
        if (st.file !== this.active) {
          this.selPaths[this.active] = this.selPath
          this.active = st.file
        }
        this.selPath = [...(st.selPath || [])]
        this.$nextTick(() => {
          this._navRestoring = false
        })
      })
    } catch (e) {
      this.toast('Failed to load: ' + e.message, 'error')
    } finally {
      this.booting = false
    }
  },

  methods: {
    /* ---------- loading / files ---------- */
    async loadFile(name) {
      const res = await fetch('/api/files/' + encodeURIComponent(name))
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `${res.status} ${res.statusText}`)
      }
      const text = await res.text()
      // Normalize to LF internally; remember the file's EOL style to preserve it on save.
      // Strip a UTF-8 BOM if present (JSON.parse rejects it; saves are written without one).
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      const lfText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
      const doc = JSON.parse(lfText)
      // prettyBase (the pretty-printed on-disk baseline) is computed on first need -
      // it costs a full stringify, which large files shouldn't pay at boot.
      // compact: the file is minified (single line) - edits render pretty everywhere
      // but saves write minified again, preserving the file's format
      const compact = !lfText.trim().includes('\n')
      this.store[name] = {
        doc,
        diskText: lfText,
        prettyBase: null,
        eol,
        compact,
        trailNL: /\n$/.test(lfText),
        // Change journal: first-touch original value per edited path. Lets huge files
        // diff in O(edits) instead of O(file). `structural` marks ops that can shift
        // sibling paths (array splices etc.) - those fall back to the text diff.
        journal: { paths: new Map(), structural: false }
      }
      this.dirtyMap[name] = false
      if (!this.undoStacks[name]) this.undoStacks[name] = { undo: [], redo: [] }
      this.invalidateIndexes()
    },

    /* Drop both derived indexes and abandon any in-flight chunked build or scan */
    invalidateIndexes() {
      this.searchIndex = null
      this.refIndex = null
      if (this._indexBuild) {
        this._indexBuild.cancelled = true
        this._indexBuild = null
      }
      if (this._searchScan) {
        this._searchScan.cancelled = true
        this._searchScan = null
        this.searching = false
      }
    },

    openFile(name) {
      if (name === this.active) return
      history.pushState(this.navState(), '') // file switches are back-able
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

    /* Cheap provisional dirty (an edit almost always dirties the doc); the exact check
       is a full pretty-print of the document, so it runs debounced after the burst */
    refreshDirty() {
      const name = this.active
      if (this.store[name]) {
        this.dirtyMap[name] = true
        clearTimeout(this._dirtyTimer)
        this._dirtyTimer = setTimeout(() => this.verifyDirty(name), 700)
      }
      this.invalidateIndexes()
    },

    verifyDirty(name) {
      const s = this.store[name]
      if (!s) return
      // Huge files keep the provisional flag: the exact check costs a full stringify
      // (seconds at 100 MB). Worst case is a spurious dirty dot after undoing everything.
      if (s.diskText.length > HUGE_FILE_BYTES) return
      this.dirtyMap[name] = serialize(s.doc) !== this.prettyBaseOf(s)
    },

    prettyBaseOf(s) {
      if (s.prettyBase === null) s.prettyBase = serialize(JSON.parse(s.diskText))
      return s.prettyBase
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
      if (fl) return `[${seg}] ${truncate(fl, 24)}`
      // Primitive array items read as their value too (references as their target)
      if (node !== null && node !== undefined && typeof node !== 'object') {
        const s = typeof node === 'string' && this.isRefString(node, seg) ? this.refTargetLabel(node) : String(node)
        if (s.trim()) return `[${seg}] ${truncate(s, 24)}`
      }
      return `[${seg}]`
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
          color: '🎨',
          file: '📂',
          reference: '🔗'
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
      this.trimSnapshots(stacks.undo)
      stacks.redo = []
      // Full snapshots are structural ops - the journal can't track shifted paths
      const j = this.store[this.active].journal
      if (j) j.structural = true
      this.lastSnap = { key: coalesceKey ? this.active + '|' + coalesceKey : '', time: now }
    },

    /* Drop the oldest snapshots when the stack's full-doc strings exceed the byte
       budget - a 100 MB doc would otherwise hoard gigabytes within a few operations */
    trimSnapshots(stack) {
      let bytes = 0
      for (let i = stack.length - 1; i >= 0; i--) {
        const e = stack[i]
        bytes += typeof e === 'string' ? e.length * 2 : 512
        if (bytes > SNAPSHOT_BUDGET_BYTES && i > 0) {
          stack.splice(0, i)
          return
        }
      }
    },

    /* Value edits record just {path, old value} instead of stringifying the whole doc -
       on large files a full snapshot per keystroke burst costs hundreds of ms and MBs */
    snapshotLeaf(path, coalesceKey) {
      const stacks = this.undoStacks[this.active]
      const now = Date.now()
      // Journal the first-touch original for this path (before any mutation, before
      // coalescing can skip us) - the audit that powers O(edits) save diffs
      const j = this.store[this.active].journal
      if (j) {
        const pk = path.join('\u0000')
        if (!j.paths.has(pk)) j.paths.set(pk, { p: [...path], old: clone(getNode(this.store[this.active].doc, path)) })
      }
      if (coalesceKey && this.lastSnap.key === this.active + '|' + coalesceKey && now - this.lastSnap.time < 900) {
        this.lastSnap.time = now
        return
      }
      stacks.undo.push({ p: [...path], v: clone(getNode(this.store[this.active].doc, path)) })
      if (stacks.undo.length > 100) stacks.undo.shift()
      stacks.redo = []
      this.lastSnap = { key: coalesceKey ? this.active + '|' + coalesceKey : '', time: now }
    },

    /* Undo entries are either full-doc JSON strings (structural ops) or {p, v} leaf
       records (value edits) - apply one to the store and return its inverse */
    applySnapEntry(s, entry) {
      if (typeof entry === 'string') {
        const inverse = JSON.stringify(s.doc)
        s.doc = JSON.parse(entry)
        return inverse
      }
      const inverse = { p: entry.p, v: clone(getNode(s.doc, entry.p)) }
      const parent = getNode(s.doc, entry.p.slice(0, -1))
      if (parent !== undefined && parent !== null) parent[entry.p[entry.p.length - 1]] = entry.v
      return inverse
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
      stacks.redo.push(this.applySnapEntry(this.store[this.active], stacks.undo.pop()))
      this.trimSnapshots(stacks.redo)
      this.lastSnap = { key: '', time: 0 }
      this.sanitizeSelPath()
      this.refreshDirty()
      if (this.view === 'raw') this.enterRaw()
    },

    redo() {
      const stacks = this.undoStacks[this.active]
      if (!stacks || !stacks.redo.length) return
      stacks.undo.push(this.applySnapEntry(this.store[this.active], stacks.redo.pop()))
      this.trimSnapshots(stacks.undo)
      this.lastSnap = { key: '', time: 0 }
      this.sanitizeSelPath()
      this.refreshDirty()
      if (this.view === 'raw') this.enterRaw()
    },

    /* ---------- editing ---------- */
    setValue(v) {
      if (!this.selPath.length) return
      const tailKey = this.selPath[this.selPath.length - 1]
      // Renaming an id that things point at: offer to retarget the references (debounced
      // past the keystroke burst; the referrer list is captured before the first change)
      if (typeof tailKey === 'string' && this.idFieldsList.includes(tailKey) && typeof v === 'string') {
        this.trackIdRenameAt(this.selPath)
      }
      this.snapshotLeaf(this.selPath, 'value:' + this.selPath.join('/'))
      const parent = getNode(this.doc, this.selPath.slice(0, -1))
      parent[tailKey] = v
      this.refreshDirty()
      this.$nextTick(() => this.resizeStrEditor())
    },

    /* Overwrite an id field with a fresh uuid4 (undoable; the reference-update offer
       follows automatically via trackIdRename) */
    generateId() {
      this.setValue(genId())
      this.toast('Generated a fresh id')
    },

    trackIdRenameAt(path) {
      if (!this.refsEnabled) return
      const pathKey = this.active + ':' + path.join('/')
      let p = this._idRename
      if (!p || p.pathKey !== pathKey) {
        const cur = getNode(this.doc, path) // pre-mutation: the original id
        if (typeof cur !== 'string' || !cur) {
          this._idRename = null
          return
        }
        const refs = (this.getRefIndex().referrers.get(cur) || []).map((r) => ({ file: r.file, path: [...r.path] }))
        if (!refs.length) {
          this._idRename = null
          return
        }
        p = this._idRename = { pathKey, file: this.active, path: [...path], oldId: cur, refs, timer: null }
      }
      clearTimeout(p.timer)
      p.timer = setTimeout(() => this.offerIdRename(p), 1200)
    },

    offerIdRename(p) {
      if (this._idRename === p) this._idRename = null
      const s = this.store[p.file]
      if (!s) return
      const newId = getNode(s.doc, p.path)
      if (typeof newId !== 'string' || !newId || newId === p.oldId) return
      const n = p.refs.length
      if (
        !window.confirm(
          `${n} reference${n === 1 ? '' : 's'} still point${n === 1 ? 's' : ''} at the old id "${p.oldId}".\n\nUpdate ${n === 1 ? 'it' : 'them'} to "${newId}" as well?`
        )
      )
        return
      const byFile = new Map()
      for (const r of p.refs) {
        if (!byFile.has(r.file)) byFile.set(r.file, [])
        byFile.get(r.file).push(r)
      }
      let updated = 0
      for (const [file, refs] of byFile) {
        const fs = this.store[file]
        if (!fs) continue
        if (fs.journal) fs.journal.structural = true // full snapshot - journal can't follow
        const stacks = this.undoStacks[file]
        if (stacks) {
          stacks.undo.push(JSON.stringify(fs.doc))
          if (stacks.undo.length > 100) stacks.undo.shift()
          stacks.redo = []
        }
        for (const r of refs) {
          const parent = getNode(fs.doc, r.path.slice(0, -1))
          const k = r.path[r.path.length - 1]
          if (parent && parent[k] === p.oldId) {
            parent[k] = newId
            updated++
          }
        }
        this.dirtyMap[file] = serialize(fs.doc) !== this.prettyBaseOf(fs)
      }
      this.invalidateIndexes()
      this.lastSnap = { key: '', time: 0 }
      this.toast(`Updated ${updated} reference${updated === 1 ? '' : 's'} to "${newId}"`)
    },

    /* Type of a field row in the inspector's Fields section (same rules as columns) */
    fieldType(v, key) {
      let t = displayType(v)
      if (t === 'string' && this.isRefString(v, key)) t = 'reference'
      return t
    },

    isImgPath(v) {
      return typeof v === 'string' && IMG_RE.test(v)
    },

    /* Inline edit of a key on the selected object (Fields section) */
    setFieldValue(key, v) {
      const obj = getNode(this.doc, this.selPath)
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return
      if (this.idFieldsList.includes(key) && typeof v === 'string') this.trackIdRenameAt([...this.selPath, key])
      this.snapshotLeaf([...this.selPath, key], 'field:' + this.selPath.join('/') + '/' + key)
      obj[key] = v
      this.refreshDirty()
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
        if (curT === 'file') this.fileTypeOverride = null
        if (curT === 'reference') this.refTypeOverride = null
        if (curT === 'date' || curT === 'datetime' || curT === 'color' || curT === 'file' || curT === 'reference') return // already a string; detection is automatic
        v = curT === 'object' || curT === 'array' ? JSON.stringify(cur) : String(cur ?? '')
      } else if (t === 'file') {
        // Keep the string; the file editor takes over (upload sets a detectable path)
        v = typeof cur === 'string' ? cur : String(cur ?? '')
        this.fileTypeOverride = this.active + ':' + this.selPath.join('/')
      } else if (t === 'reference') {
        // Keep the string and open the picker - picking is the whole point of converting
        v = typeof cur === 'string' ? cur : String(cur ?? '')
        this.refTypeOverride = this.active + ':' + this.selPath.join('/')
        this.$nextTick(() => this.openRefPicker())
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
      this.snapshotLeaf(this.selPath) // type conversion is still just a value swap at one path
      const parent = getNode(this.doc, this.selPath.slice(0, -1))
      parent[this.selPath[this.selPath.length - 1]] = v
      this.refreshDirty()
    },

    /* ---------- references ---------- */
    /* One walk over every loaded doc builds both directions: targets (id -> id-bearing
       objects) and referrers (id -> string nodes equal to it). Strings under an idFields
       key are identities, not references, and never count as referrers. */
    buildRefIndex() {
      const idFields = this.idFieldsList
      const targets = new Map()
      const strings = []
      for (const f of this.files) {
        const s = this.store[f.name]
        if (!s) continue
        const walk = (node, path) => {
          const t = typeOf(node)
          if (t === 'object') {
            for (const field of idFields) {
              const idv = node[field]
              if (typeof idv === 'string' && idv) {
                const arr = targets.get(idv) || []
                arr.push({ file: f.name, path, label: friendlyLabel(node, this.labelFields) || idv, field })
                targets.set(idv, arr)
              }
            }
            for (const k of Object.keys(node)) walk(node[k], [...path, k])
          } else if (t === 'array') {
            node.forEach((v, i) => walk(v, [...path, i]))
          } else if (typeof node === 'string' && node) {
            const key = path.length ? path[path.length - 1] : ''
            if (typeof key === 'string' && idFields.includes(key)) return
            strings.push({ file: f.name, path, value: node })
          }
        }
        walk(s.doc, [])
      }
      const referrers = new Map()
      for (const s of strings) {
        if (!targets.has(s.value)) continue
        const arr = referrers.get(s.value) || []
        arr.push({ file: s.file, path: s.path })
        referrers.set(s.value, arr)
      }
      this.refIndex = { targets, referrers }
    },

    getRefIndex() {
      if (!this.refIndex) this.buildRefIndex()
      return this.refIndex
    },

    isRefString(v, key) {
      if (!this.refsEnabled) return false
      if (typeof v !== 'string' || !v) return false
      if (typeof key === 'string' && this.idFieldsList.includes(key)) return false
      return this.getRefIndex().targets.has(v)
    },

    refTargetLabel(id) {
      const t = this.getRefIndex().targets.get(id)
      if (!t || !t.length) return id
      return t[0].label + (t.length > 1 ? ` (×${t.length})` : '')
    },

    pathLabelOf(path) {
      return path.map((s) => (typeof s === 'number' ? `[${s}]` : s)).join(' › ')
    },

    /* Friendly path segments for backlink rows: array indexes get their item's label
       ("[0] Opening Keynote"), and a trailing index is dropped - it's the reference
       cell itself, which is always the object being viewed. */
    refPathSegs(file, path) {
      const s = this.store[file]
      let node = s ? s.doc : undefined
      const segs = []
      path.forEach((seg, i) => {
        node = node === undefined || node === null ? undefined : node[seg]
        if (typeof seg === 'number') {
          if (i === path.length - 1) return
          const fl = node !== undefined ? friendlyLabel(node, this.labelFields) : null
          segs.push(fl ? `[${seg}] ${truncate(fl, 28)}` : `[${seg}]`)
        } else {
          segs.push(seg)
        }
      })
      return segs
    },

    /* Deep paths collapse in the middle - the head names the collection, the tail is
       the context that matters; the full path lives in the row's tooltip */
    refPathLabel(file, path) {
      const segs = this.refPathSegs(file, path)
      if (segs.length > 4) segs.splice(1, segs.length - 4, '…')
      return segs.join(' › ')
    },

    refPathFull(file, path) {
      return this.shortName(file) + ' › ' + this.refPathSegs(file, path).join(' › ')
    },

    dismissRefsNotice() {
      this.refsNoticeDismissed = true
      localStorage.setItem('cms.refsNotice', '1')
    },

    openRefPicker() {
      this.getRefIndex()
      this.refPicker = { open: true, query: '', collection: null, sel: 0 }
      this.$nextTick(() => this.$refs.refPickerInput && this.$refs.refPickerInput.focus())
    },

    chooseRef(r) {
      if (!r) return
      this.setValue(r.id)
      this.refPicker.open = false
      this.toast(`Now references "${r.label}"`)
    },

    /* Teleporting navigation (search results, reference links). Pushes a history entry
       so browser back returns to where you jumped from. */
    jumpTo(file, path) {
      if (!this.store[file]) return
      history.pushState(this.navState(), '')
      this.view = 'columns'
      if (file !== this.active) {
        this.selPaths[this.active] = this.selPath
        this.active = file
      }
      this.selPath = [...path]
      this.persistNav()
    },

    navState() {
      return { file: this.active, selPath: [...this.selPath] }
    },

    /* Every in-memory string that mentions a uuid, across all open docs - unsaved edits
       included, so a freshly uploaded (not yet saved) file never scans as an orphan */
    collectUuidRefs() {
      const refs = []
      const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      const walk = (n) => {
        if (typeof n === 'string') {
          if (uuidRe.test(n)) refs.push(n)
        } else if (n && typeof n === 'object') {
          Object.values(n).forEach(walk)
        }
      }
      for (const name of Object.keys(this.store)) walk(this.store[name].doc)
      return refs
    },

    async scanMedia() {
      this.mediaScan = { loading: true, orphans: [] }
      try {
        const { orphans } = await api('/api/media/orphans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenced: this.collectUuidRefs() })
        })
        this.mediaScan = { loading: false, orphans }
        if (!orphans.length) this.toast('No unused uploads - the upload directory is clean')
      } catch (e) {
        this.mediaScan = null
        this.toast('Scan failed: ' + e.message, 'error')
      }
    },

    async cleanMedia() {
      const orphans = this.mediaScan && this.mediaScan.orphans
      if (!orphans || !orphans.length) return
      const total = orphans.reduce((s, f) => s + f.size, 0)
      const n = orphans.length
      if (
        !window.confirm(
          `Delete ${n} unused upload${n === 1 ? '' : 's'} (${this.fmtSize(total)}) from the upload directory?\n\nThis removes the files from disk immediately.`
        )
      )
        return
      try {
        const { deleted } = await api('/api/media/clean', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: orphans.map((f) => f.name) })
        })
        this.mediaScan = null
        this.toast(`Deleted ${deleted.length} unused upload${deleted.length === 1 ? '' : 's'}`)
      } catch (e) {
        this.toast('Clean failed: ' + e.message, 'error')
      }
    },

    fmtSize(n) {
      return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'
    },

    async uploadFile(e) {
      const f = e.target.files && e.target.files[0]
      e.target.value = '' // allow re-picking the same file
      if (!f || this.uploading) return
      this.uploading = true
      try {
        const { path } = await api('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f })
        this.setValue(path)
        this.toast('Uploaded - stored as ' + path)
      } catch (err) {
        this.toast('Upload failed: ' + err.message, 'error')
      } finally {
        this.uploading = false
      }
    },

    showMoreRows(col) {
      this.colLimits[col.limitKey] = (this.colLimits[col.limitKey] || 0) + COL_RENDER_CAP
    },

    showEarlierRows(col) {
      this.colStarts[col.limitKey] = Math.max(0, col.winStart - COL_RENDER_CAP)
      this.colLimits[col.limitKey] = (this.colLimits[col.limitKey] || 0) + COL_RENDER_CAP
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
      const node = getNode(this.doc, this.selPath)
      // Every id inside the deleted subtree - references to any of them will dangle
      const ids = new Set()
      const collect = (n) => {
        if (n === null || typeof n !== 'object') return
        if (!Array.isArray(n)) {
          for (const f of this.idFieldsList) {
            if (typeof n[f] === 'string' && n[f]) ids.add(n[f])
          }
        }
        for (const c of Array.isArray(n) ? n : Object.values(n)) collect(c)
      }
      collect(node)
      const refs = []
      if (ids.size && this.refsEnabled) {
        const seen = new Set()
        for (const id of ids) {
          for (const r of this.getRefIndex().referrers.get(id) || []) {
            // Referrers inside the subtree die with it - only outside ones dangle
            const inSubtree =
              r.file === this.active &&
              r.path.length >= this.selPath.length &&
              this.selPath.every((seg, i) => r.path[i] === seg)
            const dedupe = r.file + '|' + r.path.join('.')
            if (!inSubtree && !seen.has(dedupe)) {
              seen.add(dedupe)
              refs.push({ file: r.file, path: [...r.path] })
            }
          }
        }
      }
      const warn = refs.length
        ? `\n\n⚠ Referenced by ${refs.length} value${refs.length === 1 ? '' : 's'} elsewhere.`
        : ''
      if (!window.confirm(`Delete "${label}"?${warn}`)) return
      const cleanup =
        refs.length > 0 &&
        window.confirm(
          `Also delete the ${refs.length} reference${refs.length === 1 ? '' : 's'} to it?\n\nArray entries are removed; key values are blanked to "".`
        )
      this.snapshot()
      const parent = getNode(this.doc, this.selPath.slice(0, -1))
      const key = this.selPath[this.selPath.length - 1]
      let removed = 0
      if (cleanup) removed = this.cleanupRefs(refs, ids)
      // Delete by identity - reference cleanup may have shifted array positions
      if (Array.isArray(parent)) {
        const idx = typeof key === 'number' && parent[key] === node ? key : parent.indexOf(node)
        if (idx !== -1) parent.splice(idx, 1)
      } else {
        delete parent[key]
      }
      this.selPath = this.selPath.slice(0, -1)
      this.refreshDirty()
      if (cleanup) this.toast(`Deleted "${truncate(String(label), 30)}" and ${removed} reference${removed === 1 ? '' : 's'}`)
    },

    /* Remove/blank the given reference strings (values must still be one of `ids`).
       Array entries are spliced per-parent in descending index order so earlier removals
       don't shift later ones; key values are blanked to keep object shapes intact. */
    cleanupRefs(refs, ids) {
      const byFile = new Map()
      for (const r of refs) {
        if (!byFile.has(r.file)) byFile.set(r.file, [])
        byFile.get(r.file).push(r)
      }
      let removed = 0
      for (const [file, list] of byFile) {
        const s = this.store[file]
        if (!s) continue
        if (s.journal) s.journal.structural = true // splices shift paths
        if (file !== this.active) {
          const stacks = this.undoStacks[file]
          if (stacks) {
            stacks.undo.push(JSON.stringify(s.doc))
            if (stacks.undo.length > 100) stacks.undo.shift()
            stacks.redo = []
          }
        }
        for (const r of list.filter((x) => typeof x.path[x.path.length - 1] !== 'number')) {
          const parent = getNode(s.doc, r.path.slice(0, -1))
          const k = r.path[r.path.length - 1]
          if (parent && ids.has(parent[k])) {
            parent[k] = ''
            removed++
          }
        }
        const byParent = new Map()
        for (const r of list.filter((x) => typeof x.path[x.path.length - 1] === 'number')) {
          const pk = r.path.slice(0, -1).join('.')
          if (!byParent.has(pk)) byParent.set(pk, { path: r.path.slice(0, -1), idxs: [] })
          byParent.get(pk).idxs.push(r.path[r.path.length - 1])
        }
        for (const g of byParent.values()) {
          const arr = getNode(s.doc, g.path)
          if (!Array.isArray(arr)) continue
          for (const i of g.idxs.sort((a, b) => b - a)) {
            if (ids.has(arr[i])) {
              arr.splice(i, 1)
              removed++
            }
          }
        }
        if (file !== this.active) this.dirtyMap[file] = serialize(s.doc) !== this.prettyBaseOf(s)
      }
      return removed
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
      if (v === 'raw') {
        const s = this.store[this.active]
        if (s && s.diskText.length > HUGE_FILE_BYTES) {
          this.toast('Raw view is disabled for very large files - the columns stay fast at any size', 'error')
          return
        }
      }
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
    /* Build the search index in time-sliced chunks so the palette can open instantly -
       the pause before the user types hides most of the cost, and typing stays smooth
       even while indexing a multi-MB document */
    ensureSearchIndex() {
      if (this.searchIndex || this._indexBuild) return
      const build = { cancelled: false, index: [], capped: false }
      this._indexBuild = build
      const huge = this.hugeProject
      const VAL_CAP = huge ? 120 : 200 // cap indexed value text - long strings would
      // otherwise duplicate the document's bytes into the index
      const MAX_ENTRIES = 2000000 // hard memory safety valve
      const stack = []
      for (const f of this.files) {
        const s = this.store[f.name]
        if (s) stack.push({ n: s.doc, t: null, f: f.name })
      }
      const step = () => {
        if (build.cancelled) return
        // The user is typing: do nothing this beat - their keystrokes come first
        if (performance.now() - (this._lastTyped || 0) < 200) {
          setTimeout(step, 120)
          return
        }
        const t0 = performance.now()
        while (stack.length && performance.now() - t0 < 12) {
          const fr = stack.pop()
          const n = fr.n
          const t = typeOf(n)
          if (t === 'object') {
            for (const k of Object.keys(n)) stack.push({ n: n[k], t: { seg: k, up: fr.t }, f: fr.f })
          } else if (t === 'array') {
            for (let i = 0; i < n.length; i++) stack.push({ n: n[i], t: { seg: i, up: fr.t }, f: fr.f })
          } else {
            if (build.index.length >= MAX_ENTRIES) {
              build.capped = true
              stack.length = 0
              break
            }
            const seg = fr.t ? fr.t.seg : ''
            const sv = String(n)
            const entry = {
              f: fr.f,
              t: fr.t, // shared trie node - display path/label derived on demand
              key: typeof seg === 'string' ? seg.toLowerCase() : String(seg),
              val: (sv.length > VAL_CAP ? sv.slice(0, VAL_CAP) : sv).toLowerCase(),
              pv: truncate(sv, 80)
            }
            // Path-text matching costs a per-leaf string; affordable below the huge tier
            if (!huge) entry.ps = trieLabel(fr.t).toLowerCase()
            build.index.push(entry)
          }
        }
        if (stack.length) {
          nextSlice(step) // frame-aligned: rendering gets its share of every frame
        } else {
          this._indexBuild = null
          this.searchIndex = build.index
          if (build.capped) this.toast('Search index capped at 2M values - the deepest content is not searchable', 'error', 8000)
          if (this.searchTerm) this.runSearch(this.searchTerm) // query typed while indexing
        }
      }
      step()
    },

    openSearch() {
      this.searchOpen = true
      this.searchSel = 0
      this.$nextTick(() => this.$refs.searchInput && this.$refs.searchInput.focus())
      this.ensureSearchIndex()
    },

    /* Time-sliced, cancellable scan: keystrokes must never wait on it. Ranking uses
       score buckets (scores are small ints) so no full sort of the match set is needed */
    runSearch(rawQuery) {
      if (this._searchScan) this._searchScan.cancelled = true
      this._searchScan = null
      const q = rawQuery.trim().toLowerCase()
      if (!q || !this.searchIndex) {
        this.searchResults = []
        this.searching = false
        return
      }
      const tokens = q.split(/\s+/)
      const idx = this.searchIndex
      const scan = { cancelled: false }
      this._searchScan = scan
      this.searching = true
      const buckets = new Map() // score -> up to 50 entries
      let i = 0
      const step = () => {
        if (scan.cancelled) return
        // The user is typing: hold the scan - results can wait, keystrokes can't
        if (performance.now() - (this._lastTyped || 0) < 200) {
          setTimeout(step, 120)
          return
        }
        const t0 = performance.now()
        for (; i < idx.length && performance.now() - t0 < 10; i++) {
          const entry = idx[i]
          let score = 0
          let ok = true
          for (const tok of tokens) {
            if (entry.key.includes(tok)) score += 5
            else if (entry.val.includes(tok)) score += 3
            else if (entry.ps && entry.ps.includes(tok)) score += 2
            else {
              ok = false
              break
            }
          }
          if (ok) {
            let b = buckets.get(score)
            if (!b) buckets.set(score, (b = []))
            if (b.length < 50) b.push(entry)
          }
        }
        if (i < idx.length) {
          nextSlice(step) // frame-aligned, same reasoning as the index build
          return
        }
        const out = []
        for (const sc of [...buckets.keys()].sort((a, b) => b - a)) {
          for (const e of buckets.get(sc)) {
            out.push(e)
            if (out.length === 50) break
          }
          if (out.length === 50) break
        }
        this._searchScan = null
        this.searching = false
        // Display fields (path, label) are derived here for just the shown results -
        // the index itself stores only shared trie pointers
        this.searchResults = out.map((e) => ({
          file: e.f,
          path: triePath(e.t),
          pathLabel: trieLabel(e.t),
          valuePreview: e.pv
        }))
        this.searchSel = 0
      }
      step()
    },

    gotoResult(r) {
      if (!r) return
      this.searchOpen = false
      this.jumpTo(r.file, r.path)
    },

    /* ---------- save / diff ---------- */
    requestSave() {
      if (!this.isDirty(this.active)) return
      if (this.view === 'raw' && this.rawohanged && !this.rawError) this.applyRaw()
      const s = this.store[this.active]
      // Open the modal in a "preparing" state first: serializing + diffing a huge doc
      // takes seconds, and the block should happen behind visible feedback, not a freeze
      this.diffPreparing = true
      this.diffHunks = []
      this.diffAdds = 0
      this.diffDels = 0
      this.diffTooBig = false
      this.diffOpen = true
      afterPaint(() => {
        if (!this.diffOpen) {
          this.diffPreparing = false // dismissed while preparing
          return
        }
        const huge = s.diskText.length > HUGE_FILE_BYTES
        this.diffUnits = 'lines'
        if (huge && s.journal && !s.journal.structural) {
          // Journal diff: O(edits), no full-document serialize at all. Each edited path
          // renders as its own hunk (old vs current value, pretty-printed locally).
          // The write bytes are produced later, behind confirmSave's "Saving…" state.
          this.pendingSaveText = ''
          this.pendingWriteText = ''
          const hunks = []
          let adds = 0
          let dels = 0
          for (const { p, old } of s.journal.paths.values()) {
            const cur = getNode(s.doc, p)
            if (JSON.stringify(cur) === JSON.stringify(old)) continue // edited back to original
            const ops = [{ kind: 'same', text: '@ ' + this.pathLabelOf(p) }]
            ops.push(
              ...diffLines(
                old === undefined ? '' : JSON.stringify(old, null, 2),
                cur === undefined ? '' : JSON.stringify(cur, null, 2)
              )
            )
            for (const o of ops) {
              if (o.kind === 'add') adds++
              else if (o.kind === 'del') dels++
            }
            hunks.push(ops)
          }
          this.diffAdds = adds
          this.diffDels = dels
          this.diffTooBig = adds + dels > 5000
          this.diffHunks = this.diffTooBig ? [] : hunks
          this.diffPreparing = false
          return
        }
        if (huge && s.compact) {
          // Minified huge file: ONE minify pass and a char-scan. The pretty route here
          // would cost serialize + reparse + reserialize of the whole document (~8+ s
          // at 150 MB in a single block - Chrome's "page unresponsive" territory)
          this.pendingWriteText = JSON.stringify(s.doc) + (s.trailNL ? '\n' : '')
          this.pendingSaveText = this.pendingWriteText // raw pretty text is never needed here
          const { adds, dels, ops, units } = diffCharsWindowed(s.diskText, this.pendingWriteText)
          this.diffAdds = adds
          this.diffDels = dels
          this.diffTooBig = !!units // widespread change - counts are characters
          if (units) this.diffUnits = units
          this.diffHunks = this.diffTooBig ? [] : buildHunks(ops)
        } else if (huge) {
          this.pendingSaveText = serialize(s.doc)
          this.pendingWriteText = this.pendingSaveText
          // Windowed diff: counts + hunk-ready ops without allocating per unchanged line
          const { adds, dels, ops } = diffLinesWindowed(s.diskText, this.pendingSaveText)
          this.diffAdds = adds
          this.diffDels = dels
          this.diffTooBig = adds + dels > 5000
          this.diffHunks = this.diffTooBig ? [] : buildHunks(ops)
        } else {
          this.pendingSaveText = serialize(s.doc)
          // Minified files: write minified, and diff against the pretty baseline so the
          // modal shows the semantic change rather than a bogus whole-file reformat
          this.pendingWriteText = s.compact ? JSON.stringify(s.doc) + (s.trailNL ? '\n' : '') : this.pendingSaveText
          const diffBase = s.compact ? this.prettyBaseOf(s) : s.diskText
          const ops = diffLines(diffBase, this.pendingSaveText)
          this.diffAdds = ops.filter((o) => o.kind === 'add').length
          this.diffDels = ops.filter((o) => o.kind === 'del').length
          // Rendering an enormous diff (e.g. first-save normalization of a huge file)
          // would build hundreds of thousands of DOM rows - show the summary instead
          this.diffTooBig = this.diffAdds + this.diffDels > 5000
          this.diffHunks = this.diffTooBig ? [] : buildHunks(ops)
        }
        this.diffPreparing = false
      })
    },

    async confirmSave() {
      this.saving = true
      try {
        const s = this.store[this.active]
        if (!this.pendingWriteText && !this.pendingSaveText) {
          // Journal-diff path deferred the serialize to here - do it behind "Saving…",
          // after a paint so the button state is visible before the block
          await new Promise((resolve) => afterPaint(resolve))
          if (s.compact) {
            this.pendingWriteText = JSON.stringify(s.doc) + (s.trailNL ? '\n' : '')
            this.pendingSaveText = this.pendingWriteText
          } else {
            this.pendingSaveText = serialize(s.doc)
            this.pendingWriteText = this.pendingSaveText
          }
        }
        const writeText = this.pendingWriteText || this.pendingSaveText
        const outText = s.eol === '\r\n' ? writeText.replace(/\n/g, '\r\n') : writeText
        await api('/api/files/' + encodeURIComponent(this.active), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: outText // raw text - no envelope to double-parse on either end
        })
        s.diskText = writeText // what's on disk (minified for compact files)
        // Pretty baseline: for huge compact saves pendingSaveText IS the minified text
        // (the pretty conversion was skipped) - leave it null for lazy recompute instead
        s.prettyBase = s.compact && writeText.length > HUGE_FILE_BYTES ? null : this.pendingSaveText
        // The save is the new baseline - start a fresh change journal
        s.journal = { paths: new Map(), structural: false }
        this.dirtyMap[this.active] = false
        this.diffOpen = false
        this.toast(`Saved ${this.active}`)
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
        uploadDir: config.uploadDir || '',
        logo: config.logo || '',
        logoLight: config.logoLight || '',
        title: config.title,
        labelFields: (config.labelFields || DEFAULT_LABEL_FIELDS).join(', '),
        idFields: (config.idFields || DEFAULT_ID_FIELDS).join(', '),
        references: config.references === true
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
      const prevUploadDir = this.config.uploadDir || ''
      this.cfgSaving = true
      try {
        const { config, configPath } = await api('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...this.cfgDraft,
            labelFields: this.cfgDraft.labelFields.split(',').map((f) => f.trim()).filter(Boolean),
            idFields: this.cfgDraft.idFields.split(',').map((f) => f.trim()).filter(Boolean)
          })
        })
        this.config = config
        if (configPath) this.configPath = configPath
        this.labelFields = config.labelFields && config.labelFields.length ? config.labelFields : DEFAULT_LABEL_FIELDS
        this.refIndex = null // idFields may have changed
        this.setCfgDraft(config) // normalize the draft to what the server accepted
        document.title = config.title === '' ? JOTSON_BRAND : JOTSON_BRAND + ' - ' + config.title
        if (dirsohanged) {
          this.dirtyMap = {} // suppress the beforeunload guard; user already confirmed
          location.reload()
          return
        }
        this.settingsOpen = false
        this.toast('Config saved to ' + this.configPath)
        // Upload dir changed (public dir didn't - that path reloads above): offer to
        // bring existing uploads along
        if ((config.uploadDir || '') !== prevUploadDir) this.offerUploadMigration(prevUploadDir)
      } catch (e) {
        this.toast('Config save failed: ' + e.message, 'error')
      } finally {
        this.cfgSaving = false
      }
    },

    async offerUploadMigration(fromDir) {
      const fromLabel = fromDir || '(public root)'
      const toLabel = this.config.uploadDir || '(public root)'
      if (
        !window.confirm(
          `Upload directory changed.\n\nMove existing uploads from "${fromLabel}" to "${toLabel}" and update all references?\n\nFiles move on disk immediately; the path updates land on your next save.`
        )
      )
        return
      try {
        const { moved, from, to } = await api('/api/media/migrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: fromDir })
        })
        if (!moved.length) {
          this.toast('No uploads found in the previous directory')
          return
        }
        const mapping = new Map(moved.map((n) => [`${from}/${n}`, `${to}/${n}`]))
        const updated = this.migrateUploadPaths(mapping)
        this.toast(
          `Moved ${moved.length} upload${moved.length === 1 ? '' : 's'}, updated ${updated} reference${updated === 1 ? '' : 's'}`,
          'ok',
          8000
        )
      } catch (e) {
        this.toast('Migration failed: ' + e.message, 'error')
      }
    },

    /* Rewrite every string value that exactly matches a moved upload's old path.
       Per-file undo snapshots, like the other cross-file propagations. */
    migrateUploadPaths(mapping) {
      let updated = 0
      for (const f of this.files) {
        const s = this.store[f.name]
        if (!s) continue
        let touched = false
        const walk = (node) => {
          if (node === null || typeof node !== 'object') return
          const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node)
          for (const k of keys) {
            const v = node[k]
            if (typeof v === 'string' && mapping.has(v)) {
              if (!touched) {
                if (s.journal) s.journal.structural = true // full snapshot - journal can't follow
                const stacks = this.undoStacks[f.name]
                if (stacks) {
                  stacks.undo.push(JSON.stringify(s.doc))
                  if (stacks.undo.length > 100) stacks.undo.shift()
                  stacks.redo = []
                }
                touched = true
              }
              node[k] = mapping.get(v)
              updated++
            } else {
              walk(v)
            }
          }
        }
        walk(s.doc)
        if (touched) this.dirtyMap[f.name] = serialize(s.doc) !== this.prettyBaseOf(s)
      }
      this.invalidateIndexes()
      return updated
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
    copyUpdateCommand() {
      if (!this.update) return
      if (!this.update.command) {
        this.toast('Drop-in install: pull or copy the latest jotson/ folder from GitHub')
        return
      }
      navigator.clipboard
        .writeText(this.update.command)
        .then(() => this.toast(`Copied "${this.update.command}" - run it in a terminal, then restart JotSON`, 'ok', 8000))
        .catch(() => this.toast('Could not access the clipboard', 'error'))
    },

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

    toast(msg, kind = 'ok', duration = 4000) {
      const id = Math.random().toString(36).slice(2)
      this.toasts.push({ id, msg, kind })
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id)
      }, duration)
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
