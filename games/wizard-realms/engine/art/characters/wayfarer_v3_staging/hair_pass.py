"""Layered chestnut hair for the already-open Wayfarer step1 head study.

This pass owns only objects whose names begin with ``HAIR |``. The broad,
flattened forms are editable meshes; no curves, particles, or texture cards
are needed to keep the scalp covered from all four turnaround views.
"""

import math

import bpy
from mathutils import Vector


def _material(name, color):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = 0.78
    return mat


def _mesh(name, vertices, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for face in mesh.polygons:
        face.use_smooth = True
    return obj


def _scalp(mat):
    """Irregular full scalp shell with a lower nape and broken front hairline."""
    sides = 64
    rings = ((1.00, 0.00), (1.04, 0.22), (0.98, 0.48),
             (0.83, 0.72), (0.58, 0.91), (0.28, 1.02), (0.06, 1.06))
    vertices = []
    faces = []
    for radius, height in rings:
        for i in range(sides):
            theta = 2 * math.pi * i / sides
            front = math.cos(theta)
            hairline = (2.044 + 0.091 * max(0, front) ** 2
                        - 0.052 * max(0, -front)
                        + 0.012 * math.sin(3 * theta + 0.5)
                        + 0.006 * math.sin(7 * theta - 0.7))
            # The variation diminishes toward the crown so it stays rounded.
            z = hairline * (1 - height) + 2.273 * height
            flow = 1 + 0.035 * math.sin(5 * theta + 2 * height)
            rear_radius = 0.173 + 0.035 * max(0, -front)
            vertices.append((0.181 * radius * flow * math.sin(theta),
                             -0.010 + rear_radius * radius * flow * front,
                             z))
    for ring in range(len(rings) - 1):
        for i in range(sides):
            j = (i + 1) % sides
            a = ring * sides + i
            b = ring * sides + j
            faces.append((a, a + sides, b + sides, b))
    faces.append(tuple((len(rings) - 1) * sides + i for i in reversed(range(sides))))
    obj = _mesh("HAIR | continuous scalp and nape", vertices, faces, mat)
    solid = obj.modifiers.new("scalp thickness", "SOLIDIFY")
    solid.thickness = 0.008


def _bezier(points, t):
    a, b, c, d = (Vector(point) for point in points)
    u = 1 - t
    return a * u**3 + b * (3 * u*u*t) + c * (3 * u*t*t) + d * t**3


def _layer(name, points, half_width, lift, mat):
    """A closed, flattened sculpted leaf with a broad convex upper surface."""
    segments = 24
    across_steps = 6
    vertices = []
    top_rows = []
    bottom_rows = []
    for step in range(segments + 1):
        t = step / segments
        center = _bezier(points, t)
        tangent = (_bezier(points, min(1, t + 0.01)) -
                   _bezier(points, max(0, t - 0.01))).normalized()
        outward = Vector((center.x / 0.181, (center.y + 0.010) / 0.173,
                          (center.z - 2.09) / 0.19)).normalized()
        across = tangent.cross(outward).normalized()
        width = half_width * (0.40 + 0.60 * math.sin(math.pi * t) ** 0.7)
        width *= 1 - 0.55 * t**4
        top = []
        bottom = []
        for column in range(across_steps + 1):
            u = 2 * column / across_steps - 1
            base = center + across * (u * width)
            crown = max(0, 1 - u*u) ** 0.7
            top.append(len(vertices))
            vertices.append(tuple(base + outward * (0.003 + lift * crown)))
            bottom.append(len(vertices))
            vertices.append(tuple(base - outward * 0.005))
        top_rows.append(top)
        bottom_rows.append(bottom)
    faces = []
    for step in range(segments):
        for column in range(across_steps):
            faces.append((top_rows[step][column], top_rows[step][column + 1],
                          top_rows[step + 1][column + 1], top_rows[step + 1][column]))
            faces.append((bottom_rows[step][column + 1], bottom_rows[step][column],
                          bottom_rows[step + 1][column], bottom_rows[step + 1][column + 1]))
        faces.append((top_rows[step][0], top_rows[step + 1][0],
                      bottom_rows[step + 1][0], bottom_rows[step][0]))
        faces.append((top_rows[step][across_steps], bottom_rows[step][across_steps],
                      bottom_rows[step + 1][across_steps], top_rows[step + 1][across_steps]))
    for step in (0, segments):
        for column in range(across_steps):
            if step == 0:
                faces.append((top_rows[step][column], bottom_rows[step][column],
                              bottom_rows[step][column + 1], top_rows[step][column + 1]))
            else:
                faces.append((top_rows[step][column], top_rows[step][column + 1],
                              bottom_rows[step][column + 1], bottom_rows[step][column]))
    _mesh("HAIR | " + name, vertices, faces, mat)


def apply_hair_pass():
    """Replace the step1 HAIR study in the open Blender scene, without rendering."""
    for obj in tuple(bpy.data.objects):
        if obj.name.startswith("HAIR |"):
            bpy.data.objects.remove(obj, do_unlink=True)

    root = _material("HAIR | deep chestnut root", (0.046, 0.023, 0.012))
    main = _material("HAIR | chestnut main", (0.079, 0.040, 0.020))
    warm = _material("HAIR | chestnut warm", (0.091, 0.047, 0.025))
    _scalp(root)

    # Unequal large sections cross the front hairline. Their buried roots and
    # overlapping broad ends avoid the row of separate pointed step1 locks.
    layers = (
        ("swept fringe left", ((-0.120, -0.085, 2.247), (-0.190, 0.010, 2.298),
                                (-0.115, 0.171, 2.237), (-0.018, 0.173, 2.147)),
         0.055, 0.013, main),
        ("swept fringe crest", ((-0.040, -0.115, 2.263), (-0.105, 0.009, 2.307),
                                 (0.034, 0.176, 2.252), (0.106, 0.174, 2.149)),
         0.073, 0.018, warm),
        ("swept fringe outer", ((0.045, -0.105, 2.252), (0.092, 0.013, 2.305),
                                 (0.175, 0.116, 2.241), (0.164, 0.137, 2.112)),
         0.049, 0.012, main),
        ("left temple sweep", ((-0.145, -0.067, 2.230), (-0.201, -0.005, 2.226),
                                 (-0.195, 0.081, 2.126), (-0.157, 0.067, 2.061)),
         0.043, 0.010, warm),
        ("right temple sweep", ((0.127, -0.054, 2.246), (0.192, -0.012, 2.233),
                                  (0.194, 0.071, 2.139), (0.158, 0.060, 2.046)),
         0.047, 0.011, main),
        ("left side layer", ((-0.131, -0.114, 2.211), (-0.207, -0.114, 2.169),
                              (-0.208, -0.053, 2.084), (-0.165, -0.029, 2.024)),
         0.044, 0.010, main),
        ("right side layer", ((0.124, -0.127, 2.224), (0.209, -0.112, 2.162),
                               (0.208, -0.047, 2.078), (0.159, -0.037, 2.016)),
         0.040, 0.010, warm),
        ("back left high", ((-0.092, -0.090, 2.261), (-0.179, -0.145, 2.245),
                             (-0.174, -0.187, 2.145), (-0.106, -0.185, 2.061)),
         0.062, 0.013, warm),
        ("back center high", ((0.022, -0.100, 2.275), (-0.055, -0.190, 2.278),
                               (-0.072, -0.205, 2.139), (0.010, -0.189, 2.052)),
         0.071, 0.016, main),
        ("back right high", ((0.112, -0.081, 2.258), (0.172, -0.153, 2.231),
                              (0.159, -0.196, 2.142), (0.091, -0.180, 2.035)),
         0.059, 0.012, warm),
        ("left nape", ((-0.107, -0.158, 2.126), (-0.126, -0.192, 2.080),
                        (-0.092, -0.190, 2.015), (-0.051, -0.156, 1.976)),
         0.050, 0.009, main),
        ("right nape", ((0.076, -0.169, 2.127), (0.124, -0.202, 2.081),
                         (0.108, -0.182, 2.015), (0.043, -0.157, 1.980)),
         0.052, 0.010, main),
    )
    for name, points, width, lift, mat in layers:
        _layer(name, points, width, lift, mat)
