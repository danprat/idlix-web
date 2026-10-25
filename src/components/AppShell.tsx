// Shell aplikasi: sidebar Netflix-style di desktop (label selalu tampil),
// bottom tab bar di mobile (≤5 item + gear Pengaturan di top bar), dan
// navigasi spasial D-pad (panah memindahkan fokus antar kartu/tombol) —
// padanan TvNavDrawer.kt untuk browser TV.

import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import {
  IconFilm,
  IconHistory,
  IconHome,
  IconSearch,
  IconSettings,
  IconTv,
} from './icons'

interface NavItem {
  to: string
  label: string
  Icon: (p: { className?: string }) => ReactNode
  exact?: boolean
}

// Bottom nav ≤5 item (Pengaturan lewat gear di top bar mobile).
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Beranda', Icon: IconHome, exact: true },
  { to: '/movies', label: 'Film', Icon: IconFilm },
  { to: '/series', label: 'Serial TV', Icon: IconTv },
  { to: '/search', label: 'Pencarian', Icon: IconSearch },
  { to: '/continue', label: 'Lanjut', Icon: IconHistory },
]

const SETTINGS_ITEM: NavItem = { to: '/settings', label: 'Pengaturan', Icon: IconSettings }

function useActivePath() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const isActive = (item: NavItem) =>
    item.exact ? path === item.to : path.startsWith(item.to)
  return { path, isActive }
}

function Sidebar() {
  const { isActive } = useActivePath()

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-white/5 bg-ink/95 py-4 backdrop-blur lg:flex"
      aria-label="Navigasi utama"
    >
      <Link to="/" className="mb-8 flex items-center gap-3 px-5" aria-label="IDLIX — Beranda">
        <span className="grid size-9 shrink-0 place-items-center rounded bg-brand text-sm font-extrabold text-white">
          ID
        </span>
        <span className="text-xl font-extrabold tracking-tight text-brand">IDLIX</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, Icon, ...rest }) => {
          const active = isActive({ to, label, Icon, ...rest })
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-4 px-5 py-3 text-sm transition-colors ${
                active ? 'text-white' : 'text-muted hover:text-white'
              }`}
            >
              <Icon className="size-6 shrink-0" aria-hidden />
              <span className="font-medium whitespace-nowrap">{label}</span>
              {active && <span className="ml-auto h-6 w-1 rounded-full bg-brand" />}
            </Link>
          )
        })}
        <Link
          to="/settings"
          className={`mt-1 flex items-center gap-4 px-5 py-3 text-sm transition-colors ${
            isActive(SETTINGS_ITEM) ? 'text-white' : 'text-muted hover:text-white'
          }`}
        >
          <IconSettings className="size-6 shrink-0" aria-hidden />
          <span className="font-medium whitespace-nowrap">Pengaturan</span>
        </Link>
      </nav>

      <p className="px-5 text-[11px] leading-relaxed text-muted/70">
        Web port dari IDLIX untuk Android TV · Tanpa iklan &amp; popup
      </p>
    </aside>
  )
}

function MobileTopBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-white/5 bg-ink/95 px-4 py-2.5 backdrop-blur lg:hidden">
      <Link to="/" className="flex items-center gap-2.5" aria-label="IDLIX — Beranda">
        <span className="grid size-7 place-items-center rounded bg-brand text-[11px] font-extrabold">ID</span>
        <span className="text-lg font-extrabold tracking-tight text-brand">IDLIX</span>
      </Link>
      <Link
        to="/settings"
        aria-label="Pengaturan"
        className="grid size-9 place-items-center rounded-full text-muted transition hover:text-white"
      >
        <IconSettings className="size-5" />
      </Link>
    </header>
  )
}

function MobileBottomNav() {
  const { isActive } = useActivePath()

  return (
    <nav
      aria-label="Navigasi utama (mobile)"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/5 bg-ink/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {NAV_ITEMS.map(({ to, label, Icon, ...rest }) => {
        const active = isActive({ to, label, Icon, ...rest })
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors ${
              active ? 'text-white' : 'text-muted'
            }`}
          >
            <span className={active ? 'text-brand' : ''}>
              <Icon className="size-5" aria-hidden />
            </span>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

// ---- Navigasi spasial D-pad: panah memindahkan fokus ke elemen terdekat ----

function isFocusable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if (el.getAttribute('tabindex') === '-1' || el.getAttribute('aria-hidden') === 'true') return false
  if (el.hasAttribute('disabled')) return false
  if (!el.offsetParent && el.tagName !== 'BODY') return false
  return el.matches('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]')
}

function useSpatialNavigation() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dirKey = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[
        e.key
      ]
      if (!dirKey) return

      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return // biarkan caret bergerak di dalam form
      }
      if (document.querySelector('[data-modal-open]')) return // modal menangani keyboard sendiri

      const candidates = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input, [tabindex]'))
        .filter(isFocusable)
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight)

      if (candidates.length === 0) return

      const active = document.activeElement as HTMLElement | null
      const cur =
        active && active !== document.body && candidates.some((c) => c.el === active)
          ? active.getBoundingClientRect()
          : { left: window.innerWidth / 2 - 1, right: window.innerWidth / 2 + 1, top: window.innerHeight / 2 - 1, bottom: window.innerHeight / 2 + 1 }

      const [dx, dy] = dirKey
      let best: { el: HTMLElement; score: number } | null = null

      for (const { el, r } of candidates) {
        if (el === active) continue
        // Harus benar-benar berada di arah yang dituju
        const inDirection =
          (dx > 0 && r.left >= cur.right - 12) ||
          (dx < 0 && r.right <= cur.left + 12) ||
          (dy > 0 && r.top >= cur.bottom - 12) ||
          (dy < 0 && r.bottom <= cur.top + 12)
        if (!inDirection) continue

        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const ccx = cur.left + (cur.right - cur.left) / 2
        const ccy = cur.top + (cur.bottom - cur.top) / 2
        const main = Math.abs(dx ? cx - ccx : cy - ccy)
        const cross = Math.abs(dx ? cy - ccy : cx - ccx)
        const score = main + cross * 2.5 // penalti besar untuk deviasi lateral
        if (!best || score < best.score) best = { el, score }
      }

      if (best) {
        e.preventDefault()
        best.el.focus()
        best.el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function AppShell({ children }: { children: ReactNode }) {
  const isPlayer = useRouterState({ select: (s) => s.location.pathname.startsWith('/watch') })
  useSpatialNavigation()

  if (isPlayer) return <>{children}</>
  return (
    <div className="min-h-dvh">
      <Sidebar />
      <MobileTopBar />
      <MobileBottomNav />
      <main className="pt-12 pb-20 lg:pt-0 lg:pb-0 lg:pl-56">{children}</main>
    </div>
  )
}
