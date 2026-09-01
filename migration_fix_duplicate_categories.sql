-- ============================================================
-- ONCOST Migration: Fix Duplicate Categories & Deduplicate
-- File: migration_fix_duplicate_categories.sql
-- ============================================================

-- Step 1: Ensure canonical 'Brass Collection' category exists
INSERT INTO public.categories (id, name, description)
VALUES ('f5c49720-0abd-44dc-a904-9fb902775086', 'Brass Collection', 'Authentic handmade articles of pure divine brass')
ON CONFLICT (id) DO UPDATE SET name = 'Brass Collection';

-- Step 2: Reassign all products referencing duplicate category variations to canonical 'Brass Collection'
UPDATE public.products
SET category = 'Brass Collection'
WHERE LOWER(TRIM(REGEXP_REPLACE(category, '\s+', ' ', 'g'))) = 'brass collection'
   OR category = 'BRASS';

-- Step 3: Delete duplicate category records for "Brass Collection" except the canonical ID
DELETE FROM public.categories
WHERE LOWER(TRIM(REGEXP_REPLACE(name, '\s+', ' ', 'g'))) = 'brass collection'
  AND id != 'f5c49720-0abd-44dc-a904-9fb902775086';

-- Step 4: Deduplicate any other case/whitespace duplicate category rows
DELETE FROM public.categories c1
WHERE EXISTS (
  SELECT 1 FROM public.categories c2
  WHERE LOWER(TRIM(REGEXP_REPLACE(c2.name, '\s+', ' ', 'g'))) = LOWER(TRIM(REGEXP_REPLACE(c1.name, '\s+', ' ', 'g')))
    AND (c2.created_at < c1.created_at OR (c2.created_at = c1.created_at AND c2.id < c1.id))
);

-- Step 5: Add database-level protection index to prevent duplicate normalized category names
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_normalized_name 
ON public.categories (LOWER(TRIM(REGEXP_REPLACE(name, '\s+', ' ', 'g'))));
