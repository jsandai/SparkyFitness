import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  initializeSounds,
  setSoundsEnabled,
  getSoundsEnabled,
  useSoundsEnabled,
  __resetSoundsStateForTests,
} from '../../src/services/sounds';

const SOUNDS_KEY = '@HealthConnect:soundsEnabled';

describe('sounds service', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetSoundsStateForTests();
  });

  describe('initializeSounds', () => {
    it('loads "true" from storage as enabled', async () => {
      await AsyncStorage.setItem(SOUNDS_KEY, 'true');
      await initializeSounds();
      expect(getSoundsEnabled()).toBe(true);
    });

    it('loads "false" from storage as disabled', async () => {
      await AsyncStorage.setItem(SOUNDS_KEY, 'false');
      await initializeSounds();
      expect(getSoundsEnabled()).toBe(false);
    });

    it('falls back to enabled when storage has no value', async () => {
      await AsyncStorage.removeItem(SOUNDS_KEY);
      await initializeSounds();
      expect(getSoundsEnabled()).toBe(true);
    });

    it('does not overwrite a user toggle that lands while init is in flight', async () => {
      // Seed storage with 'true' so a naive init would re-set the value back
      // to true after the user has just toggled it to false.
      await AsyncStorage.setItem(SOUNDS_KEY, 'true');

      // Simulate the user racing init by toggling off before init resolves.
      const initPromise = initializeSounds();
      await setSoundsEnabled(false);
      await initPromise;

      expect(getSoundsEnabled()).toBe(false);
    });

    it('is idempotent — second call does not re-read storage', async () => {
      await AsyncStorage.setItem(SOUNDS_KEY, 'false');
      await initializeSounds();
      expect(getSoundsEnabled()).toBe(false);

      // If something writes a different value to storage after init,
      // a subsequent initializeSounds call should ignore it.
      await AsyncStorage.setItem(SOUNDS_KEY, 'true');
      await initializeSounds();
      expect(getSoundsEnabled()).toBe(false);
    });
  });

  describe('setSoundsEnabled', () => {
    it('persists the value to AsyncStorage', async () => {
      await setSoundsEnabled(false);
      expect(await AsyncStorage.getItem(SOUNDS_KEY)).toBe('false');
      await setSoundsEnabled(true);
      expect(await AsyncStorage.getItem(SOUNDS_KEY)).toBe('true');
    });

    it('updates the synchronous getter immediately', async () => {
      await setSoundsEnabled(false);
      expect(getSoundsEnabled()).toBe(false);
      await setSoundsEnabled(true);
      expect(getSoundsEnabled()).toBe(true);
    });
  });

  describe('useSoundsEnabled (listener subscription)', () => {
    const Probe: React.FC = () => {
      const enabled = useSoundsEnabled();
      return <Text testID="probe">{String(enabled)}</Text>;
    };

    it('updates already-mounted consumers when initializeSounds resolves with a stored value', async () => {
      // Storage has 'false' but the module-level cache is still the default 'true'
      // because we haven't called initializeSounds yet. A consumer mounting now
      // would see 'true' until init resolves and notifies listeners.
      await AsyncStorage.setItem(SOUNDS_KEY, 'false');

      const screen = render(<Probe />);
      expect(screen.getByTestId('probe').props.children).toBe('true');

      await act(async () => {
        await initializeSounds();
      });

      expect(screen.getByTestId('probe').props.children).toBe('false');
    });

    it('propagates setSoundsEnabled updates to active consumers', async () => {
      const screen = render(<Probe />);
      expect(screen.getByTestId('probe').props.children).toBe('true');

      await act(async () => {
        await setSoundsEnabled(false);
      });

      expect(screen.getByTestId('probe').props.children).toBe('false');
    });
  });
});
