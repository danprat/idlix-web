// Lanjutkan Menonton — padanan ContinueWatchingScreen.kt + konfirmasi hapus semua.

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ContinueCard } from '../components/media'
import { EmptyState } from '../components/feedback'
import { clearAllHistory } from '../lib/history'
import { useUnfinishedHistory } from '../lib/useHistory'

export const Route = createFileRoute('/continue')({
  component: ContinueScene,
})

function ContinueScene() {
  const [items] = useUnfinishedHistory()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  // Esc menutup + fokus awal + trap sederhana untuk dialog konfirmasi
  useEffect(() => {
    if (!confirmOpen) return
    confirmBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConfirmOpen(false)
        return
      }
      if (e.key !== 'Tab' || !modalRef.current) return
      const focusables = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>('button'),
      )
      if (focusables.length === 0) return
      const idx = focusables.indexOf(document.activeElement as HTMLElement)
      e.preventDefault()
      const next = e.shiftKey
        ? focusables[(idx - 1 + focusables.length) % focusables.length]
        : focusables[(idx + 1) % focusables.length]
      next.focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [confirmOpen])

  return (
    <div className="animate-fade-in mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight">Lanjutkan Menonton</h1>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            Hapus Semua Riwayat
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          kind="popcorn"
          title="Belum ada tontonan"
          message="Tontonan yang belum selesai akan muncul di sini agar bisa dilanjutkan kapan saja."
        >
          <Link
            to="/"
            className="rounded bg-brand px-5 py-2 text-sm font-bold text-white hover:bg-brand-dark"
          >
            Jelajahi Katalog
          </Link>
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => (
            <div key={it.contentId} className="[&>div]:w-full">
              <ContinueCard item={it} />
            </div>
          ))}
        </div>
      )}

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            ref={modalRef}
            data-modal-open=""
            role="alertdialog"
            aria-label="Konfirmasi hapus riwayat"
            className="w-full max-w-sm animate-fade-in rounded-xl border border-white/10 bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-base font-bold">Hapus semua riwayat?</h2>
            <p className="mb-5 text-sm leading-relaxed text-muted">
              Seluruh {items.length} riwayat tontonan dan posisi pemutaran akan dihapus permanen.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20"
              >
                Batal
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={() => {
                  clearAllHistory()
                  setConfirmOpen(false)
                }}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-bold transition hover:bg-brand-dark"
              >
                Ya, Hapus Semua
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
