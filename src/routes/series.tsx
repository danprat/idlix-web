// Halaman Serial TV — padanan SeriesScreen.kt + filter kategori/genre via URL
// (/series?genre=drama&sort=popularity). Mode "Semua" = swimlane,
// mode genre = grid + sorting + Muat Lagi.

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { MediaCard, Swimlane } from '../components/media'
import { SkeletonLane, EmptyState } from '../components/feedback'
import { CardGrid, CategoryFilter, GenreHeader, LoadMoreButton } from '../components/browse'
import { getCatalogList, getGenresFn, type ClientSettings, type GenreItem } from '../server/queries'
import { getSettings } from '../lib/settings'
import type { SeriesItem } from '../lib/types'

const SECTIONS: Array<{ key: string; title: string; sort?: string; genre?: string }> = [
  { key: 'popular', title: 'Serial Terpopuler', sort: 'popularity' },
  { key: 'latest', title: 'Terbaru Ditambahkan', sort: 'createdAt' },
  { key: 'drama', title: 'Drama', genre: 'drama' },
  { key: 'action', title: 'Aksi & Petualangan', genre: 'action' },
  { key: 'comedy', title: 'Komedi', genre: 'comedy' },
]

const PAGE_SIZE = 24

export const Route = createFileRoute('/series')({
  validateSearch: (s: Record<string, unknown>): { genre?: string; sort?: string } => ({
    genre: typeof s.genre === 'string' && s.genre ? s.genre : undefined,
    sort: typeof s.sort === 'string' && s.sort ? s.sort : undefined,
  }),
  loaderDeps: ({ search }) => ({ genre: search.genre, sort: search.sort }),
  loader: async ({ deps }) => {
    const settings: ClientSettings = getSettings()

    // Genres + list dijalankan paralel (satu gelombang, bukan dua berurutan)
    const [genresRes, genreListRes] = await Promise.all([
      getGenresFn({ data: { settings } }),
      deps.genre
        ? getCatalogList({
            data: {
              kind: 'series',
              limit: PAGE_SIZE,
              genre: deps.genre,
              sort: deps.sort ?? 'popularity',
              settings,
            },
          }).catch(() => null)
        : null,
    ])
    const genres = genresRes.data

    if (deps.genre) {
      return {
        mode: 'genre' as const,
        genres,
        items: (genreListRes?.data as SeriesItem[]) ?? [],
        genreTitle: genres.find((g) => g.slug === deps.genre)?.name ?? deps.genre,
      }
    }

    const entries = await Promise.all(
      SECTIONS.map(async (s) => {
        const res = await getCatalogList({
          data: { kind: 'series', limit: 20, sort: s.sort, genre: s.genre, settings },
        }).catch(() => null)
        return [s.key, (res?.data as SeriesItem[]) ?? []] as const
      }),
    )
    return {
      mode: 'browse' as const,
      genres,
      sections: Object.fromEntries(entries) as Record<string, SeriesItem[]>,
    }
  },
  pendingComponent: () => (
    <div className="py-6">
      <h1 className="mb-4 px-4 text-2xl font-extrabold tracking-tight">Serial TV</h1>
      <SkeletonLane />
      <SkeletonLane />
    </div>
  ),
  component: SeriesScene,
})

function SeriesScene() {
  const data = Route.useLoaderData()
  const { genre, sort } = Route.useSearch()
  const navigate = useNavigate({ from: '/series' })

  const [items, setItems] = useState<SeriesItem[]>(data.mode === 'genre' ? data.items : [])
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    setItems(data.mode === 'genre' ? data.items : [])
  }, [data])

  const selectGenre = (slug?: string) =>
    navigate({ search: slug ? { genre: slug, sort: sort ?? 'popularity' } : {} })

  const selectSort = (s: string) =>
    navigate({ search: { genre: genre!, sort: s } })

  const loadMore = async () => {
    if (!genre) return
    setLoadingMore(true)
    try {
      const settings: ClientSettings = getSettings()
      const page = Math.floor(items.length / PAGE_SIZE) + 1
      const res = await getCatalogList({
        data: { kind: 'series', page, limit: PAGE_SIZE, genre, sort: sort ?? 'popularity', settings },
      })
      const fresh = ((res?.data as SeriesItem[]) ?? []).filter(
        (s) => !items.some((x) => x.id === s.id),
      )
      setItems((prev) => [...prev, ...fresh])
    } catch {
      // abaikan
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="animate-fade-in pb-16">
      {/* Header + filter */}
      <div className="px-4 pt-6 sm:px-6">
        {data.mode === 'genre' && genre ? (
          <GenreHeader
            title={data.genreTitle}
            countLabel={`${items.length} serial`}
            onBack={() => selectGenre(undefined)}
            activeSort={sort ?? 'popularity'}
            onSelectSort={selectSort}
          />
        ) : (
          <h1 className="mb-4 text-2xl font-extrabold tracking-tight">Serial TV</h1>
        )}
        <div className="mt-4">
          <CategoryFilter
            genres={data.genres as GenreItem[]}
            activeGenre={genre}
            onSelectGenre={selectGenre}
          />
        </div>
      </div>

      {data.mode === 'genre' ? (
        <div className="mt-6 px-4 sm:px-6">
          {items.length === 0 ? (
            <EmptyState
              kind="ghost"
              title="Tidak ada serial"
              message={`Belum ada serial untuk kategori ${data.genreTitle}. Coba kategori lain.`}
            />
          ) : (
            <>
              <CardGrid>
                {items.map((item) => (
                  <div key={item.id} className="[&>div]:w-full">
                    <MediaCard item={{ ...item, releaseDate: item.firstAirDate }} />
                  </div>
                ))}
              </CardGrid>
              {items.length >= PAGE_SIZE && items.length % PAGE_SIZE === 0 && (
                <LoadMoreButton onClick={loadMore} loading={loadingMore} />
              )}
            </>
          )}
        </div>
      ) : (
        <div className="mt-2">
          {SECTIONS.map((s) =>
            data.sections[s.key]?.length ? (
              <Swimlane key={s.key} title={s.title}>
                {data.sections[s.key].map((item) => (
                  <MediaCard key={item.id} item={{ ...item, releaseDate: item.firstAirDate }} />
                ))}
              </Swimlane>
            ) : null,
          )}
        </div>
      )}
    </div>
  )
}
