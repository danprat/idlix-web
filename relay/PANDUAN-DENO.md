# Panduan Lengkap: Deploy Relay ke Deno Deploy

Relay adalah komponen kecil yang membuat aplikasi di Cloudflare Workers bisa
mengakses API situs sumber (yang memblokir IP datacenter Cloudflare). Video
**tidak** lewat relay — sudah langsung browser→CDN. Yang lewat relay hanya
JSON kecil: katalog, gate, klaim, redeem.

```
User ──► Worker CF (web + API) ──► RELAY DENO ──► api z2.idlixku.com
   │                                        (egress lolos WAF)
   └──────────► VIDEO: browser ──► CDN langsung (tanpa server)
```

Setelah relay Deno aktif, **laptop tidak perlu menyala lagi**.

---

## Prasyarat

- Akun GitHub (untuk login ke Deno)
- File relay: [`relay/deno.mjs`](./deno.mjs) — sudah ada di repo ini.
  Salin isinya dari: https://raw.githubusercontent.com/danprat/idlix-web/main/relay/deno.mjs
- Siapkan **key rahasia** untuk relay (bebas, contoh: `idlix-relay-Xk92mZ`).
  Jangan pakai contoh — buat sendiri dan simpan.

---

## Jalur A — Playground (paling cepat, tanpa terminal, tanpa token) ⭐

1. Buka **https://dash.deno.com** → klik **Sign in with GitHub**.
2. Di dashboard kiri, pilih **Playgrounds** → tombol **+ New Playground**
   (atau **New Playground** di halaman utama).
3. Hapus seluruh isi editor default (`export default {...}`), lalu
   **tempel seluruh isi `relay/deno.mjs`**.
4. Set key rahasia (pilih salah satu):
   - **Cara bersih (disarankan):** panel kanan → **Settings** (ikon gerigi) →
     **Environment Variables** → **Add variable**:
     - Name: `RELAY_KEY`
     - Value: key rahasia Anda
     - Centang **Secret**
   - Atau edit baris kode: ganti `"ganti-key-ini"` dengan key Anda.
5. Klik **Save & Deploy** (kanan atas). Tunggu ±5 detik sampai muncul
   **"Deployment successful"**.
6. URL relay Anda: **`https://<nama-playground>.deno.dev`**
   (terlihat di panel kanan / kolom URL preview).
7. **Uji langsung** — buka di browser atau terminal:
   ```
   https://<nama>.deno.dev/?key=<KEY-ANDA>&url=https%3A%2F%2Fz2.idlixku.com%2Fapi%2Fmovies%3Flimit%3D1
   ```
   (URL bagian `url=` memang di-encode — copy baris di atas apa adanya.)
   - ✅ Muncul JSON film (`{"data":[...]}`) → **relay hidup dan lolos WAF**.
   - ❌ Muncul HTML "Just a moment..." / error 403 → IP Deno ditantang WAF →
     lihat bagian *Troubleshooting*.

## Jalur B — Project + GitHub (auto-deploy setiap `git push`)

Cocok untuk jangka panjang: relay ikut ter-update otomatis dari repo.

1. **https://dash.deno.com** → **New Project**.
2. Pilih tab **Deploy from GitHub repository** → authorize & pilih repo
   **danprat/idlix-web**.
3. Konfigurasi:
   - **Production branch:** `main`
   - **Entrypoint / directory:** ubah ke file `relay/deno.mjs`
     (atau directory `relay/` dengan entrypoint `deno.mjs`)
4. Klik **Link** → deploy pertama berjalan.
5. Set key: **project → Settings → Environment Variables** → add `RELAY_KEY`
   (Secret) → **Apply** / redeploy.
6. URL: **`https://idlix-web.deno.dev`** (mengikuti nama project).
7. Ke depannya: setiap `git push` ke `main` → relay ter-deploy ulang otomatis.

## Jalur C — CLI (`deployctl` + token)

Untuk yang terbiasa terminal:

```bash
# 1. Install Deno (macOS):  brew install deno   |  Windows: winget install DenoLand.Deno

# 2. Buat token:
#    https://dash.deno.com → Account Settings → Access Tokens → Generate new token
#    ⚠️ TOKEN HANYA DITAMPILKAN SEKALI saat dibuat — salin saat itu juga.
#    (Kalau disalin dari daftar riwayat, yang terlihat bukan token asli → invalidToken.)

# 3. Install deployctl:
deno install -g -Arf jsr:@deno/deployctl

# 4. Deploy (dari folder web/):
export DTOKEN="tempel-token-disini"
deployctl deploy --project=idlix-relay --token="$DTOKEN" --prod relay/deno.mjs

# 5. Env var TIDAK bisa lewat deployctl — set via dashboard:
#    project idlix-relay → Settings → Env Vars → RELAY_KEY (Secret)
```

---

## Langkah kritis: uji WAF

Satu-satunya variabel yang belum terbukti adalah apakah **IP datacenter Deno**
diterima WAF upstream (fingerprint TLS Deno sudah terbukti lolos dari uji lokal).
Uji dari terminal mana saja:

```bash
curl "https://<nama>.deno.dev/?key=<KEY>&url=https%3A%2F%2Fz2.idlixku.com%2Fapi%2Fmovies%3Flimit%3D1"
```

| Hasil | Arti |
|---|---|
| `{"data":[...}` | ✅ Lolos — lanjut ke sambungkan produksi |
| `Just a moment...` / 403 | ❌ WAF menolak IP Deno — relay Deno gugur; pakai opsi perangkat rumah (lihat README utama) |
| `not found` | Key salah — cek `RELAY_KEY` |
| `host not allowed` | Target bukan idlixku — jangan diubah |

---

## Sambungkan ke produksi Cloudflare

Setelah uji WAF ✅ (sekali saja, ±30 detik):

```bash
cd web
npx wrangler login          # kalau belum
npx wrangler secret put IDLIX_RELAY_URL
# isi dengan PERSIS format ini (perhatikan ?key=):
# https://<nama>.deno.dev/?key=<KEY-ANDA>
```

Verifikasi produksi:

```bash
curl -s https://idlix-web.dany-dto.workers.dev/ | grep -c "Sedang Tren"   # harus 1
```

Lalu buka https://idlix-web.dany-dto.workers.dev → pilih film → Putar.

## Matikan tunnel laptop (opsional, produksi sudah mandiri)

```bash
pkill -f cloudflared        # tunnel tidak diperlukan lagi
# dev server (npm run dev) hanya untuk pengembangan lokal
```

---

## Pemeliharaan

- **Lihat log real-time:** dashboard project → tab **Logs** (request, error, dll).
- **Update relay:** Jalur A: edit di Playground → Save & Deploy. Jalur B: `git push`.
- **Ganti key:** ubah `RELAY_KEY` di dashboard → jalankan ulang
  `wrangler secret put IDLIX_RELAY_URL` dengan key baru.
- **Biaya:** free tier Deno Deploy = 1 juta request/hari — jauh lebih dari cukup
  (relay hanya dilewati JSON kecil).

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `invalidToken` saat deployctl | Token disalin bukan saat pertama dibuat. Generate new token, salin saat muncul. |
| Relay balas `not found` | `?key=` tidak cocok dengan `RELAY_KEY` (perhatikan spasi/encode). |
| `Just a moment` di uji WAF | IP Deno ditolak WAF upstream — Deno gugur sebagai relay; gunakan perangkat rumah (`npm run dev` + tunnel) atau VPS dengan runtime workerd. |
| Produksi masih "Gagal memuat katalog" setelah pasang | Format `IDLIX_RELAY_URL` kurang `?key=...`, atau ada spasi saat input secret. Uji ulang URL relay di curl dulu. |
| Video gagal setelah relay dipasang | Relay hanya untuk API. Video harus tetap direct CDN — jangan ubah `hlsMasterUrl` jalanur proxy permanen. |
| Playground tidak ada env var settings | Gunakan cara edit baris `const KEY = ... "ganti-key-ini"` langsung di kode. |
