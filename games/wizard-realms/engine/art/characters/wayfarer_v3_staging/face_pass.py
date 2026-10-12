"""Bounded V73 expression study on the existing CC0 anatomical head.

Import after opening ``wayfarer_v3_step1_head.blend``. This changes the source
head and eye vertices in place. It does not create facial feature primitives,
alter UV topology, touch hair, rig the model, or claim concept-sheet fidelity.
"""

import math

import bpy
from mathutils import Vector


def _bell(distance, radius):
    return math.exp(-0.5 * (distance / radius) ** 2)


def _front_weight(y):
    return max(0.0, min(1.0, (y - 0.038) / 0.078))


def _sculpt_anatomy(face):
    world = face.matrix_world.copy()
    inverse = world.inverted()
    for vertex in face.data.vertices:
        point = world @ vertex.co
        if not 1.78 <= point.z <= 2.16:
            continue
        side = -1 if point.x < 0 else 1
        axial = abs(point.x)
        frontal = _front_weight(point.y)

        # The base already has useful eyelid loops. Compress their width and
        # lower the upper ridge without cutting new geometry into the socket.
        eye = (_bell(axial - 0.051, 0.052)
               * _bell(point.z - 2.052, 0.046) * frontal)
        point.x = side * (0.051 + (axial - 0.051) * (1 - 0.12 * eye))
        upper = (_bell(axial - 0.051, 0.048)
                 * _bell(point.z - 2.079, 0.018) * frontal)
        lower = (_bell(axial - 0.051, 0.046)
                 * _bell(point.z - 2.019, 0.016) * frontal)
        point.z += -0.014 * upper + 0.006 * lower

        # A subtle supraorbital plane and cheekbone replace the round, blank
        # expression without adding separate cheek or nose objects.
        brow_plane = (_bell(axial - 0.063, 0.057)
                      * _bell(point.z - 2.112, 0.022) * frontal)
        cheek = (_bell(axial - 0.112, 0.048)
                 * _bell(point.z - 1.972, 0.045) * frontal)
        hollow = (_bell(axial - 0.111, 0.045)
                  * _bell(point.z - 1.914, 0.036) * frontal)
        jaw = (_bell(axial - 0.091, 0.046)
               * _bell(point.z - 1.874, 0.049) * frontal)
        point.y += 0.004 * brow_plane + 0.006 * cheek - 0.004 * hollow
        point.x += side * (0.003 * cheek + 0.008 * jaw)

        # Lift the mouth corners only a few millimeters for a restrained,
        # confident neutral expression. Existing lip loops remain intact.
        corner = (_bell(axial - 0.058, 0.021)
                  * _bell(point.z - 1.905, 0.019) * frontal)
        point.z += 0.003 * corner
        vertex.co = inverse @ point
    face.data.update()


def _narrow_eye_globes():
    for eye in (ob for ob in bpy.data.objects if ob.type == "MESH"
                and ".eye." in ob.name):
        world = eye.matrix_world.copy()
        inverse = world.inverted()
        center = sum((world @ v.co for v in eye.data.vertices), Vector()) / len(eye.data.vertices)
        for vertex in eye.data.vertices:
            point = world @ vertex.co
            point.x = center.x + 0.84 * (point.x - center.x)
            point.z = center.z + 0.74 * (point.z - center.z)
            point.y -= 0.008
            vertex.co = inverse @ point
        eye.data.update()
    for ob in bpy.data.objects:
        if ob.name.startswith("EYE | iris") or ob.name.startswith("EYE | pupil"):
            ob.scale.x *= 0.84
            ob.location.y -= 0.008


def _seat_existing_brows(face):
    inverse = face.matrix_world.inverted()
    ray = (inverse.to_3x3() @ Vector((0, -1, 0))).normalized()
    for brow in (ob for ob in bpy.data.objects if ob.name.startswith("FACE | anchored eyebrow")):
        if brow.type != "MESH" or len(brow.data.vertices) != 18:
            continue
        for i, vertex in enumerate(brow.data.vertices):
            t = (i // 2) / 8
            point = brow.matrix_world @ vertex.co
            # Keep the brow firm without pinching the inner ends into a scowl.
            width = 0.0015 + 0.006 * math.sin(math.pi * t) ** 0.7
            point.z = 2.116 + 0.004 * t + 0.005 * math.sin(math.pi * t)
            point.z += width if i % 2 else -width
            hit, local, _, _ = face.ray_cast(inverse @ Vector((point.x, 1, point.z)), ray)
            if hit:
                point.y = (face.matrix_world @ local).y + 0.0025
            vertex.co = brow.matrix_world.inverted() @ point
        brow.data.update()


def apply_face_pass():
    """Mutate the open step-1 scene once; return a small proof summary."""
    scene = bpy.context.scene
    if scene.get("wayfarer_face_pass"):
        raise RuntimeError("The V73 face pass was already applied to this scene")
    face = bpy.data.objects.get("GEO-body_male_stylized")
    if face is None or face.type != "MESH" or len(face.data.vertices) < 10000:
        raise RuntimeError("Expected staged CC0 male anatomical mesh is absent")
    _sculpt_anatomy(face)
    _narrow_eye_globes()
    bpy.context.view_layer.update()
    _seat_existing_brows(face)
    scene["wayfarer_face_pass"] = "v73_static_study"
    return {"face_vertices": len(face.data.vertices),
            "eye_meshes": 2, "status": "static_study_unreviewed"}
