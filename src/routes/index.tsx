// Beranda — padanan HomeScreen.kt: hero billboard (berotasi) + Lanjutkan
// Menonton + swimlane. Rotasi hormat prefers-reduced-motion & jeda saat hover.

import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ContinueCard, HeroBillboard, MediaCard, Swimlane, type CardItem } from '../components/media'
import { EmptyState, SkeletonHero, SkeletonLane } from '../components/feedback'
import { getCatalogList, getMovieDetailFn, type ClientSettings } from '../server/queries'
import { getSettings } from '../lib/settings'
import { useUnfinishedHistory } from '../lib/useHistory'
import {
  fullBackdrop,
  fullPoster,
  type MovieItem,
  type SeriesItem,
} from '../lib/types'

type HomeHero = CardItem & { overview?: string | null }

interface HomeData {
  heroes: HomeHero[]
  trending: MovieItem[]
  popular: MovieItem[]
  series: SeriesItem[]
  action: MovieItem[]
}

export const Route = createFileRoute('/')({
  loader: async (): Promise<HomeData> => {
    const settings: ClientSettings = getSettings()
    const [trendingRes, popularRes, seriesRes, actionRes] = await Promise.all([
      getCatalogList({ data: { kind: 'movies', limit: 20, sort: 'popularity', settings } }).catch(
        () => null,
      ),
      getCatalogList({ data: { kind: 'movies', limit: 20, settings } }).catch(() => null),
      getCatalogList({ data: { kind: 'series', limit: 20, sort: 'popularity', settings } }).catch(
        () => null,
      ),
      getCatalogList({ data: { kind: 'movies', limit: 20, genre: 'action', settings } }).catch(
        () => null,
      ),
    ])

    const trending = (trendingRes?.data as MovieItem[]) ?? []
    const popular = (popularRes?.data as MovieItem[]) ?? []
    const series = (seriesRes?.data as SeriesItem[]) ?? []
    const action = (actionRes?.data as MovieItem[]) ?? []

    // Hero: detail penuh untuk 5 teratas agar punya overview & tagline.
    const heroCandidates = (trending.length > 0 ? trending : popular).slice(0, 5)
    const heroes = await Promise.all(
      heroCandidates.map(async (m) => {
        const detail = await getMovieDetailFn({ data: { slug: m.slug, settings } }).catch(() => null)
        return (detail ? { ...detail, overview: detail.overview ?? null } : m) as HomeHero
      }),
    )

    return { heroes, trending, popular, series, action }
  },
  pendingComponent: HomeSkeleton,
  component: HomeScene,
})

function HomeSkeleton() {
  return (
    <div>
      <SkeletonHero />
      <div className="relative z-10 -mt-6 pb-16">
        <SkeletonLane />
        <SkeletonLane />
      </div>
    </div>
  )
}

function HomeScene() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [unfinished] = useUnfinishedHistory()

  // Rotasi hero tiap 8 detik (nonaktif bila reduced-motion / sedang hover)
  const [heroIdx, setHeroIdx] = useState(0)
  const [heroPaused, setHeroPaused] = useState(false)

  useEffect(() => {
    setHeroIdx(0)
  }, [data.heroes])

  useEffect(() => {
    if (data.heroes.length < 2 || heroPaused) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = window.setInterval(() => {
      setHeroIdx((i) => (i + 1) % data.heroes.length)
    }, 8000)
    return () => window.clearInterval(t)
  }, [data.heroes, heroPaused])

  const empty =
    data.heroes.length === 0 &&
    data.trending.length === 0 &&
    data.popular.length === 0 &&
    data.series.length === 0

  if (empty) {
    return (
      <EmptyState
        kind="signal"
        title="Gagal memuat katalog"
        message="Sumber streaming tidak merespons. Kemungkinan domain upstream sedang berganti atau dilindungi bot-check. Coba lagi, atau perbarui URL sumber di Pengaturan."
      >
        <button
          type="button"
          onClick={() => router.invalidate()}
          className="rounded bg-white px-5 py-2 text-sm font-bold text-black hover:bg-white/85"
        >
          Coba Lagi
        </button>
        <Link
          to="/settings"
          className="rounded bg-white/15 px-5 py-2 text-sm font-bold hover:bg-white/25"
        >
          Buka Pengaturan
        </Link>
      </EmptyState>
    )
  }

  const hero = data.heroes[heroIdx] ?? data.heroes[0]
  const heroBackdrop = fullBackdrop(hero)
  const heroPoster = fullPoster(hero)

  return (
    <div className="animate-fade-in">
      {data.heroes.length > 1 && (
        <div className="absolute top-[58vh] left-6 z-20 flex gap-1.5 sm:left-10">
          {data.heroes.map((h, i) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setHeroIdx(i)}
              aria-label={`Tampilkan ${h.title} di billboard`}
              aria-current={i === heroIdx}
              className={`h-1.5 rounded-full transition-all ${
                i === heroIdx ? 'w-6 bg-white' : 'w-3 bg-white/40 hover:bg-white/70'
              }`}
            />
          ))}
        </div>
      )}

      {/* Jeda rotasi hanya saat kursor di atas billboard, bukan seluruh halaman */}
      <div onMouseEnter={() => setHeroPaused(true)} onMouseLeave={() => setHeroPaused(false)}>
        <HeroBillboard
          key={hero.id}
          item={hero}
          hrefPlay={{
            to: '/watch/$type/$id',
            params: { type: 'movie', id: hero.id },
            search: {
              title: hero.title,
              poster: heroPoster,
              backdrop: heroBackdrop,
              slug: hero.slug,
              season: 0,
              episode: 0,
            },
          }}
        />
      </div>

      <div className="relative z-10 -mt-6 pb-16">
        {unfinished.length > 0 && (
          <Swimlane title="Lanjutkan Menonton">
            {unfinished.map((it) => (
              <ContinueCard key={it.contentId} item={it} />
            ))}
          </Swimlane>
        )}

        {data.trending.length > 0 && (
          <Swimlane title="Sedang Tren">
            {data.trending.map((m) => (
              <MediaCard key={m.id} item={m} />
            ))}
          </Swimlane>
        )}

        {data.popular.length > 0 && (
          <Swimlane title="Film Populer">
            {data.popular.map((m) => (
              <MediaCard key={m.id} item={m} />
            ))}
          </Swimlane>
        )}

        {data.series.length > 0 && (
          <Swimlane title="Serial TV Populer">
            {data.series.map((s) => (
              <MediaCard key={s.id} item={{ ...s, releaseDate: s.firstAirDate }} />
            ))}
          </Swimlane>
        )}

        {data.action.length > 0 && (
          <Swimlane title="Aksi & Petualangan">
            {data.action.map((m) => (
              <MediaCard key={m.id} item={m} />
            ))}
          </Swimlane>
        )}
      </div>
    </div>
  )
}
