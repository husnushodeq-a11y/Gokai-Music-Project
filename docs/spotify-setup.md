# Spotify (and Apple Music / Deezer) support

Gokai Music supports Spotify **tracks, albums and playlists** — the same way
Jockie and every other Discord music bot does: metadata comes from Spotify, but
the audio is **mirrored through YouTube** (Spotify does not license raw audio
streaming to bots). This is enabled entirely on the **Lavalink node** via the
[LavaSrc](https://github.com/topi314/LavaSrc) plugin; the bot needs no code
changes.

## Why it's server-side

Kazagumo forwards two things to Lavalink:

- **URLs** (e.g. `https://open.spotify.com/track/…`) are passed through verbatim.
  With LavaSrc installed, Lavalink recognises and resolves them.
- **Plain-text searches** are prefixed with a source id. The bot maps the guild's
  `searchtype` setting to the right prefix (`spsearch:` for Spotify) — see
  `src/audio/searchSources.ts`.

So once LavaSrc is running, Spotify links work immediately, and
`m!searchtype spotify` makes `m!play <text>` search Spotify's catalogue.

## Setup (3 steps)

### 1. Get Spotify credentials
Create a free app at <https://developer.spotify.com/dashboard> and copy the
**Client ID** and **Client Secret**.

### 2. Configure the Lavalink node
Copy [`lavalink/application.example.yml`](../lavalink/application.example.yml) to
your Lavalink server as `application.yml`, then:

- set `lavalink.server.password` to match the `auth` in the bot's
  `LAVALINK_NODES` env value,
- paste your `clientId` / `clientSecret` under `plugins.lavasrc.spotify`,
- keep the `youtube-plugin` and `lavasrc-plugin` entries (LavaSrc needs a
  provider to mirror to — YouTube here).

Restart Lavalink. On boot it downloads the plugins; the log should show LavaSrc
loading its Spotify source.

### 3. Use it
- **Links** work with no further setup:
  - `m!play https://open.spotify.com/track/...`
  - `m!play https://open.spotify.com/playlist/...`
  - `m!play https://open.spotify.com/album/...`
- **Text search via Spotify** (optional): `m!searchtype spotify`, then
  `m!play <song name>` searches Spotify.

## Apple Music / Deezer

The same plugin covers these — flip `applemusic`/`deezer` to `true` in
`application.yml`, add their credentials, and they become valid `searchtype`
values (`m!searchtype applemusic`). See the LavaSrc README for the exact tokens
each requires.

## Troubleshooting

- **"No results" for a Spotify link** → LavaSrc isn't loaded or the credentials
  are wrong. Check the Lavalink startup log for `lavasrc`.
- **Links work but text search doesn't** → run `m!searchtype spotify` (text
  search only uses Spotify when that's the configured source).
- **Everything is silent / no playable track** → the `providers` list has no
  working mirror source; ensure the `youtube-plugin` is installed and enabled.
