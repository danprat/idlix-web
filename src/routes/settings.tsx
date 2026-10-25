// Pengaturan — padanan SettingsScreen.kt: URL sumber streaming & API key SubDL
// bisa diganti tanpa redeploy (disimpan di localStorage).

import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getConfigDefaultsFn, testSubdlFn, testUpstreamFn, type ClientSettings } from '../server/queries'
import { getSettings, saveSettings } from '../lib/settings'

export const Route = createFileRoute('/settings')({
  component: SettingsScene,
})

interface TestState {
  busy: boolean
  ok?: boolean
  message?: string
}

function SettingsScene() {
  const router = useRouter()
  const [upstreamUrl, setUpstreamUrl] = useState('')
  const [subdlKey, setSubdlKey] = useState('')
  const [defaultUpstream, setDefaultUpstream] = useState('')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [upstreamTest, setUpstreamTest] = useState<TestState>({ busy: false })
  const [subdlTest, setSubdlTest] = useState<TestState>({ busy: false })

  useEffect(() => {
    const s = getSettings()
    setUpstreamUrl(s.upstreamUrl)
    setSubdlKey(s.subdlApiKey)
    getConfigDefaultsFn()
      .then((c) => setDefaultUpstream(c.defaultUpstream))
      .catch(() => setDefaultUpstream(''))
  }, [])

  const settings = (): ClientSettings => ({
    upstreamUrl: upstreamUrl.trim(),
    subdlApiKey: subdlKey.trim(),
  })

  const runUpstreamTest = async () => {
    setUpstreamTest({ busy: true })
    const res = await testUpstreamFn({ data: { base: upstreamUrl.trim(), settings: settings() } }).catch(
      (e: Error) => ({ ok: false, status: 0, message: e.message }),
    )
    setUpstreamTest({ busy: false, ok: res.ok, message: res.message })
  }

  const runSubdlTest = async () => {
    setSubdlTest({ busy: true })
    const res = await testSubdlFn({ data: { settings: settings() } }).catch((e: Error) => ({
      ok: false,
      message: e.message,
    }))
    setSubdlTest({ busy: false, ok: res.ok, message: res.message })
  }

  const saveAll = () => {
    saveSettings({ upstreamUrl: upstreamUrl.trim(), subdlApiKey: subdlKey.trim() })
    setSaveMessage('Pengaturan disimpan — katalog dimuat ulang.')
    // Katalog lama (cache loader) langsung di-refresh dengan sumber baru
    void router.invalidate()
    setTimeout(() => setSaveMessage(null), 3500)
  }

  return (
    <div className="animate-fade-in mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-8 text-2xl font-extrabold tracking-tight">Pengaturan</h1>

      <section className="mb-8 rounded-xl border border-white/10 bg-card p-5">
        <h2 className="mb-1 font-bold">URL Sumber Streaming</h2>
        <p className="mb-4 text-xs leading-relaxed text-muted">
          Domain IDLIX sering berganti. Bila katalog gagal dimuat, isi URL sumber baru di sini
          (mis. <span className="text-white/80">https://z3.idlixku.com</span>). Kosongkan untuk
          memakai default server{defaultUpstream ? `: ${defaultUpstream}` : ''}.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="url"
            value={upstreamUrl}
            onChange={(e) => setUpstreamUrl(e.target.value)}
            placeholder="https://z2.idlixku.com"
            className="flex-1 rounded-lg border border-white/15 bg-ink px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-white/40"
          />
          <button
            type="button"
            onClick={runUpstreamTest}
            disabled={upstreamTest.busy}
            className="rounded-lg bg-white/10 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/20 disabled:opacity-50"
          >
            {upstreamTest.busy ? 'Menguji…' : 'Tes Koneksi'}
          </button>
        </div>
        {upstreamTest.message && (
          <p className={`mt-3 text-xs ${upstreamTest.ok ? 'text-emerald-400' : 'text-brand'}`}>
            {upstreamTest.message}
          </p>
        )}
      </section>

      <section className="mb-8 rounded-xl border border-white/10 bg-card p-5">
        <h2 className="mb-1 font-bold">API Key SubDL</h2>
        <p className="mb-4 text-xs leading-relaxed text-muted">
          Dipakai untuk mencari subtitle alternatif dari SubDL.com. Kosongkan untuk memakai
          default server.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={subdlKey}
            onChange={(e) => setSubdlKey(e.target.value)}
            placeholder="subdl__…"
            className="flex-1 rounded-lg border border-white/15 bg-ink px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-white/40"
          />
          <button
            type="button"
            onClick={runSubdlTest}
            disabled={subdlTest.busy}
            className="rounded-lg bg-white/10 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/20 disabled:opacity-50"
          >
            {subdlTest.busy ? 'Menguji…' : 'Tes SubDL'}
          </button>
        </div>
        {subdlTest.message && (
          <p className={`mt-3 text-xs ${subdlTest.ok ? 'text-emerald-400' : 'text-brand'}`}>
            {subdlTest.message}
          </p>
        )}
      </section>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={saveAll}
          className="rounded-lg bg-brand px-6 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark"
        >
          Simpan Semua Pengaturan
        </button>
        {saveMessage && <p className="text-xs font-semibold text-emerald-400">{saveMessage}</p>}
      </div>
    </div>
  )
}
