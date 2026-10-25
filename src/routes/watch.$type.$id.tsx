// Pemain — padanan PlayerScreen.kt + PlayerViewModel.kt + TvPlayerControls.kt
// + TvSubtitlePickerModal.kt + TvNextEpisodePrompt.kt dalam satu route.
//
// Alur resolve granular (paritas IdlixRepository.resolveStreamInternal):
//   play-info → countdown tersinkron server → polling claim → redeem HLS master.
//
// Fitur pemutar: indikator buffering, auto-retry error jaringan, pilihan kualitas
// & kecepatan, volume (persist), preferensi subtitle (persist) + offset ±0,5 dtk,
// PiP, dobel-klik layar penuh, toast resume, bantuan shortcut (tombol ?),
// dan modal dengan focus-trap + Esc.

import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type Hls from 'hls.js'
import { apiJson } from '../lib/settings'
import { getSavedPositionMs, recordStartPlayback, updateProgress } from '../lib/history'
import { loadPlayerPrefs, savePlayerPrefs, type PlayerPrefs } from '../lib/playerPrefs'
import {
  fullStill,
  type ClaimResponse,
  type EpisodeItem,
  type EpisodeResponse,
  type PlayInfoResponse,
  type ResolvedPlayback,
  type SeriesDetail,
  type SubdlSubtitle,
  type SubtitleTrack,
  type WatchSearchParams,
} from '../lib/types'
import {
  IconBack,
  IconCc,
  IconFullscreen,
  IconGear,
  IconHelp,
  IconNext,
  IconPause,
  IconPip,
  IconPlay,
  IconVolume,
  IconVolumeOff,
} from '../components/icons'
import { EmptyState } from '../components/feedback'

export const Route = createFileRoute('/watch/$type/$id')({
  params: { parse: (p) => ({ type: p.type, id: p.id }) },
  validateSearch: (s: Record<string, unknown>): WatchSearchParams => ({
    title: typeof s.title === 'string' ? s.title : 'IDLIX',
    poster: typeof s.poster === 'string' ? s.poster : '',
    backdrop: typeof s.backdrop === 'string' ? s.backdrop : '',
    slug: typeof s.slug === 'string' ? s.slug : '',
    season: typeof s.season === 'number' ? s.season : 0,
    episode: typeof s.episode === 'number' ? s.episode : 0,
  }),
  component: WatchScene,
})

type Phase =
  | { stage: 'resolving' }
  | { stage: 'countdown'; seconds: number }
  | { stage: 'ready'; playback: ResolvedPlayback }
  | { stage: 'error'; message: string }

interface NextEpisodeInfo {
  episode: EpisodeItem
  seasonNumber: number
  seriesTitle: string
  seriesSlug: string
  posterUrl: string
  backdropUrl: string
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Buang markup VTT (<i>, <v>, <c>, …) dan decode entitas dasar. */
function cleanCueText(raw: string): string {
  return raw
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** Modal dasar: Esc menutup, Tab terkurung di dalam (focus-trap). */
function useModalA11y(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('button, a[href], input')
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !el) return
      const focusables = Array.from(
        el.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])'),
      ).filter((n) => n.offsetParent !== null)
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
  }, [open, onClose])

  return ref
}

function WatchScene() {
  const { type, id } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>({ stage: 'resolving' })
  const [nextEpisode, setNextEpisode] = useState<NextEpisodeInfo | null>(null)
  const [nextDismissed, setNextDismissed] = useState(false)
  const [showNextPrompt, setShowNextPrompt] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)

  // Metadata tontonan untuk riwayat (paritas recordStartPlayback).
  const meta = useMemo(
    () => ({
      contentId: id,
      contentType: type,
      title: search.title,
      posterUrl: search.poster || null,
      backdropUrl: search.backdrop || null,
      slug: search.slug || null,
      seasonNumber: search.season || null,
      episodeNumber: search.episode || null,
    }),
    [id, type, search],
  )

  const resolveKey = `${type}:${id}:${search.season}:${search.episode}`

  // ---- Resolve stream (granular, dengan countdown di UI) ----
  useEffect(() => {
    let cancelled = false

    const savedPos = getSavedPositionMs(id)
    recordStartPlayback({
      ...meta,
      positionMs: savedPos,
    })

    async function resolve() {
      try {
        // Episode pertama bila diberi ID serial (paritas logika tv_series).
        let targetType = type
        let targetId = id
        if (type === 'tv_series' && search.slug) {
          const series = await apiJson<SeriesDetail>(`/api/catalog/series/${search.slug}`)
          const firstEp = series.defaultSeason?.episodes?.[0]
          if (firstEp?.id) {
            targetType = 'episode'
            targetId = firstEp.id
          } else {
            throw new Error('Tidak ada episode yang tersedia untuk serial ini.')
          }
        }

        // 0. BALAPAN: coba cache prewarm dari halaman detail dulu.
        //    /api/watch/resolve mengembalikan instan bila stream sudah pernah
        //    di-resolve (TTL 60 menit); jika belum, ia menunggu gerbang di
        //    server — jadi beri jendela 2,5 dtk saja, lalu lanjut granular.
        let settled = false
        const oneShot = apiJson<ResolvedPlayback>('/api/watch/resolve', {
          method: 'POST',
          body: JSON.stringify({
            contentType: targetType,
            contentId: targetId,
            contentTitle: search.title,
          }),
        })
          .then((pb) => {
            if (!cancelled && !settled && pb?.hlsMasterUrl) {
              settled = true
              setPhase({ stage: 'ready', playback: pb })
            }
            return pb
          })
          .catch(() => null)

        await Promise.race([oneShot, sleep(2500)])
        if (cancelled || settled) return

        // 1. Play-info (gateToken + unlockAt)
        setPhase({ stage: 'resolving' })
        const info = await apiJson<PlayInfoResponse>(
          `/api/watch/play-info/${targetType === 'episode' ? 'episode' : 'movie'}/${encodeURIComponent(targetId)}`,
        )

        // 2. Countdown tersinkron server
        const diffMs =
          info.serverNow > 0 && info.unlockAt > info.serverNow ? info.unlockAt - info.serverNow : 15_000
        let secondsLeft = Math.ceil(diffMs / 1000)
        while (secondsLeft > 1 && !cancelled) {
          setPhase({ stage: 'countdown', seconds: secondsLeft })
          await sleep(1000)
          secondsLeft--
        }

        // 3. Polling klaim sesi (15x600ms — paritas Kotlin)
        let claim: ClaimResponse | null = null
        for (let attempt = 0; attempt < 15 && !cancelled; attempt++) {
          const res = await apiJson<ClaimResponse>('/api/watch/claim', {
            method: 'POST',
            body: JSON.stringify({ gateToken: info.gateToken }),
          })
          if (res.claim) {
            claim = res
            break
          }
          await sleep(600)
        }
        if (cancelled) return
        if (!claim?.claim) throw new Error('Gagal mengklaim sesi pemutaran. Silakan coba lagi.')

        // 4. Redeem master playlist HLS (proxy token di sisi server)
        const playback = await apiJson<ResolvedPlayback>('/api/watch/redeem', {
          method: 'POST',
          body: JSON.stringify({
            claim: claim.claim,
            redeemUrl: claim.redeemUrl,
            title: search.title,
            contentType: targetType,
          }),
        })
        if (!playback.hlsMasterUrl) throw new Error('Gagal mengambil master playlist HLS.')

        if (!cancelled) {
          settled = true // cegah one-shot yang terlambat menimpa fase ready
          setPhase({ stage: 'ready', playback })
          recordStartPlayback({ ...meta, durationMs: (claim.durationSec || 0) * 1000 })
        }
      } catch (e) {
        if (!cancelled) setPhase({ stage: 'error', message: (e as Error).message || 'Gagal memutar video' })
      }
    }

    void resolve()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveKey])

  // ---- Resolve episode berikutnya (paritas resolveNextEpisode) ----
  useEffect(() => {
    if (type !== 'episode' || !search.slug) return
    let cancelled = false

    async function findNext() {
      try {
        const series = await apiJson<SeriesDetail>(`/api/catalog/series/${search.slug}`)
        const seriesTitle = series.title || search.title.split(' -')[0]
        const allSeasons =
          series.seasons.length > 0
            ? series.seasons
            : series.defaultSeason
              ? [
                  {
                    id: series.defaultSeason.id,
                    seasonNumber: series.defaultSeason.seasonNumber,
                    name: series.defaultSeason.name,
                    overview: null,
                    posterPath: null,
                    airDate: null,
                    episodeCount: series.defaultSeason.episodes.length,
                  },
                ]
              : []

        let currentSeasonNum: number | null = search.season || null
        let seasonEpisodes: EpisodeItem[] = []

        if (currentSeasonNum != null) {
          if (series.defaultSeason?.seasonNumber === currentSeasonNum) {
            seasonEpisodes = series.defaultSeason.episodes ?? []
          } else {
            const epDetail = await apiJson<EpisodeResponse>(
              `/api/catalog/series/${search.slug}/season/${currentSeasonNum}/episode/${search.episode || 1}`,
            )
            seasonEpisodes = epDetail.season?.episodes ?? []
          }
        } else if (series.defaultSeason?.episodes?.some((e) => e.id === id)) {
          currentSeasonNum = series.defaultSeason.seasonNumber
          seasonEpisodes = series.defaultSeason.episodes
        } else {
          for (const s of allSeasons) {
            const epDetail = await apiJson<EpisodeResponse>(
              `/api/catalog/series/${search.slug}/season/${s.seasonNumber}/episode/1`,
            )
            const eps = epDetail.season?.episodes ?? []
            if (eps.some((e) => e.id === id)) {
              currentSeasonNum = s.seasonNumber
              seasonEpisodes = eps
              break
            }
          }
        }

        if (seasonEpisodes.length === 0 || currentSeasonNum == null) return

        const currentIndex = seasonEpisodes.findIndex(
          (e) => e.id === id || (search.episode > 0 && e.episodeNumber === search.episode),
        )

        let nextEp: EpisodeItem | undefined
        let nextSeasonNumber = currentSeasonNum

        if (currentIndex !== -1 && currentIndex + 1 < seasonEpisodes.length) {
          nextEp = seasonEpisodes[currentIndex + 1]
        } else {
          const currentIdx = allSeasons.findIndex((s) => s.seasonNumber === currentSeasonNum)
          const nextSeason =
            (currentIdx !== -1 && allSeasons[currentIdx + 1]) ||
            allSeasons.find((s) => s.seasonNumber === currentSeasonNum + 1)
          if (nextSeason) {
            const detail = await apiJson<EpisodeResponse>(
              `/api/catalog/series/${search.slug}/season/${nextSeason.seasonNumber}/episode/1`,
            )
            nextEp = detail.episode ?? detail.season?.episodes?.[0]
            nextSeasonNumber = nextSeason.seasonNumber
          }
        }

        if (!cancelled && nextEp) {
          setNextEpisode({
            episode: nextEp,
            seasonNumber: nextSeasonNumber,
            seriesTitle,
            seriesSlug: search.slug,
            posterUrl: fullStill(nextEp.stillPath) || search.poster,
            backdropUrl: search.backdrop,
          })
        }
      } catch {
        // opsional
      }
    }

    void findNext()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveKey])

  // ---- Inisialisasi pemain + pemulihan error jaringan otomatis ----
  useEffect(() => {
    if (phase.stage !== 'ready') return
    const masterUrl = phase.playback.hlsMasterUrl
    let destroyed = false
    let retryCount = 0

    async function attach() {
      const v = videoRef.current
      if (!v) return
      const { default: HlsCtor } = await import('hls.js')
      if (destroyed) return

      if (HlsCtor.isSupported()) {
        const hls = new HlsCtor({ enableWorker: true, lowLatencyMode: false })
        hlsRef.current = hls
        hls.loadSource(masterUrl)
        hls.attachMedia(v)
        window.dispatchEvent(new CustomEvent('idlix:hls-ready'))
        hls.on(HlsCtor.Events.ERROR, (_evt, data) => {
          if (!data.fatal) return
          retryCount++
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && retryCount <= 4) {
            window.dispatchEvent(
              new CustomEvent('idlix:net-retry', { detail: retryCount }),
            )
            hls.startLoad()
          } else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && retryCount <= 4) {
            window.dispatchEvent(
              new CustomEvent('idlix:net-retry', { detail: retryCount }),
            )
            hls.recoverMediaError()
          } else if (retryCount <= 4) {
            window.dispatchEvent(new CustomEvent('idlix:net-retry', { detail: retryCount }))
            hls.stopLoad()
            hls.startLoad()
          } else {
            setPhase({ stage: 'error', message: `Kesalahan pemutar: ${data.details}` })
            hls.destroy()
          }
        })
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = masterUrl
        window.dispatchEvent(new CustomEvent('idlix:hls-ready'))
      } else {
        setPhase({ stage: 'error', message: 'Browser tidak mendukung pemutaran HLS.' })
      }
    }

    void attach()

    return () => {
      destroyed = true
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.stage === 'ready' ? phase.playback.hlsMasterUrl : ''])

  // ---- Navigasi ke episode berikutnya ----
  const goNextEpisode = useCallback(() => {
    if (!nextEpisode) return
    const next = nextEpisode
    navigate({
      to: '/watch/$type/$id',
      params: { type: 'episode', id: next.episode.id },
      search: {
        title: `${next.seriesTitle} - ${next.episode.name}`,
        poster: next.posterUrl,
        backdrop: next.backdropUrl,
        slug: next.seriesSlug,
        season: next.seasonNumber,
        episode: next.episode.episodeNumber,
      },
      replace: true,
    })
  }, [nextEpisode, navigate])

  if (phase.stage === 'error') {
    return (
      <div className="grid min-h-dvh place-items-center bg-black px-6">
        <div className="max-w-md text-center">
          <EmptyState kind="error" title="Gagal Memutar" message={phase.message} />
          <div className="mt-3 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded bg-brand px-5 py-2 text-sm font-bold hover:bg-brand-dark"
            >
              Coba Lagi
            </button>
            <button
              type="button"
              onClick={() => navigate({ to: '/' })}
              className="rounded bg-white/10 px-5 py-2 text-sm font-bold hover:bg-white/20"
            >
              Kembali ke Beranda
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-dvh bg-black">
      {phase.stage === 'ready' ? (
        <VideoStage
          videoRef={videoRef}
          hlsRef={hlsRef}
          playback={phase.playback}
          title={search.title}
          contentId={id}
          contentType={type}
          initialPositionMs={getSavedPositionMs(id)}
          nextEpisode={nextEpisode}
          nextDismissed={nextDismissed}
          showNextPrompt={showNextPrompt}
          setShowNextPrompt={setShowNextPrompt}
          setNextDismissed={setNextDismissed}
          goNextEpisode={goNextEpisode}
        />
      ) : (
        <div className="grid min-h-dvh place-items-center">
          <div className="relative flex flex-col items-center gap-5 text-center">
            {search.backdrop ? (
              <img
                src={search.backdrop}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-20 blur-sm"
              />
            ) : null}
            <div className="relative size-14 animate-spin rounded-full border-[3px] border-white/15 border-t-brand" />
            <div className="relative">
              <h1 className="text-lg font-bold">{search.title}</h1>
              {phase.stage === 'countdown' ? (
                <p className="mt-2 text-sm text-muted">
                  Menyiapkan stream…{' '}
                  <span className="font-bold text-white">{phase.seconds}</span> detik
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted animate-pulse-soft">Menyelesaikan sesi pemutaran…</p>
              )}
              {/* Pengumuman screen-reader per fase, bukan per detik */}
              <span role="status" aria-live="polite" className="sr-only">
                {phase.stage === 'countdown'
                  ? 'Menyiapkan stream, menunggu gerbang waktu server'
                  : phase.stage === 'resolving'
                    ? 'Menghubungi server streaming'
                    : ''}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ===================== Panggung video + kontrol =====================

interface VideoStageProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  hlsRef: React.RefObject<Hls | null>
  playback: ResolvedPlayback
  title: string
  contentId: string
  contentType: string
  initialPositionMs: number
  nextEpisode: NextEpisodeInfo | null
  nextDismissed: boolean
  showNextPrompt: boolean
  setShowNextPrompt: (v: boolean) => void
  setNextDismissed: (v: boolean) => void
  goNextEpisode: () => void
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const SUB_SIZES: Record<PlayerPrefs['subSize'], string> = {
  sm: 'text-[clamp(0.95rem,1.7vw,1.9rem)]',
  md: 'text-[clamp(1.15rem,2.4vw,2.75rem)]',
  lg: 'text-[clamp(1.4rem,3vw,3.4rem)]',
}

function VideoStage(props: VideoStageProps) {
  const { videoRef, hlsRef, playback, title, contentId, initialPositionMs, contentType } = props
  const router = useRouter()

  const initialPrefs = useMemo(() => loadPlayerPrefs(), [])

  const [tracks, setTracks] = useState<SubtitleTrack[]>(playback.subtitles)
  const [currentTrack, setCurrentTrack] = useState<SubtitleTrack | null>(() => {
    const subs = playback.subtitles
    if (subs.length === 0) return null
    return subs.find((t) => t.lang === initialPrefs.subtitleLang) ?? subs.find((t) => t.lang === 'id') ?? subs[0]
  })
  const [subsEnabled, setSubsEnabled] = useState(() =>
    playback.subtitles.length > 0 ? initialPrefs.subsEnabled : false,
  )
  const [subOffsetMs, setSubOffsetMs] = useState(initialPrefs.subOffsetMs)
  const [subSize, setSubSize] = useState<PlayerPrefs['subSize']>(initialPrefs.subSize)
  const [subPosition, setSubPosition] = useState(initialPrefs.subPosition)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [subdlResults, setSubdlResults] = useState<SubdlSubtitle[]>([])
  const [subdlLoading, setSubdlLoading] = useState(false)

  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [currentSec, setCurrentSec] = useState(0)
  const [durationSec, setDurationSec] = useState(0)
  const [bufferedSec, setBufferedSec] = useState(0)
  const [volume, setVolume] = useState(initialPrefs.volume)
  const [muted, setMuted] = useState(initialPrefs.muted)
  const [speed, setSpeed] = useState(1)
  const [levels, setLevels] = useState<Array<{ index: number; height: number }>>([])
  const [activeLevel, setActiveLevel] = useState(-1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [nextCountdown, setNextCountdown] = useState(10)
  const [toast, setToast] = useState<string | null>(null)

  const hideTimer = useRef<number | null>(null)
  const lastSave = useRef(0)
  const resumed = useRef(false)
  const clickTimer = useRef<number | null>(null)
  const settingsRef = useModalA11y(settingsOpen, () => setSettingsOpen(false))
  const pickerRef = useModalA11y(pickerOpen, () => setPickerOpen(false))
  const helpRef = useModalA11y(helpOpen, () => setHelpOpen(false))

  const pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document

  // Toast notifikasi (resume / retry jaringan)
  useEffect(() => {
    const showToast = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setToast(`Jaringan tersendat — menyambung ulang (percobaan ${detail})`)
      window.setTimeout(() => setToast(null), 2500)
    }
    window.addEventListener('idlix:net-retry', showToast)
    return () => window.removeEventListener('idlix:net-retry', showToast)
  }, [])

  const showToastMsg = useCallback((msg: string, ms = 3200) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), ms)
  }, [])

  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 3000)
  }, [])

  // Simpan preferensi pemutar setiap berubah
  useEffect(() => {
    savePlayerPrefs({
      volume,
      muted,
      subtitleLang: currentTrack?.lang ?? null,
      subsEnabled,
      subSize,
      subOffsetMs,
      subPosition,
    })
  }, [volume, muted, currentTrack, subsEnabled, subSize, subOffsetMs, subPosition])

  // Area GAMBAR video yang sebenarnya (letterbox-aware): subtitle di-anchor
  // ke sini, bukan ke layar — di mobile portrait video jadi band kecil di
  // tengah, patokan layar membuat subtitle terpisah jauh dari gambar.
  const [picRect, setPicRect] = useState({ bottom: 0, height: 1 })
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const recompute = () => {
      const v = videoRef.current
      const root = rootRef.current
      if (!v || !root || !v.videoWidth || !v.videoHeight) return
      const cw = root.clientWidth
      const ch = root.clientHeight
      const ar = v.videoWidth / v.videoHeight
      let h = cw / ar
      if (h > ch) h = ch
      setPicRect({ bottom: (ch - h) / 2, height: h })
    }
    const v = videoRef.current
    v?.addEventListener('loadedmetadata', recompute)
    window.addEventListener('resize', recompute)
    document.addEventListener('fullscreenchange', recompute)
    recompute()
    return () => {
      v?.removeEventListener('loadedmetadata', recompute)
      window.removeEventListener('resize', recompute)
      document.removeEventListener('fullscreenchange', recompute)
    }
  }, [videoRef])

  // Terapkan track aktif pada elemen <track>.
  // Mode 'hidden': cue dimuat tapi TIDAK dirender native — dirender overlay sendiri.
  const applyTrack = useCallback(
    (track: SubtitleTrack | null, enabled: boolean) => {
      const v = videoRef.current
      if (!v) return
      for (let i = 0; i < v.textTracks.length; i++) {
        const tt = v.textTracks[i]
        tt.mode = track && tt.label === track.label && enabled ? 'hidden' : 'disabled'
      }
    },
    [videoRef],
  )

  useEffect(() => {
    applyTrack(currentTrack, subsEnabled)
  }, [currentTrack, subsEnabled, applyTrack, tracks])

  // Baca cue aktif (dengan offset sinkronisasi) → overlay subtitle
  const [cueText, setCueText] = useState('')

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const readCues = () => {
      if (!subsEnabled || !currentTrack) {
        setCueText('')
        return
      }
      for (let i = 0; i < v.textTracks.length; i++) {
        const t = v.textTracks[i]
        if (t.label === currentTrack.label && t.cues) {
          const now = v.currentTime + subOffsetMs / 1000
          const parts: string[] = []
          for (let c = 0; c < t.cues.length; c++) {
            const cue = t.cues[c] as VTTCue
            if (cue.startTime <= now && now <= cue.endTime) parts.push(cue.text ?? '')
          }
          setCueText(parts.length ? cleanCueText(parts.join('\n')) : '')
          return
        }
      }
      setCueText('')
    }

    v.addEventListener('timeupdate', readCues)
    v.textTracks.addEventListener('cuechange', readCues)
    return () => {
      v.removeEventListener('timeupdate', readCues)
      v.textTracks.removeEventListener('cuechange', readCues)
    }
  }, [currentTrack, subsEnabled, subOffsetMs, videoRef])

  // Event video: resume, progres, buffering, volume, level aktif
  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    const onLoaded = () => {
      setDurationSec(v.duration || 0)
      v.volume = volume
      v.muted = muted
      v.playbackRate = speed
      if (!resumed.current && initialPositionMs > 3000 && v.currentTime < 1) {
        v.currentTime = initialPositionMs / 1000
        showToastMsg(`Melanjutkan dari ${fmtTime(initialPositionMs / 1000)}`)
      }
      resumed.current = true
      void v.play().catch(() => setPlaying(false))
    }
    const onTime = () => {
      setCurrentSec(v.currentTime)
      if (v.buffered.length > 0) {
        setBufferedSec(v.buffered.end(v.buffered.length - 1))
      }
      if (v.duration > 0 && Date.now() - lastSave.current > 5000) {
        lastSave.current = Date.now()
        updateProgress(contentId, Math.floor(v.currentTime * 1000), Math.floor(v.duration * 1000))
      }
    }
    const onEnded = () => {
      if (v.duration > 0) updateProgress(contentId, Math.floor(v.duration * 1000), Math.floor(v.duration * 1000))
      if (props.nextEpisode && !props.nextDismissed) props.goNextEpisode()
    }
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => setBuffering(false)
    const onVolume = () => {
      setVolume(v.volume)
      setMuted(v.muted)
    }

    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', () => setPlaying(true))
    v.addEventListener('pause', () => setPlaying(false))
    v.addEventListener('playing', onPlaying)
    v.addEventListener('canplay', onPlaying)
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('stalled', onWaiting)
    v.addEventListener('volumechange', onVolume)
    v.addEventListener('ended', onEnded)
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('playing', onPlaying)
      v.removeEventListener('canplay', onPlaying)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('stalled', onWaiting)
      v.removeEventListener('volumechange', onVolume)
      v.removeEventListener('ended', onEnded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId, initialPositionMs])

  // Daftar level kualitas dari hls.js
  useEffect(() => {
    const onReady = async () => {
      const hls = hlsRef.current
      if (!hls) return
      const { default: HlsCtor } = await import('hls.js')
      const onLevels = () => {
        setLevels(
          (hls.levels ?? [])
            .map((l, i) => ({ index: i, height: l.height || 0 }))
            .filter((l) => l.height > 0)
            .sort((a, b) => b.height - a.height),
        )
      }
      const onLevelSwitch = (_e: unknown, data: { level: number }) => setActiveLevel(data.level)
      hls.on(HlsCtor.Events.MANIFEST_PARSED, onLevels)
      hls.on(HlsCtor.Events.LEVEL_SWITCHED, onLevelSwitch)
      onLevels()
    }
    window.addEventListener('idlix:hls-ready', onReady, { once: true })
    return () => window.removeEventListener('idlix:hls-ready', onReady)
  }, [hlsRef])

  // Prompt episode berikutnya saat sisa < 45 detik
  useEffect(() => {
    if (!props.nextEpisode || props.nextDismissed || durationSec <= 0) return
    const remaining = durationSec - currentSec
    if (remaining > 0 && remaining <= 45) {
      props.setShowNextPrompt(true)
    }
  }, [currentSec, durationSec, props])

  // Hitung mundur prompt 10 detik → putar otomatis
  useEffect(() => {
    if (!props.showNextPrompt || !props.nextEpisode || props.nextDismissed) return
    if (nextCountdown <= 0) {
      props.goNextEpisode()
      return
    }
    const t = window.setTimeout(() => setNextCountdown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [props.showNextPrompt, nextCountdown, props])

  // Keyboard: lewati bila fokus di kontrol form (hindari dobel-seek di slider)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const inFormControl = !!el && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(el.tagName)
      const v = videoRef.current
      showControls()

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        setHelpOpen((o) => !o)
        return
      }
      if (inFormControl) return

      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        if (v) {
          if (v.paused) void v.play().catch(() => {})
          else v.pause()
        }
      } else if (e.key === 'ArrowRight' && v) {
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 10)
      } else if (e.key === 'ArrowLeft' && v) {
        v.currentTime = Math.max(0, v.currentTime - 10)
      } else if (e.key === 'f') {
        toggleFullscreen()
      } else if (e.key === 'm' && v) {
        v.muted = !v.muted
      } else if (e.key === 's' || e.key === 'c') {
        setPickerOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showControls, videoRef])

  const searchSubdl = async () => {
    setSubdlLoading(true)
    try {
      const res = await apiJson<{ subtitles: SubdlSubtitle[] }>(
        `/api/subdl/search?title=${encodeURIComponent(title.split(' - ')[0])}&type=${contentType === 'episode' ? 'tv' : 'movie'}`,
      )
      setSubdlResults(res.subtitles ?? [])
    } catch {
      setSubdlResults([])
    } finally {
      setSubdlLoading(false)
    }
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }

  const seek = (val: number) => {
    const v = videoRef.current
    if (v) v.currentTime = val
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }

  const togglePip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch {
      showToastMsg('Picture-in-Picture tidak tersedia')
    }
  }

  const setQuality = (index: number) => {
    const hls = hlsRef.current
    if (!hls) return
    hls.currentLevel = index
    setActiveLevel(index)
    setSettingsOpen(false)
    showToastMsg(index === -1 ? 'Kualitas: Otomatis' : `Kualitas: ${levels.find((l) => l.index === index)?.height}p`)
  }

  const applySpeed = (s: number) => {
    const v = videoRef.current
    setSpeed(s)
    if (v) v.playbackRate = s
    setSettingsOpen(false)
    showToastMsg(s === 1 ? 'Kecepatan: Normal' : `Kecepatan: ${String(s).replace('.', ',')}×`)
  }

  const changeVolume = (val: number) => {
    const v = videoRef.current
    setVolume(val)
    if (v) {
      v.volume = val
      if (val > 0 && v.muted) {
        v.muted = false
        setMuted(false)
      }
    }
  }

  const goBack = () => {
    if (window.history.length > 1) router.history.back()
    else void router.navigate({ to: '/' })
  }

  // Klik tunggal = putar/jeda; dobel-klik = layar penuh (dibedakan dengan timer)
  const onVideoClick = () => {
    showControls()
    if (clickTimer.current) return
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null
      togglePlay()
    }, 260)
  }
  const onVideoDblClick = () => {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    toggleFullscreen()
  }

  const progressPct = durationSec > 0 ? (currentSec / durationSec) * 100 : 0
  const bufferedPct = durationSec > 0 ? (bufferedSec / durationSec) * 100 : 0

  return (
    <div
      ref={rootRef}
      className={`relative h-dvh overflow-hidden bg-black select-none ${controlsVisible ? '' : 'cursor-none'}`}
      onMouseMove={showControls}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        playsInline
        onClick={onVideoClick}
        onDoubleClick={onVideoDblClick}
        crossOrigin="anonymous"
      >
        {tracks.map((t) => (
          <track
            key={t.url}
            kind="subtitles"
            src={t.url}
            srcLang={t.lang}
            label={t.label}
          />
        ))}
      </video>

      {/* Indikator buffering di tengah */}
      {buffering && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="size-12 animate-spin rounded-full border-[3px] border-white/20 border-t-white/90" />
        </div>
      )}

      {/* Toast (resume / info) */}
      {toast && (
        <div className="pointer-events-none absolute top-16 left-1/2 z-30 -translate-x-1/2 animate-fade-in rounded-full bg-black/80 px-4 py-2 text-sm font-medium backdrop-blur">
          {toast}
        </div>
      )}

      {/* Overlay subtitle kustom — di-anchor ke area GAMBAR video (letterbox-aware),
          posisi vertikal bisa diatur dari picker subtitle (subPosition % dari dasar gambar) */}
      {subsEnabled && cueText && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-8"
          style={{ bottom: Math.max(8, picRect.bottom + picRect.height * (subPosition / 100)) }}
        >
          <p
            className={`max-w-[85%] rounded-md bg-black/70 px-4 py-1.5 text-center leading-snug font-medium whitespace-pre-line text-balance text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.9)] ${SUB_SIZES[subSize]}`}
          >
            {cueText}
          </p>
        </div>
      )}

      {/* Kontrol atas */}
      <div
        className={`absolute inset-x-0 top-0 flex items-center gap-4 bg-gradient-to-b from-black/80 to-transparent p-4 transition-opacity ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <button
          type="button"
          onClick={goBack}
          aria-label="Kembali"
          className="grid size-10 place-items-center rounded-full bg-black/50 transition hover:bg-black/70"
        >
          <IconBack className="size-5" />
        </button>
        <h1 className="truncate text-sm font-bold sm:text-base">{title}</h1>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label="Bantuan shortcut keyboard"
          className="ml-auto grid size-10 place-items-center rounded-full bg-black/50 transition hover:bg-black/70"
        >
          <IconHelp className="size-5" />
        </button>
      </div>

      {/* Kontrol bawah */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pt-12 pb-3 transition-opacity sm:px-6 ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* Bar progres: satu bar visual + input seret transparan */}
        <div className="group/bar relative h-5 w-full">
          <div className="pointer-events-none absolute top-1/2 left-0 h-[5px] w-full -translate-y-1/2 overflow-hidden rounded-full bg-white/20">
            <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${bufferedPct}%` }} />
          </div>
          <div
            className="pointer-events-none absolute top-1/2 left-0 h-[5px] -translate-y-1/2 rounded-full bg-brand"
            style={{ width: `${progressPct}%` }}
          />
          <div
            className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow ring-white/20 transition-transform group-hover/bar:scale-125"
            style={{ left: `${progressPct}%` }}
          />
          <input
            type="range"
            min={0}
            max={durationSec || 0}
            step={0.5}
            value={Math.min(currentSec, durationSec || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Geser posisi pemutaran"
            aria-valuetext={fmtTime(currentSec)}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
          />
        </div>

        <div className="mt-1 flex items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Jeda' : 'Putar'}
            className="grid size-10 place-items-center rounded-full transition hover:bg-white/10 hover:text-white/85"
          >
            {playing ? <IconPause className="size-6" /> : <IconPlay className="size-6" />}
          </button>

          {/* Volume: tombol + slider muncul saat hover */}
          <div className="group/vol relative flex items-center">
            <button
              type="button"
              aria-label={muted || volume === 0 ? 'Bunyikan' : 'Bisukan'}
              onClick={() => {
                const v = videoRef.current
                if (v) {
                  v.muted = !v.muted
                  setMuted(v.muted)
                }
              }}
              className="grid size-10 place-items-center rounded-full transition hover:bg-white/10 hover:text-white/85"
            >
              {muted || volume === 0 ? <IconVolumeOff className="size-6" /> : <IconVolume className="size-6" />}
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 rounded-full bg-card/95 p-2 opacity-0 shadow-lg backdrop-blur transition-opacity group-hover/vol:pointer-events-auto group-hover/vol:opacity-100">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-white/25 accent-brand"
              />
            </div>
          </div>

          <span className="text-sm font-medium whitespace-nowrap tabular-nums text-white/90">
            {fmtTime(currentSec)} <span className="text-white/45">/ {fmtTime(durationSec)}</span>
          </span>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {props.nextEpisode && (
              <button
                type="button"
                onClick={props.goNextEpisode}
                aria-label="Putar episode berikutnya"
                className="grid size-10 place-items-center rounded-full transition hover:bg-white/10 hover:text-white/85"
              >
                <IconNext className="size-6" />
              </button>
            )}

            {/* Pengaturan: kualitas + kecepatan */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setSettingsOpen((o) => !o)}
                aria-label="Pengaturan kualitas dan kecepatan"
                aria-expanded={settingsOpen}
                className="grid size-10 place-items-center rounded-full transition hover:bg-white/10 hover:text-white/85"
              >
                <IconGear className="size-6" />
              </button>

              {settingsOpen && (
                <div
                  ref={settingsRef}
                  data-modal-open=""
                  className="absolute right-0 bottom-full mb-3 w-56 animate-fade-in rounded-xl border border-white/10 bg-card/95 p-3 shadow-2xl backdrop-blur"
                >
                  <p className="mb-2 text-[11px] font-bold tracking-wide text-muted uppercase">Kualitas</p>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setQuality(-1)}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                        activeLevel === -1 || !levels.some((l) => l.index === activeLevel)
                          ? 'bg-white text-black'
                          : 'bg-white/10 hover:bg-white/20'
                      }`}
                    >
                      Auto
                    </button>
                    {levels.map((l) => (
                      <button
                        key={l.index}
                        type="button"
                        onClick={() => setQuality(l.index)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                          activeLevel === l.index ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20'
                        }`}
                      >
                        {l.height}p
                      </button>
                    ))}
                    {levels.length === 0 && <span className="text-xs text-muted">Otomatis</span>}
                  </div>

                  <p className="mb-2 text-[11px] font-bold tracking-wide text-muted uppercase">Kecepatan</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => applySpeed(s)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                          speed === s ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20'
                        }`}
                      >
                        {s === 1 ? 'Normal' : `${String(s).replace('.', ',')}×`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setPickerOpen((o) => !o)
                if (!pickerOpen && subdlResults.length === 0) void searchSubdl()
              }}
              aria-label="Pilih subtitle"
              className={`grid size-10 place-items-center rounded-full transition hover:bg-white/10 hover:text-white/85 ${
                subsEnabled ? 'text-brand' : ''
              }`}
            >
              <IconCc className="size-6" />
            </button>

            {pipSupported && (
              <button
                type="button"
                onClick={togglePip}
                aria-label="Picture-in-Picture"
                className="grid size-10 place-items-center rounded-full transition hover:bg-white/10 hover:text-white/85"
              >
                <IconPip className="size-6" />
              </button>
            )}

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="Layar penuh"
              className="grid size-10 place-items-center rounded-full transition hover:bg-white/10 hover:text-white/85"
            >
              <IconFullscreen className="size-6" />
            </button>
          </div>
        </div>
      </div>

      {/* Prompt episode berikutnya */}
      {props.showNextPrompt && props.nextEpisode && !props.nextDismissed && (
        <div className="absolute right-4 bottom-24 z-20 w-80 animate-fade-in overflow-hidden rounded-xl border border-white/10 bg-card/95 shadow-2xl backdrop-blur">
          <div className="flex gap-3 p-3">
            <div className="aspect-video w-32 shrink-0 overflow-hidden rounded bg-card-2">
              {props.nextEpisode.posterUrl ? (
                <img src={props.nextEpisode.posterUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-muted/40">🎬</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-muted">
                Episode berikutnya dalam {nextCountdown}s
              </p>
              <p className="mt-0.5 line-clamp-1 text-sm font-bold">
                S{props.nextEpisode.seasonNumber} E{props.nextEpisode.episode.episodeNumber} ·{' '}
                {props.nextEpisode.episode.name}
              </p>
              {props.nextEpisode.episode.overview && (
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">
                  {props.nextEpisode.episode.overview}
                </p>
              )}
            </div>
          </div>
          <div className="flex border-t border-white/10">
            <button
              type="button"
              onClick={props.goNextEpisode}
              className="flex-1 bg-white py-2.5 text-xs font-bold text-black transition hover:bg-white/85"
            >
              Putar Sekarang
            </button>
            <button
              type="button"
              onClick={() => {
                props.setNextDismissed(true)
                props.setShowNextPrompt(false)
              }}
              className="flex-1 py-2.5 text-xs font-bold text-white/75 transition hover:text-white"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Modal pemilih subtitle */}
      {pickerOpen && (
        <div
          className="absolute inset-0 z-30 grid place-items-center bg-black/70"
          onClick={() => setPickerOpen(false)}
        >
          <div
            ref={pickerRef}
            data-modal-open=""
            role="dialog"
            aria-label="Pilih subtitle"
            className="max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/10 bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-base font-bold">Subtitle</h2>

            <button
              type="button"
              onClick={() => {
                setSubsEnabled(false)
                setCurrentTrack(null)
              }}
              className={`mb-1 w-full rounded-lg px-4 py-3 text-left text-sm transition ${
                !subsEnabled ? 'bg-white/15 font-bold' : 'bg-white/5 text-white/80 hover:bg-white/10'
              }`}
            >
              Matikan subtitle
            </button>

            {tracks.map((t) => (
              <button
                key={t.url}
                type="button"
                onClick={() => {
                  setCurrentTrack(t)
                  setSubsEnabled(true)
                  setPickerOpen(false)
                }}
                className={`mb-1 w-full rounded-lg px-4 py-3 text-left text-sm transition ${
                  subsEnabled && currentTrack?.url === t.url
                    ? 'bg-white/15 font-bold'
                    : 'bg-white/5 text-white/80 hover:bg-white/10'
                }`}
              >
                {t.label}
              </button>
            ))}

            {/* Sinkronisasi & ukuran */}
            <div className="mt-4 rounded-lg bg-white/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted">Sinkronisasi</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSubOffsetMs((o) => Math.max(-30000, o - 500))}
                    aria-label="Subtitle mundur 0,5 detik"
                    className="rounded bg-white/10 px-2.5 py-1 text-xs font-bold hover:bg-white/20"
                  >
                    −0,5s
                  </button>
                  <span className="w-14 text-center text-xs font-semibold tabular-nums">
                    {(subOffsetMs / 1000).toFixed(1)}s
                  </span>
                  <button
                    type="button"
                    onClick={() => setSubOffsetMs((o) => Math.min(30000, o + 500))}
                    aria-label="Subtitle maju 0,5 detik"
                    className="rounded bg-white/10 px-2.5 py-1 text-xs font-bold hover:bg-white/20"
                  >
                    +0,5s
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted">Ukuran</span>
                <div className="flex gap-1.5">
                  {(['sm', 'md', 'lg'] as const).map((s, i) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSubSize(s)}
                      className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                        subSize === s ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20'
                      }`}
                    >
                      {['S', 'M', 'L'][i]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="shrink-0 text-xs font-semibold text-muted">Posisi</span>
                <div className="flex flex-1 items-center gap-2">
                  <span className="text-[10px] text-muted">bawah</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={2}
                    value={subPosition}
                    onChange={(e) => setSubPosition(Number(e.target.value))}
                    aria-label="Posisi vertikal subtitle"
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/25 accent-brand"
                  />
                  <span className="text-[10px] text-muted">atas</span>
                  <span className="w-10 text-right text-xs font-semibold tabular-nums">
                    {subPosition}%
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-5 border-t border-white/10 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold">Alternatif dari SubDL</h3>
                <button
                  type="button"
                  onClick={() => void searchSubdl()}
                  className="rounded bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
                >
                  {subdlLoading ? 'Mencari…' : 'Cari ulang'}
                </button>
              </div>

              {subdlLoading && <p className="py-4 text-center text-xs text-muted">Mencari subtitle…</p>}
              {!subdlLoading && subdlResults.length === 0 && (
                <p className="py-4 text-center text-xs text-muted">Tidak ada hasil SubDL.</p>
              )}
              {subdlResults.slice(0, 12).map((sub, i) => {
                const isIndo = sub.language?.toLowerCase() === 'id' || sub.lang?.toLowerCase() === 'indonesian'
                const track: SubtitleTrack = {
                  lang: isIndo ? 'id' : (sub.language?.toLowerCase() ?? 'en'),
                  label: `${isIndo ? 'Indonesian' : 'English'} [SubDL]${sub.author ? ` (${sub.author})` : ''} — ${sub.releaseName ?? sub.name ?? ''}`,
                  url: `/api/subdl/subtitle?url=${encodeURIComponent(
                    sub.url.startsWith('http') ? sub.url : `https://dl.subdl.com${sub.url}`,
                  )}`,
                }
                return (
                  <button
                    key={`${sub.url}-${i}`}
                    type="button"
                    onClick={() => {
                      setTracks((prev) => [track, ...prev.filter((t) => t.url !== track.url)])
                      setCurrentTrack(track)
                      setSubsEnabled(true)
                      setPickerOpen(false)
                    }}
                    className="mb-1 w-full rounded-lg bg-white/5 px-4 py-2.5 text-left text-xs text-white/80 transition hover:bg-white/10"
                  >
                    <span className={`mr-2 font-bold ${isIndo ? 'text-brand' : 'text-white/60'}`}>
                      {sub.language ?? sub.lang ?? '??'}
                    </span>
                    {sub.releaseName ?? sub.name ?? 'subtitle'}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bantuan shortcut */}
      {helpOpen && (
        <div
          className="absolute inset-0 z-30 grid place-items-center bg-black/70"
          onClick={() => setHelpOpen(false)}
        >
          <div
            ref={helpRef}
            data-modal-open=""
            role="dialog"
            aria-label="Bantuan shortcut keyboard"
            className="w-full max-w-sm rounded-xl border border-white/10 bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-base font-bold">Shortcut Keyboard</h2>
            <dl className="space-y-2.5 text-sm">
              {[
                ['Spasi / K', 'Putar / jeda'],
                ['← / →', 'Mundur / maju 10 detik'],
                ['F', 'Layar penuh'],
                ['M', 'Bisukan'],
                ['S / C', 'Pilih subtitle'],
                ['?', 'Bantuan ini'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <dt>
                    <kbd className="rounded border border-white/20 bg-white/10 px-2 py-0.5 font-mono text-xs">
                      {key}
                    </kbd>
                  </dt>
                  <dd className="text-white/80">{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}
