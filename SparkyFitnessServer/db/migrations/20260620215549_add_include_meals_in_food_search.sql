-- Migration: Add include_meals_in_food_search to user_preferences
-- Created at: 2026-06-20 21:55:49
--
-- Per-user toggle (Settings > Preferences) controlling whether the Database tab
-- of food search also returns the user's saved meals alongside individual foods,
-- so a single search covers both without switching tabs. Default false preserves
-- the existing foods-only behavior for current users; the separate Meals tab and
-- the Online search are unaffected.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS include_meals_in_food_search boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.user_preferences.include_meals_in_food_search IS 'When enabled, the Database food-search tab also returns saved meals alongside foods. Default false.';
