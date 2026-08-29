# Crop registry and model training

Agrow uses two related crop catalogs with different eligibility rules:

- **Crop Statistics** comes directly from distinct names in `crop_statistics`.
- **Prediction crops** come from the registry snapshot written beside the trained
  model in `app/ml_assets/crop_model_metadata.json`.

The data flow is:

```text
crops + crop_statistics + spatial_grids
    -> crop registry validation
    -> pseudo-label generation
    -> grouped Random Forest training
    -> model metadata
    -> prediction/statistics APIs
    -> portal
```

No frontend or backend crop-name list needs to be updated when data changes.
Seed or import the crop requirements and statistics, then retrain the model.

## Train

From `agrow-api`, with the target PostgreSQL database configured:

```powershell
.\.venv\Scripts\python.exe train_model.py
```

The pipeline requires, per crop:

- every required suitability field in `crops`;
- at least five positive-production historical rows spanning three years;
- positive production in at least five districts represented by complete
  environmental grids;
- at least 30 grids containing every model environmental feature; and
- at least two generated suitability classes.

These minimums are model evidence-sufficiency controls, not agronomic limits.
The crop-specific agronomic limits are loaded from the `crops` table. Crops that
do not pass remain available to Crop Statistics and are recorded with explicit
exclusion reasons.

The trainer does not fill missing environmental values with arbitrary defaults.
It reconciles names case-insensitively and permits a punctuation-insensitive
match only when that match is unique on both sides (for example, `Watercress`
and `Water-Cress`).

Historical production is used to validate crop coverage and derive productive
environment ranges. It is not scored directly as a suitability condition or
passed to the model, because past production is an outcome proxy that would not
be available as an environmental measurement for a new site. Crop identity is
one-hot encoded so the Random Forest does not infer a false alphabetical order
between crop names.

Crop temperature requirements are checked for completeness and internal
ordering, but temperature is not currently used to generate ML labels or as a
classifier feature because `spatial_grids` has no temperature field. The
runtime `temperature_annual` raster is used only by the separate rule-based
suitability score. Temperature should enter the ML pipeline only after a
versioned, per-grid training source is persisted and audited.

## Validation artifacts

Each run writes:

- `outputs/crop_data_integrity_report.csv` — one row per requirement crop;
- `outputs/crop_training_report.json` — registry, split, metrics, class balance,
  leakage checks, and per-crop accuracy;
- `outputs/per_crop_metrics.csv`;
- `outputs/suitability_confusion_matrix.csv`; and
- `app/ml_assets/crop_model_metadata.json` — the deployed registry snapshot.

Whole districts are held out before empirical label ranges are calculated, so
neither a district nor an environmental point can appear in both train and test
sets. Hyperparameters are selected with district-grouped cross-validation using
only training districts. Within every cross-validation fold, productive
environment ranges and both fit/validation pseudo-labels are regenerated using
only that fold's fit districts. The fold validation districts therefore do not
influence the ranges that define their targets. The selected parameters are
then refitted on the complete outer-training split before the untouched outer
test districts are evaluated.

## Interpretation warning

The target classes are generated from crop requirements and historical
productive districts; they are not field-observed suitability labels. The
current `seed.py` also uses randomized values for soil pH, slope, soil depth,
and point jitter while elevation/climate are API-derived. Consequently, the
reported metrics measure how reproducibly the model learns the prototype rules
on the current database. They must not be presented as field-validated
agronomic accuracy.
