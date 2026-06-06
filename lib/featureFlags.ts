/**
 * Build-time feature flags.
 *
 * Driven by `EXPO_PUBLIC_*` env vars so Metro inlines them at bundle time —
 * dead-code elimination strips any disabled branches. Production App Store
 * builds ship with the defaults; personal/family dev builds override via a
 * `.env.local` (or by setting the var when launching Metro).
 *
 * ## Why this exists
 *
 * Spotify integration is permanently dev-mode-only until Songnado qualifies
 * for Extended Quota Mode (requires 250K+ MAU, registered business entity,
 * 12 months of revenue — confirmed unreachable for indie pre-launch apps
 * per Spotify's May 15 2025 policy). Rather than ship a half-broken
 * "limited beta" Spotify feature that confuses 99% of users, we hide the
 * entire Spotify code path behind this flag and ship the public App Store
 * version as Deezer-only.
 *
 * Daniel + family continue using Spotify via dev builds that set
 * `EXPO_PUBLIC_SPOTIFY_ENABLED=true` in `.env.local`. The Spotify code
 * stays in the repo, unchanged, ready to re-enable when EQM ever opens
 * (likely v2.0 launch moment with Spotify→Deezer playlist conversion as
 * the headline feature).
 */

/**
 * Master switch for Spotify functionality.
 *
 * When false (default — production builds):
 *  - Setup screen hides the "Game type" chip (Deezer is the only option)
 *  - `SpotifySection` never renders
 *  - `gameProvider` is force-set to 'deezer'
 *  - All Spotify-related UI is unreachable
 *
 * The Spotify auth, playback, and provider code stay in the bundle but
 * are never reached at runtime. Easy re-enable: flip the env var.
 */
export const SPOTIFY_ENABLED: boolean =
  process.env.EXPO_PUBLIC_SPOTIFY_ENABLED === 'true';
