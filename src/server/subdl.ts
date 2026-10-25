// Port SubdlRepository.kt — pencarian & unduh subtitle dari subdl.com,
// dengan ekstraksi ZIP (fflate) + konversi SRT→VTT agar bisa dipakai <track> browser.

import { unzipSync } from 'fflate'
import type { SubdlSubtitle, SubtitleTrack } from '../lib/types'
import { cacheGet, cacheSet, upstreamFetch, type UpstreamContext } from './upstream'

const SUBDL_API = 'https://api.subdl.com/api/v1/subtitles'

export async function searchSubdl(
  ctx: UpstreamContext,
  opts: {
    title: string
    type: string // 'movie' | 'tv'
    tmdbId?: number | null
    imdbId?: string | null
    season?: number | null
    episode?: number | null
    languages?: string
  },
): Promise<SubdlSubtitle[]> {
  const qs = new URLSearchParams({
    api_key: ctx.subdlApiKey,
    languages: opts.languages ?? 'ID,EN',
  })
  if (opts.tmdbId && opts.tmdbId > 0) qs.set('tmdb_id', String(opts.tmdbId))
  else if (opts.imdbId) qs.set('imdb_id', opts.imdbId)
  else qs.set('film_name', opts.title.replace(/\(\d{4}\)/, '').trim())

  if (opts.type === 'tv' || opts.season != null) {
    qs.set('type', 'tv')
    if (opts.season != null) qs.set('season_number', String(opts.season))
    if (opts.episode != null) qs.set('episode_number', String(opts.episode))
  } else {
    qs.set('type', 'movie')
  }

  try {
    const res = await fetch(`${SUBDL_API}?${qs}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Web; Idlix)' },
    })
    if (!res.ok) return []
    const json = (await res.json()) as { status: boolean; subtitles: SubdlSubtitle[] }
    return json.status ? (json.subtitles ?? []) : []
  } catch {
    return []
  }
}

export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, '')
    .replace(/\r+/g, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return `WEBVTT\n\n${body}`
}

function isIndonesian(sub: SubdlSubtitle): boolean {
  return (
    sub.language?.toLowerCase() === 'id' || sub.lang?.toLowerCase() === 'indonesian'
  )
}

/** Unduh ZIP SubDL, ekstrak berkas .srt/.vtt pertama, kembalikan teks VTT. */
export async function downloadSubdlVtt(
  ctx: UpstreamContext,
  zipPath: string,
): Promise<string | null> {
  const zipUrl = zipPath.startsWith('http') ? zipPath : `https://dl.subdl.com${zipPath}`
  const cacheKey = `subdl-vtt:${zipUrl}`
  const cached = await cacheGet<string>(cacheKey)
  if (cached) return cached

  const res = await upstreamFetch(ctx, zipUrl, { headers: { Accept: '*/*' } })
  if (!res.ok) return null

  try {
    const buf = new Uint8Array(await res.arrayBuffer())
    const files = unzipSync(buf)
    for (const [name, data] of Object.entries(files)) {
      const lower = name.toLowerCase()
      if (lower.endsWith('.vtt')) {
        const text = new TextDecoder().decode(data)
        await cacheSet(cacheKey, text, 6 * 3600_000)
        return text
      }
      if (lower.endsWith('.srt')) {
        const text = srtToVtt(new TextDecoder().decode(data))
        await cacheSet(cacheKey, text, 6 * 3600_000)
        return text
      }
    }
    return null
  } catch {
    return null
  }
}

/** Paritas SubdlRepository.fetchIndonesianSubtitle — track subtitle siap pakai. */
export async function fetchIndonesianSubtitle(
  ctx: UpstreamContext,
  opts: { title: string; type: string; tmdbId?: number | null; imdbId?: string | null; season?: number | null; episode?: number | null },
): Promise<SubtitleTrack | null> {
  const subs = await searchSubdl(ctx, { ...opts, languages: 'ID' })
  const chosen = subs.find(isIndonesian) ?? subs[0]
  if (!chosen) return null

  const zipUrl = chosen.url.startsWith('http') ? chosen.url : `https://dl.subdl.com${chosen.url}`
  const langCode = isIndonesian(chosen) ? 'id' : (chosen.language?.toLowerCase() ?? 'en')
  const releaseTag = chosen.author ? ` (${chosen.author})` : ''
  const label = isIndonesian(chosen) ? `Indonesian [SubDL]${releaseTag}` : `English [SubDL]${releaseTag}`

  return {
    lang: langCode,
    label,
    url: `/api/subdl/subtitle?url=${encodeURIComponent(zipUrl)}`,
  }
}
