/**
 * UI smoke test driven over the Chrome DevTools Protocol.
 * Prereq: app running via `npm run dev -- -- --remote-debugging-port=9222`
 * Run with: node scripts/smoke-ui.mjs
 */
import { writeFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const CDP = 'http://127.0.0.1:9222'
const here = dirname(fileURLToPath(import.meta.url))

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`  ok: ${name}`)
  else {
    failures++
    console.error(`  FAIL: ${name}`, detail ?? '')
  }
}

async function findPage(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const list = await (await fetch(`${CDP}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
      if (page) return page
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Could not find app page via CDP — is the dev app running with --remote-debugging-port=9222?')
}

const page = await findPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let msgId = 0
const pending = new Map()
const consoleErrors = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message))
    else resolve(msg.result)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception')
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
  }
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate failed')
  }
  return res.result.value
}

async function screenshot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' })
  const path = join('/tmp', name)
  writeFileSync(path, Buffer.from(res.data, 'base64'))
  console.log(`  screenshot: ${path}`)
}

await send('Runtime.enable')
await send('Page.enable')

console.log('boot')
const boot = await evaluate(`(() => {
  return {
    hasApi: typeof window.api === 'object',
    hasStore: typeof window.__store === 'function',
    sections: window.__store.getState().project.sections.length
  }
})()`)
check('preload api exposed', boot.hasApi)
check('store exposed (dev)', boot.hasStore)
check('fresh project has 1 section', boot.sections === 1, boot.sections)

console.log('settings view (no API key state)')
const settings = await evaluate(`window.api.settings.get()`)
check('settings load, no key configured', settings && settings.hasApiKey === false, settings)

console.log('import demo script through the real parser + store')
const demoText = JSON.stringify(readFileSync(join(here, '../demo/demo-script.txt'), 'utf-8'))
const imported = await evaluate(`(async () => {
  // Wait for the dev parser hook
  for (let i = 0; i < 50 && !window.__parseScript; i++) await new Promise(r => setTimeout(r, 100))
  const parsed = window.__parseScript(${demoText})
  const rows = parsed.speakers.map((name) => ({
    parsedName: name,
    displayName: name === 'Rachael' ? 'Rachel' : name,
    voiceId: null,
    mergeInto: null
  }))
  window.__store.getState().applyImport(parsed, rows, 'replace')
  const p = window.__store.getState().project
  return {
    sections: p.sections.map(s => ({ name: s.name, items: s.items.length })),
    speakers: p.speakers.map(s => s.name),
    firstLine: p.sections[0].items[0]
  }
})()`)
check('3 sections imported', imported.sections.length === 3, imported.sections)
check('9 lines total', imported.sections.reduce((n, s) => n + s.items, 0) === 9)
check(
  'speaker names (Rachael corrected to Rachel)',
  imported.speakers.join('|') === 'Voice 1|Voice 2|Rachel',
  imported.speakers
)
check('line has speaker + text', !!imported.firstLine.speakerId && imported.firstLine.text.includes('Hey Sam'))
await screenshot('freditor-ui-imported.png')

console.log('generate without API key -> guided to settings')
const noKey = await evaluate(`(async () => {
  const st = window.__store.getState()
  const lineId = st.project.sections[0].items[0].id
  await st.generateLines([lineId])
  const after = window.__store.getState()
  return { modal: after.modal, toast: after.toast, queueRunning: after.queue.running }
})()`)
check('settings modal opened', noKey.modal === 'settings', noKey)
check('toast explains missing key', /api key/i.test(noKey.toast ?? ''), noKey.toast)
check('queue not started', noKey.queueRunning === false)
await screenshot('freditor-ui-nokey.png')

console.log('editor state checks')
const editor = await evaluate(`(() => {
  const st = window.__store.getState()
  st.setModal(null)
  // char estimation across pending lines
  const p = st.project
  const lines = p.sections.flatMap(s => s.items).filter(i => i.type === 'line')
  const chars = lines.reduce((n, l) => n + l.text.trim().length, 0)
  // stale flow: no generation yet, so all are 'not-generated' but no voice assigned
  return { chars, lineCount: lines.length }
})()`)
check('character estimate > 500 for demo', editor.chars > 500, editor.chars)

console.log('quota endpoint fails gracefully without key')
const quotaErr = await evaluate(`window.api.el.getSubscription().then(() => null, (e) => String(e))`)
check('subscription rejects with clear message', /api key/i.test(quotaErr ?? ''), quotaErr)

const uiErrors = consoleErrors.filter(
  (e) => !/Electron Security Warning|VAAPI|Autofill/i.test(e)
)
check('no renderer console errors', uiErrors.length === 0, uiErrors)

ws.close()
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall UI smoke checks passed')
