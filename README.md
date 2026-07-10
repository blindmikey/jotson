# JotSON

[![npm](https://img.shields.io/npm/v/%40blindmikey%2Fjotson?label=npm&color=cb3837)](https://www.npmjs.com/package/@blindmikey/jotson)

A lightweight and intuitive editor for your project's JSON.

- **Finder-style columns** — drill through your data with breadcrumbs, keyboard navigation,
  and browser back/forward across jumps.
- **Smart types** — dates, datetimes, and colors get native pickers; images, videos, and
  URLs get live previews (including server-side link unfurling).
- **File uploads** — point a key at local media, or upload straight from the editor:
  files land in your configured upload directory as collision-proof UUIDs and the
  site-relative path is stored. Includes unused-upload cleanup and directory migration.
- **References** — string ids that resolve to objects across *all* your files: resolved
  labels in columns, a searchable picker, "referenced by" backlinks, and integrity guards
  that offer to update or clean references when ids are renamed or objects deleted.
- **Full structural editing** — add/rename/reorder/duplicate/delete keys and items,
  auto-generated UUID ids, per-file undo/redo, and an inline fields overview per object.
- **Safe saves** — every save shows a line diff for confirmation, preserves line endings
  for minimal git noise, and nothing touches disk until you say so.
- **Fuzzy search** across every file (Ctrl+K), a syntax-highlighted raw view, dark/light
  themes, and a built-in update notice.

## Install

Install once globally, then run `jotson` in any project:

```bash
npm i -g @blindmikey/jotson
cd your-project
jotson
```

Prefer zero-install? `npx @blindmikey/jotson` works too.

## Drop-in usage

Copy this `jotson/` folder into any project, then:

```bash
node jotson/server.mjs
```

**Requirements: Node 18+. Nothing else.** There are no npm dependencies, the server uses only
Node built-ins (including global `fetch` for link previews), and the UI runs on a vendored copy of
Vue (`vendor/vue.js`, Vue 3.5, MIT license). No build step, no install.

## Configuration: `jotson.config.json`

JotSON looks for its config in your project's root as `jotson.config.json` (override the
path with the `JOTSON_CONFIG` env var). In drop-in mode, a `jotson.config.json` inside the
tool's folder also works if no project-root config exists.

```json
{
  "dataDir": "data/json",
  "publicDir": "public",
  "logo": "/assets/images/logo.svg",
  "logoLight": "/assets/images/logo_alt.svg",
  "title": "My Project",
  "labelFields": ["title", "label", "name", "id"]
}
```

| Key | Meaning | Default |
| --- | --- | --- |
| `dataDir` | Directory of editable `.json` files, relative to the project root | `assets/data/json` |
| `publicDir` | Static media root; served at `/site/*` so `/…` asset paths preview | `public` |
| `uploadDir` | Where file uploads are stored, relative to `publicDir` (created on first upload). Changing it offers to move existing uploads along and update every path referencing them | empty (= the `publicDir` root) |
| `logo` | Optional image path (relative to `publicDir`) shown as the header brand | `null` (shows `title`) |
| `logoLight` | Optional logo variant for the light theme (e.g. dark-text version) | `null` (reuses `logo` on a dark chip) |
| `title` | Text brand fallback and window title | JotSON wordmark |
| `labelFields` | Priority-ordered fields used to name objects in columns/breadcrumbs | see above |
| `idFields` | Field names that identify objects as reference targets | `["id"]` |

All of this is also editable in-app via the ⚙ panel (directory changes are validated
server-side; saves go to the resolved config path). If no config file exists, the defaults
above apply and the first ⚙ save creates `jotson.config.json` in your project root.

## Environment variables

- `JOTSON_PORT`: server port. Unset, the default `4400` is tried and, if busy, a free port
  is chosen automatically (printed at startup). Set explicitly, a busy port is an error.
- `JOTSON_ROOT`: project root, if the `jotson/` folder does not live directly inside it
  (default: the folder's parent; `npx jotson` sets it to the invocation directory)
- `JOTSON_CONFIG`: explicit config file path (default: `<project root>/jotson.config.json`,
  falling back to the same name inside the tool's folder)

## Notes

- Binds to `127.0.0.1` only; intended as a local dev tool, never a deployed service.
- Saves are validated (must parse as JSON), shown as a line diff for confirmation first, and
  preserve each file's existing CRLF/LF line endings for minimal version-control noise.
- There is deliberately no backup system, the assumption is your data files live in git.
- String `id` fields are auto-generated as UUIDs when adding/duplicating items.
- Strings matching `YYYY-MM-DD` / ISO datetimes are treated as `date`/`datetime` types with
  native pickers and multi-format previews (RFC 3339, Unix, Unix ms, UTC, relative).
- Strings that look like local media paths (`/images/hero.png`) are treated as the `file`
  type: still a plain string, but with an Upload button. Uploads are copied into the upload
  directory renamed to a UUID, and the stored value becomes the site-relative path (so the
  preview renders). Media-only allowlist, 100 MB cap.
- Deleting a key never deletes the file it points to. Abandoned uploads are reclaimed via
  ⚙ → "Scan unused uploads", which lists UUID-named media files nothing references (unsaved
  edits count as references) and deletes them only after confirmation. Files jotson didn't
  create are never touched.
- References: a string equal to some object's `id` (configurable via `idFields`) is treated
  as the `reference` type — columns show the resolved label (`→ Jane Doe`), the inspector
  shows a target card with a go-to link, and a picker modal (search or browse collections)
  swaps the target. Works across files. Id-bearing objects list everything that references
  them as jump links, and browser back/forward retraces jumps and file switches. Renaming
  an id offers to update every reference to follow; deleting a referenced object warns and
  offers to clean the references up (array entries removed, key values blanked).
- YouTube/Vimeo URLs preview as playable embeds; other external links show an OpenGraph
  preview card (title/description/image), fetched server-side and cached in memory.
- Light/dark theme toggle in the top bar (persisted per browser).
- Update notice: on load, the current version is compared against npm (one registry request
  per server run, skipped silently when offline). If a newer version exists, a green pill in
  the top bar shows it — click to copy the right update command for how you run JotSON.
