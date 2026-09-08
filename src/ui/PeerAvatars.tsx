import type { CSSProperties } from 'react'
import { initials } from '../session/identity'
import type { PeerInfo } from '../transport/protocol'

export interface AvatarPeer {
  readonly info: PeerInfo
  readonly typing: boolean
  readonly self?: boolean
}

export function Avatar({ info, typing, self, size = 24 }: AvatarPeer & { size?: number }) {
  return (
    <span
      className={'avatar' + (typing ? ' is-typing' : '')}
      style={{ '--peer': info.color, width: size, height: size, fontSize: Math.round(size * 0.42) } as CSSProperties}
      title={`${info.name}${self ? ' (you)' : ''} · site ${info.site}${typing ? ' · typing' : ''}`}
      aria-label={`${info.name}${self ? ' (you)' : ''}${typing ? ', typing' : ''}`}
      role="img"
    >
      {initials(info.name)}
    </span>
  )
}

export function PeerAvatars({ peers, max = 6 }: { peers: readonly AvatarPeer[]; max?: number }) {
  const shown = peers.slice(0, max)
  const overflow = peers.length - shown.length
  return (
    <div className="flex items-center" aria-label={`${peers.length} ${peers.length === 1 ? 'participant' : 'participants'}`}>
      <div className="flex -space-x-1.5">
        {shown.map((p) => (
          <Avatar key={p.info.site} {...p} />
        ))}
      </div>
      {overflow > 0 && <span className="ml-1.5 text-[11px] text-muted">+{overflow}</span>}
    </div>
  )
}
