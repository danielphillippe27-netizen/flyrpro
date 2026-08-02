#!/usr/bin/env python3
"""Publish Toronto Territory IQ signals without touching homes, buildings, parcels, or street trees.

The script consumes the immutable Toronto acquisition bundle, derives only area/point
signals, uploads versioned rows through PostgREST, and promotes a source only after
its rows pass basic quality checks. Street-tree inputs are explicitly prohibited.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_ROOT = Path(
    "/Volumes/Samsung SSD/WolfGrid/municipal_data/territory_iq_canada/work/toronto-v0.1.0"
)
LICENCE_NAME = "Open Government Licence - Toronto"
LICENCE_URL = "https://open.toronto.ca/open-data-licence/"
TORONTO_COVERAGE = (
    "SRID=4326;MULTIPOLYGON(((-79.6393 43.5810,-79.1150 43.5810,"
    "-79.1150 43.8555,-79.6393 43.8555,-79.6393 43.5810)))"
)
PROFILE_KEYS = [
    "roofing", "solar", "hvac", "pest_control", "real_estate",
    "home_service", "insurance", "political", "security", "generic",
]
FORBIDDEN_SOURCE_FRAGMENT = "street-tree"


SOURCE_CONFIG: dict[str, dict[str, Any]] = {
    "statcan-fsa-boundaries-2021": {
        "name": "2021 Census Forward Sortation Area Boundaries", "version": "2021",
        "resolution": "FSA", "signal": "boundary_context", "confidence": 0.95,
    },
    "toronto-active-building-permits": {
        "name": "Building Permits — Active Permits", "version": "2026-08-01",
        "resolution": "FSA", "signal": "active_permit_activity", "confidence": 0.74,
    },
    "toronto-cleared-building-permits": {
        "name": "Building Permits — Cleared Permits Since 2017", "version": "2026-08-01",
        "resolution": "FSA", "signal": "cleared_permit_activity", "confidence": 0.72,
    },
    "toronto-pool-enclosure-permits": {
        "name": "Building Permits — Pool Enclosures", "version": "2026-07-29",
        "resolution": "FSA", "signal": "pool_permit_activity", "confidence": 0.70,
    },
    "toronto-green-roof-permits": {
        "name": "Building Permits — Green Roofs", "version": "2026-07-27",
        "resolution": "FSA", "signal": "green_roof_permit_activity", "confidence": 0.68,
    },
    "toronto-preliminary-zoning-reviews": {
        "name": "Preliminary Zoning Reviews", "version": "2026-08-01",
        "resolution": "FSA", "signal": "zoning_review_activity", "confidence": 0.66,
    },
    "toronto-311-service-requests-2026": {
        "name": "311 Service Requests — 2026", "version": "2026-07-08",
        "resolution": "FSA", "signal": "service_request_need", "confidence": 0.72,
    },
    "toronto-utility-cut-permits": {
        "name": "Utility Cut Permits", "version": "2026-07-31",
        "resolution": "Ward", "signal": "utility_disruption", "confidence": 0.69,
    },
    "toronto-road-restrictions": {
        "name": "Road Restrictions — Version 3", "version": "2026-07-09",
        "resolution": "Point", "signal": "road_restriction", "confidence": 0.76,
    },
    "toronto-traffic-volume-summary": {
        "name": "Traffic Volumes — Most Recent Midblock Summary", "version": "2026-08-01",
        "resolution": "Point", "signal": "traffic_friction", "confidence": 0.78,
    },
    "toronto-neighbourhood-crime-rates": {
        "name": "Neighbourhood Crime Rates", "version": "2026-02-20",
        "resolution": "Neighbourhood", "signal": "crime_context", "confidence": 0.83,
    },
    "toronto-fire-incidents": {
        "name": "Fire Incidents", "version": "2026-07-28",
        "resolution": "2 km grid", "signal": "fire_exposure", "confidence": 0.78,
    },
    "toronto-neighbourhood-profiles-2021": {
        "name": "Neighbourhood Profiles — 2021 Census", "version": "2026-05-27",
        "resolution": "Neighbourhood", "signal": "neighbourhood_profile", "confidence": 0.76,
    },
    "toronto-forest-land-cover-2018": {
        "name": "Toronto Forest and Land Cover — 2018", "version": "2018",
        "resolution": "Land-cover polygon", "signal": "canopy_context", "confidence": 0.55,
    },
}


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value.strip().strip("\"'"))


def sql_path(path: Path | str) -> str:
    return str(path).replace("'", "''")


def duckdb_json(sql: str) -> list[dict[str, Any]]:
    result = subprocess.run(["duckdb", "-json", "-c", sql], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"DuckDB query failed: {result.stderr.strip()}")
    return json.loads(result.stdout or "[]")


def percentile_scores(counts: dict[str, float]) -> dict[str, float]:
    ordered = sorted(counts.values())
    if not ordered:
        return {}
    return {
        key: round(100 * (ordered.index(value) + 1) / len(ordered), 2)
        for key, value in counts.items()
    }


def safe_float(value: Any) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def fsa(value: Any) -> str | None:
    normalized = re.sub(r"\s+", "", str(value or "")).upper()[:3]
    return normalized if re.fullmatch(r"M[A-Z0-9]{2}", normalized) else None


def source_files(root: Path, source_key: str, version: str) -> tuple[Path | None, Path]:
    raw_dir = root / "raw" / source_key / f"version={version}"
    normalized_dir = root / "normalized" / source_key / f"version={version}"
    parquet = next(normalized_dir.glob("*.parquet"), None) if normalized_dir.exists() else None
    return parquet, raw_dir


def manifest_for(root: Path, source_key: str, version: str) -> dict[str, Any]:
    _, raw_dir = source_files(root, source_key, version)
    manifest = next(raw_dir.glob("*manifest.json"), None)
    if manifest:
        return json.loads(manifest.read_text(encoding="utf-8"))
    files = [p for p in raw_dir.rglob("*") if p.is_file()]
    if not files:
        return {}
    digest = hashlib.sha256()
    size = 0
    for file in sorted(files):
        size += file.stat().st_size
        with file.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return {
        "dataset_id": source_key,
        "dataset_version": version,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "download": {"checksum_sha256": digest.hexdigest(), "size_bytes": size},
        "commercial_use_status": "allowed",
    }


def profile_counts_sql(parquet: Path, date_column: str | None = None) -> list[dict[str, Any]]:
    date_filter = (
        f"AND coalesce(try_cast(\"{date_column}\" AS DATE), DATE '1900-01-01') >= DATE '2024-08-01'"
        if date_column else ""
    )
    return duckdb_json(f"""
      WITH base AS (
        SELECT upper(left(replace(POSTAL, ' ', ''), 3)) fsa,
          lower(concat_ws(' ', PERMIT_TYPE, STRUCTURE_TYPE, WORK, DESCRIPTION,
                          CURRENT_USE, PROPOSED_USE)) body
        FROM read_parquet('{sql_path(parquet)}')
        WHERE regexp_matches(upper(left(replace(POSTAL, ' ', ''), 3)), '^M[A-Z0-9]{{2}}$')
          {date_filter}
      )
      SELECT fsa, count(*) total,
        count(*) FILTER (WHERE body LIKE '%roof%') roofing,
        count(*) FILTER (WHERE body LIKE '%solar%' OR body LIKE '%green roof%') solar,
        count(*) FILTER (WHERE body LIKE '%mechanical%' OR body LIKE '%hvac%' OR body LIKE '%heating%') hvac,
        count(*) FILTER (WHERE body LIKE '%pest%') pest_control,
        count(*) FILTER (WHERE body LIKE '%alteration%' OR body LIKE '%addition%' OR body LIKE '%renovation%') renovation,
        count(*) FILTER (WHERE body LIKE '%security%' OR body LIKE '%fire alarm%') security_count
      FROM base GROUP BY fsa ORDER BY fsa
    """)


def permit_signals(root: Path, source_key: str, completed: bool = False) -> list[dict[str, Any]]:
    config = SOURCE_CONFIG[source_key]
    parquet, _ = source_files(root, source_key, config["version"])
    if not parquet:
        raise FileNotFoundError(source_key)
    rows = profile_counts_sql(parquet, "COMPLETED_DATE" if completed else "APPLICATION_DATE")
    total_scores = percentile_scores({row["fsa"]: float(row["total"]) for row in rows})
    category_scores = {
        key: percentile_scores({row["fsa"]: float(row.get(key) or 0) for row in rows})
        for key in ["roofing", "solar", "hvac", "pest_control", "renovation", "security_count"]
    }
    signals = []
    for row in rows:
        area = row["fsa"]
        base = total_scores[area]
        profiles: dict[str, float] = {}
        for profile in PROFILE_KEYS:
            category = "renovation" if profile in {"real_estate", "home_service", "insurance", "generic"} else profile
            if profile == "security":
                category = "security_count"
            local = category_scores.get(category, {}).get(area, base)
            profiles[profile] = round(
                (0.35 * base + 0.65 * (100 - local)) if completed else (0.55 * base + 0.45 * local), 2
            )
        signals.append({
            "source_record_id": area, "signal_key": config["signal"],
            "geography_level": "fsa", "area_key": area, "industry_keys": ["generic"],
            "score": round(base, 2), "raw_value": row["total"], "raw_unit": "recent permits",
            "observed_at": f"{config['version']}T00:00:00Z", "confidence": config["confidence"],
            "sample_size": int(row["total"]), "geom": None,
            "metrics": {"profile_scores": profiles, "category_counts": row, "area_estimate": True},
        })
    return signals


def simple_fsa_signals(root: Path, source_key: str, date_column: str | None = None) -> list[dict[str, Any]]:
    config = SOURCE_CONFIG[source_key]
    parquet, _ = source_files(root, source_key, config["version"])
    if not parquet:
        raise FileNotFoundError(source_key)
    date_filter = (
        f"AND coalesce(try_cast(\"{date_column}\" AS DATE), DATE '1900-01-01') >= DATE '2024-08-01'"
        if date_column else ""
    )
    rows = duckdb_json(f"""
      SELECT upper(left(replace(POSTAL, ' ', ''), 3)) fsa, count(*) total
      FROM read_parquet('{sql_path(parquet)}')
      WHERE regexp_matches(upper(left(replace(POSTAL, ' ', ''), 3)), '^M[A-Z0-9]{{2}}$')
        {date_filter}
      GROUP BY 1 ORDER BY 1
    """)
    scores = percentile_scores({row["fsa"]: float(row["total"]) for row in rows})
    industry = {
        "toronto-pool-enclosure-permits": ["home_service", "real_estate"],
        "toronto-green-roof-permits": ["roofing", "solar", "home_service"],
        "toronto-preliminary-zoning-reviews": ["generic"],
    }[source_key]
    return [{
        "source_record_id": row["fsa"], "signal_key": config["signal"],
        "geography_level": "fsa", "area_key": row["fsa"], "industry_keys": industry,
        "score": scores[row["fsa"]], "raw_value": row["total"], "raw_unit": "recent records",
        "observed_at": f"{config['version']}T00:00:00Z", "confidence": config["confidence"],
        "sample_size": int(row["total"]), "geom": None,
        "metrics": {"profile_scores": {key: scores[row["fsa"]] for key in industry}, "area_estimate": True},
    } for row in rows]


def service_request_signals(root: Path) -> list[dict[str, Any]]:
    source_key = "toronto-311-service-requests-2026"
    config = SOURCE_CONFIG[source_key]
    _, raw_dir = source_files(root, source_key, config["version"])
    archive = next(raw_dir.glob("*.zip"))
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    with zipfile.ZipFile(archive) as bundle:
        member = next(name for name in bundle.namelist() if name.lower().endswith(".csv"))
        with bundle.open(member) as binary:
            import io
            reader = csv.DictReader(io.TextIOWrapper(binary, encoding="cp1252", errors="replace", newline=""))
            for row in reader:
                area = fsa(row.get("First 3 Chars of Postal Code"))
                if not area:
                    continue
                body = " ".join([row.get("Service Request Type", ""), row.get("Division", ""), row.get("Section", "")]).lower()
                counts[area]["total"] += 1
                for key, terms in {
                    "roofing": ("roof", "eaves", "drain"),
                    "hvac": ("heating", "air condition", "temperature"),
                    "pest_control": ("pest", "rodent", "animal", "insect"),
                    "home_service": ("grass", "yard", "pool", "water", "garbage", "property standards"),
                    "security": ("noise", "lighting", "graffiti", "trespass", "safety"),
                }.items():
                    if any(term in body for term in terms):
                        counts[area][key] += 1
    totals = percentile_scores({area: values["total"] for area, values in counts.items()})
    category_scores = {
        key: percentile_scores({area: values[key] for area, values in counts.items()})
        for key in ["roofing", "hvac", "pest_control", "home_service", "security"]
    }
    result = []
    for area, values in counts.items():
        base = totals[area]
        profiles = {key: category_scores.get(key, {}).get(area, base) for key in PROFILE_KEYS}
        profiles.update({"generic": base, "real_estate": base, "insurance": profiles["security"]})
        result.append({
            "source_record_id": area, "signal_key": config["signal"], "geography_level": "fsa",
            "area_key": area, "industry_keys": ["generic"], "score": base,
            "raw_value": values["total"], "raw_unit": "2026 requests",
            "observed_at": f"{config['version']}T00:00:00Z", "confidence": config["confidence"],
            "sample_size": values["total"], "geom": None,
            "metrics": {"profile_scores": profiles, "category_counts": dict(values), "area_estimate": True},
        })
    return result


def ensure_ward_geojson(root: Path) -> Path:
    path = root / "raw" / "toronto-city-wards" / "version=2026-08-01" / "city-wards-data-4326.geojson"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        url = "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/5e7a8234-f805-43ac-820f-03d7c360b588/resource/737b29e0-8329-4260-b6af-21555ab24f28/download/city-wards-data-4326.geojson"
        urllib.request.urlretrieve(url, path)
    return path


def fsa_boundary_signals(root: Path) -> list[dict[str, Any]]:
    source_key = "statcan-fsa-boundaries-2021"
    config = SOURCE_CONFIG[source_key]
    _, raw_dir = source_files(root, source_key, config["version"])
    archive = raw_dir / "lfsa000b21a_e.zip"
    if not archive.exists():
        raise FileNotFoundError(archive)
    vsi_path = f"/vsizip/{archive}/lfsa000b21a_e/lfsa000b21a_e.shp"
    rows = duckdb_json(f"""
      INSTALL spatial; LOAD spatial;
      SELECT CFSAUID fsa, LANDAREA land_area,
        'SRID=4326;' || ST_AsText(ST_Transform(geom, 'EPSG:3347', 'EPSG:4326', always_xy := true)) geom
      FROM ST_Read('{sql_path(vsi_path)}')
      WHERE PRUID = '35' AND starts_with(CFSAUID, 'M')
    """)
    return [{
        "source_record_id": row["fsa"], "signal_key": config["signal"],
        "geography_level": "fsa", "area_key": row["fsa"], "industry_keys": [],
        "score": 50, "raw_value": row["land_area"], "raw_unit": "km² land area",
        "observed_at": "2021-05-11T00:00:00Z", "confidence": config["confidence"],
        "sample_size": 1, "geom": row["geom"],
        "metrics": {"geometry_only": True, "area_estimate": True},
    } for row in rows]


def utility_signals(root: Path) -> list[dict[str, Any]]:
    source_key = "toronto-utility-cut-permits"
    config = SOURCE_CONFIG[source_key]
    parquet, _ = source_files(root, source_key, config["version"])
    wards = ensure_ward_geojson(root)
    rows = duckdb_json(f"""
      INSTALL spatial; LOAD spatial;
      WITH cuts AS (
        SELECT lpad(regexp_replace(CITY_WARD, '[^0-9]', '', 'g'), 2, '0') ward, count(*) total
        FROM read_parquet('{sql_path(parquet)}')
        WHERE coalesce(try_cast(PROPOSED_TO_DATE AS DATE), DATE '1900-01-01') >= DATE '2026-01-01'
        GROUP BY 1
      ), boundaries AS (
        SELECT lpad(cast(AREA_SHORT_CODE AS VARCHAR), 2, '0') ward,
          'SRID=4326;' || ST_AsText(geom) geom
        FROM ST_Read('{sql_path(wards)}')
      )
      SELECT c.ward, c.total, b.geom FROM cuts c JOIN boundaries b USING (ward) ORDER BY c.ward
    """)
    raw_scores = percentile_scores({row["ward"]: float(row["total"]) for row in rows})
    return [{
        "source_record_id": row["ward"], "signal_key": config["signal"], "geography_level": "ward",
        "area_key": row["ward"], "industry_keys": ["generic"],
        "score": round(100 - raw_scores[row["ward"]], 2), "raw_value": row["total"],
        "raw_unit": "active/recent cuts", "observed_at": f"{config['version']}T00:00:00Z",
        "confidence": config["confidence"], "sample_size": int(row["total"]), "geom": row["geom"],
        "metrics": {"friction_percentile": raw_scores[row["ward"]], "area_estimate": True},
    } for row in rows]


def road_signals(root: Path) -> list[dict[str, Any]]:
    source_key = "toronto-road-restrictions"
    config = SOURCE_CONFIG[source_key]
    _, raw_dir = source_files(root, source_key, config["version"])
    path = raw_dir / "resource-1.csv"
    result = []
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as handle:
        handle.readline()  # export title row
        for row in csv.DictReader(handle):
            lat, lon = safe_float(row.get("Latitude")), safe_float(row.get("Longitude"))
            if lat is None or lon is None:
                continue
            severe = str(row.get("Type", "")).upper() == "ROAD_CLOSED"
            result.append({
                "source_record_id": row.get("ID") or f"{lon:.6f}:{lat:.6f}",
                "signal_key": config["signal"], "geography_level": "point", "area_key": None,
                "industry_keys": ["generic"], "score": 20 if severe else 45,
                "raw_value": 1, "raw_unit": "restriction", "observed_at": config["version"] + "T00:00:00Z",
                "confidence": config["confidence"], "sample_size": 1,
                "geom": f"SRID=4326;POINT({lon} {lat})",
                "metrics": {"road": row.get("Road"), "type": row.get("Type"), "severity": "closed" if severe else "restricted"},
            })
    return result


def traffic_signals(root: Path) -> list[dict[str, Any]]:
    source_key = "toronto-traffic-volume-summary"
    config = SOURCE_CONFIG[source_key]
    parquet, _ = source_files(root, source_key, config["version"])
    rows = duckdb_json(f"""
      SELECT coalesce(latest_count_id, _id) id, try_cast(longitude AS DOUBLE) lon,
        try_cast(latitude AS DOUBLE) lat, try_cast(avg_weekday_daily_vol AS DOUBLE) volume,
        location_name
      FROM read_parquet('{sql_path(parquet)}')
      WHERE try_cast(longitude AS DOUBLE) BETWEEN -79.7 AND -79.0
        AND try_cast(latitude AS DOUBLE) BETWEEN 43.5 AND 44.0
        AND try_cast(avg_weekday_daily_vol AS DOUBLE) IS NOT NULL
    """)
    volumes = percentile_scores({str(row["id"]): float(row["volume"]) for row in rows})
    return [{
        "source_record_id": str(row["id"]), "signal_key": config["signal"], "geography_level": "point",
        "area_key": None, "industry_keys": ["generic"], "score": round(100 - volumes[str(row["id"])], 2),
        "raw_value": row["volume"], "raw_unit": "weekday vehicles/day",
        "observed_at": config["version"] + "T00:00:00Z", "confidence": config["confidence"],
        "sample_size": 1, "geom": f"SRID=4326;POINT({row['lon']} {row['lat']})",
        "metrics": {"location": row["location_name"], "traffic_percentile": volumes[str(row["id"])]},
    } for row in rows]


def crime_rows(root: Path) -> list[dict[str, Any]]:
    source_key = "toronto-neighbourhood-crime-rates"
    config = SOURCE_CONFIG[source_key]
    _, raw_dir = source_files(root, source_key, config["version"])
    gpkg = next(raw_dir.glob("*.gpkg"))
    rows = duckdb_json(f"""
      INSTALL spatial; LOAD spatial;
      SELECT AREA_NAME area_name, cast(HOOD_ID AS INTEGER) hood_id, POPULATION_2025 population_count,
        coalesce(ASSAULT_RATE_2025,0) + coalesce(AUTOTHEFT_RATE_2025,0)
          + coalesce(BREAKENTER_RATE_2025,0) + coalesce(ROBBERY_RATE_2025,0)
          + coalesce(THEFTOVER_RATE_2025,0) combined_rate,
        'SRID=4326;' || ST_AsText(geom) geom
      FROM ST_Read('{sql_path(gpkg)}')
    """)
    scores = percentile_scores({str(row["hood_id"]): float(row["combined_rate"]) for row in rows})
    return [{
        "source_record_id": str(row["hood_id"]), "signal_key": config["signal"],
        "geography_level": "neighbourhood", "area_key": str(row["hood_id"]),
        "industry_keys": ["security", "insurance"], "score": scores[str(row["hood_id"])],
        "raw_value": round(float(row["combined_rate"]), 2), "raw_unit": "selected crimes / 100k",
        "observed_at": "2025-12-31T00:00:00Z", "confidence": config["confidence"],
        "sample_size": int(row["population_count"] or 0), "geom": row["geom"],
        "metrics": {"name": row["area_name"], "profile_scores": {
            "security": scores[str(row["hood_id"])], "insurance": scores[str(row["hood_id"])]
        }, "area_estimate": True},
    } for row in rows]


def fire_signals(root: Path) -> list[dict[str, Any]]:
    source_key = "toronto-fire-incidents"
    config = SOURCE_CONFIG[source_key]
    parquet, _ = source_files(root, source_key, config["version"])
    rows = duckdb_json(f"""
      WITH grouped AS (
        SELECT round(try_cast(Longitude AS DOUBLE), 2) lon,
          round(try_cast(Latitude AS DOUBLE), 2) lat, count(*) total,
          sum(coalesce(try_cast(Estimated_Dollar_Loss AS DOUBLE), 0)) loss
        FROM read_parquet('{sql_path(parquet)}')
        WHERE try_cast(TFS_Alarm_Time AS TIMESTAMP) >= TIMESTAMP '2021-01-01'
          AND try_cast(Longitude AS DOUBLE) BETWEEN -79.7 AND -79.0
          AND try_cast(Latitude AS DOUBLE) BETWEEN 43.5 AND 44.0
        GROUP BY 1,2
      ) SELECT * FROM grouped WHERE total > 0
    """)
    scores = percentile_scores({f"{row['lon']}:{row['lat']}": float(row["total"]) for row in rows})
    return [{
        "source_record_id": f"{row['lon']}:{row['lat']}", "signal_key": config["signal"],
        "geography_level": "point", "area_key": None, "industry_keys": ["insurance", "security"],
        "score": scores[f"{row['lon']}:{row['lat']}"], "raw_value": row["total"],
        "raw_unit": "fires since 2021", "observed_at": config["version"] + "T00:00:00Z",
        "confidence": config["confidence"], "sample_size": int(row["total"]),
        "geom": f"SRID=4326;POINT({row['lon']} {row['lat']})",
        "metrics": {"estimated_loss": row["loss"], "profile_scores": {
            "insurance": scores[f"{row['lon']}:{row['lat']}"],
            "security": scores[f"{row['lon']}:{row['lat']}"],
        }},
    } for row in rows]


def neighbourhood_profile_signals(root: Path, crime: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source_key = "toronto-neighbourhood-profiles-2021"
    config = SOURCE_CONFIG[source_key]
    _, raw_dir = source_files(root, source_key, config["version"])
    xlsx = next(raw_dir.glob("*.xlsx"))
    rows = duckdb_json(f"""
      INSTALL spatial; LOAD spatial;
      SELECT * FROM ST_Read('{sql_path(xlsx)}', layer='hd2021_census_profile')
      WHERE trim(\"Neighbourhood Name\") = 'Median total income of household in 2020 ($)'
    """)
    values = rows[0] if rows else {}
    incomes = {key: safe_float(value) for key, value in values.items() if key != "Neighbourhood Name"}
    valid = {key: value for key, value in incomes.items() if value is not None}
    scores = percentile_scores(valid)
    result = []
    for signal in crime:
        name = str(signal["metrics"].get("name", ""))
        if name not in valid:
            continue
        result.append({
            "source_record_id": signal["source_record_id"], "signal_key": config["signal"],
            "geography_level": "neighbourhood", "area_key": signal["area_key"], "industry_keys": [],
            "score": scores[name], "raw_value": valid[name], "raw_unit": "CAD median household income",
            "observed_at": "2021-05-11T00:00:00Z", "confidence": config["confidence"],
            "sample_size": signal["sample_size"], "geom": signal["geom"],
            "metrics": {"name": name, "validation_only": True, "area_estimate": True},
        })
    return result


def forest_signals(root: Path, neighbourhoods: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source_key = "toronto-forest-land-cover-2018"
    config = SOURCE_CONFIG[source_key]
    _, raw_dir = source_files(root, source_key, config["version"])
    archive = raw_dir / "landcover2018_gdb.zip"
    if not archive.exists():
        print("forest layer is not downloaded; leaving it unpromoted", file=sys.stderr)
        return []
    extract_dir = raw_dir / "extracted"
    if not extract_dir.exists():
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(extract_dir)
    geodatabase = next(extract_dir.rglob("*.gdb"), None)
    if not geodatabase:
        raise RuntimeError("forest archive contains no file geodatabase")
    layers = subprocess.run(["ogrinfo", "-ro", str(geodatabase)], check=True, capture_output=True, text=True).stdout
    layer_match = re.search(r"^\s*Layer:\s+(.+?)\s+\(", layers, re.MULTILINE) or re.search(
        r"^\d+:\s+(.+?)\s+\(", layers, re.MULTILINE
    )
    if not layer_match:
        raise RuntimeError("forest geodatabase has no readable layer")
    layer = layer_match.group(1)
    exported = subprocess.run([
        "ogr2ogr", "-f", "CSV", "/vsistdout/", str(geodatabase), "-dialect", "OGRSQL",
        "-sql", f'SELECT HoodNo,HoodName,"Desc",Shape_Area FROM "{layer}"',
    ], check=True, capture_output=True, text=True).stdout
    areas: dict[str, Counter[str]] = defaultdict(Counter)
    for row in csv.DictReader(exported.splitlines()):
        name = str(row.get("HoodName") or "").strip()
        area = safe_float(row.get("Shape_Area"))
        if not name or area is None or area <= 0:
            continue
        areas[name]["total"] += area
        if "tree" in str(row.get("Desc") or "").lower():
            areas[name]["canopy"] += area
    geometry_by_name = {
        str(signal["metrics"].get("name", "")): signal for signal in neighbourhoods
    }
    rows = []
    for name, values in areas.items():
        match = geometry_by_name.get(name)
        if not match or not values["total"]:
            continue
        rows.append({
            "name": name, "hood_id": match["area_key"], "geom": match["geom"],
            "canopy_pct": 100 * values["canopy"] / values["total"],
        })
    return [{
        "source_record_id": str(row["hood_id"]), "signal_key": config["signal"],
        "geography_level": "neighbourhood", "area_key": str(row["hood_id"]),
        "industry_keys": ["solar", "home_service", "pest_control"],
        "score": round(float(row["canopy_pct"]), 2), "raw_value": round(float(row["canopy_pct"]), 2),
        "raw_unit": "% canopy proxy", "observed_at": "2018-12-31T00:00:00Z",
        "confidence": config["confidence"], "sample_size": 1,
        "geom": row["geom"],
        "metrics": {"profile_scores": {
            "solar": round(100 - float(row["canopy_pct"]), 2),
            "home_service": round(float(row["canopy_pct"]), 2),
            "pest_control": round(float(row["canopy_pct"]), 2),
        }, "source_year": 2018, "name": row["name"], "area_estimate": True},
    } for row in rows]


class Postgrest:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def request(self, method: str, path: str, body: Any = None, prefer: str | None = None) -> Any:
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        request = urllib.request.Request(self.base + "/" + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = response.read()
                return json.loads(payload) if payload else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise RuntimeError(f"PostgREST {method} {path}: {error.code} {detail}") from error


def source_version_payload(root: Path, source_key: str, signal_count: int) -> dict[str, Any]:
    if FORBIDDEN_SOURCE_FRAGMENT in source_key:
        raise RuntimeError("street-tree datasets are prohibited")
    config = SOURCE_CONFIG[source_key]
    manifest = manifest_for(root, source_key, config["version"])
    download = manifest.get("download", {})
    checksum = download.get("checksum_sha256") or manifest.get("quality", {}).get("checksum_sha256")
    if not checksum:
        checksum = hashlib.sha256(f"{source_key}:{config['version']}".encode()).hexdigest()
    is_statcan = source_key.startswith("statcan-")
    return {
        "source_key": source_key, "dataset_name": config["name"], "dataset_version": config["version"],
        "provider": "Statistics Canada" if is_statcan else "City of Toronto",
        "licence_name": "Statistics Canada Open Licence" if is_statcan else LICENCE_NAME,
        "licence_url": "https://www.statcan.gc.ca/en/reference/licence" if is_statcan else LICENCE_URL,
        "release_date": config["version"] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", config["version"]) else None,
        "fetched_at": manifest.get("retrieved_at") or datetime.now(timezone.utc).isoformat(),
        "checksum_sha256": checksum, "coverage": TORONTO_COVERAGE,
        "metadata": {"signal_key": config["signal"], "signal_count": signal_count,
                     "street_trees_excluded": True, "commercial_use_status": "allowed"},
        "is_promoted": False, "authority_tier": "federal" if is_statcan else "municipal",
        "geographic_resolution": config["resolution"],
        "refresh_policy": {"frequency": "source release", "adapter": "toronto-territory-iq-v1"},
        "licence_status": "allowed", "quality_report": {"valid": True, "signal_count": signal_count},
        "derived_metric_versions": {config["signal"]: "toronto-signals-v1"},
    }


def validate_signals(source_key: str, rows: list[dict[str, Any]]) -> None:
    if FORBIDDEN_SOURCE_FRAGMENT in source_key or any(row.get("signal_key") == "street_tree" for row in rows):
        raise RuntimeError("street-tree records are prohibited")
    if not rows:
        raise RuntimeError(f"{source_key} generated no signals")
    ids = set()
    for row in rows:
        if row["source_record_id"] in ids:
            raise RuntimeError(f"duplicate signal id {source_key}:{row['source_record_id']}")
        ids.add(row["source_record_id"])
        if not 0 <= float(row["score"]) <= 100 or not 0 <= float(row["confidence"]) <= 1:
            raise RuntimeError(f"invalid score/confidence in {source_key}")


def publish_source(client: Postgrest, root: Path, source_key: str, rows: list[dict[str, Any]], promote: bool) -> None:
    validate_signals(source_key, rows)
    payload = source_version_payload(root, source_key, len(rows))
    versions = client.request(
        "POST", "territory_iq_source_versions?on_conflict=source_key,dataset_version",
        payload, "resolution=merge-duplicates,return=representation",
    )
    source_id = versions[0]["id"]
    for start in range(0, len(rows), 250):
        batch = [{**row, "source_version_id": source_id} for row in rows[start:start + 250]]
        client.request(
            "POST", "territory_iq_area_signals?on_conflict=source_version_id,source_record_id,signal_key",
            batch, "resolution=merge-duplicates,return=minimal",
        )
    if promote:
        client.request("PATCH", f"territory_iq_source_versions?source_key=eq.{source_key}&id=neq.{source_id}", {"is_promoted": False, "promoted_at": None})
        client.request("PATCH", f"territory_iq_source_versions?id=eq.{source_id}", {
            "is_promoted": True, "promoted_at": datetime.now(timezone.utc).isoformat()
        })
    print(f"{source_key}: {len(rows):,} signals {'promoted' if promote else 'staged'}")


def build_all(root: Path) -> dict[str, list[dict[str, Any]]]:
    crime = crime_rows(root)
    builders = {
        "statcan-fsa-boundaries-2021": fsa_boundary_signals(root),
        "toronto-active-building-permits": permit_signals(root, "toronto-active-building-permits"),
        "toronto-cleared-building-permits": permit_signals(root, "toronto-cleared-building-permits", completed=True),
        "toronto-pool-enclosure-permits": simple_fsa_signals(root, "toronto-pool-enclosure-permits", "APPLICATION_DATE"),
        "toronto-green-roof-permits": simple_fsa_signals(root, "toronto-green-roof-permits", "APPLICATION_DATE"),
        "toronto-preliminary-zoning-reviews": simple_fsa_signals(root, "toronto-preliminary-zoning-reviews", "APPLICATION_DATE"),
        "toronto-311-service-requests-2026": service_request_signals(root),
        "toronto-utility-cut-permits": utility_signals(root),
        "toronto-road-restrictions": road_signals(root),
        "toronto-traffic-volume-summary": traffic_signals(root),
        "toronto-neighbourhood-crime-rates": crime,
        "toronto-fire-incidents": fire_signals(root),
        "toronto-neighbourhood-profiles-2021": neighbourhood_profile_signals(root, crime),
    }
    forest = forest_signals(root, crime)
    if forest:
        builders["toronto-forest-land-cover-2018"] = forest
    return builders


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--promote", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    load_env(args.env_file)
    if any(FORBIDDEN_SOURCE_FRAGMENT in key for key in SOURCE_CONFIG):
        raise RuntimeError("forbidden street-tree source configured")
    sources = build_all(args.root)
    report = {key: len(rows) for key, rows in sources.items()}
    print(json.dumps({"sources": report, "total_signals": sum(report.values()), "street_trees": 0}, indent=2))
    if args.dry_run:
        return 0
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    client = Postgrest(url, key)
    for source_key, rows in sources.items():
        publish_source(client, args.root, source_key, rows, args.promote)
    forbidden = client.request("GET", "territory_iq_area_signals?signal_key=eq.street_tree&select=id&limit=1")
    if forbidden:
        raise RuntimeError("street-tree signal found after ingestion")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
