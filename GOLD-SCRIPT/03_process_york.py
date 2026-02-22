#!/usr/bin/env python3
"""
03_process_york.py
Shapefile -> Clean NDJSON (EWKT, SRID=4326) -> S3

Requires:
  pip install pyshp shapely pyproj boto3
"""

import json
import logging
from pathlib import Path
from datetime import datetime

import shapefile
from shapely.geometry import shape, MultiPolygon, Polygon
from shapely.ops import transform as shp_transform
from pyproj import CRS, Transformer, Geod

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
log = logging.getLogger("processor")

STORAGE_PATH = "/Volumes/Untitled 2/municipal_data"
S3_BUCKET = "flyr-pro-addresses-2025"


def transformer_from_prj(prj_path: Path) -> Transformer:
    if not prj_path.exists():
        raise RuntimeError(f"Missing .prj file: {prj_path}")
    wkt = prj_path.read_text(errors="ignore").strip()
    if not wkt:
        raise RuntimeError(f"Empty .prj file: {prj_path}")
    src = CRS.from_wkt(wkt)
    return Transformer.from_crs(src, "EPSG:4326", always_xy=True)


def attrs_dict(sf: shapefile.Reader, rec) -> dict:
    names = [f[0] for f in sf.fields[1:]]
    return dict(zip(names, rec))


def upload_to_s3(local_path: Path, key: str):
    import boto3
    s3 = boto3.client("s3")
    s3.upload_file(str(local_path), S3_BUCKET, key)
    log.info(f"Uploaded to s3://{S3_BUCKET}/{key}")


def geodesic_area_m2(geod: Geod, geom):
    """Robust geodesic area for Polygon/MultiPolygon in WGS84."""
    if geom.is_empty:
        return None

    def poly_area(p: Polygon) -> float:
        a, _ = geod.geometry_area_perimeter(p)
        return abs(a)

    if geom.geom_type == "Polygon":
        return poly_area(geom)

    if geom.geom_type == "MultiPolygon":
        return sum(poly_area(p) for p in geom.geoms)

    return None


def process_buildings(shp_path: Path, source_id: str):
    tr = transformer_from_prj(shp_path.with_suffix(".prj"))
    geod = Geod(ellps="WGS84")
    sf = shapefile.Reader(str(shp_path))

    clean_dir = Path(STORAGE_PATH) / "clean" / source_id
    clean_dir.mkdir(parents=True, exist_ok=True)
    output = clean_dir / f"{source_id}_gold.ndjson"

    count, skipped = 0, 0

    with output.open("w") as f:
        for sr in sf.iterShapeRecords():
            try:
                geom = shape(sr.shape.__geo_interface__)
                if geom.is_empty:
                    skipped += 1
                    continue

                # Force MultiPolygon
                if geom.geom_type == "Polygon":
                    geom = MultiPolygon([geom])
                if geom.geom_type != "MultiPolygon":
                    skipped += 1
                    continue

                geom_wgs84 = shp_transform(tr.transform, geom)

                # Fix invalid geometry if possible
                if not geom_wgs84.is_valid:
                    geom_wgs84 = geom_wgs84.buffer(0)
                if geom_wgs84.is_empty or not geom_wgs84.is_valid:
                    skipped += 1
                    continue

                rep_pt = geom_wgs84.representative_point()
                area_m2 = geodesic_area_m2(geod, geom_wgs84)

                a = attrs_dict(sf, sr.record)

                external_id = a.get("OBJECTID")
                if external_id is None:
                    # Required for stable UPSERT
                    skipped += 1
                    continue

                year_colle = a.get("YEAR_COLLE")
                year_built = int(year_colle) if str(year_colle).isdigit() else None

                rec = {
                    "source_id": source_id,
                    "source_file": shp_path.name,
                    "source_url": "https://insights-york.opendata.arcgis.com/",
                    "source_date": datetime.now().date().isoformat(),
                    "external_id": str(external_id),
                    "parcel_id": None,
                    "geom": f"SRID=4326;{geom_wgs84.wkt}",
                    "centroid": f"SRID=4326;{rep_pt.wkt}",
                    "area_sqm": round(area_m2, 2) if area_m2 else None,
                    "height_m": None,
                    "floors": None,
                    "year_built": year_built,
                    "building_type": a.get("STATUS"),
                    "subtype": a.get("MUNICIPALI"),
                    "primary_address": None,
                    "primary_street_number": None,
                    "primary_street_name": None,
                }

                f.write(json.dumps(rec) + "\n")
                count += 1

                if count % 10000 == 0:
                    log.info(f"buildings: {count:,} (skipped {skipped:,})")

            except Exception:
                skipped += 1
                continue

    log.info(f"Wrote buildings: {count:,} (skipped {skipped:,}) -> {output}")
    key = f"gold-standard/canada/ontario/{source_id}/{datetime.now():%Y%m%d}/{source_id}_gold.ndjson"
    upload_to_s3(output, key)


def process_addresses(shp_path: Path, source_id: str):
    tr = transformer_from_prj(shp_path.with_suffix(".prj"))
    sf = shapefile.Reader(str(shp_path))

    clean_dir = Path(STORAGE_PATH) / "clean" / source_id
    clean_dir.mkdir(parents=True, exist_ok=True)
    output = clean_dir / f"{source_id}_gold.ndjson"

    count, skipped = 0, 0

    with output.open("w") as f:
        for sr in sf.iterShapeRecords():
            try:
                geom = shape(sr.shape.__geo_interface__)
                if geom.is_empty:
                    skipped += 1
                    continue

                geom_wgs84 = shp_transform(tr.transform, geom)

                # Expect Points for addresses
                if geom_wgs84.geom_type != "Point":
                    skipped += 1
                    continue

                a = attrs_dict(sf, sr.record)

                street_num = a.get("ADDRESS_NU")
                street_name = a.get("FULL_STREE")
                if not street_num or not street_name:
                    skipped += 1
                    continue

                zip_code = a.get("MAIL_POSTA")
                if zip_code:
                    z = str(zip_code).upper().replace(" ", "")
                    if len(z) == 6:
                        zip_code = f"{z[:3]} {z[3:]}"

                rec = {
                    "source_id": source_id,
                    "source_file": shp_path.name,
                    "source_url": "https://insights-york.opendata.arcgis.com/",
                    "source_date": datetime.now().date().isoformat(),
                    "street_number": str(street_num),
                    "street_name": str(street_name),
                    "unit": a.get("SUITE_NUMB") or a.get("UNIT_DESIG"),
                    "city": a.get("MUNICIPALI", "York Region"),
                    "zip": zip_code,
                    "province": "ON",
                    "country": "CA",
                    "geom": f"SRID=4326;{geom_wgs84.wkt}",
                    "address_type": a.get("ADDRS_PNT_"),
                    "precision": "rooftop",
                }

                f.write(json.dumps(rec) + "\n")
                count += 1

                if count % 10000 == 0:
                    log.info(f"addresses: {count:,} (skipped {skipped:,})")

            except Exception:
                skipped += 1
                continue

    log.info(f"Wrote addresses: {count:,} (skipped {skipped:,}) -> {output}")
    key = f"gold-standard/canada/ontario/{source_id}/{datetime.now():%Y%m%d}/{source_id}_gold.ndjson"
    upload_to_s3(output, key)


if __name__ == "__main__":
    buildings = Path(STORAGE_PATH) / "raw/York_buildings/Building_Footprint/Building_Footprint.shp"
    addresses = Path(STORAGE_PATH) / "raw/York_addresses/Address_Point/Address_Point.shp"

    process_buildings(buildings, "york_buildings")
    process_addresses(addresses, "york_addresses")
