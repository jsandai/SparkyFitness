import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SOUNDS_KEY = '@HealthConnect:soundsEnabled';

let soundsEnabled = true;
let initialized = false;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export async function initializeSounds(): Promise<void> {
  // If the user has already toggled the value (or initialize ran already),
  // do not let a late-resolving storage read overwrite the live state.
  if (initialized) return;
  try {
    const saved = await AsyncStorage.getItem(SOUNDS_KEY);
    if (saved !== null && !initialized) {
      soundsEnabled = saved === 'true';
      // Notify any consumers that mounted before this resolved so they pick
      // up the persisted value instead of staying on the default.
      notifyListeners();
    }
  } catch {
    // fall back to default (enabled)
  } finally {
    initialized = true;
  }
}

export async function setSoundsEnabled(enabled: boolean): Promise<void> {
  // Mark initialized so any in-flight initializeSounds does not overwrite
  // this user-driven change with a stale value loaded from storage.
  initialized = true;
  soundsEnabled = enabled;
  notifyListeners();
  try {
    await AsyncStorage.setItem(SOUNDS_KEY, String(enabled));
  } catch {
    // ignore — in-memory value still updates so the user gets feedback
  }
}

export function useSoundsEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => soundsEnabled);
}

export function getSoundsEnabled(): boolean {
  return soundsEnabled;
}

/** Test-only helper — resets module-level state. */
export function __resetSoundsStateForTests(): void {
  soundsEnabled = true;
  initialized = false;
  listeners.clear();
}
