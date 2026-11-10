#!/usr/bin/env python3
"""Prepare reviewable storm_severity_zones rows from NOAA's daily CONUS hail grid.

uv run --with rasterio --with shapely --with pillow --env-file .env.local scripts/build-mrms-hail-zones.py iem:hail:2026-10-21:AZ > zones.json

Reads saved IEM hail reports from Supabase. Writes candidate rows to stdout and optionally renders map overlays.
"""
import argparse
import gzip
import io
import json
import os
import re
import sys
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image
from rasterio.features import geometry_mask, shapes
from rasterio.transform import from_bounds as raster_from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.io import MemoryFile
from rasterio.windows import Window, from_bounds
from shapely import get_parts, make_valid, set_precision
from shapely.geometry import MultiPolygon, Point, shape

THRESHOLDS_MM = (12.7, 25.4, 44.45, 63.5)
METHOD = "WolfGrid zones derived from NOAA MRMS 24-hour maximum estimated hail size"


def fetch(url, headers=None, limit=10_000_000):
    with urlopen(Request(url, headers=headers or {}), timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Source response exceeded the size limit")
    return data


@lru_cache(maxsize=2)
def grid_bytes(end):
    folder = end.strftime("%Y%m%d")
    stamp = end.strftime("%Y%m%d-%H%M%S")
    url = (
        "https://noaa-mrms-pds.s3.amazonaws.com/CONUS/"
        f"MESH_Max_1440min_00.50/{folder}/MRMS_MESH_Max_1440min_00.50_{stamp}.grib2.gz"
    )
    compressed = fetch(url)
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as source:
        data = source.read(100_000_001)
    if len(data) > 100_000_000:
        raise ValueError("Decompressed grid exceeded the size limit")
    return url, data


def report_points(event):
    return [
        Point(feature["geometry"]["coordinates"])
        for feature in event["features"]
        if feature["properties"]["kind"] == "report" and feature["geometry"]["type"] == "Point"
    ]


def render_overlay(event_key, rows, values, transform, directory):
    # Render the numerical grid for display. Saved territory boundaries still
    # come from the original threshold cells.
    footprint = shape(rows[0]["geometry"]).buffer(0.035)
    west, south, east, north = footprint.bounds
    w, s, e, n = transform_bounds("EPSG:4326", "EPSG:3857", west, south, east, north)
    scale = max(250, max(e - w, n - s) / 2048)
    width, height = max(2, round((e - w) / scale)), max(2, round((n - s) / scale))
    target = raster_from_bounds(w, s, e, n, width, height)
    observed = np.ma.filled(values, 0)
    mask = geometry_mask([footprint], observed.shape, transform, invert=True)
    source = np.where(mask & np.isfinite(observed), np.maximum(observed, 0), 0).astype("float32")
    hail = np.zeros((height, width), dtype="float32")
    reproject(
        source, hail, src_transform=transform, src_crs="EPSG:4326",
        dst_transform=target, dst_crs="EPSG:3857", resampling=Resampling.bilinear,
    )
    # Approximate the original hail layer's violet, blue, teal, yellow and
    # orange progression. Interpolate size first to avoid coloured grid seams.
    stops = np.array([0, 6.35, 12.7, 25.4, 38.1, 50.8, 63.5, 76.2])
    colors = np.array([
        [49, 29, 133], [45, 42, 177], [31, 89, 184], [13, 158, 154],
        [111, 191, 58], [237, 217, 31], [251, 163, 16], [244, 79, 17],
    ])
    alpha = np.interp(hail, [0, 2, 8, 15], [0, 0, 153, 230])
    pixels = np.dstack([*[np.interp(hail, stops, rgb) for rgb in colors.T], alpha]).astype("uint8")
    filename = event_key.removeprefix("iem:hail:").replace(":", "-") + ".png"
    Image.fromarray(pixels).save(directory / filename, optimize=True)
    return {
        "url": f"/storm-maps/hail/mrms-v1/{filename}",
        "coordinates": [[west, north], [east, north], [east, south], [west, south]],
    }


def event_zones(event, day, overlay_directory, overlays):
    reports = report_points(event)
    if not reports:
        return []
    # The 00 UTC frame on the following day represents the report group's UTC day.
    end = datetime.combine(day + timedelta(days=1), time(), timezone.utc)
    url, data = grid_bytes(end)
    with MemoryFile(data) as source, source.open() as grid:
        tags = grid.tags(1)
        if (
            tags.get("GRIB_ELEMENT") != "MESHMax1440min"
            or tags.get("GRIB_UNIT") != "[mm]"
            or tags.get("GRIB_VALID_TIME") != str(int(end.timestamp()))
            or not grid.crs or not grid.crs.is_geographic
            or not np.allclose((grid.transform.a, grid.transform.e), (0.01, -0.01))
            or grid.transform.b or grid.transform.d
        ):
            raise ValueError("Unexpected NOAA hail grid product, time or georeferencing")
        # Select same-day swaths within about 30 km of a report. Keep the entire
        # connected area and reject a crop that would cut one short.
        nearby = [p.buffer(0.3) for p in reports]
        west, east = min(p.x for p in reports) - 2, max(p.x for p in reports) + 2
        south, north = min(p.y for p in reports) - 2, max(p.y for p in reports) + 2
        window = from_bounds(west, south, east, north, grid.transform).round_offsets().round_lengths()
        window = window.intersection(Window(0, 0, grid.width, grid.height))
        values = grid.read(1, window=window, masked=True)
        transform = grid.window_transform(window)

    rows = []
    for threshold in THRESHOLDS_MM:
        cells = np.ma.filled(np.isfinite(values) & (values >= threshold), False)
        parts = []
        for outline, _ in shapes(cells.astype("uint8"), mask=cells, transform=transform):
            footprint = shape(outline)
            if not any(footprint.intersects(buffer) for buffer in nearby):
                continue
            left, bottom, right, top = footprint.bounds
            if left <= transform.c or top >= transform.f or right >= transform.c + transform.a * window.width or bottom <= transform.f + transform.e * window.height:
                raise ValueError(f"Selected swath touches the crop edge at {threshold} mm")
            parts.extend(
                set_precision(part, 0.000001).simplify(0)
                for part in get_parts(make_valid(footprint))
                if part.geom_type == "Polygon"
            )
        if not parts:
            continue
        zone = MultiPolygon(parts)
        if zone.is_empty or not zone.is_valid:
            raise ValueError(f"Invalid zone geometry at {threshold} mm")
        rows.append({
            "event_key": event["key"],
            "minimum_mm": threshold,
            "geometry": zone.__geo_interface__,
            "source_resolution_m": 1000,
            "estimation_method": METHOD,
            "source_updated_at": end.isoformat(),
            "validated": True,
            "license_verified": True,
        })
    if rows and overlay_directory:
        overlays[event["key"]] = render_overlay(event["key"], rows, values, transform, overlay_directory)
    print(f"{event['key']}: {len(rows)} thresholds from {url}", file=sys.stderr)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("event_keys", nargs="+")
    parser.add_argument("--overlay-directory", type=Path)
    parser.add_argument("--overlay-index", type=Path)
    args = parser.parse_args()
    if bool(args.overlay_directory) != bool(args.overlay_index):
        parser.error("Supply both overlay output paths")
    if args.overlay_directory:
        args.overlay_directory.mkdir(parents=True, exist_ok=True)
    keys = sorted(set(args.event_keys))
    if any(not re.fullmatch(r"iem:hail:\d{4}-\d{2}-\d{2}:[A-Z]{2}", key) for key in keys):
        parser.error("Use saved IEM hail event keys (iem:hail:YYYY-MM-DD:ST)")

    base = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    query = urlencode({"select": "metadata", "event_key": f"in.({','.join(keys)})"})
    events = {
        row["metadata"]["key"]: row["metadata"]
        for row in json.loads(fetch(
            f"{base}/rest/v1/storm_events?{query}",
            {"apikey": service_key, "Authorization": f"Bearer {service_key}"},
        ))
    }
    if set(events) != set(keys):
        parser.error(f"Saved storms missing: {', '.join(set(keys) - set(events))}")
    overlays = {}
    rows = [
        row for key in keys
        for row in event_zones(events[key], date.fromisoformat(key.split(":")[2]), args.overlay_directory, overlays)
    ]
    if args.overlay_index:
        args.overlay_index.write_text(json.dumps(overlays, indent=2) + "\n")
    json.dump(rows, sys.stdout, separators=(",", ":"), allow_nan=False)
    print()


if __name__ == "__main__":
    main()
