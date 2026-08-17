import {
  ACTIVITY_MULTIPLIERS,
  ENERGY_DENSITY_KCAL_PER_KG,
} from "../constants/calorieConstants.ts";

export type CalorieGoalAdjustmentMode =
  | "dynamic"
  | "fixed"
  | "percentage"
  | "tdee"
  | "smart"
  | "adaptive";

export type ExerciseCalorieSource = "logged" | "active" | "steps" | "none";

export interface ResolvedExerciseCalories {
  calories: number;
  source: ExerciseCalorieSource;
}

/** Derives active energy from total energy that includes resting energy. */
export function deriveActiveCalories(
  totalCalories: number,
  restingCalories: number,
): number | null {
  if (
    !Number.isFinite(totalCalories) ||
    !Number.isFinite(restingCalories) ||
    totalCalories < 0 ||
    restingCalories < 0
  ) {
    return null;
  }
  return Math.max(0, totalCalories - restingCalories);
}

/**
 * Returns the calorie contribution from the most complete source.
 * It compares:
 * 1. Summary "Active Calories" from a device (which usually includes steps + workouts).
 * 2. Logged individual workouts + estimated background steps.
 *
 * It returns whichever is larger to ensure we don't under-count, but avoids
 * double-counting by not adding steps on top of a device-wide "Active Calories" summary.
 */
export function resolveExerciseCalories(
  loggedExerciseCalories: number,
  activeCaloriesFromExercise: number,
  backgroundStepCalories: number,
): ResolvedExerciseCalories {
  const workoutPlusSteps = loggedExerciseCalories + backgroundStepCalories;

  if (
    activeCaloriesFromExercise > 0 &&
    activeCaloriesFromExercise >= workoutPlusSteps
  ) {
    return {
      calories: activeCaloriesFromExercise,
      source: "active",
    };
  }

  if (workoutPlusSteps > 0) {
    return {
      calories: workoutPlusSteps,
      source: loggedExerciseCalories > 0 ? "logged" : "steps",
    };
  }

  return { calories: 0, source: "none" };
}

/**
 * TDEE baseline: BMR × activity multiplier.
 */
export function computeSparkyfitnessBurned(
  bmr: number,
  activityLevel: string,
): number {
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] ?? 1.2;
  return Math.round(bmr * multiplier);
}

/**
 * Projects the current device burn rate to end-of-day.
 * Below MIN_DAY_FRACTION (5% of the day, ~72 min) we skip extrapolation
 * to avoid huge early-morning spikes.
 */
export function computeProjectedBurn(
  bmr: number,
  exerciseCaloriesBurned: number,
  now: Date = new Date(),
): number {
  const MIN_DAY_FRACTION = 0.05;
  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  const dayFraction = minutesSinceMidnight / (24 * 60);

  const projectedDeviceCalories =
    dayFraction >= MIN_DAY_FRACTION && exerciseCaloriesBurned > 0
      ? Math.round(exerciseCaloriesBurned / dayFraction)
      : exerciseCaloriesBurned;

  return bmr + projectedDeviceCalories;
}

/**
 * Adjustment = projected full-day burn minus the TDEE baseline.
 * Positive → device projects more activity than expected.
 * Negative → less active day (only returned when allowNegative is true).
 */
export function computeTdeeAdjustment(
  projectedBurn: number,
  sparkyfitnessBurned: number,
  allowNegative: boolean,
): number {
  const raw = projectedBurn - sparkyfitnessBurned;
  return allowNegative ? raw : Math.max(0, raw);
}

export interface CaloriesRemainingParams {
  mode: CalorieGoalAdjustmentMode;
  goalCalories: number;
  eatenCalories: number;
  netCalories: number;
  exerciseCaloriesBurned: number;
  bmrCalories: number;
  exerciseCaloriePercentage: number;
  tdeeAdjustment: number;
  adaptiveTdee?: number;
}

/**
 * Computes remaining calories based on the selected goal adjustment mode.
 */
export function computeCaloriesRemaining({
  mode,
  goalCalories,
  eatenCalories,
  netCalories,
  exerciseCaloriesBurned,
  bmrCalories,
  exerciseCaloriePercentage,
  tdeeAdjustment,
}: CaloriesRemainingParams): number {
  switch (mode) {
    case "adaptive":
      return goalCalories - eatenCalories;
    case "tdee":
    case "smart":
      return goalCalories - eatenCalories + tdeeAdjustment;
    case "dynamic":
      return goalCalories - netCalories;
    case "percentage": {
      const adjustedExerciseBurned =
        exerciseCaloriesBurned * (exerciseCaloriePercentage / 100);
      const adjustedTotalBurned = adjustedExerciseBurned + bmrCalories;
      return goalCalories - (eatenCalories - adjustedTotalBurned);
    }
    case "fixed":
    default:
      return goalCalories - eatenCalories;
  }
}

/**
 * How many calories exercise has added back to the budget.
 */
export function computeExerciseCredited(
  caloriesRemaining: number,
  goalCalories: number,
  eatenCalories: number,
): number {
  return Math.max(0, caloriesRemaining - (goalCalories - eatenCalories));
}

/**
 * Progress percentage (0–100+) towards the daily calorie goal.
 */
export function computeCalorieProgress(
  goalCalories: number,
  caloriesRemaining: number,
): number {
  const effectiveConsumed = goalCalories - caloriesRemaining;
  return Math.max(0, (effectiveConsumed / goalCalories) * 100);
}

/** A set row carrying per-set duration and rest, both in SECONDS. */
export interface TimedSetLike {
  duration?: number | null;
  rest_time?: number | null;
}

/**
 * Total workout minutes from per-set duration + rest (both integer seconds).
 * `fallbackMinutes` is returned when the sets sum to 0 or are absent,
 * preserving the legacy "empty preset defaults to 30 minutes" behavior.
 */
export function setsDurationMinutes(
  sets: readonly TimedSetLike[] | null | undefined,
  options?: { fallbackMinutes?: number },
): number {
  const rows = Array.isArray(sets) ? sets : [];
  const totalSeconds = rows.reduce(
    // Values flow through pg drivers and legacy call sites, so coerce defensively.
    (sum, set) =>
      sum + (Number(set.duration) || 0) + (Number(set.rest_time) || 0),
    0,
  );
  const minutes = totalSeconds / 60;
  if (minutes === 0 && options?.fallbackMinutes != null) {
    return options.fallbackMinutes;
  }
  return minutes;
}

/** A set row carrying per-set distance in KM. */
export interface DistanceSetLike {
  distance?: number | null;
}

/**
 * Total distance in km across sets, or null when no set carries one.
 * Distinguishing "no distance recorded" (null) from an explicit 0 lets
 * entry-total derivation preserve existing values for distance-less sets.
 */
export function setsDistanceKm(
  sets: readonly DistanceSetLike[] | null | undefined,
): number | null {
  const rows = Array.isArray(sets) ? sets : [];
  let total: number | null = null;
  for (const set of rows) {
    // Values flow through pg drivers and legacy call sites, so coerce defensively.
    const km = set.distance == null ? null : Number(set.distance);
    if (km == null || Number.isNaN(km)) continue;
    total = (total ?? 0) + km;
  }
  return total;
}

export type GoalMode =
  | "maintain"
  | "recomp"
  | "cut"
  | "high_cut"
  | "lean_bulk"
  | "bulk"
  | "manual";
export type GoalModeCalculationMethod = "adaptive" | "manual";

/** Largest magnitude, in percent, that a manual goal-mode adjustment may take in either direction. */
export const MAX_GOAL_MODE_PERCENTAGE = 40;

/**
 * Signed adjustment applied to the baseline TDEE, as a fraction.
 *
 * **Return value: positive means a deficit, negative means a surplus.** That is
 * the orientation the arithmetic needs, since callers apply it as
 * `baselineTdee * (1 - adjustment)` and the sign flows through without branching.
 *
 * Note this is the *opposite* orientation to the stored user preference. The
 * user-facing `customPercentage` follows the convention people expect from a
 * fitness app — **positive adds calories, negative cuts them** — so it is negated
 * on the way in. Migration `20260816173934` flipped existing stored values to
 * match; anything read from `user_preferences.goal_mode_custom_percentage`
 * already uses the user-facing orientation.
 */
export function getGoalModeAdjustment(
  goalMode: string,
  customPercentage: number = 0,
): number {
  switch (goalMode) {
    case "recomp":
      return 0.1;
    case "cut":
      return 0.15;
    case "high_cut":
      return 0.2;
    case "lean_bulk":
      return -0.1;
    case "bulk":
      return -0.2;
    case "manual": {
      const clamped = Math.min(
        MAX_GOAL_MODE_PERCENTAGE,
        Math.max(-MAX_GOAL_MODE_PERCENTAGE, customPercentage),
      );
      // Negated: a positive user percentage means "eat more" = a surplus.
      return -clamped / 100;
    }
    case "maintain":
    default:
      return 0.0;
  }
}

/**
 * Maps the onboarding "primary goal" answer onto a goal mode.
 *
 * Deliberately conservative: the gentlest option in each direction, since
 * onboarding never asks how fast the user wants to move.
 */
export function goalModeFromPrimaryGoal(primaryGoal: string): GoalMode {
  switch (primaryGoal) {
    case "lose_weight":
      return "cut";
    case "gain_weight":
      return "lean_bulk";
    case "maintain_weight":
    default:
      return "maintain";
  }
}

/** True for goal modes that target weight gain rather than loss. */
export function isGainGoalMode(
  goalMode: string,
  customPercentage: number = 0,
): boolean {
  return getGoalModeAdjustment(goalMode, customPercentage) < 0;
}

export type BmrCalculatorFn = (
  algorithm: string,
  weight: number,
  height: number,
  age: number,
  gender: "male" | "female",
  bodyFatPercentage?: number | null,
) => number;

export function calculateBmr(
  algorithm: string,
  weightKg?: number | null,
  heightCm?: number | null,
  age?: number | null,
  gender?: "male" | "female" | null,
  bodyFatPercentage?: number | null,
): number {
  if (algorithm === "Katch-McArdle" || algorithm === "Cunningham") {
    if (!weightKg || !bodyFatPercentage) {
      return 0;
    }
    const lbm = weightKg * (1 - bodyFatPercentage / 100);
    return algorithm === "Katch-McArdle" ? 370 + 21.6 * lbm : 500 + 22 * lbm;
  }

  if (!weightKg || !heightCm || !age || !gender) {
    return 0;
  }

  if (algorithm === "Revised Harris-Benedict") {
    if (gender === "male") {
      return 13.397 * weightKg + 4.799 * heightCm - 5.677 * age + 88.362;
    } else {
      return 9.247 * weightKg + 3.098 * heightCm - 4.33 * age + 447.593;
    }
  }

  if (algorithm === "Oxford") {
    return gender === "male" ? 14.2 * weightKg + 593 : 10.9 * weightKg + 677;
  }

  // Default: Mifflin-St Jeor
  const genderOffset = gender === "male" ? 5 : -161;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + genderOffset;
}

export function calculateMinimumMetabolism(
  weightKg: number,
  heightCm: number,
  age: number,
  gender: "male" | "female",
  bodyFatPercentage?: number | null,
  bmrAlgorithm: string = "Mifflin-St Jeor",
  calculateBmrFn?: BmrCalculatorFn,
): number {
  const activeBmrFn = calculateBmrFn || calculateBmr;
  if (
    (bmrAlgorithm === "Katch-McArdle" || bmrAlgorithm === "Cunningham") &&
    bodyFatPercentage &&
    bodyFatPercentage > 0
  ) {
    const lbm = weightKg * (1 - bodyFatPercentage / 100);
    return bmrAlgorithm === "Cunningham" ? 500 + 22 * lbm : 370 + 21.6 * lbm;
  }

  return activeBmrFn(
    bmrAlgorithm,
    weightKg,
    heightCm,
    age,
    gender,
    bodyFatPercentage,
  );
}

export interface CalorieTargetResult {
  target: number;
  rmr: number;
  baselineTdee: number;
  /** Signed: positive is a deficit, negative is a surplus. */
  appliedDeficit: number;
  isBelowRmr: boolean;
  isBelowAbsoluteFloor: boolean;
  absoluteFloorValue: number;
  finalTarget: number;
  insufficientHistory: boolean;
  /** Signed projection: negative is weight loss, positive is weight gain. */
  projectedWeeklyChangeKg: number;
  /** Magnitude of the projection as a percentage of body weight. Always >= 0. */
  projectedWeeklyChangePercent: number;
  /** True when the goal targets weight gain. */
  isGainGoal: boolean;
  /** Rate-of-change safety rating, thresholded per direction. */
  safetyZone: "green" | "yellow" | "red";
  /**
   * True when the adaptive safety floor overrode the requested target.
   * Only ever true for `calculationMethod === "adaptive"`.
   */
  wasClampedToFloor: boolean;
  /** Which floor bound: the user's own RMR, or the flat absolute minimum. */
  clampedFloorSource: "rmr" | "absolute" | null;
  /**
   * Largest deficit, in percent, that still clears the safety floor.
   * Null when the goal is not a deficit or the floor never binds.
   */
  maxFeasibleDeficitPercent: number | null;
}

export function computeCalorieTarget({
  goalMode,
  calculationMethod,
  customPercentage,
  bmr,
  activityLevelMultiplier,
  adaptiveTdee,
  adaptiveTdeeFallback,
  adaptiveTdeeDaysOfData,
  weightKg,
  heightCm,
  age,
  gender,
  bodyFatPercentage,
  bmrAlgorithm,
  currentGoalCalories,
  calculateBmrFn,
}: {
  goalMode: string;
  calculationMethod: string;
  customPercentage: number;
  bmr: number;
  activityLevelMultiplier: number;
  adaptiveTdee: number | null;
  adaptiveTdeeFallback: boolean;
  adaptiveTdeeDaysOfData: number;
  weightKg: number;
  heightCm: number;
  age: number;
  gender: "male" | "female";
  bodyFatPercentage?: number | null;
  bmrAlgorithm?: string;
  currentGoalCalories: number;
  calculateBmrFn?: BmrCalculatorFn;
}): CalorieTargetResult {
  const rmr = calculateMinimumMetabolism(
    weightKg,
    heightCm,
    age,
    gender,
    bodyFatPercentage,
    bmrAlgorithm,
    calculateBmrFn,
  );
  // Signed: positive is a deficit, negative is a surplus.
  const deficitPercent = getGoalModeAdjustment(goalMode, customPercentage);

  let baselineTdee = currentGoalCalories;
  let insufficientHistory = false;

  if (calculationMethod === "adaptive") {
    if (adaptiveTdeeFallback || !adaptiveTdee || adaptiveTdeeDaysOfData < 14) {
      baselineTdee = Math.round(bmr * activityLevelMultiplier);
      insufficientHistory = true;
    } else {
      baselineTdee = adaptiveTdee;
    }
  }

  const calculatedTarget = baselineTdee * (1 - deficitPercent);
  const isGainGoal = deficitPercent < 0;
  const isBelowRmr = calculatedTarget < rmr;

  const absoluteFloorValue = gender === "female" ? 1200 : 1500;
  const isBelowAbsoluteFloor = calculatedTarget < absoluteFloorValue;

  // The floor is whichever is higher: the user's own resting metabolism, or the
  // flat minimum below which hitting protein and micronutrient targets is
  // impractical. A surplus can never trip it.
  const safetyFloor = Math.max(rmr, absoluteFloorValue);
  const wasClampedToFloor =
    calculationMethod === "adaptive" && calculatedTarget < safetyFloor;
  const finalTarget = wasClampedToFloor
    ? Math.round(safetyFloor)
    : Math.round(calculatedTarget);

  // Name which floor actually bound, so the UI can explain rather than just clamp.
  const clampedFloorSource: "rmr" | "absolute" | null = wasClampedToFloor
    ? rmr >= absoluteFloorValue
      ? "rmr"
      : "absolute"
    : null;

  // The largest deficit that still clears the floor. Surfaced so a user who asked
  // for more than is feasible gets an actionable number instead of a silent override.
  const maxFeasibleDeficitPercent =
    wasClampedToFloor && baselineTdee > 0
      ? Math.max(0, (1 - safetyFloor / baselineTdee) * 100)
      : null;

  // Signed: negative is loss, positive is gain, matching how weight deltas read
  // elsewhere in the codebase. Uses the same energy density AdaptiveTdeeService
  // measures with, or the app would project consequences under a different
  // assumption than it calculates.
  const dailyEnergyBalance = finalTarget - baselineTdee;
  const projectedWeeklyChangeKg =
    (dailyEnergyBalance * 7) / ENERGY_DENSITY_KCAL_PER_KG;
  const projectedWeeklyChangePercent =
    weightKg > 0 ? (Math.abs(projectedWeeklyChangeKg) / weightKg) * 100 : 0;

  // Loss tolerates a faster rate than gain: beyond ~0.5%/week, added weight is
  // increasingly fat rather than muscle, so the gain thresholds are much tighter.
  const [yellowThreshold, redThreshold] = isGainGoal ? [0.25, 0.5] : [1.0, 1.5];
  let safetyZone: "green" | "yellow" | "red" = "green";
  if (projectedWeeklyChangePercent > redThreshold) {
    safetyZone = "red";
  } else if (projectedWeeklyChangePercent > yellowThreshold) {
    safetyZone = "yellow";
  }

  return {
    target: Math.round(calculatedTarget),
    rmr: Math.round(rmr),
    baselineTdee: Math.round(baselineTdee),
    appliedDeficit: Math.round(baselineTdee * deficitPercent),
    isBelowRmr,
    isBelowAbsoluteFloor,
    absoluteFloorValue,
    finalTarget,
    insufficientHistory,
    projectedWeeklyChangeKg,
    projectedWeeklyChangePercent,
    isGainGoal,
    safetyZone,
    wasClampedToFloor,
    clampedFloorSource,
    maxFeasibleDeficitPercent,
  };
}

/** Energy density of each macronutrient, in kcal per gram. */
export const MACRO_KCAL_PER_GRAM = {
  protein: 4,
  carbs: 4,
  fat: 9,
} as const;

export type MacroNutrient = keyof typeof MACRO_KCAL_PER_GRAM;

export interface MacroGrams {
  protein_grams: number;
  carbs_grams: number;
  fat_grams: number;
}

/**
 * The slice of the calorie target that the protein/carb/fat split divides up.
 *
 * Fiber is carved out first at 2 kcal/g, so it sits **outside** the macro
 * figures rather than inside the carb number. That is load-bearing: change the
 * rule and every stored macro goal in the product shifts. Callers must not
 * reimplement it.
 *
 * Inputs are coerced defensively because they arrive from pg drivers, form
 * state and legacy call sites, where a null or an undefined is routine.
 */
export function macroCaloriePool(
  calories: unknown,
  dietaryFiber?: unknown,
): number {
  const fiber = Number(dietaryFiber) || 0;
  return Math.max(0, (Number(calories) || 0) - fiber * 2);
}

/** Grams of one macro carved out of the calorie pool, unrounded. */
function macroGramsRaw(
  pool: number,
  percentage: number,
  nutrient: MacroNutrient,
): number {
  return (pool * percentage) / 100 / MACRO_KCAL_PER_GRAM[nutrient];
}

/**
 * Round half-up on the *mathematical* value rather than on its binary double.
 *
 * The macro split divides a calorie pool by 100 and then by 4 or 9, so a result
 * that is exactly `.5` in decimal routinely lands one ULP off in binary — and
 * which side it lands on depends on the operator order. The goal editors accept
 * one-decimal percentages (`decimals={1}` on the percentage inputs), which is
 * enough to make both orders wrong somewhere: `(pool * pct) / 100` misses 149
 * of the 7.6M reachable (pool, percentage, nutrient) triples and
 * `pool * (pct / 100)` misses 536.
 *
 * Snapping to nine decimals first discards that noise while leaving any value
 * genuinely below the boundary alone, which makes the rounding exact across the
 * whole space and the operator order immaterial. Do not replace this with a
 * bare `Math.round` — the pre-extraction copies did, and the two operator
 * orders in `GoalPresetDialog` disagreed by a gram between the figure it
 * displayed and the figure it saved.
 */
function roundHalfUp(value: number): number {
  // `toFixed` round-trips NaN and the infinities unchanged, so a malformed
  // percentage still propagates rather than collapsing to a number.
  return Math.round(Number(value.toFixed(9)));
}

/**
 * Grams of one macro for a given percentage of the calorie target.
 *
 * Rounded to whole grams, which is what the goal-editing surfaces store and
 * display. Use {@link macroGramsFromPercentages} where the unrounded value is
 * wanted instead.
 */
export function macroGramsForNutrient(
  calories: unknown,
  percentage: number,
  nutrient: MacroNutrient,
  dietaryFiber?: unknown,
): number {
  const pool = macroCaloriePool(calories, dietaryFiber);
  return roundHalfUp(macroGramsRaw(pool, percentage, nutrient));
}

/**
 * All three macros for a percentage triple, **unrounded**.
 *
 * The server stores raw fractional grams rather than rounding, so the read path
 * can re-derive against a moving calorie target without accumulating rounding
 * drift. Percentages are deliberately *not* coerced: a NaN percentage
 * propagates to a NaN gram figure so a malformed goal stays visible rather than
 * silently becoming zero.
 */
export function macroGramsFromPercentages(
  calories: unknown,
  protein_percentage: number,
  carbs_percentage: number,
  fat_percentage: number,
  dietary_fiber?: unknown,
): MacroGrams {
  const pool = macroCaloriePool(calories, dietary_fiber);
  return {
    protein_grams: macroGramsRaw(pool, protein_percentage, 'protein'),
    carbs_grams: macroGramsRaw(pool, carbs_percentage, 'carbs'),
    fat_grams: macroGramsRaw(pool, fat_percentage, 'fat'),
  };
}

/**
 * Inverse of {@link macroGramsForNutrient}: the percentage of the calorie pool
 * that a gram figure represents, rounded to a whole percent.
 *
 * Returns 0 when the pool is empty, since no percentage is meaningful then.
 */
export function macroPercentageFromGrams(
  calories: unknown,
  grams: number,
  nutrient: MacroNutrient,
  dietaryFiber?: unknown,
): number {
  const pool = macroCaloriePool(calories, dietaryFiber);
  if (pool <= 0) return 0;
  return roundHalfUp(((grams * MACRO_KCAL_PER_GRAM[nutrient]) / pool) * 100);
}
