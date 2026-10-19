"""Author the original Wayfarer Wizard candidate in one bounded Blender process.

Run from the engine directory:
  blender --background --factory-startup -t 2 --python art/characters/wayfarer_wizard/author_wayfarer.py

Source coordinates use +Y as the face direction and +Z as up. Blender's glTF
Y-up conversion maps this to -Z forward and +Y up in the exported GLB.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


OUT = Path(__file__).resolve().parent
TAU = math.tau
MESHES = []
MATERIALS = {}


def material(name, rgb, roughness=0.88, metallic=0.0):
    rgba = tuple(int(rgb[i:i + 2], 16) / 255 for i in (1, 3, 5)) + (1.0,)
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    MATERIALS[name] = mat
    return mat


def mesh(name, vertices, faces, mat, bone, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    data.materials.append(mat)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    for face in data.polygons:
        face.use_smooth = smooth
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(data.vertices))), 1.0, "REPLACE")
    arm = obj.modifiers.new("WayfarerSkin", "ARMATURE")
    arm.object = RIG
    obj.parent = RIG
    MESHES.append(obj)
    return obj


def ellipsoid(name, center, radius, mat, bone, segments=24, rings=12):
    vertices = [(center[0], center[1], center[2] + radius[2])]
    faces = []
    for j in range(1, rings):
        phi = math.pi * j / rings
        for i in range(segments):
            theta = TAU * i / segments
            vertices.append((center[0] + radius[0] * math.sin(phi) * math.cos(theta),
                             center[1] + radius[1] * math.sin(phi) * math.sin(theta),
                             center[2] + radius[2] * math.cos(phi)))
    for i in range(segments):
        faces.append((0, 1 + i, 1 + (i + 1) % segments))
    for j in range(rings - 2):
        for i in range(segments):
            a = 1 + j * segments + i
            b = 1 + j * segments + (i + 1) % segments
            faces.append((a, a + segments, b + segments, b))
    bottom = len(vertices)
    vertices.append((center[0], center[1], center[2] - radius[2]))
    last = 1 + (rings - 2) * segments
    for i in range(segments):
        faces.append((bottom, last + (i + 1) % segments, last + i))
    return mesh(name, vertices, faces, mat, bone)


def loft(name, levels, mat, bone, segments=48, folds=0.0, phase=0.0):
    """Soft oval garment with fold depth increasing toward the hem."""
    vertices = []
    faces = []
    for z, rx, ry, y_shift in levels:
        falloff = max(0.0, min(1.0, (1.16 - z) / 0.97))
        for i in range(segments):
            angle = TAU * i / segments
            pleat = folds * falloff * (math.sin(angle * 9 + phase) + 0.32 * math.sin(angle * 17 - 0.7))
            vertices.append(((rx + pleat) * math.cos(angle),
                             y_shift + (ry + pleat * 0.68) * math.sin(angle), z))
    for j in range(len(levels) - 1):
        for i in range(segments):
            a = j * segments + i
            b = j * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    return mesh(name, vertices, faces, mat, bone)


def sweep(name, points, widths, depths, mat, bone, sides=10):
    """Small elliptical cord or leather binding following authored landmarks."""
    pts = [Vector(point) for point in points]
    vertices = []
    faces = []
    for index, point in enumerate(pts):
        before = pts[max(0, index - 1)]
        after = pts[min(len(pts) - 1, index + 1)]
        tangent = (after - before).normalized()
        normal = tangent.cross(Vector((0, 1, 0))).normalized()
        if normal.length < 0.1:
            normal = tangent.cross(Vector((0, 0, 1))).normalized()
        depth_axis = tangent.cross(normal).normalized()
        for side in range(sides):
            angle = TAU * side / sides
            vertex = point + normal * (widths[index] * math.cos(angle)) + depth_axis * (depths[index] * math.sin(angle))
            vertices.append(tuple(vertex))
    for index in range(len(pts) - 1):
        for side in range(sides):
            a = index * sides + side
            b = index * sides + (side + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.extend([tuple(reversed(range(sides))), tuple((len(pts) - 1) * sides + i for i in range(sides))])
    return mesh(name, vertices, faces, mat, bone)


def garment_panel(side):
    rows = 11
    columns = 16
    front = []
    for row in range(rows):
        t = row / (rows - 1)
        z = 0.135 + t * 1.07
        inner = 0.15 * (1 - t) + 0.012 * t
        outer = 0.435 * (1 - t) + 0.255 * t
        for column in range(columns):
            u = column / (columns - 1)
            x = side * (inner * (1 - u) + outer * u)
            y = (0.36 * (1 - t) + 0.255 * t + 0.026 * math.sin(u * math.pi)
                 + 0.036 * (1 - t) * math.sin(u * 3 * math.pi + .35)
                 + 0.015 * (1 - t) * math.sin(19 * x + 4.5 * t))
            z_drape = z - 0.025 * (1 - t) * math.sin(u * TAU + 0.4)
            front.append((x, y, z_drape))
    vertices = front + [(x, y - 0.023, z) for x, y, z in front]
    faces = []
    count = len(front)
    for row in range(rows - 1):
        for column in range(columns - 1):
            a = row * columns + column
            b = a + 1
            c = a + columns
            quad = (a, c, c + 1, b)
            faces.append(quad if side > 0 else tuple(reversed(quad)))
            faces.append(tuple(reversed(tuple(index + count for index in quad))))
    perimeter = (list(range(columns)) + [row * columns + columns - 1 for row in range(1, rows)]
                 + [((rows - 1) * columns + column) for column in range(columns - 2, -1, -1)]
                 + [row * columns for row in range(rows - 2, 0, -1)])
    for index, a in enumerate(perimeter):
        b = perimeter[(index + 1) % len(perimeter)]
        faces.append((a, b, b + count, a + count))
    mesh(f"RobeOuterPanel_{'R' if side > 0 else 'L'}", vertices, faces, ROBE, "Hips")
    hem = [front[column] for column in range(columns)]
    sweep(f"PanelHemPiping_{side}", [(x, y + 0.006, z + 0.02) for x, y, z in hem],
          [0.014] * columns, [0.009] * columns, TRIM, "Hips", 6)
    edge = [front[row * columns] for row in range(rows)]
    sweep(f"FrontEdgePiping_{side}", [(x, y + 0.007, z) for x, y, z in edge],
          [0.012] * rows, [0.008] * rows, TRIM, "Hips", 6)


def bevel_box(name, location, scale, radius, mat, bone):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new("SoftLeatherEdges", "BEVEL")
    bevel.width = radius
    bevel.segments = 3
    obj.modifiers.new("WeightedNormals", "WEIGHTED_NORMAL")
    obj.data.materials.append(mat)
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    skin = obj.modifiers.new("WayfarerSkin", "ARMATURE")
    skin.object = RIG
    obj.parent = RIG
    MESHES.append(obj)
    return obj


def make_rig():
    data = bpy.data.armatures.new("WayfarerHumanoid")
    rig = bpy.data.objects.new("WayfarerRig", data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = [
        ("Root", None, (0, 0, 0.02), (0, 0, 0.14)),
        ("Hips", "Root", (0, 0, 0.96), (0, 0, 1.15)),
        ("Spine", "Hips", (0, 0, 1.15), (0, 0, 1.52)),
        ("Neck", "Spine", (0, 0, 1.52), (0, 0, 1.78)),
        ("Head", "Neck", (0, 0, 1.78), (0, 0, 2.16)),
    ]
    for side, suffix in ((-1, "L"), (1, "R")):
        bones += [
            (f"UpperArm.{suffix}", "Spine", (side * 0.29, 0, 1.54), (side * 0.46, 0, 1.29)),
            (f"Forearm.{suffix}", f"UpperArm.{suffix}", (side * 0.46, 0, 1.29), (side * 0.53, 0.03, 1.07)),
            (f"Hand.{suffix}", f"Forearm.{suffix}", (side * 0.53, 0.03, 1.07), (side * 0.56, 0.1, 0.98)),
            (f"Thigh.{suffix}", "Hips", (side * 0.145, 0, 0.96), (side * 0.15, 0, 0.54)),
            (f"Shin.{suffix}", f"Thigh.{suffix}", (side * 0.15, 0, 0.54), (side * 0.15, 0, 0.16)),
            (f"Foot.{suffix}", f"Shin.{suffix}", (side * 0.15, 0, 0.16), (side * 0.15, 0.20, 0.085)),
        ]
    for name, parent, head, tail in bones:
        bone = data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        if parent:
            bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.select_set(False)
    return rig


def socket(name, bone, point):
    empty = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(empty)
    empty.empty_display_type = "PLAIN_AXES"
    empty.empty_display_size = 0.065
    empty.parent = RIG
    empty.parent_type = "BONE"
    empty.parent_bone = bone
    empty.matrix_world = Matrix.Translation(point)
    empty["role"] = "equipment_socket"
    return empty


def build():
    global RIG, ROBE, TRIM
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    RIG = make_rig()
    ROBE = material("Dyed heather purple wool", "#60418b")
    SHADOW = material("Deep plum underrobe", "#39294e")
    TRIM = material("Dusty lilac woven binding", "#a28ac0")
    MANTLE = material("Indigo violet mantle", "#46336d")
    LEATHER = material("Worn walnut leather", "#704633", 0.78)
    DARK_LEATHER = material("Dark leather boots", "#3f302d", 0.74)
    SKIN = material("Warm medium skin", "#ad7959", 0.84)
    SKIN_SHADE = material("Warm rose lip", "#975e57")
    HAIR = material("Chestnut brown hair", "#36231f", 0.82)
    HAIR_LIGHT = material("Copper hair highlights", "#57372a")
    EYE = material("Deep hazel eyes", "#322723", 0.5)
    GOLD = material("Aged brass", "#b89a5e", 0.46, 0.66)

    # Tailored torso, full underrobe, and overlapping split front panels.
    loft("TorsoTunic", [(1.02, .235, .188, 0), (1.16, .23, .188, 0),
                         (1.38, .265, .19, 0), (1.52, .285, .18, 0),
                         (1.62, .18, .14, 0)], ROBE, "Spine", 40, .009)
    loft("PleatedUnderrobe", [(0.105, .435, .315, -.005), (0.16, .422, .31, 0),
                              (0.37, .385, .28, 0), (0.62, .335, .245, 0),
                              (0.84, .282, .205, 0), (1.07, .24, .18, 0)],
         SHADOW, "Hips", 64, .04, .2)
    for side in (-1, 1):
        garment_panel(side)
    loft("LayeredWaistBelt", [(1.065, .264, .204, 0), (1.12, .27, .207, 0),
                             (1.13, .262, .202, 0)], LEATHER, "Hips", 40)
    bevel_box("PlainBrassBuckle", (0, .222, 1.097), (.105, .025, .077), .013, GOLD, "Hips")
    # The mantle is an open collar rather than a hidden full-body cone.
    mantle_verts = []
    mantle_faces = []
    for radius, zbase in ((0.115, 1.615), (0.30, 1.53), (0.355, 1.44)):
        for i in range(48):
            angle = TAU * i / 48
            sx, sy = math.cos(angle), math.sin(angle)
            mantle_verts.append((radius * sx * 1.05, radius * sy * .68,
                                 zbase - .12 * max(0, -sy) + .07 * max(0, sy)))
    for row in range(2):
        for i in range(48):
            a = row * 48 + i
            b = row * 48 + (i + 1) % 48
            mantle_faces.append((a, a + 48, b + 48, b))
    mesh("ShoulderMantle", mantle_verts, mantle_faces, MANTLE, "Spine")
    ellipsoid("CollarFastener", (0, .125, 1.59), (.045, .018, .045), GOLD, "Spine", 16, 8)
    sweep("MantleSeam", [(.355 * math.cos(i * TAU / 32), .24 * math.sin(i * TAU / 32),
                            1.44 - .12 * max(0, -math.sin(i * TAU / 32)) + .07 * max(0, math.sin(i * TAU / 32))) for i in range(33)],
          [.012] * 33, [.012] * 33, TRIM, "Spine", 6)

    # Long sleeves, small hands, practical trousers and rounded travel boots.
    for side, suffix in ((-1, "L"), (1, "R")):
        upper = f"UpperArm.{suffix}"
        forearm = f"Forearm.{suffix}"
        hand = f"Hand.{suffix}"
        sweep(f"UpperSleeve.{suffix}", [(side * .36, 0, 1.47), (side * .415, 0, 1.39),
                                        (side * .46, .005, 1.27)], [.119, .113, .101],
              [.111, .105, .096], ROBE, upper, 24)
        sweep(f"FlaredCuff.{suffix}", [(side * .46, .005, 1.29), (side * .49, .015, 1.18),
                                      (side * .54, .04, 1.07)], [.101, .112, .127],
              [.096, .107, .121], ROBE, forearm, 24)
        ellipsoid(f"CuffBinding.{suffix}", (side * .54, .04, 1.07), (.13, .12, .038), TRIM, forearm)
        ellipsoid(f"HandPalm.{suffix}", (side * .55, .075, .994), (.069, .055, .091), SKIN, hand, 20, 10)
        ellipsoid(f"Thumb.{suffix}", (side * .49, .116, 1.005), (.033, .038, .053), SKIN, hand, 16, 8)
        ellipsoid(f"TrouserLeg.{suffix}", (side * .15, -.005, .45), (.15, .15, .39), SHADOW, f"Shin.{suffix}")
        ellipsoid(f"BootShaft.{suffix}", (side * .15, -.005, .205), (.146, .15, .196), DARK_LEATHER, f"Shin.{suffix}")
        ellipsoid(f"BootToe.{suffix}", (side * .15, .105, .095), (.163, .238, .091), DARK_LEATHER, f"Foot.{suffix}")
        sweep(f"BootSeam.{suffix}", [(side * .15 + .137 * math.cos(i * TAU / 20),
                                     .005 + .14 * math.sin(i * TAU / 20), .25) for i in range(21)],
              [.009] * 21, [.009] * 21, LEATHER, f"Shin.{suffix}", 6)

    # Human face and swept, asymmetric chestnut hair, readable without a hat.
    ellipsoid("NeckSkin", (0, 0, 1.72), (.104, .102, .105), SKIN, "Neck", 24, 12)
    loft("FaceAndJaw", [(1.735, .105, .115, .013), (1.79, .145, .153, .012),
                        (1.90, .183, .177, .006), (2.02, .181, .178, 0),
                        (2.12, .147, .145, -.006), (2.17, .10, .105, -.014)],
         SKIN, "Head", 40)
    for side, suffix in ((-1, "L"), (1, "R")):
        ellipsoid(f"Ear.{suffix}", (side * .184, -.004, 1.95), (.04, .064, .074), SKIN, "Head", 16, 10)
        ellipsoid(f"Eye.{suffix}", (side * .073, .172, 1.973), (.031, .018, .021), EYE, "Head", 16, 8)
        sweep(f"Brow.{suffix}", [(side * .043, .175, 2.027), (side * .077, .177, 2.035),
                                 (side * .112, .166, 2.023)], [.009] * 3, [.009] * 3, HAIR, "Head", 8)
    ellipsoid("NoseBridge", (0, .18, 1.917), (.028, .038, .061), SKIN, "Head", 16, 8)
    ellipsoid("NoseTip", (0, .211, 1.886), (.031, .021, .02), SKIN, "Head", 16, 8)
    sweep("SoftSmile", [(-.045, .159, 1.829), (0, .173, 1.821), (.045, .159, 1.829)],
          [.005] * 3, [.005] * 3, SKIN_SHADE, "Head", 8)
    ellipsoid("HairCrown", (0, -.022, 2.132), (.197, .17, .153), HAIR, "Head", 32, 16)
    ellipsoid("BackHair", (0, -.105, 1.98), (.186, .137, .235), HAIR, "Head", 24, 12)
    for side, suffix in ((-1, "L"), (1, "R")):
        sweep(f"SideHair.{suffix}", [(side * .174, .035, 2.15), (side * .19, .04, 2.04),
                                    (side * .185, .028, 1.95)], [.047, .043, .008],
              [.047, .04, .008], HAIR, "Head", 12)
    sweep("Forelock", [(-.125, .119, 2.208), (-.065, .168, 2.157), (.004, .184, 2.106),
                       (.056, .177, 2.087)], [.049, .044, .032, .006], [.038, .035, .027, .006],
          HAIR_LIGHT, "Head", 14)
    sweep("CrownSweep", [(.108, .092, 2.237), (.062, .139, 2.23), (-.01, .158, 2.207),
                         (-.09, .151, 2.177)], [.052, .055, .05, .008], [.035, .038, .03, .007],
          HAIR, "Head", 12)

    # A practical cross-body bag differentiates the front, side, and back.
    sweep("CrossBodySatchelStrap", [(-.29, .105, 1.54), (-.21, .212, 1.43),
                                    (-.08, .24, 1.31), (.08, .245, 1.18),
                                    (.24, .197, 1.04), (.39, .075, .91)],
          [.05] * 6, [.014] * 6, LEATHER, "Spine", 10)
    bevel_box("SatchelBody", (.388, -.035, .89), (.205, .16, .245), .045, LEATHER, "Spine")
    bevel_box("SatchelFlap", (.39, .054, .95), (.21, .034, .097), .021, DARK_LEATHER, "Spine")
    ellipsoid("SatchelClasp", (.39, .08, .91), (.024, .014, .026), GOLD, "Spine", 16, 8)

    sockets = [
        socket("Socket.RightHand", "Hand.R", (.55, .11, .99)),
        socket("Socket.LeftHand", "Hand.L", (-.55, .11, .99)),
        socket("Socket.Head", "Head", (0, 0, 2.24)),
        socket("Socket.Chest", "Spine", (0, .23, 1.4)),
        socket("Socket.Legs", "Hips", (0, 0, .87)),
        socket("Socket.RightFoot", "Foot.R", (.15, .15, .11)),
        socket("Socket.LeftFoot", "Foot.L", (-.15, .15, .11)),
    ]
    return sockets


def studio():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 384
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 2
    scene.view_settings.look = "AgX - Base Contrast"
    scene.world.color = (.20, .18, .23)
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.22, .21, .26, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .3
    for name, location, energy, size, color in (
        ("Key", (3, 4, 5), 225, 4, (1, .89, .78)),
        ("Fill", (-3, 2, 3.5), 120, 3.5, (.69, .77, 1)),
        ("Rim", (1, -3, 4), 180, 3, (.88, .72, 1)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        obj = bpy.data.objects.new(f"Studio{name}", data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        obj.rotation_euler = (Vector((0, 0, 1.15)) - obj.location).to_track_quat("-Z", "Y").to_euler()
    floor_mat = material("Preview charcoal floor", "#302d37")
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=1.1, depth=.06, location=(0, 0, -.055))
    floor = bpy.context.object
    floor.name = "PreviewOnlyFloor"
    floor.data.materials.append(floor_mat)
    floor.hide_render = False
    camera_data = bpy.data.cameras.new("TurntableCamera")
    camera = bpy.data.objects.new("TurntableCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.75
    camera.location = (3.3, 4.2, 2.35)
    camera.rotation_euler = (Vector((0, 0, 1.16)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    return camera


def preview(camera):
    target = Vector((0, 0, 1.16))
    for name, location in (
        ("front", (0, 5, 2.08)),
        ("back", (0, -5, 2.08)),
        ("side", (5, 0, 2.08)),
        ("three_quarter", (3.3, 4.2, 2.35)),
    ):
        camera.location = location
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.render.filepath = str(OUT / f"preview_{name}.png")
        bpy.ops.render.render(write_still=True)


def export(sockets):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [RIG, *MESHES, *sockets]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = RIG
    bpy.ops.export_scene.gltf(filepath=str(OUT / "wayfarer_wizard.glb"), export_format="GLB",
                              use_selection=True, export_yup=True, export_animations=False,
                              export_extras=True, export_materials="EXPORT")
    bpy.ops.object.select_all(action="DESELECT")
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangles = 0
    points = []
    for obj in MESHES:
        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        triangles += sum(len(face.vertices) - 2 for face in evaluated_mesh.polygons)
        points.extend(evaluated.matrix_world @ v.co for v in evaluated_mesh.vertices)
        evaluated.to_mesh_clear()
    bounds = {"min": [round(min(p[i] for p in points), 4) for i in range(3)],
              "max": [round(max(p[i] for p in points), 4) for i in range(3)]}
    manifest = {
        "schemaVersion": "wizard-realms.character-candidate/v1",
        "status": "candidate_unaccepted",
        "id": "wayfarer_wizard",
        "originalAuthorship": "Procedural Blender mesh authored for this project; no third-party geometry or pixels",
        "source": "author_wayfarer.py",
        "editableSource": "wayfarer_wizard.blend",
        "runtimeAsset": "wayfarer_wizard.glb",
        "views": [f"preview_{view}.png" for view in ("front", "back", "side", "three_quarter")],
        "sourceAxes": {"up": "+Z", "forward": "+Y", "origin": "floor between feet"},
        "glbAxes": {"up": "+Y", "forward": "-Z", "origin": "floor between feet"},
        "sourceBoundsMeters": bounds,
        "triangleCount": triangles,
        "meshCount": len(MESHES),
        "materialCount": len(MATERIALS) - 1,
        "deformBones": [bone.name for bone in RIG.data.bones],
        "equipmentSockets": [obj.name for obj in sockets],
        "animationClips": [],
        "rigNote": "Rigid weighted garment/body pieces follow an editable humanoid armature. The skirt has no cloth deformation or authored clips yet.",
        "designNote": "Original young traveler with asymmetric chestnut hair, purple split robe, woven mantle, leather belt and satchel. No game franchise designs were copied.",
        "referenceContext": [
            {"url": "https://worldofwarcraft.blizzard.com/en-us/news/19803327", "use": "broad stylized character direction only; source page unavailable during authoring"},
            {"url": "https://support.runescape.com/hc/en-gb/articles/207223015-RuneScape-graphics-settings", "use": "broad range of game model detail and quality settings"},
        ],
        "validation": "Generated asset requires separate GLB structural and visual candidate review before integration",
    }
    (OUT / "candidate.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"glb": str(OUT / "wayfarer_wizard.glb"), "triangles": triangles,
                      "bounds": bounds, "bones": len(RIG.data.bones), "sockets": len(sockets)}))


if __name__ == "__main__":
    sockets = build()
    camera = studio()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "wayfarer_wizard.blend"), check_existing=False)
    export(sockets)
    preview(camera)
