// Relay egress untuk Deno Deploy (gratis, always-on) — alternatif tanpa laptop.
//
// Deploy 2 menit:
//   1. Install Deno:  brew install deno   (atau https://deno.com)
//   2. Uji lokal:     deno run --allow-net relay/deno.mjs
//   3. Deploy:        deployctl deploy --project=idlix-relay relay/deno.mjs
//        (atau lewat https://dash.deno.com → New Playground → tempel file ini)
//   4. Set di Worker produksi:
//        npx wrangler secret put IDLIX_RELAY_URL
//        → https://idlix-relay.deno.dev/?key=<KEY>&url=<UPSTREAM>
//
// CATATAN PENTING: fingerprint TLS Deno (rustls) belum teruji terhadap WAF
// situs sumber. Uji dulu: curl "https://<url>?key=..&url=https://z2.idlixku.com/api/movies?limit=1"
// → 200 berarti lolos; 403 challenge berarti Deno ikut ditantang dan opsi ini
// gugur (pakai opsi perangkat rumah: workerd + IP rumah sudah terbukti lolos).

const KEY = Deno.env.get("RELAY_KEY") ?? "ganti-key-ini"
const ALLOW = (Deno.env.get("RELAY_ALLOW") ?? "idlixku.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

Deno.serve(async (req: Request) => {
  const u = new URL(req.url)

  if (u.pathname === "/favicon.ico") return new Response(null, { status: 204 })
  if (u.pathname !== "/") {
    return new Response("not found", { status: 404 })
  }
  if (u.searchParams.get("key") !== KEY) {
    return new Response("not found", { status: 404 })
  }

  const target = u.searchParams.get("url")
  if (!target) return new Response("ok — idlix relay (deno)\n")

  let targetUrl: URL
  try {
    targetUrl = new URL(target)
  } catch {
    return new Response("invalid url", { status: 400 })
  }
  if (!/^https?:$/.test(targetUrl.protocol)) {
    return new Response("bad protocol", { status: 400 })
  }
  const h = targetUrl.hostname.toLowerCase()
  const allowed = ALLOW.some((sfx) => h === sfx || h.endsWith(`.${sfx}`))
  if (!allowed) return new Response(`host not allowed: ${h}`, { status: 403 })

  const headers = new Headers()
  const ct = req.headers.get("content-type")
  if (ct) headers.set("content-type", ct)
  const cookie = req.headers.get("cookie")
  if (cookie) headers.set("cookie", cookie)
  headers.set("accept", "application/json, text/plain, */*")
  headers.set("user-agent", BROWSER_UA)
  headers.set("referer", `${targetUrl.protocol}//${targetUrl.host}/`)
  headers.set("origin", targetUrl.origin)

  const hasBody = !["GET", "HEAD"].includes(req.method)
  const body = hasBody ? await req.arrayBuffer() : undefined

  try {
    const upstream = await fetch(targetUrl, { method: req.method, headers, body })
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
    })
  } catch (e) {
    return new Response(`relay error: ${(e as Error).message}`, { status: 502 })
  }
})
