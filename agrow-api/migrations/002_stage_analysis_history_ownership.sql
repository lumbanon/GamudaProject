-- Stage 1: prepare a legacy analysis_history table for PostgreSQL-user ownership.
--
-- This migration is intentionally non-destructive:
--   * it never guesses an owner for legacy rows;
--   * it leaves user_id nullable until legacy rows have been reviewed;
--   * the NOT VALID FK protects new/updated rows without rejecting old orphans.
--
-- New installations created by 001 already satisfy these requirements, so this
-- migration is idempotent there.

BEGIN;

DO $migration$
BEGIN
    IF to_regclass('public.analysis_history') IS NULL THEN
        RAISE EXCEPTION
            'analysis_history does not exist; run 001_create_analysis_history.sql first';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'analysis_history'
          AND column_name = 'user_id'
    ) THEN
        -- users.id is INTEGER in this project.
        ALTER TABLE public.analysis_history
            ADD COLUMN user_id integer;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint constraint_row
        JOIN pg_attribute column_row
          ON column_row.attrelid = constraint_row.conrelid
         AND column_row.attnum = ANY (constraint_row.conkey)
        WHERE constraint_row.conrelid = 'public.analysis_history'::regclass
          AND constraint_row.contype = 'f'
          AND constraint_row.confrelid = 'public.users'::regclass
          AND column_row.attname = 'user_id'
    ) THEN
        ALTER TABLE public.analysis_history
            ADD CONSTRAINT analysis_history_user_id_fkey
            FOREIGN KEY (user_id)
            REFERENCES public.users(id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS ix_analysis_history_user_id
    ON public.analysis_history (user_id);
CREATE INDEX IF NOT EXISTS analysis_history_user_created_idx
    ON public.analysis_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analysis_history_user_crop_idx
    ON public.analysis_history (user_id, selected_crop);
CREATE INDEX IF NOT EXISTS analysis_history_user_district_idx
    ON public.analysis_history (user_id, district);
CREATE INDEX IF NOT EXISTS analysis_history_user_score_idx
    ON public.analysis_history (user_id, suitability_score);

COMMIT;

-- Review before stage 2:
--
-- SELECT COUNT(*) AS ownerless_rows
-- FROM public.analysis_history
-- WHERE user_id IS NULL;
--
-- SELECT h.id, h.user_id
-- FROM public.analysis_history h
-- LEFT JOIN public.users u ON u.id = h.user_id
-- WHERE h.user_id IS NOT NULL AND u.id IS NULL;
--
-- Ownerless rows must be manually assigned only when ownership can be proven.
-- Otherwise export/archive them outside the active table or delete them under
-- the project's retention policy. Never assign them to an arbitrary user.
