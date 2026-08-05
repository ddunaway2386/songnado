/**
 * UnlockPackModal — surfaces when a user taps a locked pack in the picker.
 *
 * Two unlock paths, both free and both App-Store-policy-clean (note that
 * "leave a review to unlock" is explicitly prohibited by Guideline 5.6.1):
 *   1. Play count engagement — automatic; visible progress hint
 *   2. Share via native share sheet — instant unlock on share confirmation
 *
 * NO PAID PATHS IN v1. This modal previously showed "Buy this pack — $2.99"
 * and "Songnado Pro — $4.99/mo" buttons whose handlers just granted the
 * content locally: no StoreKit, no IAP library in the project at all. That
 * violates Guideline 3.1.1 (digital content must go through in-app purchase)
 * and advertising a price the app never charges invites 2.3.1 as well.
 *
 * Real StoreKit is a v1.1 job — products in App Store Connect, a purchase
 * library, sandbox testing, and a mandatory Restore Purchases affordance.
 * Until that exists, locked packs are earned, never sold.
 */

import { Modal, Pressable, Share, Text, View } from 'react-native';

import type { Playlist } from '@/lib/types';
import {
  UNLOCK_VIA_PLAY_GAMES_THRESHOLD,
  useUnlocksStore,
} from '@/stores/unlocksStore';

interface UnlockPackModalProps {
  playlist: Playlist | null;
  onClose: () => void;
}

export function UnlockPackModal({ playlist, onClose }: UnlockPackModalProps) {
  const gamesPlayed = useUnlocksStore((s) => s.gamesPlayed);
  const unlockPack = useUnlocksStore((s) => s.unlockPack);
  const recordShareCompleted = useUnlocksStore((s) => s.recordShareCompleted);

  if (!playlist) return null;

  const gamesUntilUnlock = Math.max(
    0,
    UNLOCK_VIA_PLAY_GAMES_THRESHOLD - gamesPlayed
  );
  const earnedFreeUnlock = gamesPlayed >= UNLOCK_VIA_PLAY_GAMES_THRESHOLD;

  async function handleShareToUnlock() {
    try {
      const result = await Share.share({
        message:
          "I'm playing Songnado — a music trivia party game. " +
          'Want to play? https://songnado.app',
        title: 'Songnado',
      });
      if (result.action === Share.sharedAction) {
        recordShareCompleted();
        unlockPack(playlist!.id);
        onClose();
      }
    } catch {
      // User dismissed share sheet; no unlock granted, no error to surface.
    }
  }

  function handlePlayUnlock() {
    if (!earnedFreeUnlock) return;
    unlockPack(playlist!.id);
    onClose();
  }

  return (
    <Modal
      visible={playlist != null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/60 justify-end">
        <View className="bg-bg p-6 gap-4 rounded-t-2xl">
          <View className="gap-1">
            <Text className="text-textMuted text-xs uppercase tracking-wider">
              Locked pack
            </Text>
            <Text className="text-textPrimary text-2xl font-bold">
              🔒 {playlist!.name}
            </Text>
            <Text className="text-textMuted text-sm">
              {playlist!.totalTracks} tracks · choose how to unlock
            </Text>
          </View>

          {/* Play-to-unlock */}
          <Pressable
            onPress={handlePlayUnlock}
            disabled={!earnedFreeUnlock}
            className={`rounded-md p-4 border ${
              earnedFreeUnlock
                ? 'bg-primary border-primary active:bg-primaryHover'
                : 'bg-surface border-border'
            }`}
          >
            <Text className="text-textPrimary font-semibold">
              🎮 {earnedFreeUnlock
                ? 'Unlock now (you earned it!)'
                : 'Play to unlock'}
            </Text>
            <Text
              className={
                earnedFreeUnlock
                  ? 'text-textPrimary/80 text-xs'
                  : 'text-textMuted text-xs'
              }
            >
              {earnedFreeUnlock
                ? `You've played ${gamesPlayed} games — tap to unlock this pack free`
                : `Play ${gamesUntilUnlock} more ${gamesUntilUnlock === 1 ? 'round' : 'rounds'} to unlock one pack for free`}
            </Text>
          </Pressable>

          {/* Share-to-unlock */}
          <Pressable
            onPress={handleShareToUnlock}
            className="rounded-md p-4 border bg-surface border-border active:bg-surfaceAlt"
          >
            <Text className="text-textPrimary font-semibold">
              📤 Share Songnado to unlock now
            </Text>
            <Text className="text-textMuted text-xs">
              Share with a friend via your favorite app — this pack unlocks instantly
            </Text>
          </Pressable>

          <Pressable
            onPress={onClose}
            className="rounded-md p-3 items-center"
          >
            <Text className="text-textMuted">Maybe later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
