import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
        <ScrollView contentContainerClassName="p-4 gap-3" keyboardShouldPersistTaps="handled">
          <Text className="text-textMuted">
            Paste a Deezer playlist URL or numeric ID. To make one:
            build it in Spotify → copy to Deezer → share → copy link → paste here.
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
