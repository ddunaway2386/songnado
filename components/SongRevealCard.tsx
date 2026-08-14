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

  const titleColor = onColor ? '#fff' : undefined;
  const artistColor = onColor ? 'rgba(255,255,255,0.85)' : undefined;

  return (
    <View className="items-center gap-2">
      {label ? (
        <Text
          className={onColor ? '' : 'text-textMuted'}
          style={{
            fontSize: 11,
            letterSpacing: 1,
            color: onColor ? 'rgba(255,255,255,0.8)' : undefined,
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

      <View className="items-center">
        <Text
          className={onColor ? 'font-bold text-center' : 'text-textPrimary font-bold text-center'}
          style={{ fontSize: TITLE_SIZE[size], color: titleColor }}
          numberOfLines={2}
        >
          {title}
        </Text>
        <Text
          className={onColor ? 'text-center' : 'text-textMuted text-center'}
          style={{ fontSize: ARTIST_SIZE[size], color: artistColor }}
          numberOfLines={1}
        >
          {artist}
        </Text>

        {source ? (
          <View
            className={onColor ? 'mt-2 px-2.5 py-1 rounded-md' : 'mt-2 px-2.5 py-1 bg-primary/15 rounded-md'}
            style={onColor ? { backgroundColor: 'rgba(255,255,255,0.18)' } : undefined}
          >
            <Text
              className={onColor ? 'font-semibold' : 'text-primary font-semibold'}
              style={{ fontSize: size === 'peek' ? 10 : 12, color: onColor ? '#fff' : undefined }}
            >
              from {source}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
