// Skeleton loading & empty state ber-illustrasi SVG (menggantikan emoji).

import type { ReactNode } from 'react'

export function SkeletonCard() {
  return (
    <div className="w-36 shrink-0">
      <div className="aspect-[2/3] w-full animate-pulse rounded-lg bg-card-2" />
      <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-card-2" />
      <div className="mt-1.5 h-2.5 w-1/2 animate-pulse rounded bg-card-2" />
    </div>
  )
}

export function SkeletonLane() {
  return (
    <section className="py-3">
      <div className="mb-3 px-6">
        <div className="h-5 w-40 animate-pulse rounded bg-card-2" />
      </div>
      <div className="flex gap-3 overflow-hidden px-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </section>
  )
}

export function SkeletonHero() {
  return (
    <div className="min-h-[62vh] w-full animate-pulse bg-gradient-to-b from-card-2 to-ink" />
  )
}

// ---- Empty states dengan ilustrasi garis sederhana ----

type ArtKind = 'signal' | 'popcorn' | 'ghost' | 'error' | 'search'

function Art({ kind }: { kind: ArtKind }) {
  const common = {
    width: 88,
    height: 88,
    viewBox: '0 0 88 88',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'text-muted/60',
    'aria-hidden': true,
  }
  switch (kind) {
    case 'signal':
      return (
        <svg {...common}>
          <circle cx="44" cy="44" r="5" fill="currentColor" stroke="none" />
          <path d="M32 32a17 17 0 0 1 24 0M26 26a26 26 0 0 1 36 0M20 20a34 34 0 0 1 48 0" opacity="0.9" />
          <path d="M36 56 24 72M52 56l12 16" opacity="0.5" />
        </svg>
      )
    case 'popcorn':
      return (
        <svg {...common}>
          <path d="M30 38h28l-4 34H34z" />
          <path d="M30 38c-4-2-8-6-6-10s7-2 8 2M58 38c4-2 8-6 6-10s-7-2-8 2M44 38c-6-3-6-10-1-12" opacity="0.7" />
          <path d="M34 50l3 16M44 50l0 16M54 50l-3 16" opacity="0.5" />
        </svg>
      )
    case 'ghost':
      return (
        <svg {...common}>
          <path d="M28 70V40a16 16 0 0 1 32 0v30l-5.3-4-5.4 4-5.3-4-5.3 4-5.4-4z" />
          <circle cx="38" cy="40" r="2" fill="currentColor" stroke="none" />
          <circle cx="50" cy="40" r="2" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'error':
      return (
        <svg {...common}>
          <circle cx="44" cy="44" r="30" />
          <path d="M35 53c3-8 15-8 18 0" />
          <path d="M35 36h.01M53 36h.01" strokeWidth={3} />
        </svg>
      )
    case 'search':
      return (
        <svg {...common}>
          <circle cx="38" cy="38" r="16" />
          <path d="m50 50 14 14" />
          <path d="M32 38a6 6 0 0 1 6-6" opacity="0.6" />
        </svg>
      )
  }
}

export function EmptyState({
  kind,
  title,
  message,
  children,
}: {
  kind: ArtKind
  title: string
  message?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <Art kind={kind} />
      <h2 className="mt-2 text-lg font-bold text-white">{title}</h2>
      {message && <p className="max-w-md text-sm leading-relaxed text-muted">{message}</p>}
      {children && <div className="mt-3 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  )
}
