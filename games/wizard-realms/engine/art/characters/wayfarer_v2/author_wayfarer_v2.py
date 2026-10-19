"""Author original stylized Wayfarer character candidates for Wizard Realms.

Usage: blender -b --factory-startup --python author_wayfarer_v2.py -- male
       blender -b --factory-startup --python author_wayfarer_v2.py -- female

All modeled surfaces are authored here. The approved concept sheets inform the
silhouette and palette, but their pixels are not projected or copied to meshes.
"""

import json
import math
import resource
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
GENDER = next((x for x in sys.argv[sys.argv.index("--") + 1:] if x in ("male", "female")), "male") if "--" in sys.argv else "male"
FEMALE = GENDER == "female"
HEIGHT_SHIFT = -0.045 if FEMALE else 0.0
MESHES = []
MATERIALS = {}
RIG = None


def hex_rgb(value):
    value = value.lstrip("#")
    channels = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(channel / 12.92 if channel <= .04045 else ((channel + .055) / 1.055) ** 2.4
                 for channel in channels)


def material(name, color, roughness=0.72, metallic=0.0):
    mat = bpy.data.materials.new(name)
    rgb = hex_rgb(color)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    MATERIALS[name] = mat
    return mat


def make_materials():
    material("Robe violet", "402077")
    material("Robe light fold", "512b8b")
    material("Robe shadow fold", "2d1858")
    material("Mantle violet", "492681")
    material("Gold piping", "c48d29", 0.38, 0.62)
    material("Gold highlight", "e1ae48", 0.34, 0.55)
    material("Gold shadow", "8e5d16", 0.48, 0.55)
    material("Tunic cream", "bea474")
    material("Tunic shadow", "987c51")
    material("Leather brown", "593419", 0.66)
    material("Leather highlight", "754821", 0.62)
    material("Leather shadow", "3c2418", 0.78)
    material("Trouser brown", "322416")
    material("Boot brown", "67401f", 0.64)
    material("Boot highlight", "81532b", 0.62)
    material("Skin", "bd7947" if FEMALE else "c78a51", 0.64)
    material("Skin light", "d6985f" if FEMALE else "dca36a", 0.62)
    material("Skin shadow", "875038" if FEMALE else "955b38", 0.68)
    material("Lips", "99543c", 0.7)
    material("Eye white", "d6c7a2", 0.42)
    material("Iris", "704526", 0.4)
    material("Pupil", "18130f", 0.35)
    material("Hair dark", "382213")
    material("Hair main", "593319")
    material("Hair light", "79451f")
    material("Hair glint", "8b552a")


def new_mesh(name, verts, faces, mat, bone="Spine", weights=None, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(MATERIALS[mat] if isinstance(mat, str) else mat)
    for polygon in data.polygons:
        polygon.use_smooth = smooth
    if weights is None:
        group = obj.vertex_groups.new(name=bone)
        group.add(list(range(len(verts))), 1.0, "REPLACE")
    else:
        for bone_name, vertex_weights in weights.items():
            group = obj.vertex_groups.new(name=bone_name)
            for i, value in enumerate(vertex_weights):
                if value > 0:
                    group.add([i], value, "REPLACE")
    obj.parent = RIG
    mod = obj.modifiers.new("Humanoid skin", "ARMATURE")
    mod.object = RIG
    MESHES.append(obj)
    return obj


def ellipsoid(name, center, radius, mat, bone="Spine", segments=24, rings=12):
    verts = []
    faces = []
    for j in range(rings + 1):
        phi = math.pi * j / rings
        for i in range(segments):
            theta = 2 * math.pi * i / segments
            verts.append((center[0] + radius[0] * math.sin(phi) * math.sin(theta),
                          center[1] + radius[1] * math.sin(phi) * math.cos(theta),
                          center[2] + radius[2] * math.cos(phi)))
    for j in range(rings):
        for i in range(segments):
            a = j * segments + i
            b = j * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    return new_mesh(name, verts, faces, mat, bone)


def loft(name, levels, mat, bone="Spine", segments=40, phase=0.0):
    """Level is (z, half-width, front depth, back depth, center-y, fold)."""
    verts = []
    faces = []
    for z, width, front, back, cy, fold in levels:
        for i in range(segments):
            a = math.tau * i / segments
            x = width * math.sin(a)
            y = cy + (front if math.cos(a) >= 0 else back) * math.cos(a)
            y += fold * math.cos(7 * a + phase)
            verts.append((x, y, z + fold * 0.14 * math.cos(7 * a + phase)))
    for j in range(len(levels) - 1):
        for i in range(segments):
            a = j * segments + i
            b = j * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    faces.append(tuple(reversed(range(segments))))
    k = (len(levels) - 1) * segments
    faces.append(tuple(k + i for i in range(segments)))
    return new_mesh(name, verts, faces, mat, bone)


def tube(name, points, widths, depths, mat, bone="Spine", sides=10, weights=None):
    points = [Vector(p) for p in points]
    if isinstance(widths, (int, float)):
        widths = [widths] * len(points)
    if isinstance(depths, (int, float)):
        depths = [depths] * len(points)
    verts = []
    faces = []
    for j, p in enumerate(points):
        tangent = points[min(j + 1, len(points) - 1)] - points[max(j - 1, 0)]
        tangent.normalize()
        axis = tangent.cross(Vector((0, 1, 0)))
        if axis.length < 0.05:
            axis = tangent.cross(Vector((0, 0, 1)))
        axis.normalize()
        second = tangent.cross(axis).normalized()
        for i in range(sides):
            a = math.tau * i / sides
            v = p + axis * math.cos(a) * widths[j] + second * math.sin(a) * depths[j]
            verts.append(tuple(v))
    for j in range(len(points) - 1):
        for i in range(sides):
            a = j * sides + i
            b = j * sides + (i + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.extend([tuple(reversed(range(sides))), tuple((len(points) - 1) * sides + i for i in range(sides))])
    if weights:
        expanded = {name: [value for value in ring_values for _ in range(sides)] for name, ring_values in weights.items()}
    else:
        expanded = None
    return new_mesh(name, verts, faces, mat, bone, expanded)


def line(name, points, radius, mat, bone="Spine"):
    return tube(name, points, radius, radius, mat, bone, sides=7)


def panel(name, rows, mat, bone="Spine"):
    verts = [v for row in rows for v in row]
    width = len(rows[0])
    faces = []
    for j in range(len(rows) - 1):
        for i in range(width - 1):
            a = j * width + i
            faces.append((a, a + 1, a + 1 + width, a + width))
    return new_mesh(name, verts, faces, mat, bone)


def rig():
    global RIG
    data = bpy.data.armatures.new("WayfarerV2Humanoid")
    RIG = bpy.data.objects.new("WayfarerV2Rig", data)
    bpy.context.collection.objects.link(RIG)
    bpy.context.view_layer.objects.active = RIG
    RIG.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    specs = [
        ("Root", None, (0, 0, .02), (0, 0, .14)),
        ("Hips", "Root", (0, 0, .91), (0, 0, 1.14)),
        ("Spine", "Hips", (0, 0, 1.14), (0, 0, 1.58)),
        ("Neck", "Spine", (0, 0, 1.58), (0, 0, 1.72)),
        ("Head", "Neck", (0, 0, 1.72), (0, 0, 2.12)),
    ]
    for sign, side in ((-1, "L"), (1, "R")):
        specs.extend([
            (f"UpperArm.{side}", "Spine", (sign * .28, 0, 1.55), (sign * .41, .015, 1.30)),
            (f"Forearm.{side}", f"UpperArm.{side}", (sign * .41, .015, 1.30), (sign * .49, .07, 1.09)),
            (f"Hand.{side}", f"Forearm.{side}", (sign * .49, .07, 1.09), (sign * .51, .10, .95)),
            (f"Thigh.{side}", "Hips", (sign * .145, 0, .94), (sign * .15, 0, .53)),
            (f"Shin.{side}", f"Thigh.{side}", (sign * .15, 0, .53), (sign * .15, 0, .17)),
            (f"Foot.{side}", f"Shin.{side}", (sign * .15, 0, .17), (sign * .15, .17, .09)),
        ])
    for name, parent, head, tail in specs:
        b = data.edit_bones.new(name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    RIG.select_set(False)


def body():
    # A tapered continuous torso replaces spherical shoulder joints.
    width = .27 if FEMALE else .31
    loft("Fitted violet coat torso", [(1.08, .20, .15, .12, 0, .003),
                                      (1.23, .22, .16, .13, 0, .004),
                                      (1.43, width, .17, .15, -.012, .004),
                                      (1.56, width + .005, .14, .13, -.018, .003),
                                      (1.66, .13, .09, .09, -.01, 0)], "Robe violet")
    # Cream tunic visible through the open chest and below the belt.
    panel("Cream collar inset", [[(-.11, .167, 1.61), (0, .185, 1.63), (.11, .167, 1.61)],
                                  [(-.13, .177, 1.43), (0, .190, 1.43), (.13, .177, 1.43)],
                                  [(-.09, .17, 1.14), (0, .185, 1.14), (.09, .17, 1.14)]], "Tunic cream")
    panel("Long cream tunic front", [[(-.095, .173, 1.14), (0, .190, 1.14), (.095, .173, 1.14)],
                                      [(-.09, .174, 1.01), (0, .185, 1.01), (.09, .174, 1.01)],
                                      [(-.08, .174, .80), (0, .18, .78), (.08, .174, .80)]], "Tunic cream", "Hips")
    for x in (-.095, .095):
        line("Cream tunic seam", [(x, .175, 1.12), (x * .95, .18, .97), (x * .85, .18, .8)], .006, "Tunic shadow", "Hips")
    # Fitted split coat, complete around the back, flaring toward the ankles.
    for sign, side in ((-1, "left"), (1, "right")):
        angles = [math.radians(v) for v in range(15, 181, 5)] if sign == 1 else [math.radians(v) for v in range(180, 346, 5)]
        levels = [(1.145, .215, .16), (1.00, .24, .18), (.76, .30, .24), (.49, .38, .30), (.19, .48, .36)]
        rows = []
        for z, rx, ry in levels:
            row = []
            for a in angles:
                fold = .012 * math.cos(7 * a + (1 if sign == 1 else 2)) * ((1.18 - z) / 1.0)
                row.append(((rx + fold) * math.sin(a), (ry + fold) * math.cos(a) - .012,
                            z + .014 * math.cos(5 * a)))
            rows.append(row)
        panel(f"Tailored coat {side} skirt", rows, "Robe violet", "Hips")
        for idx in (0, -1):
            line(f"Coat {side} front piping", [row[idx] for row in rows], .008, "Gold piping", "Hips")
        hem = rows[-1]
        line(f"Coat {side} hem piping", hem[::3] + [hem[-1]], .008, "Gold piping", "Hips")
        # Shadowed fold breaks up the shell while preserving a smooth hem.
        a = math.radians(57 if sign == 1 else 303)
        line(f"Coat {side} fold ridge", [((rx + .014) * math.sin(a), (ry + .014) * math.cos(a) - .012, z)
                                          for z, rx, ry in levels], .005, "Robe light fold", "Hips")
    # Pants and boots appear behind the split front.
    for sign, side in ((-1, "L"), (1, "R")):
        loft(f"Trouser {side}", [(.91, .105, .10, .10, 0, .0), (.55, .095, .088, .088, 0, .0),
                                (.31, .073, .075, .075, 0, .0)], "Trouser brown", f"Thigh.{side}", segments=20)
        obj = MESHES[-1]
        for vertex in obj.data.vertices:
            vertex.co.x += sign * .15
        loft(f"Boot shaft {side}", [(.41, .092, .093, .093, 0, 0), (.27, .083, .083, .083, 0, 0),
                                   (.10, .09, .1, .1, 0, 0)], "Boot brown", f"Shin.{side}", segments=20)
        for vertex in MESHES[-1].data.vertices:
            vertex.co.x += sign * .15
        ellipsoid(f"Boot toe {side}", (sign * .15, .13, .083), (.115, .215, .073), "Boot highlight", f"Foot.{side}")
        tube(f"Boot top cuff {side}", [(sign * .15, -.01, .40), (sign * .15, .01, .34)],
             [.105, .104], [.096, .094], "Leather brown", f"Shin.{side}", sides=18)
        line(f"Boot ankle seam {side}", [(sign * .245, .12, .13), (sign * .20, .23, .12), (sign * .11, .25, .12)], .008, "Leather shadow", f"Foot.{side}")


def arms_and_hands():
    for sign, side in ((-1, "L"), (1, "R")):
        points = [(sign * .28, -.015, 1.55), (sign * .34, .005, 1.48),
                  (sign * .40, .025, 1.34), (sign * .445, .05, 1.21),
                  (sign * .48, .075, 1.10)]
        weights = {f"UpperArm.{side}": [1.0, 1.0, .85, .2, 0.0],
                   f"Forearm.{side}": [0.0, 0.0, .15, .8, 1.0]}
        tube(f"Continuous draped sleeve {side}", points, [.13, .126, .118, .145, .152],
             [.125, .12, .113, .11, .11], "Robe violet", weights=weights, sides=20)
        line(f"Sleeve cuff gold {side}", [(sign * .485, -.036, 1.095), (sign * .56, .045, 1.095),
                                          (sign * .55, .17, 1.095), (sign * .45, .19, 1.095),
                                          (sign * .395, .11, 1.095), (sign * .485, -.036, 1.095)],
             .011, "Gold piping", f"Forearm.{side}")
        # No ball at the wrist: palm disappears naturally into the open cuff.
        ellipsoid(f"Hand palm {side}", (sign * .49, .07, 1.015), (.047, .041, .083), "Skin", f"Hand.{side}", 18, 10)
        for index in range(4):
            x = sign * (.455 + index * .021)
            finger_z = .938 + (abs(index - 1.5) * .009)
            tube(f"Finger {side} {index}", [(x, .078, .982), (x + sign * .002, .082, finger_z),
                                            (x + sign * .006, .093, finger_z - .026)],
                 [.010, .009, .006], [.010, .009, .006], "Skin", f"Hand.{side}", sides=8)
        tube(f"Thumb {side}", [(sign * .448, .11, 1.025), (sign * .424, .135, .99),
                                (sign * .43, .137, .968)], [.018, .015, .009], [.016, .013, .009],
             "Skin", f"Hand.{side}", sides=9)
        # Diamond embroidery on the cuff, mapped as raised threads.
        cx = sign * .49
        line(f"Cuff diamond {side}", [(cx, .178, 1.155), (cx + sign * .035, .176, 1.11),
                                      (cx, .178, 1.065), (cx - sign * .035, .176, 1.11),
                                      (cx, .178, 1.155)], .006, "Gold highlight", f"Forearm.{side}")


def face():
    # Facial cross sections narrow into a jaw, protrude at cheek and brow, and
    # resolve to a pointed chin. This mesh supplies the profile, not a sphere.
    z_levels = [(1.685, .025, .09, .08), (1.705, .075, .12, .095),
                (1.745, .12, .153, .112), (1.79, .142, .168, .12),
                (1.835, .155, .181, .127), (1.88, .155, .188, .13),
                (1.925, .148, .18, .13), (1.97, .153, .175, .14),
                (2.01, .17, .17, .15), (2.055, .172, .16, .152),
                (2.10, .15, .145, .14), (2.145, .10, .10, .10), (2.165, .025, .05, .05)]
    if FEMALE:
        z_levels = [(z + HEIGHT_SHIFT, w * .92, f * .97, b * .98) for z, w, f, b in z_levels]
    levels = [(z, w, f, b, 0, 0) for z, w, f, b in z_levels]
    loft("Sculpted adult face and cranium", levels, "Skin light", "Head", 48)
    zz = HEIGHT_SHIFT
    for sign, side in ((-1, "L"), (1, "R")):
        ellipsoid(f"Ear {side}", (sign * .164, -.001, 1.884 + zz), (.025, .037, .064), "Skin", "Head", 20, 10)
        line(f"Ear helix {side}", [(sign * .178, .029, 1.928 + zz), (sign * .183, .035, 1.895 + zz),
                                  (sign * .17, .038, 1.865 + zz)], .007, "Skin shadow", "Head")
        x = sign * .075
        # Almond eyes sit inside sculpted sockets, with lids and iris depth.
        ellipsoid(f"Eye sclera {side}", (x, .180, 1.938 + zz), (.046, .015, .023), "Eye white", "Head", 20, 10)
        ellipsoid(f"Iris {side}", (x + sign * .002, .195, 1.939 + zz), (.018, .009, .018), "Iris", "Head", 18, 9)
        ellipsoid(f"Pupil {side}", (x + sign * .002, .204, 1.94 + zz), (.009, .005, .010), "Pupil", "Head", 14, 8)
        ellipsoid(f"Eye glint {side}", (x - sign * .004, .209, 1.947 + zz), (.004, .003, .004), "Eye white", "Head", 10, 6)
        line(f"Upper eyelid {side}", [(x - sign * .048, .174, 1.942 + zz),
                                      (x - sign * .021, .195, 1.957 + zz),
                                      (x + sign * .017, .197, 1.957 + zz),
                                      (x + sign * .047, .177, 1.939 + zz)], .006, "Skin shadow", "Head")
        line(f"Lower eyelid {side}", [(x - sign * .045, .175, 1.934 + zz),
                                      (x, .190, 1.914 + zz), (x + sign * .043, .177, 1.935 + zz)],
             .0035, "Skin shadow", "Head")
        tube(f"Expressive eyebrow {side}", [(x - sign * .05, .182, 1.99 + zz),
                                             (x - sign * .015, .18, 2.001 + zz),
                                             (x + sign * .032, .165, 1.993 + zz),
                                             (x + sign * .055, .15, 1.98 + zz)],
             [.008, .013, .011, .003], [.006, .006, .006, .003], "Hair dark", "Head", sides=8)
        ellipsoid(f"Cheek volume {side}", (sign * .107, .131, 1.853 + zz), (.052, .018, .043), "Skin light", "Head", 20, 10)
    tube("Sculpted nose bridge", [(0, .177, 1.959 + zz), (0, .205, 1.913 + zz),
                                   (0, .25, 1.866 + zz)], [.023, .019, .032], [.024, .022, .025],
         "Skin light", "Head", sides=16)
    ellipsoid("Nose tip", (0, .249, 1.856 + zz), (.041, .032, .022), "Skin light", "Head", 20, 10)
    for sign in (-1, 1):
        ellipsoid("Nose ala", (sign * .029, .219, 1.845 + zz), (.022, .018, .016), "Skin", "Head", 14, 8)
    line("Quiet closed mouth", [(-.045, .171, 1.798 + zz), (-.025, .183, 1.794 + zz),
                                 (0, .192, 1.792 + zz), (.027, .183, 1.795 + zz),
                                 (.046, .168, 1.8 + zz)], .0036, "Lips", "Head")
    line("Lower lip highlight", [(-.023, .180, 1.781 + zz), (0, .190, 1.777 + zz),
                                  (.025, .180, 1.782 + zz)], .004, "Skin", "Head")
    # The neck is exposed only in the shallow open collar.
    tube("Neck anatomy", [(0, 0, 1.67 + zz), (0, 0, 1.76 + zz)], [.062, .067], [.063, .068],
         "Skin", "Neck", sides=18)


def hair():
    zz = HEIGHT_SHIFT
    if FEMALE:
        ellipsoid("Chestnut hair crown", (0, -.03, 2.085 + zz), (.178, .16, .112), "Hair dark", "Head", 32, 14)
        # Half-up braided crown and loose shoulder length locks.
        for sign in (-1, 1):
            for i in range(5):
                y = -.09 - .018 * i
                tube(f"Braided crown {sign} {i}", [(sign * .17, y, 2.10 + zz),
                                                    (sign * (.145 - i * .012), y - .008, 2.152 + zz),
                                                    (sign * (.09 - i * .01), y - .014, 2.172 + zz)],
                     [.025, .029, .012], [.019, .024, .010],
                     "Hair light" if i % 2 else "Hair main", "Head", sides=10)
            for i in range(5):
                x = sign * (.11 + .018 * i)
                tube(f"Long wavy hair {sign} {i}", [(x * .68, -.115, 2.13 + zz),
                                                     (x, -.13, 1.98 + zz),
                                                     (x + sign * .025, -.12, 1.82 + zz),
                                                     (x + sign * .045, -.105, 1.67 + zz),
                                                     (x + sign * .035, -.10, 1.61 + zz)],
                     [.02, .034, .034, .025, .002], [.018, .03, .03, .02, .002],
                     ("Hair main", "Hair light", "Hair dark")[i % 3], "Head", sides=9)
        for i in range(7):
            x = -.13 + i * .043
            tube(f"Female swept fringe {i}", [(x, -.02, 2.158 + zz),
                                               (x + .028, .085, 2.138 + zz),
                                               (x + .042, .14, 2.08 + zz),
                                               (x + .052, .153, 2.025 + zz)],
                 [.021, .031, .026, .002], [.018, .025, .022, .002],
                 "Hair light" if i % 3 == 1 else "Hair main", "Head", sides=9)
        ellipsoid("Half-up bun", (0, -.15, 2.17 + zz), (.079, .07, .065), "Hair main", "Head", 24, 12)
        line("Back hair clasp diamond", [(0, -.225, 2.18 + zz), (.023, -.225, 2.155 + zz),
                                         (0, -.226, 2.13 + zz), (-.023, -.225, 2.155 + zz),
                                         (0, -.225, 2.18 + zz)], .007, "Gold piping", "Head")
    else:
        ellipsoid("Layered hair foundation", (0, -.03, 2.09), (.176, .155, .108), "Hair dark", "Head", 32, 14)
        # Layered directional clumps give a combed but wind-tossed volume.
        for i in range(12):
            a = math.tau * i / 12
            x = .13 * math.sin(a)
            y = -.025 + .11 * math.cos(a)
            bend = .034 if i < 7 else -.01
            tube(f"Sculpted crown lock {i}", [(x * .58, y * .58 - .04, 2.17),
                                               (x, y, 2.20 + .025 * math.sin(i * 2.1)),
                                               (x + bend, y + .03, 2.14),
                                               (x + bend * 1.5, y + .06, 2.07)],
                 [.016, .038, .036, .002], [.015, .031, .027, .002],
                 ("Hair main", "Hair light", "Hair dark")[i % 3], "Head", sides=9)
        for i in range(9):
            x = -.145 + i * .038
            tube(f"Male forelock {i}", [(x - .04, -.01, 2.169),
                                        (x, .083, 2.185 + .012 * math.sin(i)),
                                        (x + .025, .138, 2.132),
                                        (x + .037, .15, 2.075 - .012 * math.sin(i))],
                 [.019, .037, .029, .002], [.016, .027, .021, .002],
                 "Hair light" if i % 3 == 1 else "Hair main", "Head", sides=9)
        for sign, side in ((-1, "L"), (1, "R")):
            for i in range(3):
                x = sign * (.15 + .012 * i)
                tube(f"Temple hair {side} {i}", [(x, -.04, 2.11), (x + sign * .02, -.015, 2.04),
                                                (x + sign * .01, -.01, 1.975), (x - sign * .012, -.01, 1.945)],
                     [.022, .028, .022, .002], [.019, .026, .018, .002],
                     "Hair dark" if i == 0 else "Hair main", "Head", sides=9)


def mantle_and_gear():
    zz = HEIGHT_SHIFT
    # High collar, sculpted hood folds, shoulder drape, then ornamental seams.
    loft("Raised high collar", [(1.615 + zz, .122, .095, .11, -.02, 0),
                               (1.69 + zz, .14, .105, .125, -.025, 0),
                               (1.75 + zz, .15, .09, .14, -.045, 0)], "Robe shadow fold", "Spine", 32)
    line("Collar gold inner edge", [(-.145, .04, 1.74 + zz), (-.10, .10, 1.705 + zz),
                                   (0, .105, 1.68 + zz), (.10, .10, 1.705 + zz),
                                   (.145, .04, 1.74 + zz)], .009, "Gold piping")
    # Layered scarf rolls around the chest and shoulder. They stay attached to
    # the torso, so no disconnected joint caps read through the mantle.
    tube("Deep violet shoulder cowl", [(-.315, -.03, 1.56), (-.22, .08, 1.615),
                                       (0, .12, 1.59), (.20, .08, 1.615), (.315, -.03, 1.56)],
         [.06, .095, .10, .095, .06], [.043, .055, .061, .055, .043], "Mantle violet", sides=16)
    for k, z in enumerate((1.595, 1.555, 1.515)):
        tube(f"Layered scarf fold {k}", [(-.23, .105 + k * .007, z + .043),
                                         (-.12, .177 + k * .008, z),
                                         (0, .19 + k * .008, z - .015),
                                         (.14, .15 + k * .008, z + .01),
                                         (.25, .065, z + .045)],
             [.025, .036, .035, .030, .008], [.018, .025, .025, .022, .008],
             "Robe shadow fold" if k == 2 else "Mantle violet", sides=11)
    for sign, side in ((-1, "L"), (1, "R")):
        # Overlapping shoulder mantle tapers onto the arm, with a single shaped
        # surface rather than a separate armored ball or round shoulder pad.
        rows = [[(sign * .15, .15, 1.63), (sign * .26, .14, 1.65),
                 (sign * .34, .07, 1.61), (sign * .40, -.04, 1.55)],
                [(sign * .18, .19, 1.50), (sign * .29, .175, 1.52),
                 (sign * .375, .085, 1.50), (sign * .42, -.03, 1.48)]]
        panel(f"Tailored shoulder mantle {side}", rows, "Mantle violet")
        line(f"Shoulder gold piping {side}", rows[1], .009, "Gold piping")
        line(f"Shoulder diamond {side}", [(sign * .302, .18, 1.585),
                                          (sign * .33, .165, 1.551),
                                          (sign * .302, .185, 1.518),
                                          (sign * .274, .18, 1.551),
                                          (sign * .302, .18, 1.585)], .006, "Gold highlight")
    # Chest star fastening: two offset beveled diamond outlines plus a center.
    sx = .225
    sy = .185
    sz = 1.54
    line("Eight point gold clasp", [(sx, sy, sz + .055), (sx + .025, sy, sz + .02),
                                    (sx + .045, sy, sz), (sx + .022, sy, sz - .022),
                                    (sx, sy, sz - .055), (sx - .02, sy, sz - .023),
                                    (sx - .045, sy, sz), (sx - .02, sy, sz + .023),
                                    (sx, sy, sz + .055)], .008, "Gold highlight")
    ellipsoid("Clasp sunburst core", (sx, sy + .012, sz), (.018, .012, .025), "Gold piping", "Spine", 14, 8)
    # Waist belt, buckle, functional cross strap and bag.
    tube("Broad leather waist belt", [(-.205, -.05, 1.115), (-.20, .14, 1.115),
                                      (0, .19, 1.115), (.20, .14, 1.115),
                                      (.205, -.05, 1.115), (.0, -.18, 1.115),
                                      (-.205, -.05, 1.115)], .041, .011, "Leather brown", "Hips", sides=8)
    line("Belt buckle outline", [(-.046, .205, 1.15), (.046, .205, 1.15),
                                 (.046, .205, 1.075), (-.046, .205, 1.075),
                                 (-.046, .205, 1.15)], .009, "Gold piping", "Hips")
    line("Buckle pin", [(-.032, .216, 1.114), (.024, .216, 1.114)], .007, "Gold highlight", "Hips")
    tube("Diagonal leather satchel strap", [(.24, .14, 1.51), (.11, .205, 1.37),
                                            (-.02, .207, 1.25), (-.155, .16, 1.08),
                                            (-.28, .06, .96)],
         [.022, .022, .022, .022, .022], [.009] * 5, "Leather brown", sides=8)
    bx = -.28
    ellipsoid("Satchel shaped body", (bx, .06, .95), (.115, .079, .115), "Leather brown", "Hips", 24, 12)
    ellipsoid("Satchel front flap", (bx, .132, 1.013), (.119, .026, .065), "Leather highlight", "Hips", 24, 12)
    line("Satchel flap seam", [(bx - .105, .147, .98), (bx, .155, .961),
                               (bx + .105, .147, .98)], .008, "Leather shadow", "Hips")
    line("Satchel clasp tab", [(bx, .16, 1.018), (bx, .16, .967)], .012, "Leather shadow", "Hips")
    line("Satchel gold closure", [(bx - .014, .172, .987), (bx + .014, .172, .987)], .009, "Gold piping", "Hips")
    # Small gilded robe appliques at the lower front corners.
    for sign in (-1, 1):
        cx = sign * .14
        line(f"Lower coat applique {sign}", [(cx, .355, .325), (cx + sign * .036, .345, .267),
                                             (cx, .345, .212), (cx - sign * .036, .35, .265),
                                             (cx, .355, .325)], .009, "Gold piping", "Hips")


def equipment_sockets():
    specs = [("Socket.RightHand", "Hand.R", (.51, .10, .99)),
             ("Socket.LeftHand", "Hand.L", (-.51, .10, .99)),
             ("Socket.Head", "Head", (0, .01, 2.17 + HEIGHT_SHIFT)),
             ("Socket.Chest", "Spine", (0, .21, 1.44)),
             ("Socket.Legs", "Hips", (0, 0, .89)),
             ("Socket.RightFoot", "Foot.R", (.15, .20, .09)),
             ("Socket.LeftFoot", "Foot.L", (-.15, .20, .09))]
    sockets = []
    for name, bone, point in specs:
        empty = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(empty)
        empty.empty_display_type = "PLAIN_AXES"
        empty.empty_display_size = .035
        empty.parent = RIG
        empty.parent_type = "BONE"
        empty.parent_bone = bone
        empty.matrix_world.translation = point
        empty["role"] = "equipment_socket"
        sockets.append(empty)
    return sockets


def animations():
    RIG.animation_data_create()
    specs = [
        ("Idle", [(1, 0.0, 0.0), (12, .01, .018), (24, 0.0, 0.0)]),
        ("Walk", [(1, .20, .35), (7, 0.0, 0.0), (13, -.20, -.35),
                  (19, 0.0, 0.0), (25, .20, .35)]),
        ("Turn", [(1, 0.0, 0.0), (12, 0.0, .25), (24, 0.0, .52)]),
    ]
    for clip_name, keys in specs:
        action = bpy.data.actions.new(clip_name)
        RIG.animation_data.action = action
        for frame, leg_swing, torso_turn in keys:
            for bone in RIG.pose.bones:
                bone.rotation_mode = "XYZ"
                bone.rotation_euler = (0, 0, 0)
            RIG.pose.bones["Spine"].rotation_euler.z = torso_turn if clip_name == "Turn" else torso_turn * .08
            RIG.pose.bones["Thigh.L"].rotation_euler.x = leg_swing
            RIG.pose.bones["Thigh.R"].rotation_euler.x = -leg_swing
            RIG.pose.bones["UpperArm.L"].rotation_euler.x = -leg_swing * .7
            RIG.pose.bones["UpperArm.R"].rotation_euler.x = leg_swing * .7
            RIG.pose.bones["Head"].rotation_euler.z = -torso_turn * .12 if clip_name == "Turn" else 0
            for bone_name in ("Spine", "Thigh.L", "Thigh.R", "UpperArm.L", "UpperArm.R", "Head"):
                RIG.pose.bones[bone_name].keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
            RIG.pose.bones["Hips"].location.z = .012 * math.sin(frame * .25) if clip_name == "Idle" else 0
            RIG.pose.bones["Hips"].keyframe_insert(data_path="location", frame=frame, group="Hips")
        track = RIG.animation_data.nla_tracks.new()
        track.name = clip_name
        track.strips.new(clip_name, 1, action)
        track.mute = True
    RIG.animation_data.action = None
    for bone in RIG.pose.bones:
        bone.rotation_euler = (0, 0, 0)
        bone.location = (0, 0, 0)


def render_setup():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 650
    scene.render.resolution_y = 820
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.color_depth = "8"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4
    scene.render.film_transparent = False
    scene.world.color = (.47, .48, .51)
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.image_settings.compression = 20
    scene.eevee.taa_render_samples = 24
    bg = material("Studio gray", "96979b", 1)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.012))
    ground = bpy.context.object
    ground.name = "Preview ground (not exported)"
    ground.data.materials.append(bg)
    for name, location, energy, size in [
        ("Softbox key", (3.0, 4.0, 5.5), 700, 4.0),
        ("Softbox fill", (-4.5, 2.0, 3.0), 320, 4.0),
        ("Softbox rim", (0, -4.0, 4.7), 500, 3.0),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0, 0, 1.2)) - obj.location).to_track_quat("-Z", "Y").to_euler()
    data = bpy.data.cameras.new("Turnaround camera")
    camera = bpy.data.objects.new("Turnaround camera", data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    data.type = "ORTHO"
    data.ortho_scale = 2.7
    return camera


def render_views(camera):
    scene = bpy.context.scene
    looks = {"three_quarter": (3.8, 4.9, 2.0),
             "front": (0, 5.7, 2.0),
             "side": (6.0, 0, 2.0),
             "back": (0, -5.7, 2.0)}
    for name, point in looks.items():
        camera.location = point
        camera.rotation_euler = (Vector((0, 0, 1.12)) - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(ROOT / f"{GENDER}_{name}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath, flush=True)


def export(sockets):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [RIG, *MESHES, *sockets]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = RIG
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / f"wayfarer_v2_{GENDER}.blend"))
    bpy.ops.export_scene.gltf(filepath=str(ROOT / f"wayfarer_v2_{GENDER}.glb"),
                              export_format="GLB", use_selection=True, export_yup=True,
                              export_animations=True, export_animation_mode="NLA_TRACKS",
                              export_extras=True)
    glb_bytes = (ROOT / f"wayfarer_v2_{GENDER}.glb").read_bytes()
    json_length = struct.unpack_from("<I", glb_bytes, 12)[0]
    glb = json.loads(glb_bytes[20:20 + json_length])
    animations = {clip["name"]: len(clip.get("channels", [])) for clip in glb.get("animations", [])}
    socket_nodes = {node["name"]: node.get("extras", {}) for node in glb.get("nodes", [])
                    if node.get("name", "").startswith("Socket.")}
    structure = {
        "animationChannels": animations,
        "skins": [len(skin["joints"]) for skin in glb.get("skins", [])],
        "socketNodes": socket_nodes,
        "exportedMaterials": len(glb.get("materials", [])),
        "exportedMeshes": len(glb.get("meshes", [])),
    }
    (ROOT / f"{GENDER}_glb_report.json").write_text(json.dumps(structure, indent=2) + "\n")
    faces = sum(len(obj.data.polygons) for obj in MESHES)
    triangles = sum(sum(len(p.vertices) - 2 for p in obj.data.polygons) for obj in MESHES)
    points = [vertex.co for obj in MESHES for vertex in obj.data.vertices]
    bounds = {"min": [round(min(v[i] for v in points), 4) for i in range(3)],
              "max": [round(max(v[i] for v in points), 4) for i in range(3)]}
    manifest = {
        "status": "candidate_no_go" if not FEMALE else "candidate_unreviewed",
        "gender": GENDER,
        "designReference": f"../../concepts/wayfarer-{GENDER}-concept-{'v1' if FEMALE else 'v4'}.png",
        "authorship": "Original procedural Blender geometry for Wizard Realms. No third-party meshes or texture pixels.",
        "sourceAxes": {"up": "+Z", "forward": "+Y", "origin": "floor between feet"},
        "glbAxes": {"up": "+Y", "forward": "-Z", "origin": "floor between feet"},
        "boundsMeters": bounds,
        "deformBones": [bone.name for bone in RIG.data.bones],
        "equipmentSockets": [obj.name for obj in sockets],
        "animationClips": ["Idle", "Walk", "Turn"],
        "meshObjects": len(MESHES),
        "materialCount": len({mat.name for obj in MESHES for mat in obj.data.materials}),
        "polygonFaces": faces,
        "triangles": triangles,
        "glbBytes": len(glb_bytes),
        "glbStructureValid": (set(animations) == {"Idle", "Walk", "Turn"}
                              and len(glb.get("skins", [])) == 1
                              and len(socket_nodes) == 7
                              and all(node.get("role") == "equipment_socket" for node in socket_nodes.values())),
        "peakProcessMemoryMB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1),
        "qualityNote": ("Male visual review in VISUAL_REVIEW.md is NO-GO; do not integrate."
                        if not FEMALE else "Candidate only; visual review required before integration."),
    }
    (ROOT / f"{GENDER}_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("REPORT", json.dumps(manifest), flush=True)


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    make_materials()
    rig()
    body()
    arms_and_hands()
    face()
    hair()
    mantle_and_gear()
    sockets = equipment_sockets()
    animations()
    camera = render_setup()
    if "--build-only" not in sys.argv:
        render_views(camera)
    export(sockets)


if __name__ == "__main__":
    main()
