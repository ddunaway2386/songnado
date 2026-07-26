/**
 * Family test feedback review screen.
 *
 * Shows the two flag lists (Remove / Bad version) captured on this
 * phone during play. Each row has a swipe/tap to unflag if they
 * change their mind. Big Share button at the top exports everything
 * as JSON via the native iOS share sheet — AirDrop / Messages / Mail
 * / etc. — so Daniel can collect from every family phone at the
 * end of the weekend.
 *
 * No filtering happens during play — the flags are captured but the
 * pack keeps the songs until Daniel runs scripts/apply-feedback.mjs
 * against the collected JSON exports.
 */

import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { FeedbackEntry } from '@/stores/feedbackStore';
import { useFeedbackStore } from '@/stores/feedbackStore';
import { colors, radii } from '../theme';

export default function FeedbackScreen() {
  const entries = useFeedbackStore((s) => s.entries);
  const removeEntry = useFeedbackStore((s) => s.removeEntry);
  const clearAll = useFeedbackStore((s) => s.clearAll);

  const removeEntries = entries.filter((e) => e.kind === 'remove');
  const badVersionEntries = entries.filter((e) => e.kind === 'bad-version');

  async function handleShare() {
    if (entries.length === 0) {
      Alert.alert('Nothing to share', 'You haven\'t flagged any songs yet.');
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      totalFlags: entries.length,
      remove: removeEntries.map(toShareRow),
      badVersion: badVersionEntries.map(toShareRow),
    };
    try {
      await Share.share({
        title: 'Songnado family test feedback',
        message: JSON.stringify(payload, null, 2),
      });
    } catch (e) {
      Alert.alert('Share failed', String(e));
    }
  }

  function handleClearAll() {
    Alert.alert(
      'Clear all feedback?',
      'This deletes every flag on this phone. Usually you only want this after sharing your feedback with Dan.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear all', style: 'destructive', onPress: () => clearAll() },
      ]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        <Text style={styles.title}>Test feedback</Text>
        <Text style={styles.subtitle}>
          Songs you&apos;ve flagged during play. Flagged songs stop
          appearing in future rounds on this phone right away. When
          you&apos;re back at your computer, tap Share and save the JSON
          somewhere, then run scripts/apply-feedback.mjs to sync the
          removals into the pack files for good.
        </Text>

        <Pressable
          onPress={handleShare}
          disabled={entries.length === 0}
          style={{
            backgroundColor: entries.length > 0 ? colors.primary : colors.surfaceAlt,
            padding: 16,
            borderRadius: radii.md,
            alignItems: 'center',
            marginTop: 12,
            marginBottom: 24,
          }}
        >
          <Text
            style={{
              color: entries.length > 0 ? '#fff' : colors.textMuted,
              fontSize: 16,
              fontWeight: '700',
            }}
          >
            {entries.length > 0
              ? `Share ${entries.length} flag${entries.length === 1 ? '' : 's'} as JSON`
              : 'Nothing flagged yet'}
          </Text>
          {entries.length > 0 ? (
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 4 }}>
              Send to Notes, Mail, or AirDrop to yourself
            </Text>
          ) : null}
        </Pressable>

        <FeedbackSection
          title="Remove entirely"
          hint="Doesn't belong in the pack — skip forever."
          entries={removeEntries}
          onRemove={(e) => removeEntry(entries.indexOf(e))}
        />

        <FeedbackSection
          title="Bad version"
          hint="Song is good but this recording is bad (live, karaoke, wrong artist, etc.). Dan will find a better version."
          entries={badVersionEntries}
          onRemove={(e) => removeEntry(entries.indexOf(e))}
        />

        {entries.length > 0 ? (
          <Pressable
            onPress={handleClearAll}
            style={{
              marginTop: 24,
              padding: 14,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>Clear all flags</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => router.back()}
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: radii.md,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.primary, fontSize: 14 }}>← Back</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function FeedbackSection({
  title,
  hint,
  entries,
  onRemove,
}: {
  title: string;
  hint: string;
  entries: FeedbackEntry[];
  onRemove: (e: FeedbackEntry) => void;
}) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={styles.sectionTitle}>
        {title} ({entries.length})
      </Text>
      <Text style={styles.sectionHint}>{hint}</Text>
      {entries.length === 0 ? (
        <Text style={styles.emptyHint}>Nothing yet.</Text>
      ) : (
        entries.map((e, i) => <FeedbackRow key={`${e.packId}-${i}`} entry={e} onRemove={() => onRemove(e)} />)
      )}
    </View>
  );
}

function FeedbackRow({ entry, onRemove }: { entry: FeedbackEntry; onRemove: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: colors.surface,
        borderRadius: radii.md,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '600' }}>
          {entry.title}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
          {entry.artist}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
          in {entry.packName}
          {entry.source ? ` · from ${entry.source}` : ''}
        </Text>
      </View>
      <Pressable
        onPress={onRemove}
        hitSlop={10}
        style={{
          padding: 8,
          marginLeft: 8,
        }}
      >
        <Text style={{ color: colors.textMuted, fontSize: 20 }}>✕</Text>
      </Pressable>
    </View>
  );
}

function toShareRow(e: FeedbackEntry) {
  return {
    packName: e.packName,
    packId: e.packId,
    title: e.title,
    artist: e.artist,
    source: e.source,
    previewUrl: e.previewUrl,
  };
}

const styles = {
  title: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '800' as const,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700' as const,
    marginBottom: 4,
  },
  sectionHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 10,
    lineHeight: 16,
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic' as const,
    padding: 12,
  },
};
