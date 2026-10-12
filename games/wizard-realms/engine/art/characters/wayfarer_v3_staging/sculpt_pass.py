"""Local Step 3 face shaping on the editable V73 anatomical head.

This is a static study, not a likeness approval or a rig-ready character.
The existing face topology, eyes, and UVs remain intact.
"""

import bpy
from mathutils import Vector


def _ramp(value, low, high):
    t = max(0.0, min(1.0, (value - low) / (high - low)))
    return t * t * (3.0 - 2.0 * t)


def _patch(value, start, rise, fall, end):
    """Bound a hand-placed sculpt region without a whole-head falloff."""
    return _ramp(value, start, rise) * (1.0 - _ramp(value, fall, end))


def _shape_face(face):
    world = face.matrix_world.copy()
    inverse = world.inverted()
    edited = 0
    for vertex in face.data.vertices:
        point = world @ vertex.co
        if point.z < 1.835 or point.z > 2.13 or point.y < 0.035:
            continue
        side = -1 if point.x < 0 else 1
        x = abs(point.x)
        front = _ramp(point.y, 0.035, 0.105)

        # Define the adult zygomatic ridge and recess beneath it. The two
        # disjoint regions create an actual cheek plane, not a swollen sphere.
        cheek = (_patch(point.z, 1.945, 1.965, 1.996, 2.017)
                 * _patch(x, 0.058, 0.078, 0.122, 0.15) * front)
        hollow = (_patch(point.z, 1.899, 1.916, 1.941, 1.960)
                  * _patch(x, 0.073, 0.091, 0.126, 0.151) * front)
        point.y += 0.007 * cheek - 0.006 * hollow
        point.x += side * (0.003 * cheek - 0.002 * hollow)

        # Carry the cheek into a firmer jaw angle and a projected, less
        # rounded chin. Avoid the eye and ear loops entirely.
        jaw = (_patch(point.z, 1.854, 1.878, 1.917, 1.944)
               * _patch(x, 0.064, 0.082, 0.132, 0.153) * front)
        chin = (_patch(point.z, 1.842, 1.863, 1.881, 1.905)
                * (1.0 - _ramp(x, 0.050, 0.085)) * front)
        point.x += side * 0.005 * jaw
        point.y += 0.003 * jaw + 0.007 * chin

        # Refine the broad Step 2 nasal wings while preserving the original
        # continuous bridge, nostrils, and lip topology.
        nose_wing = (_patch(point.z, 1.979, 1.991, 2.024, 2.042)
                     * _patch(x, 0.034, 0.046, 0.070, 0.087)
                     * _ramp(point.y, 0.108, 0.153))
        tip = (_patch(point.z, 1.986, 1.998, 2.020, 2.039)
               * (1.0 - _ramp(x, 0.019, 0.045))
               * _ramp(point.y, 0.142, 0.181))
        point.x -= side * 0.006 * nose_wing
        point.y -= 0.004 * tip

        # Open the upper lid a few millimeters and lift only the lip corners.
        # The broader sclera and eyebrow edits remain untouched.
        upper_lid = (_patch(point.z, 2.057, 2.066, 2.079, 2.091)
                     * _patch(x, 0.024, 0.037, 0.075, 0.095) * front)
        corner = (_patch(point.z, 1.900, 1.910, 1.928, 1.940)
                  * _patch(x, 0.044, 0.053, 0.067, 0.078) * front)
        point.z += 0.004 * upper_lid + 0.0025 * corner

        vertex.co = inverse @ point
        edited += 1
    face.data.update()
    return edited


def _relax_brows(face):
    inverse = face.matrix_world.inverted()
    ray = (inverse.to_3x3() @ Vector((0, -1, 0))).normalized()
    brows = [obj for obj in bpy.data.objects
             if obj.name.startswith("FACE | anchored eyebrow")]
    if len(brows) != 2 or any(obj.type != "MESH" or len(obj.data.vertices) != 18
                             for obj in brows):
        raise RuntimeError("Expected two editable Step 2 eyebrow strips")
    for brow in brows:
        brow_inverse = brow.matrix_world.inverted()
        for index, vertex in enumerate(brow.data.vertices):
            t = (index // 2) / 8.0
            point = brow.matrix_world @ vertex.co
            arch = 1.0 - (2.0 * t - 1.0) ** 2
            width = 0.0015 + 0.0043 * arch
            # Higher inner brow and softer arch remove the scowling V of V73.
            point.z = 2.130 - 0.006 * t + 0.003 * arch
            point.z += width if index % 2 else -width
            hit, local, _, _ = face.ray_cast(
                inverse @ Vector((point.x, 1.0, point.z)), ray)
            if hit:
                point.y = (face.matrix_world @ local).y + 0.0025
            vertex.co = brow_inverse @ point
        brow.data.update()
    return len(brows)


def apply_sculpt_pass():
    """Mutate only the V73 scene's existing face and brow, exactly once."""
    scene = bpy.context.scene
    if scene.get("wayfarer_stage") != "v73_static_head_study_unreviewed":
        raise RuntimeError("Open the saved Step 2 head study before V74 sculpt")
    if scene.get("wayfarer_sculpt_pass"):
        raise RuntimeError("The V74 sculpt pass was already applied")
    face = bpy.data.objects.get("GEO-body_male_stylized")
    if face is None or face.type != "MESH" or len(face.data.vertices) < 10000:
        raise RuntimeError("Expected continuous CC0 anatomical mesh is absent")
    edited = _shape_face(face)
    bpy.context.view_layer.update()
    brow_count = _relax_brows(face)
    skin = face.active_material
    if skin and skin.use_nodes:
        shader = skin.node_tree.nodes.get("Principled BSDF")
        if shader:
            shader.inputs["Roughness"].default_value = 0.70
    scene["wayfarer_sculpt_pass"] = "v74_static_study_unreviewed"
    return {"face_vertices": len(face.data.vertices), "edited_vertices": edited,
            "brow_meshes": brow_count, "status": "static_study_unreviewed"}
