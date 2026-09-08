import { decodeMessage, encodeMessage, type Message, type Transport } from './protocol'

/**
 * Same-browser transport: every tab that opens the same room joins a
 * BroadcastChannel named after it. Messages are JSON-encoded so that the
 * receiving side always validates them (a stale tab may run an older build).
 *
 * The browser guarantees the sender never receives its own message, and
 * delivery is in-order per sender — but a tab that opens late has missed
 * everything, which is what the `hello`/`sync` handshake repairs.
 */
export const CHANNEL_PREFIX = 'chorus:room:'

export function channelNameFor(room: string): string {
  return CHANNEL_PREFIX + room
}

export function broadcastSupported(): boolean {
  return typeof BroadcastChannel !== 'undefined'
}

export class BroadcastTransport implements Transport {
  readonly kind = 'broadcast'
  private readonly channel: BroadcastChannel
  private readonly handlers = new Set<(msg: Message) => void>()
  private closed = false

  constructor(room: string) {
    if (!broadcastSupported()) throw new Error('BroadcastChannel is not available in this environment')
    this.channel = new BroadcastChannel(channelNameFor(room))
    this.channel.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return
      const msg = decodeMessage(ev.data)
      if (!msg) return
      for (const h of this.handlers) h(msg)
    }
  }

  send(msg: Message): void {
    if (this.closed) return
    this.channel.postMessage(encodeMessage(msg))
  }

  subscribe(handler: (msg: Message) => void): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.handlers.clear()
    this.channel.close()
  }
}
