import { z } from 'zod';
import {
  dateSchema,
  optionalEntryTimeSchema,
  presetIdSchema,
  setTypeEnum,
  paginationSchema,
  uuidSchema,
} from './common.js';

// Everything time-shaped on this tool surface is SECONDS.
//
// The underlying column is minutes (`exercise_entry_sets.duration`), and this
// schema used to expose it as `duration` while describing it as "seconds" — so
// a 30-second hold was stored as 30 minutes. Rather than propagate a unit that
// nobody thinks in for holds and carries (and that sits next to `rest_time`,
// which really is seconds), the tool speaks seconds and converts at the
// repository boundary. The name carries the unit so it can't drift again.
const durationSecondsSchema = z.coerce
  .number()
  .min(0)
  .optional()
  .describe('Work duration in SECONDS (e.g. a 30s hold is 30)');

const exerciseSetSchema = z
  .object({
    reps: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Number of repetitions'),
    weight: z.coerce.number().min(0).optional().describe('Weight in kg'),
    duration_seconds: durationSecondsSchema,
    rest_time: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Rest time in seconds'),
    set_type: setTypeEnum.default('Working Set'),
    rpe: z.coerce
      .number()
      .min(0)
      .max(10)
      .optional()
      .describe('Rate of Perceived Exertion (0-10 scale, one decimal allowed)'),
    notes: z.string().max(1000).optional().describe('Note for this set'),
  })
  .strict();

const searchExercisesSchema = z
  .object({
    action: z.literal('search_exercises'),
    searchTerm: z
      .string()
      .min(1)
      .max(200)
      .describe('Name or part of exercise name'),
    muscleGroup: z
      .string()
      .optional()
      .describe("Muscle group filter (e.g., 'Chest', 'Biceps')"),
    equipment: z
      .string()
      .optional()
      .describe("Equipment filter (e.g., 'Dumbbell', 'None')"),
    ...paginationSchema.shape,
  })
  .strict();

const createExerciseSchema = z
  .object({
    action: z.literal('create_exercise'),
    name: z.string().min(1).max(200).describe('Full name for the exercise'),
    category: z
      .string()
      .optional()
      .describe("Category (e.g., 'Strength', 'Cardio')"),
    calories_per_hour: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Estimated calories burned per hour'),
    description: z
      .string()
      .max(1000)
      .optional()
      .describe('Description of the exercise'),
  })
  .strict();

const logExerciseSchema = z
  .object({
    action: z.literal('log_exercise'),
    exercise_id: uuidSchema.optional().describe('UUID of the exercise'),
    exercise_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the exercise (alternative to ID)'),
    entry_date: dateSchema,
    entry_time: optionalEntryTimeSchema,
    duration_minutes: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Duration in minutes'),
    calories_burned: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Calories burned'),
    notes: z.string().max(2000).optional().describe('Additional notes'),
    distance: z.coerce
      .number()
      .min(0)
      .optional()
      .describe(
        "Distance covered, in the user's distance unit (e.g. km) — for cardio"
      ),
    avg_heart_rate: z.coerce
      .number()
      .int()
      .min(0)
      .max(300)
      .optional()
      .describe('Average heart rate in bpm — for cardio'),
    steps: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Step count for the activity'),
    sets: z
      .union([z.array(exerciseSetSchema), z.string()])
      .optional()
      .describe('Set details as array or JSON string'),
  })
  .strict();

const listExerciseDiarySchema = z
  .object({
    action: z.literal('list_exercise_diary'),
    entry_date: dateSchema,
  })
  .strict();

const getWorkoutPresetsSchema = z
  .object({
    action: z.literal('get_workout_presets'),
    preset_id: presetIdSchema
      .optional()
      .describe('Return just this preset, in full'),
    preset_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Return just this preset, in full (alternative to ID)'),
  })
  .strict();

const logWorkoutPresetSchema = z
  .object({
    action: z.literal('log_workout_preset'),
    preset_id: presetIdSchema.optional().describe('ID of the workout preset'),
    preset_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the preset (alternative to ID)'),
    entry_date: dateSchema,
  })
  .strict();

const updateExerciseEntrySchema = z
  .object({
    action: z.literal('update_exercise_entry'),
    entry_id: uuidSchema.describe('UUID of the exercise entry to update'),
    entry_date: dateSchema
      .optional()
      .describe('New date for the entry (YYYY-MM-DD)'),
    entry_time: optionalEntryTimeSchema,
    duration_minutes: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Duration in minutes'),
    calories_burned: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Calories burned'),
    notes: z.string().max(2000).optional().describe('Additional notes'),
    distance: z.coerce
      .number()
      .min(0)
      .optional()
      .describe(
        "Distance covered, in the user's distance unit (e.g. km) — for cardio"
      ),
    avg_heart_rate: z.coerce
      .number()
      .int()
      .min(0)
      .max(300)
      .optional()
      .describe('Average heart rate in bpm — for cardio'),
    steps: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Step count for the activity'),
    sets: z
      .union([z.array(exerciseSetSchema), z.string()])
      .optional()
      .describe(
        'Replacement set details as array or JSON string; replaces all existing sets when provided'
      ),
  })
  .strict();

const deleteExerciseEntrySchema = z
  .object({
    action: z.literal('delete_exercise_entry'),
    entry_id: uuidSchema.describe('UUID of the exercise entry to delete'),
  })
  .strict();

const getExerciseDetailsSchema = z
  .object({
    action: z.literal('get_exercise_details'),
    exercise_id: uuidSchema.optional().describe('UUID of the exercise'),
    exercise_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the exercise (alternative to ID)'),
  })
  .strict();

// workout_preset_exercise_sets has no rpe column, so a preset set is not an
// exerciseSetSchema. set_number is NOT NULL in the DB but defaulted from array
// position here, so the model never has to number its own sets.
const presetSetSchema = z
  .object({
    set_number: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('1-based set position; defaults to the order given'),
    set_type: setTypeEnum.optional(),
    reps: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Number of repetitions'),
    weight: z.coerce.number().min(0).optional().describe('Weight in kg'),
    duration_seconds: durationSecondsSchema,
    rest_time: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Rest time in seconds'),
    notes: z.string().max(1000).optional().describe('Note for this set'),
  })
  .strict();

const presetExerciseSchema = z
  .object({
    exercise_id: z
      .string()
      .min(1)
      .optional()
      .describe('Exercise UUID, or a free-exercise-db source id'),
    exercise_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Exercise name (alternative to exercise_id); created if no exercise matches'
      ),
    sort_order: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Position in the preset; defaults to the order given'),
    superset_group: z.coerce
      .number()
      .int()
      .nullable()
      .optional()
      .describe(
        'Exercises sharing the same integer are performed as a superset; null/omitted means no superset'
      ),
    sets: z
      .array(presetSetSchema)
      .optional()
      .describe('The prescription for this exercise, set by set'),
  })
  .strict();

// Nested arrays reach us as JSON strings when the model serialises them; the
// handler parses the string form. Mirrors `sets` on log_exercise.
// The array form, exported so the handler can re-validate the JSON-string form
// after parsing it. Without this the string path is a hole: zod checks that
// `exercises` is a string, and nothing checks what the string decodes to.
export const presetExerciseArraySchema = z.array(presetExerciseSchema);

const presetExercisesSchema = z
  .union([z.array(presetExerciseSchema), z.string()])
  .describe('Exercises as an array of objects or a JSON string');

const createWorkoutPresetSchema = z
  .object({
    action: z.literal('create_workout_preset'),
    name: z.string().min(1).max(200).describe('Name of the workout preset'),
    description: z
      .string()
      .max(1000)
      .optional()
      .describe('Description of the preset'),
    is_public: z.boolean().optional().describe('Share the preset publicly'),
    exercises: presetExercisesSchema.optional(),
    exercise_ids: z
      .array(uuidSchema)
      .optional()
      .describe(
        'Shorthand for a preset with no prescription: exercise UUIDs in order. Use `exercises` to specify sets'
      ),
  })
  .strict();

const updateWorkoutPresetSchema = z
  .object({
    action: z.literal('update_workout_preset'),
    preset_id: presetIdSchema.optional().describe('ID of the preset to update'),
    preset_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the preset to update (alternative to ID)'),
    name: z.string().min(1).max(200).optional().describe('New name'),
    description: z.string().max(1000).optional().describe('New description'),
    is_public: z.boolean().optional().describe('Share the preset publicly'),
    exercises: presetExercisesSchema
      .optional()
      .describe(
        'Replaces every exercise and set in the preset. Omit to leave them untouched'
      ),
  })
  .strict();

const deleteWorkoutPresetSchema = z
  .object({
    action: z.literal('delete_workout_preset'),
    preset_id: presetIdSchema.optional().describe('ID of the preset to delete'),
    preset_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the preset to delete (alternative to ID)'),
  })
  .strict();

const getExerciseProgressSchema = z
  .object({
    action: z.literal('get_exercise_progress'),
    exercise_id: uuidSchema.optional().describe('UUID of the exercise'),
    exercise_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the exercise (alternative to ID)'),
    start_date: dateSchema
      .optional()
      .describe('Start date for progress tracking'),
    end_date: dateSchema.optional().describe('End date for progress tracking'),
    ...paginationSchema.shape,
  })
  .strict();

export const manageExerciseSchema = z.discriminatedUnion('action', [
  searchExercisesSchema,
  createExerciseSchema,
  logExerciseSchema,
  listExerciseDiarySchema,
  getWorkoutPresetsSchema,
  logWorkoutPresetSchema,
  updateExerciseEntrySchema,
  deleteExerciseEntrySchema,
  getExerciseDetailsSchema,
  createWorkoutPresetSchema,
  updateWorkoutPresetSchema,
  deleteWorkoutPresetSchema,
  getExerciseProgressSchema,
]);

export type ManageExerciseInput = z.infer<typeof manageExerciseSchema>;

// Flat input shape published to the LLM as `inputSchema`. See comment on
// manageFoodInput in ./food.js for the rationale. Runtime validation still
// uses manageExerciseSchema in the tool handler via safeParse.
export const manageExerciseInput = z.object({
  action: z
    .enum([
      'search_exercises',
      'create_exercise',
      'log_exercise',
      'list_exercise_diary',
      'get_workout_presets',
      'log_workout_preset',
      'update_exercise_entry',
      'delete_exercise_entry',
      'get_exercise_details',
      'create_workout_preset',
      'update_workout_preset',
      'delete_workout_preset',
      'get_exercise_progress',
    ])
    .optional()
    .describe(
      'Optional action to perform (server infers if omitted); see tool description for per-action fields.'
    ),
  // identity
  exercise_id: uuidSchema
    .optional()
    .describe(
      'Exercise UUID. REQUIRED for "log_exercise" if exercise_name is not provided.'
    ),
  exercise_name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Exercise name (e.g. "Walking", "Running", "Squats"). REQUIRED for "log_exercise" if exercise_id is not provided.'
    ),
  exercise_ids: z
    .array(uuidSchema)
    .optional()
    .describe(
      'Exercise UUIDs — create_workout_preset shorthand for a preset with no sets'
    ),
  name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Name — for create_exercise / create_workout_preset / update_workout_preset'
    ),
  // search
  searchTerm: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Search term — required for search_exercises'),
  muscleGroup: z
    .string()
    .optional()
    .describe("Muscle group filter (e.g., 'Chest')"),
  equipment: z
    .string()
    .optional()
    .describe("Equipment filter (e.g., 'Dumbbell', 'None')"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Pagination limit'),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Pagination offset'),
  // create
  category: z
    .string()
    .optional()
    .describe("Exercise category (e.g., 'Strength', 'Cardio')"),
  calories_per_hour: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Estimated calories burned per hour'),
  description: z
    .string()
    .max(1000)
    .optional()
    .describe('Description of the exercise'),
  // log
  entry_date: dateSchema.optional().describe('Date for the entry (YYYY-MM-DD)'),
  entry_time: optionalEntryTimeSchema,
  duration_minutes: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Duration in minutes'),
  calories_burned: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Calories burned'),
  notes: z.string().max(2000).optional().describe('Additional notes'),
  distance: z.coerce
    .number()
    .min(0)
    .optional()
    .describe(
      "Distance covered, in the user's distance unit (e.g. km) — cardio, for log/update"
    ),
  avg_heart_rate: z.coerce
    .number()
    .int()
    .min(0)
    .max(300)
    .optional()
    .describe('Average heart rate in bpm — cardio, for log/update'),
  steps: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Step count for the activity — for log/update'),
  sets: z
    .union([
      z.array(
        z.object({
          reps: z.coerce.number().int().min(0).optional(),
          weight: z.coerce.number().min(0).optional(),
          duration_seconds: z.coerce.number().min(0).optional(),
          rest_time: z.coerce.number().min(0).optional(),
          set_type: setTypeEnum.optional(),
          rpe: z.coerce.number().min(0).max(10).optional(),
          notes: z.string().max(1000).optional(),
        })
      ),
      z.string(),
    ])
    .optional()
    .describe(
      'Set details as array of objects or JSON string; per-set fields include rpe and notes. weight is kg; duration_seconds and rest_time are SECONDS'
    ),
  // presets
  preset_id: presetIdSchema
    .optional()
    .describe('Workout preset ID (an integer, not a UUID)'),
  preset_name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Workout preset name'),
  is_public: z
    .boolean()
    .optional()
    .describe('Share the preset publicly — for create/update_workout_preset'),
  exercises: z
    .union([
      z.array(
        z.object({
          exercise_id: z.string().min(1).optional(),
          exercise_name: z.string().min(1).max(200).optional(),
          sort_order: z.coerce.number().int().min(0).optional(),
          superset_group: z.coerce.number().int().nullable().optional(),
          sets: z
            .array(
              z.object({
                set_number: z.coerce.number().int().positive().optional(),
                set_type: setTypeEnum.optional(),
                reps: z.coerce.number().int().min(0).optional(),
                weight: z.coerce.number().min(0).optional(),
                duration_seconds: z.coerce.number().min(0).optional(),
                rest_time: z.coerce.number().min(0).optional(),
                notes: z.string().max(1000).optional(),
              })
            )
            .optional(),
        })
      ),
      z.string(),
    ])
    .optional()
    .describe(
      'Full preset prescription — for create/update_workout_preset. Array of objects or JSON string: [{exercise_id?|exercise_name?, sort_order?, superset_group?, sets?:[{set_number?,set_type?,reps?,weight?,duration_seconds?,rest_time?,notes?}]}]. weight is kg; duration_seconds and rest_time are SECONDS. Exercises sharing a superset_group integer are supersetted'
    ),
  // entry management
  entry_id: uuidSchema
    .optional()
    .describe(
      'Exercise diary entry UUID — for update_exercise_entry / delete_exercise_entry'
    ),
  // progress range
  start_date: dateSchema
    .optional()
    .describe('Start date for progress tracking'),
  end_date: dateSchema.optional().describe('End date for progress tracking'),
});
