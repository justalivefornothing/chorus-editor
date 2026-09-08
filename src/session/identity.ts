import { randomSiteId } from '../crdt'
import type { PeerInfo } from '../transport/protocol'

/**
 * Peer colours are chosen for legibility on the near-black editor background
 * and for being distinguishable from syntax-highlighting hues.
 */
export const PEER_COLORS: readonly string[] = [
  '#5eead4', // teal
  '#f472b6', // pink
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#34d399', // green
  '#fb923c', // orange
  '#60a5fa', // blue
  '#f87171', // red
  '#c084fc', // purple
  '#facc15', // yellow
]

const FIRST = [
  'Ada', 'Grace', 'Linus', 'Margaret', 'Alan', 'Barbara', 'Dennis', 'Radia', 'Ken', 'Hedy',
  'Edsger', 'Frances', 'Tim', 'Katherine', 'Guido', 'Annie', 'Leslie', 'Sophie', 'Niklaus', 'Joan',
]

const ADJECTIVES = ['amber', 'quiet', 'brisk', 'cobalt', 'lunar', 'velvet', 'ember', 'misty', 'sonic', 'tidal', 'ivory', 'rapid']
const NOUNS = ['fox', 'harbor', 'canyon', 'comet', 'lantern', 'meadow', 'orbit', 'quartz', 'ridge', 'signal', 'thistle', 'willow']

export function randomName(random: () => number = Math.random): string {
  return FIRST[Math.floor(random() * FIRST.length)]
}

export function randomColor(random: () => number = Math.random): string {
  return PEER_COLORS[Math.floor(random() * PEER_COLORS.length)]
}

export function randomRoomName(random: () => number = Math.random): string {
  const adj = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(random() * NOUNS.length)]
  const num = Math.floor(random() * 90) + 10
  return `${adj}-${noun}-${num}`
}

export function randomPeer(random: () => number = Math.random): PeerInfo {
  return { site: randomSiteId(random), name: randomName(random), color: randomColor(random) }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Normalises user input into a URL-safe room slug. */
export function slugifyRoom(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug
}
