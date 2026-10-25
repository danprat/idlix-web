import { createRootRoute, HeadContent, Link, Scripts } from '@tanstack/react-router'
import { AppShell } from '../components/AppShell'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'IDLIX — Streaming Film & Serial' },
      {
        name: 'description',
        content: 'Web port IDLIX: streaming film & serial tanpa iklan dan popup.',
      },
    ],
    links: [
      // Poster/backdrop dimuat dari TMDB — preconnect memangkas latency gambar pertama
      { rel: 'preconnect', href: 'https://image.tmdb.org' },
      { rel: 'dns-prefetch', href: 'https://image.tmdb.org' },
      { rel: 'stylesheet', href: appCss },
    ],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-6xl">🎞️</p>
      <h1 className="text-2xl font-extrabold">Halaman tidak ditemukan</h1>
      <p className="text-sm text-muted">Tautan yang Anda buka tidak ada atau sudah dipindah.</p>
      <Link to="/" className="rounded bg-brand px-5 py-2 text-sm font-bold hover:bg-brand-dark">
        Kembali ke Beranda
      </Link>
    </div>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-ink font-sans text-white antialiased">
        <AppShell>{children}</AppShell>
        <Scripts />
      </body>
    </html>
  )
}
