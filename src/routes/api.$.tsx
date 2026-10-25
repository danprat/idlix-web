// Server routes /api/* — endpoint HTTP runtime (proxy HLS & subtitle, alur nonton,
// SubDL, tes Pengaturan). Endpoint katalog untuk SSR dijalankan lewat
// createServerFn (src/server/queries.ts).

import { createFileRoute } from '@tanstack/react-router'
import {
  cacheGet,
  cacheSet,
  getUpstreamContext,
  jsonError,
  normalizeBase,
  upstreamFetch,
  upstreamJson,
} from '../server/upstream'
import { claimSession, getPlayInfo, hlsProxyUrl, redeemPlay, resolveStreamFull, wrapSubtitles } from '../server/resolver'
import { proxyHls, proxyTargetAllowed } from '../server/hls'
import { downloadSubdlVtt, fetchIndonesianSubtitle, searchSubdl } from '../server/subdl'
import { cacheSelfTest, cacheStatus } from '../server/cache'

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
      POST: async ({ request }) => handlePost(request),
    },
  },
})

async function handleGet(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const q = url.searchParams

  try {
    const ctx = getUpstreamContext(request)

    // ---- Relay egress (untuk deployment Worker yang diblokir WAF upstream) ----
    // Dijalankan di instance dengan egress lolos WAF (mis. `npm run dev` di
    // rumah / workerd), dilindungi key. Lihat relay/README.md.
    if (path === '/api/relay') {
      const relayKey = process.env.IDLIX_RELAY_KEY
      const provided = q.get('key')
      if (!relayKey || provided !== relayKey) return jsonError('Tidak ditemukan', 404)

      const target = q.get('url')
      if (!target) return jsonError('Parameter url wajib', 400)
      let targetHost: string
      try {
        targetHost = new URL(target).hostname.toLowerCase()
      } catch {
        return jsonError('URL tidak valid', 400)
      }
      const baseHost = new URL(ctx.baseUrl).hostname.toLowerCase()
      const allowedSuffix = process.env.IDLIX_RELAY_ALLOW || 'idlixku.com'
      const hostOk =
        targetHost === baseHost ||
        allowedSuffix.split(',').some((s) => targetHost === s || targetHost.endsWith(`.${s}`))
      if (!hostOk) return jsonError('Host tidak diizinkan', 403)

      const fwdHeaders: Record<string, string> = {}
      if (request.headers.get('content-type')) fwdHeaders['content-type'] = request.headers.get('content-type')!
      if (request.headers.get('cookie')) fwdHeaders.cookie = request.headers.get('cookie')!

      const init: RequestInit & { relayBypass?: boolean } = {
        method: request.method,
        headers: fwdHeaders,
        relayBypass: true,
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        init.body = await request.arrayBuffer()
      }

      const upstream = await upstreamFetch(ctx, target, init)
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
      })
    }

    // ---- Konfigurasi & tes koneksi (menu Pengaturan) ----
    if (path === '/api/config') {
      if (q.get('cache') === 'selftest') {
        return Response.json(await cacheSelfTest())
      }
      if (q.get('cache') !== null) {
        return Response.json(await cacheStatus())
      }
      if (q.get('test') !== null) {
        const base = q.get('base') ? normalizeBase(q.get('base')!) : ctx.baseUrl
        try {
          const res = await upstreamFetch({ ...ctx, baseUrl: base }, 'api/movies?limit=1')
          let message = res.ok ? 'Koneksi berhasil' : `Upstream merespons ${res.status}`
          if (!res.ok && res.status === 403) {
            message += ' (kemungkinan dilindungi bot-check Cloudflare)'
          }
          return Response.json({ ok: res.ok, status: res.status, message })
        } catch (e) {
          return Response.json({ ok: false, status: 0, message: (e as Error).message })
        }
      }
      return Response.json({ defaultUpstream: ctx.baseUrl })
    }

    // ---- Proxy katalog (runtime fallback; loader SSR memakai server fn) ----
    if (path === '/api/catalog/movies' || path === '/api/catalog/series') {
      const kind = path.endsWith('/movies') ? 'movies' : 'series'
      const qs = new URLSearchParams()
      for (const k of ['page', 'limit', 'sort', 'genre']) {
        const v = q.get(k)
        if (v) qs.set(k, v)
      }
      const cacheKey = `cat:${ctx.baseUrl}:${kind}:${qs}`
      const cached = await cacheGet<unknown>(cacheKey)
      if (cached) return Response.json(cached)

      const json = await upstreamJson(ctx, `api/${kind}?${qs}`)
      await cacheSet(cacheKey, json, 60_000)
      return Response.json(json)
    }

    let m = /^\/api\/catalog\/movie\/([^/]+)$/.exec(path)
    if (m) return proxyJson(ctx, `api/movies/${m[1]}`)

    m = /^\/api\/catalog\/series\/([^/]+)$/.exec(path)
    if (m) return proxyJson(ctx, `api/series/${m[1]}`)

    m = /^\/api\/catalog\/series\/([^/]+)\/season\/(\d+)\/episode\/(\d+)$/.exec(path)
    if (m) return proxyJson(ctx, `api/series/${m[1]}/season/${m[2]}/episode/${m[3]}`)

    if (path === '/api/catalog/genres') return proxyJson(ctx, 'api/genres')

    if (path === '/api/catalog/search') {
      const query = (q.get('q') ?? '').trim()
      if (!query) return Response.json({ results: [], total: 0 })
      return proxyJson(ctx, `api/search?q=${encodeURIComponent(query)}`)
    }

    // ---- Alur nonton granular: play-info untuk countdown di client ----
    m = /^\/api\/watch\/play-info\/(movie|episode)\/([^/]+)$/.exec(path)
    if (m) {
      const info = await getPlayInfo(ctx, m[1] as 'movie' | 'episode', m[2])
      if (!info?.gateToken) return jsonError('Gagal memperoleh token pemutaran', 502)
      return Response.json(info)
    }

    // ---- Proxy HLS (master/sub playlist + segmen, token ?t= diawetkan) ----
    if (path === '/api/hls') {
      const target = q.get('url')
      if (!target) return jsonError('Parameter url wajib', 400)
      if (!(await proxyTargetAllowed(ctx, target, q.get('k')))) {
        return jsonError('Host tidak diizinkan', 403)
      }
      return proxyHls(ctx, target, request.headers.get('range'))
    }

    // ---- Proxy subtitle internal CDN (SRT otomatis dikonversi ke VTT) ----
    if (path === '/api/subtitle') {
      const target = q.get('url')
      if (!target) return jsonError('Parameter url wajib', 400)
      if (!(await proxyTargetAllowed(ctx, target, q.get('k')))) {
        return jsonError('Host tidak diizinkan', 403)
      }

      const res = await upstreamFetch(ctx, target, { headers: { Accept: '*/*' } })
      if (!res.ok) return jsonError(`Upstream ${res.status}`, res.status)

      const contentType = res.headers.get('content-type') ?? ''
      const text = await res.text()
      const isVtt =
        /\.vtt(\?|$)/i.test(target) ||
        /webvtt/i.test(contentType) ||
        text.trimStart().startsWith('WEBVTT')
      const body = isVtt
        ? text
        : `WEBVTT\n\n${text.replace(/^\uFEFF/, '').replace(/\r+/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
      return new Response(body, {
        headers: {
          'content-type': 'text/vtt; charset=utf-8',
          'cache-control': 'public, max-age=3600',
        },
      })
    }

    // ---- SubDL ----
    if (path === '/api/subdl/search') {
      const subs = await searchSubdl(ctx, {
        title: q.get('title') ?? '',
        type: q.get('type') === 'tv' ? 'tv' : 'movie',
        season: q.get('season') ? Number(q.get('season')) : null,
        episode: q.get('episode') ? Number(q.get('episode')) : null,
      })
      return Response.json({ subtitles: subs })
    }

    if (path === '/api/subdl/subtitle') {
      const target = q.get('url')
      if (!target) return jsonError('Parameter url wajib', 400)
      if (!hostAllowedSubdl(ctx, target)) return jsonError('Host tidak diizinkan', 403)
      const vtt = await downloadSubdlVtt(ctx, target)
      if (!vtt) return jsonError('Gagal mengekstrak subtitle SubDL', 502)
      return new Response(vtt, {
        headers: {
          'content-type': 'text/vtt; charset=utf-8',
          'cache-control': 'public, max-age=3600',
        },
      })
    }

    return jsonError(`Endpoint ${path} tidak dikenal`, 404)
  } catch (e) {
    return jsonError((e as Error).message || 'Kesalahan internal', 502)
  }
}

async function handlePost(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const ctx = getUpstreamContext(request)

  try {
    if (path === '/api/watch/claim') {
      const body = (await request.json()) as { gateToken: string }
      if (!body?.gateToken) return jsonError('gateToken wajib', 400)
      const claim = await claimSession(ctx, body.gateToken)
      // Respon kosong (claim="") berarti "belum siap" — client polling ulang,
      // paritas loop 15x600ms di IdlixRepository.
      return Response.json(claim ?? { kind: '', claim: '' })
    }

    if (path === '/api/watch/redeem') {
      const body = (await request.json()) as {
        claim: string
        redeemUrl?: string
        title?: string
        contentType?: string
      }
      if (!body?.claim) return jsonError('claim wajib', 400)

      const redeem = await redeemPlay(ctx, body.claim, body.redeemUrl ?? '')
      if (!redeem?.url) return jsonError('Gagal mengambil master playlist HLS.', 502)

      let subtitles = await wrapSubtitles(redeem.subtitles ?? [], redeem.url)
      if (!subtitles.some((s) => s.lang === 'id') && body.title) {
        try {
          const sub = await fetchIndonesianSubtitle(ctx, {
            title: body.title,
            type: body.contentType === 'episode' ? 'tv' : 'movie',
          })
          if (sub) subtitles = [sub, ...subtitles]
        } catch {
          // subtitle fallback opsional
        }
      }

      return Response.json({
        title: body.title ?? '',
        hlsMasterUrl: redeem.url, // direct: URL mentah CDN
        hlsMasterProxyUrl: await hlsProxyUrl(redeem.url),
        subtitles,
        durationSec: 0,
        videoId: redeem.videoId ?? '',
      })
    }

    if (path === '/api/watch/resolve') {
      const body = (await request.json()) as {
        contentType: string
        contentId: string
        contentTitle: string
      }
      if (!body?.contentType || !body?.contentId) return jsonError('Parameter tidak lengkap', 400)
      const resolved = await resolveStreamFull(ctx, body)
      return Response.json(resolved)
    }

    return jsonError(`Endpoint ${path} tidak dikenal`, 404)
  } catch (e) {
    return jsonError((e as Error).message || 'Kesalahan internal', 502)
  }
}

async function proxyJson(ctx: ReturnType<typeof getUpstreamContext>, upstreamPath: string): Promise<Response> {
  const cacheKey = `json:${ctx.baseUrl}:${upstreamPath}`
  const cached = await cacheGet<unknown>(cacheKey)
  if (cached) return Response.json(cached)
  const json = await upstreamJson(ctx, upstreamPath)
  await cacheSet(cacheKey, json, 60_000)
  return Response.json(json)
}

/** SubDL berada di domain tetap — cukup validasi suffix, tanpa signature. */
function hostAllowedSubdl(_ctx: ReturnType<typeof getUpstreamContext>, rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return host === 'subdl.com' || host.endsWith('.subdl.com')
  } catch {
    return false
  }
}
