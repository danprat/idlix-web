// Port resolveStreamInternal dari IdlixRepository.kt ke sisi server
// (Cloudflare Worker) agar browser terbebas dari CORS + bot-check upstream.

import type { ClaimResponse, PlayInfoResponse, ResolvedPlayback, SubtitleTrack } from '../lib/types'
import { cacheGet, cacheSet, sleep, upstreamFetch, upstreamJson, type UpstreamContext } from './upstream'
import { fetchIndonesianSubtitle } from './subdl'
import { signedProxyUrl } from './hls'

const PLAYBACK_CACHE_TTL = 60 * 60 * 1000 // 60 menit, sama seperti CACHE_TTL_MS Kotlin

export interface ResolveParams {
  contentType: string
  contentId: string
  contentTitle: string
}

export async function hlsProxyUrl(url: string): Promise<string> {
  return signedProxyUrl('hls', url)
}

export async function subtitleProxyUrl(url: string): Promise<string> {
  return signedProxyUrl('subtitle', url)
}

/** Ekstrak device-id pemilik gateToken untuk Cookie did=... (paritas PlayerViewModel Kotlin). */
export function extractDidCookie(gateToken: string): string | null {
  try {
    const rawP0 = gateToken.split('.')[0]
    const normalized = rawP0.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const decoded = atob(padded)
    const m = /"owner":"d:([^"]+)"/.exec(decoded)
    return m?.[1] ? `did=${m[1]}` : null
  } catch {
    return null
  }
}

async function getEpisodePlayInfo(ctx: UpstreamContext, targetId: string) {
  return upstreamJson<PlayInfoResponse>(ctx, `api/watch/play-info/episode/${targetId}`)
}

async function claimSession(ctx: UpstreamContext, gateToken: string): Promise<ClaimResponse | null> {
  const cookie = extractDidCookie(gateToken)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers.Cookie = cookie

  const res = await upstreamJson<ClaimResponse>(ctx, 'api/watch/session/claim', {
    method: 'POST',
    headers,
    body: JSON.stringify({ gateToken }),
  }).catch(() => null)

  if (res && res.kind === 'pentos' && res.claim) return res
  return null
}

interface RedeemResult {
  code: string
  url: string
  expiresAt: number
  mode: string
  ttlSeconds: number
  subtitles: Array<{ lang: string; label: string; path: string }>
  videoId: string
}

async function redeemPlay(
  ctx: UpstreamContext,
  claim: string,
  redeemUrl: string,
): Promise<RedeemResult | null> {
  const url = redeemUrl || 'https://e2e.majorplay.net/api/play'
  try {
    const res = await upstreamFetch(ctx, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim, mode: 'browser' }),
    })
    if (!res.ok) return null
    return (await res.json()) as RedeemResult
  } catch {
    return null
  }
}

async function wrapSubtitles(
  subs: RedeemResult['subtitles'],
  masterUrl: string,
): Promise<SubtitleTrack[]> {
  const base = new URL(masterUrl)
  const out: SubtitleTrack[] = []
  for (const s of subs) {
    if (!s.path) continue
    try {
      const abs = new URL(s.path, base)
      out.push({
        lang: s.lang || 'id',
        label: s.label || s.lang,
        url: await subtitleProxyUrl(abs.href),
      })
    } catch {
      // skip path tidak valid
    }
  }
  return out
}

/** Resolve penuh satu tembakan (untuk prewarm & fallback). Menunggu countdown di server. */
export async function resolveStreamFull(
  ctx: UpstreamContext,
  params: ResolveParams,
): Promise<ResolvedPlayback> {
  const cacheKey = `playback:${params.contentType}:${params.contentId}`
  const cached = await cacheGet<ResolvedPlayback>(cacheKey)
  if (cached && cached.hlsMasterUrl) return cached

  let targetType = params.contentType
  let targetId = params.contentId

  // Jika diberi ID serial (bukan episode), ambil episode 1 season 1.
  if (params.contentType === 'tv_series') {
    const series = await upstreamJson<any>(ctx, `api/series/${params.contentId}`).catch(() => null)
    const firstEp = series?.defaultSeason?.episodes?.[0]
    if (firstEp?.id) {
      targetType = 'episode'
      targetId = firstEp.id
    } else {
      const season1 = series?.seasons?.[0]
      if (season1) {
        const ep = await upstreamJson<any>(
          ctx,
          `api/series/${params.contentId}/season/${season1.seasonNumber}/episode/1`,
        ).catch(() => null)
        if (ep?.episode?.id) {
          targetType = 'episode'
          targetId = ep.episode.id
        }
      }
    }
    if (targetType === 'tv_series') {
      throw new Error('Tidak ada episode yang tersedia untuk serial ini.')
    }
  }

  // Jalur cepat: resolver satu-tembakan upstream (jika tersedia).
  try {
    const fast = await upstreamJson<any>(
      ctx,
      `api/playback/resolve?contentType=${targetType}&contentId=${encodeURIComponent(targetId)}&contentTitle=${encodeURIComponent(params.contentTitle)}`,
    )
    if (fast?.hlsMasterUrl) {
      const resolved: ResolvedPlayback = {
        title: fast.title || params.contentTitle,
        hlsMasterUrl: await hlsProxyUrl(fast.hlsMasterUrl),
        subtitles: await wrapSubtitles(fast.subtitles ?? [], fast.hlsMasterUrl),
        durationSec: fast.durationSec ?? 0,
        videoId: fast.videoId ?? '',
      }
      await cacheSet(cacheKey, resolved, PLAYBACK_CACHE_TTL)
      return resolved
    }
  } catch {
    // fallback ke alur granular
  }

  // Langkah 1: play-info (gateToken + unlockAt)
  const playInfo =
    targetType === 'episode'
      ? await getEpisodePlayInfo(ctx, targetId)
      : await upstreamJson<PlayInfoResponse>(ctx, `api/watch/play-info/movie/${targetId}`)

  if (!playInfo?.gateToken) throw new Error('Gagal memperoleh token pemutaran')

  // Langkah 2: tunggu countdown tersinkron server (maks 20 detik)
  const diffMs =
    playInfo.serverNow > 0 && playInfo.unlockAt > playInfo.serverNow
      ? playInfo.unlockAt - playInfo.serverNow
      : 15_000
  if (diffMs > 1000) await sleep(Math.min(diffMs, 20_000))

  // Langkah 3: klaim sesi dengan polling (15x600ms, paritas Kotlin)
  let claimRes: ClaimResponse | null = null
  for (let attempt = 0; attempt < 15; attempt++) {
    claimRes = await claimSession(ctx, playInfo.gateToken)
    if (claimRes) break
    await sleep(600)
  }
  if (!claimRes) throw new Error('Gagal mengklaim sesi pemutaran. Silakan coba lagi.')

  // Langkah 4: redeem master playlist HLS dari CDN majorplay
  const redeem = await redeemPlay(ctx, claimRes.claim, claimRes.redeemUrl)
  if (!redeem?.url) throw new Error('Gagal mengambil master playlist HLS.')

  let subtitles = await wrapSubtitles(redeem.subtitles ?? [], redeem.url)
  const hasIndoSub = subtitles.some((s) => s.lang === 'id')

  // Fallback SubDL bila tidak ada subtitle Indonesia
  if (!hasIndoSub && params.contentTitle) {
    try {
      const subdlSub = await fetchIndonesianSubtitle(ctx, {
        title: params.contentTitle,
        type: targetType === 'episode' ? 'tv' : 'movie',
      })
      if (subdlSub) subtitles = [subdlSub, ...subtitles]
    } catch {
      // subtitle fallback opsional
    }
  }

  const resolved: ResolvedPlayback = {
    title: claimRes.title || params.contentTitle,
    hlsMasterUrl: await hlsProxyUrl(redeem.url),
    subtitles,
    durationSec: claimRes.durationSec ?? 0,
    videoId: claimRes.videoId ?? redeem.videoId ?? '',
  }
  await cacheSet(cacheKey, resolved, PLAYBACK_CACHE_TTL)
  return resolved
}

/** Step granular untuk UX countdown di client. */
export async function getPlayInfo(ctx: UpstreamContext, kind: 'movie' | 'episode', id: string) {
  return kind === 'episode'
    ? getEpisodePlayInfo(ctx, id)
    : upstreamJson<PlayInfoResponse>(ctx, `api/watch/play-info/movie/${id}`)
}

export { claimSession, redeemPlay, wrapSubtitles }
