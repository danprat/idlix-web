// Detail — padanan DetailScreen.kt (film) & SeriesScreen.kt (serial + daftar episode).
// Saat halaman dibuka, resolve stream di-prewarm di server (padanan prewarmStream).

import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { SkeletonHero } from '../components/feedback'
import { IconArrowLeft, IconPlay, IconStar } from '../components/icons'
import { apiFetch, getSettings } from '../lib/settings'
import {
  fullBackdrop,
  fullPoster,
  fullProfile,
  fullStill,
  formattedRating,
  type EpisodeResponse,
  type MovieDetail,
  type Season,
  type SeriesDetail,
  type WatchSearchParams,
} from '../lib/types'
import { getEpisodeFn, getMovieDetailFn, getSeriesDetailFn, type ClientSettings } from '../server/queries'

type DetailData =
  | { kind: 'movie'; detail: MovieDetail }
  | { kind: 'series'; detail: SeriesDetail }

export const Route = createFileRoute('/detail/$type/$slug')({
  validateSearch: (s: Record<string, unknown>): { season?: number } => ({
    season: typeof s.season === 'number' ? s.season : undefined,
  }),
  loader: async ({ params }): Promise<DetailData> => {
    const settings: ClientSettings = getSettings()
    if (params.type === 'series') {
      const detail = await getSeriesDetailFn({ data: { slug: params.slug, settings } })
      return { kind: 'series', detail }
    }
    const detail = await getMovieDetailFn({ data: { slug: params.slug, settings } })
    return { kind: 'movie', detail }
  },
  pendingComponent: () => <SkeletonHero />,
  component: DetailScene,
})

function usePrewarm(contentType: string, contentId: string, title: string) {
  useEffect(() => {
    if (!contentId) return
    apiFetch('/api/watch/resolve', {
      method: 'POST',
      body: JSON.stringify({ contentType, contentId, contentTitle: title }),
    }).catch(() => {
      // prewarm bersifat best-effort
    })
  }, [contentType, contentId, title])
}

function Meta({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-white/25 px-2 py-0.5 text-[11px] font-semibold">
      {children}
    </span>
  )
}

function DetailScene() {
  const { kind, detail } = Route.useLoaderData()
  const router = useRouter()

  usePrewarm(kind === 'movie' ? 'movie' : 'tv_series', detail.id, detail.title)

  const backdrop = fullBackdrop(detail)
  const poster = fullPoster(detail)
  const year = kind === 'movie' ? String(detail.releaseDate ?? '').slice(0, 4) : String((detail as SeriesDetail).firstAirDate ?? '').slice(0, 4)

  const watchSearch: WatchSearchParams = {
    title: detail.title,
    poster,
    backdrop,
    slug: detail.slug,
    season: kind === 'series' ? ((detail as SeriesDetail).defaultSeason?.seasonNumber ?? 1) : 0,
    episode: kind === 'series' ? ((detail as SeriesDetail).defaultSeason?.episodes?.[0]?.episodeNumber ?? 1) : 0,
  }

  return (
    <div className="animate-fade-in pb-16">
      <section className="relative mb-6 min-h-[50vh]">
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
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-ink to-transparent" />

        {/* Tombol kembali on-page (ramah remote/TV) */}
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) router.history.back()
            else void router.navigate({ to: '/' })
          }}
          aria-label="Kembali"
          className="absolute top-4 left-4 z-10 grid size-10 place-items-center rounded-full bg-black/50 transition hover:bg-black/70 sm:top-6 sm:left-6"
        >
          <IconArrowLeft className="size-5" />
        </button>

        <div className="relative flex min-h-[50vh] items-end gap-6 px-6 pt-16 pb-8 sm:px-10">
          {poster && (
            <img
              src={poster}
              alt={detail.title}
              className="hidden w-40 rounded-lg shadow-2xl ring-1 ring-white/10 sm:block"
            />
          )}
          <div className="max-w-2xl">
            <h1 className="mb-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{detail.title}</h1>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-white/85">
              <span className="flex items-center gap-1 font-semibold">
                <IconStar className="size-4 text-gold" />
                {formattedRating(detail.voteAverage)}
              </span>
              {year && <span>{year}</span>}
              {kind === 'movie' && detail.quality && <Meta>{detail.quality}</Meta>}
              {detail.country && <Meta>{detail.country}</Meta>}
              {kind === 'movie' && detail.runtime ? <Meta>{detail.runtime} menit</Meta> : null}
              {kind === 'series' && <Meta>{(detail as SeriesDetail).numberOfSeasons} season</Meta>}
              {detail.genres.slice(0, 3).map((g) => (
                <span key={g.id} className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px]">
                  {g.name}
                </span>
              ))}
            </div>
            {detail.tagline && <p className="mb-2 text-sm text-muted italic">“{detail.tagline}”</p>}
            <p className="mb-6 max-w-xl text-sm leading-relaxed text-white/80">{detail.overview}</p>

            {kind === 'movie' ? (
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to="/watch/$type/$id"
                  params={{ type: 'movie', id: detail.id }}
                  search={watchSearch}
                  className="inline-flex items-center gap-2 rounded bg-white px-7 py-2.5 text-sm font-bold text-black transition hover:bg-white/85"
                >
                  <IconPlay className="size-4" /> Putar Sekarang
                </Link>
                {detail.trailerUrl && (
                  <a
                    href={detail.trailerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded bg-white/15 px-5 py-2.5 text-sm font-bold transition hover:bg-white/25"
                  >
                    ▶ Trailer
                  </a>
                )}
              </div>
            ) : (
              <SeriesPlayLink detail={detail as SeriesDetail} watchSearch={watchSearch} />
            )}
          </div>
        </div>
      </section>

      {detail.cast.length > 0 && (
        <section className="px-6 sm:px-10">
          <h2 className="mb-3 text-base font-bold">Pemeran</h2>
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
            {detail.cast.slice(0, 15).map((c) => (
              <div key={c.id} className="w-24 shrink-0 text-center">
                {c.profilePath ? (
                  <img
                    src={fullProfile(c.profilePath)}
                    alt={c.name}
                    loading="lazy"
                    className="mb-2 aspect-square w-full rounded-full object-cover ring-1 ring-white/10"
                  />
                ) : (
                  <div className="mb-2 grid aspect-square w-full place-items-center rounded-full bg-card-2 text-xl">
                    👤
                  </div>
                )}
                <p className="line-clamp-2 text-xs font-medium">{c.name}</p>
                {c.character && <p className="line-clamp-1 text-[10px] text-muted">{c.character}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {kind === 'series' && (
        <EpisodeList series={detail as SeriesDetail} watchSearch={watchSearch} />
      )}
    </div>
  )
}

function SeriesPlayLink({
  detail,
  watchSearch,
}: {
  detail: SeriesDetail
  watchSearch: WatchSearchParams
}) {
  const firstEp = detail.defaultSeason?.episodes?.[0]
  if (!firstEp) return null
  return (
    <Link
      to="/watch/$type/$id"
      params={{ type: 'episode', id: firstEp.id }}
      search={{ ...watchSearch, title: `${detail.title} - ${firstEp.name}` }}
      className="inline-flex items-center gap-2 rounded bg-white px-7 py-2.5 text-sm font-bold text-black transition hover:bg-white/85"
    >
      <IconPlay className="size-4" /> Putar Sekarang
    </Link>
  )
}

function EpisodeList({
  series,
  watchSearch,
}: {
  series: SeriesDetail
  watchSearch: WatchSearchParams
}) {
  const { season } = Route.useSearch()
  const navigate = Route.useNavigate()

  const seasons: Season[] =
    series.seasons.length > 0
      ? series.seasons
      : series.defaultSeason
        ? [
            {
              ...series.defaultSeason,
              episodeCount: series.defaultSeason.episodes.length,
              airDate: null,
              overview: null,
              posterPath: null,
            },
          ]
        : []

  const activeSeason =
    season ??
    (series.defaultSeason?.seasonNumber != null
      ? series.defaultSeason.seasonNumber
      : (seasons[0]?.seasonNumber ?? 1))

  const [episodes, setEpisodes] = useState(series.defaultSeason?.episodes ?? [])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (series.defaultSeason && series.defaultSeason.seasonNumber === activeSeason) {
      setEpisodes(series.defaultSeason.episodes)
      return
    }
    let cancelled = false
    setLoading(true)
    getEpisodeFn({ data: { slug: series.slug, season: activeSeason, episode: 1 } })
      .then((res: EpisodeResponse) => {
        if (!cancelled) setEpisodes(res.season?.episodes ?? [])
      })
      .catch(() => {
        if (!cancelled) setEpisodes([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [series.slug, series.defaultSeason, activeSeason])

  return (
    <section className="mt-10 px-6 sm:px-10">
      <h2 className="mb-3 text-base font-bold">Episode</h2>

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
        {seasons.map((s) => (
          <button
            key={s.seasonNumber}
            type="button"
            onClick={() => navigate({ search: { season: s.seasonNumber } })}
            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition ${
              s.seasonNumber === activeSeason
                ? 'bg-white text-black'
                : 'bg-white/10 text-white/75 hover:bg-white/20'
            }`}
          >
            Season {s.seasonNumber}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-hidden py-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-video w-64 shrink-0 animate-pulse rounded-lg bg-card-2" />
          ))}
        </div>
      ) : episodes.length === 0 ? (
        <p className="py-8 text-sm text-muted">Tidak ada episode untuk season ini.</p>
      ) : (
        <div className="divide-y divide-white/5">
          {episodes.map((ep) => (
            <Link
              key={ep.id}
              to="/watch/$type/$id"
              params={{ type: 'episode', id: ep.id }}
              search={{
                ...watchSearch,
                title: `${series.title} - ${ep.name}`,
                season: activeSeason,
                episode: ep.episodeNumber,
              }}
              className="group flex items-start gap-4 rounded-lg px-2 py-4 transition hover:bg-white/5"
            >
              <span className="w-8 shrink-0 pt-6 text-center text-lg font-extrabold text-white/40 group-hover:text-white">
                {ep.episodeNumber}
              </span>
              <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded bg-card-2">
                {ep.stillPath ? (
                  <img src={fullStill(ep.stillPath)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center text-muted/40">🎬</div>
                )}
                <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                  <IconPlay className="size-6" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold">{ep.name}</p>
                  {ep.runtime ? <span className="shrink-0 text-xs text-muted">{ep.runtime}m</span> : null}
                </div>
                {ep.overview && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{ep.overview}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
