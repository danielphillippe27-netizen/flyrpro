# Blender scripting editor — run inside Blender. Pure stdlib + bpy.
# Set EXPORT_DIR to your downloaded campaign v1 folder.

import bpy
import json
import math
import os

EXPORT_DIR = "/Users/danielphillippe/Desktop/FLYR-PRO/blender-exports/e375825f-672c-4ebc-9f09-05eb566730fb"  # auto-set by make-blender-scene.sh
TARGET_COLOR = (0.9, 0.2, 0.2, 1.0)
CONTEXT_COLOR = (0.7, 0.7, 0.7, 1.0)
ROAD_COLOR = (0.15, 0.15, 0.15, 1.0)
BOUNDARY_COLOR = (0.2, 0.6, 1.0, 1.0)
DEFAULT_HEIGHT_M = 7.0


def load_geojson(filename):
    path = os.path.join(EXPORT_DIR, filename)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def make_collection(name):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def make_material(name, color):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = color
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def polygon_to_mesh(name, rings, height, collection, material):
    outer = list(rings[0])
    if len(outer) >= 2 and outer[0] == outer[-1]:
        outer = outer[:-1]
    verts = [(float(p[0]), float(p[1]), 0.0) for p in outer]
    if len(verts) < 3:
        return
    face = [tuple(range(len(verts)))]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], face)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    mesh.update()
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.extrude_region_move(
        TRANSFORM_OT_translate={"value": (0.0, 0.0, float(height))}
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    if obj.data.materials:
        obj.data.materials[0] = material
    else:
        obj.data.materials.append(material)
    obj.select_set(False)


def linestring_to_road_mesh(name, coords, collection, material, width, z=0.0):
    """Flat mesh strip along the path (no curve bevel / tube look)."""
    verts = []
    faces = []
    for i in range(len(coords) - 1):
        x1, y1 = float(coords[i][0]), float(coords[i][1])
        x2, y2 = float(coords[i + 1][0]), float(coords[i + 1][1])
        dx = x2 - x1
        dy = y2 - y1
        length = math.sqrt(dx * dx + dy * dy)
        if length == 0:
            continue
        px = (-dy / length) * (width / 2)
        py = (dx / length) * (width / 2)
        base = len(verts)
        verts += [
            (x1 + px, y1 + py, z),
            (x1 - px, y1 - py, z),
            (x2 - px, y2 - py, z),
            (x2 + px, y2 + py, z),
        ]
        faces.append((base, base + 1, base + 2, base + 3))
    if not verts:
        return
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    if obj.data.materials:
        obj.data.materials[0] = material
    else:
        obj.data.materials.append(material)


def get_coords(geometry):
    t = geometry.get("type")
    if t == "Polygon":
        return geometry["coordinates"]
    if t == "MultiPolygon":
        return geometry["coordinates"]
    if t == "LineString":
        return geometry["coordinates"]
    if t == "MultiLineString":
        return geometry["coordinates"]
    return []


def import_campaign():
    manifest = load_geojson("manifest.json")
    print(
        "Manifest:",
        manifest.get("campaign_id"),
        manifest.get("counts"),
        manifest.get("origin"),
    )

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    mat_target = make_material("FlyrTarget", TARGET_COLOR)
    mat_context = make_material("FlyrContext", CONTEXT_COLOR)
    mat_road = make_material("FlyrRoad", ROAD_COLOR)
    mat_boundary = make_material("FlyrBoundary", BOUNDARY_COLOR)

    col_target = make_collection("Buildings_Target")
    col_context = make_collection("Buildings_Context")
    col_roads = make_collection("Roads")
    col_addresses = make_collection("Addresses")

    buildings = load_geojson("buildings.geojson")
    bi = 0
    for feat in buildings.get("features", []):
        geom = feat.get("geometry") or {}
        props = feat.get("properties") or {}
        height = float(props.get("height_m") or DEFAULT_HEIGHT_M)
        is_target = bool(props.get("is_target"))
        col = col_target if is_target else col_context
        mat = mat_target if is_target else mat_context
        gt = geom.get("type")
        if gt == "Polygon":
            rings = get_coords(geom)
            polygon_to_mesh(f"bld_{bi}", rings, height, col, mat)
            bi += 1
        elif gt == "MultiPolygon":
            for poly in get_coords(geom):
                polygon_to_mesh(f"bld_{bi}", poly, height, col, mat)
                bi += 1

    roads = load_geojson("roads.geojson")
    ri = 0
    for feat in roads.get("features", []):
        geom = feat.get("geometry") or {}
        props = feat.get("properties") or {}
        rc = (props.get("road_class") or "").lower()
        width = 1.8 if rc in ("primary", "secondary", "trunk") else 0.75
        gt = geom.get("type")
        if gt == "LineString":
            coords = get_coords(geom)
            linestring_to_road_mesh(f"road_{ri}", coords, col_roads, mat_road, width)
            ri += 1
        elif gt == "MultiLineString":
            for line in get_coords(geom):
                linestring_to_road_mesh(f"road_{ri}", line, col_roads, mat_road, width)
                ri += 1

    boundary = load_geojson("boundary.geojson")
    root = bpy.context.scene.collection
    bnd_i = 0
    for feat in boundary.get("features", []):
        geom = feat.get("geometry") or {}
        gt = geom.get("type")
        if gt == "LineString":
            coords = get_coords(geom)
            linestring_to_road_mesh(f"boundary_{bnd_i}", coords, root, mat_boundary, 0.3)
            bnd_i += 1
        elif gt == "MultiLineString":
            for line in get_coords(geom):
                linestring_to_road_mesh(f"boundary_{bnd_i}", line, root, mat_boundary, 0.3)
                bnd_i += 1
        elif gt == "Polygon":
            rings = get_coords(geom)
            outer = rings[0]
            closed = outer if outer[0] == outer[-1] else outer + [outer[0]]
            linestring_to_road_mesh(f"boundary_{bnd_i}", closed, root, mat_boundary, 0.3)
            bnd_i += 1
        elif gt == "MultiPolygon":
            for poly in get_coords(geom):
                outer = poly[0]
                closed = outer if outer[0] == outer[-1] else outer + [outer[0]]
                linestring_to_road_mesh(f"boundary_{bnd_i}", closed, root, mat_boundary, 0.3)
                bnd_i += 1

    addresses = load_geojson("addresses.geojson")
    for feat in addresses.get("features", []):
        geom = feat.get("geometry") or {}
        if geom.get("type") != "Point":
            continue
        c = geom.get("coordinates") or [0, 0]
        bpy.ops.object.empty_add(
            type="ARROWS",
            location=(float(c[0]), float(c[1]), 0.0),
        )
        empty = bpy.context.active_object
        empty.empty_display_size = 1.5
        col_addresses.objects.link(empty)
        bpy.context.scene.collection.objects.unlink(empty)

    origin = manifest.get("origin") or {}
    print(
        "Done — collections: Buildings_Target, Buildings_Context, Roads, Addresses; origin:",
        origin.get("lng"),
        origin.get("lat"),
    )


import_campaign()
