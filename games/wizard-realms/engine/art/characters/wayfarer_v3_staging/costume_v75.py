"""Costume-only visual study for the approved Wayfarer sheet.

Call apply_costume_v75() after opening the Step 2 anatomical scene. This pass
adds editable cloth and equipment meshes, and leaves anatomy and hair intact.
"""

import math

import bpy
from mathutils import Vector


PREFIX = "COSTUME | "


def _material(name, rgb, roughness=.73, metallic=0):
    mat = bpy.data.materials.new(PREFIX + name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*rgb, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return mat


def _mesh(name, vertices, faces, mat):
    data = bpy.data.meshes.new(PREFIX + name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(PREFIX + name, data)
    bpy.context.scene.collection.objects.link(obj)
    data.materials.append(mat)
    for polygon in data.polygons:
        polygon.use_smooth = True
    return obj


def _surface(name, rows, mat, reverse=False):
    width = len(rows[0])
    assert width >= 2 and all(len(row) == width for row in rows)
    vertices = [point for row in rows for point in row]
    faces = []
    for j in range(len(rows) - 1):
        for i in range(width - 1):
            k = j * width + i
            face = (k, k + 1, k + width + 1, k + width)
            faces.append(face[::-1] if reverse else face)
    return _mesh(name, vertices, faces, mat)


def _pipe(name, points, mat, radius=.0045):
    curve = bpy.data.curves.new(PREFIX + name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for target, point in zip(spline.points, points):
        target.co = (*point, 1)
    obj = bpy.data.objects.new(PREFIX + name, curve)
    bpy.context.scene.collection.objects.link(obj)
    curve.materials.append(mat)
    return obj


def _wrap(name, levels, mat, start=.43, end=math.tau - .43, segments=40):
    """Open, draped shell rather than a closed skirt cone."""
    rows = []
    for j, (z, width, depth, back, crease) in enumerate(levels):
        row = []
        for i in range(segments + 1):
            a = start + (end - start) * i / segments
            front = math.cos(a)
            fold = crease * (math.sin(5 * a + .7 * j) + .42 * math.sin(9 * a - .3 * j))
            x = (width + fold) * math.sin(a)
            y = (depth if front >= 0 else back) * front + .006 * math.sin(3 * a + j)
            row.append((x, y, z + fold * .29 + .009 * math.sin(3 * a + j)))
        rows.append(row)
    obj = _surface(name, rows, mat, reverse=levels[-1][0] > levels[0][0])
    solid = obj.modifiers.new("woven cloth edge", "SOLIDIFY")
    solid.thickness = .005
    return rows


def _strap(name, centers, half_width, mat):
    rows = []
    for x, y, z in centers:
        rows.append([(x - half_width, y, z), (x + half_width, y, z)])
    obj = _surface(name, rows, mat)
    obj.modifiers.new("leather thickness", "SOLIDIFY").thickness = .004
    return rows


def _arm_sleeve(side, main, gold):
    sign = side
    rows = []
    for j in range(10):
        t = j / 9
        center = Vector((sign * (.39 + .125 * t + .012 * math.sin(math.pi * t)),
                         .01 + .055 * t, 1.69 - .63 * t))
        tangent = Vector((sign * .16, .055, -.63)).normalized()
        transverse = Vector((0, 1, 0))
        other = tangent.cross(transverse).normalized()
        radius = .15 - .035 * t + .008 * math.sin(1.7 * math.pi * t)
        row = []
        for i in range(20):
            a = math.tau * i / 20
            wrinkle = (.008 * math.sin(3 * a + 7 * t)
                       + .004 * math.sin(7 * a - 9 * t)) * math.sin(math.pi * t)
            p = center + transverse * (radius + wrinkle) * math.cos(a)
            p += other * (.85 * radius + wrinkle) * math.sin(a)
            row.append(tuple(p))
        rows.append(row)
    faces = [(j * 20 + i, j * 20 + (i + 1) % 20,
              (j + 1) * 20 + (i + 1) % 20, (j + 1) * 20 + i)
             for j in range(9) for i in range(20)]
    sleeve = _mesh("shaped sleeve " + str(side), [p for row in rows for p in row], faces, main)
    sleeve.modifiers.new("cloth thickness", "SOLIDIFY").thickness = .006
    _pipe("cuff piping " + str(side), rows[-1] + [rows[-1][0]], gold, .006)


def _leg(side, trouser, boot, leather):
    sign = side
    for kind, levels, mat in (
        ("trouser", [(.96, .106, .08, .02), (.73, .098, .076, -.005),
                     (.49, .09, .077, .008), (.28, .085, .073, .0)], trouser),
        ("boot", [(.37, .109, .095, .025), (.25, .106, .10, .035),
                  (.14, .126, .175, .12), (.06, .13, .19, .145),
                  (.012, .13, .19, .145)], boot),
    ):
        rows = []
        for j, (z, width, depth, forward) in enumerate(levels):
            row = []
            for i in range(20):
                a = math.tau * i / 20
                crease = .004 * math.sin(5 * a + 1.6 * j)
                row.append((sign * (.15 + .007 * math.sin(2 * j)) + (width + crease) * math.sin(a),
                            forward + (depth + crease) * math.cos(a), z + .003 * math.sin(3 * a + j)))
            rows.append(row)
        faces = [(j * 20 + i, j * 20 + (i + 1) % 20,
                  (j + 1) * 20 + (i + 1) % 20, (j + 1) * 20 + i)
                 for j in range(len(rows) - 1) for i in range(20)]
        if kind == "boot":
            faces.append(tuple((len(rows) - 1) * 20 + i for i in range(20)))
        _mesh(kind + " " + str(side), [p for row in rows for p in row], faces, mat)
    _pipe("boot cuff " + str(side),
          [(sign * .15 + .11 * math.sin(i * math.tau / 20),
            .025 + .095 * math.cos(i * math.tau / 20), .368) for i in range(21)], leather, .005)


def apply_costume_v75():
    """Add the costume to an open, untouched 2.257 m Step 2 scene."""
    body = bpy.data.objects.get("GEO-body_male_stylized")
    if body is None or body.type != "MESH":
        raise RuntimeError("Open wayfarer_v3_step2_head.blend before the costume pass")
    if any(obj.name.startswith(PREFIX) for obj in bpy.data.objects):
        raise RuntimeError("Costume already exists; reopen Step 2 before applying")
    heights = [(body.matrix_world @ vertex.co).z for vertex in body.data.vertices]
    if abs(min(heights)) > .001 or abs(max(heights) - 2.257) > .001:
        raise RuntimeError("Step 2 body coordinate contract has changed")
    original_meshes = {obj.name: (obj.data.as_pointer(), len(obj.data.vertices))
                       for obj in bpy.data.objects if obj.type == "MESH"}
    purple = _material("tailored amethyst", (.15, .055, .36))
    mantle = _material("draped violet", (.22, .095, .43))
    shadow = _material("fold shadow", (.085, .027, .20))
    cream = _material("linen tunic", (.52, .42, .26))
    gold = _material("fine antique gold", (.61, .39, .09), .43, .35)
    leather = _material("saddle leather", (.24, .105, .045))
    trouser = _material("umber trousers", (.095, .061, .035))
    boot = _material("worn brown boots", (.19, .092, .043))

    # A tailored torso underlayer follows the waist and shoulder differently.
    _wrap("fitted torso", [(1.08, .205, .165, .15, .004),
                            (1.30, .225, .173, .16, .008),
                            (1.48, .295, .170, .157, .005),
                            (1.59, .270, .15, .14, .004)], purple,
          start=0, end=math.tau, segments=48)
    tunic = _surface("cream tunic open front", [
        [(-.11, .176, 1.63), (-.035, .197, 1.63), (.035, .197, 1.63), (.11, .176, 1.63)],
        [(-.125, .195, 1.43), (-.038, .214, 1.41), (.04, .214, 1.42), (.12, .194, 1.43)],
        [(-.115, .197, 1.12), (-.025, .216, 1.12), (.036, .216, 1.12), (.105, .197, 1.12)],
        [(-.125, .19, .81), (-.043, .204, .79), (.035, .204, .80), (.11, .19, .83)]
    ], cream)
    tunic.modifiers.new("linen thickness", "SOLIDIFY").thickness = .004

    # The skirt is an open wrap, with a broad exposed trouser/tunic split.
    hem = _wrap("asymmetric split robe", [(1.13, .215, .175, .15, .005),
                                          (.91, .26, .19, .17, .012),
                                          (.64, .32, .205, .19, .018),
                                          (.38, .37, .225, .205, .021),
                                          (.19, .395, .235, .215, .026)], purple,
                start=.38, end=math.tau - .44)
    for side, edge in (("right", 0), ("left", -1)):
        _pipe("split edge " + side, [row[edge] for row in hem], gold, .005)
    _pipe("uneven gold hem", hem[-1], gold, .006)
    for side in (-1, 1):
        _arm_sleeve(side, purple, gold)
        _leg(side, trouser, boot, leather)

    # One broad yoke joins the bodice and sleeves across both bare shoulders.
    yoke = _wrap("continuous shoulder yoke", [(1.74, .13, .11, .12, .003),
                                               (1.68, .32, .17, .17, .008),
                                               (1.54, .47, .20, .19, .012)], mantle,
                 start=0, end=math.tau, segments=48)
    _pipe("yoke shoulder edge", yoke[-1], gold, .004)
    collar = _wrap("draped raised collar", [(1.735, .13, .113, .12, .003),
                                            (1.79, .148, .125, .14, .006),
                                            (1.835, .164, .12, .15, .006)], shadow,
                   start=.27, end=math.tau - .27, segments=40)
    _pipe("collar lip", collar[-1], gold, .006)
    for side in (-1, 1):
        rows = [
            [(side * .10, .135, 1.65), (side * .23, .12, 1.69),
             (side * .35, .035, 1.62), (side * .39, -.07, 1.55)],
            [(side * .10, .21, 1.56), (side * .25, .19, 1.57),
             (side * .375, .095, 1.51), (side * .40, -.07, 1.49)],
            [(side * .12, .225, 1.48), (side * .27, .202, 1.47),
             (side * .385, .10, 1.44), (side * .39, -.06, 1.45)],
        ]
        mantle_panel = _surface("layered shoulder mantle " + str(side), rows, mantle,
                                reverse=side == -1)
        mantle_panel.modifiers.new("mantle cloth thickness", "SOLIDIFY").thickness = .006
        _pipe("shoulder piping " + str(side), rows[-1], gold, .005)
    _surface("draped scarf front", [
        [(-.29, .19, 1.69), (-.14, .22, 1.67), (0, .231, 1.65), (.14, .216, 1.67), (.29, .185, 1.70)],
        [(-.25, .215, 1.61), (-.12, .245, 1.58), (0, .256, 1.55), (.13, .238, 1.59), (.25, .20, 1.63)],
        [(-.20, .20, 1.54), (-.09, .237, 1.52), (0, .248, 1.50), (.11, .226, 1.53), (.20, .188, 1.56)],
    ], mantle)

    # Slim leather fittings sit over, rather than replacing, the cloth.
    belt = _wrap("waist belt", [(1.15, .217, .213, .18, .001),
                                (1.065, .22, .214, .18, .001)], leather,
                 start=0, end=math.tau, segments=32)
    _pipe("belt top stitching", belt[0], gold, .003)
    _pipe("belt buckle", [(-.045, .23, 1.145), (.045, .23, 1.145),
                         (.045, .23, 1.07), (-.045, .23, 1.07),
                         (-.045, .23, 1.145)], gold, .006)
    strap = _strap("diagonal satchel strap", [(.225, .174, 1.57),
                                                (.125, .224, 1.44),
                                                (.015, .243, 1.30),
                                                (-.12, .227, 1.14),
                                                (-.275, .105, .98)], .017, leather)
    _pipe("strap stitching", [row[0] for row in strap], gold, .0025)
    _surface("satchel leather body", [
        [(-.385, .118, 1.045), (-.32, .151, 1.06), (-.215, .12, 1.04)],
        [(-.398, .14, .95), (-.31, .17, .94), (-.205, .14, .955)],
        [(-.37, .115, .855), (-.31, .15, .85), (-.225, .115, .87)],
    ], leather)
    _pipe("satchel flap", [(-.38, .146, 1.015), (-.31, .18, .995),
                           (-.22, .146, 1.01)], gold, .004)

    if any(obj.data.as_pointer() != data or len(obj.data.vertices) != count
           for name, (data, count) in original_meshes.items()
           for obj in [bpy.data.objects[name]]):
        raise RuntimeError("Costume pass unexpectedly changed source meshes")
    owned = [obj for obj in bpy.data.objects if obj.name.startswith(PREFIX)]
    if not owned or any(not obj.name.startswith(PREFIX) for obj in owned):
        raise RuntimeError("Costume ownership guard failed")
    return {"objects": len(owned), "mesh_objects": sum(obj.type == "MESH" for obj in owned),
            "source_meshes_unchanged": len(original_meshes), "height_m": round(max(heights), 3),
            "status": "static_visual_study_only"}
