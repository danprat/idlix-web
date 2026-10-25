// Hook riwayat tontonan reaktif (padanan StateFlow historyFlow).

import { useEffect, useState } from 'react'
import { removeHistoryItem, subscribeHistory } from './history'
import type { WatchHistoryItem } from './types'

export function useUnfinishedHistory(): [WatchHistoryItem[], (contentId: string) => void] {
  const [items, setItems] = useState<WatchHistoryItem[]>([])

  useEffect(() => {
    const filterUnfinished = (all: WatchHistoryItem[]) =>
      all.filter(
        (it) =>
          it.positionMs >= 10_000 &&
          (it.durationMs <= 0 || it.positionMs < it.durationMs * 0.95),
      )
    setItems(filterUnfinished(subscribeAll()))
    const unsub = subscribeHistory((all) => setItems(filterUnfinished(all)))
    const onRemove = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (id) removeHistoryItem(id)
    }
    window.addEventListener('idlix:remove-history', onRemove)
    return () => {
      unsub()
      window.removeEventListener('idlix:remove-history', onRemove)
    }
  }, [])

  return [items, removeHistoryItem]
}

function subscribeAll(): WatchHistoryItem[] {
  // Nilai awal sudah dikirim oleh subscribeHistory; ambil via trik listener sementara.
  let snapshot: WatchHistoryItem[] = []
  const unsub = subscribeHistory((items) => {
    snapshot = items
  })
  unsub()
  return snapshot
}
