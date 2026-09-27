/**
 * The "here's the song" card — album art, title, artist, and the
 * movie/show/musical it came from.
 *
 * Extracted from app/game.tsx so buzz mode shows the same thing. Buzz used
 * to render bare text with no artwork, and dropped the `source` line during
 * play entirely — which mattered most for exactly the packs where the source
 * IS the answer (Movie Soundtracks, TV Themes, Broadway).
 *
 * Three sizes, because the same information appears in very different slots:
 *  - `full`    — the reveal. Big art, the moment the round pays off.
 *  - `compact` — the host judging a buzz. Needs to be readable at a glance
 *                while someone is talking at them.
 *  - `peek`    — the host's opt-in glance during playback, deliberately
 *                small so it doesn't dominate a phone lying face-up.
 *
 * `tone="onColor"` renders white text for placement on a colored banner
 * (buzz's status bar); the default uses theme colors on a surface.
 */

import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { colors } from '../theme';

export type RevealCardSize = 'full' | 'compact' | 'peek';

const ART: Record<RevealCardSize, number> = {
  full: 200,
  compact: 96,
  peek: 56,
};

const TITLE_SIZE: Record<RevealCardSize, number> = {
  full: 20,
  compact: 18,
  peek: 15,
};

const ARTIST_SIZE: Record<RevealCardSize, number> = {
  full: 15,
  compact: 14,
  peek: 12,
};

export interface SongRevealCardProps {
  title: string;
  artist: string;
  /** Movie / show / musical / brand, when the pack has one. */
  source?: string | null;
  coverUrl?: string | null;
  size?: RevealCardSize;
  /** White text for colored banners; theme colors otherwise. */
  tone?: 'default' | 'onColor';
  /** Small caps label above the title, e.g. "ANSWER". */
  label?: string;
}

export function SongRevealCard({
  title,
  artist,
  source,
  coverUrl,
  size = 'full',
  tone = 'default',
  label,
}: SongRevealCardProps) {
  const art = ART[size];
  const onColor = tone === 'onColor';

  // Every colour is explicit.
  //
  // This used to set colour through NativeWind classes and pass
  // `style={{ color: undefined }}` for the default tone. NativeWind v4
  // compiles className INTO the style prop, so an explicit undefined in the
  // inline style won the merge and the text fell back to React Native's
  // default black — on a #00031C background. The song title and artist are
  // what the host judges the answer against, so they were invisible in
  // exactly the moment they matter most.
  const titleColor = onColor ? '#fff' : colors.textPrimary;
  const artistColor = onColor ? 'rgba(255,255,255,0.85)' : colors.textMuted;
  const labelColor = onColor ? 'rgba(255,255,255,0.8)' : colors.textMuted;
  const sourceColor = onColor ? '#fff' : colors.primary;
  const sourceBg = onColor ? 'rgba(255,255,255,0.18)' : 'rgba(59,130,246,0.15)';

  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      {label ? (
        <Text
          style={{
            fontSize: 11,
            letterSpacing: 1,
            color: labelColor,
          }}
        >
          {label}
        </Text>
      ) : null}

      {coverUrl ? (
        <Image
          source={{ uri: coverUrl }}
          style={{ width: art, height: art, borderRadius: size === 'full' ? 12 : 8 }}
          contentFit="cover"
          transition={150}
        />
      ) : null}

      <View style={{ alignItems: 'center' }}>
        <Text
          style={{
            fontSize: TITLE_SIZE[size],
            fontWeight: '700',
            textAlign: 'center',
            color: titleColor,
          }}
          numberOfLines={2}
        >
          {title}
        </Text>
        <Text
          style={{
            fontSize: ARTIST_SIZE[size],
            textAlign: 'center',
            color: artistColor,
          }}
          numberOfLines={1}
        >
          {artist}
        </Text>

        {source ? (
          <View
            style={{
              marginTop: 8,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 6,
              backgroundColor: sourceBg,
            }}
          >
            <Text
              style={{
                fontSize: size === 'peek' ? 10 : 12,
                fontWeight: '600',
                color: sourceColor,
              }}
            >
              from {source}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
