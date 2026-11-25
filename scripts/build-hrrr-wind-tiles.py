#!/usr/bin/env python3
"""Create one bounded WolfGrid wind frame using NOAA HRRR surface gust analysis."""
import argparse
import base64
import io
import json
import sys
from datetime import datetime, timezone
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds

ZOOM = 4
TILE_SIZE = 512
MERCATOR_HALF_WORLD = 20037508.342789244


def download(url, limit, byte_range=None):
    headers = {"Range": byte_range} if byte_range else {}
    with urlopen(Request(url, headers=headers), timeout=30) as response:
        if byte_range and response.status != 206:
            raise ValueError("NOAA did not return the requested GRIB range")
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("NOAA response exceeded the import limit")
    return data


def gust_analysis(hour):
    url = (
        "https://noaa-hrrr-bdp-pds.s3.amazonaws.com/"
        f"hrrr.{hour:%Y%m%d}/conus/hrrr.t{hour:%H}z.wrfsfcf00.grib2"
    )
    rows = download(url + ".idx", 512_000).decode().splitlines()
    index = next(i for i, row in enumerate(rows) if ":GUST:surface:anl:" in row)
    first = int(rows[index].split(":")[1])
    last = int(rows[index + 1].split(":")[1]) - 1
    if not 0 <= first <= last or last - first > 8_000_000:
        raise ValueError("Unexpected HRRR gust byte range")
    return url, download(url, 8_000_001, f"bytes={first}-{last}")


def build_tiles(grid, area):
    west, south, east, north = transform_bounds("EPSG:4326", "EPSG:3857", *area)
    half = MERCATOR_HALF_WORLD
    tile_span = 2 * half / 2**ZOOM
    minimum_x, maximum_x = int((west + half) // tile_span), int((east + half) // tile_span)
    minimum_y, maximum_y = int((half - north) // tile_span), int((half - south) // tile_span)
    tiles = {}
    source = grid.read(1)
    for x in range(minimum_x, maximum_x + 1):
        left = -half + x * tile_span
        for y in range(minimum_y, maximum_y + 1):
            top = half - y * tile_span
            transform = from_bounds(left, top - tile_span, left + tile_span, top, TILE_SIZE, TILE_SIZE)
            gusts = np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype="float32")
            reproject(
                source, gusts, src_transform=grid.transform, src_crs=grid.crs,
                src_nodata=grid.nodata, dst_transform=transform, dst_crs="EPSG:3857",
                dst_nodata=np.nan, resampling=Resampling.nearest,
            )
            cx = left + (np.arange(TILE_SIZE) + 0.5) * tile_span / TILE_SIZE
            cy = top - (np.arange(TILE_SIZE) + 0.5) * tile_span / TILE_SIZE
            covered = (
                np.isfinite(gusts) & (gusts >= 0)
                & ((cx >= west) & (cx <= east))[None, :]
                & ((cy >= south) & (cy <= north))[:, None]
            )
            if not covered.any():
                continue
            pixels = np.zeros(gusts.shape, dtype=np.uint8)
            pixels[covered] = 1 + np.rint(np.clip(gusts[covered], 0, 100) * 2.54).astype(np.uint8)
            buffer = io.BytesIO()
            Image.fromarray(pixels).save(buffer, format="PNG", optimize=True)
            tiles[f"{ZOOM}/{x}/{y}"] = base64.b64encode(buffer.getvalue()).decode()
    if not tiles:
        raise ValueError("The requested region has no valid HRRR analysis data")
    return tiles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hour", help="UTC hour in YYYY-MM-DDTHH format")
    parser.add_argument("--bounds", type=float, nargs=4, required=True, metavar=("W", "S", "E", "N"))
    args = parser.parse_args()
    hour = datetime.strptime(args.hour, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
    w, s, e, n = args.bounds
    if not (-130 <= w < e <= -60 and 20 <= s < n <= 55 and e - w <= 15 and n - s <= 10):
        parser.error("Choose a bounded region within the contiguous-U.S. HRRR domain")
    url, data = gust_analysis(hour)
    with MemoryFile(data) as source, source.open() as grid:
        tags = grid.tags(1)
        if (tags.get("GRIB_ELEMENT"), tags.get("GRIB_UNIT"), tags.get("GRIB_VALID_TIME")) != (
            "GUST", "[m/s]", str(int(hour.timestamp()))
        ) or not grid.crs:
            raise ValueError("Unexpected HRRR variable, units, time or projection")
        numeric = build_tiles(grid, args.bounds)
    json.dump({
        "time": hour.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "sourceUrl": url, "bounds": args.bounds, "numericTiles": numeric,
    }, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
