// Port of app/src/main/java/com/idlix/tv/data/model/*.kt

export interface Genre {
  id: string
  name: string
  slug: string
}

export interface CastMember {
  id: string
  name: string
  character?: string | null
  profilePath?: string | null
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface PosterMixin {
  posterPath?: string | null
  backdropPath?: string | null
}

export function fullPoster(m: PosterMixin): string {
  return m.posterPath ? `https://image.tmdb.org/t/p/w342${m.posterPath}` : ''
}

export function fullBackdrop(m: PosterMixin): string {
  return m.backdropPath ? `https://image.tmdb.org/t/p/w1280${m.backdropPath}` : ''
}

export function fullStill(path?: string | null): string {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : ''
}

export function fullProfile(path?: string | null): string {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : ''
}

export function formattedRating(voteAverage?: string | number | null): string {
  const n = typeof voteAverage === 'number' ? voteAverage : Number.parseFloat(voteAverage ?? '')
  return Number.isFinite(n) ? n.toFixed(1) : 'N/A'
}

export interface MovieItem extends PosterMixin {
  id: string
  title: string
  slug: string
  releaseDate?: string | null
  voteAverage?: string | number | null
  viewCount: number
  quality?: string | null
  country?: string | null
  runtime?: number | null
  originalLanguage?: string | null
  contentType: string // "movie" | "tv_series"
  genres: Genre[]
  hasVideo: boolean
}

export interface MovieDetail extends PosterMixin {
  id: string
  tmdbId?: number | null
  imdbId?: string | null
  title: string
  slug: string
  originalTitle?: string | null
  overview?: string | null
  tagline?: string | null
  releaseDate?: string | null
  duration?: number | null
  runtime?: number | null
  voteAverage?: string | number | null
  viewCount: number
  quality?: string | null
  country?: string | null
  genres: Genre[]
  cast: CastMember[]
  trailerUrl?: string | null
}

export interface SeriesItem extends PosterMixin {
  id: string
  title: string
  slug: string
  firstAirDate?: string | null
  voteAverage?: string | number | null
  viewCount: number
  numberOfSeasons?: number | null
  country?: string | null
  contentType: string // "tv_series"
  genres: Genre[]
  hasVideo: boolean
}

export interface Season {
  id: string
  seasonNumber: number
  name: string
  overview?: string | null
  posterPath?: string | null
  airDate?: string | null
  episodeCount: number
}

export interface EpisodeItem {
  id: string
  seasonId: string
  tvSeriesId: string
  episodeNumber: number
  name: string
  overview?: string | null
  stillPath?: string | null
  airDate?: string | null
  runtime?: number | null
  voteAverage?: string | number | null
  hasVideo: boolean
}

export interface SeasonDetail {
  id: string
  seasonNumber: number
  name: string
  overview?: string | null
  posterPath?: string | null
  episodes: EpisodeItem[]
}

export interface SeriesDetail extends PosterMixin {
  id: string
  tmdbId?: number | null
  imdbId?: string | null
  title: string
  slug: string
  originalTitle?: string | null
  overview?: string | null
  tagline?: string | null
  logoPath?: string | null
  backdrops: string[]
  firstAirDate?: string | null
  numberOfSeasons: number
  numberOfEpisodes: number
  voteAverage?: string | number | null
  viewCount: number
  country?: string | null
  status?: string | null
  genres: Genre[]
  seasons: Season[]
  cast: CastMember[]
  defaultSeason?: SeasonDetail | null
}

export interface EpisodeResponse {
  series?: SeriesDetail | null
  season?: SeasonDetail | null
  episode?: EpisodeItem | null
  allSeasons: Season[]
}

export interface ListResponse<T> {
  data: T[]
  pagination?: Pagination
}

export interface SearchResultItem extends PosterMixin {
  id: string
  contentType: string
  title: string
  originalTitle?: string | null
  overview?: string | null
  genres: string[]
  releaseDate?: string | null
  firstAirDate?: string | null
  originalLanguage?: string | null
  voteAverage?: string | number | null
  viewCount: number
  quality?: string | null
  slug: string
  numberOfSeasons?: number | null
}

export interface SearchResponse {
  results: SearchResultItem[]
  total: number
}

// ---- Watch / stream resolution flow ----

/** Search params halaman pemain /watch/$type/$id. */
export interface WatchSearchParams {
  title: string
  poster: string
  backdrop: string
  slug: string
  season: number
  episode: number
}

export interface PlayInfoResponse {
  kind: string
  gateToken: string
  serverNow: number
  unlockAt: number
  viewerTier: string
  maxHeight: number
}

export interface ClaimResponse {
  kind: string
  claim: string
  claimExpiresAt: number
  redeemUrl: string
  videoId: string
  title: string
  durationSec: number
  viewerTier: string
  maxHeight: number
  qualityLadder: number[]
}

export interface SubtitleTrack {
  lang: string
  label: string
  // URL served by this app (/api/subtitle?...) — CORS-safe & SRT-converted
  url: string
}

export interface ResolvedPlayback {
  title: string
  // URL served by this app (/api/hls?...) — token-preserving HLS proxy
  hlsMasterUrl: string
  subtitles: SubtitleTrack[]
  durationSec: number
  videoId: string
}

// ---- SubDL ----

export interface SubdlSubtitle {
  releaseName?: string | null
  name?: string | null
  lang?: string | null
  author?: string | null
  url: string
  language?: string | null
  season?: number | null
  episode?: number | null
}

// ---- Watch history (localStorage port of WatchHistoryStore.kt) ----

export interface WatchHistoryItem {
  contentId: string
  contentType: string // "movie" | "episode" | "tv_series"
  title: string
  posterUrl?: string | null
  backdropUrl?: string | null
  slug?: string | null
  episodeTitle?: string | null
  seasonNumber?: number | null
  episodeNumber?: number | null
  positionMs: number
  durationMs: number
  lastWatchedTime: number
}

export function isUnfinished(item: WatchHistoryItem): boolean {
  return (
    item.positionMs >= 10_000 &&
    (item.durationMs <= 0 || item.positionMs < item.durationMs * 0.95)
  )
}

export function progressFraction(item: WatchHistoryItem): number {
  return item.durationMs > 0 ? Math.min(1, Math.max(0, item.positionMs / item.durationMs)) : 0
}

export function remainingMinutes(item: WatchHistoryItem): number {
  return item.durationMs > item.positionMs
    ? Math.max(1, Math.round((item.durationMs - item.positionMs) / 60_000))
    : 0
}

export function resolvedHistoryThumbnail(item: WatchHistoryItem): string {
  if (item.backdropUrl) {
    return item.backdropUrl.startsWith('http')
      ? item.backdropUrl
      : `https://image.tmdb.org/t/p/w780${item.backdropUrl}`
  }
  if (item.posterUrl) {
    return item.posterUrl.startsWith('http')
      ? item.posterUrl
      : `https://image.tmdb.org/t/p/w342${item.posterUrl}`
  }
  return ''
}
