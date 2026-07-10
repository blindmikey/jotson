# JotSON

A lightweight and intuitive editor for your project's JSON.
Column-based navigation, smart previews (images, videos, dates, colors, URLs), full
structural editing with undo/redo, fuzzy search, a raw JSON view, and diff-confirmed saves.

## NPX usage

Navigate to your project then run:

```bash
npx jotson
```

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
| `logo` | Optional image path (relative to `publicDir`) shown as the header brand | `null` (shows `title`) |
| `logoLight` | Optional logo variant for the light theme (e.g. dark-text version) | `null` (reuses `logo` on a dark chip) |
| `title` | Text brand fallback and window title | JotSON wordmark |
| `labelFields` | Priority-ordered fields used to name objects in columns/breadcrumbs | see above |

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
- YouTube/Vimeo URLs preview as playable embeds; other external links show an OpenGraph
  preview card (title/description/image), fetched server-side and cached in memory.
- Light/dark theme toggle in the top bar (persisted per browser).
