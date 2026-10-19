"""First static face and hair study from the staged CC0 anatomy mesh.

Run with Blender in background mode. This intentionally does not rig or export
the study and does not modify the playable character.
"""

import math
from pathlib import Path

import bpy
from mathutils import Vector


HERE = Path(__file__).resolve().parent
BASE = HERE / "wayfarer_v3_artist_staging.blend"


def material(name, color, roughness=0.7):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    return mat


def point_at(ob, point):
    ob.rotation_euler = (Vector(point) - ob.location).to_track_quat("-Z", "Y").to_euler()


def mesh_object(name, vertices, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    for face in mesh.polygons:
        face.use_smooth = True
    return ob


def hair_cap(mat):
    """A continuous scalp shell, with its irregular edge hidden in anatomy."""
    vertices = []
    faces = []
    rings = [(0.79, 0.0), (0.97, 0.32), (0.94, 0.60),
             (0.70, 0.83), (0.33, 0.98), (0.04, 1.01)]
    sides = 48
    for radius, height in rings:
        for i in range(sides):
            theta = 2 * math.pi * i / sides
            front = math.cos(theta)
            base_z = (2.075 + 0.065 * max(0, front)
                      - 0.060 * max(0, -front)
                      + 0.014 * math.sin(5 * theta + 0.7)
                      + 0.007 * math.sin(9 * theta))
            flow = 1 + 0.045 * math.sin(6 * theta - 2 * height)
            vertices.append((
                0.187 * radius * flow * math.sin(theta),
                -0.012 + 0.170 * radius * flow * front,
                base_z + (2.292 - base_z) * height,
            ))
    for ring in range(len(rings) - 1):
        for i in range(sides):
            j = (i + 1) % sides
            a = ring * sides + i
            b = ring * sides + j
            faces.append((a, b, b + sides, a + sides))
    ob = mesh_object("HAIR | continuous chestnut scalp", vertices, faces, mat)
    solid = ob.modifiers.new("scalp thickness", "SOLIDIFY")
    solid.thickness = 0.008
    return ob


def bezier(controls, t):
    a, b, c, d = (Vector(p) for p in controls)
    u = 1 - t
    return a * u**3 + b * (3 * u*u*t) + c * (3 * u*t*t) + d * t**3


def hair_lock(name, controls, width, mat):
    """One broad, rounded sculptable hair mass rather than a tube or spike."""
    vertices = []
    faces = []
    segments = 20
    radial = 10
    across = Vector((1, 0, 0))
    for step in range(segments + 1):
        t = step / segments
        center = bezier(controls, t)
        tangent = (bezier(controls, min(1, t + 0.01)) -
                   bezier(controls, max(0, t - 0.01))).normalized()
        outward = across.cross(tangent).normalized()
        crown = math.sin(math.pi * (0.08 + 0.84 * t)) ** 0.6
        half_width = width * (0.32 + 0.68 * crown) * (1 - 0.82 * t**4)
        thickness = 0.004 + 0.006 * crown
        for i in range(radial):
            phi = 2 * math.pi * i / radial
            point = center + across * (math.cos(phi) * half_width) + outward * (math.sin(phi) * thickness)
            vertices.append(tuple(point))
    for step in range(segments):
        for i in range(radial):
            j = (i + 1) % radial
            a = step * radial + i
            b = step * radial + j
            faces.append((a, b, b + radial, a + radial))
    faces.extend((tuple(reversed(range(radial))),
                  tuple(segments * radial + i for i in range(radial))))
    return mesh_object(name, vertices, faces, mat)


def color_eyes():
    iris = material("Deep hazel iris", (0.10, 0.077, 0.027), 0.34)
    pupil = material("Warm black pupil", (0.009, 0.006, 0.003), 0.18)
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ".eye." not in ob.name:
            continue
        world_center = sum((ob.matrix_world @ v.co for v in ob.data.vertices), Vector()) / len(ob.data.vertices)
        for name, radius, front, mat in (("iris", 0.014, 0.050, iris),
                                          ("pupil", 0.007, 0.055, pupil)):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10,
                                                  location=(world_center.x,
                                                            world_center.y + front,
                                                            world_center.z))
            disc = bpy.context.object
            disc.name = f"EYE | {name} {ob.name[-1]}"
            disc.scale = (radius, 0.003, radius)
            disc.data.materials.append(mat)
            for poly in disc.data.polygons:
                poly.use_smooth = True


def refine_eye_area():
    """Narrow the upper opening using the anatomical facial loops."""
    ob = bpy.data.objects["GEO-body_male_stylized"]
    inverse = ob.matrix_world.inverted()
    for vertex in ob.data.vertices:
        point = ob.matrix_world @ vertex.co
        eye_x = min(abs(point.x - 0.05), abs(point.x + 0.05))
        if point.y < 0.058 or eye_x > 0.060:
            continue
        horizontal = max(0.0, 1.0 - (eye_x / 0.060) ** 2)
        upper = max(0.0, 1.0 - abs(point.z - 2.087) / 0.028)
        lower = max(0.0, 1.0 - abs(point.z - 2.017) / 0.020)
        point.z += (-0.020 * upper + 0.006 * lower) * horizontal
        vertex.co = inverse @ point
    ob.data.update()


def brows_on_face():
    ob = bpy.data.objects["GEO-body_male_stylized"]
    inverse = ob.matrix_world.inverted()
    brow_mat = material("Chestnut eyebrows", (0.040, 0.019, 0.010), 0.88)
    ray = (inverse.to_3x3() @ Vector((0, -1, 0))).normalized()
    for side in (-1, 1):
        vertices = []
        faces = []
        for i in range(9):
            t = i / 8
            x = side * (0.018 + 0.100 * t)
            z = 2.121 + 0.012 * math.sin(math.pi * t) - 0.012 * t
            thickness = 0.0015 + 0.0080 * math.sin(math.pi * t)**0.7
            for edge in (-1, 1):
                height = z + edge * thickness
                hit, local, _, _ = ob.ray_cast(inverse @ Vector((x, 1, height)), ray)
                y = (ob.matrix_world @ local).y + 0.003 if hit else 0.128
                vertices.append((x, y, height))
            if i:
                k = 2 * (i - 1)
                faces.append((k, k + 1, k + 3, k + 2))
        mesh_object("FACE | anchored eyebrow " + str(side), vertices, faces, brow_mat)


def model_head():
    under = material("Chestnut root", (0.035, 0.016, 0.008), 0.85)
    main = material("Chestnut broad locks", (0.062, 0.028, 0.013), 0.77)
    light = material("Chestnut warm locks", (0.085, 0.039, 0.018), 0.74)
    hair_cap(under)
    locks = [
        ("sweep left outer", [(-0.16, -0.045, 2.250), (-0.17, 0.060, 2.307), (-0.13, 0.150, 2.255), (-0.10, 0.145, 2.170)], 0.030, main),
        ("sweep left inner", [(-0.12, -0.055, 2.270), (-0.13, 0.070, 2.319), (-0.075, 0.159, 2.250), (-0.030, 0.152, 2.145)], 0.031, light),
        ("sweep center", [(-0.050, -0.06, 2.280), (-0.050, 0.065, 2.323), (0.012, 0.164, 2.253), (0.055, 0.152, 2.150)], 0.033, main),
        ("sweep right inner", [(0.020, -0.06, 2.280), (0.045, 0.062, 2.323), (0.101, 0.154, 2.256), (0.125, 0.147, 2.170)], 0.032, light),
        ("sweep right outer", [(0.085, -0.055, 2.255), (0.121, 0.056, 2.315), (0.164, 0.140, 2.270), (0.171, 0.135, 2.190)], 0.028, main),
    ]
    for name, points, width, mat in locks:
        hair_lock("HAIR | " + name, points, width, mat)
    refine_eye_area()
    color_eyes()
    brows_on_face()


def setup_scene():
    bpy.ops.wm.open_mainfile(filepath=str(BASE))
    scene = bpy.context.scene
    for ob in bpy.data.objects:
        if ob.type == "EMPTY" and ob.name.startswith("Approved male sheet"):
            ob.hide_render = True
    skin = material("Warm skin study", (0.43, 0.21, 0.115), 0.8)
    white = material("Eye white", (0.78, 0.78, 0.69), 0.35)
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            ob.data.materials.clear()
            ob.data.materials.append(white if ".eye." in ob.name else skin)
            for poly in ob.data.polygons:
                poly.use_smooth = True
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.eevee.taa_render_samples = 16
    scene.world = bpy.data.worlds.new("Studio world")
    scene.world.color = (0.48, 0.48, 0.5)
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get("Background").inputs["Color"].default_value = (0.13, 0.14, 0.16, 1)
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"

    floor_mat = material("Neutral backdrop", (0.48, 0.49, 0.52), 0.9)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.012))
    floor = bpy.context.object
    floor.name = "STUDIO | ground"
    floor.data.materials.append(floor_mat)

    def area(name, loc, power, size, color):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = power
        data.shape = "DISK"
        data.size = size
        data.color = color
        ob = bpy.data.objects.new(name, data)
        scene.collection.objects.link(ob)
        ob.location = loc
        point_at(ob, (0, 0, 1.4))

    area("STUDIO | key", (2.5, 3.5, 4.5), 420, 4.0, (1.0, 0.91, 0.79))
    area("STUDIO | fill", (-3.5, 1.6, 2.5), 210, 4.0, (0.8, 0.87, 1.0))
    area("STUDIO | rim", (-1.0, -3.0, 4.0), 410, 3.0, (1.0, 0.85, 0.65))

    camera_data = bpy.data.cameras.new("STUDIO | camera")
    camera = bpy.data.objects.new("STUDIO | camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 3.0
    return scene, camera


def render(scene, camera, filename, loc, aim=(0, 0, 1.25), scale=3.0):
    camera.location = loc
    point_at(camera, aim)
    camera.data.ortho_scale = scale
    scene.render.filepath = str(HERE / filename)
    bpy.ops.render.render(write_still=True)


def main():
    scene, camera = setup_scene()
    model_head()
    bpy.data.objects["STUDIO | ground"].hide_render = True
    camera.data.ortho_scale = 0.78
    render(scene, camera, "step1_front.png", (0, 4.2, 2.17), (0, 0, 2.075), 0.78)
    render(scene, camera, "step1_three_quarter.png", (2.2, 3.9, 2.15), (0, 0, 2.075), 0.78)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "wayfarer_v3_step1_head.blend"))


if __name__ == "__main__":
    main()
