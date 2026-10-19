"""Restore the reviewed Step 1 hair in the open Step 2-based V75 study.

Only HAIR objects are replaced. The six source objects carry their original
meshes, materials, and scalp solidify modifier from the saved Step 1 scene.
"""

from pathlib import Path

import bpy


SCALP_NAME = "HAIR | continuous chestnut scalp"
SOURCE = Path(__file__).with_name("wayfarer_v3_step1_head.blend")
STEP1_HAIR = (
    SCALP_NAME,
    "HAIR | sweep left outer",
    "HAIR | sweep left inner",
    "HAIR | sweep center",
    "HAIR | sweep right inner",
    "HAIR | sweep right outer",
)


def apply_hair_v75():
    """Import the exact Step 1 hair objects, replacing only Step 2 hair."""
    old_hair = tuple(obj for obj in bpy.data.objects
                     if obj.name.startswith("HAIR |"))
    old_scalp = bpy.data.objects.get("HAIR | continuous scalp and nape")
    if (len(old_hair) != 13 or old_scalp is None
            or old_scalp.type != "MESH" or len(old_scalp.data.polygons) < 300
            or any(obj.type != "MESH" for obj in old_hair)):
        raise RuntimeError("V75 requires the 13 Step 2 HAIR meshes")
    if not SOURCE.is_file():
        raise FileNotFoundError(SOURCE)

    with bpy.data.libraries.load(str(SOURCE), link=False) as (source, loaded):
        if not set(STEP1_HAIR).issubset(source.objects):
            raise RuntimeError("Step 1 source is missing reviewed HAIR objects")
        loaded.objects = list(STEP1_HAIR)
    imported = tuple(loaded.objects)
    if (len(imported) != len(STEP1_HAIR)
            or any(obj is None or obj.type != "MESH" or not obj.data.polygons
                   or not obj.material_slots or obj.material_slots[0].material is None
                   for obj in imported)):
        raise RuntimeError("Step 1 HAIR import is incomplete")

    for obj in old_hair:
        bpy.data.objects.remove(obj, do_unlink=True)
    for name, obj in zip(STEP1_HAIR, imported):
        obj.name = name
        if bpy.context.scene.collection not in obj.users_collection:
            bpy.context.scene.collection.objects.link(obj)
    if bpy.data.objects.get(SCALP_NAME) is not imported[0]:
        raise RuntimeError("Step 1 scalp was not restored")
    return {"covered_scalp": SCALP_NAME, "old_plates_removed": len(old_hair) - 1,
            "swept_meshes": len(imported) - 1, "hair_meshes": len(imported)}
