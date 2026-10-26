/**
 * Connect Apple Music — the step between New Game and setup on Apple Music
 * builds (the v1.0 App Store catalogue).
 *
 * The first time, it explains why Songnado wants Apple Music before iOS shows
 * its permission prompt; Apple's guidance is to give that context first, and
 * a cold system prompt on tapping New Game reads as a surprise. After that it
 * checks silently and moves straight on, so returning players only see a
 * spinner for a moment.
 *
 * Every dead end has a way out: declined access points at Settings, a missing
 * subscription or unaccepted Apple Music terms point at the Music app, and
 * all of them can try again.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { requestAppleMusicAccess, type AppleMusicAccess } from '@/lib/appleMusic';
import { colors, radii } from '../theme';

const ASKED_KEY = 'songnado.appleMusicAsked';

type Screen = { kind: 'checking' } | { kind: 'intro' } | AppleMusicAccess;

export default function ConnectAppleMusic() {
  const [screen, setScreen] = useState<Screen>({ kind: 'checking' });

  async function check() {
    setScreen({ kind: 'checking' });
    try {
      await AsyncStorage.setItem(ASKED_KEY, '1');
    } catch {
      // Only means the explanation shows again next time.
    }
    const access = await requestAppleMusicAccess();
    if (access.kind === 'ready') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router types regenerate on next dev server start
      router.replace('/setup/mode' as any);
      return;
    }
    setScreen(access);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let asked = false;
      try {
        asked = (await AsyncStorage.getItem(ASKED_KEY)) === '1';
      } catch {
        asked = false;
      }
      if (cancelled) return;
      if (asked) void check();
      else setScreen({ kind: 'intro' });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openMusic = () => void Linking.openURL('music://').catch(() => {});
  const openSettings = () => void Linking.openSettings().catch(() => {});

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.body}>
        {screen.kind === 'checking' ? (
          <ActivityIndicator color={colors.textPrimary} size="large" />
        ) : (
          <>
            <Text style={styles.title}>{TITLES[screen.kind]}</Text>
            <Text style={styles.text}>{bodyFor(screen)}</Text>
            <View style={styles.actions}>
              {screen.kind === 'intro' ? (
                <Btn label="Connect Apple Music" onPress={() => void check()} />
              ) : null}
              {screen.kind === 'denied' ? <Btn label="Open Settings" onPress={openSettings} /> : null}
              {screen.kind === 'no-subscription' || screen.kind === 'privacy-ack' ? (
                <Btn label="Open Apple Music" onPress={openMusic} />
              ) : null}
              {screen.kind !== 'intro' ? (
                <Btn label="Try again" kind="secondary" onPress={() => void check()} />
              ) : null}
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const TITLES: Record<Exclude<Screen['kind'], 'checking'>, string> = {
  intro: 'Songnado plays your Apple Music',
  ready: '',
  denied: 'Songnado needs Apple Music access',
  'no-subscription': 'Apple Music subscription needed',
  'privacy-ack': 'One quick step in Apple Music',
  error: "Couldn't reach Apple Music",
};

function bodyFor(screen: Exclude<Screen, { kind: 'checking' }>): string {
  switch (screen.kind) {
    case 'intro':
      return "Songnado picks the songs and plays short clips from your Apple Music subscription. Connect once and you're set.\n\nYou'll need an active Apple Music subscription on this phone.";
    case 'denied':
      return 'To play songs, Songnado needs permission to use Apple Music. In Settings, turn on Media & Apple Music for Songnado, then come back and tap Try again.';
    case 'no-subscription':
      return "This Apple ID doesn't have an Apple Music subscription, and Songnado plays its songs from Apple Music. Apple often offers a free trial in the Music app.";
    case 'privacy-ack':
      return 'Apple Music needs you to accept its latest terms. Open the Music app once, then come back and tap Try again.';
    case 'error':
      return `Check your connection and try again.\n\n${screen.message}`;
    default:
      return '';
  }
}

function Btn({
  label,
  onPress,
  kind = 'primary',
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        kind === 'primary' ? styles.btnPrimary : styles.btnSecondary,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  text: { color: colors.textMuted, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  actions: { gap: 12, marginTop: 12 },
  btn: { borderRadius: radii.lg, paddingVertical: 16, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnText: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.8 },
});
