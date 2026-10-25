// Port WatchHistoryStore.kt ke localStorage + subscription sederhana (paritas StateFlow).
// Semantik identik: maks 60 item, "belum selesai" = >=10 detik dan <95% durasi.

import type { WatchHistoryItem } from './types'

const LS_KEY = 'idlix_watch_history'
const MAX_ITEMS = 60

type Listener = (items: WatchHistoryItem[]) => void
const listeners = new Set<Listener>()

function readAll(): WatchHistoryItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as WatchHistoryItem[]) : []
  } catch {
    return []
  }
}

function writeAll(items: WatchHistoryItem[]) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(items))
  } catch {
    // storage penuh — abaikan
  }
  for (const l of listeners) l(items)
}

export function subscribeHistory(listener: Listener): () => void {
  listeners.add(listener)
  listener(readAll())
  return () => listeners.delete(listener)
}

export function getAllHistory(): WatchHistoryItem[] {
  return readAll()
}

export function getUnfinishedItems(): WatchHistoryItem[] {
  return readAll().filter(
    (it) => it.positionMs >= 10_000 && (it.durationMs <= 0 || it.positionMs < it.durationMs * 0.95),
  )
}

export function getSavedPositionMs(contentId: string): number {
  const item = readAll().find((it) => it.contentId === contentId)
  if (!item || item.durationMs <= 0) return 0
  // Sudah >95% selesai → mulai dari awal
  if (item.positionMs > item.durationMs * 0.95) return 0
  return item.positionMs
}

/** Progres tontonan (0..1) untuk kartu poster berdasarkan slug. */
export function findProgressBySlug(slug: string, contentType?: string): number {
  const item = readAll().find(
    (it) => it.slug === slug && (!contentType || it.contentType === contentType || (contentType === 'series' && it.contentType === 'episode')),
  )
  if (!item || item.durationMs <= 0) return 0
  if (item.positionMs < 10_000 || item.positionMs >= item.durationMs * 0.95) return 0
  return item.positionMs / item.durationMs
}

export function recordStartPlayback(item: Omit<WatchHistoryItem, 'positionMs' | 'durationMs' | 'lastWatchedTime'> & { positionMs?: number; durationMs?: number }) {
  const all = readAll()
  const existing = all.find((it) => it.contentId === item.contentId)
  const updated: WatchHistoryItem = {
    ...item,
    positionMs: item.positionMs ?? existing?.positionMs ?? 0,
    durationMs: item.durationMs ?? existing?.durationMs ?? 0,
    lastWatchedTime: Date.now(),
  }
  const rest = all.filter((it) => it.contentId !== item.contentId)
  writeAll([updated, ...rest].slice(0, MAX_ITEMS))
}

export function updateProgress(contentId: string, positionMs: number, durationMs: number) {
  const all = readAll()
  const idx = all.findIndex((it) => it.contentId === contentId)
  if (idx === -1) return
  all[idx] = { ...all[idx], positionMs, durationMs, lastWatchedTime: Date.now() }
  writeAll(all)
}

export function removeHistoryItem(contentId: string) {
  writeAll(readAll().filter((it) => it.contentId !== contentId))
}

export function clearAllHistory() {
  writeAll([])
}
