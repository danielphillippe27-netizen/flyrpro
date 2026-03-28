"""
FLYR Canvassing Animation — Optimized (patched)
===============================================
Faster Blender version designed to avoid freezes:
- No bpy.ops in per-building mesh generation
- No edit mode extrusion for every building
- Optional roads/boundary build toggles
- Safer cleanup of only FLYR-created data
- Safe interpolation handling for Blender animation data

Default: BUILD_SCENE = False (import scene first). Set True to build from GeoJSON.
    BUILD_ROADS = False
    BUILD_BOUNDARY = False
    TOTAL_ADDRESSES = 30
"""

import bpy
import bmesh
import json
import os
import math
import re

# ============================================================
# CONFIG
# ============================================================
EXPORT_DIR = "/Users/danielphillippe/Desktop/FLYR-PRO/blender-exports/e375825f-672c-4ebc-9f09-05eb566730fb/"

BUILD_SCENE = False
BUILD_ROADS = False
BUILD_BOUNDARY = False

FPS = 30
FRAMES_PER_ADDRESS = 14
PAUSE_AT_ADDRESS = 4
TOTAL_ADDRESSES = 30  # set None for all after testing

CAM_FOLLOW_HEIGHT = 60
CAM_FOLLOW_DISTANCE = 80

COLOR_RED = (0.85, 0.12, 0.08, 1.0)
COLOR_GREEN = (0.08, 0.75, 0.25, 1.0)
EMIT_STRENGTH = 0.4

MARKER_COLOR = (1.0, 1.0, 1.0, 1.0)
MARKER_SIZE = 4.0

BG_COLOR = (0.02, 0.02, 0.02, 1.0)
GROUND_COLOR = (0.04, 0.04, 0.045, 1.0)
ROAD_COLOR = (0.06, 0.06, 0.07, 1.0)
CONTEXT_COLOR = (0.18, 0.17, 0.16, 1.0)
BOUNDARY_COLOR = (0.15, 0.45, 1.0, 1.0)

DEFAULT_HEIGHT_M = 7.0
ROAD_Z_OFFSET = 0.05


# ============================================================
# HELPERS
# ============================================================

def parse_address(formatted):
    match = re.match(r"^(\d+)\s+(.+)$", formatted.strip())
    if match:
        return int(match.group(1)), match.group(2).strip()
    return None, formatted.strip()


def sort_addresses_street_odd_even(addresses_raw):
    streets = {}
    unparseable = []

    for addr in addresses_raw:
        house_num, street_name = parse_address(addr["formatted"])
        if house_num is None:
            unparseable.append(addr)
            continue

        enriched = dict(addr)
        enriched["house_number"] = house_num
        enriched["street_name"] = street_name
        streets.setdefault(street_name, []).append(enriched)

    def street_avg_y(street_name):
        addrs = streets[street_name]
        return sum(a["y"] for a in addrs) / len(addrs)

    sorted_street_names = sorted(streets.keys(), key=street_avg_y)

    result = []
    for street_name in sorted_street_names:
        addrs = streets[street_name]
        odds = sorted([a for a in addrs if a["house_number"] % 2 == 1], key=lambda a: a["house_number"])
        evens = sorted([a for a in addrs if a["house_number"] % 2 == 0], key=lambda a: a["house_number"])
        result.extend(odds)
        result.extend(reversed(evens))

    result.extend(unparseable)
    return result


def load_geojson(filename):
    path = os.path.join(EXPORT_DIR, filename)
    with open(path, "r") as f:
        return json.load(f)


def get_coords(geometry):
    gtype = geometry["type"]
    coords = geometry["coordinates"]
    if gtype == "Polygon":
        return [coords]
    if gtype == "MultiPolygon":
        return coords
    if gtype == "LineString":
        return [coords]
    if gtype == "MultiLineString":
        return coords
    return []


def make_collection(name):
    col = bpy.data.collections.get(name)
    if col:
        return col
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def get_or_create_world():
    world = bpy.context.scene.world
    if not world:
        world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world
    return world


def safe_remove_object(obj):
    try:
        bpy.data.objects.remove(obj, do_unlink=True)
    except Exception:
        pass


# ============================================================
# CLEANUP
# ============================================================

def cleanup_flyr_scene():
    flyr_prefixes = (
        "FLYR_", "Ground", "Marker_", "FlyrCam",
        "Buildings_Target", "Buildings_Context", "Roads", "Boundary", "Marker"
    )

    for obj in list(bpy.data.objects):
        if obj.name.startswith(flyr_prefixes):
            safe_remove_object(obj)

    for col in list(bpy.data.collections):
        if col.name.startswith(flyr_prefixes):
            try:
                bpy.data.collections.remove(col)
            except Exception:
                pass

    for mat in list(bpy.data.materials):
        if mat.name.startswith("FLYR_"):
            try:
                bpy.data.materials.remove(mat)
            except Exception:
                pass

    for mesh in list(bpy.data.meshes):
        if mesh.name.startswith("FLYR_") or mesh.name.startswith("Ground"):
            if mesh.users == 0:
                try:
                    bpy.data.meshes.remove(mesh)
                except Exception:
                    pass

    for light in list(bpy.data.lights):
        if light.name.startswith("FLYR_") or light.name in ("KeyLight", "FillLight"):
            if light.users == 0:
                try:
                    bpy.data.lights.remove(light)
                except Exception:
                    pass

    for cam in list(bpy.data.cameras):
        if cam.name == "FlyrCam":
            if cam.users == 0:
                try:
                    bpy.data.cameras.remove(cam)
                except Exception:
                    pass


# ============================================================
# MATERIALS
# ============================================================

def make_emission_material(name, base_color, emit_strength=0.0):
    old = bpy.data.materials.get(name)
    if old:
        try:
            bpy.data.materials.remove(old)
        except Exception:
            pass

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    obj_info = nodes.new("ShaderNodeObjectInfo")
    mix = nodes.new("ShaderNodeMix")

    obj_info.location = (-700, 100)
    mix.location = (-400, 140)
    bsdf.location = (-150, 100)
    out.location = (150, 100)

    mix.data_type = 'RGBA'
    mix.blend_type = 'MIX'
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["B"].default_value = base_color

    links.new(obj_info.outputs["Color"], mix.inputs["A"])
    links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])

    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Emission Strength"].default_value = emit_strength
    links.new(mix.outputs["Result"], bsdf.inputs["Emission Color"])

    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def make_flat_material(name, color, roughness=0.95, emit_strength=0.0):
    old = bpy.data.materials.get(name)
    if old:
        try:
            bpy.data.materials.remove(old)
        except Exception:
            pass

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")

    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Emission Color"].default_value = color
    bsdf.inputs["Emission Strength"].default_value = emit_strength

    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def assign_material(obj, mat):
    if obj is None or obj.data is None:
        return
    obj.data.materials.clear()
    obj.data.materials.append(mat)


# ============================================================
# GEOMETRY
# ============================================================

def polygon_area_2d(points):
    area = 0.0
    n = len(points)
    for i in range(n):
        x1, y1 = points[i][0], points[i][1]
        x2, y2 = points[(i + 1) % n][0], points[(i + 1) % n][1]
        area += (x1 * y2) - (x2 * y1)
    return area * 0.5


def ensure_ccw(points):
    if polygon_area_2d(points) < 0:
        return list(reversed(points))
    return points


def build_extruded_polygon_mesh(name, rings, height, collection, material, z_base=0.0):
    outer = rings[0]
    if len(outer) > 1 and outer[0] == outer[-1]:
        outer = outer[:-1]

    if len(outer) < 3:
        return None

    outer = ensure_ccw(outer)

    mesh = bpy.data.meshes.new(f"FLYR_{name}")
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)

    bm = bmesh.new()

    try:
        bottom_verts = [bm.verts.new((p[0], p[1], z_base)) for p in outer]
        bm.verts.ensure_lookup_table()
        bottom_face = bm.faces.new(bottom_verts)

        ret = bmesh.ops.extrude_face_region(bm, geom=[bottom_face])
        extruded_verts = [ele for ele in ret["geom"] if isinstance(ele, bmesh.types.BMVert)]

        for v in extruded_verts:
            v.co.z += height

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        assign_material(obj, material)
        return obj

    except Exception as e:
        print(f"Skipping building {name}: {e}")
        bm.free()
        safe_remove_object(obj)
        try:
            bpy.data.meshes.remove(mesh)
        except Exception:
            pass
        return None


def build_road_mesh(name, coords, collection, material, width=6.0, z=0.0):
    verts = []
    faces = []

    for i in range(len(coords) - 1):
        x1, y1 = coords[i][0], coords[i][1]
        x2, y2 = coords[i + 1][0], coords[i + 1][1]

        dx = x2 - x1
        dy = y2 - y1
        length = math.sqrt(dx * dx + dy * dy)
        if length == 0:
            continue

        px = (-dy / length) * (width / 2)
        py = (dx / length) * (width / 2)

        base = len(verts)
        verts.extend([
            (x1 + px, y1 + py, z),
            (x1 - px, y1 - py, z),
            (x2 - px, y2 - py, z),
            (x2 + px, y2 + py, z),
        ])
        faces.append((base, base + 1, base + 2, base + 3))

    if not verts:
        return None

    mesh = bpy.data.meshes.new(f"FLYR_{name}")
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    assign_material(obj, material)
    return obj


# ============================================================
# SCENE BUILD
# ============================================================

def build_ground(buildings_data):
    all_xs, all_ys = [], []

    for feat in buildings_data.get("features", []):
        geom = feat.get("geometry")
        if not geom:
            continue
        for rings in get_coords(geom):
            for ring in rings:
                if isinstance(ring[0], list):
                    for v in ring:
                        all_xs.append(v[0])
                        all_ys.append(v[1])
                else:
                    all_xs.append(ring[0])
                    all_ys.append(ring[1])

    if not all_xs:
        return None, None, None, None

    min_x, max_x = min(all_xs), max(all_xs)
    min_y, max_y = min(all_ys), max(all_ys)

    pad = 80
    w = (max_x - min_x) + pad * 2
    h = (max_y - min_y) + pad * 2
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2

    mesh = bpy.data.meshes.new("Ground")
    obj = bpy.data.objects.new("Ground", mesh)
    bpy.context.scene.collection.objects.link(obj)

    verts = [
        (cx - w / 2, cy - h / 2, -0.1),
        (cx + w / 2, cy - h / 2, -0.1),
        (cx + w / 2, cy + h / 2, -0.1),
        (cx - w / 2, cy + h / 2, -0.1),
    ]
    faces = [(0, 1, 2, 3)]
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    mat_ground = make_flat_material("FLYR_Ground", GROUND_COLOR, roughness=0.98)
    assign_material(obj, mat_ground)

    return cx, cy, min_x, max_x


def build_full_scene(buildings_data, roads_data, boundary_data, mat_red, mat_context, mat_road, mat_boundary):
    col_target = make_collection("Buildings_Target")
    col_context = make_collection("Buildings_Context")
    col_roads = make_collection("Roads")
    col_boundary = make_collection("Boundary")

    ground = build_ground(buildings_data)
    if ground[0] is None:
        print("Warning: no building geometry for ground; skipping ground plane.")
        cx = cy = 0.0
    else:
        cx, cy, _, _ = ground
    building_objects = {}

    features = buildings_data.get("features", [])
    for i, feat in enumerate(features):
        props = feat.get("properties", {})
        geom = feat.get("geometry")
        if not geom:
            continue

        is_target = props.get("is_target", False)
        height = props.get("height_m") or DEFAULT_HEIGHT_M
        address = props.get("address") or ""
        label = address or props.get("external_id") or f"b_{i}"
        col = col_target if is_target else col_context
        mat = mat_red if is_target else mat_context

        for j, rings in enumerate(get_coords(geom)):
            name = f"{label}_{j}" if j > 0 else label
            obj = build_extruded_polygon_mesh(name, rings, height, col, mat)
            if obj and is_target and address and address not in building_objects:
                building_objects[address] = obj

        if i % 200 == 0 and i > 0:
            print(f"Built {i}/{len(features)} buildings...")

    if BUILD_ROADS:
        road_features = roads_data.get("features", [])
        for i, feat in enumerate(road_features):
            props = feat.get("properties", {})
            geom = feat.get("geometry")
            if not geom:
                continue

            road_class = props.get("road_class", "")
            road_name = props.get("road_name") or f"road_{i}"
            width = 8.0 if road_class in ("primary", "trunk", "motorway") else 6.0 if road_class in ("secondary", "tertiary") else 5.0

            for j, coords in enumerate(get_coords(geom)):
                name = f"{road_name}_{j}" if j > 0 else road_name
                build_road_mesh(name, coords, col_roads, mat_road, width, z=ROAD_Z_OFFSET)

            if i % 200 == 0 and i > 0:
                print(f"Built {i}/{len(road_features)} roads...")

    if BUILD_BOUNDARY:
        for feat in boundary_data.get("features", []):
            geom = feat.get("geometry")
            if not geom:
                continue

            for j, rings in enumerate(get_coords(geom)):
                outer = rings[0] if isinstance(rings[0], list) and isinstance(rings[0][0], list) else rings
                build_road_mesh(f"Boundary_{j}", outer, col_boundary, mat_boundary, width=1.0, z=0.1)

    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT" and obj.name in ("KeyLight", "FillLight"):
            safe_remove_object(obj)

    if cx is not None:
        key_data = bpy.data.lights.new("KeyLight", type="SUN")
        key_data.energy = 3.5
        key_obj = bpy.data.objects.new("KeyLight", key_data)
        bpy.context.scene.collection.objects.link(key_obj)
        key_obj.location = (cx + 200, cy - 150, 300)
        key_obj.rotation_euler = (math.radians(45), math.radians(15), math.radians(-30))

        fill_data = bpy.data.lights.new("FillLight", type="SUN")
        fill_data.energy = 0.8
        fill_obj = bpy.data.objects.new("FillLight", fill_data)
        bpy.context.scene.collection.objects.link(fill_obj)
        fill_obj.location = (cx - 200, cy + 100, 200)
        fill_obj.rotation_euler = (math.radians(60), 0, math.radians(150))

    world = get_or_create_world()
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = BG_COLOR
        bg.inputs["Strength"].default_value = 0.3

    return building_objects


def collect_target_buildings_from_scene(buildings_data):
    building_objects = {}
    col = bpy.data.collections.get("Buildings_Target")
    if not col:
        return building_objects

    name_to_obj = {}
    for obj in col.objects:
        if obj.type != "MESH":
            continue
        base = obj.name.rsplit("_", 1)[0] if "_" in obj.name else obj.name
        name_to_obj.setdefault(base, obj)

    for feat in buildings_data.get("features", []):
        props = feat.get("properties", {})
        if not props.get("is_target"):
            continue
        address = props.get("address") or ""
        if not address:
            continue
        label = address or props.get("external_id") or ""
        if label in name_to_obj:
            building_objects[address] = name_to_obj[label]

    return building_objects


# ============================================================
# MARKER / CAMERA
# ============================================================

def create_marker(location):
    col = make_collection("Marker")

    body_mesh = bpy.data.meshes.new("FLYR_MarkerBody")
    body = bpy.data.objects.new("Marker_Body", body_mesh)
    col.objects.link(body)

    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=16,
        radius1=MARKER_SIZE * 0.3,
        radius2=MARKER_SIZE * 0.3,
        depth=MARKER_SIZE * 1.2,
    )
    bm.to_mesh(body_mesh)
    bm.free()
    body.location = (location[0], location[1], MARKER_SIZE * 0.8)

    head_mesh = bpy.data.meshes.new("FLYR_MarkerHead")
    head = bpy.data.objects.new("Marker_Head", head_mesh)
    col.objects.link(head)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=MARKER_SIZE * 0.4)
    bm.to_mesh(head_mesh)
    bm.free()
    head.location = (location[0], location[1], MARKER_SIZE * 1.7)
    head.parent = body

    arrow_mesh = bpy.data.meshes.new("FLYR_MarkerArrow")
    arrow = bpy.data.objects.new("Marker_Arrow", arrow_mesh)
    col.objects.link(arrow)
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=16,
        radius1=MARKER_SIZE * 0.5,
        radius2=0.0,
        depth=MARKER_SIZE * 0.6,
    )
    bm.to_mesh(arrow_mesh)
    bm.free()
    arrow.location = (0, 0, -MARKER_SIZE * 0.6)
    arrow.parent = body

    mat = make_flat_material("FLYR_Marker", MARKER_COLOR, roughness=0.3, emit_strength=2.0)
    assign_material(body, mat)
    assign_material(head, mat)
    assign_material(arrow, mat)

    return body


def setup_follow_camera(start_x, start_y):
    for obj in list(bpy.data.objects):
        if obj.type == "CAMERA" and obj.name == "FlyrCam":
            safe_remove_object(obj)

    cam_data = bpy.data.cameras.new("FlyrCam")
    cam_data.lens = 35
    cam_data.clip_end = 5000
    cam_obj = bpy.data.objects.new("FlyrCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    cam_obj.location = (
        start_x - CAM_FOLLOW_DISTANCE * 0.7,
        start_y - CAM_FOLLOW_DISTANCE,
        CAM_FOLLOW_HEIGHT,
    )
    cam_obj.rotation_euler = (math.radians(55), 0, math.radians(-20))
    return cam_obj


# ============================================================
# ANIMATION
# ============================================================

def iter_action_fcurves(action):
    """Blender 5+ layered Actions; older Blender has action.fcurves."""
    if action is None:
        return
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        for fc in legacy:
            yield fc
        return
    for layer in getattr(action, "layers", []) or []:
        for strip in getattr(layer, "strips", []) or []:
            if not hasattr(strip, "channelbag"):
                continue
            for slot in getattr(action, "slots", []) or []:
                try:
                    bag = strip.channelbag(slot)
                    if bag and getattr(bag, "fcurves", None):
                        for fc in bag.fcurves:
                            yield fc
                except Exception:
                    pass


def setup_animated_material(obj, arrive_frame):
    obj.color = (*COLOR_RED[:3], 1.0)
    obj.keyframe_insert(data_path="color", frame=max(1, arrive_frame - 1))
    obj.color = (*COLOR_GREEN[:3], 1.0)
    obj.keyframe_insert(data_path="color", frame=arrive_frame)


def set_bezier_interpolation(obj):
    ad = getattr(obj, "animation_data", None)
    if ad is None:
        return

    action = getattr(ad, "action", None)
    if action is None:
        return

    try:
        for fc in iter_action_fcurves(action):
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
    except Exception as e:
        print(f"Warning: could not set interpolation for {obj.name}: {e}")


def animate_canvassing(addresses_sorted, marker, cam):
    scene = bpy.context.scene

    frame_map = {}
    frame = 1
    for addr_data in addresses_sorted:
        frame_map[addr_data["formatted"]] = frame
        frame += FRAMES_PER_ADDRESS + PAUSE_AT_ADDRESS

    scene.frame_end = frame + 20
    scene.render.fps = FPS

    prev_x, prev_y = None, None
    for addr_data in addresses_sorted:
        x = addr_data["x"]
        y = addr_data["y"]
        arrive_frame = frame_map[addr_data["formatted"]]

        marker.location = (x, y, 0)
        marker.keyframe_insert(data_path="location", frame=arrive_frame)

        if prev_x is not None:
            dx = x - prev_x
            dy = y - prev_y
            if abs(dx) > 0.01 or abs(dy) > 0.01:
                angle = math.atan2(dy, dx) - math.pi / 2
                marker.rotation_euler = (0, 0, angle)
                marker.keyframe_insert(data_path="rotation_euler", frame=arrive_frame)

        prev_x, prev_y = x, y

    sample_every = max(1, len(addresses_sorted) // 20)
    for idx, addr_data in enumerate(addresses_sorted):
        if idx % sample_every != 0 and idx != len(addresses_sorted) - 1:
            continue

        x = addr_data["x"]
        y = addr_data["y"]
        arrive_frame = frame_map[addr_data["formatted"]]

        cam_x = x - CAM_FOLLOW_DISTANCE * 0.5
        cam_y = y - CAM_FOLLOW_DISTANCE
        cam_z = CAM_FOLLOW_HEIGHT

        cam.location = (cam_x, cam_y, cam_z)
        cam.keyframe_insert(data_path="location", frame=arrive_frame)

        dx = x - cam_x
        dy = y - cam_y
        dz = -cam_z * 0.6
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)
        if dist > 0:
            pitch = math.asin(dz / dist)
            yaw = math.atan2(dy, dx)
            cam.rotation_euler = (math.pi / 2 + pitch, 0, yaw + math.pi / 2)
            cam.keyframe_insert(data_path="rotation_euler", frame=arrive_frame)

    set_bezier_interpolation(marker)
    set_bezier_interpolation(cam)

    scene.frame_set(1)


# ============================================================
# MAIN
# ============================================================

def run_canvassing_animation():
    manifest_path = os.path.join(EXPORT_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        print(f"ERROR: manifest.json not found at {EXPORT_DIR}")
        return

    print("\n=== FLYR Canvassing Animation — Optimized (patched) ===")

    buildings_data = load_geojson("buildings.geojson")
    roads_data = load_geojson("roads.geojson")
    boundary_data = load_geojson("boundary.geojson")
    addresses_data = load_geojson("addresses.geojson")

    addresses_raw = []
    for feat in addresses_data.get("features", []):
        props = feat.get("properties", {})
        geom = feat.get("geometry")
        if not geom or geom.get("type") != "Point":
            continue

        formatted = props.get("formatted", "")
        x = geom["coordinates"][0]
        y = geom["coordinates"][1]

        if formatted:
            addresses_raw.append({"formatted": formatted, "x": x, "y": y})

    addresses_sorted = sort_addresses_street_odd_even(addresses_raw)
    if TOTAL_ADDRESSES is not None:
        addresses_sorted = addresses_sorted[:TOTAL_ADDRESSES]

    print(f"Addresses to animate: {len(addresses_sorted)}")

    if BUILD_SCENE:
        cleanup_flyr_scene()

        mat_red = make_emission_material("FLYR_Target", COLOR_RED, emit_strength=EMIT_STRENGTH)
        mat_context = make_flat_material("FLYR_Context", CONTEXT_COLOR, roughness=0.9)
        mat_road = make_flat_material("FLYR_Road", ROAD_COLOR, roughness=0.98)
        mat_boundary = make_flat_material("FLYR_Boundary", BOUNDARY_COLOR, roughness=0.5, emit_strength=1.0)

        building_objects = build_full_scene(
            buildings_data, roads_data, boundary_data,
            mat_red, mat_context, mat_road, mat_boundary
        )
        print(f"Scene built — mapped {len(building_objects)} target buildings")
    else:
        mat_red = bpy.data.materials.get("FLYR_Target") or make_emission_material(
            "FLYR_Target", COLOR_RED, emit_strength=EMIT_STRENGTH
        )
        building_objects = collect_target_buildings_from_scene(buildings_data)
        print(f"Using existing scene — matched {len(building_objects)} target buildings")

    if not addresses_sorted:
        print("ERROR: No addresses found")
        return

    seq_to_frame = {}
    frame = 1
    for addr_data in addresses_sorted:
        seq_to_frame[addr_data["formatted"]] = frame
        frame += FRAMES_PER_ADDRESS + PAUSE_AT_ADDRESS

    animated_count = 0
    for addr_data in addresses_sorted:
        address = addr_data["formatted"]
        obj = building_objects.get(address)
        arrive_frame = seq_to_frame.get(address)
        if obj and arrive_frame:
            setup_animated_material(obj, arrive_frame)
            animated_count += 1

    print(f"Animated materials: {animated_count}")

    start = addresses_sorted[0]
    marker = create_marker((start["x"], start["y"]))
    cam = setup_follow_camera(start["x"], start["y"])

    animate_canvassing(addresses_sorted, marker, cam)

    scene = bpy.context.scene
    # Blender 5: EEVEE Next is merged into BLENDER_EEVEE (no BLENDER_EEVEE_NEXT enum)
    scene.render.engine = "BLENDER_EEVEE"
    try:
        scene.eevee.taa_render_samples = 16
    except Exception:
        pass
    scene.render.fps = FPS
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.frame_set(1)

    print("\n=== Ready ===")
    print(f"BUILD_SCENE={BUILD_SCENE} | BUILD_ROADS={BUILD_ROADS} | BUILD_BOUNDARY={BUILD_BOUNDARY}")
    print("Press Spacebar to preview")
    print("Press F12 to render frame")
    print("Press Ctrl+F12 to render animation")


run_canvassing_animation()
