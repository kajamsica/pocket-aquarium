"""Armature construction helpers shared by every body plan."""

from __future__ import annotations

import bpy
from mathutils import Vector

from .meshing import smoothstep


class RigBuilder:
    """Create an armature in edit mode from explicit bone head/tail coordinates."""

    def __init__(self, name: str, species_id: str):
        self.data = bpy.data.armatures.new(name)
        self.rig = bpy.data.objects.new(name, self.data)
        bpy.context.collection.objects.link(self.rig)
        bpy.context.view_layer.objects.active = self.rig
        self.rig.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        self.species_id = species_id
        self.deform_names: list[str] = []

    def bone(self, name: str, head, tail, parent: str | None = None, connected: bool = False, deform: bool = True,
             roll_up=(0.0, 0.0, 1.0)):
        head = Vector(head)
        tail = Vector(tail)
        if (tail - head).length < 1e-6:
            raise ValueError(f"Bone {name} has zero length")
        result = self.data.edit_bones.new(name)
        result.head = head
        result.tail = tail
        result.use_deform = deform
        if parent:
            result.parent = self.data.edit_bones[parent]
            result.use_connect = connected
        result.align_roll(Vector(roll_up))
        if deform:
            self.deform_names.append(name)
        return result

    def finish(self):
        bpy.ops.object.mode_set(mode="OBJECT")
        self.rig["speciesId"] = self.species_id
        self.rig["presentationOnly"] = True
        self.rig.show_in_front = True
        self.rig.select_set(False)
        if len(self.deform_names) > 32:
            raise RuntimeError(f"Rig exceeds 32 deform bones: {len(self.deform_names)}")
        return self.rig


def chain_weights(x: float, spans: list[tuple[float, float, str, str]], first_bone: str, last_bone: str) -> dict[str, float]:
    """Blend along an axial chain: spans are (anterior_x, posterior_x, anterior_bone, posterior_bone)."""
    if x >= spans[0][0]:
        return {first_bone: 1.0}
    for anterior, posterior, first, second in spans:
        if x >= anterior:
            # gap between the previous blend span and this one: owned rigidly by this span's anterior bone
            return {first: 1.0}
        if x >= posterior:
            t = smoothstep((anterior - x) / max(anterior - posterior, 1e-9))
            return {first: 1.0 - t, second: t} if 0 < t < 1 else ({second: 1.0} if t >= 1 else {first: 1.0})
    return {last_bone: 1.0}


def segment_weights(t: float, bones: list[str], softness: float = 0.5) -> dict[str, float]:
    """Weights along a bone list for parameter t in [0, 1] (0 = first bone head, 1 = last bone tail)."""
    count = len(bones)
    if count == 1:
        return {bones[0]: 1.0}
    position = t * count - 0.5
    lower = int(position // 1)
    frac = position - lower
    blend = smoothstep((frac - (0.5 - softness / 2)) / max(softness, 1e-6)) if softness > 0 else (1.0 if frac >= 0.5 else 0.0)
    result: dict[str, float] = {}
    a = min(max(lower, 0), count - 1)
    b = min(max(lower + 1, 0), count - 1)
    if lower < 0:
        return {bones[0]: 1.0}
    if lower >= count - 1:
        return {bones[-1]: 1.0}
    result[bones[a]] = result.get(bones[a], 0.0) + (1.0 - blend)
    result[bones[b]] = result.get(bones[b], 0.0) + blend
    return {name: weight for name, weight in result.items() if weight > 1e-6}


def identity_pose(rig):
    for pose in rig.pose.bones:
        pose.rotation_mode = "QUATERNION"
        pose.rotation_quaternion = (1, 0, 0, 0)
        pose.location = (0, 0, 0)
        pose.scale = (1, 1, 1)
