-- Stage 2: enforce required ownership after legacy-row review.
--
-- Run 002 first. This migration stops without changing the schema if any row
-- is ownerless, orphaned, or would violate per-user idempotency.

BEGIN;

DO $migration$
DECLARE
    ownerless_count bigint;
    orphan_count bigint;
    duplicate_count bigint;
    foreign_key_name text;
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
        RAISE EXCEPTION
            'analysis_history.user_id is missing; run 002_stage_analysis_history_ownership.sql first';
    END IF;

    SELECT COUNT(*)
    INTO ownerless_count
    FROM public.analysis_history
    WHERE user_id IS NULL;

    IF ownerless_count > 0 THEN
        RAISE EXCEPTION
            'Cannot enforce analysis_history ownership: % row(s) have no owner. Manually assign proven owners, archive, or delete these rows first.',
            ownerless_count;
    END IF;

    SELECT COUNT(*)
    INTO orphan_count
    FROM public.analysis_history history_row
    LEFT JOIN public.users user_row ON user_row.id = history_row.user_id
    WHERE user_row.id IS NULL;

    IF orphan_count > 0 THEN
        RAISE EXCEPTION
            'Cannot enforce analysis_history ownership: % row(s) reference a missing PostgreSQL user.',
            orphan_count;
    END IF;

    SELECT COUNT(*)
    INTO duplicate_count
    FROM (
        SELECT user_id, idempotency_key
        FROM public.analysis_history
        GROUP BY user_id, idempotency_key
        HAVING COUNT(*) > 1
    ) duplicate_groups;

    IF duplicate_count > 0 THEN
        RAISE EXCEPTION
            'Cannot enforce per-user idempotency: % duplicate owner/idempotency group(s) require review.',
            duplicate_count;
    END IF;

    SELECT constraint_row.conname
    INTO foreign_key_name
    FROM pg_constraint constraint_row
    JOIN pg_attribute column_row
      ON column_row.attrelid = constraint_row.conrelid
     AND column_row.attnum = ANY (constraint_row.conkey)
    WHERE constraint_row.conrelid = 'public.analysis_history'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.users'::regclass
      AND column_row.attname = 'user_id'
    LIMIT 1;

    IF foreign_key_name IS NULL THEN
        RAISE EXCEPTION
            'analysis_history.user_id has no users(id) foreign key; run stage 1 first';
    END IF;

    EXECUTE format(
        'ALTER TABLE public.analysis_history VALIDATE CONSTRAINT %I',
        foreign_key_name
    );

    ALTER TABLE public.analysis_history
        ALTER COLUMN user_id SET NOT NULL;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.analysis_history'::regclass
          AND conname = 'analysis_history_user_idempotency_key'
    ) THEN
        ALTER TABLE public.analysis_history
            ADD CONSTRAINT analysis_history_user_idempotency_key
            UNIQUE (user_id, idempotency_key);
    END IF;
END
$migration$;

COMMIT;
