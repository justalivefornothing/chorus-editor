import { describe, expect, it } from 'vitest'
import { decodeMessage, encodeMessage, messageFromJSON, type Message } from './protocol'

describe('protocol encoding', () => {
  it('round-trips every message kind', () => {
    const msgs: Message[] = [
      { k: 'hello', from: 'A', peer: { site: 'A', name: 'Ada', color: '#fff' }, vv: { A: 2 } },
      { k: 'ops', from: 'A', ops: [{ t: 'i', site: 'A', seq: 1, ctr: 1, origin: null, s: 'hi' }, { t: 'd', site: 'A', seq: 2, target: ['A', 1], n: 1 }] },
      { k: 'sync', from: 'A', vv: {} },
      { k: 'presence', from: 'A', peer: { site: 'A', name: 'Ada', color: '#fff' }, cursor: { anchor: ['A', 1], head: null }, typing: true },
      { k: 'bye', from: 'A' },
    ]
    for (const m of msgs) expect(decodeMessage(encodeMessage(m))).toEqual(m)
  })

  it('rejects malformed messages instead of throwing', () => {
    expect(decodeMessage('garbage')).toBeNull()
    expect(messageFromJSON({ k: 'hello', from: 'A' })).toBeNull()
    expect(messageFromJSON({ k: 'ops', from: 'A', ops: [{ t: 'i' }] })).toBeNull()
    expect(messageFromJSON({ k: 'presence', from: 'A', peer: { site: 'A', name: 'x', color: 'y' }, cursor: { anchor: 5 }, typing: false })).toBeNull()
    expect(messageFromJSON({ k: 'nope', from: 'A' })).toBeNull()
    expect(messageFromJSON({ k: 'sync', vv: {} })).toBeNull()
  })
})
