"""Neutral-background author preview and side/top/front contact sheet renders."""

from __future__ import annotations

import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

from .rigging import identity_pose
from .scene import scene_bounds
from .textures import write_image


def _studio(scene, background=(0.16, 0.17, 0.18), exposure=0.0):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.color = background
    scene.view_settings.look = "AgX - Base Contrast"
    scene.view_settings.exposure = exposure


def _add_lights(center: Vector, radius: float):
    lights = []
    for offset, energy, size, color in (
        ((0.6, -0.9, 1.3), 1.1, 0.30, (1.0, 0.96, 0.90)),
        ((-0.8, 1.0, 0.7), 0.7, 0.26, (0.70, 0.80, 1.0)),
        ((-0.8, -0.3, -0.2), 0.4, 0.22, (1.0, 0.70, 0.50)),
    ):
        scale = radius / 0.05
        bpy.ops.object.light_add(type="AREA", location=center + Vector(offset) * radius * 2.2)
        light = bpy.context.object
        light.name = f"PreviewLight_{len(lights)}"
        light.data.energy = energy * scale * scale
        light.data.shape = "DISK"
        light.data.size = size * scale
        light.data.color = color
        direction = center - light.location
        light.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        lights.append(light)
    return lights


def _camera(name: str, location: Vector, target: Vector, lens: float | None = None, ortho_scale: float | None = None):
    bpy.ops.object.camera_add(location=location)
    camera = bpy.context.object
    camera.name = name
    if ortho_scale is not None:
        camera.data.type = "ORTHO"
        camera.data.ortho_scale = ortho_scale
    else:
        camera.data.lens = lens or 62
    camera.data.clip_start = 0.001
    camera.data.clip_end = 100.0
    camera.rotation_euler = (target - location).to_track_quat("-Z", "Y").to_euler()
    return camera


def render_previews(rig, meshes, preview_path: Path, sheet_path: Path, action_name: str, frame: int = 10,
                    view_up: str = "+Z", preview_azimuth_degrees: float = -55.0, preview_elevation_degrees: float = 22.0):
    """Render the author preview (3/4 view during `action_name`) and a side|top|front sheet at rest."""
    scene = bpy.context.scene
    _studio(scene)
    identity_pose(rig)
    low, high = scene_bounds(meshes)
    center = (low + high) / 2
    extent = high - low
    radius = max(extent.length / 2, 0.005)
    lights = _add_lights(center, radius)

    preview_path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    azimuth = math.radians(preview_azimuth_degrees)
    elevation = math.radians(preview_elevation_degrees)
    distance = radius * 3.4
    location = center + Vector((math.cos(azimuth) * math.cos(elevation), math.sin(azimuth) * math.cos(elevation), math.sin(elevation))) * distance
    camera = _camera("AuthorPreviewCamera", location, center, lens=62)
    scene.camera = camera
    action = bpy.data.actions.get(action_name)
    if action:
        rig.animation_data_create()
        rig.animation_data.action = action
        scene.frame_set(frame)
    scene.render.filepath = str(preview_path)
    bpy.ops.render.render(write_still=True)
    if action:
        rig.animation_data.action = None
    identity_pose(rig)
    scene.frame_set(1)

    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    panels = []
    span = max(extent.x, extent.y, extent.z) * 1.18
    views = (
        ("side", Vector((0.0, -1.0, 0.0))),
        ("top", Vector((0.0, 0.0, 1.0))),
        ("front", Vector((1.0, 0.0, 0.0))),
    )
    for name, direction in views:
        view_camera = _camera(f"ThreeView_{name}", center + direction * radius * 4.0, center, ortho_scale=span)
        if name == "top":
            view_camera.rotation_euler = (0.0, 0.0, 0.0)
        scene.camera = view_camera
        panel_path = sheet_path.parent / f"three-view-{name}.png"
        scene.render.filepath = str(panel_path)
        bpy.ops.render.render(write_still=True)
        panels.append(panel_path)
        bpy.data.objects.remove(view_camera, do_unlink=True)
    sheet = []
    for panel_path in panels:
        image = bpy.data.images.load(str(panel_path))
        pixels = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        sheet.append(pixels.reshape(image.size[1], image.size[0], 4))
        bpy.data.images.remove(image)
        panel_path.unlink()
    divider = np.ones((640, 4, 4), dtype=np.float32) * np.array((0.55, 0.56, 0.57, 1.0), dtype=np.float32)
    combined = np.concatenate([sheet[0], divider, sheet[1], divider, sheet[2]], axis=1)
    # Blender's pixel buffer rows start at the bottom, so writing the array back keeps orientation.
    write_image("ThreeViewSheet", sheet_path, combined)
    for light in lights:
        bpy.data.objects.remove(light, do_unlink=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    scene.camera = None
    return {"preview": str(preview_path), "threeView": str(sheet_path), "boundsMin": list(low), "boundsMax": list(high),
            "panelOrder": ["side", "top", "front"]}
