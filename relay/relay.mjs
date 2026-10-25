// Relay egress untuk IDLIX Web — solusi saat Worker Cloudflare diblokir
// bot-check situs sumber (idlixku menantang IP datacenter Cloudflare).
//
// Relay ini berjalan di mesin dengan egress "bersih" (rumah/VPS) dan
// meneruskan request Worker → idlixku dengan header browser yang benar.
// Video (playlist & segmen CDN) TIDAK lewat relay — CDN terjangkau langsung
// dari Cloudflare, janya API katalog/gate saja yang di-relay.
//
// Jalankan:   node relay/relay.mjs            (PORT=8788 default)
// Worker:     set env IDLIX_RELAY_URL=https://<url-relay-publik>
//
// Endpoint:   GET/POST  /?url=https://z2.idlixku.com/api/...
// Allowlist:  env RELAY_ALLOW (default: idlixku.com) — host di luar daftar ditolak,
//             supaya relay ini bukan open proxy.

import http from 'node:http'

const PORT = Number(process.env.PORT || 8788)
const ALLOW = (process.env.RELAY_ALLOW || 'idlixku.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function hostAllowed(hostname) {
  const h = hostname.toLowerCase()
  return ALLOW.some((sfx) => h === sfx || h.endsWith(`.${sfx}`))
}

const server = http.createServer(async (req, res) => {
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type })
    res.end(body)
  }

  try {
    const u = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)

    if (u.pathname === '/favicon.ico') return send(204, '')
    if (u.pathname === '/' && !u.searchParams.has('url')) {
      return send(200, 'idlix-relay ok\n')
    }
    if (u.pathname !== '/' || req.method === 'OPTIONS') {
      return send(404, 'not found')
    }

    const target = u.searchParams.get('url')
    if (!target) return send(400, 'missing url')

    let targetUrl
    try {
      targetUrl = new URL(target)
    } catch {
      return send(400, 'invalid url')
    }
    if (!/^https?:$/.test(targetUrl.protocol)) return send(400, 'bad protocol')
    if (!hostAllowed(targetUrl.hostname)) {
      return send(403, `host not allowed: ${targetUrl.hostname}`)
    }

    // Header yang diteruskan dari Worker (Cookie did=... untuk klaim sesi,
    // content-type untuk POST); header browser dipasang di sisi relay.
    const headers = new Headers()
    const ct = req.headers['content-type']
    if (ct) headers.set('content-type', ct)
    const cookie = req.headers['cookie']
    if (cookie) headers.set('cookie', cookie)
    headers.set('accept', 'application/json, text/plain, */*')
    headers.set('user-agent', BROWSER_UA)
    headers.set('referer', `${targetUrl.protocol}//${targetUrl.host}/`)
    headers.set('origin', targetUrl.origin)

    const hasBody = !['GET', 'HEAD'].includes(req.method ?? 'GET')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = hasBody && chunks.length ? Buffer.concat(chunks) : undefined

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    })

    const buf = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    })
    res.end(buf)
  } catch (e) {
    send(502, `relay error: ${(e ?? {}).message ?? e}`)
  }
})

server.listen(PORT, () => {
  console.log(`idlix-relay listening on :${PORT} — allow: ${ALLOW.join(', ')}`)
})
