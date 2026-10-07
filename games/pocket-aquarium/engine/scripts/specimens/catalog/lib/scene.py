"""Scene housekeeping and bounds helpers."""

from __future__ import annotations

import bpy
from mathutils import Vector


def clear_scene() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials,
        bpy.data.actions, bpy.data.images, bpy.data.cameras, bpy.data.lights, bpy.data.shape_keys,
    ):
        for datablock in list(datablocks):
            try:
                datablocks.remove(datablock)
            except Exception:  # shape keys are owned by meshes and vanish with them
                pass


def mesh_objects(rig=None):
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and (rig is None or obj.parent == rig)]


def evaluated_world_vertices(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=False, depsgraph=depsgraph)
    matrix = evaluated.matrix_world
    vertices = [matrix @ vertex.co for vertex in mesh.vertices]
    evaluated.to_mesh_clear()
    return vertices


def scene_bounds(objects):
    low = Vector((1e9, 1e9, 1e9))
    high = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        for vertex in evaluated_world_vertices(obj):
            low.x = min(low.x, vertex.x)
            low.y = min(low.y, vertex.y)
            low.z = min(low.z, vertex.z)
            high.x = max(high.x, vertex.x)
            high.y = max(high.y, vertex.y)
            high.z = max(high.z, vertex.z)
    return low, high
