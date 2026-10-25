// Cache bertingkat untuk data katalog (di seluruh server fn & route API):
//
//   1. Memory (per-isolate, ±0 ms)  — tier pertama, mati saat isolate di-recycle
//   2. Cache API / caches.default (per-colo edge, ±1 ms) — bertahan lintas isolate
//      & cold start di datacenter yang sama; tanpa konfigurasi & tanpa biaya
//   3. KV (opsional, global lintas colo, ±10–60 ms) — aktif otomatis bila
//      binding IDLIX_KV tersedia di wrangler.jsonc
//
// Untuk pengguna yang terkonsentrasi di satu negara (Indonesia), tier 1+2 sudah
// menangkap hampir semua manfaat; KV hanya menambah konsistensi lintas-region.

type KVLike = {
  get(key: string): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
}

interface MemoryEntry {
  value: unknown
  expires: number
}

const memory = new Map<string, MemoryEntry>()
const MEMORY_MAX = 300

const CACHE_ORIGIN = 'https://internal-cache.idlix'
const KV_PREFIX = 'cat:'

function memGet<T>(key: string): T | undefined {
  const hit = memory.get(key)
  if (!hit) return undefined
  if (hit.expires <= Date.now()) {
    memory.delete(key)
    return undefined
  }
  return hit.value as T
}

function memSet(key: string, value: unknown, ttlMs: number) {
  memory.set(key, { value, expires: Date.now() + ttlMs })
  if (memory.size > MEMORY_MAX) {
    const now = Date.now()
    for (const [k, v] of memory) if (v.expires < now) memory.delete(k)
    while (memory.size > MEMORY_MAX) {
      const first = memory.keys().next().value
      if (first === undefined) break
      memory.delete(first)
    }
  }
}

/** Binding KV bisa diekspos lewat beberapa jalur tergantung runtime — cek semua. */
async function getKV(): Promise<KVLike | null> {
  const g = globalThis as Record<string, unknown>
  const candidates = [g.__IDLIX_KV__, (g.env as Record<string, unknown> | undefined)?.IDLIX_KV]
  for (const c of candidates) if (c) return c as KVLike
  return null
}

function cacheApi(): Cache | undefined {
  try {
    if (typeof caches === 'undefined') return undefined
    // `caches.default` hanya ada di runtime Workers/workerd (bukan di DOM lib TS)
    const c = (caches as unknown as { default?: Cache }).default
    return c
  } catch {
    return undefined
  }
}

function cacheUrl(key: string): URL {
  return new URL(`${CACHE_ORIGIN}/${encodeURIComponent(key)}`)
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const memHit = memGet<T>(key)
  if (memHit !== undefined) return memHit

  // Tier 2: Cache API (per-colo)
  const c = cacheApi()
  if (c) {
    try {
      const res = await c.match(cacheUrl(key))
      if (res) {
        const value = (await res.json()) as T
        // Promosikan ke memory agar akses berikutnya ±0 ms
        const ttl = Number(res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 60) * 1000
        memSet(key, value, ttl)
        return value
      }
    } catch {
      // Cache API tak tersedia/diizinkan — lanjut ke KV
    }
  }

  // Tier 3: KV (opsional, global)
  const kv = await getKV()
  if (kv) {
    try {
      const raw = await kv.get(`${KV_PREFIX}${key}`)
      if (raw !== null) {
        const value = JSON.parse(raw) as T
        memSet(key, value, 60_000)
        return value
      }
    } catch {
      // KV error (mis. binding salah tipe) — anggap miss
    }
  }

  return undefined
}

export async function cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  memSet(key, value, ttlMs)

  const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000))
  const body = JSON.stringify(value)

  const c = cacheApi()
  if (c) {
    try {
      await c.put(
        cacheUrl(key),
        new Response(body, {
          headers: {
            'content-type': 'application/json',
            'cache-control': `public, max-age=${ttlSec}`,
          },
        }),
      )
    } catch {
      // abaikan
    }
  }

  const kv = await getKV()
  if (kv) {
    try {
      await kv.put(`${KV_PREFIX}${key}`, body, { expirationTtl: Math.max(60, ttlSec) })
    } catch {
      // abaikan — KV opsional
    }
  }
}

/** Status tier untuk diagnostik (endpoint /api/config?cache=1). */
export async function cacheStatus(): Promise<{
  memoryEntries: number
  cacheApi: boolean
  kvBound: boolean
}> {
  return {
    memoryEntries: memory.size,
    cacheApi: !!cacheApi(),
    kvBound: !!(await getKV()),
  }
}

/** Uji put/get melewati Cache API dengan mem-bypass memory. */
export async function cacheSelfTest(): Promise<{ ok: boolean; tier: string; detail?: string }> {
  const key = `__selftest:${Date.now()}`
  const c = cacheApi()
  if (c) {
    try {
      await c.put(
        cacheUrl(key),
        new Response('{"ok":true}', {
          headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
        }),
      )
      const res = await c.match(cacheUrl(key))
      const ok = !!(res && (await res.json()).ok)
      return ok ? { ok: true, tier: 'cache-api' } : { ok: false, tier: 'cache-api' }
    } catch (e) {
      return { ok: false, tier: 'cache-api', detail: (e as Error).message }
    }
  }
  const kv = await getKV()
  if (kv) {
    try {
      await kv.put(`${KV_PREFIX}${key}`, '{"ok":true}', { expirationTtl: 60 })
      const raw = await kv.get(`${KV_PREFIX}${key}`)
      return { ok: raw !== null, tier: 'kv' }
    } catch (e) {
      return { ok: false, tier: 'kv', detail: (e as Error).message }
    }
  }
  return { ok: true, tier: 'memory-only' }
}
