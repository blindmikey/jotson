<div align="center">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/blindmikey/jotson/main/docs/jotson.svg">
        <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/blindmikey/jotson/main/docs/jotson-light.svg">
        <img alt="JotSON" height="64" src="https://raw.githubusercontent.com/blindmikey/jotson/main/docs/jotson-w-bg.svg">
    </picture>
    <div><a href="https://www.npmjs.com/package/@blindmikey/jotson"><img alt="npm" src="https://img.shields.io/npm/v/%40blindmikey%2Fjotson?label=npm&color=6d78f2"></a></div>
    <h2>A lightweight and intuitive editor for your project's JSON.</h2>
    <div><a href='https://ko-fi.com/G0G2231VF9' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi3.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a></div>
    <div><span>&nbsp;</span></div>
</div>

<div align="center">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/blindmikey/jotson/main/docs/screenshot.png">
        <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/blindmikey/jotson/main/docs/screenshot-light.png">
        <img alt="JotSON" src="https://raw.githubusercontent.com/blindmikey/jotson/main/docs/screenshot-light.png">
    </picture>
</div>

- **Finder-style columns** - drill through your data with breadcrumbs, keyboard navigation,
  and browser back/forward across jumps.
- **Smart types** - dates, datetimes, and colors get native pickers; images and videos
  preview inline (with pixel dimensions and file size), external URLs unfurl into link
  cards, and multi-line strings render as Markdown.
- **File uploads** - point a key at local media, or upload straight from the editor:
  files land in your configured upload directory as collision-proof UUIDs and the
  site-relative path is stored. Includes unused-upload cleanup and directory migration.
- **References** (opt-in) - string ids that resolve to objects across *all* your files:
  resolved labels in columns, a searchable picker, "referenced by" backlinks, and integrity
  guards that offer to update or clean references when ids are renamed or objects deleted.
  Enable in ⚙️ when your ids are globally unique.
- **Full structural editing** - add/rename/reorder/duplicate/delete keys and items (sort an
  object's keys with one click), auto-generated UUID ids, per-file undo/redo, and an inline
  fields overview where every field is editable with its full type-aware editor.
- **Schema-aware** - if `records.json` has a `records.schema.json` beside it, jotson respects
  it: string fields with an `enum` become dropdowns instead of free text. No schema yet? One
  click derives one from your existing data, inferring dropdown options for fields whose
  values repeat from a small set. Either way you can open and edit the schema inside jotson
  itself, with the same columns, undo, and diff-confirmed saves as any other file.
- **Safe saves** - every save shows a line diff for confirmation, preserves line endings
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

### Requirements: Node 18+. Nothing else.

There are no npm dependencies, the server uses only
Node built-ins (including global `fetch` for link previews), and the UI runs on a vendored copy of
Vue (`vendor/vue.js`, Vue 3.5, MIT license). No build step, ready to use out-of-the-box.
