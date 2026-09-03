import axios from 'axios';
import NodeCache from 'node-cache';
import { log } from '../../config/logging.js';
import { filterAndSortByTerms } from '@workspace/shared';

const GITHUB_RAW_BASE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main';
const EXERCISES_PATH = 'exercises'; // No leading slash for API
// Initialize cache for GitHub API responses (e.g., 1 hour TTL)
const githubCache = new NodeCache({ stdTTL: 3600 });
const EXERCISES_DATASET_CACHE_KEY = 'exercises_dataset';

interface FreeExercise {
  name: string;
  equipment?: string;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
}

let exercisesDatasetPromise: Promise<FreeExercise[]> | null = null;
let staleExercisesDataset: FreeExercise[] | null = null;

class FreeExerciseDBService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exerciseList: any;
  constructor() {
    this.exerciseList = []; // To store a list of available exercise IDs/names
  }
  /**
   * Fetches a single exercise by its ID (filename without .json).
   * @param {string} exerciseId - The ID of the exercise (e.g., "Air_Bike").
   * @returns {Promise<object|null>} The exercise data or null if not found.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getExerciseById(exerciseId: any) {
    const cacheKey = `exercise_${exerciseId}`;
    let exercise = githubCache.get(cacheKey);
    if (exercise) {
      console.log(
        `[FreeExerciseDBService] Cache hit for exercise: ${exerciseId}`
      );
      return exercise;
    }
    try {
      const url = `${GITHUB_RAW_BASE_URL}/${EXERCISES_PATH}/${exerciseId}.json`;
      console.log(`[FreeExerciseDBService] Fetching exercise from: ${url}`);
      const response = await axios.get(url);
      exercise = response.data;
      log(
        'debug',
        `[FreeExerciseDBService] Fetched exercise ${exerciseId}:`,
        exercise
      );
      githubCache.set(cacheKey, exercise);
      return exercise;
    } catch (error) {
      log(
        'error',
        `[FreeExerciseDBService] Error fetching exercise ${exerciseId}:`,
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        error.message
      );
      return null;
    }
  }
  async getAllExercises(): Promise<FreeExercise[]> {
    const cachedExercises = githubCache.get<FreeExercise[]>(
      EXERCISES_DATASET_CACHE_KEY
    );
    if (cachedExercises) {
      return cachedExercises;
    }
    if (!exercisesDatasetPromise) {
      exercisesDatasetPromise = (async () => {
        try {
          const exercisesJsonUrl = `${GITHUB_RAW_BASE_URL}/dist/exercises.json`;
          const response = await axios.get<FreeExercise[]>(exercisesJsonUrl);
          staleExercisesDataset = response.data;
          githubCache.set(EXERCISES_DATASET_CACHE_KEY, response.data);
          return response.data;
        } catch (error) {
          if (staleExercisesDataset) {
            return staleExercisesDataset;
          }
          throw error;
        } finally {
          exercisesDatasetPromise = null;
        }
      })();
    }
    return exercisesDatasetPromise;
  }
  async searchExercises(
    query: string | null | undefined,
    equipmentFilter: string[] = [],
    muscleGroupFilter: string[] = [],
    limit = 50,
    offset = 0
  ) {
    try {
      const allExercises = await this.getAllExercises();

      // 1. Filter by equipment and muscle group first
      const preFiltered = allExercises.filter((exercise) => {
        const matchesEquipment =
          equipmentFilter.length === 0 ||
          (exercise.equipment &&
            equipmentFilter.some((filter) =>
              exercise.equipment?.includes(filter)
            ));
        const matchesMuscleGroup =
          muscleGroupFilter.length === 0 ||
          (exercise.primaryMuscles &&
            muscleGroupFilter.some((filter) =>
              exercise.primaryMuscles?.includes(filter)
            )) ||
          (exercise.secondaryMuscles &&
            muscleGroupFilter.some((filter) =>
              exercise.secondaryMuscles?.includes(filter)
            ));
        return matchesEquipment && matchesMuscleGroup;
      });

      // 2. Filter and sort by search query using the shared utility
      const filteredExercises = filterAndSortByTerms(
        preFiltered,
        (exercise) => exercise.name,
        query || ''
      );

      const totalCount = filteredExercises.length;
      const paginatedExercises = filteredExercises.slice(
        offset,
        offset + limit
      );
      return { exercises: paginatedExercises, totalCount };
    } catch (error) {
      log(
        'error',
        `[FreeExerciseDBService] Error searching exercises for query "${query}" with limit ${limit}:`,
        error instanceof Error ? error.message : error
      );
      return { exercises: [], totalCount: 0 };
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getExerciseImageUrl(imagePath: any) {
    // The imagePath from the exercise JSON is relative to the exercise file,
    // e.g., "3_4_Sit-Up/0.jpg".
    // The full raw URL should be GITHUB_RAW_BASE_URL/images/ExerciseName/image.jpg
    const imageUrl = `${GITHUB_RAW_BASE_URL}/${EXERCISES_PATH}/${imagePath}`;
    log(
      'debug',
      `[FreeExerciseDBService] Constructed image URL: ${imageUrl} from imagePath: ${imagePath}`
    );
    return imageUrl;
  }
}

export function resetFreeExerciseDBCache() {
  githubCache.flushAll();
  exercisesDatasetPromise = null;
  staleExercisesDataset = null;
}

const freeExerciseDBService = new FreeExerciseDBService();
export default freeExerciseDBService;
