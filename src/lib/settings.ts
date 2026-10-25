// Pengaturan tersimpan lokal (padanan SharedPreferences "idlix_config" di Android):
// URL upstream & API key SubDL bisa diganti dari menu Pengaturan tanpa redeploy.

const LS_KEY = 'idlix_config'

export interface AppSettings {
  upstreamUrl: string // '' = pakai default server
  subdlApiKey: string // '' = pakai default server
}

function read(): AppSettings {
  if (typeof window === 'undefined') return { upstreamUrl: '', subdlApiKey: '' }
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return { upstreamUrl: '', subdlApiKey: '' }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return { upstreamUrl: parsed.upstreamUrl ?? '', subdlApiKey: parsed.subdlApiKey ?? '' }
  } catch {
    return { upstreamUrl: '', subdlApiKey: '' }
  }
}

export function getSettings(): AppSettings {
  return read()
}

export function saveSettings(next: Partial<AppSettings>): AppSettings {
  const merged = { ...read(), ...next }
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(merged))
    window.dispatchEvent(new CustomEvent('idlix:settings-changed'))
  } catch {
    // storage penuh / diblokir — abaikan
  }
  return merged
}

/** Fetch ke API internal, menyertakan override Pengaturan via header. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const s = read()
  const headers = new Headers(init.headers)
  if (s.upstreamUrl) headers.set('x-idlix-base', s.upstreamUrl)
  if (s.subdlApiKey) headers.set('x-subdl-key', s.subdlApiKey)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return fetch(input, { ...init, headers })
}

export async function apiJson<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(input, init)
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      // biarkan pesan default
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}
