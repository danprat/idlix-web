// Server-side client untuk upstream IDLIX (port ApiClient.kt + IdlixApiService.kt).
// Semua fetch ke upstream memakai header browser + Referer/Origin agar
// diperlakukan seperti pemain web resmi.

export const DEFAULT_UPSTREAM =
  process.env.IDLIX_UPSTREAM_URL || 'https://z2.idlixku.com'

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export function normalizeBase(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

export interface UpstreamContext {
  baseUrl: string
  subdlApiKey: string
}

/** Bangun context dari override eksplisit (server fn) — dipakai saat SSR. */
export function makeUpstreamContext(overrides?: {
  upstreamUrl?: string
  subdlApiKey?: string
}): UpstreamContext {
  let baseUrl = DEFAULT_UPSTREAM
  const override = overrides?.upstreamUrl
  if (override) {
    try {
      const u = new URL(override)
      if (u.protocol === 'http:' || u.protocol === 'https:') baseUrl = u.origin
    } catch {
      // invalid override → pakai default
    }
  }

  const subdlApiKey =
    overrides?.subdlApiKey ||
    process.env.SUBDL_API_KEY ||
    'subdl__VuGBV3ExlH8tW68l4wVEIsk6Mfnaxq1_FiONFN8Yg0'

  return { baseUrl: normalizeBase(baseUrl), subdlApiKey }
}

/** Bangun context dari Request — override runtime via header (endpoint /api/*). */
export function getUpstreamContext(req: Request): UpstreamContext {
  return makeUpstreamContext({
    upstreamUrl: req.headers.get('x-idlix-base') ?? undefined,
    subdlApiKey: req.headers.get('x-subdl-key') ?? undefined,
  })
}

export async function upstreamFetch(
  ctx: UpstreamContext,
  path: string,
  init: RequestInit & { relayBypass?: boolean } = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${ctx.baseUrl}${path.replace(/^\//, '')}`

  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json, text/plain, */*')
  headers.set('User-Agent', BROWSER_UA)
  headers.set('Referer', ctx.baseUrl)
  headers.set('Origin', new URL(ctx.baseUrl).origin)

  // Relay egress (opsional): situs sumber menantang IP datacenter Cloudflare,
  // sementara runtime workerd dengan egress rumah lolos WAF. Bila
  // IDLIX_RELAY_URL diset, request ke HOST UPSTREAM diteruskan lewat relay;
  // CDN video & host lain tetap LANGSUNG dari Worker.
  const relay = process.env.IDLIX_RELAY_URL
  if (relay && !init.relayBypass) {
    try {
      const target = new URL(url)
      const base = new URL(ctx.baseUrl)
      if (target.hostname === base.hostname && /^https?:$/.test(target.protocol)) {
        const sep = relay.includes('?') ? '&' : '?'
        // PENTING: ke relay kirim header MINIMAL saja. Relay memasang header
        // browser yang benar ke upstream. Mengirim Referer/Origin upstream ke
        // host relay justru memicu tantangan bot di proxy depan relay.
        const relayHeaders = new Headers()
        const ct = headers.get('content-type')
        if (ct) relayHeaders.set('content-type', ct)
        const ck = headers.get('cookie')
        if (ck) relayHeaders.set('cookie', ck)
        return fetch(`${relay}${sep}url=${encodeURIComponent(url)}`, {
          ...init,
          headers: relayHeaders,
        })
      }
    } catch {
      // URL tak valid → langsung
    }
  }

  return fetch(url, { ...init, headers, relayBypass: undefined } as RequestInit)
}

export async function upstreamJson<T>(
  ctx: UpstreamContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await upstreamFetch(ctx, path, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `Upstream ${res.status} untuk ${path}${body ? `: ${body.slice(0, 200)}` : ''}`,
    )
  }
  return (await res.json()) as T
}

// ---- Cache TTL bertingkat (memory → Cache API → KV opsional), lihat cache.ts ----

export { cacheGet, cacheSet } from './cache'

export function jsonError(message: string, status = 502) {
  return Response.json({ error: message }, { status })
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
