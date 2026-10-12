"""Reference-directed V75 face study on the saved Step 2 CC0 head.

Call ``apply_face_v75()`` once after opening ``wayfarer_v3_step2_head.blend``.
This changes existing vertices and eyebrow material only; it does not add
facial primitives, alter UVs, or claim a finished likeness.
"""

import bpy
from mathutils import Vector


# World-space landmarks aligned to the existing Step 2 facial loop positions.
# The jaw profile gives the lower face an adult angle instead of a round cheek.
JAW_X_OFFSETS = (
    (1.842, 0.014), (1.872, 0.018), (1.900, 0.015),
    (1.930, -0.012), (1.965, -0.007), (1.994, 0.006),
)


def _ease(value, start, end):
    t = max(0.0, min(1.0, (value - start) / (end - start)))
    return t * t * (3.0 - 2.0 * t)


def _region(value, outer_low, inner_low, inner_high, outer_high):
    return (_ease(value, outer_low, inner_low)
            * (1.0 - _ease(value, inner_high, outer_high)))


def _jaw_offset(height):
    for (z0, offset0), (z1, offset1) in zip(JAW_X_OFFSETS, JAW_X_OFFSETS[1:]):
        if z0 <= height <= z1:
            return offset0 + (offset1 - offset0) * ((height - z0) / (z1 - z0))
    return 0.0


def _shape_anatomy(face):
    world = face.matrix_world.copy()
    inverse = world.inverted()
    edited = 0
    for vertex in face.data.vertices:
        point = world @ vertex.co
        if not 1.84 <= point.z <= 2.10 or point.y < 0.045:
            continue
        original = point.copy()
        side = -1 if point.x < 0 else 1
        x = abs(point.x)
        front = _ease(point.y, 0.045, 0.110)

        jaw = (_region(point.z, 1.842, 1.856, 1.978, 1.994)
               * _region(x, 0.047, 0.071, 0.128, 0.153) * front)
        point.x += side * _jaw_offset(point.z) * jaw
        # Project the lower chin and carve a shallow plane under the cheekbone.
        chin = (_region(point.z, 1.843, 1.860, 1.888, 1.911)
                * (1.0 - _ease(x, 0.046, 0.085)) * front)
        cheek_recess = (_region(point.z, 1.899, 1.920, 1.940, 1.960)
                        * _region(x, 0.073, 0.089, 0.128, 0.150) * front)
        cheek_ridge = (_region(point.z, 1.958, 1.971, 1.993, 2.015)
                       * _region(x, 0.064, 0.083, 0.119, 0.142) * front)
        point.y += 0.016 * chin - 0.012 * cheek_recess + 0.006 * cheek_ridge

        # Contract the existing nose wings, keeping the bridge and nostril
        # loops connected. The tip recedes slightly in side view.
        nose = (_region(point.z, 1.971, 1.986, 2.029, 2.049)
                * _region(x, 0.017, 0.030, 0.081, 0.100)
                * _ease(point.y, 0.085, 0.138))
        point.x *= 1.0 - 0.32 * nose
        nose_tip = (_region(point.z, 1.988, 2.000, 2.020, 2.036)
                    * (1.0 - _ease(x, 0.019, 0.047))
                    * _ease(point.y, 0.140, 0.180))
        point.y -= 0.010 * nose_tip

        # Expose more of the already seated eye globes without moving them.
        upper_lid = (_region(point.z, 2.051, 2.063, 2.080, 2.093)
                     * _region(x, 0.023, 0.036, 0.079, 0.099) * front)
        point.z += 0.014 * upper_lid
        lower_lid = (_region(point.z, 2.009, 2.019, 2.032, 2.044)
                     * _region(x, 0.024, 0.037, 0.078, 0.098) * front)
        point.z -= 0.004 * lower_lid

        # A neutral mouth has nearly level corners, not the Step 2 frown.
        corner = (_region(point.z, 1.901, 1.912, 1.931, 1.943)
                  * _region(x, 0.043, 0.052, 0.068, 0.080) * front)
        point.z += 0.010 * corner
        if (point - original).length > 0.000001:
            vertex.co = inverse @ point
            edited += 1
    face.data.update()
    return edited


def _seat_brows(face, brows):
    inverse = face.matrix_world.inverted()
    ray = (inverse.to_3x3() @ Vector((0, -1, 0))).normalized()
    seated = 0
    for brow in brows:
        brow_inverse = brow.matrix_world.inverted()
        for index, vertex in enumerate(brow.data.vertices):
            t = (index // 2) / 8.0
            arch = 1.0 - (2.0 * t - 1.0) ** 2
            width = 0.0015 + 0.0040 * arch
            point = brow.matrix_world @ vertex.co
            point.z = 2.106 - 0.003 * t + 0.004 * arch
            point.z += width if index % 2 else -width
            hit, local, _, _ = face.ray_cast(
                inverse @ Vector((point.x, 1.0, point.z)), ray)
            if not hit:
                raise RuntimeError(f"Cannot seat eyebrow at x={point.x:.3f}, z={point.z:.3f}")
            point.y = (face.matrix_world @ local).y + 0.0025
            vertex.co = brow_inverse @ point
            seated += 1
        brow.data.update()
        material = brow.active_material
        shader = material.node_tree.nodes.get("Principled BSDF") if material and material.use_nodes else None
        if shader:
            shader.inputs["Base Color"].default_value = (0.120, 0.066, 0.037, 1)
    return seated


def apply_face_v75():
    """Return counts for the guarded, unreviewed static face pass."""
    scene = bpy.context.scene
    if scene.get("wayfarer_stage") != "v73_static_head_study_unreviewed":
        raise RuntimeError("V75 face requires the saved Step 2 scene")
    if scene.get("wayfarer_face_v75"):
        raise RuntimeError("V75 face was already applied to this scene")
    face = bpy.data.objects.get("GEO-body_male_stylized")
    brows = [obj for obj in bpy.data.objects
             if obj.name.startswith("FACE | anchored eyebrow")]
    if face is None or face.type != "MESH" or len(face.data.vertices) < 10000:
        raise RuntimeError("Expected continuous CC0 head mesh is absent")
    if len(brows) != 2 or any(obj.type != "MESH" or len(obj.data.vertices) != 18
                             for obj in brows):
        raise RuntimeError("Expected two editable Step 2 eyebrow strips")
    edited = _shape_anatomy(face)
    bpy.context.view_layer.update()
    seated = _seat_brows(face, brows)
    scene["wayfarer_face_v75"] = "static_study_unreviewed"
    return {"anatomy_vertices": len(face.data.vertices),
            "edited_vertices": edited, "brow_vertices_seated": seated,
            "status": "static_study_unreviewed"}
