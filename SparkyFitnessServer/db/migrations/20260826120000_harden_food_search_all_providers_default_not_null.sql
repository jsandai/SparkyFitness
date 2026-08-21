-- Enforce NOT NULL on user_preferences.food_search_all_providers_default.
--
-- This is a separate migration rather than an edit to
-- 20260821170000_add_food_search_all_providers_default.sql because the runner
-- keys on filename, not content: dbMigrations.ts reads the applied names into a
-- Set and skips any file already recorded, so a database that applied the
-- earlier revision of that file would never execute the amended version.
--
-- The column is required (z.boolean(), not nullable) in the shared schema, so a
-- writer supplying an explicit NULL would bypass the column default and produce
-- a row the canonical schema cannot parse.
--
-- Both statements are no-ops where the constraint is already in place, so this
-- is safe on a database created from the current version of the earlier file.
UPDATE public.user_preferences
SET food_search_all_providers_default = FALSE
WHERE food_search_all_providers_default IS NULL;

ALTER TABLE public.user_preferences
ALTER COLUMN food_search_all_providers_default SET NOT NULL;
