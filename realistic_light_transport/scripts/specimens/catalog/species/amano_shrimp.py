"""Species-local Caridina multidentata procedural backend.

The catalog has no shared atyid body plan. This backend therefore owns a small,
deterministic decapod build instead of inheriting the opaque bands, oversized
chelae, or hovering vocabulary of the marine shrimp implementations. Source
space is metres, +X anterior, +Z up, with bilateral symmetry about y = 0.
"""

from __future__ import annotations

import math

import numpy as np
from mathutils import Vector

from ..lib import materials as mat
from ..lib import meshing as msh
from ..lib import textures
from ..lib.animation import Channel, ClipSpec, bake_clip
from ..lib.contract import BuildResult, base_contract, register_clips
from ..lib.rigging import RigBuilder


BODY_LENGTH = 0.05
CARAPACE = {"center": (0.013, 0.0, 0.0004), "radii": (0.0115, 0.0053, 0.0065)}
ABDOMEN = (
    ((0.0030, 0.0, 0.0006), (0.0042, 0.0048, 0.0056)),
    ((-0.0010, 0.0, 0.0009), (0.0042, 0.0046, 0.0053)),
    ((-0.0050, 0.0, 0.0010), (0.0041, 0.0043, 0.0049)),
    ((-0.0090, 0.0, 0.0008), (0.0039, 0.0039, 0.0044)),
    ((-0.0128, 0.0, 0.0003), (0.0036, 0.0034, 0.0038)),
    ((-0.0162, 0.0, -0.0003), (0.0032, 0.0029, 0.0032)),
)
ROSTRUM = {
    "points": ((0.0190, 0.0, 0.0026), (0.0220, 0.0, 0.0025), (0.0250, 0.0, 0.0019)),
    "radii": (0.00075, 0.00048, 0.00016),
}
LEG_ROOTS = (0.012, 0.008, 0.004, 0.000, -0.004)
PLEOPOD_ROOTS = (0.001, -0.003, -0.007, -0.011, -0.0145)
SIDES = ((-1, "L"), (1, "R"))


def _all(geometry):
    return set(range(len(geometry[0])))


def _rigid(bone):
    return lambda _index, _vertex: {bone: 1.0}


def _part(name, geometry, material, bone, groups=None):
    return msh.make_part(name, geometry, material, _rigid(bone), closed=True, groups=groups or {})


def _mirror(part):
    return part.mirror_y(rename={"_L": "_R"})


def _set_transmission(material, value):
    shader = material.node_tree.nodes.get("Principled BSDF")
    for key in ("Transmission Weight", "Transmission"):
        if key in shader.inputs:
            shader.inputs[key].default_value = value
            break


def _paint_shell_albedo(spec, width=256, height=128):
    """Deterministic translucent-shell colour supporting the modeled flank marks."""
    palette = spec["palette"]
    u, v = textures.uv_grid(width, height)
    grain = 0.5 + 0.25 * np.sin(math.tau * (u * 11.0 + v * 3.0)) + 0.25 * np.sin(math.tau * (u * 23.0 - v * 7.0))
    albedo = textures.rgba(palette["body"], 1.0, u.shape)
    albedo = textures.mix(albedo, palette["bodyWarm"], np.clip(0.10 + 0.12 * grain, 0.0, 0.24))
    lateral_rows = np.exp(-((v - 0.25) / 0.055) ** 2) + np.exp(-((v - 0.75) / 0.055) ** 2)
    broken = np.maximum(np.cos(math.tau * (u * 7.0 + 0.16 * np.sin(v * math.tau * 3.0))), 0.0) ** 12
    albedo = textures.mix(albedo, palette["dottedMark"], np.clip(lateral_rows * broken * 0.28, 0.0, 0.28))
    return textures.scale_rgb(albedo, np.clip(0.93 + 0.10 * grain, 0.90, 1.05))


def _materials(spec, ctx):
    palette = spec["palette"]
    intent = spec["materialIntent"]
    body_intent = intent["body"]
    appendage_intent = intent["appendages"]
    shell = mat.principled(
        "PA_amano_shrimp_Shell",
        palette["body"],
        float(body_intent["roughness"]),
        coat=0.16,
        subsurface=0.02,
        alpha=float(body_intent["alpha"]),
        specular=0.34,
    )
    _set_transmission(shell, float(body_intent["transmission"]))
    texture_path = ctx.texture_dir / "shell-albedo.png"
    shell_albedo = textures.write_image(f"{ctx.prefix}_Shell_Albedo", texture_path, _paint_shell_albedo(spec))
    mat.attach_textures(shell, albedo=shell_albedo)
    limb = mat.principled(
        "PA_amano_shrimp_Appendage",
        palette["appendage"],
        0.44,
        coat=0.05,
        subsurface=0.0,
        alpha=float(appendage_intent["alpha"]),
        specular=0.28,
    )
    _set_transmission(limb, float(appendage_intent["transmission"]))
    mark = mat.principled("PA_amano_shrimp_Marks", palette["dottedMark"], 0.50, coat=0.03, alpha=0.78, specular=0.25)
    eye = mat.principled("PA_amano_shrimp_Eye", palette["eye"], 0.16, coat=0.50, subsurface=0.0, specular=0.48)
    internal = mat.principled("PA_amano_shrimp_Internal", palette["internalCue"], 0.55, coat=0.0, alpha=0.24, specular=0.20)
    tail = mat.principled("PA_amano_shrimp_TailCue", (0.32, 0.48, 0.50), 0.46, coat=0.05, alpha=0.38, specular=0.26)
    return {"shell": shell, "limb": limb, "mark": mark, "eye": eye, "internal": internal, "tail": tail}, [texture_path]


def _body_parts():
    parts = []
    carapace = msh.ellipsoid(CARAPACE["center"], CARAPACE["radii"], 24, 15)
    parts.append(_part("carapace", carapace, "shell", "Body", {"carapace": _all(carapace)}))
    for index, (center, radii) in enumerate(ABDOMEN):
        bone = "Abd_A" if index < 2 else ("Abd_B" if index < 5 else "Tail")
        geometry = msh.ellipsoid(center, radii, 20, 13)
        parts.append(_part(f"somite_{index + 1}", geometry, "shell", bone, {"abdomen": _all(geometry)}))
    internal = msh.ellipsoid((0.0105, 0.0, 0.0003), (0.0068, 0.0022, 0.0022), 16, 10)
    parts.append(_part("internal_cue", internal, "internal", "Body"))
    return parts


def _tail_parts():
    parts = []
    telson = msh.ellipsoid((-0.0207, 0.0, -0.0009), (0.0043, 0.00165, 0.00165), 18, 11)
    parts.append(_part("telson", telson, "tail", "Tail", {"tailfan": _all(telson)}))
    outer = msh.ellipsoid((-0.0218, -0.0020, -0.0006), (0.0032, 0.00135, 0.00046), 16, 9)
    inner = msh.ellipsoid((-0.0222, -0.0010, -0.0005), (0.0028, 0.0009, 0.00040), 16, 9)
    for name, geometry in (("outer", outer), ("inner", inner)):
        left = _part(f"uropod_{name}_L", geometry, "tail", "Tail", {"tailfan": _all(geometry), "uropods_L": _all(geometry)})
        parts.extend((left, _mirror(left)))
    return parts


def _mark_parts():
    parts = []
    stations = (0.016, 0.012, 0.008, 0.004, 0.000, -0.004, -0.008, -0.012, -0.015)
    lateral = (0.0050, 0.0052, 0.0049, 0.0046, 0.0044, 0.0041, 0.0038, 0.0033, 0.0028)
    for index, (x, y) in enumerate(zip(stations, lateral)):
        z = 0.0012 if index % 3 == 0 else (-0.0007 if index % 3 == 1 else 0.0002)
        dash = index % 2 == 1
        radii = (0.00105 if dash else 0.00062, 0.00022, 0.00038)
        geometry = msh.ellipsoid((x, -y, z), radii, 10, 7)
        bone = "Body" if x > 0.003 else ("Abd_A" if x > -0.006 else ("Abd_B" if x > -0.014 else "Tail"))
        left = _part(f"flank_mark_{index + 1}_L", geometry, "mark", bone)
        parts.extend((left, _mirror(left)))
    return parts


def _limb_line(root_x, side, index):
    fore_aft = (0.0045 - index * 0.0022)
    return [
        (root_x, side * 0.0037, -0.0032),
        (root_x + fore_aft * 0.25, side * 0.0050, -0.0048),
        (root_x + fore_aft * 0.70, side * 0.0070, -0.0073),
        (root_x + fore_aft, side * 0.0084, -0.0093),
    ]


def _limb_parts():
    parts = []
    for index, root_x in enumerate(LEG_ROOTS):
        points = _limb_line(root_x, -1, index)
        geometry = msh.tube(points, [0.00042, 0.00036, 0.00027, 0.00014], 7)
        left = _part(f"leg_{index + 1}_L", geometry, "limb", f"Leg{index + 1}_L", {"legs_L": _all(geometry), f"leg_{index + 1}_L": _all(geometry)})
        parts.extend((left, _mirror(left)))
        if index < 2:
            tip = Vector(points[-1])
            chela = msh.tube([tuple(tip), tuple(tip + Vector((0.0015, -0.00045, -0.0002)))], [0.00022, 0.00010], 6)
            left = _part(f"chela_{index + 1}_L", chela, "limb", f"Leg{index + 1}_L", {"legs_L": _all(chela)})
            parts.extend((left, _mirror(left)))
    for index, root_x in enumerate(PLEOPOD_ROOTS):
        geometry = msh.ellipsoid((root_x - 0.0008, -0.0034, -0.0035), (0.00145, 0.00075, 0.00030), 12, 7)
        left = _part(f"pleopod_{index + 1}_L", geometry, "limb", "Pleo_L", {"pleopods_L": _all(geometry)})
        parts.extend((left, _mirror(left)))
    return parts


def _head_parts():
    parts = []
    rostrum = msh.tube(list(ROSTRUM["points"]), list(ROSTRUM["radii"]), 8)
    parts.append(_part("rostrum", rostrum, "shell", "Body", {"rostrum": _all(rostrum)}))
    for index, x in enumerate((0.0200, 0.0214, 0.0227, 0.0238)):
        tooth = msh.ellipsoid((x, 0.0, 0.0030 - index * 0.00015), (0.00030, 0.00014, 0.00038), 8, 6)
        parts.append(_part(f"rostral_tooth_d_{index + 1}", tooth, "shell", "Body"))
    for index, x in enumerate((0.0216, 0.0230)):
        tooth = msh.ellipsoid((x, 0.0, 0.00155 - index * 0.00010), (0.00026, 0.00012, 0.00030), 8, 6)
        parts.append(_part(f"rostral_tooth_v_{index + 1}", tooth, "shell", "Body"))
    left = []
    stalk_points = [(0.0190, -0.0037, 0.0017), (0.0200, -0.0044, 0.0022)]
    stalk = msh.tube(stalk_points, [0.00052, 0.00042], 8)
    left.append(_part("eyestalk_L", stalk, "shell", "Body", {"eyes_L": _all(stalk)}))
    eye = msh.ellipsoid(stalk_points[-1], (0.00078, 0.00072, 0.00072), 14, 9)
    left.append(_part("eye_L", eye, "eye", "Body", {"eyes_L": _all(eye)}))
    scale = msh.ellipsoid((0.0200, -0.0040, 0.0003), (0.0030, 0.00045, 0.00115), 14, 8)
    left.append(_part("scaphocerite_L", scale, "limb", "Body"))
    antenna_points = [
        (0.0205, -0.0040, 0.0008),
        (0.0190, -0.0090, 0.0040),
        (0.0140, -0.0150, 0.0070),
        (0.0060, -0.0200, 0.0050),
    ]
    antenna = msh.tube(antenna_points, [0.00022, 0.00015, 0.00010, 0.000055], 6)
    left.append(_part("antenna_L", antenna, "limb", "Antenna_L", {"antennae_L": _all(antenna)}))
    for branch, z_offset in (("outer", 0.0009), ("inner", -0.0002)):
        points = [
            (0.0205, -0.0037, 0.0012),
            (0.0195, -0.0070, 0.0030 + z_offset),
            (0.0150, -0.0105, 0.0040 + z_offset),
        ]
        antennule = msh.tube(points, [0.00018, 0.00011, 0.00005], 6)
        left.append(_part(f"antennule_{branch}_L", antennule, "limb", "Antenna_L", {"antennae_L": _all(antennule)}))
    for part in left:
        parts.extend((part, _mirror(part)))
    return parts


def _rig():
    rb = RigBuilder("PA_amano_shrimp_Rig", "amano_shrimp")
    rb.bone("Root", (0.025, 0.0, 0.0), (0.023, 0.0, 0.0), deform=False)
    rb.bone("Body", (0.023, 0.0, 0.0004), (0.003, 0.0, 0.0006), "Root")
    rb.bone("Abd_A", (0.003, 0.0, 0.0006), (-0.006, 0.0, 0.0010), "Body", connected=True)
    rb.bone("Abd_B", (-0.006, 0.0, 0.0010), (-0.014, 0.0, 0.0001), "Abd_A", connected=True)
    rb.bone("Tail", (-0.014, 0.0, 0.0001), (-0.025, 0.0, -0.0008), "Abd_B", connected=True)
    for side, suffix in SIDES:
        for index, root_x in enumerate(LEG_ROOTS):
            points = _limb_line(root_x, side, index)
            rb.bone(f"Leg{index + 1}_{suffix}", points[0], points[2], "Body", roll_up=(1.0, 0.0, 0.0))
        rb.bone(f"Pleo_{suffix}", (-0.007, side * 0.0034, -0.0030), (-0.010, side * 0.0040, -0.0052), "Abd_B", roll_up=(1.0, 0.0, 0.0))
        rb.bone(f"Antenna_{suffix}", (0.0205, side * 0.0040, 0.0008), (0.014, side * 0.015, 0.007), "Body", roll_up=(1.0, 0.0, 0.0))
    return rb.finish(), rb


def _local_axis(rig, bone, world_axis):
    rotation = rig.data.bones[bone].matrix_local.to_3x3()
    return tuple(rotation.inverted() @ Vector(world_axis))


def _clips(rig):
    clips = []

    def clip(name, frames, loop, leg, antenna, pleopod, abdomen, tail, envelope=None):
        channels = []
        env = None if loop else envelope
        slow_frequency = (1.0 if name == "rest" else 2.0) if loop else 1.5
        for side, suffix in SIDES:
            side_phase = 0.0 if side < 0 else math.pi
            for index in range(5):
                phase = side_phase - index * math.tau / 5.0
                if name == "graze":
                    amplitude = leg if index < 2 else leg * 0.12
                else:
                    amplitude = leg * (1.15 if index >= 2 else 0.72)
                channels.append(Channel(f"Leg{index + 1}_{suffix}", "rotation", _local_axis(rig, f"Leg{index + 1}_{suffix}", (0.0, 1.0, 0.0)), amplitude, 2.0, phase, envelope=env))
            channels.append(Channel(f"Pleo_{suffix}", "rotation", _local_axis(rig, f"Pleo_{suffix}", (0.0, 1.0, 0.0)), pleopod, 3.0, side_phase, envelope=env))
            channels.append(Channel(f"Antenna_{suffix}", "rotation", _local_axis(rig, f"Antenna_{suffix}", (0.0, 0.0, 1.0)), side * antenna, slow_frequency, side_phase * 0.25, envelope=env))
        channels.append(Channel("Abd_A", "rotation", _local_axis(rig, "Abd_A", (0.0, 1.0, 0.0)), abdomen * 0.45, slow_frequency, 0.0, envelope=env))
        channels.append(Channel("Abd_B", "rotation", _local_axis(rig, "Abd_B", (0.0, 1.0, 0.0)), abdomen, slow_frequency, -0.7, envelope=env))
        channels.append(Channel("Tail", "rotation", _local_axis(rig, "Tail", (0.0, 1.0, 0.0)), tail, slow_frequency, -1.3, envelope=env))
        clips.append(ClipSpec(name, frames, loop, channels))

    clip("rest", 96, True, 1.8, 4.0, 2.5, 1.0, 1.5)
    clip("bottom_walk", 84, True, 9.0, 4.0, 4.0, 1.8, 2.5)
    clip("graze", 54, False, 15.0, 4.0, 5.0, 2.0, 3.0, "bell")
    clip("reposition_swim", 42, False, 3.0, 5.0, 16.0, 8.0, 18.0, "bell")
    for item in clips:
        bake_clip(rig, item)
    return clips


def build(spec: dict, _species, ctx) -> BuildResult:
    if spec["id"] != "amano_shrimp" or spec["bodyPlan"] != "decapod_shrimp":
        raise ValueError("Amano backend only supports the amano_shrimp decapod source")
    materials, written = _materials(spec, ctx)
    rig, rb = _rig()
    body_parts = _body_parts() + _tail_parts()
    limb_parts = _limb_parts()
    detail_parts = _head_parts() + _mark_parts()
    body_obj = msh.assemble(f"{ctx.prefix}_Body", body_parts, materials, rig, f"{ctx.prefix}_Armature")
    limbs_obj = msh.assemble(f"{ctx.prefix}_Limbs", limb_parts, materials, rig, f"{ctx.prefix}_Armature")
    details_obj = msh.assemble(f"{ctx.prefix}_Details", detail_parts, materials, rig, f"{ctx.prefix}_Armature")
    body_obj["adultLengthMeters"] = float(spec["referenceSize"]["meters"])
    for obj in (body_obj, limbs_obj, details_obj):
        obj["lod"] = 1
    clips = _clips(rig)
    meshes = [body_obj, limbs_obj, details_obj]
    contract = base_contract(spec, rig.name, f"{ctx.prefix}_Root", [obj.name for obj in meshes], size_axis="x", size_tolerance=0.06)
    for part in body_parts:
        contract["closedParts"].append({"object": body_obj.name, "group": f"part_{part.name}", "volumeFloor": 0.58})
    for part in limb_parts:
        contract["closedParts"].append({"object": limbs_obj.name, "group": f"part_{part.name}", "volumeFloor": 0.50})
    for part in detail_parts:
        contract["closedParts"].append({"object": details_obj.name, "group": f"part_{part.name}", "volumeFloor": 0.50})
    contract["symmetry"] = [
        {"object": limbs_obj.name, "left": "legs_L", "right": "legs_R", "tolerance": 0.0002},
        {"object": limbs_obj.name, "left": "pleopods_L", "right": "pleopods_R", "tolerance": 0.0002},
        {"object": details_obj.name, "left": "antennae_L", "right": "antennae_R", "tolerance": 0.0002},
        {"object": details_obj.name, "left": "eyes_L", "right": "eyes_R", "tolerance": 0.0002},
        {"object": body_obj.name, "left": "uropods_L", "right": "uropods_R", "tolerance": 0.0002},
    ]
    register_clips(contract, clips)
    return BuildResult(
        rig=rig,
        root=None,
        meshes=meshes,
        clips=clips,
        contract=contract,
        preview_action="bottom_walk",
        textures=written,
        notes={
            "bodyLengthMeters": BODY_LENGTH,
            "bodyLengthExcludesAntennae": True,
            "bodyPlan": "species_local_freshwater_atyid",
            "deformBones": len(rb.deform_names),
            "locomotion": ["benthic_walk", "surface_graze", "brief_reposition_swim"],
        },
    )
