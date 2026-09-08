import { isLanguageId, type LanguageId } from '../editor/languages'
import { randomRoomName, slugifyRoom } from '../session/identity'

export type Mode = 'room' | 'lab'

export interface Route {
  readonly mode: Mode
  readonly room: string
  readonly lang: LanguageId | null
}

/**
 * URL hash <-> route. Shareable forms:
 *   #room=amber-fox-42            live room over BroadcastChannel
 *   #room=amber-fox-42&lang=json  ...with a language hint
 *   #lab                          split-view simulated-network demo
 */
export function parseHash(hash: string): Route | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (raw === '') return null
  if (raw === 'lab' || raw.startsWith('lab&')) {
    const params = new URLSearchParams(raw.replace(/^lab&?/, ''))
    const lang = params.get('lang')
    return { mode: 'lab', room: 'lab', lang: isLanguageId(lang) ? lang : null }
  }
  const params = new URLSearchParams(raw)
  const room = slugifyRoom(params.get('room') ?? '')
  if (!room) return null
  const lang = params.get('lang')
  return { mode: 'room', room, lang: isLanguageId(lang) ? lang : null }
}

export function formatHash(route: Route): string {
  const lang = route.lang ? `&lang=${route.lang}` : ''
  if (route.mode === 'lab') return `#lab${lang}`
  return `#room=${encodeURIComponent(route.room)}${lang}`
}

export function defaultRoute(random: () => number = Math.random): Route {
  return { mode: 'room', room: randomRoomName(random), lang: null }
}

export function readRoute(): Route {
  const parsed = typeof location !== 'undefined' ? parseHash(location.hash) : null
  return parsed ?? defaultRoute()
}

export function writeRoute(route: Route, replace = false): void {
  const hash = formatHash(route)
  if (location.hash === hash) return
  if (replace) history.replaceState(null, '', hash)
  else location.hash = hash
}
