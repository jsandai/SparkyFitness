import { describe, expect, it } from 'vitest';
import {
  macroCaloriePool,
  macroGramsForNutrient,
  macroGramsFromPercentages,
  macroPercentageFromGrams,
} from '@workspace/shared';

/**
 * The protein/carb/fat split was duplicated across two server services, three
 * goal editors and onboarding before being pulled into `@workspace/shared`.
 *
 * These tests pin the parts that were load-bearing at the call sites, because
 * a silent change to any of them shifts every stored macro goal in the product:
 * the 2 kcal/g fiber carve-out, the clamp at zero, the server's unrounded
 * output versus the editors' rounded output, and the defensive coercion that
 * lets pg rows and half-filled form state through unharmed.
 */
describe('macroCaloriePool', () => {
  it('removes fiber from the pool at 2 kcal per gram', () => {
    expect(macroCaloriePool(2000, 30)).toBe(1940);
  });

  it('treats absent fiber as zero', () => {
    expect(macroCaloriePool(2000)).toBe(2000);
    expect(macroCaloriePool(2000, null)).toBe(2000);
    expect(macroCaloriePool(2000, undefined)).toBe(2000);
  });

  it('clamps to zero rather than returning a negative pool', () => {
    expect(macroCaloriePool(100, 200)).toBe(0);
  });

  it('coerces numeric strings, as pg hands them over', () => {
    expect(macroCaloriePool('2000', '30')).toBe(1940);
  });

  it('coerces unusable input to zero instead of propagating NaN', () => {
    expect(macroCaloriePool(null)).toBe(0);
    expect(macroCaloriePool(undefined)).toBe(0);
    expect(macroCaloriePool(NaN)).toBe(0);
    expect(macroCaloriePool('abc')).toBe(0);
  });
});

describe('macroGramsForNutrient', () => {
  it('splits the fiber-adjusted pool at 4/4/9 kcal per gram', () => {
    // Pool = 2000 - 30*2 = 1940.
    expect(macroGramsForNutrient(2000, 30, 'protein', 30)).toBe(146); // 582/4
    expect(macroGramsForNutrient(2000, 40, 'carbs', 30)).toBe(194); // 776/4
    expect(macroGramsForNutrient(2000, 30, 'fat', 30)).toBe(65); // 582/9
  });

  it('rounds to whole grams', () => {
    expect(Number.isInteger(macroGramsForNutrient(2137, 33, 'fat', 27))).toBe(
      true
    );
  });

  it('returns zero once fiber has consumed the whole pool', () => {
    expect(macroGramsForNutrient(100, 50, 'carbs', 200)).toBe(0);
  });

  it('returns zero for a zero calorie target', () => {
    expect(macroGramsForNutrient(0, 30, 'protein')).toBe(0);
  });

  it('rounds a mathematically exact .5 up rather than one ULP down', () => {
    // Pool = 800 - 25*2 = 750. 750 * 57% / 9 is exactly 47.5.
    //
    // Three of the six pre-extraction copies computed this as
    // `pool * (pct / 100) / factor`, where the inexact 0.57 lands the result at
    // 47.499999999999993 and rounds to 47. The other three used
    // `pool * pct / 100 / factor`, which is exact here and rounds to 48.
    expect(macroGramsForNutrient(800, 57, 'fat', 25)).toBe(48);
    expect(macroGramsForNutrient(800, 70, 'carbs', 50)).toBe(123);
    expect(macroGramsForNutrient(800, 35, 'carbs', 60)).toBe(60);
  });

  it('rounds an exact .5 up for one-decimal percentages too', () => {
    // The percentage inputs are `decimals={1}`, so these are reachable.
    //
    // Pool = 800 - 25*2 = 750. 750 * 10.2% / 9 is exactly 8.5, but the
    // `pool * pct` order evaluates to 8.499999999999998 — the *opposite* skew
    // to the integer cases above. Neither operator order is safe on its own,
    // so the half-up rounding has to work on the decimal value.
    expect(macroGramsForNutrient(800, 10.2, 'fat', 25)).toBe(9);
    expect(macroGramsForNutrient(750, 20.4, 'fat')).toBe(17);
    expect(macroGramsForNutrient(750, 36.8, 'carbs')).toBe(69);
  });

  it('rounds every reachable one-decimal split the way exact arithmetic does', () => {
    // Both pre-extraction operator orders were wrong somewhere in this space
    // (149 and 536 triples respectively), so guard the whole thing rather than
    // the handful of boundaries that happened to get noticed.
    //
    // Reference: grams = pool*pct10 / (1000*factor) rounded half-up, evaluated
    // entirely in integers so no binary rounding can enter.
    const exact = (pool: number, pct10: number, factor: number) =>
      Math.floor((2 * pool * pct10 + 1000 * factor) / (2000 * factor));

    const mismatches: string[] = [];
    for (let pool = 800; pool <= 3200; pool += 7) {
      for (let pct10 = 1; pct10 <= 1000; pct10++) {
        const pct = pct10 / 10;
        for (const [nutrient, factor] of [
          ['protein', 4],
          ['fat', 9],
        ] as const) {
          const got = macroGramsForNutrient(pool, pct, nutrient);
          const want = exact(pool, pct10, factor);
          if (got !== want) {
            mismatches.push(
              `${pool} kcal @ ${pct}% ${nutrient}: ${got} ≠ ${want}`
            );
          }
        }
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  it('leaves a non-finite result alone rather than coercing it', () => {
    expect(Number.isNaN(macroGramsForNutrient(2000, NaN, 'protein'))).toBe(
      true
    );
  });
});

describe('macroGramsFromPercentages', () => {
  it('returns unrounded grams, which the server stores verbatim', () => {
    // Pool = 2000 - 25*2 = 1950. Protein 1950*0.35/4 = 170.625.
    const { protein_grams } = macroGramsFromPercentages(2000, 35, 40, 25, 25);
    expect(protein_grams).toBeCloseTo(170.625, 10);
  });

  it('agrees with macroGramsForNutrient once rounded', () => {
    const { protein_grams, carbs_grams, fat_grams } = macroGramsFromPercentages(
      2000,
      30,
      40,
      30,
      30
    );
    expect(Math.round(protein_grams)).toBe(
      macroGramsForNutrient(2000, 30, 'protein', 30)
    );
    expect(Math.round(carbs_grams)).toBe(
      macroGramsForNutrient(2000, 40, 'carbs', 30)
    );
    expect(Math.round(fat_grams)).toBe(
      macroGramsForNutrient(2000, 30, 'fat', 30)
    );
  });

  it('coerces a missing calorie target to a zero split', () => {
    expect(macroGramsFromPercentages(null, 30, 40, 30)).toEqual({
      protein_grams: 0,
      carbs_grams: 0,
      fat_grams: 0,
    });
  });

  it('propagates a NaN percentage rather than silently zeroing it', () => {
    // A malformed goal must stay visible; only the calorie and fiber inputs
    // are coerced. `manageGoalTimeline` gates on this before it stores.
    const { protein_grams, carbs_grams } = macroGramsFromPercentages(
      2000,
      NaN,
      40,
      30
    );
    expect(Number.isNaN(protein_grams)).toBe(true);
    expect(carbs_grams).toBe(200);
  });
});

describe('macroPercentageFromGrams', () => {
  it('inverts macroGramsForNutrient across a round trip', () => {
    const grams = macroGramsForNutrient(2000, 35, 'protein', 25);
    expect(macroPercentageFromGrams(2000, grams, 'protein', 25)).toBe(35);
  });

  it('measures against the fiber-adjusted pool, not raw calories', () => {
    // Pool = 2000 - 30*2 = 1940. 100 g protein = 400 kcal = 20.6% of the pool,
    // which would read as 20% against the unadjusted 2000.
    expect(macroPercentageFromGrams(2000, 100, 'protein', 30)).toBe(21);
  });

  it('returns zero when the pool is empty, since no percentage is meaningful', () => {
    expect(macroPercentageFromGrams(100, 50, 'carbs', 200)).toBe(0);
    expect(macroPercentageFromGrams(0, 50, 'carbs')).toBe(0);
  });
});
