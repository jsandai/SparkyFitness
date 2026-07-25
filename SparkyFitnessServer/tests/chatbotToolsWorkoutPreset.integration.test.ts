/**
 * Workout-preset authoring through the AI tool layer — integration test.
 *
 * WHY THIS EXISTS
 * ---------------
 * The rest of the chatbot-tool suite mocks the service and repository, so it can
 * prove the handler *builds* the right payload but never that the prescription
 * actually lands in Postgres. The bug this feature fixes was exactly that kind
 * of gap: the persistence layer had supported sets and supersets all along, and
 * the tool layer was silently dropping them on the way down.
 *
 * So this test runs the real thing: real service, real repository, real
 * Postgres, no mocks. It authors the 6 presets of the kettlebell 12-week program
 * (Workout A & B x 3 phases) purely through `sparky_manage_exercise` tool calls
 * and reads them back through the same tool, asserting that sets, reps,
 * durations, rest and superset grouping all survive the round trip.
 *
 * HOW TO RUN
 * ----------
 * Like the other integration tests here, it runs automatically whenever a
 * database is reachable (creds from ../.env) and SKIPS cleanly when one isn't,
 * so the mocked unit suite and DB-less contributors are unaffected. It seeds and
 * removes only its own synthetic user. Do NOT point it at production data.
 */
import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';
import { buildExerciseTools } from '../ai/tools/exerciseTools.js';

async function testDbReachable(): Promise<boolean> {
  if (process.env.SKIP_PRESET_INTEGRATION === '1') return false;
  if (
    !process.env.SPARKY_FITNESS_APP_DB_USER ||
    !process.env.SPARKY_FITNESS_DB_HOST
  ) {
    return false;
  }
  const probe = new pg.Client({
    host: process.env.SPARKY_FITNESS_DB_HOST,
    port: Number(process.env.SPARKY_FITNESS_DB_PORT) || 5432,
    database: process.env.SPARKY_FITNESS_DB_NAME,
    user: process.env.SPARKY_FITNESS_APP_DB_USER,
    password: process.env.SPARKY_FITNESS_APP_DB_PASSWORD,
    connectionTimeoutMillis: 2000,
  });
  try {
    await probe.connect();
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

const RUN = await testDbReachable();

const USER = '00000000-0000-4000-b000-0000000000a1';
const opts = { toolCallId: 'tc-preset', messages: [] };

// "Run it as supersets — do the paired exercises (1a then 1b) back-to-back,
// rest 60-90s" (kettlebell-12-week-program.md). Pairs are (1,2) and (3,4); the
// carry/core finisher stands alone.
const REST = 90;
const PAIR_1 = 1;
const PAIR_2 = 2;

interface Move {
  name: string;
  sets: number;
  reps?: number;
  hold?: number; // seconds
  group: number | null;
}

const PROGRAM: { preset: string; moves: Move[] }[] = [
  {
    preset: 'KB A — Foundation',
    moves: [
      { name: 'Double KB Front Squat', sets: 3, reps: 6, group: PAIR_1 },
      { name: 'Dip — Support Hold', sets: 3, hold: 15, group: PAIR_1 },
      { name: 'Double KB Overhead Press', sets: 3, reps: 5, group: PAIR_2 },
      { name: 'Push-up', sets: 2, reps: 8, group: PAIR_2 },
      { name: 'Suitcase Carry', sets: 2, hold: 30, group: null },
    ],
  },
  {
    preset: 'KB B — Foundation',
    moves: [
      { name: 'Double KB Swing', sets: 3, reps: 12, group: PAIR_1 },
      { name: 'Dead Hang', sets: 3, hold: 15, group: PAIR_1 },
      { name: 'Double KB Romanian Deadlift', sets: 3, reps: 8, group: PAIR_2 },
      { name: 'Single-Arm KB Row', sets: 3, reps: 8, group: PAIR_2 },
      { name: 'Plank', sets: 2, hold: 20, group: null },
    ],
  },
  {
    preset: 'KB A — Build',
    moves: [
      { name: 'Double KB Front Squat', sets: 3, reps: 10, group: PAIR_1 },
      { name: 'Dip — Negatives / Assisted', sets: 3, reps: 5, group: PAIR_1 },
      { name: 'Double KB Overhead Press', sets: 3, reps: 8, group: PAIR_2 },
      { name: 'Push-up', sets: 3, reps: 10, group: PAIR_2 },
      { name: 'Suitcase Carry', sets: 2, hold: 40, group: null },
    ],
  },
  {
    preset: 'KB B — Build',
    moves: [
      { name: 'Double KB Swing', sets: 3, reps: 15, group: PAIR_1 },
      {
        name: 'Pull-up — Ring Rows / Negatives',
        sets: 3,
        reps: 6,
        group: PAIR_1,
      },
      { name: 'Double KB Romanian Deadlift', sets: 3, reps: 10, group: PAIR_2 },
      { name: 'Single-Arm KB Row', sets: 3, reps: 10, group: PAIR_2 },
      { name: 'Hollow Hold', sets: 2, hold: 30, group: null },
    ],
  },
  {
    preset: 'KB A — Intensify',
    moves: [
      {
        name: 'Double KB Front Squat (tempo)',
        sets: 3,
        reps: 10,
        group: PAIR_1,
      },
      { name: 'Full Dip', sets: 3, reps: 5, group: PAIR_1 },
      {
        name: 'Double KB Overhead Press (tempo)',
        sets: 3,
        reps: 8,
        group: PAIR_2,
      },
      { name: 'Push-up (or Ring Push-up)', sets: 3, reps: 12, group: PAIR_2 },
      { name: 'Suitcase Carry', sets: 2, hold: 40, group: null },
    ],
  },
  {
    preset: 'KB B — Intensify',
    moves: [
      { name: 'Double KB Swing', sets: 3, reps: 15, group: PAIR_1 },
      { name: 'Full Pull-up', sets: 3, reps: 5, group: PAIR_1 },
      {
        name: 'Double KB Romanian Deadlift (tempo)',
        sets: 3,
        reps: 10,
        group: PAIR_2,
      },
      { name: 'Single-Arm KB Row', sets: 3, reps: 10, group: PAIR_2 },
      { name: 'Hollow Hold', sets: 2, hold: 40, group: null },
    ],
  },
];

// The tool call an LLM would actually make from the program document.
function toolExercises(moves: Move[]) {
  return moves.map((m) => ({
    exercise_name: m.name,
    superset_group: m.group,
    sets: Array.from({ length: m.sets }, () => ({
      reps: m.reps,
      duration_seconds: m.hold,
      rest_time: REST,
    })),
  }));
}

describe.runIf(RUN)('workout preset authoring via MCP tools', () => {
  let tools: ReturnType<typeof buildExerciseTools>;

  beforeAll(async () => {
    const sys = await getSystemClient();
    try {
      await sys.query(
        'INSERT INTO public."user" (id, email, email_verified) VALUES ($1, $2, true) ON CONFLICT (id) DO NOTHING',
        [USER, 'kb-preset@example.test']
      );
    } finally {
      sys.release();
    }
    tools = buildExerciseTools(USER, 'UTC');
  });

  afterAll(async () => {
    const sys = await getSystemClient();
    try {
      await sys.query('DELETE FROM public.workout_presets WHERE user_id = $1', [
        USER,
      ]);
      await sys.query('DELETE FROM public.exercises WHERE user_id = $1', [
        USER,
      ]);
      await sys.query('DELETE FROM public."user" WHERE id = $1', [USER]);
    } finally {
      sys.release();
    }
    await endPool();
  });

  it('authors all 6 kettlebell presets and reads the full prescription back', async () => {
    for (const { preset, moves } of PROGRAM) {
      const result = await tools.sparky_manage_exercise.execute!(
        {
          action: 'create_workout_preset',
          name: preset,
          description: 'Kettlebell 12-week program',
          exercises: toolExercises(moves),
        },
        opts
      );
      expect(result, `create ${preset}`).toContain(
        `Workout preset "${preset}" created`
      );
    }

    const listed = await tools.sparky_manage_exercise.execute!(
      { action: 'get_workout_presets' },
      opts
    );
    for (const { preset } of PROGRAM) {
      expect(listed, `${preset} in list`).toContain(preset);
    }

    // Spot-check one preset in full: every set, its reps/hold, its rest, and the
    // superset grouping must come back exactly as authored.
    const readBack = await tools.sparky_manage_exercise.execute!(
      { action: 'get_workout_presets', preset_name: 'KB A — Foundation' },
      opts
    );
    expect(readBack).toContain('**KB A — Foundation**');
    expect(readBack).toContain('1. Double KB Front Squat [superset A]');
    expect(readBack).toContain(
      '3 sets: 6r (rest 90s); 6r (rest 90s); 6r (rest 90s)'
    );
    // A 15-second support hold: sent as seconds, stored as 0.25 minutes, and
    // rendered back as seconds. The round trip is what pins the unit.
    expect(readBack).toContain('2. Dip — Support Hold [superset A]');
    expect(readBack).toContain('15s (rest 90s)');
    expect(readBack).toContain('3. Double KB Overhead Press [superset B]');
    expect(readBack).toContain('4. Push-up [superset B]');
    // The finisher is not supersetted with anything.
    expect(readBack).toContain('5. Suitcase Carry\n');
    expect(readBack).not.toContain('5. Suitcase Carry [superset');
  });

  it('persists sets, rest and superset_group to the database, in order', async () => {
    const sys = await getSystemClient();
    try {
      const { rows } = await sys.query(
        `SELECT e.name, wpe.sort_order, wpe.superset_group,
                count(s.id)::int AS set_count,
                min(s.reps)::int AS reps,
                min(s.rest_time)::int AS rest
           FROM workout_presets p
           JOIN workout_preset_exercises wpe ON wpe.workout_preset_id = p.id
           JOIN exercises e ON e.id = wpe.exercise_id
           LEFT JOIN workout_preset_exercise_sets s
             ON s.workout_preset_exercise_id = wpe.id
          WHERE p.user_id = $1 AND p.name = $2
          GROUP BY e.name, wpe.sort_order, wpe.superset_group
          ORDER BY wpe.sort_order`,
        [USER, 'KB B — Intensify']
      );

      expect(rows).toEqual([
        {
          name: 'Double KB Swing',
          sort_order: 0,
          superset_group: 1,
          set_count: 3,
          reps: 15,
          rest: 90,
        },
        {
          name: 'Full Pull-up',
          sort_order: 1,
          superset_group: 1,
          set_count: 3,
          reps: 5,
          rest: 90,
        },
        {
          name: 'Double KB Romanian Deadlift (tempo)',
          sort_order: 2,
          superset_group: 2,
          set_count: 3,
          reps: 10,
          rest: 90,
        },
        {
          name: 'Single-Arm KB Row',
          sort_order: 3,
          superset_group: 2,
          set_count: 3,
          reps: 10,
          rest: 90,
        },
        {
          name: 'Hollow Hold',
          sort_order: 4,
          superset_group: null,
          set_count: 2,
          reps: null,
          rest: 90,
        },
      ]);
    } finally {
      sys.release();
    }
  });

  it('stores a seconds hold as fractional minutes in the duration column', async () => {
    // The tool takes seconds; the column is minutes. This is the assertion that
    // pins the conversion — a 15s hold must be 0.25 in the DB, not 15.
    const sys = await getSystemClient();
    try {
      const { rows } = await sys.query(
        `SELECT s.duration
           FROM workout_presets p
           JOIN workout_preset_exercises wpe ON wpe.workout_preset_id = p.id
           JOIN exercises e ON e.id = wpe.exercise_id
           JOIN workout_preset_exercise_sets s
             ON s.workout_preset_exercise_id = wpe.id
          WHERE p.user_id = $1 AND p.name = $2 AND e.name = $3
          ORDER BY s.set_number
          LIMIT 1`,
        [USER, 'KB A — Foundation', 'Dip — Support Hold']
      );
      expect(Number(rows[0].duration)).toBe(0.25);
    } finally {
      sys.release();
    }
  });

  it('round-trips a hold whose seconds do not divide cleanly into minutes', async () => {
    // 31s is one of the 202 values in 1..7200 for which seconds/60*60 !== seconds
    // in floating point. Without rounding on the read side it comes back as
    // 31.000000000000004s. This is the regression test for that.
    await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_preset',
        name: 'Awkward Hold',
        exercises: [
          {
            exercise_name: 'Dead Hang',
            sets: [{ duration_seconds: 31, rest_time: 60 }],
          },
        ],
      },
      opts
    );

    const readBack = await tools.sparky_manage_exercise.execute!(
      { action: 'get_workout_presets', preset_name: 'Awkward Hold' },
      opts
    );

    expect(readBack).toContain('1 sets: 31s (rest 60s)');
    expect(readBack).not.toContain('31.0');
  });

  it('reuses an exercise it already created rather than duplicating it', async () => {
    // "Double KB Swing" appears in three presets; the name must resolve to the
    // one catalog row every time, or the user's exercise library fills with
    // near-duplicates and progress history splits across them.
    const sys = await getSystemClient();
    try {
      const { rows } = await sys.query(
        'SELECT count(*)::int AS n FROM exercises WHERE user_id = $1 AND name = $2',
        [USER, 'Double KB Swing']
      );
      expect(rows[0].n).toBe(1);
    } finally {
      sys.release();
    }
  });

  it('updates a preset in place, replacing the prescription', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'update_workout_preset',
        preset_name: 'KB A — Build',
        exercises: [
          {
            exercise_name: 'Double KB Front Squat',
            superset_group: 1,
            sets: [{ reps: 12, weight: 24, rest_time: 120 }],
          },
        ],
      },
      opts
    );

    expect(result).toContain('updated');
    expect(result).toContain('1 sets: 12r×24kg (rest 120s)');

    const readBack = await tools.sparky_manage_exercise.execute!(
      { action: 'get_workout_presets', preset_name: 'KB A — Build' },
      opts
    );
    // The other four exercises are gone: update replaces, it does not merge.
    expect(readBack).toContain('1 exercises');
    expect(readBack).not.toContain('Push-up');
  });

  it('renames a preset without touching its prescription', async () => {
    await tools.sparky_manage_exercise.execute!(
      {
        action: 'update_workout_preset',
        preset_name: 'KB B — Build',
        name: 'KB B — Build (v2)',
      },
      opts
    );

    const readBack = await tools.sparky_manage_exercise.execute!(
      { action: 'get_workout_presets', preset_name: 'KB B — Build (v2)' },
      opts
    );
    expect(readBack).toContain('5 exercises');
    expect(readBack).toContain('1. Double KB Swing [superset A]');
    expect(readBack).toContain('3 sets: 15r (rest 90s)');
  });

  it('deletes a preset it authored', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'delete_workout_preset', preset_name: 'KB A — Intensify' },
      opts
    );
    expect(result).toBe('✅ Workout preset "KB A — Intensify" deleted.');

    const listed = await tools.sparky_manage_exercise.execute!(
      { action: 'get_workout_presets' },
      opts
    );
    expect(listed).not.toContain('KB A — Intensify');
  });
});
