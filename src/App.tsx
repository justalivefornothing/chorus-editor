import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SAMPLE_TEXT, type LanguageId } from './editor/languages'
import { createRoomStore, type RoomRecord } from './persistence/store'
import { randomSiteId } from './crdt'
import { randomColor, randomName } from './session/identity'
import { RoomSession } from './session/room-session'
import { usePeers, useTyping } from './state/presence-store'
import { formatHash, readRoute, writeRoute, type Mode, type Route } from './state/route'
import { broadcastSupported } from './transport/broadcast'
import type { PeerInfo } from './transport/protocol'
import { LabView } from './ui/LabView'
import { PeerAvatars } from './ui/PeerAvatars'
import { RoomSwitcher } from './ui/RoomSwitcher'
import { RoomView } from './ui/RoomView'
import { TopBar } from './ui/TopBar'

const DEFAULT_LANGUAGE: LanguageId = 'typescript'

export default function App() {
  const store = useMemo(() => createRoomStore(), [])
  const self = useMemo(() => tabIdentity(), [])
  const [route, setRoute] = useState<Route>(() => readRoute())
  const [session, setSession] = useState<RoomSession | null>(null)
  const [recent, setRecent] = useState<readonly RoomRecord[]>([])
  const [language, setLanguageState] = useState<LanguageId>(route.lang ?? DEFAULT_LANGUAGE)
  const [error, setError] = useState<string | null>(null)
  const lastRoom = useRef(route.mode === 'room' ? route.room : storedRoom())

  // Normalise the URL on first load (a bare URL gets a random room) and follow hash changes.
  useEffect(() => {
    writeRoute(readRoute(), true)
    const onHash = () => {
      const next = readRoute()
      setRoute(next)
      if (next.lang) setLanguageState(next.lang)
    }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (route.mode !== 'room') return
    lastRoom.current = route.room
    try {
      sessionStorage.setItem('chorus:last-room', route.room)
    } catch {
      /* private mode */
    }
  }, [route])

  // Open / close the live room session when the room changes.
  useEffect(() => {
    if (route.mode !== 'room') return
    if (!broadcastSupported()) {
      setError('This browser has no BroadcastChannel; use the Split lab instead.')
      return
    }
    let active: RoomSession | null = null
    let cancelled = false
    const lang = route.lang ?? DEFAULT_LANGUAGE
    RoomSession.open({ room: route.room, peer: self, store, language: lang, seed: SAMPLE_TEXT[lang] })
      .then((s) => {
        if (cancelled) return void s.close()
        active = s
        setSession(s)
        setLanguageState(s.language)
        setError(null)
        void store.list().then(setRecent).catch(() => {})
      })
      .catch((err: unknown) => {
        console.error(err)
        setError(err instanceof Error ? err.message : String(err))
      })
    const flush = () => void active?.flush()
    addEventListener('pagehide', flush)
    return () => {
      cancelled = true
      removeEventListener('pagehide', flush)
      setSession(null)
      void active?.close()
    }
  }, [route.mode, route.room, route.lang, self, store])

  const go = useCallback((next: Route) => {
    setRoute(next)
    writeRoute(next)
  }, [])

  const setMode = (mode: Mode) => {
    if (mode === route.mode) return
    if (mode === 'lab') go({ mode: 'lab', room: 'lab', lang: language === DEFAULT_LANGUAGE ? null : language })
    else go({ mode: 'room', room: lastRoom.current, lang: null })
  }

  const setLanguage = (lang: LanguageId) => {
    setLanguageState(lang)
    session?.setLanguage(lang)
    if (route.mode === 'lab') writeRoute({ ...route, lang: lang === DEFAULT_LANGUAGE ? null : lang }, true)
  }

  const forgetRoom = async () => {
    if (!session) return
    await session.forget()
    location.reload()
  }

  const shareUrl = `${location.origin}${location.pathname}${formatHash({ ...route, lang: null })}`

  return (
    <div className="flex h-full flex-col bg-ink text-fg">
      <TopBar
        mode={route.mode}
        onMode={setMode}
        language={language}
        onLanguage={setLanguage}
        shareUrl={shareUrl}
        roomSlot={<RoomSwitcher room={route.room} recent={recent} onSwitch={(room) => go({ mode: 'room', room, lang: null })} />}
        avatars={route.mode === 'room' && session ? <RoomAvatars session={session} /> : null}
      />
      <main className="flex min-h-0 flex-1 flex-col">
        {route.mode === 'lab' ? (
          <LabView language={language} />
        ) : error ? (
          <Notice>{error}</Notice>
        ) : session ? (
          <RoomView key={session.room} session={session} language={language} onForget={forgetRoom} />
        ) : (
          <Notice muted>Opening room {route.room}…</Notice>
        )}
      </main>
    </div>
  )
}

function RoomAvatars({ session }: { session: RoomSession }) {
  const peers = usePeers(session.replica.site)
  const typing = useTyping(session.replica.site)
  return <PeerAvatars peers={[{ info: session.replica.peer, typing, self: true }, ...peers.map((p) => ({ info: p.info, typing: p.typing }))]} />
}

function Notice({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <p className={`max-w-md text-center text-[13px] ${muted ? 'text-muted' : 'text-warn'}`} role={muted ? undefined : 'alert'}>
        {children}
      </p>
    </div>
  )
}

function storedRoom(): string {
  try {
    return sessionStorage.getItem('chorus:last-room') ?? 'lobby'
  } catch {
    return 'lobby'
  }
}

/**
 * Every tab is its own peer: a random name and colour that survive a reload
 * of *that* tab (sessionStorage is per tab), plus a fresh random site id on
 * every page load. A new site id per load is deliberate — reusing one after a
 * reload could replay sequence numbers the room has already seen if the last
 * debounced snapshot did not make it to disk.
 */
function tabIdentity(): PeerInfo {
  const site = randomSiteId()
  try {
    const raw = sessionStorage.getItem('chorus:identity')
    if (raw) {
      const p = JSON.parse(raw) as { name?: unknown; color?: unknown }
      if (typeof p.name === 'string' && typeof p.color === 'string') return { site, name: p.name, color: p.color }
    }
    const fresh = { name: randomName(), color: randomColor() }
    sessionStorage.setItem('chorus:identity', JSON.stringify(fresh))
    return { site, ...fresh }
  } catch {
    return { site, name: randomName(), color: randomColor() }
  }
}
