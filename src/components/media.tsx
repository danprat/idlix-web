// Komponen kartu & baris media (padanan TvMovieCard / TvSwimlaneRow / TvHeroBillboard
// / TvContinueWatchingCard dari Jetpack Compose TV).

import { Link } from '@tanstack/react-router'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { findProgressBySlug } from '../lib/history'
import {
  fullBackdrop,
  fullPoster,
  formattedRating,
  progressFraction,
  remainingMinutes,
  resolvedHistoryThumbnail,
  type MovieItem,
  type WatchHistoryItem,
  type WatchSearchParams,
} from '../lib/types'
import {
  IconChevronLeft,
  IconChevronRight,
  IconInfo,
  IconPlay,
  IconStar,
  IconTrash,
} from './icons'

export type CardItem = Pick<
  MovieItem,
  | 'id'
  | 'title'
  | 'slug'
  | 'posterPath'
  | 'backdropPath'
  | 'quality'
  | 'voteAverage'
  | 'releaseDate'
  | 'contentType'
> & { contentType: string; overview?: string | null }

export function Spinner({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted">
      <div className="size-10 animate-spin rounded-full border-2 border-white/15 border-t-brand" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

export function MediaCard({ item, wide = false }: { item: CardItem; wide?: boolean }) {
  const poster = fullPoster(item)
  const progress = findProgressBySlug(item.slug, item.contentType)

  return (
    <MediaCardWithPreview item={item} wide={wide} progress={progress}>
      {(hoverProps) => (
        <Link
          to="/detail/$type/$slug"
          params={{ type: item.contentType === 'movie' ? 'movie' : 'series', slug: item.slug }}
          className="group block"
          {...hoverProps}
        >
          <div className="relative overflow-hidden rounded-lg bg-card ring-1 ring-white/5 transition-all duration-200 group-hover:scale-[1.04] group-hover:ring-2 group-hover:ring-white/40 group-focus-visible:ring-2 group-focus-visible:ring-white">
            {poster ? (
              <img
                src={poster}
                alt={item.title}
                loading="lazy"
                className="aspect-[2/3] w-full object-cover"
              />
            ) : (
              <div className="grid aspect-[2/3] w-full place-items-center text-3xl text-muted/40">
                🎬
              </div>
            )}

            {item.quality && (
              <span className="absolute top-2 right-2 rounded bg-brand px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase">
                {item.quality}
              </span>
            )}

            {/* Progress tontonan (paritas kartu Lanjutkan Menonton) */}
            {progress > 0 && (
              <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/60">
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>

          <p className="mt-2 line-clamp-2 text-[13px] leading-snug font-medium text-white/85 group-hover:text-white">
            {item.title}
          </p>
          {item.releaseDate && (
            <p className="text-[11px] text-muted">{String(item.releaseDate).slice(0, 4)}</p>
          )}
        </Link>
      )}
    </MediaCardWithPreview>
  )
}

/**
 * Wrapper hover-preview ala Netflix: setelah 500ms kursor diam di kartu,
 * panel lebar muncul di bawahnya (dirender via portal agar tidak terpotong
 * scroll container). Tidak aktif di perangkat sentuh.
 */
function MediaCardWithPreview({
  item,
  wide,
  progress,
  children,
}: {
  item: CardItem
  wide: boolean
  progress: number
  children: (hoverProps: {
    onMouseEnter: () => void
    onMouseLeave: () => void
    onFocus: () => void
    onBlur: () => void
  }) => ReactNode
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const enterTimer = useRef<number | null>(null)
  const inPanel = useRef(false)
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null)

  const open = useCallback(() => {
    const el = cardRef.current
    if (!el) return
    if (window.matchMedia('(hover: none)').matches) return // perangkat sentuh
    const r = el.getBoundingClientRect()
    const W = 288
    setRect({
      left: Math.min(Math.max(8, r.left + r.width / 2 - W / 2), window.innerWidth - W - 8),
      top: r.bottom + 8,
    })
  }, [])

  const close = useCallback(() => {
    window.setTimeout(() => {
      if (!inPanel.current) setRect(null)
    }, 80)
  }, [])

  useEffect(() => {
    if (!rect) return
    const dismiss = () => setRect(null)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('wheel', dismiss, { passive: true })
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('wheel', dismiss)
    }
  }, [rect])

  const hoverProps = {
    onMouseEnter: () => {
      enterTimer.current = window.setTimeout(open, 500)
    },
    onMouseLeave: () => {
      if (enterTimer.current) window.clearTimeout(enterTimer.current)
      close()
    },
    onFocus: () => {
      if (enterTimer.current) window.clearTimeout(enterTimer.current)
    },
    onBlur: close,
  }

  const backdrop = fullBackdrop(item)
  const watchSearch: WatchSearchParams = {
    title: item.title,
    poster: fullPoster(item),
    backdrop,
    slug: item.slug,
    season: 0,
    episode: 0,
  }
  const detailType = item.contentType === 'movie' ? 'movie' : 'series'

  return (
    <div ref={cardRef} className={`relative shrink-0 ${wide ? 'w-64' : 'w-36'}`}>
      {children(hoverProps)}

      {rect &&
        createPortal(
          <div
            data-modal-open=""
            onMouseEnter={() => {
              inPanel.current = true
            }}
            onMouseLeave={() => {
              inPanel.current = false
              setRect(null)
            }}
            className="fixed z-50 w-72 animate-fade-in overflow-hidden rounded-xl border border-white/10 bg-card shadow-2xl"
            style={{ left: rect.left, top: rect.top }}
          >
            <div className="relative aspect-video w-full bg-card-2">
              {backdrop ? (
                <img src={backdrop} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-muted/40">🎬</div>
              )}
              {progress > 0 && (
                <div className="absolute inset-x-3 bottom-2 h-1 overflow-hidden rounded-full bg-black/60">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              )}
            </div>
            <div className="p-3">
              <div className="flex items-center gap-2">
                <Link
                  to="/watch/$type/$id"
                  params={{ type: detailType === 'movie' ? 'movie' : 'tv_series', id: item.id }}
                  search={watchSearch}
                  aria-label={`Putar ${item.title}`}
                  className="grid size-9 place-items-center rounded-full bg-white text-black transition hover:bg-white/85"
                >
                  <IconPlay className="size-4" />
                </Link>
                <Link
                  to="/detail/$type/$slug"
                  params={{ type: detailType, slug: item.slug }}
                  aria-label={`Detail ${item.title}`}
                  className="grid size-9 place-items-center rounded-full border border-white/25 text-white transition hover:border-white/60"
                >
                  <IconInfo className="size-4" />
                </Link>
                <span className="ml-auto flex items-center gap-1 text-xs font-semibold">
                  <IconStar className="size-3.5 text-gold" />
                  {formattedRating(item.voteAverage)}
                  {item.releaseDate && (
                    <span className="ml-1 text-muted">{String(item.releaseDate).slice(0, 4)}</span>
                  )}
                </span>
              </div>
              <p className="mt-2 line-clamp-1 text-sm font-bold">{item.title}</p>
              {item.overview && (
                <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted">{item.overview}</p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

export function Swimlane({ title, children }: { title: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null)
  const scrollBy = (dir: number) =>
    scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.85, behavior: 'smooth' })

  return (
    <section className="group/lane relative py-3">
      <div className="mb-2 flex items-center justify-between px-6">
        <h2 className="text-base font-bold tracking-tight sm:text-lg">{title}</h2>
        <div className="hidden gap-1 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label={`Gulir ${title} ke kiri`}
            className="grid size-8 place-items-center rounded-full bg-card-2/70 text-white/80 transition hover:bg-card-2 hover:text-white"
          >
            <IconChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label={`Gulir ${title} ke kanan`}
            className="grid size-8 place-items-center rounded-full bg-card-2/70 text-white/80 transition hover:bg-card-2 hover:text-white"
          >
            <IconChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className="no-scrollbar flex gap-3 overflow-x-auto scroll-smooth px-6 pb-2"
      >
        {children}
      </div>
    </section>
  )
}

export function HeroBillboard({
  item,
  hrefPlay,
}: {
  item: CardItem & { overview?: string | null }
  hrefPlay: {
    to: '/watch/$type/$id'
    params: { type: string; id: string }
    search: WatchSearchParams
  }
}) {
  const backdrop = fullBackdrop(item)
  const year = item.releaseDate ? String(item.releaseDate).slice(0, 4) : ''

  return (
    <section className="animate-fade-in relative mb-4 min-h-[62vh] w-full overflow-hidden">
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          fetchPriority="high"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-card-2 to-ink" />
      )}

      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink to-transparent" />

      <div className="relative flex min-h-[62vh] max-w-2xl flex-col justify-end gap-4 px-6 pt-24 pb-10 sm:px-10">
        <h1 className="text-3xl leading-tight font-extrabold tracking-tight drop-shadow-lg sm:text-5xl">
          {item.title}
        </h1>

        <div className="flex flex-wrap items-center gap-2 text-sm text-white/85">
          {item.quality && (
            <span className="rounded border border-white/30 px-1.5 py-0.5 text-[11px] font-bold">
              {item.quality}
            </span>
          )}
          <span className="flex items-center gap-1 font-semibold">
            <IconStar className="size-4 text-gold" />
            {formattedRating(item.voteAverage)}
          </span>
          {year && <span>{year}</span>}
        </div>

        {item.overview && (
          <p className="line-clamp-3 max-w-xl text-sm leading-relaxed text-white/80 sm:text-base">
            {item.overview}
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-3">
          <Link
            {...hrefPlay}
            className="inline-flex items-center gap-2 rounded bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-white/85"
          >
            <IconPlay className="size-4" /> Putar
          </Link>
          <Link
            to="/detail/$type/$slug"
            params={{
              type: item.contentType === 'movie' ? 'movie' : 'series',
              slug: item.slug,
            }}
            className="inline-flex items-center gap-2 rounded bg-white/20 px-6 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/30"
          >
            <IconInfo className="size-4" /> Info Lengkap
          </Link>
        </div>
      </div>
    </section>
  )
}

export function ContinueCard({ item }: { item: WatchHistoryItem }) {
  const thumb = resolvedHistoryThumbnail(item)
  const pct = Math.round(progressFraction(item) * 100)
  const isEpisode = item.contentType === 'episode'

  const playSearch: WatchSearchParams = {
    title: item.title,
    poster: item.posterUrl ?? '',
    backdrop: item.backdropUrl ?? '',
    slug: item.slug ?? '',
    season: isEpisode ? (item.seasonNumber ?? 0) : 0,
    episode: isEpisode ? (item.episodeNumber ?? 0) : 0,
  }

  return (
    <div className="group relative w-72 shrink-0">
      <Link
        to="/watch/$type/$id"
        params={{ type: item.contentType, id: item.contentId }}
        search={playSearch}
        className="block overflow-hidden rounded-lg bg-card ring-1 ring-white/5 transition group-hover:scale-[1.03] group-hover:ring-2 group-hover:ring-white/40"
      >
        <div className="relative aspect-video w-full">
          {thumb ? (
            <img src={thumb} alt={item.title} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-card-2 text-3xl text-muted/40">🎬</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <div className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
            <span className="grid size-12 place-items-center rounded-full bg-brand/90">
              <IconPlay className="size-5 translate-x-0.5" />
            </span>
          </div>

          <div className="absolute inset-x-0 bottom-0 p-3">
            <p className="line-clamp-1 text-sm font-semibold">{item.title}</p>
            {isEpisode && item.episodeTitle && (
              <p className="line-clamp-1 text-xs text-muted">
                S{item.seasonNumber ?? '?'} E{item.episodeNumber ?? '?'} · {item.episodeTitle}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] font-medium text-white/75">
                {remainingMinutes(item) > 0 ? `${remainingMinutes(item)} mnt lagi` : 'Selesai'}
              </span>
            </div>
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          window.dispatchEvent(
            new CustomEvent('idlix:remove-history', { detail: item.contentId }),
          )
        }}
        aria-label={`Hapus ${item.title} dari riwayat`}
        className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/60 text-white/80 opacity-0 transition group-hover:opacity-100 hover:bg-black/80 hover:text-white"
      >
        <IconTrash className="size-4" />
      </button>
    </div>
  )
}
