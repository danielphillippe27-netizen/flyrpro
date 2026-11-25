#!/usr/bin/env python3
"""Prepare daily regional MRMS hail maps for Canadian land in NOAA's radar grid."""
import argparse
import importlib.util
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np
from rasterio.features import geometry_mask, shapes
from rasterio.io import MemoryFile
from rasterio.windows import Window, from_bounds
from shapely import get_parts, make_valid, set_precision, unary_union
from shapely.geometry import MultiPolygon, box, mapping, shape

BASE = Path(__file__).resolve().parent
builder_spec = importlib.util.spec_from_file_location("mrms_builder", BASE / "build-mrms-hail-zones.py")
builder = importlib.util.module_from_spec(builder_spec)
builder_spec.loader.exec_module(builder)
ADMIN = BASE.parent / "lib/storm-maps/intelligence"
PROVINCE_CODE = {
    "Alberta": "AB", "British Columbia": "BC", "Manitoba": "MB", "New Brunswick": "NB",
    "Newfoundland and Labrador": "NL", "Nova Scotia": "NS", "Northwest Territories": "NT",
    "Nunavut": "NU", "Ontario": "ON", "Prince Edward Island": "PE", "Quebec": "QC",
    "Saskatchewan": "SK", "Yukon": "YT",
}
MINIMUM_CORE_CELLS = 8
SEVERE_MM = 25.4
NOON = time(12, tzinfo=timezone.utc)
CELL_DEGREES = 0.01


@lru_cache(maxsize=2)
def province_windows(transform, domain_bounds, width, height):
    regions = json.loads((ADMIN / "wind-region-boundaries.json").read_text())
    domain = box(*domain_bounds)
    extent = Window(0, 0, width, height)
    windows = []
    for region in regions:
        if region["country"] != "CA":
            continue
        province = make_valid(shape(region["geometry"])).intersection(domain)
        if province.is_empty or province.area < CELL_DEGREES**2:
            continue
        window = from_bounds(*province.bounds, transform=transform).round_offsets().round_lengths()
        window = window.intersection(extent)
        sampled = geometry_mask([mapping(province)], (int(window.height), int(window.width)),
                                transform * transform.translation(window.col_off, window.row_off), invert=True)
        windows.append((region["name"], province, window, sampled))
    return windows


def polygon_parts(geometry):
    return [part for part in get_parts(geometry) if part.geom_type == "Polygon" and part.area > 0]


def cell_polygons(mask, transform):
    for outline, _ in shapes(mask.astype("uint8"), mask=mask, transform=transform):
        yield shape(outline)


def severity_rows(key, values, transform, province, interior, frame):
    areal_threshold = MINIMUM_CORE_CELLS * CELL_DEGREES**2 * 0.999
    cores = [footprint for footprint in cell_polygons(values >= SEVERE_MM, transform)
             if footprint.area >= areal_threshold]
    if not cores:
        return []
    core_union = unary_union([make_valid(footprint) for footprint in cores])
    def footprints(threshold):
        shapes = (make_valid(footprint) for footprint in cell_polygons(values >= threshold, transform))
        return [footprint for footprint in shapes if footprint.intersection(core_union).area > 0]

    # A swath cut by the radar grid can hide part of the hail path. Keep closed
    # components, while provincial borders remain explicit geographic cuts.
    baseline_parts = [footprint for footprint in footprints(builder.THRESHOLDS_MM[0])
                      if interior.covers(footprint)]
    baseline = unary_union(baseline_parts).intersection(province)
    rows = []
    for threshold in builder.THRESHOLDS_MM:
        if threshold == builder.THRESHOLDS_MM[0]:
            geometry = baseline
        else:
            geometry = unary_union(footprints(threshold)).intersection(baseline)
        polygon_set = polygon_parts(make_valid(set_precision(geometry, 0.000001, mode="pointwise")))
        if not polygon_set:
            continue
        zone = MultiPolygon(polygon_set)
        if not zone.is_valid:
            zone = MultiPolygon(polygon_parts(make_valid(zone)))
        if not zone.is_valid or zone.is_empty:
            raise ValueError(f"Invalid {threshold} mm geometry for {key}")
        rows.append({
            "event_key": key, "minimum_mm": threshold, "geometry": mapping(zone),
            "source_resolution_m": 1000, "estimation_method": builder.METHOD,
            "source_updated_at": frame.isoformat(), "validated": True, "license_verified": True,
        })
    return rows if len(rows) >= 2 else []


def process_day(day, assets):
    frame = datetime.combine(day + timedelta(days=1), NOON)
    source_url, data = builder.grid_bytes(frame)
    entries = []
    with MemoryFile(data) as source, source.open() as grid:
        builder.validate_grid(grid, frame)
        interior = box(*grid.bounds).buffer(-0.001)
        for province_name, province, window, mask in province_windows(grid.transform, tuple(grid.bounds), grid.width, grid.height):
            values = grid.read(1, window=window)
            values = np.where(mask & np.isfinite(values) & (values > 0), values, 0)
            if np.count_nonzero(values >= SEVERE_MM) < MINIMUM_CORE_CELLS:
                continue
            province_code = PROVINCE_CODE[province_name]
            key = f"noaa-mrms:ca:hail:{day}:{province_code}"
            transform = grid.window_transform(window)
            rows = severity_rows(key, values, transform, province, interior, frame)
            if not rows:
                continue
            overlay = builder.render_overlay(key, rows, values, transform, assets)
            entry = {
                "key": key, "title": f"{province_name} estimated hail · {day}", "hazard": "hail",
                "source": "noaa-mrms", "sourceId": frame.strftime("%Y%m%d-%H%M%S:MESHMax1440min"),
                "start": (frame - timedelta(days=1)).isoformat(), "end": frame.isoformat(),
                "features": [], "reportCount": 0, "maxHailMM": None, "maxWindKPH": None,
                "category": None, "active": False, "footprintStatus": "unavailable",
                "hailMap": {"coordinates": overlay["coordinates"]},
            }
            entries.append({"event": entry, "zones": rows, "image": overlay["url"].rsplit("/", 1)[-1],
                            "sourceUrl": source_url})
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", required=True, type=date.fromisoformat)
    parser.add_argument("--through", dest="end", required=True, type=date.fromisoformat)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    days = (args.end - args.start).days + 1
    if not 1 <= days <= 370 or datetime.combine(args.end + timedelta(days=1), NOON) > datetime.now(timezone.utc):
        parser.error("Choose up to 370 finished radar days")
    args.output.mkdir(parents=True, exist_ok=True)
    assets = args.output / "images"
    assets.mkdir(exist_ok=True)

    def prepare(day):
        try:
            return day, process_day(day, assets), None
        except Exception as error:
            return day, [], str(error)

    entries, failures = [], {}
    with ThreadPoolExecutor(max_workers=3) as workers:
        for index, (day, storms, error) in enumerate(workers.map(prepare, (
            args.start + timedelta(days=offset) for offset in range(days)
        )), 1):
            if error:
                failures[day.isoformat()] = error
                print(f"{day}: {error}", file=sys.stderr)
            entries.extend(storms)
            if index % 25 == 0 or index == days:
                print(f"Checked {index}/{days} days, prepared {len(entries)} maps", file=sys.stderr)
    (args.output / "manifest.json").write_text(json.dumps({"entries": entries, "failures": failures}) + "\n")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
