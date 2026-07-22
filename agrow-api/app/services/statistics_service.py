from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.crop_statistic import CropStatistic


ZERO = Decimal("0")
STATISTICS_CROPS = ("Banana", "Cabbage", "Watermelon", "Durian")
STATISTICS_CROP_KEYS = tuple(crop.casefold() for crop in STATISTICS_CROPS)


class StatisticsDataError(Exception):
    pass


class StatisticsFilterError(ValueError):
    pass


@dataclass(frozen=True)
class StatisticsFilters:
    crop_names: tuple[str, ...] = ()
    districts: tuple[str, ...] = ()
    year: int | None = None
    start_year: int | None = None
    end_year: int | None = None


def validate_statistics_filters(
    *,
    crop_name: str | None = None,
    district: str | None = None,
    crop_names: list[str] | tuple[str, ...] | None = None,
    districts: list[str] | tuple[str, ...] | None = None,
    year: int | None = None,
    start_year: int | None = None,
    end_year: int | None = None,
) -> StatisticsFilters:
    normalized_crop_names = _normalize_filter_group(
        singular_field_name="crop_name",
        plural_field_name="crop_names",
        singular_value=crop_name,
        plural_values=crop_names,
    )
    normalized_districts = _normalize_filter_group(
        singular_field_name="district",
        plural_field_name="districts",
        singular_value=district,
        plural_values=districts,
    )

    if year is not None and (start_year is not None or end_year is not None):
        raise StatisticsFilterError(
            "year cannot be combined with start_year or end_year"
        )

    if (
        start_year is not None
        and end_year is not None
        and start_year > end_year
    ):
        raise StatisticsFilterError(
            "start_year must be less than or equal to end_year"
        )

    return StatisticsFilters(
        crop_names=normalized_crop_names,
        districts=normalized_districts,
        year=year,
        start_year=start_year,
        end_year=end_year,
    )


def get_crop_statistics(
    db: Session,
    filters: StatisticsFilters,
    *,
    include_records: bool = True,
) -> dict:
    try:
        query = _apply_filters(db.query(CropStatistic), filters)
        rows = (
            query.order_by(
                CropStatistic.year.asc(),
                func.lower(CropStatistic.crop_name).asc(),
                func.lower(func.coalesce(CropStatistic.district, "")).asc(),
                CropStatistic.id.asc(),
            )
            .all()
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise StatisticsDataError(
            "Unable to retrieve crop statistics"
        ) from exc

    return _build_statistics_response(
        rows,
        include_records=include_records,
    )


def get_statistics_options(db: Session) -> dict:
    try:
        rows = (
            db.query(
                CropStatistic.crop_name,
                CropStatistic.district,
                CropStatistic.year,
                CropStatistic.planted_area_ha,
                CropStatistic.production_tonnes,
                CropStatistic.economic_value_myr,
            )
            .filter(
                func.lower(func.trim(CropStatistic.crop_name)).in_(
                    STATISTICS_CROP_KEYS
                )
            )
            .all()
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise StatisticsDataError(
            "Unable to retrieve crop statistic filter options"
        ) from exc

    crop_label_map = _canonical_label_map(row.crop_name for row in rows)
    district_label_map = _canonical_label_map(row.district for row in rows)
    years = {
        int(row.year)
        for row in rows
        if row.year is not None
    }
    districts_by_crop: dict[str, set[str]] = {}

    for row in rows:
        crop_name = _canonical_label(row.crop_name, crop_label_map)
        if not crop_name:
            continue

        available_districts = districts_by_crop.setdefault(crop_name, set())
        district = _canonical_label(row.district, district_label_map)
        if not district:
            continue

        has_recorded_data = any(
            _safe_decimal(value) != ZERO
            for value in (
                row.planted_area_ha,
                row.production_tonnes,
                row.economic_value_myr,
            )
        )
        if has_recorded_data:
            available_districts.add(district)

    sorted_crop_names = sorted(
        crop_label_map.values(),
        key=lambda value: (value.casefold(), value),
    )

    return {
        "crop_names": sorted_crop_names,
        "districts": sorted(
            district_label_map.values(),
            key=lambda value: (value.casefold(), value),
        ),
        "years": sorted(years),
        "districts_by_crop": {
            crop_name: sorted(
                districts_by_crop.get(crop_name, set()),
                key=lambda value: (value.casefold(), value),
            )
            for crop_name in sorted_crop_names
        },
    }


def _normalize_filter_group(
    *,
    singular_field_name: str,
    plural_field_name: str,
    singular_value: str | None,
    plural_values: list[str] | tuple[str, ...] | None,
) -> tuple[str, ...]:
    values: list[tuple[str, str]] = []
    if singular_value is not None:
        values.append((singular_field_name, singular_value))
    if plural_values is not None:
        values.extend((plural_field_name, value) for value in plural_values)

    normalized_values: list[str] = []
    seen_values: set[str] = set()

    for field_name, value in values:
        normalized = value.strip()
        if not normalized:
            if field_name == singular_field_name:
                raise StatisticsFilterError(
                    f"{singular_field_name} cannot be blank"
                )
            raise StatisticsFilterError(
                f"{plural_field_name} cannot contain blank values"
            )
        if len(normalized) > 100:
            raise StatisticsFilterError(
                f"{field_name} values cannot exceed 100 characters"
            )

        identity = normalized.casefold()
        if identity in seen_values:
            continue
        seen_values.add(identity)
        normalized_values.append(normalized)

    return tuple(normalized_values)


def _apply_filters(query, filters: StatisticsFilters):
    query = query.filter(
        func.lower(func.trim(CropStatistic.crop_name)).in_(
            STATISTICS_CROP_KEYS
        )
    )

    if filters.crop_names:
        query = query.filter(
            func.lower(func.trim(CropStatistic.crop_name)).in_(
                [value.lower() for value in filters.crop_names]
            )
        )

    if filters.districts:
        query = query.filter(
            func.lower(func.trim(CropStatistic.district)).in_(
                [value.lower() for value in filters.districts]
            )
        )

    if filters.year is not None:
        query = query.filter(CropStatistic.year == filters.year)
    else:
        if filters.start_year is not None:
            query = query.filter(CropStatistic.year >= filters.start_year)
        if filters.end_year is not None:
            query = query.filter(CropStatistic.year <= filters.end_year)

    return query


def _build_statistics_response(
    rows: list[CropStatistic],
    *,
    include_records: bool,
) -> dict:
    summary_totals = _new_totals()
    yearly_totals: dict[int, dict[str, Decimal]] = {}
    crop_totals: dict[str, dict[str, Decimal]] = {}
    district_totals: dict[str | None, dict[str, Decimal]] = {}
    crop_yearly_totals: dict[tuple[int, str], dict[str, Decimal]] = {}
    district_yearly_totals: dict[
        tuple[int, str | None], dict[str, Decimal]
    ] = {}
    crop_district_totals: dict[
        tuple[str | None, str], dict[str, Decimal]
    ] = {}
    records = []
    crop_labels = _canonical_label_map(row.crop_name for row in rows)
    district_labels = _canonical_label_map(row.district for row in rows)

    for row in rows:
        planted_area = _safe_decimal(row.planted_area_ha)
        production = _safe_decimal(row.production_tonnes)
        economic_value = _safe_decimal(row.economic_value_myr)
        crop_name = _canonical_label(row.crop_name, crop_labels) or ""
        district = _canonical_label(row.district, district_labels)
        year = int(row.year)

        _add_to_totals(
            summary_totals,
            planted_area,
            production,
            economic_value,
        )
        _add_to_group(
            yearly_totals,
            year,
            planted_area,
            production,
            economic_value,
        )
        _add_to_group(
            crop_totals,
            crop_name,
            planted_area,
            production,
            economic_value,
        )
        _add_to_group(
            district_totals,
            district,
            planted_area,
            production,
            economic_value,
        )
        _add_to_group(
            crop_yearly_totals,
            (year, crop_name),
            planted_area,
            production,
            economic_value,
        )
        _add_to_group(
            district_yearly_totals,
            (year, district),
            planted_area,
            production,
            economic_value,
        )
        _add_to_group(
            crop_district_totals,
            (district, crop_name),
            planted_area,
            production,
            economic_value,
        )

        if include_records:
            records.append(
                {
                    "id": row.id,
                    "crop_name": crop_name,
                    "year": year,
                    "planted_area_ha": _to_float(planted_area),
                    "production_tonnes": _to_float(production),
                    "economic_value_myr": _to_float(economic_value),
                    "district": district,
                    "yield_tonnes_per_ha": _calculate_yield(
                        production,
                        planted_area,
                    ),
                }
            )

    return {
        "record_count": len(rows),
        "records": records,
        "summary": {
            "total_planted_area_ha": _to_float(
                summary_totals["planted_area_ha"]
            ),
            "total_production_tonnes": _to_float(
                summary_totals["production_tonnes"]
            ),
            "total_economic_value_myr": _to_float(
                summary_totals["economic_value_myr"]
            ),
            "average_yield_tonnes_per_ha": _calculate_yield(
                summary_totals["production_tonnes"],
                summary_totals["planted_area_ha"],
            ),
        },
        "yearly_trends": [
            _serialize_group("year", year, totals)
            for year, totals in sorted(yearly_totals.items())
            if _has_meaningful_data(totals)
        ],
        "crop_yearly_trends": [
            _serialize_group_fields(
                {"year": year, "crop_name": crop_name},
                totals,
            )
            for (year, crop_name), totals in sorted(
                crop_yearly_totals.items(),
                key=lambda item: (
                    item[0][0],
                    item[0][1].casefold(),
                    item[0][1],
                ),
            )
            if _has_meaningful_data(totals)
        ],
        "district_yearly_trends": [
            _serialize_group_fields(
                {"year": year, "district": district},
                totals,
            )
            for (year, district), totals in sorted(
                district_yearly_totals.items(),
                key=lambda item: (
                    item[0][0],
                    _comparison_name(item[0][1]).casefold(),
                    _comparison_name(item[0][1]),
                ),
            )
            if _has_meaningful_data(totals)
        ],
        "crop_comparison": [
            _serialize_group("crop_name", crop_name, totals)
            for crop_name, totals in _sort_comparison_groups(crop_totals)
            if _has_meaningful_data(totals)
        ],
        "district_comparison": [
            _serialize_group("district", district, totals)
            for district, totals in _sort_comparison_groups(district_totals)
            if _has_meaningful_data(totals)
        ],
        "crop_district_comparison": [
            _serialize_group_fields(
                {"district": district, "crop_name": crop_name},
                totals,
            )
            for (district, crop_name), totals in sorted(
                crop_district_totals.items(),
                key=lambda item: (
                    _comparison_name(item[0][0]).casefold(),
                    _comparison_name(item[0][0]),
                    item[0][1].casefold(),
                    item[0][1],
                ),
            )
            if _has_meaningful_data(totals)
        ],
    }


def _new_totals() -> dict[str, Decimal]:
    return {
        "planted_area_ha": ZERO,
        "production_tonnes": ZERO,
        "economic_value_myr": ZERO,
    }


def _add_to_group(
    grouped_totals: dict,
    key,
    planted_area: Decimal,
    production: Decimal,
    economic_value: Decimal,
) -> None:
    totals = grouped_totals.setdefault(key, _new_totals())
    _add_to_totals(
        totals,
        planted_area,
        production,
        economic_value,
    )


def _add_to_totals(
    totals: dict[str, Decimal],
    planted_area: Decimal,
    production: Decimal,
    economic_value: Decimal,
) -> None:
    totals["planted_area_ha"] += planted_area
    totals["production_tonnes"] += production
    totals["economic_value_myr"] += economic_value


def _serialize_group(field_name: str, key, totals: dict) -> dict:
    return _serialize_group_fields({field_name: key}, totals)


def _serialize_group_fields(fields: dict, totals: dict) -> dict:
    return {
        **fields,
        "planted_area_ha": _to_float(totals["planted_area_ha"]),
        "production_tonnes": _to_float(totals["production_tonnes"]),
        "economic_value_myr": _to_float(totals["economic_value_myr"]),
        "yield_tonnes_per_ha": _calculate_yield(
            totals["production_tonnes"],
            totals["planted_area_ha"],
        ),
    }


def _has_meaningful_data(totals: dict[str, Decimal]) -> bool:
    return any(
        totals[field_name] != ZERO
        for field_name in (
            "planted_area_ha",
            "production_tonnes",
            "economic_value_myr",
        )
    )


def _sort_comparison_groups(grouped_totals: dict) -> list[tuple]:
    return sorted(
        grouped_totals.items(),
        key=lambda item: (
            -item[1]["production_tonnes"],
            _comparison_name(item[0]).casefold(),
            _comparison_name(item[0]),
        ),
    )


def _comparison_name(value) -> str:
    return "" if value is None else str(value)


def _canonical_label_map(values) -> dict[str, str]:
    labels = {
        str(value).strip()
        for value in values
        if value is not None and str(value).strip()
    }
    canonical_labels: dict[str, str] = {}
    for label in sorted(labels, key=lambda value: (value.casefold(), value)):
        canonical_labels.setdefault(label.casefold(), label)
    return canonical_labels


def _canonical_label(
    value,
    canonical_labels: dict[str, str],
) -> str | None:
    if value is None:
        return None

    label = str(value).strip()
    if not label:
        return None
    return canonical_labels.get(label.casefold(), label)


def _safe_decimal(value) -> Decimal:
    if value is None:
        return ZERO

    try:
        number = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return ZERO

    return number if number.is_finite() else ZERO


def _calculate_yield(
    production: Decimal,
    planted_area: Decimal,
) -> float:
    if planted_area <= ZERO:
        return 0.0
    return _to_float(production / planted_area)


def _to_float(value: Decimal) -> float:
    return float(value) if value.is_finite() else 0.0
