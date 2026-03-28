"""
FLYR Canvassing Animation
=========================
Default: buildings turn red → green in address seq order. No marker, no camera.

Set BUILDINGS_ONLY = False for marker + camera (needs a 3D Viewport).

Default: BUILD_SCENE = False (use scene in .blend). Set True to build from GeoJSON.
360+ stops: use FRAMES_PER_ADDRESS=1, PAUSE_AT_ADDRESS=0, TOTAL_ADDRESSES=None.
"""

import bpy
import json
import os
import math

# ============================================================
# CONFIG
# ============================================================
EXPORT_DIR = "/Users/danielphillippe/Desktop/FLYR-PRO/blender-exports/e375825f-672c-4ebc-9f09-05eb566730fb/"

BUILD_SCENE = False
BUILDINGS_ONLY = True

FPS = 24
FRAMES_PER_ADDRESS = 1
PAUSE_AT_ADDRESS = 0
TOTAL_ADDRESSES = None
FRAME_RANGE_TAIL = 24

CAM_MAX_KEYFRAMES = 16
SKIP_FCURVE_INTERPOLATION_PASS = True
CAM_FOLLOW_HEIGHT = 60
CAM_FOLLOW_DISTANCE = 80
CAM_FOLLOW_SMOOTHING = 0.08

# Colors
COLOR_RED = (0.85, 0.12, 0.08, 1.0)
COLOR_GREEN = (0.08, 0.75, 0.25, 1.0)
COLOR_GREEN_EMIT = (0.1, 0.9, 0.3, 1.0)
EMIT_STRENGTH = 0.5

# Marker
MARKER_COLOR = (1.0, 1.0, 1.0, 1.0)
MARKER_EMIT = (1.0, 1.0, 1.0, 1.0)
MARKER_SIZE = 4.0

# Scene (only used if BUILD_SCENE = True)
BG_COLOR = (0.02, 0.02, 0.02, 1.0)
GROUND_COLOR = (0.04, 0.04, 0.045, 1.0)
ROAD_COLOR = (0.06, 0.06, 0.07, 1.0)
CONTEXT_COLOR = (0.18, 0.17, 0.16, 1.0)
BOUNDARY_COLOR = (0.15, 0.45, 1.0, 1.0)
DEFAULT_HEIGHT_M = 7.0
ROAD_Z_OFFSET = 0.05


# ============================================================
# MATERIAL HELPERS
# ============================================================


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
    emit.inputs["Color"].default_value = (*emit_color[:3], 1.0)
    emit.inputs["Strength"].default_value = emit_strength
    mix.inputs["Fac"].default_value = 0.25
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
    if emit_strength > 0:
        bsdf.inputs["Emission Color"].default_value = color
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def assign_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def configure_mat_red_object_color(mat_red):
    """
    Pipe Object Info → Principled Base Color so each mesh can use obj.color keyframes
    with one shared FLYR_Target material.
    """
    if not mat_red or not mat_red.use_nodes:
        return
    nodes = mat_red.node_tree.nodes
    links = mat_red.node_tree.links
    if nodes.get("ObjectInfo_ObjectColor"):
        return
    mat_red.use_nodes = True
    obj_info = nodes.new("ShaderNodeObjectInfo")
    obj_info.name = "ObjectInfo_ObjectColor"
    obj_info.location = (-520, 160)
    bsdf = nodes.get("Principled BSDF")
    if not bsdf:
        for n in nodes:
            if n.type == "BSDF_PRINCIPLED":
                bsdf = n
                break
    if not bsdf:
        return
    links.new(obj_info.outputs["Color"], bsdf.inputs["Base Color"])


# ============================================================
# GEOMETRY HELPERS
# ============================================================


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
    existing = bpy.data.collections.get(name)
    if existing:
        return existing
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def move_object_to_collection(obj, col):
    """Primitives are added to the *active* collection, not always Scene Collection — unlink from all, then link to col."""
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def purge_scene_for_rebuild():
    """
    Clear objects, nested collections, and materials without bpy.ops (works when
    the script runs from the Text Editor — no VIEW_3D context required).
    """
    scene_col = bpy.context.scene.collection
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    def remove_child_collections(col):
        for child in list(col.children):
            remove_child_collections(child)
            col.children.unlink(child)
            bpy.data.collections.remove(child)

    remove_child_collections(scene_col)

    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)


def get_view3d_override():
    """
    bpy.ops mesh/object operators need VIEW_3D context when the script runs from
    the Text Editor. Returns kwargs for bpy.context.temp_override, or None.
    """
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                for region in area.regions:
                    if region.type == "WINDOW":
                        return {
                            "window": window,
                            "screen": window.screen,
                            "area": area,
                            "region": region,
                            "scene": bpy.context.scene,
                        }
    return None


def building_centroid(geom):
    """Returns (cx, cy) centroid of a building geometry."""
    coords = get_coords(geom)
    if not coords:
        return None, None
    ring = coords[0][0]
    if ring and isinstance(ring[0], list):
        pts = ring
    else:
        pts = coords[0]
    if not pts:
        return None, None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return sum(xs) / len(xs), sum(ys) / len(ys)


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


# ============================================================
# SCENE BUILDER (used when BUILD_SCENE = True)
# ============================================================


def build_full_scene(
    buildings_data,
    roads_data,
    boundary_data,
    mat_red,
    mat_context,
    mat_road,
    mat_boundary,
):
    """Builds the full neighborhood scene and returns building objects by address."""

    # Enable object color on target material (shared mat + Object Info → Base Color)
    configure_mat_red_object_color(mat_red)

    col_target = make_collection("Buildings_Target")
    col_context = make_collection("Buildings_Context")
    col_roads = make_collection("Roads")
    col_boundary = make_collection("Boundary")

    # Ground
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

    cx = cy = 0.0
    if all_xs:
        min_x, max_x = min(all_xs), max(all_xs)
        min_y, max_y = min(all_ys), max(all_ys)
        pad = 80
        w = (max_x - min_x) + pad * 2
        h = (max_y - min_y) + pad * 2
        cx = (min_x + max_x) / 2
        cy = (min_y + max_y) / 2
        bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, cy, -0.1))
        plane = bpy.context.active_object
        plane.name = "Ground"
        plane.scale = (w, h, 1)
        bpy.ops.object.transform_apply(scale=True)
        mat_ground = make_flat_material("FLYR_Ground", GROUND_COLOR, roughness=0.98)
        assign_material(plane, mat_ground)

    # Buildings
    building_objects = {}  # address string → blender object
    for i, feat in enumerate(buildings_data.get("features", [])):
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
            obj = build_polygon_mesh(name, rings, height, col, mat)
            if obj and is_target and address:
                building_objects[address] = obj

    # Roads
    for i, feat in enumerate(roads_data.get("features", [])):
        props = feat.get("properties", {})
        geom = feat.get("geometry")
        if not geom:
            continue
        road_class = props.get("road_class", "")
        road_name = props.get("road_name") or f"road_{i}"
        width = (
            8.0
            if road_class in ("primary", "trunk", "motorway")
            else 6.0
            if road_class in ("secondary", "tertiary")
            else 5.0
        )
        for j, coords in enumerate(get_coords(geom)):
            name = f"{road_name}_{j}" if j > 0 else road_name
            build_road_mesh(name, coords, col_roads, mat_road, width, z=ROAD_Z_OFFSET)

    # Boundary
    for feat in boundary_data.get("features", []):
        geom = feat.get("geometry")
        if not geom:
            continue
        for j, rings in enumerate(get_coords(geom)):
            outer = (
                rings[0]
                if isinstance(rings[0], list) and isinstance(rings[0][0], list)
                else rings
            )
            build_road_mesh(f"Boundary_{j}", outer, col_boundary, mat_boundary, width=1.0, z=0.1)

    # Lighting
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj)

    if all_xs:
        key_data = bpy.data.lights.new("KeyLight", type="SUN")
        key_data.energy = 3.5
        key_data.color = (1.0, 0.92, 0.80)
        key_obj = bpy.data.objects.new("KeyLight", key_data)
        bpy.context.scene.collection.objects.link(key_obj)
        key_obj.location = (cx + 200, cy - 150, 300)
        key_obj.rotation_euler = (math.radians(45), math.radians(15), math.radians(-30))

        fill_data = bpy.data.lights.new("FillLight", type="SUN")
        fill_data.energy = 0.8
        fill_data.color = (0.6, 0.75, 1.0)
        fill_obj = bpy.data.objects.new("FillLight", fill_data)
        bpy.context.scene.collection.objects.link(fill_obj)
        fill_obj.location = (cx - 200, cy + 100, 200)
        fill_obj.rotation_euler = (math.radians(60), 0, math.radians(150))

    # World
    world = bpy.context.scene.world
    if not world:
        world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = BG_COLOR
        bg.inputs["Strength"].default_value = 0.3

    return building_objects


def collect_target_buildings_from_scene(buildings_data):
    """Map formatted address → mesh object when BUILD_SCENE is False (after cinematic import)."""
    building_objects = {}
    col = bpy.data.collections.get("Buildings_Target")
    if not col:
        return building_objects
    # Index mesh objects by base name (strip _0, _1 suffix from multipolygon parts)
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
        else:
            # try exact object name
            for o in col.objects:
                if o.type == "MESH" and (o.name == label or o.name.startswith(label + "_")):
                    building_objects[address] = o
                    break
    return building_objects


# ============================================================
# MARKER
# ============================================================


def create_marker(location):
    """Creates an arrow/person marker at the given XY location."""
    col = make_collection("Marker")

    # Body — vertical cylinder
    bpy.ops.mesh.primitive_cylinder_add(
        radius=MARKER_SIZE * 0.3,
        depth=MARKER_SIZE * 1.2,
        location=(location[0], location[1], MARKER_SIZE * 0.8),
    )
    body = bpy.context.active_object
    body.name = "Marker_Body"
    move_object_to_collection(body, col)

    # Head — sphere on top
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=MARKER_SIZE * 0.4,
        location=(location[0], location[1], MARKER_SIZE * 1.7),
    )
    head = bpy.context.active_object
    head.name = "Marker_Head"
    move_object_to_collection(head, col)

    # Arrow base — cone pointing down
    bpy.ops.mesh.primitive_cone_add(
        radius1=MARKER_SIZE * 0.5,
        radius2=0,
        depth=MARKER_SIZE * 0.6,
        location=(location[0], location[1], MARKER_SIZE * 0.2),
    )
    arrow = bpy.context.active_object
    arrow.name = "Marker_Arrow"
    move_object_to_collection(arrow, col)

    # Material — white emissive
    mat = make_flat_material("FLYR_Marker", MARKER_COLOR, roughness=0.3, emit_strength=2.0)
    assign_material(body, mat)
    assign_material(head, mat)
    assign_material(arrow, mat)

    head.parent = body
    arrow.parent = body

    return body  # move body to move the whole marker


# ============================================================
# CAMERA SETUP
# ============================================================


def setup_follow_camera(start_x, start_y):
    for obj in list(bpy.data.objects):
        if obj.type == "CAMERA":
            bpy.data.objects.remove(obj)

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
    """
    Blender 5+ uses layered Actions; f-curves live on channelbags per slot/strip.
    Older Blender exposes action.fcurves directly.
    """
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


def animate_canvassing(addresses_sorted, building_objects, marker, cam):
    """
    Keyframes:
    - marker moves to each address position
    - building flips green on arrival
    - camera loosely follows
    """
    scene = bpy.context.scene

    frame_map = {}
    frame = 1

    for addr_data in addresses_sorted:
        frame_map[addr_data["formatted"]] = frame
        frame += FRAMES_PER_ADDRESS + PAUSE_AT_ADDRESS

    total_frames = frame + FRAME_RANGE_TAIL
    scene.frame_end = total_frames
    scene.render.fps = FPS

    print(f"  Animation: {total_frames} frames ≈ {total_frames // max(FPS, 1)}s at {FPS}fps")
    print(f"  Addresses to animate: {len(addresses_sorted)}")

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

    if (
        not SKIP_FCURVE_INTERPOLATION_PASS
        and marker.animation_data
        and marker.animation_data.action
    ):
        for fc in iter_action_fcurves(marker.animation_data.action):
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"

    # Building red→green is handled by setup_animated_material() object color keyframes

    naddr = len(addresses_sorted)
    if naddr > 1:
        cam_step = max(1, (naddr - 1) // max(1, CAM_MAX_KEYFRAMES - 1))
    else:
        cam_step = 1

    for idx, addr_data in enumerate(addresses_sorted):
        if idx % cam_step != 0 and idx != naddr - 1:
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
        pitch = math.asin(dz / dist)
        yaw = math.atan2(dy, dx)
        cam.rotation_euler = (math.pi / 2 + pitch, 0, yaw + math.pi / 2)
        cam.keyframe_insert(data_path="rotation_euler", frame=arrive_frame)

    if (
        not SKIP_FCURVE_INTERPOLATION_PASS
        and cam.animation_data
        and cam.animation_data.action
    ):
        for fc in iter_action_fcurves(cam.animation_data.action):
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
                kp.handle_left_type = "AUTO"
                kp.handle_right_type = "AUTO"

    scene.frame_set(1)
    print("  ✓ Animation keyframes set")


# ============================================================
# BUILDING COLOR (object color keyframes, shared material)
# ============================================================


def setup_animated_material(obj, arrive_frame):
    """
    Uses object color keyframes instead of per-object material drivers.
    Much lighter — no driver evaluation overhead.
    Requires configure_mat_red_object_color(mat_red) on FLYR_Target.
    """
    obj.color = (*COLOR_RED[:3], 1.0)
    obj.keyframe_insert(data_path="color", frame=max(1, arrive_frame - 1))
    obj.color = (*COLOR_GREEN[:3], 1.0)
    obj.keyframe_insert(data_path="color", frame=arrive_frame)


# ============================================================
# MAIN
# ============================================================


def run_canvassing_animation():
    manifest_path = os.path.join(EXPORT_DIR, "manifest.json")
    if not os.path.exists(manifest_path):
        print(f"ERROR: manifest.json not found at {EXPORT_DIR}")
        return

    print("\n=== FLYR Canvassing Animation ===")

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
        seq = props.get("seq")
        formatted = props.get("formatted", "")
        x = geom["coordinates"][0]
        y = geom["coordinates"][1]
        if seq is not None and formatted:
            addresses_raw.append(
                {
                    "seq": seq,
                    "formatted": formatted,
                    "x": x,
                    "y": y,
                }
            )

    addresses_sorted = sorted(addresses_raw, key=lambda a: a["seq"])

    if TOTAL_ADDRESSES is not None:
        addresses_sorted = addresses_sorted[:TOTAL_ADDRESSES]

    print(f"  Addresses in walk order: {len(addresses_sorted)}")
    if addresses_sorted:
        print(f"  First: {addresses_sorted[0]['formatted']}")
        print(f"  Last:  {addresses_sorted[-1]['formatted']}")

    if not addresses_sorted:
        print("ERROR: No addresses with seq + formatted — cannot animate.")
        return

    building_objects = {}

    if BUILD_SCENE:
        ovr = get_view3d_override()
        if not ovr:
            print(
                "ERROR: No 3D Viewport found. Switch to Layout (or add a 3D View) to build meshes."
            )
            return
        with bpy.context.temp_override(**ovr):
            purge_scene_for_rebuild()

            mat_red = make_emission_material("FLYR_Target", COLOR_RED, COLOR_RED, 0.3)
            mat_context = make_flat_material("FLYR_Context", CONTEXT_COLOR, roughness=0.9)
            mat_road = make_flat_material("FLYR_Road", ROAD_COLOR, roughness=0.98)
            mat_boundary = make_flat_material(
                "FLYR_Boundary", BOUNDARY_COLOR, roughness=0.5, emit_strength=1.0
            )

            building_objects = build_full_scene(
                buildings_data,
                roads_data,
                boundary_data,
                mat_red,
                mat_context,
                mat_road,
                mat_boundary,
            )
            print(f"  ✓ Scene built — {len(building_objects)} target buildings mapped")
    else:
        mat_red = bpy.data.materials.get("FLYR_Target") or make_emission_material(
            "FLYR_Target", COLOR_RED, COLOR_RED, 0.3
        )
        configure_mat_red_object_color(mat_red)
        building_objects = collect_target_buildings_from_scene(buildings_data)
        print(f"  ✓ Using existing scene — {len(building_objects)} target buildings matched")

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

    print(f"  ✓ Building color keys: {animated_count} (red → green)")

    if BUILDINGS_ONLY:
        scene = bpy.context.scene
        last_frame = seq_to_frame[addresses_sorted[-1]["formatted"]]
        scene.frame_end = last_frame + FRAME_RANGE_TAIL
        print(f"  ✓ Timeline: frames 1–{scene.frame_end} (buildings only, no camera)")
    else:
        ovr = get_view3d_override()
        if not ovr:
            print(
                "ERROR: No 3D Viewport found. Switch to Layout (or add a 3D View) and run again."
            )
            return
        with bpy.context.temp_override(**ovr):
            start = addresses_sorted[0]
            marker = create_marker((start["x"], start["y"]))
            cam = setup_follow_camera(start["x"], start["y"])
        animate_canvassing(addresses_sorted, building_objects, marker, cam)

    scene = bpy.context.scene
    # Blender 5: use BLENDER_EEVEE (BLENDER_EEVEE_NEXT is not a valid enum)
    scene.render.engine = "BLENDER_EEVEE"
    try:
        scene.eevee.taa_render_samples = 8
    except Exception:
        pass
    scene.render.fps = FPS
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720

    scene.frame_set(1)

    print("\n=== Ready ===")
    if BUILDINGS_ONLY:
        print("  Mode: buildings only — scrub timeline to see green progression")
    else:
        print("  Press Spacebar to preview | Ctrl+F12 to render animation")


run_canvassing_animation()
