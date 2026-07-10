// JotSON - zero-dependency local server (drop the jotson/ folder into any project).
// Serves the editor UI and a small read/write API over the configured JSON data dir.
// Run with: node jotson/server.mjs   (never deployed; binds to localhost only)
// Requires Node 18+. No npm packages - Vue is vendored in jotson/vendor/.

import http from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Project root defaults to the jotson/ folder's parent; override with JOTSON_ROOT if placed elsewhere
const ROOT = process.env.JOTSON_ROOT ? path.resolve(process.env.JOTSON_ROOT) : path.resolve(__dirname, '..')
const PUBLIC_DIR = path.join(__dirname, 'public')
// Vendored copy keeps the editor dependency-free; falls back to a host-project install if removed
const VUE_CANDIDATES = [
  path.join(__dirname, 'vendor', 'vue.js'),
  path.join(ROOT, 'node_modules', 'vue', 'dist', 'vue.global.prod.js')
]
// Config resolves per-project so npx runs (shared npm cache) don't bleed settings between
// projects: $JOTSON_CONFIG → <root>/jotson.config.json → in-folder jotson.config.json (drop-in)
const LEGACY_CONFIG_PATH = path.join(__dirname, 'jotson.config.json')
const PROJECT_CONFIG_PATH = path.join(ROOT, 'jotson.config.json')
const fileExists = (p) => fs.access(p).then(() => true, () => false)
const CONFIG_PATH = process.env.JOTSON_CONFIG
  ? path.resolve(process.env.JOTSON_CONFIG)
  : (await fileExists(PROJECT_CONFIG_PATH)) || !(await fileExists(LEGACY_CONFIG_PATH))
    ? PROJECT_CONFIG_PATH
    : LEGACY_CONFIG_PATH
// Path shown in the UI: project-relative when inside the root, absolute otherwise
const configDisplayPath = () => {
  const rel = path.relative(ROOT, CONFIG_PATH)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replaceAll('\\', '/') : CONFIG_PATH
}

// Preferred port. If the default is busy the OS picks a free one; an explicit
// JOTSON_PORT is honored strictly and errors out instead of silently moving.
const PORT = Number(process.env.JOTSON_PORT) || 4400
const FILE_NAME_RE = /^[A-Za-z0-9_-]+\.json$/

const CONFIG_DEFAULTS = {
  dataDir: '',
  publicDir: '',
  logo: null,
  logoLight: null,
  title: '',
  labelFields: ['title', 'label', 'name', 'id'],
  jotsonBrand: '{J𝘰𝓉SON}',
}

let config = { ...CONFIG_DEFAULTS }
try {
  config = { ...CONFIG_DEFAULTS, ...JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8')) }
} catch {
  /* no config file - defaults apply */
}

const dataDir = () => path.resolve(ROOT, config.dataDir)
const sitePublicDir = () => path.resolve(ROOT, config.publicDir)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogg': 'video/ogg'
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function validName(name) {
  return typeof name === 'string' && FILE_NAME_RE.test(name)
}

async function listDataFiles() {
  const entries = await fs.readdir(dataDir())
  const files = []
  for (const name of entries.filter((n) => n.endsWith('.json')).sort()) {
    const stat = await fs.stat(path.join(dataDir(), name))
    files.push({ name, size: stat.size, mtime: stat.mtimeMs })
  }
  return files
}

async function isDirectory(p) {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/* ---------- link unfurling (OpenGraph/Twitter meta) ---------- */
const unfurlCache = new Map()
const UNFURL_TTL = 3600e3
const UNFURL_MAX = 200

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
}

function metaContent(html, names) {
  for (const name of names) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i')
    ]
    for (const re of patterns) {
      const m = html.match(re)
      if (m && m[1]) return decodeEntities(m[1].trim())
    }
  }
  return null
}

async function unfurl(target) {
  const cached = unfurlCache.get(target)
  if (cached && Date.now() - cached.at < UNFURL_TTL) return cached.data
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  let data
  try {
    const resp = await fetch(target, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // Some sites only serve OpenGraph tags to browser-like agents
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml'
      }
    })
    const html = (await resp.text()).slice(0, 500000)
    data = {
      url: target,
      title:
        metaContent(html, ['og:title', 'twitter:title']) ||
        decodeEntities((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim() ||
        null,
      description: metaContent(html, ['og:description', 'twitter:description', 'description']),
      image: metaContent(html, ['og:image', 'og:image:url', 'twitter:image']),
      siteName: metaContent(html, ['og:site_name'])
    }
  } catch {
    data = { url: target, title: null, description: null, image: null, siteName: null }
  } finally {
    clearTimeout(timer)
  }
  unfurlCache.set(target, { at: Date.now(), data })
  if (unfurlCache.size > UNFURL_MAX) unfurlCache.delete(unfurlCache.keys().next().value)
  return data
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean) // ['api', ...]

  if (parts[1] === 'config' && parts.length === 2) {
    if (req.method === 'GET') return sendJson(res, 200, { config, configPath: configDisplayPath() })
    if (req.method === 'PUT') {
      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        return sendJson(res, 400, { error: 'Request body must be JSON' })
      }
      const next = { ...config }
      if (typeof body.dataDir === 'string' && body.dataDir.trim()) next.dataDir = body.dataDir.trim()
      if (typeof body.publicDir === 'string' && body.publicDir.trim()) next.publicDir = body.publicDir.trim()
      next.logo = typeof body.logo === 'string' && body.logo.trim() ? body.logo.trim() : null
      next.logoLight = typeof body.logoLight === 'string' && body.logoLight.trim() ? body.logoLight.trim() : null
      if (typeof body.title === 'string') next.title = body.title.trim() || CONFIG_DEFAULTS.title
      if (Array.isArray(body.labelFields)) {
        const fields = body.labelFields.map((f) => String(f).trim()).filter(Boolean)
        next.labelFields = fields.length ? fields : CONFIG_DEFAULTS.labelFields
      }
      if (!(await isDirectory(path.resolve(ROOT, next.dataDir)))) {
        return sendJson(res, 400, { error: `Data directory not found: ${next.dataDir}` })
      }
      if (!(await isDirectory(path.resolve(ROOT, next.publicDir)))) {
        return sendJson(res, 400, { error: `Public directory not found: ${next.publicDir}` })
      }
      config = next
      await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8')
      return sendJson(res, 200, { ok: true, config, configPath: configDisplayPath() })
    }
  }

  if (req.method === 'GET' && parts[1] === 'files' && parts.length === 2) {
    return sendJson(res, 200, { files: await listDataFiles() })
  }

  if (req.method === 'GET' && parts[1] === 'unfurl' && parts.length === 2) {
    const target = url.searchParams.get('url') || ''
    if (!/^https?:\/\//i.test(target)) return sendJson(res, 400, { error: 'Only http(s) URLs' })
    return sendJson(res, 200, await unfurl(target))
  }

  if (parts[1] === 'files' && parts.length === 3) {
    const name = decodeURIComponent(parts[2])
    if (!validName(name)) return sendJson(res, 400, { error: 'Invalid file name' })
    const filePath = path.join(dataDir(), name)

    if (req.method === 'GET') {
      try {
        const text = await fs.readFile(filePath, 'utf8')
        return sendJson(res, 200, { name, text })
      } catch {
        return sendJson(res, 404, { error: 'File not found' })
      }
    }

    if (req.method === 'PUT') {
      // Only overwrite files that already exist - the CMS edits, it doesn't create.
      try {
        await fs.access(filePath)
      } catch {
        return sendJson(res, 404, { error: 'File not found' })
      }
      const body = await readBody(req)
      let payload
      try {
        payload = JSON.parse(body)
      } catch {
        return sendJson(res, 400, { error: 'Request body must be JSON' })
      }
      if (typeof payload.text !== 'string') {
        return sendJson(res, 400, { error: 'Missing "text" field' })
      }
      try {
        JSON.parse(payload.text)
      } catch (e) {
        return sendJson(res, 400, { error: `Refusing to save invalid JSON: ${e.message}` })
      }
      await fs.writeFile(filePath, payload.text, 'utf8')
      return sendJson(res, 200, { ok: true })
    }
  }

  return sendJson(res, 404, { error: 'Unknown API route' })
}

async function handleStatic(res, pathname) {
  if (pathname === '/vendor/vue.js') {
    for (const candidate of VUE_CANDIDATES) {
      try {
        const buf = await fs.readFile(candidate)
        return send(res, 200, buf, MIME['.js'])
      } catch {
        /* try next candidate */
      }
    }
    return send(res, 500, 'Vue build not found - restore jotson/vendor/vue.js', 'text/plain')
  }
  // /site/* serves the project's public dir so media previews work without yarn dev
  if (pathname.startsWith('/site/')) {
    const base = sitePublicDir()
    const sitePath = path.join(base, decodeURIComponent(pathname.slice(6)))
    if (!sitePath.startsWith(base)) return send(res, 403, 'Forbidden', 'text/plain')
    try {
      const buf = await fs.readFile(sitePath)
      const ext = path.extname(sitePath).toLowerCase()
      const type = MIME[ext] || 'application/octet-stream'
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' }
      if (ext === '.svg') {
        // <img> previews never execute SVG scripts, but if the URL is opened directly as a
        // document this blocks scripts/external loads too (inline styles stay allowed)
        headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
      }
      res.writeHead(200, headers)
      return res.end(buf)
    } catch {
      return send(res, 404, 'Not found in public/', 'text/plain')
    }
  }
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
  const filePath = path.join(PUBLIC_DIR, rel)
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain')
  try {
    const buf = await fs.readFile(filePath)
    const type = MIME[path.extname(filePath)] || 'application/octet-stream'
    return send(res, 200, buf, type)
  } catch {
    return send(res, 404, 'Not found', 'text/plain')
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
    } else {
      await handleStatic(res, url.pathname)
    }
  } catch (e) {
    sendJson(res, 500, { error: e.message })
  }
})

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err
  if (process.env.JOTSON_PORT) {
    console.error(`\n  Port ${PORT} (JOTSON_PORT) is already in use.\n`)
    process.exit(1)
  }
  server.listen(0, '127.0.0.1') // default port taken - let the OS assign a free one
})

server.listen(PORT, '127.0.0.1', () => {
  const { port } = server.address()
  console.log(`\n  ${config.title === '' ? config.jotsonBrand : config.jotsonBrand + ' - ' + config.title}`)
  if (port !== PORT) console.log(`  Port ${PORT} is in use - using ${port} instead`)
  console.log(`  Editing:  ${dataDir()}`)
  console.log(`  Media:    ${sitePublicDir()}`)
  console.log(`  Config:   ${CONFIG_PATH}`)
  console.log(`\n  ➜  http://localhost:${port}\n`)
})
