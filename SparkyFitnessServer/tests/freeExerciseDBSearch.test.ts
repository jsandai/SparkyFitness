import { vi, beforeEach, describe, expect, it } from 'vitest';
import axios from 'axios';
import freeExerciseDBService, {
  resetFreeExerciseDBCache,
} from '../integrations/freeexercisedb/FreeExerciseDBService.js';

vi.mock('axios');

describe('FreeExerciseDBService search', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resetFreeExerciseDBCache();
  });

  it('matches split-term queries and prioritizes exact match sequence sorting', async () => {
    const mockExercises = [
      { name: 'Barbell Lunge' },
      { name: 'Lunge (Barbell)' },
      { name: 'Dumbbell Lunge' },
      { name: 'Barbell Walking Lunge' },
    ];

    vi.mocked(axios.get).mockResolvedValue({ data: mockExercises });

    // Search for "lunge barbe" which should split to "lunge" and "barbe" and match case insensitively.
    // Since "Barbe" matches "Barbell", we expect matches.
    // None match the exact sequence "lunge barbe", so they sort alphabetically.
    const result = (await freeExerciseDBService.searchExercises(
      'lunge barbe'
    )) as any;

    expect(result.totalCount).toBe(3); // Barbell Lunge, Lunge (Barbell), Barbell Walking Lunge
    expect(result.exercises.map((e: any) => e.name)).toEqual([
      'Barbell Lunge',
      'Barbell Walking Lunge',
      'Lunge (Barbell)',
    ]);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('prioritizes exact matches', async () => {
    const mockExercises = [
      { name: 'Lunge (Barbell)' },
      { name: 'Barbell Lunge' },
      { name: 'Barbell Walking Lunge' },
    ];

    vi.mocked(axios.get).mockResolvedValue({ data: mockExercises });

    // Search for "barbell lunge"
    // "Barbell Lunge" contains the exact sequence "barbell lunge", so it should rank first.
    const result = (await freeExerciseDBService.searchExercises(
      'barbell lunge'
    )) as any;

    expect(result.exercises.map((e: any) => e.name)).toEqual([
      'Barbell Lunge', // Priority 0
      'Barbell Walking Lunge', // Priority 1 (alphabetical)
      'Lunge (Barbell)', // Priority 1 (alphabetical)
    ]);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('downloads the dataset once for different sequential queries', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: [{ name: 'Barbell Lunge' }, { name: 'Dumbbell Curl' }],
    });

    await freeExerciseDBService.searchExercises('lunge');
    await freeExerciseDBService.searchExercises('curl');

    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('downloads the dataset from the raw GitHub host', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: [] });

    await freeExerciseDBService.searchExercises('lunge');

    const requestedUrl = vi.mocked(axios.get).mock.calls[0]?.[0];
    expect(requestedUrl).toBe(
      'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'
    );
    expect(requestedUrl).not.toContain('api.github.com');
  });

  it('shares one cold-cache download across concurrent searches', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: [
        { name: 'Barbell Lunge' },
        { name: 'Dumbbell Curl' },
        { name: 'Cable Row' },
      ],
    });

    await Promise.all([
      freeExerciseDBService.searchExercises('lunge'),
      freeExerciseDBService.searchExercises('curl'),
      freeExerciseDBService.searchExercises('row'),
      freeExerciseDBService.searchExercises('barbell'),
    ]);

    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('serves the last good dataset when a refetch fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.mocked(axios.get).mockResolvedValue({
      data: [{ name: 'Barbell Lunge' }],
    });
    await freeExerciseDBService.searchExercises('lunge');
    vi.advanceTimersByTime(3_600_001);
    vi.mocked(axios.get).mockRejectedValue(new Error('network error'));

    const result = await freeExerciseDBService.searchExercises('barbell');

    expect(result).toEqual({
      exercises: [{ name: 'Barbell Lunge' }],
      totalCount: 1,
    });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});
