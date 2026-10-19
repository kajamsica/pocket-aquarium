"""Render cumulative V75 face, hair, and costume visual checkpoints."""

from hashlib import sha256
from pathlib import Path
import sys

import bpy


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from author_step1 import point_at, render
from costume_v75 import apply_costume_v75
from face_v75 import apply_face_v75
from hair_v75 import SCALP_NAME, apply_hair_v75


def _body_height():
    body = bpy.data.objects["GEO-body_male_stylized"]
    heights = [(body.matrix_world @ vertex.co).z for vertex in body.data.vertices]
    assert abs(min(heights)) < 0.001 and abs(max(heights) - 2.257) < 0.001
    return max(heights) - min(heights)


def _render_view(scene, camera, filename, location, aim, scale):
    render(scene, camera, filename, location, aim, scale)
    path = HERE / filename
    assert path.is_file() and path.stat().st_size > 0
    print(f"V75_RENDER {filename} bytes={path.stat().st_size}", flush=True)
    return path


def main():
    source = HERE / "wayfarer_v3_step2_head.blend"
    output = HERE / "wayfarer_v4_visual_study.blend"
    source_hash = sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    assert scene.get("wayfarer_stage") == "v73_static_head_study_unreviewed"
    _body_height()
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.eevee.taa_render_samples = 16
    camera = scene.camera

    face_result = apply_face_v75()
    head_views = (("front", (0, 4.2, 2.17)),
                  ("three_quarter", (2.2, 3.9, 2.15)))
    for index, (name, location) in enumerate(head_views):
        path = _render_view(scene, camera, f"v75_face_{name}.png",
                            location, (0, 0, 2.075), 0.78)
        if index == 0:
            print(f"V75_SURFACE_READY first_comparison={path} "
                  f"source_sha256={source_hash}", flush=True)

    hair_result = apply_hair_v75()
    assert bpy.data.objects.get(SCALP_NAME) is not None
    for name, location in head_views:
        _render_view(scene, camera, f"v75_hair_{name}.png",
                     location, (0, 0, 2.075), 0.78)

    costume_result = apply_costume_v75()
    scene["wayfarer_stage"] = "v75_static_visual_study_unreviewed"
    scene["source_blend"] = source.name
    scene["source_sha256"] = source_hash
    scene["coordinate_contract"] = "+Z up, +Y forward, floor Z=0, body height 2.257m"
    camera.location = (2.2, 3.9, 1.2)
    point_at(camera, (0, 0, 1.15))
    camera.data.ortho_scale = 2.8
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    bpy.ops.wm.open_mainfile(filepath=str(output))
    scene = bpy.context.scene
    camera = scene.camera
    assert scene["wayfarer_stage"] == "v75_static_visual_study_unreviewed"
    assert scene["source_sha256"] == source_hash
    assert bpy.data.objects.get(SCALP_NAME) is not None
    assert any(obj.name.startswith("COSTUME | ") for obj in bpy.data.objects)
    height = _body_height()
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"
              and not obj.name.startswith("STUDIO |")]
    faces = sum(len(obj.data.polygons) for obj in meshes)
    triangles = sum(sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
                    for obj in meshes)
    print(f"V75_SOURCE blender={bpy.app.version_string} "
          f"source_sha256={source_hash} face={face_result} hair={hair_result} "
          f"costume={costume_result} meshes={len(meshes)} faces={faces} "
          f"triangles={triangles} body_height={height:.6f} "
          f"reopened={output.exists()}", flush=True)

    outfit_views = (("front", (0, 4.2, 1.2)),
                    ("three_quarter", (2.2, 3.9, 1.2)),
                    ("side", (4.2, 0, 1.2)),
                    ("back", (0, -4.2, 1.2)))
    for name, location in outfit_views:
        _render_view(scene, camera, f"v75_outfit_{name}.png",
                     location, (0, 0, 1.15), 2.8)
    print(f"V75_REOPEN editable_source={output} passed=True", flush=True)


if __name__ == "__main__":
    main()
