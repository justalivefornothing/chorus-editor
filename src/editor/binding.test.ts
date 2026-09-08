// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { RgaDoc } from '../crdt'
import { Replica } from '../session/replica'
import { VirtualClock } from '../sim/clock'
import { SimNetwork } from '../sim/network'
import { seededRng } from '../sim/rng'
import { changesToLocal, EditorBinding, effectsToChangeSet, remoteAnnotation } from './binding'
import { remoteCursors, remoteCursorsField, updateRemoteCursors } from './presence'

describe('changesToLocal (pure)', () => {
  it('converts a multi-range change set into sequential CRDT edits', () => {
    const state = EditorState.create({ doc: 'abcdefgh' })
    const tr = state.update({
      changes: [
        { from: 1, to: 3, insert: 'XYZ' }, // abcdefgh -> aXYZdefgh
        { from: 5, to: 6 }, // remove 'f'
        { from: 8, insert: '!' }, // append
      ],
    })
    expect(tr.state.doc.toString()).toBe('aXYZdegh!')
    const local = changesToLocal(tr.changes, (a, b) => tr.state.doc.sliceString(a, b))
    // Replay sequentially into a plain CRDT and compare.
    const doc = new RgaDoc('A')
    doc.localInsert(0, 'abcdefgh')
    for (const c of local) {
      if (c.remove) doc.localDelete(c.index, c.remove)
      if (c.insert) doc.localInsert(c.index, c.insert)
    }
    expect(doc.text()).toBe('aXYZdegh!')
  })
})

describe('effectsToChangeSet (pure)', () => {
  it('composes sequential effects into one ChangeSet', () => {
    const cs = effectsToChangeSet(
      [
        { kind: 'insert', index: 0, text: 'AB' },
        { kind: 'delete', index: 3, length: 2 },
        { kind: 'insert', index: 3, text: 'z' },
      ],
      5,
    )
    const state = EditorState.create({ doc: 'hello' })
    expect(state.update({ changes: cs }).state.doc.toString()).toBe('ABhzlo')
  })
})

function makeRoom() {
  const clock = new VirtualClock()
  const net = new SimNetwork(clock, seededRng(1), { latencyMs: 10, jitter: 0 })
  const a = new Replica({ peer: { site: 'A', name: 'Ada', color: '#5eead4' }, transport: net.endpoint('A'), clock })
  const b = new Replica({ peer: { site: 'B', name: 'Bo', color: '#f472b6' }, transport: net.endpoint('B'), clock })
  a.start()
  b.start()
  return { clock, net, a, b }
}

function makeView(replica: Replica, parent: HTMLElement) {
  const binding = new EditorBinding(replica)
  const view = new EditorView({
    state: EditorState.create({ doc: replica.doc.text(), extensions: [binding.extension(), remoteCursors()] }),
    parent,
  })
  binding.attach(view)
  return { view, binding }
}

describe('EditorBinding (jsdom)', () => {
  const views: EditorView[] = []
  afterEach(() => {
    for (const v of views.splice(0)) v.destroy()
  })

  it('turns local transactions into ops and applies remote ops without echo', () => {
    const { clock, a, b } = makeRoom()
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const ea = makeView(a, parent)
    const eb = makeView(b, parent)
    views.push(ea.view, eb.view)

    ea.view.dispatch({ changes: { from: 0, insert: 'hello' } })
    expect(a.doc.text()).toBe('hello')
    expect(a.doc.versionJSON()).toEqual({ A: 1 })
    clock.advance(50)
    expect(b.doc.text()).toBe('hello')
    expect(eb.view.state.doc.toString()).toBe('hello')
    // The remote application must not have produced a new op on B.
    expect(b.doc.versionJSON()).toEqual({ A: 1 })

    eb.view.dispatch({ changes: { from: 5, insert: ' world' } })
    eb.view.dispatch({ changes: { from: 0, to: 1, insert: 'H' } })
    clock.advance(50)
    expect(ea.view.state.doc.toString()).toBe('Hello world')
    expect(a.doc.text()).toBe('Hello world')
    expect(a.doc.versionString()).toBe(b.doc.versionString())
  })

  it('keeps the local caret in place when remote text lands before it', () => {
    const { clock, a, b } = makeRoom()
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const ea = makeView(a, parent)
    const eb = makeView(b, parent)
    views.push(ea.view, eb.view)
    ea.view.dispatch({ changes: { from: 0, insert: 'function f() {}' } })
    clock.advance(50)
    // B's caret sits right after 'f' (index 10).
    eb.view.dispatch({ selection: { anchor: 10 } })
    // A prepends a comment line.
    ea.view.dispatch({ changes: { from: 0, insert: '// hi\n' } })
    clock.advance(50)
    expect(eb.view.state.doc.toString()).toBe('// hi\nfunction f() {}')
    expect(eb.view.state.selection.main.head).toBe(16)
    expect(eb.view.state.doc.sliceString(15, 16)).toBe('f')
  })

  it('renders remote cursors and selections as decorations', () => {
    const { a } = makeRoom()
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const ea = makeView(a, parent)
    views.push(ea.view)
    ea.view.dispatch({ changes: { from: 0, insert: 'hello world' }, annotations: remoteAnnotation.of(true) })
    updateRemoteCursors(ea.view, [
      { site: 'B', name: 'Bo', color: '#f472b6', anchor: 0, head: 5, movedAt: 1, typing: false },
      { site: 'C', name: 'Cy', color: '#fbbf24', anchor: 8, head: 8, movedAt: 2, typing: true },
    ])
    const decos = ea.view.state.field(remoteCursorsField)
    expect(decos.size).toBe(3) // one selection mark + two caret widgets
    const dom = ea.view.contentDOM
    const carets = dom.querySelectorAll('.cm-chorus-cursor')
    expect(carets.length).toBe(2)
    expect(dom.querySelectorAll('.cm-chorus-selection').length).toBeGreaterThan(0)
    expect(dom.querySelector('.cm-chorus-cursor.is-typing')).not.toBeNull()
    expect([...dom.querySelectorAll('.cm-chorus-flag')].map((n) => n.textContent)).toEqual(['Bo', 'Cy'])
    // Decorations map through document changes.
    ea.view.dispatch({ changes: { from: 0, insert: '>> ' }, annotations: remoteAnnotation.of(true) })
    const after = ea.view.state.field(remoteCursorsField)
    let firstFrom = -1
    after.between(0, 100, (from) => {
      if (firstFrom < 0) firstFrom = from
    })
    expect(firstFrom).toBe(3)
  })

  it('remote annotation prevents echo even for direct dispatches', () => {
    const { a } = makeRoom()
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const ea = makeView(a, parent)
    views.push(ea.view)
    ea.view.dispatch({ changes: { from: 0, insert: 'ghost' }, annotations: remoteAnnotation.of(true) })
    expect(a.doc.text()).toBe('')
    expect(a.doc.versionJSON()).toEqual({})
  })
})
