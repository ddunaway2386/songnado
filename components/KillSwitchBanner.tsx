/**
 * Kill-switch banner.
 *
 * Surfaces when remote config has flipped a service off (today: Deezer;
 * future: any other backend dependency). The message comes from
 * `runtime.json#killSwitchReason` so we can customize the user-facing
 * explanation per incident — "We're working on it, check back soon" vs
 * "Songnado is migrating audio providers and will be back this week."
 *
 * Banner renders above the Stack in `_layout.tsx`, same pattern as
 * `SpotifyWakeBanner`. It blocks no gameplay — gameStore enforces the
 * actual disable — but it tells the user what's happening so the empty
 * picker doesn't look like a bug.
 */

import { Text, View } from 'react-native';

import { useRemoteConfigStore } from '@/stores/remoteConfigStore';

export function KillSwitchBanner() {
  const config = useRemoteConfigStore((s) => s.config);

  // No banner unless Deezer is killed. (When we add Spotify reactivation
  // and a separate Spotify kill switch, the rendering logic extends here.)
  if (config.deezerEnabled) return null;

  const message =
    config.killSwitchReason.trim().length > 0
      ? config.killSwitchReason
      : 'Songnado is temporarily unavailable. Please check back soon.';

  return (
    <View className="bg-surface border-b border-danger px-4 py-3 gap-1">
      <Text className="text-danger font-semibold text-sm">
        Service notice
      </Text>
      <Text className="text-textMuted text-xs">{message}</Text>
    </View>
  );
}
