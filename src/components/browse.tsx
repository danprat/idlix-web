// Komponen bersama halaman browse (Film/Serial): baris kategori/genre,
// header mode genre (kembali + judul + jumlah + sorting segmented), grid,
// dan tombol Muat Lagi.

import type { ReactNode } from 'react'
import type { GenreItem } from '../server/queries'

export const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'popularity', label: 'Terpopuler' },
  { value: 'createdAt', label: 'Terbaru' },
]

/**
 * Baris chip kategori. Mobile: satu baris scroll horizontal dengan fade
 * di tepi kanan. Desktop (lg+): chip membungkus (wrap) sehingga semua genre
 * terlihat tanpa perlu menggulir.
 */
export function CategoryFilter({
  genres,
  activeGenre,
  onSelectGenre,
}: {
  genres: GenreItem[]
  activeGenre?: string
  onSelectGenre: (slug?: string) => void
}) {
  return (
    <div className="relative">
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-x-visible">
        <Chip active={!activeGenre} onClick={() => onSelectGenre(undefined)}>
          Semua
        </Chip>
        {genres.map((g) => (
          <Chip
            key={g.slug}
            active={activeGenre === g.slug}
            onClick={() => {
              onSelectGenre(g.slug === activeGenre ? undefined : g.slug)
              window.scrollTo({ top: 0 })
            }}
          >
            {g.name}
          </Chip>
        ))}
      </div>
      {/* Affordance tepi kanan (hanya mobile, saat baris bisa digulir) */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-ink to-transparent lg:hidden" />
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold whitespace-nowrap transition lg:shrink ${
        active
          ? 'bg-white text-black'
          : 'bg-white/10 text-white/75 hover:bg-white/20 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Header mode genre: tombol kembali ke Semua, nama genre, jumlah judul,
 * dan sorting berupa segmented control di kanan (desktop) / baris baru (mobile).
 */
export function GenreHeader({
  title,
  countLabel,
  onBack,
  activeSort,
  onSelectSort,
}: {
  title: string
  countLabel: string
  onBack: () => void
  activeSort: string
  onSelectSort: (sort: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-white"
      >
        ← Semua
      </button>
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/80">
        {countLabel}
      </span>
      <div className="ml-auto">
        <SegmentedSort activeSort={activeSort} onSelectSort={onSelectSort} />
      </div>
    </div>
  )
}

function SegmentedSort({
  activeSort,
  onSelectSort,
}: {
  activeSort: string
  onSelectSort: (sort: string) => void
}) {
  return (
    <div
      role="group"
      aria-label="Urutkan"
      className="flex rounded-full bg-card p-1 ring-1 ring-white/10"
    >
      {SORT_OPTIONS.map((s) => (
        <button
          key={s.value}
          type="button"
          onClick={() => onSelectSort(s.value)}
          aria-pressed={activeSort === s.value}
          className={`rounded-full px-4 py-1 text-xs font-bold transition ${
            activeSort === s.value ? 'bg-white text-black' : 'text-muted hover:text-white'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {children}
    </div>
  )
}

export function LoadMoreButton({
  onClick,
  loading,
}: {
  onClick: () => void
  loading: boolean
}) {
  return (
    <div className="mt-8 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="rounded-full border border-white/15 px-6 py-2.5 text-sm font-semibold text-muted transition hover:border-white/40 hover:text-white disabled:opacity-50"
      >
        {loading ? 'Memuat…' : 'Muat Lagi'}
      </button>
    </div>
  )
}
