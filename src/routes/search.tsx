// Pencarian — padanan SearchScreen.kt (debounce 400 ms + muat lagi).

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { MediaCard, Spinner } from '../components/media'
import { EmptyState } from '../components/feedback'
import { searchCatalogFn, type ClientSettings } from '../server/queries'
import { getSettings } from '../lib/settings'
import type { SearchResultItem } from '../lib/types'

export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
  }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => {
    if (!deps.q?.trim()) return { results: [] as SearchResultItem[], searched: false }
    const settings: ClientSettings = getSettings()
    const res = await searchCatalogFn({ data: { q: deps.q, settings } })
    return { results: res.results ?? [], searched: true }
  },
  pendingComponent: () => <Spinner label="Mencari…" />,
  component: SearchScene,
})

function SearchScene() {
  const { q } = Route.useSearch()
  const loaderData = Route.useLoaderData()
  const navigate = useNavigate({ from: '/search' })
  const [input, setInput] = useState(q ?? '')
  const [results, setResults] = useState(loaderData.results)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => setResults(loaderData.results), [loaderData])

  // Debounce 400ms → sinkronkan ke URL (memicu loader pencarian)
  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed === (q ?? '')) return
    const t = setTimeout(() => {
      navigate({ search: trimmed ? { q: trimmed } : {}, replace: true })
    }, 400)
    return () => clearTimeout(t)
  }, [input, q, navigate])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const settings: ClientSettings = getSettings()
      const page = Math.floor(results.length / 20) + 1
      const res = await searchCatalogFn({ data: { q: (q ?? '').trim(), page, settings } })
      const fresh = (res.results ?? []).filter((r) => !results.some((x) => x.id === r.id))
      setResults((prev) => [...prev, ...fresh])
    } catch {
      // abaikan
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="animate-fade-in mx-auto max-w-7xl px-6 py-8">
      <h1 className="mb-6 text-2xl font-extrabold tracking-tight">Pencarian</h1>

      <div className="relative mb-8 max-w-2xl">
        <input
          autoFocus
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Cari judul film atau serial TV…"
          className="w-full rounded-full border border-white/15 bg-card px-5 py-3 pr-12 text-sm outline-none placeholder:text-muted focus:border-white/40"
        />
      </div>

      {!loaderData.searched && (
        <EmptyState
          kind="search"
          title="Mulai mencari"
          message="Ketik judul untuk mulai mencari film atau serial."
        />
      )}

      {loaderData.searched && results.length === 0 && (
        <EmptyState
          kind="ghost"
          title="Tidak ada hasil"
          message={`Tidak ditemukan apa pun untuk “${q}”. Coba kata kunci lain.`}
        />
      )}

      {results.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {results.map((r) => (
              <div key={`${r.contentType}-${r.id}`} className="[&>div]:w-full">
                <MediaCard
                  item={{
                    id: r.id,
                    title: r.title,
                    slug: r.slug,
                    posterPath: r.posterPath,
                    quality: r.quality,
                    voteAverage: r.voteAverage,
                    releaseDate: r.releaseDate ?? r.firstAirDate,
                    contentType: r.contentType,
                  }}
                />
              </div>
            ))}
          </div>
          {results.length >= 20 && results.length % 20 === 0 && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-full border border-white/15 px-6 py-2.5 text-sm font-semibold text-muted transition hover:border-white/40 hover:text-white disabled:opacity-50"
              >
                {loadingMore ? 'Memuat…' : 'Muat Lagi'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
