"""Bounded original 3D bust study against the approved male Wayfarer sheet.

This is an art-method experiment, not a playable or rigged character asset.
It creates a continuous relief-sculpted face, a complete hair shell with broad
swept locks, a draped mantle, one sleeve, and one tailored robe fold.
"""

import json
import math
import resource
from pathlib import Path

import bpy
from mathutils import Vector


OUT = Path(__file__).resolve().parent
OBJS = []
MATS = {}


def srgb(hex_color):
    raw = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in raw)


def mat(name, color, roughness=.72, metal=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    rgba = (*srgb(color), 1)
    m.diffuse_color = rgba
    shader = m.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = rgba
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metal
    MATS[name] = m
    return m


def mesh(name, vertices, faces, material, subdivision=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    data.materials.append(MATS[material])
    for polygon in data.polygons:
        polygon.use_smooth = True
    if subdivision:
        mod = ob.modifiers.new("Sculpt surface smoothing", "SUBSURF")
        mod.levels = subdivision
        mod.render_levels = subdivision
    OBJS.append(ob)
    return ob


def grid(name, rows, material, subdivision=0):
    n = len(rows[0])
    vertices = [point for row in rows for point in row]
    faces = [(j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i)
             for j in range(len(rows) - 1) for i in range(n - 1)]
    return mesh(name, vertices, faces, material, subdivision)


def curve_mesh(name, points, radius, material, sides=9):
    points = [Vector(p) for p in points]
    vertices = []
    faces = []
    for j, point in enumerate(points):
        tangent = points[min(j + 1, len(points) - 1)] - points[max(j - 1, 0)]
        tangent.normalize()
        u = tangent.cross(Vector((0, 1, 0))).normalized()
        v = tangent.cross(u).normalized()
        for i in range(sides):
            a = math.tau * i / sides
            vertices.append(tuple(point + radius * (math.cos(a) * u + math.sin(a) * v)))
    for j in range(len(points) - 1):
        for i in range(sides):
            a, b = j * sides + i, j * sides + (i + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    return mesh(name, vertices, faces, material)


def ball(name, center, size, material, segments=20, rings=12):
    vertices, faces = [], []
    for j in range(rings + 1):
        p = math.pi * j / rings
        for i in range(segments):
            a = math.tau * i / segments
            vertices.append((center[0] + size[0] * math.sin(p) * math.sin(a),
                             center[1] + size[1] * math.sin(p) * math.cos(a),
                             center[2] + size[2] * math.cos(p)))
    for j in range(rings):
        for i in range(segments):
            a, b = j * segments + i, j * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    return mesh(name, vertices, faces, material)


def profile(z, knots):
    for index in range(len(knots) - 1):
        za, va = knots[index]
        zb, vb = knots[index + 1]
        if z <= zb:
            t = min(1, max(0, (z - za) / (zb - za)))
            t = t * t * (3 - 2 * t)
            return va * (1 - t) + vb * t
    return knots[-1][1]


def gauss(x, z, cx, cz, sx, sz):
    return math.exp(-((x - cx) / sx) ** 2 - ((z - cz) / sz) ** 2)


def sculpted_head():
    widths = [(1.69, .016), (1.73, .075), (1.78, .115), (1.84, .146),
              (1.91, .150), (1.98, .155), (2.04, .165), (2.10, .153),
              (2.16, .092), (2.185, .012)]
    fronts = [(1.69, .07), (1.77, .13), (1.85, .164), (1.93, .178),
              (2.03, .166), (2.12, .14), (2.185, .015)]
    backs = [(1.69, .07), (1.85, .13), (2.03, .15), (2.12, .14), (2.185, .015)]
    rows = []
    for j in range(73):
        z = 1.69 + .495 * j / 72
        w = profile(z, widths)
        front = profile(z, fronts)
        back = profile(z, backs)
        row = []
        for i in range(97):
            a = math.tau * i / 96
            cs = math.cos(a)
            x = w * math.sin(a)
            y = (front if cs >= 0 else back) * cs
            exposure = max(0, cs) ** 5
            # Continuous anatomical relief. All of these volumes alter the
            # same head mesh, including the nose, cheek, brow, lip, and chin.
            relief = .026 * gauss(x, z, 0, 1.922, .030, .060)
            relief += .066 * gauss(x, z, 0, 1.856, .034, .030)
            relief += .014 * (gauss(x, z, -.033, 1.844, .019, .015)
                              + gauss(x, z, .033, 1.844, .019, .015))
            relief += .014 * (gauss(x, z, -.105, 1.854, .044, .045)
                              + gauss(x, z, .105, 1.854, .044, .045))
            relief += .010 * (gauss(x, z, -.074, 1.984, .045, .018)
                              + gauss(x, z, .074, 1.984, .045, .018))
            relief -= .014 * (gauss(x, z, -.073, 1.938, .044, .032)
                              + gauss(x, z, .073, 1.938, .044, .032))
            relief += .010 * gauss(x, z, 0, 1.786, .055, .012)
            relief += .008 * gauss(x, z, 0, 1.729, .048, .025)
            row.append((x, y + exposure * relief, z))
        rows.append(row)
    ob = grid("Single continuous sculpted face and skull", rows, "warm skin")
    for sign, side in ((-1, "L"), (1, "R")):
        # Shallow eye inserts are surrounded by the relief-sculpted sockets.
        ball("Eye inset " + side, (sign * .074, .152, 1.939), (.044, .013, .020), "eye white")
        ball("Iris " + side, (sign * .074, .166, 1.939), (.016, .006, .016), "iris")
        ball("Pupil " + side, (sign * .074, .172, 1.940), (.008, .004, .009), "pupil")
        curve_mesh("Upper lid " + side,
                   [(sign * .031, .154, 1.942), (sign * .054, .167, 1.955),
                    (sign * .085, .168, 1.954), (sign * .115, .151, 1.94)],
                   .0045, "skin shadow")
        curve_mesh("Lower lid " + side,
                   [(sign * .032, .153, 1.934), (sign * .074, .163, 1.919),
                    (sign * .115, .150, 1.934)], .0028, "skin shadow")
        curve_mesh("Brow ridge " + side,
                   [(sign * .029, .173, 1.993), (sign * .065, .181, 2.002),
                    (sign * .103, .164, 1.999), (sign * .126, .148, 1.989)],
                   .008, "hair base")
    curve_mesh("Natural mouth seam", [(-.044, .172, 1.793), (-.020, .182, 1.790),
                                       (0, .188, 1.789), (.022, .182, 1.792),
                                       (.045, .17, 1.797)], .0027, "lip shadow")
    for sign in (-1, 1):
        ball("Nostril shadow", (sign * .028, .213, 1.838), (.010, .002, .005), "skin shadow", 12, 8)
    return ob


def sculpted_hair():
    # One full scalp shell extends below the ears at the back. The front edge
    # follows a hairline, while ridges sculpt directional locks into the shell.
    rows = []
    for j in range(38):
        t = j / 37
        row = []
        for i in range(97):
            a = math.tau * i / 96
            cs = math.cos(a)
            low = 2.055 - .235 * (1 - cs) / 2
            z = low + (2.225 - low) * t
            taper = max(.015, math.sqrt(max(0, 1 - t ** 2)))
            ripple = .009 * math.cos(8 * a + 2.4 * t)
            w = (.174 + ripple) * taper
            d = (.164 + ripple) * taper
            row.append((w * math.sin(a), -.027 + d * cs, z + .008 * math.sin(5 * a) * (1 - t)))
        rows.append(row)
    grid("Sculpted complete hair shell", rows, "hair base")
    # Broad, beveled overlapping hair ribbons are authored as surfaces. They
    # sit on the shell and change direction at the forehead instead of spikes.
    paths = [
        [(-.12, -.015, 2.212), (-.115, .060, 2.210), (-.12, .132, 2.155), (-.095, .159, 2.087), (-.074, .157, 2.053)],
        [(-.075, -.008, 2.232), (-.045, .070, 2.220), (-.035, .142, 2.174), (-.020, .169, 2.108), (.000, .163, 2.061)],
        [(-.015, -.010, 2.236), (.040, .067, 2.229), (.065, .143, 2.179), (.091, .158, 2.108), (.111, .142, 2.055)],
        [(.050, -.022, 2.221), (.105, .047, 2.212), (.145, .092, 2.171), (.163, .099, 2.094), (.157, .072, 2.015)],
    ]
    for index, path in enumerate(paths):
        rows = []
        for j, (x, y, z) in enumerate(path):
            width = (.036, .050, .048, .033, .003)[j]
            row = []
            for k in range(7):
                u = (k - 3) / 3
                row.append((x + width * u, y + .015 * (1 - u * u), z - .010 * u))
            rows.append(row)
        grid("Broad swept hair lock " + str(index), rows,
             "hair warm" if index % 2 else "hair mid", subdivision=1)
    # The nape remains covered by sculpted continuous layers, unlike v2.
    for sign in (-1, 1):
        for index in range(3):
            x = sign * (.055 + .043 * index)
            rows = []
            for j in range(5):
                t = j / 4
                z = 2.13 - .33 * t
                width = .029 * (1 - .8 * t)
                rows.append([(x + width * u, -.172 - .02 * math.sin(math.pi * t), z + .009 * (1 - u * u))
                             for u in (-1, -.5, 0, .5, 1)])
            grid(f"Nape hair layer {sign} {index}", rows, "hair mid", subdivision=1)


def cloth_bust():
    rows = []
    for j in range(41):
        z = 1.08 + .61 * j / 40
        width = profile(z, [(1.08, .21), (1.29, .24), (1.47, .31),
                            (1.56, .34), (1.66, .13), (1.69, .09)])
        depth = profile(z, [(1.08, .14), (1.47, .175), (1.57, .15), (1.69, .08)])
        row = []
        for i in range(97):
            a = math.tau * i / 96
            x = width * math.sin(a)
            y = depth * math.cos(a)
            y += max(0, math.cos(a)) * .006 * math.sin(13 * a + 9 * z)
            row.append((x, y, z))
        rows.append(row)
    grid("Tailored continuous robe torso", rows, "violet deep")
    # Cream inset and one deliberate asymmetric lapel fold test.
    grid("Cream underrobe inset", [
        [(-.095, .163, 1.62), (0, .170, 1.63), (.095, .163, 1.62)],
        [(-.115, .171, 1.43), (0, .182, 1.43), (.11, .172, 1.43)],
        [(-.10, .161, 1.13), (0, .170, 1.13), (.10, .161, 1.13)],
    ], "cream")
    rows = []
    for j in range(24):
        t = j / 23
        z = 1.58 - .46 * t
        row = []
        for i in range(9):
            u = i / 8
            x = .07 + (.19 + .05 * t) * u
            y = .181 - .04 * u + .019 * math.sin(math.pi * u) * math.sin(math.pi * t)
            z_fold = z + .035 * math.sin(math.pi * u) * (1 - t)
            row.append((x, y, z_fold))
        rows.append(row)
    grid("Sculpted asymmetric front robe fold", rows, "violet fold", subdivision=1)
    curve_mesh("Fold edge gold piping", [row[0] for row in rows[::2]], .006, "gold")
    # Mantle is one broad draped shell with pleated geometry, not stacked tubes.
    rows = []
    for j in range(29):
        t = j / 28
        z = 1.715 - .235 * t
        w = .16 + .20 * math.sin(math.pi * t / 1.6)
        d = .11 + .11 * math.sin(math.pi * t / 1.6)
        row = []
        for i in range(97):
            a = math.tau * i / 96
            fold = .012 * math.sin(6 * a + 5 * t) * math.sin(math.pi * t)
            row.append(((w + fold) * math.sin(a), (d + fold) * math.cos(a) - .008,
                        z + .015 * math.sin(5 * a + 4 * t) * t))
        rows.append(row)
    grid("One piece draped shoulder mantle", rows, "mantle", subdivision=1)
    curve_mesh("Mantle gold edge", rows[-1][::4] + [rows[-1][-1]], .006, "gold")
    # Single sleeve from shoulder to wrist, continuous along the bent arm.
    sleeve = []
    for j in range(31):
        t = j / 30
        cx = .285 + .22 * t + .013 * math.sin(math.pi * t)
        cy = .0 + .042 * t
        cz = 1.565 - .43 * t
        radius = .105 + .020 * t + .010 * math.sin(2 * math.pi * t)
        row = []
        for i in range(49):
            a = math.tau * i / 48
            r = radius + .006 * math.sin(11 * t + 3 * a) * (1 - .3 * t)
            row.append((cx + r * math.cos(a), cy + .8 * r * math.sin(a),
                        cz + .018 * math.sin(a) * t))
        sleeve.append(row)
    grid("One continuous tailored sleeve with cloth folds", sleeve, "violet deep", subdivision=1)
    curve_mesh("Sleeve cuff gold edge", sleeve[-1][::3] + [sleeve[-1][-1]], .007, "gold")


def studio():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 800
    scene.render.resolution_y = 850
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 2
    scene.eevee.taa_render_samples = 24
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.45, .46, .49, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .55
    for name, location, energy, size in [("Key", (2.5, 3.2, 4.0), 500, 3.0),
                                        ("Fill", (-3.0, 2.0, 3.2), 250, 3.0),
                                        ("Rim", (1.0, -3.0, 3.5), 350, 2.6)]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.size = energy, size
        light = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0, 0, 1.65)) - light.location).to_track_quat("-Z", "Y").to_euler()
    cam_data = bpy.data.cameras.new("Bust preview camera")
    camera = bpy.data.objects.new("Bust preview camera", cam_data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 1.48
    return camera


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for name, color, roughness, metal in [
        ("warm skin", "bd824e", .64, 0), ("skin shadow", "7d4a2c", .75, 0),
        ("lip shadow", "814632", .75, 0), ("eye white", "d5c8a8", .45, 0),
        ("iris", "724626", .45, 0), ("pupil", "17100e", .35, 0),
        ("hair base", "3e2617", .72, 0), ("hair mid", "59341e", .7, 0),
        ("hair warm", "754520", .67, 0), ("violet deep", "402077", .78, 0),
        ("violet fold", "512b89", .78, 0), ("mantle", "4b287f", .77, 0),
        ("cream", "bda274", .8, 0), ("gold", "c89535", .42, .55),
    ]:
        mat(name, color, roughness, metal)
    sculpted_head()
    sculpted_hair()
    cloth_bust()
    camera = studio()
    for label, location in [("front", (0, 4.8, 2.0)),
                            ("three_quarter", (3.25, 4.0, 2.0))]:
        camera.location = location
        camera.rotation_euler = (Vector((0, 0, 1.67)) - camera.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.render.filepath = str(OUT / f"bust_{label}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", bpy.context.scene.render.filepath, flush=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "wayfarer_bust_probe.blend"))
    report = {"status": "method_no_go", "rigged": False,
              "source": "original continuous surface modeling in author_bust_probe.py",
              "concept": "../../concepts/wayfarer-male-concept-v4.png",
              "render": {"engine": "Eevee", "resolution": [800, 850], "samples": 24},
              "meshObjects": len(OBJS),
              "trianglesBeforeSubdivision": sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in OBJS),
              "materials": len({m.name for ob in OBJS for m in ob.data.materials}),
              "peakProcessRSSMB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1)}
    (OUT / "probe_report.json").write_text(json.dumps(report, indent=2) + "\n")
    print("REPORT", json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
