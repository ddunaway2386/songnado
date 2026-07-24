/**
 * Setup wizard step 3 — pick your music.
 *
 * The emotional core of setup. Big row cards, three grouped sections:
 * Included (free-tier, tappable), Pro (locked, opens UnlockPackModal),
 * Coming Soon (roadmap teases, non-tappable).
 *
 * Missing cover art gets a fallback: solid category-color square with
 * a themed emoji. Consistent look even when some packs have real album
 * covers and others don't.
 *
 * On Continue: calls the same startGame() action the old home screen
 * used, then routes to /game.
 */

import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UnlockPackModal } from '@/components/UnlockPackModal';
import { SPOTIFY_ENABLED } from '@/lib/featureFlags';
import type { Playlist } from '@/lib/types';
import { useGameStore } from '@/stores/gameStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useRemoteConfigStore } from '@/stores/remoteConfigStore';
import type { GameProvider } from '@/stores/setupStore';
import { useSetupStore } from '@/stores/setupStore';
import { isPackUnlocked, useUnlocksStore } from '@/stores/unlocksStore';
import { colors, radii } from '../../theme';

// Matches app/index.tsx isProviderInGame — Spotify-tier playlists
// (spotify + curated) share the Spotify Connect audio path; Deezer
// packs (deezer + curated-deezer) share the 30s-preview path.
function isProviderInGame(playlist: Playlist, gameProvider: GameProvider): boolean {
  if (gameProvider === 'spotify') {
    return playlist.provider === 'spotify' || playlist.provider === 'curated';
  }
  return playlist.provider === 'deezer' || playlist.provider === 'curated-deezer';
}

// ── Fallback cover visuals ─────────────────────────────────────────
interface PackVisual {
  emoji: string;
  color: string;
}
function getPackVisual(name: string): PackVisual {
  const n = name.toLowerCase();
  if (n.includes('modern movie') || n.includes('movie')) return { emoji: '🎬', color: '#B45309' };
  if (n.includes('tv theme') || n.includes('tv') || n.includes('show')) return { emoji: '📺', color: '#7C3AED' };
  if (n.includes('80')) return { emoji: '🕺', color: '#DB2777' };
  if (n.includes('90')) return { emoji: '💿', color: '#2563EB' };
  if (n.includes('70')) return { emoji: '📻', color: '#C2410C' };
  if (n.includes('2000') || n.includes("00's") || n.includes('2000s')) return { emoji: '🎧', color: '#059669' };
  if (n.includes('2010') || n.includes("10's") || n.includes('2010s')) return { emoji: '🎤', color: '#0891B2' };
  if (n.includes('2020') || n.includes("20's") || n.includes('2020s')) return { emoji: '🎵', color: '#EA580C' };
  if (n.includes('broadway') || n.includes('musical')) return { emoji: '🎭', color: '#BE185D' };
  if (n.includes('wedding')) return { emoji: '💒', color: '#4338CA' };
  if (n.includes('road')) return { emoji: '🚗', color: '#16A34A' };
  if (n.includes('billboard')) return { emoji: '📊', color: '#DC2626' };
  if (n.includes('commercial')) return { emoji: '📣', color: '#9333EA' };
  return { emoji: '🎵', color: '#4B5563' };
}

function getPackCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('modern movie')) return 'Movies · 2010+';
  if (n.includes('classic') && n.includes('movie')) return 'Movies · Classic';
  if (n.includes('movie')) return 'Movies';
  if (n.includes('modern tv')) return 'TV · 2010+';
  if (n.includes('classic') && n.includes('tv')) return 'TV · Classic';
  if (n.includes('tv')) return 'TV Themes';
  if (n.includes('broadway')) return 'Musicals';
  if (n.includes('wedding')) return 'Occasion';
  if (n.includes('road')) return 'Occasion';
  if (n.includes('billboard')) return 'Chart Hits';
  if (n.includes('commercial')) return 'Commercials';
  if (n.match(/(19|20)\d0/) || n.match(/[7-9]0'?s/) || n.match(/(00|10|20)'?s/)) return 'Decade';
  return 'Music';
}

// ── Coming Soon roadmap teases ────────────────────────────────────
interface ComingSoonPack {
  id: string;
  name: string;
  emoji: string;
  color: string;
  category: string;
}
const COMING_SOON: ComingSoonPack[] = [
  { id: 'soon-karaoke', name: 'Karaoke Classics', emoji: '🎤', color: '#DB2777', category: 'Anthems' },
  { id: 'soon-disney', name: 'Disney Hits', emoji: '🏰', color: '#3B82F6', category: 'Family' },
  { id: 'soon-christmas', name: 'Christmas Songs', emoji: '🎄', color: '#DC2626', category: 'Holiday' },
  { id: 'soon-rock', name: 'Rock Anthems', emoji: '🎸', color: '#7C3AED', category: 'Genre' },
  { id: 'soon-onehit', name: 'One Hit Wonders', emoji: '✨', color: '#F59E0B', category: 'Chart Oddities' },
  { id: 'soon-country', name: 'Country', emoji: '🤠', color: '#B45309', category: 'Genre' },
];

// ── Screen ─────────────────────────────────────────────────────────

export default function PlaylistPickerScreen() {
  const gameMode = useSetupStore((s) => s.gameMode);
  const persistedGameProvider = useSetupStore((s) => s.gameProvider);
  // Same guard as app/index.tsx: when SPOTIFY_ENABLED is false in
  // production, force the effective provider to 'deezer' regardless
  // of what setupStore has persisted from a prior dev build where
  // Spotify was on. Without this, the filter shows spotify+curated
  // (empty in production) and hides the actual Deezer packs.
  const gameProvider: GameProvider = SPOTIFY_ENABLED ? persistedGameProvider : 'deezer';
  const teamCount = useSetupStore((s) => s.teamCount);
  const teamNames = useSetupStore((s) => s.teamNames);
  const targetScore = useSetupStore((s) => s.targetScore);
  const turnStyle = useSetupStore((s) => s.turnStyle);
  const hotStreakSetting = useSetupStore((s) => s.hotStreakSetting);
  const selectedPlaylistIds = useSetupStore((s) => s.selectedPlaylistIds);
  const togglePlaylist = useSetupStore((s) => s.togglePlaylist);

  const playlists = usePlaylistStore((s) => s.playlists);
  const isPro = useUnlocksStore((s) => s.isPro);
  const unlockedPackIds = useUnlocksStore((s) => s.unlockedPackIds);
  const deezerEnabled = useRemoteConfigStore((s) => s.config.deezerEnabled);

  const startGame = useGameStore((s) => s.startGame);

  const [lockedPackToUnlock, setLockedPackToUnlock] = useState<Playlist | null>(null);

  // Same visibility rules as the old home screen: provider match +
  // kill-switch respect. Buzz mode never reaches this screen — it
  // routes to /buzz/host-lobby from step 1.
  const visiblePlaylists = playlists.filter((p) => {
    if (!isProviderInGame(p, gameProvider)) return false;
    if ((p.provider === 'deezer' || p.provider === 'curated-deezer') && !deezerEnabled) {
      return false;
    }
    return true;
  });

  const freePacks = visiblePlaylists.filter((p) => (p.tier ?? 'free') === 'free');
  const lockedPacks = visiblePlaylists.filter((p) => p.tier === 'locked');

  const canStart = selectedPlaylistIds.length > 0 && teamCount >= 1;

  function handleStart() {
    if (!canStart) return;
    startGame({
      teamNames: teamNames.slice(0, teamCount),
      selectedPlaylistIds,
      gameMode,
      targetScore,
      turnStyle,
      hotStreakSetting,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router types regenerate on next dev start
    router.push('/game' as any);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {/* Header */}
        <View style={{ marginBottom: 20 }}>
          <Text style={styles.stepChip}>Step 3 of 3</Text>
          <Text style={styles.stepHeader}>Choose your music</Text>
          <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 8 }}>
            Pick one or more packs. You can mix them.
          </Text>
        </View>

        {/* Included / Free */}
        {freePacks.length > 0 ? (
          <View style={{ marginBottom: 24 }}>
            <Text style={styles.sectionHeader}>Included</Text>
            {freePacks.map((p) => (
              <PackRow
                key={p.id}
                playlist={p}
                selected={selectedPlaylistIds.includes(p.id)}
                locked={false}
                onPress={() => togglePlaylist(p.id)}
              />
            ))}
          </View>
        ) : null}

        {/* Pro / Locked */}
        {lockedPacks.length > 0 ? (
          <View style={{ marginBottom: 24 }}>
            <Text style={styles.sectionHeader}>Pro</Text>
            {lockedPacks.map((p) => {
              const unlocked = isPackUnlocked(p, { isPro, unlockedPackIds });
              const selected = selectedPlaylistIds.includes(p.id);
              return (
                <PackRow
                  key={p.id}
                  playlist={p}
                  selected={selected}
                  locked={!unlocked}
                  onPress={() => {
                    if (unlocked) {
                      togglePlaylist(p.id);
                    } else {
                      setLockedPackToUnlock(p);
                    }
                  }}
                />
              );
            })}
          </View>
        ) : null}

        {/* Coming Soon */}
        <View style={{ marginBottom: 24 }}>
          <Text style={styles.sectionHeader}>Coming Soon</Text>
          {COMING_SOON.map((p) => (
            <ComingSoonRow key={p.id} pack={p} />
          ))}
        </View>
      </ScrollView>

      {/* Sticky start button */}
      <View
        style={{
          padding: 16,
          paddingBottom: 20,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.bg,
        }}
      >
        <Pressable
          onPress={handleStart}
          disabled={!canStart}
          style={{
            backgroundColor: canStart ? colors.primary : colors.surfaceAlt,
            padding: 18,
            borderRadius: radii.md,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              color: canStart ? '#fff' : colors.textMuted,
              fontSize: 18,
              fontWeight: '700',
            }}
          >
            {canStart
              ? `Start Game (${selectedPlaylistIds.length} pack${
                  selectedPlaylistIds.length === 1 ? '' : 's'
                })`
              : 'Pick a pack to continue'}
          </Text>
        </Pressable>
      </View>

      <UnlockPackModal
        playlist={lockedPackToUnlock}
        onClose={() => setLockedPackToUnlock(null)}
      />
    </SafeAreaView>
  );
}

// ── Row components ─────────────────────────────────────────────────

interface PackRowProps {
  playlist: Playlist;
  selected: boolean;
  locked: boolean;
  onPress: () => void;
}

function PackRow({ playlist, selected, locked, onPress }: PackRowProps) {
  const visual = getPackVisual(playlist.name);
  const category = getPackCategory(playlist.name);
  const hasCover = !!playlist.imageUrl;

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: selected ? colors.surfaceAlt : colors.surface,
        borderRadius: radii.lg,
        borderWidth: 2,
        borderColor: selected ? colors.primary : colors.border,
        padding: 12,
        marginBottom: 8,
        opacity: locked ? 0.55 : 1,
      }}
    >
      {/* Cover — real image or emoji fallback */}
      <View style={{ position: 'relative' }}>
        {hasCover ? (
          <Image
            source={{ uri: playlist.imageUrl }}
            style={{ width: 72, height: 72, borderRadius: radii.md, backgroundColor: colors.surfaceAlt }}
            contentFit="cover"
          />
        ) : (
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radii.md,
              backgroundColor: visual.color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 32 }}>{visual.emoji}</Text>
          </View>
        )}
        {locked ? (
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              borderRadius: radii.md,
              backgroundColor: 'rgba(0,0,0,0.4)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 24 }}>🔒</Text>
          </View>
        ) : null}
      </View>

      {/* Text side */}
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text
          style={{
            color: colors.textPrimary,
            fontSize: 17,
            fontWeight: '700',
          }}
          numberOfLines={1}
        >
          {playlist.name}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 2 }}>
          {playlist.totalTracks > 0 ? `${playlist.totalTracks} tracks · ` : ''}
          {category}
        </Text>
        {locked ? (
          <View
            style={{
              alignSelf: 'flex-start',
              marginTop: 6,
              backgroundColor: colors.accent,
              borderRadius: radii.full,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}
          >
            <Text
              style={{
                color: '#000',
                fontSize: 10,
                fontWeight: '800',
                letterSpacing: 1,
              }}
            >
              PRO
            </Text>
          </View>
        ) : null}
      </View>

      {/* Right side — checkmark or lock hint */}
      <View style={{ marginLeft: 10, width: 32, alignItems: 'center' }}>
        {selected ? (
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>✓</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function ComingSoonRow({ pack }: { pack: ComingSoonPack }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 12,
        marginBottom: 8,
        opacity: 0.55,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: radii.md,
          backgroundColor: pack.color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 32 }}>{pack.emoji}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={{ color: colors.textPrimary, fontSize: 17, fontWeight: '700' }}>
          {pack.name}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 2 }}>
          {pack.category}
        </Text>
        <View
          style={{
            alignSelf: 'flex-start',
            marginTop: 6,
            backgroundColor: colors.border,
            borderRadius: radii.full,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 10,
              fontWeight: '800',
              letterSpacing: 1,
            }}
          >
            SOON
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── Shared styles ──────────────────────────────────────────────────

const styles = {
  stepChip: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
    fontWeight: '600' as const,
  },
  stepHeader: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '800' as const,
    marginTop: 8,
    lineHeight: 38,
  },
  sectionHeader: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700' as const,
    marginBottom: 10,
    marginTop: 4,
  },
};
