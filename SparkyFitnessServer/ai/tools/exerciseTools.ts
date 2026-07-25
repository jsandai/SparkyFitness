import { tool } from 'ai';
import { z } from 'zod';
import { todayInZone } from '@workspace/shared';
import { log } from '../../config/logging.js';
import exerciseService from '../../services/exerciseService.js';
import workoutPresetService from '../../services/workoutPresetService.js';
import exerciseDb from '../../models/exercise.js';
import exerciseEntryDb from '../../models/exerciseEntry.js';
import { ERRORS, formatZodError } from './errors.js';
import {
  compactRecord,
  dayString,
  formatConfirmation,
  formatJsonResult,
  formatList,
} from './formatting.js';
import {
  normalizePagination,
  buildPaginatedResult,
  type PaginatedResult,
} from './pagination.js';
import {
  manageExerciseSchema,
  manageExerciseInput,
  presetExerciseArraySchema,
  type ManageExerciseInput,
} from './schemas/exercise.js';
import { optionalDateSchema } from './schemas/common.js';
import { normalizeActionArgs, normalizeDayKeywords } from './dates.js';

const VALID_ACTIONS = [
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
];

// A caller mistake the handler can explain, as opposed to a DB failure it
// can't. The switch's catch maps this to a VALIDATION error; everything else
// stays a generic DB_ERROR so internals never leak.
class ToolValidationError extends Error {}

// Optional inputs and nullable DB columns are treated alike: absent.
function isSet<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

// The set `duration` column is MINUTES — shared with the web UI, mobile, the
// REST API and the CSV importer, so this tool can't change it. But minutes is
// the wrong unit for a set (holds and carries are seconds, and `rest_time`
// right next to it IS seconds), so the tool surface speaks seconds and shims
// the unit here, in one place, at the repository boundary.
//
// The shim has to round on the way back. seconds/60*60 is NOT the identity in
// floating point: 202 of the first 7200 whole seconds don't survive it, so a
// 31-second hold would otherwise read back as 31.000000000000004s. Two decimals
// keeps any duration a human would enter and kills the float dust.
function secondsToMinutes(seconds: number | null | undefined): number | null {
  return isSet(seconds) ? seconds / 60 : null;
}

function minutesToSeconds(minutes: number | null | undefined): number | null {
  if (!isSet(minutes)) return null;
  return Math.round(Number(minutes) * 60 * 100) / 100;
}

// The AI layer historically emitted 'Warmup'; the web UI's vocabulary spells it
// 'Warm-up' and renders anything else as an unknown badge. Accept the old
// spelling, store the one the UI knows.
function normalizeSetType(setType: string | undefined): string {
  if (!setType) return 'Working Set';
  return setType === 'Warmup' ? 'Warm-up' : setType;
}

// Text columns may hold JSON arrays, comma-separated values, or plain strings.
function safeParseJson(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      /* not JSON */
    }
    if (value.includes(',')) {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return value ? [value] : [];
  }
  return [];
}

interface ExerciseSetInput {
  reps?: number;
  weight?: number;
  duration_seconds?: number;
  rest_time?: number;
  set_type?: string;
  rpe?: number;
  notes?: string;
}

// The set rows the exercise-entry repository expects: 1-based set_number plus
// explicit nulls for absent fields (mirrors MCP's per-set INSERT defaults).
function toRepoSets(sets: ExerciseSetInput[]) {
  return sets.map((s, i) => ({
    set_number: i + 1,
    set_type: normalizeSetType(s.set_type),
    reps: s.reps ?? null,
    weight: s.weight ?? null,
    duration: secondsToMinutes(s.duration_seconds),
    rest_time: s.rest_time ?? null,
    rpe: s.rpe ?? null,
    notes: s.notes ?? null,
  }));
}

// A set as it comes BACK from the DB: `duration` is the raw minutes column, not
// the seconds this tool surface speaks. Kept distinct from ExerciseSetInput so
// the two units can't be confused on the read path — rendering a minutes value
// as `${s.duration}s` is exactly the bug this split prevents.
interface ExerciseSetRow {
  reps?: number;
  weight?: number;
  duration?: number;
  rest_time?: number;
  set_type?: string;
  rpe?: number;
  notes?: string;
}

interface PresetSetInput {
  set_number?: number;
  set_type?: string;
  reps?: number;
  weight?: number;
  duration_seconds?: number;
  rest_time?: number;
  notes?: string;
}

interface PresetExerciseInput {
  exercise_id?: string;
  exercise_name?: string;
  sort_order?: number;
  superset_group?: number | null;
  sets?: PresetSetInput[];
}

// Preset sets have no rpe column, and set_number is NOT NULL — so unlike
// toRepoSets this numbers from array position rather than dropping the field.
function toPresetSets(sets: PresetSetInput[]) {
  return sets.map((s, i) => ({
    set_number: s.set_number ?? i + 1,
    set_type: normalizeSetType(s.set_type),
    reps: s.reps ?? null,
    weight: s.weight ?? null,
    duration: secondsToMinutes(s.duration_seconds),
    rest_time: s.rest_time ?? null,
    notes: s.notes ?? null,
  }));
}

// Models serialise nested arrays as JSON strings, so `exercises` may arrive as
// an array (already checked by the strict union) or as a string (whose CONTENTS
// nothing has checked). Decode, then run the decoded value through the same zod
// schema the array form gets — otherwise the string path is a validation hole:
// `{"sets": 3}` would sail through and crash in toPresetSets, and a bogus
// set_type or superset_group would reach the INSERT unchecked.
//
// A malformed or mistyped payload is the caller's mistake, not a DB failure.
function parsePresetExercises(
  value: PresetExerciseInput[] | string | undefined
): PresetExerciseInput[] | undefined {
  if (value === undefined) return undefined;
  let decoded: unknown = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch {
      throw new ToolValidationError('Invalid JSON format for exercises');
    }
  }
  const parsed = presetExerciseArraySchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ToolValidationError(
      `exercises: ${parsed.error.issues
        .map((i) =>
          i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message
        )
        .join('; ')}`
    );
  }
  return parsed.data as PresetExerciseInput[];
}

// Resolution order for a free-text exercise name: exact case-insensitive match,
// then the best fuzzy hit, then create it. Returns the row so callers can show
// what the name actually bound to — a fuzzy hit or a brand-new exercise are
// both things the user deserves to see, not silently accept.
async function resolveExerciseByName(userId: string, name: string) {
  const rows = await exerciseService.searchExercises(
    userId,
    name,
    userId,
    undefined,
    undefined
  );
  const lower = name.toLowerCase();
  const found =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.find((e: any) => String(e.name).toLowerCase() === lower) ?? rows[0];
  if (found) {
    return {
      id: found.id as string,
      name: found.name as string,
      created: false,
    };
  }
  const created = await exerciseService.createExercise(userId, {
    name,
    category: 'custom',
    calories_per_hour: 300,
    is_custom: true,
    shared_with_public: false,
    source: 'manual',
  });
  return {
    id: created.id as string,
    name: created.name as string,
    created: true,
  };
}

// Preset exercises as the service wants them: exercise_id resolved, sort_order
// dense from array position (the repo's `sort_order || 0` would otherwise
// collapse an unordered list into a tie), sets numbered and converted to
// minutes.
async function buildPresetExercises(
  userId: string,
  exercises: PresetExerciseInput[]
) {
  const createdNames: string[] = [];
  const built = [];
  for (const [i, ex] of exercises.entries()) {
    if (!ex.exercise_id && !ex.exercise_name) {
      throw new ToolValidationError(
        `exercises[${i}]: either exercise_id or exercise_name must be provided`
      );
    }
    let exerciseId = ex.exercise_id;
    if (!exerciseId && ex.exercise_name) {
      const resolved = await resolveExerciseByName(userId, ex.exercise_name);
      exerciseId = resolved.id;
      if (resolved.created) createdNames.push(resolved.name);
    }
    built.push({
      exercise_id: exerciseId,
      sort_order: ex.sort_order ?? i,
      superset_group: ex.superset_group ?? null,
      sets: ex.sets ? toPresetSets(ex.sets) : undefined,
    });
  }
  return { exercises: built, createdNames };
}

// superset_group is an arbitrary integer; letters read better in chat and keep
// the grouping obvious without exposing the raw key.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function supersetLabels(exercises: any[]): Map<number, string> {
  const labels = new Map<number, string>();
  for (const ex of exercises) {
    const group = ex.superset_group;
    if (!isSet(group) || labels.has(group)) continue;
    labels.set(group, String.fromCharCode(65 + labels.size));
  }
  return labels;
}

// One set, in the idiom list_exercise_diary already uses: `8r×24kg (rest 90s)`.
// duration comes back out of the DB in minutes and is rendered in seconds, the
// unit this tool surface speaks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatPresetSet(s: any): string {
  const parts: string[] = [];
  if (isSet(s.reps)) parts.push(`${s.reps}r`);
  if (isSet(s.weight)) parts.push(`${s.weight}kg`);
  if (isSet(s.duration)) parts.push(`${minutesToSeconds(s.duration)}s`);
  let text = parts.join('×');
  if (s.set_type && s.set_type !== 'Working Set') {
    text = text ? `${text} [${s.set_type}]` : `[${s.set_type}]`;
  }
  if (isSet(s.rest_time)) text += ` (rest ${s.rest_time}s)`;
  if (s.notes) text += ` (${s.notes})`;
  return text;
}

// The full prescription, so the model can verify what it wrote and edit it.
// The old formatter printed only the name and an exercise count, which made the
// authoring loop impossible to close.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatPreset(p: any): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exercises: any[] = p.exercises ?? [];
  let text = `**${p.name}** (ID: ${p.id}) — ${exercises.length} exercises`;
  if (p.description) text += `\n  *${p.description}*`;
  const labels = supersetLabels(exercises);
  exercises.forEach((ex, i) => {
    const label = isSet(ex.superset_group)
      ? ` [superset ${labels.get(ex.superset_group)}]`
      : '';
    text += `\n  ${i + 1}. ${ex.exercise_name ?? ex.exercise_id}${label}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sets: any[] = ex.sets ?? [];
    if (sets.length > 0) {
      const setLines = sets.map(formatPresetSet).filter(Boolean).join('; ');
      text += `\n     ${sets.length} sets: ${setLines}`;
    }
  });
  return text;
}

// A write echoes the persisted prescription back rather than a bare count: the
// model has to see how names resolved and what actually landed before it can
// edit with any confidence.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function presetWritten(verb: string, preset: any, createdNames: string[]) {
  let text = formatConfirmation(
    `Workout preset "${preset.name}" ${verb} (ID: ${preset.id}).`
  );
  if (createdNames.length > 0) {
    text += `\nNew exercises added to your catalog: ${createdNames.join(', ')}.`;
  }
  return `${text}\n\n${formatPreset(preset)}`;
}

// A preset by id or name, or null. The service throws on a missing id while the
// name lookup returns null; normalise both so callers see one shape.
async function findPreset(
  userId: string,
  params: { preset_id?: number; preset_name?: string }
) {
  if (isSet(params.preset_id)) {
    try {
      return await workoutPresetService.getWorkoutPresetById(
        userId,
        params.preset_id
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }
  if (params.preset_name) {
    return workoutPresetService.getWorkoutPresetByName(
      userId,
      params.preset_name
    );
  }
  return null;
}

// MCP's date-range defaults: a single `date` overrides start/end; otherwise
// the range defaults to today (user timezone) / the start date.
function exerciseDateRange(
  query: {
    date?: string;
    start_date?: string;
    end_date?: string;
  },
  tz: string
): { startDate: string; endDate: string } {
  const today = todayInZone(tz);
  const date = query.date || undefined;
  const startDate = date || query.start_date || today;
  const endDate = date || query.end_date || startDate;
  return { startDate, endDate };
}

// Renders a row's bare-DATE entry_date as a calendar-day string for JSON
// output. entry_date is nullable; NULL stays JSON null, not the string "null".
function projectEntryDate<T extends { entry_date?: unknown }>(row: T) {
  if (!isSet(row.entry_date)) return row;
  return { ...row, entry_date: dayString(row.entry_date) };
}

// exercise_entries dumps (`SELECT ee.*`/`SELECT *`, used by the diary, recent,
// and usage tools) carry audit/ownership columns and internal surrogate keys.
// `id` (edit/delete) and `exercise_id` (lookups / re-logging) are kept, as are
// populated metrics and the denormalized catalog fields.
const EXERCISE_ENTRY_DROP: readonly string[] = [
  'user_id',
  'created_at',
  'updated_at',
  'created_by_user_id',
  'updated_by_user_id',
  'workout_plan_assignment_id',
  'exercise_preset_entry_id',
  'sort_order',
];
// exercise_entry_sets dumps (`SELECT *`): audit timestamps and per-set
// completion timestamps are token noise for the chatbot.
// `exercise_entry_id` is kept so the model can map sets back to their entry.
const EXERCISE_SET_DROP: readonly string[] = [
  'created_at',
  'updated_at',
  'completed_at',
];
// exercises catalog rows (sparky_list_exercises) — drop the redundant caller id
// and audit columns; keep descriptive catalog fields.
const EXERCISE_CATALOG_DROP: readonly string[] = [
  'user_id',
  'created_at',
  'updated_at',
  'created_by_user_id',
  'updated_by_user_id',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function projectExerciseEntry(row: any) {
  return compactRecord(projectEntryDate(row), EXERCISE_ENTRY_DROP);
}

// The column set MCP's exercise search exposed; richer server rows are
// projected down to it so the chat-visible output stays identical.
function projectExercise(row: any) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    muscle_groups: row.primary_muscles,
    equipment: row.equipment,
    level: row.level,
    calories_per_hour: row.calories_per_hour,
    description: row.description,
    is_custom: row.is_custom,
  };
}

// Case-insensitive exact name lookup (MCP's `name ILIKE $1` without
// wildcards). The server search returns substring matches; the exact match,
// when present, is always among them.
async function findExerciseByExactName(userId: string, name: string) {
  const rows = await exerciseService.searchExercises(
    userId,
    name,
    userId,
    undefined,
    undefined
  );
  return rows.find(
    (e: any) => String(e.name).toLowerCase() === name.toLowerCase()
  );
}

// Full details for one exercise by id or name, projected to MCP's shape.
// Throws "not found" errors for the callers' catch blocks to map.
async function getExerciseDetails(
  userId: string,
  params: { exercise_id?: string; exercise_name?: string }
) {
  let row: any;
  if (params.exercise_id) {
    row = await exerciseService.getExerciseById(userId, params.exercise_id);
  } else if (params.exercise_name) {
    row = await findExerciseByExactName(userId, params.exercise_name);
  } else {
    throw new Error('Either exercise_id or exercise_name must be provided');
  }
  if (!row) {
    throw new Error('Exercise not found');
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    muscle_groups: safeParseJson(row.primary_muscles),
    equipment: safeParseJson(row.equipment),
    level: row.level,
    calories_per_hour: row.calories_per_hour,
    description: row.description,
    is_custom: row.is_custom,
    instructions: safeParseJson(row.instructions),
    images: safeParseJson(row.images),
  };
}

interface ProgressDay {
  entry_date: string;
  max_weight: number | null;
  max_reps: number | null;
  total_volume: number | null;
}

// Per-date set aggregates for one exercise, paginated over the grouped days.
// Mirrors MCP's GROUP BY query: days whose entries have no sets are excluded,
// MAX/SUM skip null reps/weights, and volume counts null weights as 0.
async function getExerciseProgress(
  userId: string,
  params: {
    exercise_id?: string;
    exercise_name?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }
): Promise<PaginatedResult<ProgressDay>> {
  let exerciseId = params.exercise_id;
  if (!exerciseId && params.exercise_name) {
    const exercise = await findExerciseByExactName(
      userId,
      params.exercise_name
    );
    exerciseId = exercise?.id;
  }
  if (!exerciseId) throw new Error('Exercise not found');

  const entries = await exerciseService.getExerciseProgressData(
    userId,
    exerciseId,
    params.start_date || '1970-01-01',
    params.end_date || '9999-12-31'
  );

  // Repository rows arrive in entry_date ASC order; the Map keeps it.
  const byDate = new Map<string, ProgressDay>();
  for (const entry of entries) {
    const sets: ExerciseSetRow[] = entry.sets ?? [];
    if (sets.length === 0) continue;
    const key = dayString(entry.entry_date);
    let day = byDate.get(key);
    if (!day) {
      day = {
        entry_date: key,
        max_weight: null,
        max_reps: null,
        total_volume: null,
      };
      byDate.set(key, day);
    }
    for (const s of sets) {
      if (isSet(s.weight)) {
        const weight = Number(s.weight);
        day.max_weight = isSet(day.max_weight)
          ? Math.max(day.max_weight, weight)
          : weight;
      }
      if (isSet(s.reps)) {
        day.max_reps = isSet(day.max_reps)
          ? Math.max(day.max_reps, s.reps)
          : s.reps;
        day.total_volume =
          (day.total_volume ?? 0) +
          s.reps * (isSet(s.weight) ? Number(s.weight) : 0);
      }
    }
  }

  const days = [...byDate.values()];
  const { limit, offset } = normalizePagination(params.limit, params.offset);
  return buildPaginatedResult(
    days.slice(offset, offset + limit),
    days.length,
    offset
  );
}

// Standalone domain tools.
const exerciseDateRangeSchema = z.object({
  date: optionalDateSchema,
  start_date: optionalDateSchema,
  end_date: optionalDateSchema,
});

const exercisePaginationSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

const listExercisesSchema = exercisePaginationSchema.extend({
  search: z.string().optional(),
});

const getExerciseDetailsSchema = z.object({
  exercise_id: z.string().optional(),
  exercise_name: z.string().optional(),
});

const searchExercisesSchema = exercisePaginationSchema.extend({
  query: z.string().min(1),
  muscle_group: z.string().optional(),
  equipment: z.string().optional(),
});

const recentExerciseEntriesSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});

const exerciseUsageSchema = exerciseDateRangeSchema
  .merge(exercisePaginationSchema)
  .extend({
    exercise_id: z.string().min(1),
  });

const exerciseProgressSchema = exerciseDateRangeSchema
  .merge(exercisePaginationSchema)
  .extend({
    exercise_id: z.string().optional(),
    exercise_name: z.string().optional(),
  });

export function buildExerciseTools(userId: string, tz: string) {
  return {
    sparky_manage_exercise: tool({
      description: `Fitness tracking: search exercises, log workouts with sets, manage presets.

Actions:
- search_exercises(searchTerm, muscleGroup?, equipment?, limit?, offset?)
- create_exercise(name, category?, calories_per_hour?, description?)
- log_exercise(entry_date, exercise_id?|exercise_name?, duration_minutes?, calories_burned?, notes?, distance?, avg_heart_rate?, steps?, sets?:JSON string or array of [{reps,weight,duration_seconds,rest_time,set_type,rpe,notes}]) — distance/avg_heart_rate/steps are for cardio
- list_exercise_diary(entry_date)
- get_workout_presets(preset_id?|preset_name?) — no argument lists every preset; either argument returns that one preset with its full prescription
- log_workout_preset(entry_date, preset_id?|preset_name?)
- update_exercise_entry(entry_id, entry_date?, duration_minutes?, calories_burned?, notes?, distance?, avg_heart_rate?, steps?, sets?) — only the provided fields change; sets, when provided, replace all existing sets
- delete_exercise_entry(entry_id)
- get_exercise_details(exercise_id?|exercise_name?)
- create_workout_preset(name, description?, is_public?, exercises?|exercise_ids?) — exercises is the full prescription: [{exercise_id?|exercise_name?, sort_order?, superset_group?, sets?:[{set_number?,set_type?,reps?,weight?,duration_seconds?,rest_time?,notes?}]}], as an array or JSON string. exercise_ids is a shorthand for a preset with no sets; give one or the other, not both. An exercise_name with no match is created. Exercises sharing a superset_group integer are performed as a superset
- update_workout_preset(preset_id?|preset_name?, name?, description?, is_public?, exercises?) — exercises REPLACES every exercise and set in the preset; omit it to rename without touching the prescription
- delete_workout_preset(preset_id?|preset_name?)
- get_exercise_progress(exercise_id?|exercise_name?, start_date?, end_date?, limit?, offset?) — returns paginated performance history

Units, everywhere: weight is kg; duration_seconds and rest_time are SECONDS (a 30s hold is 30). duration_minutes, on the entry itself, is minutes.
Workout preset IDs are integers; exercise IDs are UUIDs.
set_type accepts: Normal, Working Set, Warm-up, Drop Set, Failure, AMRAP, Back-off, Rest-Pause, Cluster, Technique.`,
      inputSchema: manageExerciseInput,
      execute: async (rawArgs) => {
        const normalized = normalizeActionArgs(
          rawArgs,
          tz,
          VALID_ACTIONS,
          (args) => {
            if (args.searchTerm) {
              return 'search_exercises';
            }
            if (args.sets || args.duration_minutes || args.calories_burned) {
              return 'log_exercise';
            }
            if (args.preset_id || args.preset_name) {
              return 'log_workout_preset';
            }
            if (args.entry_id) {
              return 'update_exercise_entry';
            }
            if (args.start_date || args.end_date) {
              return 'get_exercise_progress';
            }
            if (args.entry_date) {
              return 'list_exercise_diary';
            }
            return 'list_exercise_diary'; // fallback
          }
        ) as any;

        // Default missing entry_date to today's date string for logging actions
        const loggingActions = ['log_exercise', 'log_workout_preset'];
        if (
          normalized.entry_date === undefined &&
          loggingActions.includes(normalized.action)
        ) {
          normalized.entry_date = todayInZone(tz);
        }

        const parsed = manageExerciseSchema.safeParse(normalized);
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        const args: ManageExerciseInput = parsed.data;
        try {
          switch (args.action) {
            case 'search_exercises': {
              const { limit, offset } = normalizePagination(
                args.limit,
                args.offset
              );
              const { exercises, totalCount } =
                await exerciseService.searchExercisesPaginated(
                  userId,
                  args.searchTerm,
                  userId,
                  args.equipment ? [args.equipment] : undefined,
                  args.muscleGroup ? [args.muscleGroup] : undefined,
                  limit,
                  offset
                );
              const result = buildPaginatedResult(
                exercises.map(projectExercise),
                totalCount,
                offset
              );
              return formatList(
                result.data,
                `Exercise Search: "${args.searchTerm}"`,
                (e: any) =>
                  `**${e.name}** (${e.category || 'Uncategorized'})\n  Muscles: ${e.muscle_groups?.join(', ') || 'N/A'} | Equipment: ${e.equipment?.join(', ') || 'None'}\n  ID: ${e.id}`,
                {
                  total_count: result.total_count,
                  has_more: result.has_more,
                  next_offset: result.next_offset,
                }
              );
            }

            case 'create_exercise': {
              // MCP returned the existing exercise (same confirmation text)
              // when one already matched the name case-insensitively.
              const existing = await findExerciseByExactName(userId, args.name);
              const exercise =
                existing ??
                (await exerciseService.createExercise(userId, {
                  name: args.name,
                  category: args.category || 'custom',
                  calories_per_hour: args.calories_per_hour || 300,
                  description: args.description || null,
                  is_custom: true,
                  shared_with_public: false,
                  source: 'manual',
                }));
              return formatConfirmation(`Exercise "${exercise.name}" created.`);
            }

            case 'log_exercise': {
              if (!args.exercise_id && !args.exercise_name) {
                args.exercise_name = 'General Exercise';
              }
              // Parse sets if it arrives as a JSON string (LLM serialisation quirk)
              let parsedSets: ExerciseSetInput[] | undefined;
              if (typeof args.sets === 'string') {
                try {
                  parsedSets = JSON.parse(args.sets);
                } catch {
                  parsedSets = undefined;
                }
              } else {
                parsedSets = args.sets;
              }
              let exerciseId = args.exercise_id;
              if (!exerciseId && args.exercise_name) {
                exerciseId = (
                  await resolveExerciseByName(userId, args.exercise_name)
                ).id;
              }
              // skipDuplicateCheck: logging the same exercise twice in a day
              // must create two entries (MCP always inserted), not merge into
              // the server's manual same-exercise/same-date upsert.
              await exerciseService.createExerciseEntry(
                userId,
                userId,
                {
                  exercise_id: exerciseId,
                  entry_date: args.entry_date,
                  entry_time: args.entry_time,
                  duration_minutes: args.duration_minutes,
                  calories_burned: args.calories_burned,
                  notes: args.notes,
                  distance: args.distance,
                  avg_heart_rate: args.avg_heart_rate,
                  steps: args.steps,
                  sets: parsedSets ? toRepoSets(parsedSets) : undefined,
                },
                { skipDuplicateCheck: true }
              );
              return formatConfirmation(
                `Exercise logged for ${args.entry_date}.`
              );
            }

            case 'list_exercise_diary': {
              const grouped = await exerciseService.getExerciseEntriesByDate(
                userId,
                userId,
                args.entry_date
              );
              // Flatten preset sessions into their member entries and render
              // the flat per-entry list MCP produced (created_at ASC).
              const entries = grouped
                .flatMap((item: any) =>
                  item.type === 'preset' ? item.exercises : [item]
                )
                .sort(
                  (a: any, b: any) =>
                    new Date(a.created_at).getTime() -
                    new Date(b.created_at).getTime()
                );
              return formatList(
                entries,
                `Exercise Diary: ${args.entry_date}`,
                (e: any) => {
                  let text = `**${e.name}**`;
                  const sets: ExerciseSetRow[] = e.sets ?? [];
                  if (sets.length > 0) text += ` — ${sets.length} sets`;
                  if (e.duration_minutes)
                    text += ` | ${e.duration_minutes} min`;
                  if (e.calories_burned) text += ` | ${e.calories_burned} kcal`;
                  if (isSet(e.distance)) text += ` | ${e.distance} dist`;
                  if (isSet(e.avg_heart_rate))
                    text += ` | ${e.avg_heart_rate} bpm`;
                  if (isSet(e.steps)) text += ` | ${e.steps} steps`;
                  if (sets.length > 0) {
                    const setLine = sets
                      .map((s) => {
                        const parts: string[] = [];
                        if (isSet(s.reps)) parts.push(`${s.reps}r`);
                        if (isSet(s.weight)) parts.push(`${s.weight}kg`);
                        // The column is minutes; this surface reports seconds.
                        if (isSet(s.duration))
                          parts.push(`${minutesToSeconds(s.duration)}s`);
                        if (isSet(s.rpe)) parts.push(`RPE ${s.rpe}`);
                        let str = parts.join('×');
                        if (isSet(s.rest_time))
                          str += ` (rest ${s.rest_time}s)`;
                        if (s.notes) str += ` (${s.notes})`;
                        return str;
                      })
                      .filter(Boolean)
                      .join('; ');
                    if (setLine) text += `\n  Sets: ${setLine}`;
                  }
                  if (e.notes) text += `\n  Notes: ${e.notes}`;
                  text += `\n  ID: ${e.id}`;
                  return text;
                }
              );
            }

            case 'get_workout_presets': {
              if (args.preset_id || args.preset_name) {
                const preset = await findPreset(userId, args);
                if (!preset) {
                  return ERRORS.NOT_FOUND(
                    'Workout preset',
                    String(args.preset_id ?? args.preset_name)
                  );
                }
                return formatList([preset], 'Workout Preset', formatPreset);
              }
              const { presets } = await workoutPresetService.getWorkoutPresets(
                userId,
                1,
                1000
              );
              return formatList(presets, 'Workout Presets', formatPreset);
            }

            case 'log_workout_preset': {
              if (!args.preset_id && !args.preset_name) {
                return ERRORS.VALIDATION(
                  'Either preset_id or preset_name must be provided'
                );
              }
              let presetId = args.preset_id;
              if (!presetId && args.preset_name) {
                const preset =
                  await workoutPresetService.getWorkoutPresetByName(
                    userId,
                    args.preset_name
                  );
                if (!preset) {
                  return ERRORS.NOT_FOUND('Resource', 'unknown');
                }
                presetId = preset.id;
              }
              const session = await exerciseService.logWorkoutPresetGrouped(
                userId,
                userId,
                presetId,
                args.entry_date
              );
              return formatConfirmation(
                `Workout preset logged for ${args.entry_date}. ${session?.exercises.length ?? 0} exercises added.`
              );
            }

            case 'update_exercise_entry': {
              // Parse sets if it arrives as a JSON string, matching log_exercise.
              let parsedSets: ExerciseSetInput[] | undefined;
              if (typeof args.sets === 'string') {
                try {
                  parsedSets = JSON.parse(args.sets);
                } catch {
                  return ERRORS.VALIDATION('Invalid JSON format for sets');
                }
              } else {
                parsedSets = args.sets;
              }
              try {
                await exerciseService.updateExerciseEntry(
                  userId,
                  userId,
                  args.entry_id,
                  {
                    entry_date: args.entry_date,
                    entry_time: args.entry_time,
                    duration_minutes: args.duration_minutes,
                    calories_burned: args.calories_burned,
                    notes: args.notes,
                    distance: args.distance,
                    avg_heart_rate: args.avg_heart_rate,
                    steps: args.steps,
                    sets: parsedSets ? toRepoSets(parsedSets) : undefined,
                  }
                );
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message.includes('not found')
                ) {
                  return ERRORS.NOT_FOUND('Exercise Entry', args.entry_id);
                }
                throw error;
              }
              return formatConfirmation('Exercise entry updated.');
            }

            case 'delete_exercise_entry': {
              try {
                await exerciseService.deleteExerciseEntry(
                  userId,
                  args.entry_id
                );
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message.includes('not found')
                ) {
                  return ERRORS.NOT_FOUND('Exercise Entry', args.entry_id);
                }
                throw error;
              }
              return formatConfirmation('Exercise entry deleted.');
            }

            case 'get_exercise_details': {
              const exercise = await getExerciseDetails(userId, {
                exercise_id: args.exercise_id,
                exercise_name: args.exercise_name,
              });
              let text = `### ${exercise.name}\n\n`;
              if (exercise.description) text += `*${exercise.description}*\n\n`;
              text += `**Category:** ${exercise.category}\n`;
              text += `**Equipment:** ${exercise.equipment?.join(', ') || 'None'}\n`;
              text += `**Muscles:** ${exercise.muscle_groups?.join(', ') || 'N/A'}\n\n`;

              if (exercise.instructions && exercise.instructions.length > 0) {
                text += '#### Instructions\n';
                exercise.instructions.forEach((ins, i) => {
                  text += `${i + 1}. ${ins}\n`;
                });
              }

              return text;
            }

            case 'create_workout_preset': {
              if (args.exercises && args.exercise_ids) {
                return ERRORS.VALIDATION(
                  'Provide either exercises (with sets) or exercise_ids (shorthand), not both'
                );
              }
              if (!args.exercises && !args.exercise_ids) {
                return ERRORS.VALIDATION(
                  'Either exercises or exercise_ids must be provided'
                );
              }
              const input: PresetExerciseInput[] =
                parsePresetExercises(args.exercises) ??
                (args.exercise_ids ?? []).map((id) => ({ exercise_id: id }));
              const { exercises, createdNames } = await buildPresetExercises(
                userId,
                input
              );
              const preset = await workoutPresetService.createWorkoutPreset(
                userId,
                {
                  user_id: userId,
                  name: args.name,
                  description: args.description ?? null,
                  is_public: args.is_public ?? false,
                  exercises,
                }
              );
              return presetWritten('created', preset, createdNames);
            }

            case 'update_workout_preset': {
              if (!args.preset_id && !args.preset_name) {
                return ERRORS.VALIDATION(
                  'Either preset_id or preset_name must be provided'
                );
              }
              const existing = await findPreset(userId, args);
              if (!existing) {
                return ERRORS.NOT_FOUND(
                  'Workout preset',
                  String(args.preset_id ?? args.preset_name ?? 'unknown')
                );
              }
              const input = parsePresetExercises(args.exercises);
              // Omitted exercises must stay omitted, not become []: the repo
              // only rewrites the exercise rows when the key is present.
              const built = input
                ? await buildPresetExercises(userId, input)
                : { exercises: undefined, createdNames: [] };
              const preset = await workoutPresetService.updateWorkoutPreset(
                userId,
                existing.id,
                {
                  name: args.name,
                  description: args.description,
                  is_public: args.is_public,
                  exercises: built.exercises,
                }
              );
              return presetWritten('updated', preset, built.createdNames);
            }

            case 'delete_workout_preset': {
              if (!args.preset_id && !args.preset_name) {
                return ERRORS.VALIDATION(
                  'Either preset_id or preset_name must be provided'
                );
              }
              const existing = await findPreset(userId, args);
              if (!existing) {
                return ERRORS.NOT_FOUND(
                  'Workout preset',
                  String(args.preset_id ?? args.preset_name ?? 'unknown')
                );
              }
              await workoutPresetService.deleteWorkoutPreset(
                userId,
                existing.id
              );
              return formatConfirmation(
                `Workout preset "${existing.name}" deleted.`
              );
            }

            case 'get_exercise_progress': {
              const progress = await getExerciseProgress(userId, {
                exercise_id: args.exercise_id,
                exercise_name: args.exercise_name,
                start_date: args.start_date,
                end_date: args.end_date,
                limit: args.limit,
                offset: args.offset,
              });
              return formatList(
                progress.data,
                `Exercise Progress: ${args.exercise_name || args.exercise_id}`,
                (p: any) =>
                  `**${p.entry_date}**: Max Weight: ${p.max_weight}kg | Max Reps: ${p.max_reps} | Volume: ${p.total_volume}kg`,
                {
                  total_count: progress.total_count,
                  has_more: progress.has_more,
                  next_offset: progress.next_offset,
                }
              );
            }

            default:
              return ERRORS.INVALID_ACTION(
                String((args as any).action),
                VALID_ACTIONS
              );
          }
        } catch (error) {
          if (error instanceof ToolValidationError) {
            return ERRORS.VALIDATION(error.message);
          }
          log('error', '[Exercise Tool] Error:', error);
          if (error instanceof Error && error.message.startsWith('Forbidden')) {
            return ERRORS.FORBIDDEN(error.message);
          }
          // The preset service names the exercise it couldn't resolve; passing
          // that through beats a generic "Resource with ID 'unknown'" when a
          // preset references an exercise that isn't there.
          const unresolved =
            error instanceof Error
              ? /^Exercise with ID (.+?) not found/.exec(error.message)
              : null;
          if (unresolved) {
            return ERRORS.NOT_FOUND('Exercise', unresolved[1]);
          }
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND('Resource', 'unknown');
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_list_exercises: tool({
      description:
        'Returns a paginated exercise catalog for the authenticated user.',
      inputSchema: listExercisesSchema,
      execute: async (rawArgs) => {
        const parsed = listExercisesSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const { limit, offset } = normalizePagination(
            parsed.data.limit,
            parsed.data.offset
          );
          const search = parsed.data.search?.trim() || undefined;
          const [rows, totalCount] = await Promise.all([
            exerciseDb.getExercisesWithPagination(
              userId,
              search,
              null,
              null,
              null,
              null,
              limit,
              offset
            ),
            exerciseDb.countExercises(userId, search, null, null, null, null),
          ]);
          const data = buildPaginatedResult(
            rows.map((r: Record<string, unknown>) =>
              compactRecord(r, EXERCISE_CATALOG_DROP)
            ),
            totalCount,
            offset
          );
          return formatJsonResult(data);
        } catch (error) {
          log('error', '[Exercise Tool] sparky_list_exercises error:', error);
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND('Exercise', 'unknown');
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_exercise_details: tool({
      description:
        'Returns full details for one exercise by exercise_id or exercise_name.',
      inputSchema: getExerciseDetailsSchema,
      execute: async (rawArgs) => {
        const parsed = getExerciseDetailsSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const data = await getExerciseDetails(userId, parsed.data);
          return formatJsonResult(data);
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_exercise_details error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND(
              'Exercise',
              parsed.data.exercise_id || parsed.data.exercise_name || 'unknown'
            );
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_search_exercises: tool({
      description: 'Searches exercises by name and optional filters.',
      inputSchema: searchExercisesSchema,
      execute: async (rawArgs) => {
        const parsed = searchExercisesSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const args = parsed.data;
          const { limit, offset } = normalizePagination(
            args.limit,
            args.offset
          );
          const { exercises, totalCount } =
            await exerciseService.searchExercisesPaginated(
              userId,
              args.query,
              userId,
              args.equipment ? [args.equipment] : undefined,
              args.muscle_group ? [args.muscle_group] : undefined,
              limit,
              offset
            );
          const data = buildPaginatedResult(
            exercises.map(projectExercise),
            totalCount,
            offset
          );
          return formatJsonResult(data);
        } catch (error) {
          log('error', '[Exercise Tool] sparky_search_exercises error:', error);
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND('Exercise', parsed.data.query);
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_exercise_diary: tool({
      description:
        'Returns entry-level exercise diary data for a specific date or date range.',
      inputSchema: exerciseDateRangeSchema,
      execute: async (rawArgs) => {
        const parsed = exerciseDateRangeSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const { startDate, endDate } = exerciseDateRange(parsed.data, tz);
          const { entries, sets } = await exerciseEntryDb.getExerciseDiaryRange(
            userId,
            startDate,
            endDate
          );
          const data = {
            start_date: startDate,
            end_date: endDate,
            entries: entries.map(projectExerciseEntry),
            sets: sets.map((s: Record<string, unknown>) =>
              compactRecord(s, EXERCISE_SET_DROP)
            ),
          };
          return formatJsonResult(data);
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_exercise_diary error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND(
              'Exercise diary',
              parsed.data.date || parsed.data.start_date || 'unknown'
            );
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_daily_exercise_totals: tool({
      description: 'Returns daily exercise totals for a date or range.',
      inputSchema: exerciseDateRangeSchema,
      execute: async (rawArgs) => {
        const parsed = exerciseDateRangeSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const { startDate, endDate } = exerciseDateRange(parsed.data, tz);
          const rows = await exerciseEntryDb.getDailyExerciseTotalsRange(
            userId,
            startDate,
            endDate
          );
          const data = {
            start_date: startDate,
            end_date: endDate,
            rows: rows.map(projectEntryDate),
          };
          return formatJsonResult(data);
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_daily_exercise_totals error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND(
              'Exercise totals',
              parsed.data.date || parsed.data.start_date || 'unknown'
            );
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_recent_exercise_entries: tool({
      description:
        'Returns recent entry-level exercise diary rows for the authenticated user.',
      inputSchema: recentExerciseEntriesSchema,
      execute: async (rawArgs) => {
        const parsed = recentExerciseEntriesSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const limit = Math.min(Math.max(parsed.data.limit ?? 50, 1), 200);
          const rows = await exerciseEntryDb.getRecentExerciseEntries(
            userId,
            limit
          );
          return formatJsonResult(rows.map(projectExerciseEntry));
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_recent_exercise_entries error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND('Exercise entries', 'recent');
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_exercise_usage: tool({
      description:
        'Shows where a specific exercise_id was used in the exercise diary.',
      inputSchema: exerciseUsageSchema,
      execute: async (rawArgs) => {
        const parsed = exerciseUsageSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const { exercise_id, ...query } = parsed.data;
          const { startDate, endDate } = exerciseDateRange(query, tz);
          const { limit, offset } = normalizePagination(
            query.limit,
            query.offset
          );
          const { rows, totalCount } = await exerciseEntryDb.getExerciseUsage(
            userId,
            exercise_id,
            startDate,
            endDate,
            limit,
            offset
          );
          const data = buildPaginatedResult(
            rows.map(projectExerciseEntry),
            totalCount,
            offset
          );
          return formatJsonResult(data);
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_exercise_usage error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND('Exercise', parsed.data.exercise_id);
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_exercise_progress: tool({
      description: 'Returns paginated performance history for an exercise.',
      inputSchema: exerciseProgressSchema,
      execute: async (rawArgs) => {
        const parsed = exerciseProgressSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const data = await getExerciseProgress(userId, parsed.data);
          return formatJsonResult(data);
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_exercise_progress error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND(
              'Exercise',
              parsed.data.exercise_id || parsed.data.exercise_name || 'unknown'
            );
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
  };
}
