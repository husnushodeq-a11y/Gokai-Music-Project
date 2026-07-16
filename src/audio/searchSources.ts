/**
 * Search-source registry.
 *
 * Kazagumo only recognises `youtube` / `youtube_music` / `soundcloud` as first
 * class *engines*, but its `search({ source })` option lets us pass **any**
 * Lavalink search prefix. When the Lavalink node runs the **LavaSrc** plugin,
 * prefixes like `spsearch:` (Spotify), `amsearch:` (Apple Music) and `dzsearch:`
 * (Deezer) resolve too — mirroring playback through a streamable source.
 *
 * URLs never use a prefix: Kazagumo hands raw URLs straight to Lavalink, so a
 * `https://open.spotify.com/...` link is resolved by LavaSrc without any prefix.
 * This registry therefore only governs *plain-text* search routing.
 */

export interface SearchSource {
  /** The Lavalink search prefix, e.g. `spsearch:`. */
  readonly prefix: string;
  /** Human-friendly label for messages/help. */
  readonly label: string;
  /** Whether this source needs the LavaSrc plugin on the node. */
  readonly requiresLavaSrc: boolean;
}

/** All selectable search sources, keyed by the id stored in GuildSettings. */
export const SEARCH_SOURCES = {
  youtube: { prefix: 'ytsearch:', label: 'YouTube', requiresLavaSrc: false },
  youtube_music: { prefix: 'ytmsearch:', label: 'YouTube Music', requiresLavaSrc: false },
  soundcloud: { prefix: 'scsearch:', label: 'SoundCloud', requiresLavaSrc: false },
  spotify: { prefix: 'spsearch:', label: 'Spotify', requiresLavaSrc: true },
  applemusic: { prefix: 'amsearch:', label: 'Apple Music', requiresLavaSrc: true },
  deezer: { prefix: 'dzsearch:', label: 'Deezer', requiresLavaSrc: true },
} as const satisfies Record<string, SearchSource>;

/** The set of valid search-source ids (used for validation & help). */
export type SearchSourceId = keyof typeof SEARCH_SOURCES;

/** Ordered list of valid ids. */
export const SEARCH_SOURCE_IDS = Object.keys(SEARCH_SOURCES) as SearchSourceId[];

/** Type guard for an unknown string being a valid search-source id. */
export function isSearchSourceId(value: string): value is SearchSourceId {
  return value in SEARCH_SOURCES;
}

/**
 * Resolve the Lavalink search prefix for a stored `searchType`, falling back to
 * YouTube when the value is unrecognised (e.g. a source removed from config).
 */
export function searchPrefix(searchType: string): string {
  return isSearchSourceId(searchType) ? SEARCH_SOURCES[searchType].prefix : SEARCH_SOURCES.youtube.prefix;
}
