// Interactive end-to-end check against the built app (dist/), driven by Playwright.
// Reuses the Playwright install from the shared QA harness so this project stays lean.
//
//   npm run build && node scripts/e2e.mjs [--port 5402]
//
// Checks: split-lab typing converges, partition holds ops and heal converges,
// stress test reports convergence, and two tabs on the same #room= sync via
// BroadcastChannel and show each other's cursor.
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectDir = path.resolve(here, '..')
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1] || 5402)
const shots = args.includes('--shots')
const { chromium } = await import('file:///C:/Users/Bhavy/portfolio-projects/.qa/node_modules/playwright/index.mjs')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

function waitForPort(p, timeoutMs = 90000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.createConnection({ port: p, host: '127.0.0.1' })
      s.once('connect', () => (s.destroy(), resolve()))
      s.once('error', () => {
        s.destroy()
        if (Date.now() - start > timeoutMs) reject(new Error(`port ${p} never opened`))
        else setTimeout(tryOnce, 300)
      })
    }
    tryOnce()
  })
}

const server = spawn('npx.cmd', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: projectDir, stdio: 'ignore', shell: true })
const results = []
const errors = []
let browser
/** Editor text as rendered, minus remote-cursor widgets (their name flags are DOM text too). */
function editorText(page, index = 0) {
  return page.evaluate((i) => {
    const content = document.querySelectorAll('.cm-content')[i]
    if (!content) return null
    return [...content.querySelectorAll('.cm-line')]
      .map((line) => {
        const clone = line.cloneNode(true)
        clone.querySelectorAll('.cm-chorus-cursor').forEach((n) => n.remove())
        return clone.textContent
      })
      .join('\n')
  }, index)
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

try {
  await waitForPort(port)
  browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const hook = (page, tag) => {
    page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`))
    page.on('console', (m) => m.type() === 'error' && errors.push(`[${tag}] console: ${m.text()}`))
  }
  const base = `http://127.0.0.1:${port}/`

  // ── Split lab ────────────────────────────────────────────────────────────
  const lab = await ctx.newPage()
  hook(lab, 'lab')
  await lab.goto(base + '#lab', { waitUntil: 'load' })
  await lab.waitForSelector('.cm-content', { timeout: 15000 })
  await lab.waitForTimeout(1500)
  const editors = lab.locator('.cm-content')
  check('lab renders two editors', (await editors.count()) === 2)

  // Bring latency down so the checks run quickly, then type in A.
  await lab.locator('#latency').fill('100')
  await editors.nth(0).click()
  await lab.keyboard.press('Control+Home')
  await lab.keyboard.type('// typed in A\n')
  await lab.waitForTimeout(900)
  const textA = await editorText(lab, 0)
  const textB = await editorText(lab, 1)
  check('typing in A reaches B', textB.startsWith('// typed in A'), JSON.stringify(textB.slice(0, 20)))
  check('badge is CONVERGED after settle', (await lab.locator('[role=status][data-converged]').first().getAttribute('data-converged')) === 'true')

  // Partition: edits on both sides stay apart, then heal converges.
  await lab.locator('#partition').click()
  await editors.nth(1).click()
  await lab.keyboard.press('Control+End')
  await lab.keyboard.type('\n// typed in B during partition')
  await editors.nth(0).click()
  await lab.keyboard.press('Control+Home')
  await lab.keyboard.type('// A during partition\n')
  await lab.waitForTimeout(700)
  const badgeDuring = await lab.locator('[role=status][data-converged]').first().getAttribute('data-converged')
  const queued = await lab.locator('dl dd').nth(2).innerText()
  check('partition holds ops (badge DIVERGED, packets queued)', badgeDuring === 'false' && Number(queued) > 0, `queued=${queued}`)
  if (shots) await lab.screenshot({ path: path.join(projectDir, 'docs', 'lab-partitioned.png') })
  await lab.getByRole('button', { name: 'Heal' }).click()
  await lab.waitForTimeout(1500)
  const a2 = await editorText(lab, 0)
  const b2 = await editorText(lab, 1)
  const badgeAfter = await lab.locator('[role=status][data-converged]').first().getAttribute('data-converged')
  check('heal converges both texts + badge', a2 === b2 && badgeAfter === 'true' && a2.includes('typed in B during partition') && a2.includes('A during partition'))

  // Stress test under lag + loss.
  await lab.locator('#latency').fill('150')
  await lab.locator('#loss').fill('10')
  await lab.getByRole('button', { name: /Stress test/ }).click()
  await lab.waitForSelector('[data-stress-converged]', { timeout: 90000 })
  const stressOk = await lab.locator('[data-stress-converged]').getAttribute('data-stress-converged')
  const stressText = await lab.locator('[data-stress-converged]').innerText()
  check('stress test (500 ops, lag+loss) converges', stressOk === 'true', stressText.replace(/\s+/g, ' ').slice(0, 90))
  const a3 = await editorText(lab, 0)
  const b3 = await editorText(lab, 1)
  check('editors show identical text after stress', a3 === b3, `${a3.length} chars`)
  if (shots) await lab.screenshot({ path: path.join(projectDir, 'docs', 'lab-stress.png') })

  await lab.close()

  // ── Live room across two tabs (BroadcastChannel) ────────────────────────
  const room = 'e2e-' + Math.random().toString(36).slice(2, 7)
  const t1 = await ctx.newPage()
  hook(t1, 'tab1')
  await t1.goto(`${base}#room=${room}`, { waitUntil: 'load' })
  await t1.waitForSelector('.cm-content', { timeout: 15000 })
  await t1.waitForTimeout(800)
  const t2 = await ctx.newPage()
  hook(t2, 'tab2')
  await t2.goto(`${base}#room=${room}`, { waitUntil: 'load' })
  await t2.waitForSelector('.cm-content', { timeout: 15000 })
  await t2.waitForTimeout(1500)
  // Headless Edge throttles hidden pages hard (even evaluate() crawls), so
  // always bring a tab to the front before driving or reading it.
  const seed2 = await editorText(t2)
  await t1.bringToFront()
  await t1.waitForTimeout(400)
  const seed1 = await editorText(t1)
  check('second tab receives the room document on join', seed1 === seed2 && seed1.length > 0, `${seed1.length} chars`)

  await t1.locator('.cm-content').click()
  await t1.keyboard.press('Control+Home')
  await t1.keyboard.type('// hello from tab 1\n')
  await t1.waitForTimeout(700)
  const after2 = await editorText(t2)
  check('typing in tab 1 syncs to tab 2 via BroadcastChannel', after2.startsWith('// hello from tab 1'))
  const cursorIn2 = await t2.locator('.cm-chorus-cursor').count()
  const flagIn2 = await t2.locator('.cm-chorus-flag').first().innerText().catch(() => '')
  check('tab 2 shows tab 1 colored cursor with name flag', cursorIn2 >= 1 && flagIn2.length > 0, `flag="${flagIn2}"`)
  const avatars2 = await t2.locator('.avatar').count()
  check('tab 2 lists both peers as avatars', avatars2 >= 2, `${avatars2} avatars`)
  const sync2 = await t2.locator('[role=status]').first().innerText()
  check('room badge reports IN SYNC', /IN SYNC/.test(sync2), sync2.replace(/\s+/g, ' ').slice(0, 60))
  if (shots) await t2.screenshot({ path: path.join(projectDir, 'docs', 'room-two-tabs.png') })

  // Persistence: close both tabs, reopen, the text must be restored from IndexedDB.
  await t1.bringToFront()
  await t1.waitForTimeout(400)
  const textBefore = await editorText(t1)
  await t1.waitForTimeout(700) // let the debounced save land
  await t1.close()
  await t2.close()
  const t3 = await ctx.newPage()
  hook(t3, 'tab3')
  await t3.goto(`${base}#room=${room}`, { waitUntil: 'load' })
  await t3.waitForSelector('.cm-content', { timeout: 15000 })
  await t3.waitForTimeout(800)
  const restored = await editorText(t3)
  check('document restored from IndexedDB after reload', restored === textBefore, `${restored.length} chars`)
  const restoredLabel = await t3.getByText(/restored/).count()
  check('UI indicates restored state', restoredLabel > 0)
  await t3.close()
} catch (e) {
  errors.push(String(e && e.stack || e))
} finally {
  if (browser) await browser.close().catch(() => {})
  try {
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {}
}

const failed = results.filter((r) => !r.ok)
if (errors.length) console.log('\nErrors:\n' + errors.join('\n'))
console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${errors.length} page/console errors`)
process.exit(failed.length || errors.length ? 1 : 0)
