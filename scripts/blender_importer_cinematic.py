"""
FLYR Campaign Blender Importer — Cinematic Edition
===================================================
Paste into Blender Scripting tab and Run Script.
Set EXPORT_DIR to your downloaded campaign export folder.

Produces:
  - Dark ground plane (matches FLYR app map background)
  - Red emissive target buildings (campaign homes)
  - Grey context buildings with shadow
  - Dark road surface
  - Blue boundary outline
  - Cinematic camera animation (flythrough)
  - Render settings ready for 1080p video output
"""

import bpy
import json
import os
import math

# ============================================================
# CONFIG
# ============================================================
EXPORT_DIR = "/Users/danielphillippe/Desktop/FLYR-PRO/blender-exports/e375825f-672c-4ebc-9f09-05eb566730fb/"

# Visual style
BG_COLOR = (0.02, 0.02, 0.02, 1.0)  # near-black background
GROUND_COLOR = (0.04, 0.04, 0.045, 1.0)  # dark map surface
ROAD_COLOR = (0.06, 0.06, 0.07, 1.0)  # slightly lighter than ground
BOUNDARY_COLOR = (0.15, 0.45, 1.0, 1.0)  # FLYR blue

# Target buildings — red emissive like the app
TARGET_BASE_COLOR = (0.85, 0.12, 0.08, 1.0)
TARGET_EMIT_COLOR = (1.0, 0.15, 0.08, 1.0)
TARGET_EMIT_STR = 0.4  # glow strength

# Context buildings — muted grey with slight warm tint
CONTEXT_COLOR = (0.18, 0.17, 0.16, 1.0)

DEFAULT_HEIGHT_M = 7.0
ROAD_Z_OFFSET = 0.05  # slightly above ground to avoid z-fighting
BOUNDARY_Z = 0.1

# Camera starting position (no animation — add keyframes manually after)
CAM_HEIGHT = 120  # meters above scene
CAM_ORBIT_RADIUS = 180  # distance from center
CAM_START_ANGLE = 200  # starting angle in degrees

# Render
RENDER_FPS = 30
RENDER_WIDTH = 1920
RENDER_HEIGHT = 1080
CAM_ANIM_FRAMES = 240  # timeline length; add keyframes manually for flythrough


# ============================================================
# HELPERS
# ============================================================


def load_geojson(filename):
    path = os.path.join(EXPORT_DIR, filename)
    with open(path, "r") as f:
        return json.load(f)


def make_collection(name):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def make_emission_material(name, base_color, emit_color, emit_strength):
    mat = bpy.data.materials.get(name)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    mix = nodes.new("ShaderNodeMixShader")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    emit = nodes.new("ShaderNodeEmission")

    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0

    emit.inputs["Color"].default_value = (*emit_color[:3], 1.0)
    emit.inputs["Strength"].default_value = emit_strength

    mix.inputs["Fac"].default_value = 0.25  # mostly BSDF, hint of emission

    links.new(bsdf.outputs["BSDF"], mix.inputs[1])
    links.new(emit.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], out.inputs["Surface"])

    return mat


def make_flat_material(name, color, roughness=0.95, emit_strength=0.0):
    mat = bpy.data.materials.get(name)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")

    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0

    if emit_strength > 0:
        bsdf.inputs["Emission Color"].default_value = color
        bsdf.inputs["Emission Strength"].default_value = emit_strength

    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def assign_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def get_coords(geometry):
    gtype = geometry["type"]
    coords = geometry["coordinates"]
    if gtype == "Polygon":
        return [coords]
    elif gtype == "MultiPolygon":
        return coords
    elif gtype == "LineString":
        return [coords]
    elif gtype == "MultiLineString":
        return coords
    return []


def build_polygon_mesh(name, rings, height, collection, material, z_base=0.0):
    outer = rings[0]
    if len(outer) > 1 and outer[0] == outer[-1]:
        outer = outer[:-1]
    if len(outer) < 3:
        return None

    verts = [(v[0], v[1], z_base) for v in outer]
    cx = sum(v[0] for v in verts) / len(verts)
    cy = sum(v[1] for v in verts) / len(verts)
    n = len(verts)
    verts.append((cx, cy, z_base))
    faces = [(i, (i + 1) % n, n) for i in range(n)]

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    # Extrude
    if height and height > 0:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.extrude_region_move(
            TRANSFORM_OT_translate={"value": (0, 0, height)}
        )
        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)

    assign_material(obj, material)
    return obj


def build_road_mesh(name, coords, collection, material, width=3.5, z=0.0):
    """
    Flat rectangular strips along the path (single Z). No curve bevel — reads as a walking path,
    not a tube or curb.
    """
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
        verts += [
            (x1 + px, y1 + py, z),
            (x1 - px, y1 - py, z),
            (x2 - px, y2 - py, z),
            (x2 + px, y2 + py, z),
        ]
        faces.append((base, base + 1, base + 2, base + 3))
    if not verts:
        return None
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    assign_material(obj, material)
    return obj


def scene_bounds(buildings_data):
    xs, ys = [], []
    for feat in buildings_data.get("features", []):
        geom = feat.get("geometry")
        if not geom:
            continue
        for rings in get_coords(geom):
            for ring in rings:
                if isinstance(ring[0], list):
                    for v in ring:
                        xs.append(v[0])
                        ys.append(v[1])
                else:
                    xs.append(ring[0])
                    ys.append(ring[1])
    if not xs:
        return 0, 0, 200, 200
    return min(xs), min(ys), max(xs), max(ys)


# ============================================================
# SETUP SCENE
# ============================================================


def setup_scene():
    # World background
    world = bpy.context.scene.world
    if not world:
        world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = BG_COLOR
        bg.inputs["Strength"].default_value = 0.3

    # Render settings
    scene = bpy.context.scene
    scene.render.fps = RENDER_FPS
    scene.render.resolution_x = RENDER_WIDTH
    scene.render.resolution_y = RENDER_HEIGHT
    scene.frame_start = 1
    scene.frame_end = CAM_ANIM_FRAMES
    scene.render.engine = "CYCLES"

    # Cycles settings for quality/speed balance
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"

    # Film
    scene.render.film_transparent = False


# ============================================================
# LIGHTING
# ============================================================


def setup_lighting(cx, cy):
    # Remove default lights
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj)

    # Key light — warm, directional, casting long shadows
    key_data = bpy.data.lights.new("KeyLight", type="SUN")
    key_data.energy = 3.5
    key_data.color = (1.0, 0.92, 0.80)
    key_data.angle = 0.05
    key_obj = bpy.data.objects.new("KeyLight", key_data)
    bpy.context.scene.collection.objects.link(key_obj)
    key_obj.location = (cx + 200, cy - 150, 300)
    key_obj.rotation_euler = (math.radians(45), math.radians(15), math.radians(-30))

    # Fill light — cool, soft, from opposite side
    fill_data = bpy.data.lights.new("FillLight", type="SUN")
    fill_data.energy = 0.8
    fill_data.color = (0.6, 0.75, 1.0)
    fill_obj = bpy.data.objects.new("FillLight", fill_data)
    bpy.context.scene.collection.objects.link(fill_obj)
    fill_obj.location = (cx - 200, cy + 100, 200)
    fill_obj.rotation_euler = (math.radians(60), 0, math.radians(150))

    # Rim light — highlights top edges of buildings
    rim_data = bpy.data.lights.new("RimLight", type="SUN")
    rim_data.energy = 1.2
    rim_data.color = (0.9, 0.95, 1.0)
    rim_obj = bpy.data.objects.new("RimLight", rim_data)
    bpy.context.scene.collection.objects.link(rim_obj)
    rim_obj.location = (cx, cy + 300, 400)
    rim_obj.rotation_euler = (math.radians(20), 0, math.radians(90))


# ============================================================
# GROUND PLANE
# ============================================================


def add_ground(min_x, min_y, max_x, max_y):
    pad = 80
    w = (max_x - min_x) + pad * 2
    h = (max_y - min_y) + pad * 2
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2

    bpy.ops.mesh.primitive_plane_add(
        size=1,
        location=(cx, cy, -0.1),
    )
    plane = bpy.context.active_object
    plane.name = "Ground"
    plane.scale = (w, h, 1)
    bpy.ops.object.transform_apply(scale=True)

    mat = make_flat_material("FLYR_Ground", GROUND_COLOR, roughness=0.98)
    assign_material(plane, mat)
    return plane


# ============================================================
# CAMERA + ANIMATION
# ============================================================


def setup_camera(cx, cy):
    # Remove existing cameras
    for obj in list(bpy.data.objects):
        if obj.type == "CAMERA":
            bpy.data.objects.remove(obj)

    cam_data = bpy.data.cameras.new("FlyrCam")
    cam_data.lens = 50  # 50mm — good for architectural
    cam_data.clip_end = 10000
    cam_obj = bpy.data.objects.new("FlyrCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    # Place camera at a good starting position — no keyframes
    # Add your own animation path after importing
    angle = math.radians(CAM_START_ANGLE)
    x = cx + CAM_ORBIT_RADIUS * math.cos(angle)
    y = cy + CAM_ORBIT_RADIUS * math.sin(angle)
    z = CAM_HEIGHT

    cam_obj.location = (x, y, z)

    # Point toward scene center
    dx = cx - x
    dy = cy - y
    dz = -z * 0.7
    dist = math.sqrt(dx * dx + dy * dy + dz * dz)
    pitch = math.asin(dz / dist)
    yaw = math.atan2(dy, dx)
    cam_obj.rotation_euler = (
        math.pi / 2 + pitch,
        0,
        yaw + math.pi / 2,
    )

    return cam_obj


# ============================================================
# MAIN IMPORT
# ============================================================


def import_campaign():
    manifest_path = os.path.join(EXPORT_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        print(f"ERROR: manifest.json not found at {EXPORT_DIR}")
        return

    with open(manifest_path) as f:
        manifest = json.load(f)

    print("\n=== FLYR Cinematic Import ===")
    print(f"Campaign: {manifest['campaign_id']}")
    print(f"Target buildings: {manifest['counts']['target_buildings']}")
    print(f"Context buildings: {manifest['counts']['context_buildings']}")
    print(f"Roads: {manifest['counts']['roads']}")

    # Clear scene
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)

    setup_scene()

    # Materials
    mat_target = make_emission_material(
        "FLYR_Target", TARGET_BASE_COLOR, TARGET_EMIT_COLOR, TARGET_EMIT_STR
    )
    mat_context = make_flat_material("FLYR_Context", CONTEXT_COLOR, roughness=0.9)
    mat_road = make_flat_material("FLYR_Road", ROAD_COLOR, roughness=0.98)
    mat_boundary = make_flat_material(
        "FLYR_Boundary", BOUNDARY_COLOR, roughness=0.5, emit_strength=1.5
    )

    # Collections
    col_target = make_collection("Buildings_Target")
    col_context = make_collection("Buildings_Context")
    col_roads = make_collection("Roads")
    col_addresses = make_collection("Addresses")

    # --------------------------------------------------------
    # BUILDINGS
    # --------------------------------------------------------
    buildings_data = load_geojson("buildings.geojson")
    min_x, min_y, max_x, max_y = scene_bounds(buildings_data)
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2

    target_count = 0
    context_count = 0

    for i, feat in enumerate(buildings_data.get("features", [])):
        props = feat.get("properties", {})
        geom = feat.get("geometry")
        if not geom:
            continue

        is_target = props.get("is_target", False)
        height = props.get("height_m") or DEFAULT_HEIGHT_M
        label = props.get("address") or props.get("external_id") or f"b_{i}"
        col = col_target if is_target else col_context
        mat = mat_target if is_target else mat_context

        for j, rings in enumerate(get_coords(geom)):
            name = f"{label}_{j}" if j > 0 else label
            build_polygon_mesh(name, rings, height, col, mat)

        if is_target:
            target_count += 1
        else:
            context_count += 1

    print(f"✓ Buildings: {target_count} target, {context_count} context")

    # --------------------------------------------------------
    # ROADS
    # --------------------------------------------------------
    roads_data = load_geojson("roads.geojson")
    road_count = 0

    for i, feat in enumerate(roads_data.get("features", [])):
        props = feat.get("properties", {})
        geom = feat.get("geometry")
        if not geom:
            continue

        road_class = props.get("road_class", "")
        road_name = props.get("road_name") or f"road_{i}"
        width = (
            4.5
            if road_class in ("primary", "trunk", "motorway")
            else 2.8
            if road_class in ("secondary", "tertiary")
            else 1.5
        )

        for j, coords in enumerate(get_coords(geom)):
            name = f"{road_name}_{j}" if j > 0 else road_name
            if build_road_mesh(name, coords, col_roads, mat_road, width, z=ROAD_Z_OFFSET):
                road_count += 1

    print(f"✓ Roads: {road_count} segments")

    # --------------------------------------------------------
    # BOUNDARY
    # --------------------------------------------------------
    boundary_data = load_geojson("boundary.geojson")
    bnd_col = bpy.data.collections.new("Boundary")
    bpy.context.scene.collection.children.link(bnd_col)

    for feat in boundary_data.get("features", []):
        geom = feat.get("geometry")
        if not geom:
            continue
        for j, rings in enumerate(get_coords(geom)):
            outer = rings[0] if isinstance(rings[0], list) and isinstance(rings[0][0], list) else rings
            build_road_mesh(f"Boundary_{j}", outer, bnd_col, mat_boundary, width=0.8, z=BOUNDARY_Z)

    print("✓ Boundary imported")

    # --------------------------------------------------------
    # ADDRESSES
    # --------------------------------------------------------
    addresses_data = load_geojson("addresses.geojson")
    addr_count = 0

    for feat in addresses_data.get("features", []):
        props = feat.get("properties", {})
        geom = feat.get("geometry")
        if not geom or geom.get("type") != "Point":
            continue
        coords = geom["coordinates"]
        label = props.get("formatted") or f"addr_{addr_count}"

        bpy.ops.object.empty_add(type="ARROWS", location=(coords[0], coords[1], 0.5))
        empty = bpy.context.active_object
        empty.name = label
        empty.empty_display_size = 1.0
        bpy.context.scene.collection.objects.unlink(empty)
        col_addresses.objects.link(empty)
        addr_count += 1

    print(f"✓ Addresses: {addr_count} markers")

    # --------------------------------------------------------
    # GROUND + LIGHTING + CAMERA
    # --------------------------------------------------------
    add_ground(min_x, min_y, max_x, max_y)
    setup_lighting(cx, cy)
    setup_camera(cx, cy)

    # --------------------------------------------------------
    # DONE
    # --------------------------------------------------------
    print("\n=== Scene ready ===")
    print("Collections: Buildings_Target (red), Buildings_Context (grey), Roads, Addresses, Boundary")
    print("Camera placed at starting position — add your animation path manually")
    print(
        f"Render: {RENDER_WIDTH}x{RENDER_HEIGHT}, Cycles, {bpy.context.scene.cycles.samples} samples"
    )
    print("\nTo render still: Render menu → Render Image (F12)")
    print("To render animation after adding keyframes: Render menu → Render Animation (Ctrl+F12)")
    print("Set output path first: Render Properties → Output")


import_campaign()
