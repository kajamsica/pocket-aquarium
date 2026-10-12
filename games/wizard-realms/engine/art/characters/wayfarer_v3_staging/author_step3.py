"""Compose the V74 face and hair source passes as a static head study."""

from pathlib import Path
import sys

import bpy


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from author_step1 import point_at, render
from hair_sculpt_pass import apply_hair_sculpt_pass
from sculpt_pass import apply_sculpt_pass


def main():
    source = HERE / "wayfarer_v3_step2_head.blend"
    output = HERE / "wayfarer_v3_step3_head.blend"
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    face_result = apply_sculpt_pass()
    source_hair = {obj.name: obj.data.name for obj in bpy.data.objects
                   if obj.name.startswith("HAIR |") and obj.type == "MESH"}
    assert len(source_hair) == 13
    apply_hair_sculpt_pass()

    body = bpy.data.objects["GEO-body_male_stylized"]
    heights = [(body.matrix_world @ vertex.co).z for vertex in body.data.vertices]
    assert abs(min(heights)) < 0.001 and abs(max(heights) - 2.257) < 0.001
    hair = [obj for obj in bpy.data.objects if obj.name.startswith("HAIR |")]
    assert all(obj.type == "MESH" for obj in hair)
    assert {obj.name: obj.data.name for obj in hair} == source_hair
    scene["wayfarer_stage"] = "v74_static_head_study_unreviewed"
    scene["coordinate_contract"] = "+Z up, +Y forward, floor Z=0, body height 2.257m"
    scene["source_blend"] = source.name
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.eevee.taa_render_samples = 16
    camera = scene.camera
    camera.location = (2.2, 3.9, 2.15)
    point_at(camera, (0, 0, 2.075))
    camera.data.ortho_scale = 0.78
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output))

    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"
              and not obj.name.startswith("STUDIO |")]
    faces = sum(len(obj.data.polygons) for obj in meshes)
    triangles = sum(sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
                    for obj in meshes)
    print(f"V74_SOURCE blender={bpy.app.version_string} face={face_result} "
          f"hair_meshes={len(hair)} meshes={len(meshes)} faces={faces} "
          f"triangles={triangles} body_height={max(heights)-min(heights):.6f} "
          f"editable={output.exists()}", flush=True)

    views = (
        ("front", (0, 4.2, 2.17)),
        ("three_quarter", (2.2, 3.9, 2.15)),
        ("side", (4.2, 0, 2.17)),
        ("back", (0, -4.2, 2.17)),
    )
    for name, location in views:
        filename = f"step3_{name}.png"
        render(scene, camera, filename, location, (0, 0, 2.075), 0.78)
        path = HERE / filename
        assert path.is_file() and path.stat().st_size > 0
        print(f"V74_RENDER {name} {path} bytes={path.stat().st_size}", flush=True)

    bpy.ops.wm.open_mainfile(filepath=str(output))
    assert bpy.context.scene["wayfarer_stage"] == "v74_static_head_study_unreviewed"
    assert {obj.name: obj.data.name for obj in bpy.data.objects
            if obj.name.startswith("HAIR |") and obj.type == "MESH"} == source_hair
    print(f"V74_REOPEN editable_source={output} passed=True", flush=True)


if __name__ == "__main__":
    main()
