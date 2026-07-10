#!/usr/bin/env node
process.env.JOTSON_ROOT ||= process.cwd()
await import('../server.mjs')
