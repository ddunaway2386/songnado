import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getProvider } from '@/lib/providers';
import type { PlaylistMeta } from '@/lib/types';
import { usePlaylistStore } from '@/stores/playlistStore';

const SOUNDIIZ_URL = 'https://soundiiz.com';
const CONCIERGE_EMAIL = 'ddunaay@gmail.com';

// Add-playlist is Deezer-only for now; the Spotify connect flow will be a
// separate screen in Phase D (it uses OAuth + the user's library, not a URL).
const ACTIVE_PROVIDER = getProvider('deezer');

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'preview'; meta: PlaylistMeta };

export default function AddPlaylistScreen() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const addPlaylist = usePlaylistStore((s) => s.addPlaylist);
  const playlists = usePlaylistStore((s) => s.playlists);

  async function fetchPreview() {
    try {
      const id = ACTIVE_PROVIDER.extractPlaylistId(input);
      if (playlists.some((p) => p.id === id)) {
        setStatus({ kind: 'error', message: 'This playlist is already in your list.' });
        return;
      }
      setStatus({ kind: 'loading' });
      const meta = await ACTIVE_PROVIDER.getPlaylistMeta(id);
      setStatus({ kind: 'preview', meta });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  function confirmAdd() {
    if (status.kind !== 'preview') return;
    addPlaylist(ACTIVE_PROVIDER.id, status.meta);
    router.back();
  }

  const canFetch = input.trim().length > 0 && status.kind !== 'loading';

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView contentContainerClassName="p-4 gap-4" keyboardShouldPersistTaps="handled">
          <Text className="text-textMuted">
            Paste a Deezer playlist URL or numeric ID below.
          </Text>

          <TextInput
            value={input}
            onChangeText={(v) => {
              setInput(v);
              if (status.kind === 'error' || status.kind === 'preview') {
                setStatus({ kind: 'idle' });
              }
            }}
            placeholder="deezer.com/playlist/12345…  or  12345…"
            placeholderTextColor="#6B6B78"
            autoCapitalize="none"
            autoCorrect={false}
            className="bg-surface text-textPrimary rounded-md px-3 py-3 border border-border"
          />

          <View className="flex-row gap-2">
            <Pressable
              className={`flex-1 rounded-md px-4 py-3 items-center ${
                canFetch ? 'bg-primary active:bg-primaryHover' : 'bg-surface'
              }`}
              onPress={fetchPreview}
              disabled={!canFetch}
            >
              <Text
                className={
                  canFetch ? 'text-textPrimary font-semibold' : 'text-textMuted font-semibold'
                }
              >
                {status.kind === 'loading' ? 'Loading…' : 'Fetch'}
              </Text>
            </Pressable>
            <Pressable
              className="bg-surfaceAlt active:bg-surface rounded-md px-4 py-3 items-center"
              onPress={() => router.back()}
            >
              <Text className="text-textPrimary">Cancel</Text>
            </Pressable>
          </View>

          {status.kind === 'loading' ? (
            <View className="bg-surface rounded-lg p-4 items-center">
              <ActivityIndicator />
            </View>
          ) : null}

          {status.kind === 'error' ? (
            <View className="bg-surface border border-danger rounded-lg p-4">
              <Text className="text-danger font-semibold">Couldn&apos;t load playlist</Text>
              <Text className="text-textPrimary mt-1">{status.message}</Text>
            </View>
          ) : null}

          {status.kind === 'preview' ? (
            <View className="bg-surface rounded-lg p-4 gap-3">
              {status.meta.imageUrl ? (
                <Image
                  source={{ uri: status.meta.imageUrl }}
                  style={{ width: 160, height: 160, borderRadius: 10 }}
                  contentFit="cover"
                />
              ) : null}
              <View>
                <Text className="text-textPrimary text-lg font-semibold">
                  {status.meta.name}
                </Text>
                <Text className="text-textMuted">
                  {status.meta.totalTracks} tracks · ID {status.meta.id}
                </Text>
              </View>
              <Pressable
                className="bg-success active:opacity-80 rounded-md px-4 py-3 items-center"
                onPress={confirmAdd}
              >
                <Text className="text-bg font-semibold">Add playlist</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Got a Spotify playlist? helper — points users at Soundiiz
              (the third-party tool that already has Spotify EQM access and
              can do the Spotify→Deezer conversion legitimately) or offers
              concierge help via email. Both routes work without us shipping
              the converter in v1; the in-app converter is on the v1.1
              roadmap once we've validated demand. */}
          <View className="bg-surfaceAlt rounded-lg p-4 gap-2 mt-2 border border-border">
            <Text className="text-textPrimary font-semibold">
              💡 Got a Spotify playlist?
            </Text>
            <Text className="text-textMuted text-sm">
              We can&apos;t read Spotify playlists directly yet — but here&apos;s a workaround
              that works today:
            </Text>
            <View className="gap-1 pl-2">
              <Text className="text-textMuted text-sm">
                1. Open{' '}
                <Text
                  className="text-primary underline"
                  onPress={() => void Linking.openURL(SOUNDIIZ_URL)}
                >
                  Soundiiz
                </Text>{' '}
                (free, ~60 seconds)
              </Text>
              <Text className="text-textMuted text-sm">
                2. Connect Spotify + Deezer, convert your playlist
              </Text>
              <Text className="text-textMuted text-sm">
                3. Copy the new Deezer URL, paste it above
              </Text>
            </View>

            <View className="border-t border-border my-2" />

            <Text className="text-textMuted text-sm">
              Want a hand? Send us the URL and we&apos;ll convert it for you within a few hours.
            </Text>
            <Pressable
              onPress={() =>
                void Linking.openURL(
                  `mailto:${CONCIERGE_EMAIL}?subject=${encodeURIComponent(
                    'Songnado playlist conversion'
                  )}&body=${encodeURIComponent(
                    'Hi! Could you convert this Spotify playlist for me?\n\nSpotify URL: \n\nThanks!'
                  )}`
                )
              }
              className="bg-surface active:bg-surfaceAlt rounded-md px-3 py-2 items-center self-start border border-border mt-1"
            >
              <Text className="text-primary font-semibold text-sm">
                ✉️ Email us for a free conversion
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
