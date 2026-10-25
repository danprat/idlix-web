# IDLIX Web — TanStack Start + Cloudflare Workers

Port web dari aplikasi Android TV [idlix-androidtv](../) (Kotlin + Compose TV) menjadi
web app streaming film & serial **tanpa iklan dan popup**, dengan UI Netflix-style
yang sama: hero billboard, swimlane katalog, Lanjutkan Menonton, dan pemutar HLS native.

## Stack

| Lapisan | Teknologi |
| --- | --- |
| Framework | [TanStack Start](https://tanstack.com/start) (React 19, file-based routing, SSR) |
| Deployment | Cloudflare Workers (`@cloudflare/vite-plugin` + wrangler) |
| Styling | Tailwind CSS v4 (palet port dari `ui/theme/Color.kt`) |
| Pemutar video | [hls.js](https://github.com/video-dev/hls.js) + `<track>` subtitle VTT |
| Subtitle alternatif | SubDL.com (ZIP → ekstrak → konversi SRT ke VTT di server) |

## Arsitektur

Aplikasi Android berjalan **standalone** di device; di web, browser tidak bisa memanggil
upstream `z2.idlixku.com` langsung (CORS + bot-check), sehingga seluruh lapisan data
dipindah ke **server routes di Worker** (`src/routes/api.$.tsx`):

```
Browser ──► Worker (Cloudflare)
             ├─ /api/catalog/*        proxy katalog (film, serial, episode, search)
             ├─ /api/watch/play-info  gate token + waktu unlock
             ├─ /api/watch/claim      klaim sesi (Cookie did=… dipertahankan)
             ├─ /api/watch/redeem     tukar claim → URL master playlist HLS
             ├─ /api/watch/resolve    satu-tembakan: 1–4 di atas (prewarm)
             ├─ /api/hls              proxy playlist & segmen + penulisan-ulang URI
             │                        (token CDN ?t=… diawetkan, seperti di Kotlin)
             ├─ /api/subtitle         proxy subtitle CDN (SRT → VTT otomatis)
             └─ /api/subdl/*          pencarian & proxy subtitle SubDL
```

Katalog untuk SSR diambil lewat **server functions** (`src/server/queries.ts`, berbasis
`createServerFn`) sehingga halaman dirender penuh di server tanpa masalah CORS.

Alur pemutaran di client (`src/routes/watch.$type.$id.tsx`) mempertahankan UX aplikasi TV:
play-info → **countdown tersinkron server** → polling klaim (15×600 ms) → redeem → putar,
plus prompt **episode berikutnya** otomatis dan penyimpanan progres di localStorage
(padanan `WatchHistoryStore.kt`, semantik identik: maks 60 item, ≥10 dtk & <95% durasi).

**Waktu tunggu "Menyiapkan stream"**: gerbang 15 detik adalah mekanisme anti-hotlink
upstream (`unlockAt − serverNow`, tidak bisa dipangkas — app Android menjalaninya juga).
Yang bisa dihindari adalah menunggunya dua kali: halaman detail meng-*prewarm* resolve
stream di background (server menunggu gerbang, hasil di-cache 60 menit), dan halaman
pemain berpacu dengan cache itu — bila kena, video langsung putar tanpa countdown
(terukur: detail → baca synopsis → Putar = ±0,2 dtk; putar dingin tetap ±15–18 dtk).

## Fitur pemutar & UX

- Pemutar: indikator buffering, auto-retry saat jaringan drop (hls.js `startLoad`/`recoverMediaError`), pilihan kualitas & kecepatan (0,5–2×), volume yang diingat antar sesi, Picture-in-Picture, dobel-klik = layar penuh, toast "Melanjutkan dari …", bantuan shortcut (tombol `?`), kursor otomatis sembunyi saat idle.
- Subtitle: render overlay kustom (bukan native) dengan ukuran S/M/L, **offset sinkronisasi ±0,5 dtk** untuk subtitle SubDL yang meleset, preferensi bahasa/ukuran/offset tersimpan di localStorage.
- Katalog: **filter kategori/genre** di halaman Film & Serial (chip genre live dari upstream, mode grid + sorting Terpopuler/Terbaru + Muat Lagi, tersimpan di URL seperti `/movies?genre=action`), hover-preview kartu ala Netflix (delay 500 ms), hero billboard berotasi (hormat `prefers-reduced-motion`, jeda saat hover), progress bar merah di kartu yang sedang ditonton, tombol "Muat Lagi" per kategori & pencarian, skeleton loading, empty-state ber-illustrasi SVG.
- Navigasi: sidebar berlabel di desktop + bottom tab bar (≤5 item) di mobile, **navigasi spasial D-pad** (panah memindahkan fokus antar kartu — ramah browser TV), modal dengan focus-trap + Esc, konfirmasi sebelum menghapus riwayat, tombol kembali on-page di detail & pemutar, tombol Trailer bila tersedia.

## Performa

Cache data katalog bertingkat (`src/server/cache.ts`):

1. **Memory** per-isolate (±0 ms) — mati saat isolate di-recycle;
2. **Cache API** (`caches.default`, per-colo edge, ±1 ms) — bertahan lintas isolate
   & cold start di datacenter yang sama; otomatis aktif, tanpa konfigurasi/biaya;
3. **KV** (opsional, global lintas colo, ±10–60 ms) — aktif otomatis bila binding
   `IDLIX_KV` ditambahkan di `wrangler.jsonc`. Untuk pengguna yang terkonsentrasi
   di satu negara, tier 1+2 sudah menangkap hampir semua manfaat; KV hanya berarti
   untuk trafik multi-region.

TTL: genre 6 jam, katalog list 2 menit, detail 10 menit, pencarian 5 menit, subtitle
SubDL 6 jam, playback ter-resolve 60 menit. Router memakai `defaultPreloadStaleTime:
30 dtk` + `preconnect` ke image.tmdb.org. Diagnostik: `GET /api/config?cache=1`
(status tier) dan `?cache=selftest`. Terukur di dev: muat halaman genre dari
6 dtk → ±0,6 dtk (dingin) / ±0,2 dtk (hangat), navigasi chip antar genre ±0,13 dtk.

## Jalankan

```bash
npm install

# Dev server (http://localhost:3000)
npm run dev

# Build + deploy ke Cloudflare Workers
npm run deploy
```

## Catatan penting soal egress Cloudflare Workers

Deploy ke `*.workers.dev` berhasil dan aplikasi berjalan, TAPI situs sumber
(idlixku.com dan mirror z1/z2/z3) **memblokir trafik dari IP datacenter Cloudflare**
(bot-check 403 "Just a moment" / 530). Dari jaringan rumah (dev lokal) upstream
dijawab normal, sehingga semua fitur berjalan — dari egress Workers, katalog dan
pemutaran akan menampilkan state "Gagal memuat katalog" / error dengan CTA ke
Pengaturan (by design, aplikasi tetap tidak crash).

Opsi bila ingin produksi berfungsi penuh:

1. **Ganti upstream** ke domain mirror yang tidak memblokir datacenter — bisa
   per-user via menu Pengaturan, atau global via env `IDLIX_UPSTREAM_URL`.
2. **Arahkan egress lewat proxy** (VPS murah / residential proxy) di luar
   Cloudflare, lalu set `IDLIX_UPSTREAM_URL` ke proxy tersebut.
3. **Host di luar Cloudflare** (VPS/fly.io) — stack ini juga bisa jalan sebagai
   server Node biasa dengan penyesuaian kecil.

## Konfigurasi runtime

Tiga hal dapat diubah **tanpa redeploy**:

1. **Dari menu Pengaturan di aplikasi** (disimpan di localStorage pengguna):
   URL sumber streaming (bila domain IDLIX berganti) dan API key SubDL.
2. **Env Worker** (`wrangler.jsonc` → `vars`):
   - `IDLIX_UPSTREAM_URL` — default upstream seluruh pengguna
   - `SUBDL_API_KEY` — default API key SubDL
   - `HLS_PROXY_SECRET` — secret HMAC untuk signature URL proxy
     (CDN segmen IDLIX berotasi di puluhan domain acak; akses proxy divalidasi
     lewat signature yang di-generate proxy sendiri saat menulis-ulang playlist,
     bukan allowlist statis)
   - `IDLIX_PROXY_ALLOWED_HOSTS` — suffix host tambahan untuk fallback allowlist

## Struktur

```
web/
├── src/
│   ├── routes/               # File-based routing (TanStack Start)
│   │   ├── __root.tsx        # Shell + sidebar Netflix-style
│   │   ├── index.tsx         # Beranda: hero + Lanjut Menonton + swimlane
│   │   ├── movies.tsx        # Film (populer/terbaru/genre)
│   │   ├── series.tsx        # Serial TV
│   │   ├── search.tsx        # Pencarian (debounce 400 ms)
│   │   ├── continue.tsx      # Lanjutkan Menonton
│   │   ├── detail.$type.$slug.tsx  # Detail + pilihan season/episode + prewarm
│   │   ├── watch.$type.$id.tsx     # Pemain: countdown → claim → redeem → hls.js
│   │   ├── settings.tsx      # Pengaturan sumber & SubDL
│   │   └── api.$.tsx         # Server routes (proxy upstream, HLS, subtitle)
│   ├── server/               # Logika sisi server (Workers)
│   │   ├── upstream.ts       # Klien upstream + header browser + cache
│   │   ├── resolver.ts       # Port IdlixRepository.resolveStreamInternal
│   │   ├── hls.ts            # Proxy HLS + rewrite playlist (token ?t=)
│   │   ├── subdl.ts          # Port SubdlRepository (ZIP/SRT/VTT)
│   │   └── queries.ts        # createServerFn untuk loader SSR
│   ├── lib/                  # Kode sisi klien
│   │   ├── types.ts          # Port model data Kotlin
│   │   ├── history.ts        # Port WatchHistoryStore (localStorage)
│   │   └── settings.ts       # Port SharedPreferences idlix_config
│   └── components/           # MediaCard, Swimlane, HeroBillboard, AppShell
└── wrangler.jsonc            # Konfigurasi Cloudflare Workers
```

## Catatan privasi

Sama seperti aplikasi TV: tidak ada akun, tidak ada data pribadi yang disimpan di server.
Riwayat tontonan dan pengaturan tersimpan hanya di localStorage browser pengguna.
Dibuat untuk keperluan riset dan edukasi arsitektur streaming HLS.
