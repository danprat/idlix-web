// Preferensi pemutar yang diingat antar sesi (localStorage).

export interface PlayerPrefs {
  volume: number // 0..1
  muted: boolean
  subtitleLang: string | null // lang track terpilih, null = otomatis (id → pertama)
  subsEnabled: boolean
  subSize: 'sm' | 'md' | 'lg'
  subOffsetMs: number // sinkronisasi subtitle (positif = subtitle mundur)
  subPosition: number // 0..100 — posisi vertikal dari dasar area GAMBAR video
}

const KEY = 'idlix_player_prefs'

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  volume: 1,
  muted: false,
  subtitleLang: null,
  subsEnabled: true,
  subSize: 'md',
  subOffsetMs: 0,
  subPosition: 12,
}

export function loadPlayerPrefs(): PlayerPrefs {
  if (typeof window === 'undefined') return DEFAULT_PLAYER_PREFS
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PLAYER_PREFS
    const p = JSON.parse(raw) as Partial<PlayerPrefs>
    return {
      volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : 1,
      muted: !!p.muted,
      subtitleLang: typeof p.subtitleLang === 'string' ? p.subtitleLang : null,
      subsEnabled: p.subsEnabled !== false,
      subSize: p.subSize === 'sm' || p.subSize === 'lg' ? p.subSize : 'md',
      subOffsetMs: typeof p.subOffsetMs === 'number' ? Math.max(-30000, Math.min(30000, p.subOffsetMs)) : 0,
      subPosition:
        typeof p.subPosition === 'number' ? Math.min(100, Math.max(0, Math.round(p.subPosition))) : 12,
    }
  } catch {
    return DEFAULT_PLAYER_PREFS
  }
}

export function savePlayerPrefs(p: PlayerPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // storage penuh / diblokir — abaikan
  }
}
