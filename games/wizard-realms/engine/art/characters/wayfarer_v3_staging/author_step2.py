"""Compose the V73 face and hair passes as an unreviewed static head study."""

from pathlib import Path
import sys

import bpy


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from author_step1 import point_at, render
from face_pass import apply_face_pass
from hair_pass import apply_hair_pass


def main():
    bpy.ops.wm.open_mainfile(filepath=str(HERE / "wayfarer_v3_step1_head.blend"))
    scene = bpy.context.scene
    face_result = apply_face_pass()
    apply_hair_pass()

    body = bpy.data.objects["GEO-body_male_stylized"]
    heights = [(body.matrix_world @ vertex.co).z for vertex in body.data.vertices]
    assert abs(min(heights)) < 0.001 and abs(max(heights) - 2.257) < 0.001
    scene["wayfarer_stage"] = "v73_static_head_study_unreviewed"
    scene["coordinate_contract"] = "+Z up, +Y forward, floor Z=0, body height 2.257m"
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.eevee.taa_render_samples = 16
    camera = scene.camera
    camera.location = (2.2, 3.9, 2.15)
    point_at(camera, (0, 0, 2.075))
    camera.data.ortho_scale = 0.78
    scene.render.filepath = str(HERE / "step2_three_quarter.png")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "wayfarer_v3_step2_head.blend"))

    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"
              and not obj.name.startswith("STUDIO |")]
    faces = sum(len(obj.data.polygons) for obj in meshes)
    triangles = sum(sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
                    for obj in meshes)
    print(f"V73_SOURCE blender={bpy.app.version_string} face={face_result} "
          f"meshes={len(meshes)} faces={faces} triangles={triangles} "
          f"body_height={max(heights) - min(heights):.6f}", flush=True)

    views = (
        ("front", (0, 4.2, 2.17)),
        ("three_quarter", (2.2, 3.9, 2.15)),
        ("side", (4.2, 0, 2.17)),
        ("back", (0, -4.2, 2.17)),
    )
    for name, location in views:
        render(scene, camera, f"step2_{name}.png", location,
               (0, 0, 2.075), 0.78)
        print(f"V73_RENDER {name} {HERE / f'step2_{name}.png'}", flush=True)


if __name__ == "__main__":
    main()
