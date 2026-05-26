/**
 * Spotify connect UI block. Renders the right thing for every connection
 * state: disconnected (CTA), connecting (spinner), connected-Premium
 * (success), connected-Free (conversion screen), error (retry).
 *
 * Lives on the setup screen between the Teams and Playlists sections.
 * Once C.2/C.4 land, Spotify-sourced playlists will appear inside the
 * Playlists section below this component; this component itself stays
 * focused on the auth/identity side.
 */

import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { useSpotifyStore } from '@/stores/spotifyStore';

// TODO: replace with the affiliate-tagged URL once we have an Impact Radius
// account configured. Plain link works fine in the meantime.
const SPOTIFY_PREMIUM_URL = 'https://www.spotify.com/premium/';

export function SpotifySection() {
  const status = useSpotifyStore((s) => s.status);
  const profile = useSpotifyStore((s) => s.profile);
  const isPremium = useSpotifyStore((s) => s.isPremium);
  const error = useSpotifyStore((s) => s.error);
  const connect = useSpotifyStore((s) => s.connect);
  const disconnect = useSpotifyStore((s) => s.disconnect);

  function confirmDisconnect() {
    Alert.alert(
      'Disconnect Spotify?',
      'You can reconnect anytime from this screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => disconnect() },
      ]
    );
  }

  async function openPremiumUpgrade() {
    await WebBrowser.openBrowserAsync(SPOTIFY_PREMIUM_URL);
  }

  return (
    <View className="gap-2">
      <Text className="text-textMuted text-xs uppercase tracking-wider">Music source</Text>
      <View className="bg-surface rounded-md border border-border p-4 gap-3">
        {renderBody()}
      </View>
    </View>
  );

  function renderBody() {
    if (status === 'restoring' || status === 'connecting') {
      return (
        <View className="flex-row items-center gap-3 py-2">
          <ActivityIndicator />
          <Text className="text-textMuted">
            {status === 'restoring' ? 'Checking Spotify session…' : 'Connecting to Spotify…'}
          </Text>
        </View>
      );
    }

    if (status === 'connected' && profile) {
      return isPremium ? (
        <ConnectedPremium
          profile={profile}
          onDisconnect={confirmDisconnect}
        />
      ) : (
        <ConnectedFree
          profile={profile}
          onUpgrade={openPremiumUpgrade}
          onDisconnect={confirmDisconnect}
        />
      );
    }

    // idle or error
    return <Disconnected error={error} onConnect={connect} />;
  }
}

// ----------------------------------------------------------------------------
// Sub-components — kept inline for now; promote to separate files if any of
// them grows past ~50 lines or gets reused.
// ----------------------------------------------------------------------------

function Disconnected({
  error,
  onConnect,
}: {
  error: string | null;
  onConnect: () => void;
}) {
  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-textPrimary font-semibold">Use your own music</Text>
        <Text className="text-textMuted text-xs">
          Connect Spotify to play full tracks from your playlists. Free to use — your
          Spotify Premium subscription handles playback.
        </Text>
      </View>
      {error ? (
        <View className="bg-surfaceAlt rounded-md p-2">
          <Text className="text-textMuted text-xs">{error}</Text>
        </View>
      ) : null}
      <Pressable
        onPress={onConnect}
        className="bg-primary active:bg-primaryHover rounded-md px-4 py-3 items-center"
      >
        <Text className="text-textPrimary font-bold">
          {error ? 'Try again' : 'Connect Spotify'}
        </Text>
      </Pressable>
    </View>
  );
}

function ConnectedPremium({
  profile,
  onDisconnect,
}: {
  profile: { displayName: string; imageUrl: string };
  onDisconnect: () => void;
}) {
  return (
    <View className="flex-row items-center gap-3">
      {profile.imageUrl ? (
        <Image
          source={{ uri: profile.imageUrl }}
          style={{ width: 40, height: 40, borderRadius: 20 }}
          contentFit="cover"
        />
      ) : (
        <View
          style={{ width: 40, height: 40, borderRadius: 20 }}
          className="bg-surfaceAlt"
        />
      )}
      <View className="flex-1">
        <Text className="text-textPrimary font-semibold">{profile.displayName}</Text>
        <Text className="text-textMuted text-xs">Spotify Premium · Connected</Text>
      </View>
      <Pressable onPress={onDisconnect} className="px-3 py-2">
        <Text className="text-textMuted text-xs">Disconnect</Text>
      </Pressable>
    </View>
  );
}

function ConnectedFree({
  profile,
  onUpgrade,
  onDisconnect,
}: {
  profile: { displayName: string; imageUrl: string };
  onUpgrade: () => void;
  onDisconnect: () => void;
}) {
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        {profile.imageUrl ? (
          <Image
            source={{ uri: profile.imageUrl }}
            style={{ width: 40, height: 40, borderRadius: 20 }}
            contentFit="cover"
          />
        ) : (
          <View
            style={{ width: 40, height: 40, borderRadius: 20 }}
            className="bg-surfaceAlt"
          />
        )}
        <View className="flex-1">
          <Text className="text-textPrimary font-semibold">{profile.displayName}</Text>
          <Text className="text-textMuted text-xs">Spotify Free · Connected</Text>
        </View>
        <Pressable onPress={onDisconnect} className="px-3 py-2">
          <Text className="text-textMuted text-xs">Disconnect</Text>
        </Pressable>
      </View>
      <View className="bg-surfaceAlt rounded-md p-3 gap-2">
        <Text className="text-textPrimary text-sm font-semibold">
          Premium needed to play your playlists
        </Text>
        <Text className="text-textMuted text-xs">
          Spotify Free can't play specific songs on demand. You can still play with
          our demo packs below — or start a free Premium trial to unlock your own music.
        </Text>
        <Pressable
          onPress={onUpgrade}
          className="bg-primary active:bg-primaryHover rounded-md px-4 py-2 items-center mt-1"
        >
          <Text className="text-textPrimary font-bold text-sm">Start Premium trial</Text>
        </Pressable>
      </View>
    </View>
  );
}
