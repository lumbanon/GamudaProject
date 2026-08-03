-- Migration: Create the analysis_history table
--
-- Adds persistent, user-owned prediction history to an existing AGROW database.
-- This migration creates the required PostGIS table, constraints, and indexes
-- without inserting seed data or modifying existing prediction records.
--
-- It is safe to run more than once because the table and indexes use
-- IF NOT EXISTS where applicable.
--
-- For new local databases, seed.py can also create this table through
-- SQLAlchemy Base.metadata.create_all(). This migration is intended for
-- upgrading existing databases without running the full seed process.

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS public.analysis_history (
    id uuid PRIMARY KEY,
    user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name varchar(160),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    boundary geometry(Polygon, 4326) NOT NULL,
    centroid geometry(Point, 4326) NOT NULL,
    land_area_hectares double precision NOT NULL
        CONSTRAINT analysis_history_land_area_check CHECK (land_area_hectares > 0),
    district varchar(160),
    selected_crop varchar(160),
    suitability_score double precision CHECK (
        suitability_score IS NULL OR suitability_score BETWEEN 0 AND 100
    ),
    confidence_level varchar(160),
    environmental_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    forest_reserve_result jsonb,
    land_cover_result jsonb,
    prediction_result jsonb NOT NULL DEFAULT '{}'::jsonb,
    yield_estimate jsonb,
    revenue_estimate jsonb,
    risks jsonb NOT NULL DEFAULT '[]'::jsonb,
    strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
    missing_data jsonb NOT NULL DEFAULT '[]'::jsonb,
    recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
    gemini_insights jsonb,
    analysis_status varchar(24) NOT NULL DEFAULT 'completed'
        CHECK (analysis_status IN ('completed', 'failed')),
    dataset_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    analysis_version varchar(120),
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key varchar(160) NOT NULL,
    CONSTRAINT analysis_history_user_idempotency_key
        UNIQUE (user_id, idempotency_key),
    CONSTRAINT analysis_history_valid_boundary CHECK (ST_IsValid(boundary))
);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.analysis_history'::regclass
          AND conname = 'analysis_history_land_area_check'
    ) THEN
        ALTER TABLE public.analysis_history
            ADD CONSTRAINT analysis_history_land_area_check
            CHECK (land_area_hectares > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.analysis_history'::regclass
          AND conname = 'analysis_history_valid_boundary'
    ) THEN
        ALTER TABLE public.analysis_history
            ADD CONSTRAINT analysis_history_valid_boundary
            CHECK (ST_IsValid(boundary));
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
CREATE INDEX IF NOT EXISTS idx_analysis_history_boundary
    ON public.analysis_history USING GIST (boundary);

COMMIT;
