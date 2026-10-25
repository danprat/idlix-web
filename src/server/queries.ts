// Server functions (createServerFn) — dipanggil dari loader route agar
// SSR berjalan tanpa fetch URL relatif. Semua menerima override Pengaturan
// (URL upstream & API key SubDL) sebagai data.

import { createServerFn } from '@tanstack/react-start'
import { cacheGet, cacheSet, makeUpstreamContext, upstreamJson } from './upstream'
import { searchSubdl } from './subdl'
import type {
  EpisodeResponse,
  ListResponse,
  MovieDetail,
  MovieItem,
  SearchResponse,
  SeriesDetail,
  SeriesItem,
} from '../lib/types'

export interface ClientSettings {
  upstreamUrl?: string
  subdlApiKey?: string
}

function ctxOf(settings?: ClientSettings) {
  return makeUpstreamContext({
    upstreamUrl: settings?.upstreamUrl || undefined,
    subdlApiKey: settings?.subdlApiKey || undefined,
  })
}

const passthrough = <T,>() => (d: T) => d

/**
 * Cache TTL per-isolate untuk server fn — tanpa ini setiap navigasi selalu
 * menghantam upstream (~300ms per panggilan). Angka cache: hit ~20ms.
 */
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key)
  if (hit !== undefined) return hit
  const value = await fn()
  await cacheSet(key, value, ttlMs)
  return value
}

const TTL_LIST = 2 * 60_000 // katalog list: 2 menit
const TTL_DETAIL = 10 * 60_000 // detail film/serial/episode: 10 menit
const TTL_GENRES = 6 * 60 * 60_000 // daftar genre: 6 jam
const TTL_SEARCH = 5 * 60_000 // hasil pencarian: 5 menit

export const getCatalogList = createServerFn({ method: 'GET' })
  .validator(
    passthrough<{
      kind: 'movies' | 'series'
      page?: number
      limit?: number
      sort?: string
      genre?: string
      settings?: ClientSettings
    }>(),
  )
  .handler(({ data }) => {
    const ctx = ctxOf(data.settings)
    const qs = new URLSearchParams(
      Object.entries({
        page: data.page?.toString(),
        limit: data.limit?.toString(),
        sort: data.sort,
        genre: data.genre,
      }).filter(([, v]) => v != null) as [string, string][],
    )
    return cached(`ql:${ctx.baseUrl}:${data.kind}:${qs}`, TTL_LIST, () =>
      upstreamJson<ListResponse<MovieItem | SeriesItem>>(ctx, `api/${data.kind}?${qs}`).catch(
        () => ({ data: [] }) satisfies ListResponse<MovieItem | SeriesItem>,
      ),
    )
  })

export const getMovieDetailFn = createServerFn({ method: 'GET' })
  .validator(passthrough<{ slug: string; settings?: ClientSettings }>())
  .handler(({ data }) => {
    const ctx = ctxOf(data.settings)
    return cached(`qd:${ctx.baseUrl}:movie:${data.slug}`, TTL_DETAIL, () =>
      upstreamJson<MovieDetail>(ctx, `api/movies/${data.slug}`),
    )
  })

export const getSeriesDetailFn = createServerFn({ method: 'GET' })
  .validator(passthrough<{ slug: string; settings?: ClientSettings }>())
  .handler(({ data }) => {
    const ctx = ctxOf(data.settings)
    return cached(`qd:${ctx.baseUrl}:series:${data.slug}`, TTL_DETAIL, () =>
      upstreamJson<SeriesDetail>(ctx, `api/series/${data.slug}`),
    )
  })

export const getEpisodeFn = createServerFn({ method: 'GET' })
  .validator(passthrough<{ slug: string; season: number; episode: number; settings?: ClientSettings }>())
  .handler(({ data }) => {
    const ctx = ctxOf(data.settings)
    return cached(
      `qe:${ctx.baseUrl}:${data.slug}:${data.season}:${data.episode}`,
      TTL_DETAIL,
      () =>
        upstreamJson<EpisodeResponse>(
          ctx,
          `api/series/${data.slug}/season/${data.season}/episode/${data.episode}`,
        ),
    )
  })

export const searchCatalogFn = createServerFn({ method: 'GET' })
  .validator(passthrough<{ q: string; page?: number; settings?: ClientSettings }>())
  .handler(({ data }) => {
    const q = data.q.trim()
    if (!q) return Promise.resolve({ results: [], total: 0 } satisfies SearchResponse)
    const ctx = ctxOf(data.settings)
    const pageParam = data.page && data.page > 1 ? `&page=${data.page}` : ''
    return cached(`qs:${ctx.baseUrl}:${q}:${pageParam}`, TTL_SEARCH, () =>
      upstreamJson<SearchResponse>(ctx, `api/search?q=${encodeURIComponent(q)}${pageParam}`).catch(
        () => ({ results: [], total: 0 }) satisfies SearchResponse,
      ),
    )
  })

export const getConfigDefaultsFn = createServerFn({ method: 'GET' }).handler(() => ({
  defaultUpstream: makeUpstreamContext().baseUrl,
}))

export interface GenreItem {
  id: string
  name: string
  slug: string
}

export const getGenresFn = createServerFn({ method: 'GET' })
  .validator(passthrough<{ settings?: ClientSettings }>())
  .handler(({ data }) => {
    const ctx = ctxOf(data.settings)
    return cached(`qg:${ctx.baseUrl}`, TTL_GENRES, () =>
      upstreamJson<{ data: GenreItem[] }>(ctx, 'api/genres').catch(() => ({ data: [] as GenreItem[] })),
    )
  })

export const testUpstreamFn = createServerFn({ method: 'POST' })
  .validator(passthrough<{ base?: string; settings?: ClientSettings }>())
  .handler(async ({ data }) => {
    const { upstreamFetch, normalizeBase } = await import('./upstream')
    const ctx = ctxOf(data.settings)
    const base = data.base ? normalizeBase(data.base) : ctx.baseUrl
    try {
      const res = await upstreamFetch({ ...ctx, baseUrl: base }, 'api/movies?limit=1')
      let message = res.ok ? 'Koneksi berhasil' : `Upstream merespons ${res.status}`
      if (!res.ok && res.status === 403) {
        message += ' (kemungkinan dilindungi bot-check Cloudflare)'
      }
      return { ok: res.ok, status: res.status, message }
    } catch (e) {
      return { ok: false, status: 0, message: (e as Error).message }
    }
  })

export const testSubdlFn = createServerFn({ method: 'POST' })
  .validator(passthrough<{ settings?: ClientSettings }>())
  .handler(async ({ data }) => {
    const subs = await searchSubdl(ctxOf(data.settings), {
      title: 'interstellar',
      type: 'movie',
    })
    return {
      ok: subs.length > 0,
      message:
        subs.length > 0
          ? `${subs.length} subtitle ditemukan`
          : 'Tidak ada hasil (cek API key)',
    }
  })
