// Proxy HLS dengan penulisan-ulang playlist — padanan web dari logika
// "pelestarian token CDN (?t=...)" di aplikasi Android TV (IdlixRepository).
//
// Keamanan: karena CDN segmen IDLIX berotasi di puluhan domain acak,
// akses divalidasi lewat **signature HMAC** pada query proxy (?k=…). Hanya URL
// yang ditulis-ulang oleh proxy ini sendiri yang memiliki signature valid —
// domain baru otomatis lolos tanpa menjadikan Worker open-proxy.
// Allowlist statis/env tetap berlaku sebagai fallback untuk URL lama.

import { upstreamFetch, type UpstreamContext } from './upstream'

const PROXY_SECRET =
  process.env.HLS_PROXY_SECRET || 'idlix-hls-proxy-v1-do-not-expose'

// Suffix host fallback (URL lama sebelum era signature, dan host infra tetap).
const DEFAULT_ALLOWED_SUFFIXES = ['majorplay.net', 'idlixku.com', 'subdl.com']

const te = new TextEncoder()

async function hmacHex(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    te.encode(PROXY_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(payload))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24)
}

export async function signUrl(rawUrl: string): Promise<string> {
  return hmacHex(rawUrl)
}

/** Proxy URL + signature untuk URL absolut manapun (playlist/segmen/subtitle). */
export async function signedProxyUrl(kind: 'hls' | 'subtitle', rawUrl: string): Promise<string> {
  const sig = await signUrl(rawUrl)
  const base = kind === 'hls' ? '/api/hls' : '/api/subtitle'
  return `${base}?url=${encodeURIComponent(rawUrl)}&k=${sig}`
}

export async function verifySignature(rawUrl: string, sig: string | null): Promise<boolean> {
  if (!sig) return false
  const expected = await signUrl(rawUrl)
  if (expected.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  }
  return diff === 0
}

export function hostAllowed(ctx: UpstreamContext, rawUrl: string): boolean {
  let host: string
  try {
    host = new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return false
  }

  const envList = process.env.IDLIX_PROXY_ALLOWED_HOSTS
  const suffixes = envList
    ? envList.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ALLOWED_SUFFIXES

  // Host upstream saat ini selalu diizinkan.
  try {
    if (host === new URL(ctx.baseUrl).hostname.toLowerCase()) return true
  } catch {
    // ignore
  }
  return suffixes.some((sfx) => host === sfx || host.endsWith(`.${sfx}`))
}

/** Izinkan bila signature valid ATAU host termasuk suffix tepercaya. */
export async function proxyTargetAllowed(
  ctx: UpstreamContext,
  rawUrl: string,
  sig: string | null,
): Promise<boolean> {
  return (await verifySignature(rawUrl, sig)) || hostAllowed(ctx, rawUrl)
}

/**
 * Tulis ulang semua URI dalam playlist agar tetap lewat proxy (ber-signature) dan
 * mewarisi query `t` (token otorisasi CDN) dari playlist induk.
 */
export async function rewritePlaylist(text: string, playlistUrl: string): Promise<string> {
  const parent = new URL(playlistUrl)
  const parentToken = parent.searchParams.get('t')

  const toProxied = async (rawUri: string): Promise<string> => {
    try {
      const child = new URL(rawUri, parent)
      if (parentToken && !child.searchParams.has('t')) {
        child.searchParams.set('t', parentToken)
      }
      return signedProxyUrl('hls', child.href)
    } catch {
      return rawUri
    }
  }

  const lines = await Promise.all(
    text.split('\n').map(async (line) => {
      const trimmed = line.trim()
      if (!trimmed) return line

      if (trimmed.startsWith('#')) {
        // Rewrite URI="..." di dalam tag (#EXT-X-MAP, #EXT-X-KEY, #EXT-X-MEDIA, dll.)
        const matches = [...line.matchAll(/URI="([^"]+)"/g)]
        if (matches.length === 0) return line
        let out = line
        for (const m of matches) {
          const replacement = await toProxied(m[1])
          out = out.replace(`URI="${m[1]}"`, `URI="${replacement}"`)
        }
        return out
      }
      return toProxied(trimmed)
    }),
  )

  return lines.join('\n')
}

function looksLikePlaylist(contentType: string, url: string, bodyText: string): boolean {
  if (/m3u8?(\?|$)/i.test(url)) return true
  if (/mpegurl|text\/plain/i.test(contentType)) {
    return bodyText.trimStart().startsWith('#EXTM3U')
  }
  return false
}

export async function proxyHls(
  ctx: UpstreamContext,
  rawUrl: string,
  rangeHeader: string | null,
): Promise<Response> {
  const upstreamHeaders: Record<string, string> = { Accept: '*/*' }
  if (rangeHeader) upstreamHeaders.Range = rangeHeader

  const res = await upstreamFetch(ctx, rawUrl, { headers: upstreamHeaders })

  if (!res.ok && res.status !== 206) {
    return new Response(`Upstream ${res.status}`, { status: res.status })
  }

  const contentType = res.headers.get('content-type') ?? ''

  // Coba deteksi playlist dari teks (aman: playlist selalu kecil, < 2 MB).
  const contentLength = Number(res.headers.get('content-length') ?? '0')
  if (contentType.startsWith('text/') || /mpegurl/i.test(contentType) || /\.m3u8/i.test(rawUrl) || contentLength === 0) {
    const text = await res.text()
    if (looksLikePlaylist(contentType, rawUrl, text)) {
      const rewritten = await rewritePlaylist(text, rawUrl)
      return new Response(rewritten, {
        status: 200,
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'cache-control': 'no-store',
        },
      })
    }
    return new Response(text, {
      status: res.status,
      headers: {
        'content-type': contentType || 'text/plain',
        'cache-control': res.status === 206 ? 'no-store' : 'public, max-age=3600',
      },
    })
  }

  // Segmen biner: stream langsung + teruskan header Range/Content-Range.
  const headers = new Headers()
  headers.set('content-type', contentType || 'application/octet-stream')
  headers.set('cache-control', 'public, max-age=3600')
  for (const h of ['content-range', 'accept-ranges', 'content-length']) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  return new Response(res.body, { status: res.status, headers })
}
