// Finds classes used in a template that have no CSS rule anywhere reachable
// from that component: neither in its own <style scoped> block nor in the
// global src/styles.css.
//
//     node scripts/check-css.mjs
//
// Why this exists: `.admin-leaflet-map` lived in styles.css, was used only in
// AdminMap.vue, and got deleted during a restyle as an apparently unused rule.
// Leaflet sizes itself from its container, so the admin map silently collapsed
// to 0px — a blank panel with no error in the console. Nothing in the build
// catches that. This does.
//
// Scoped styles do NOT cross component boundaries, which is why a rule can look
// "defined somewhere" and still be missing where it's needed.
//
// Deliberately conservative: only STATIC class="..." attributes are checked.
// Parsing `:class` expressions produced far more noise than signal (operators
// and variable names read as class names), and static classes are where layout
// regressions actually live.

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p, out)
    } else if (e.name.endsWith('.vue')) {
      out.push(p)
    }
  }
  return out
}

const globalCss = new Set(
  [...readFileSync(join(ROOT, 'src/styles.css'), 'utf8').matchAll(/\.([\w-]+)/g)].map(m => m[1])
)

// Owned by libraries or applied from JS rather than styled by us.
const EXTERNAL = /^(leaflet|router-link)/

// Known and harmless: these carry no styling of their own. Either a sibling
// class on the same element does the work (.action-btn next to .task-btn), or
// they're grouping wrappers with no visual role. Verified against git history —
// none of them ever had a rule. Remove an entry here the moment it gains one.
const ALLOWED = new Set([
  'task-btn',
  'stat',
  'head-label',
  'checkpoint-list',
  'sab-log',
  'sab-missions-block',
  'sidebar-loading',
  'results-header-right',
])

const problems = []

for (const file of walk(join(ROOT, 'src'))) {
  const src = readFileSync(file, 'utf8')
  const template = src.split('<script setup>')[0]
  const styleBlock = src.includes('<style') ? src.split('<style')[1] : ''

  const used = new Set()
  for (const m of template.matchAll(/\sclass="([^"{}]*)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (/^[a-zA-Z][\w-]*$/.test(c)) used.add(c)
    }
  }

  const defined = new Set([...styleBlock.matchAll(/\.([\w-]+)/g)].map(m => m[1]))

  for (const c of [...used].sort()) {
    if (defined.has(c) || globalCss.has(c) || EXTERNAL.test(c) || ALLOWED.has(c)) continue
    problems.push(`${relative(ROOT, file)}  .${c}`)
  }
}

if (problems.length) {
  console.log(`Klasser utan regel (${problems.length}):\n`)
  for (const p of problems) console.log('  ' + p)
  console.log('\nEn klass kan sakna regel helt legitimt (ren krok för JS eller tester).')
  console.log('Men om den ska styla något — särskilt storlek — är detta en tyst bugg.')
  process.exit(1)
}

console.log('Alla statiska klasser som används har en regel som når dem.')
