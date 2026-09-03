"""Declarative clip baking: channels of periodic motion on bones and shape keys.

Clips are baked to one keyframe per frame (Ocellaris convention). Looping clips
use integer frequencies so the final frame equals the first; response clips use
an envelope that starts and ends at the neutral pose, which keeps runtime blending clean.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import bpy
from mathutils import Quaternion, Vector

from .rigging import identity_pose


@dataclass
class Channel:
    target: str
    kind: str = "rotation"  # rotation | location | scale | value
    axis: tuple[float, float, float] = (0.0, 0.0, 1.0)
    amplitude: float = 0.0
    frequency: float = 1.0
    phase: float = 0.0
    waveform: str = "sin"  # sin | pulse | tri | const | ramp
    exponent: float = 1.0
    bias: float = 0.0
    envelope: str | None = None  # None | bell | hold | attack


@dataclass
class ClipSpec:
    name: str
    frames: int
    loop: bool
    channels: list[Channel] = field(default_factory=list)


def waveform(channel: Channel, t: float) -> float:
    argument = math.tau * channel.frequency * t + channel.phase
    if channel.waveform == "sin":
        value = math.sin(argument)
        return math.copysign(abs(value) ** channel.exponent, value) if channel.exponent != 1.0 else value
    if channel.waveform == "pulse":
        return max(math.sin(argument), 0.0) ** channel.exponent
    if channel.waveform == "tri":
        cycle = (argument / math.tau) % 1.0
        return 1.0 - 4.0 * abs(cycle - 0.5)
    if channel.waveform == "ramp":
        return ((argument / math.tau) % 1.0) ** channel.exponent
    if channel.waveform == "const":
        return 1.0
    raise ValueError(f"Unknown waveform {channel.waveform}")


def envelope(kind: str | None, t: float) -> float:
    if kind is None:
        return 1.0
    if kind == "bell":
        return math.sin(math.pi * t) ** 0.75
    if kind == "hold":
        rise = _smooth((t - 0.0) / 0.22)
        fall = 1.0 - _smooth((t - 0.72) / 0.28)
        return min(rise, fall)
    if kind == "attack":
        return _smooth(t / 0.35) * (1.0 - _smooth((t - 0.55) / 0.45))
    raise ValueError(f"Unknown envelope {kind}")


def _smooth(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def travelling_wave(bones: list[str], amplitudes: list[float], axis=(0.0, 0.0, 1.0), frequency: float = 1.0,
                    lag: float = 0.45, phase: float = 0.0, envelope_kind: str | None = None, exponent: float = 1.0):
    return [Channel(target=bone, kind="rotation", axis=axis, amplitude=amplitude, frequency=frequency,
                    phase=phase - index * lag, envelope=envelope_kind, exponent=exponent)
            for index, (bone, amplitude) in enumerate(zip(bones, amplitudes))]


def shape_key_target(object_name: str, key_name: str) -> str:
    return f"shapekey:{object_name}/{key_name}"


def _assign_action(id_block, action):
    id_block.animation_data_create()
    id_block.animation_data.action = action


def bake_clip(rig, spec: ClipSpec, mesh_objects: dict[str, bpy.types.Object] | None = None):
    """Bake a clip to an action shared by the rig and any shape-key data-blocks it animates."""
    mesh_objects = mesh_objects or {}
    action = bpy.data.actions.new(name=spec.name)
    action.use_fake_user = True
    _assign_action(rig, action)
    bone_channels: dict[str, list[Channel]] = {}
    key_channels: dict[tuple[str, str], list[Channel]] = {}
    for channel in spec.channels:
        if channel.target.startswith("shapekey:"):
            object_name, key_name = channel.target[len("shapekey:"):].split("/", 1)
            key_channels.setdefault((object_name, key_name), []).append(channel)
        else:
            if channel.target not in rig.pose.bones:
                raise KeyError(f"Clip {spec.name} targets unknown bone {channel.target}")
            bone_channels.setdefault(channel.target, []).append(channel)
    keys = {}
    for object_name, key_name in key_channels:
        obj = mesh_objects.get(object_name) or bpy.data.objects.get(object_name)
        if obj is None or obj.data.shape_keys is None or key_name not in obj.data.shape_keys.key_blocks:
            raise KeyError(f"Clip {spec.name} targets unknown shape key {object_name}/{key_name}")
        key = obj.data.shape_keys
        if key.name not in keys:
            _assign_action(key, action)
            keys[key.name] = key
    animated_kinds = {bone: {channel.kind for channel in channels} for bone, channels in bone_channels.items()}
    for frame in range(1, spec.frames + 1):
        t = (frame - 1) / max(spec.frames - 1, 1)
        gain = envelope(None, t) if spec.loop else 1.0
        identity_pose(rig)
        for bone_name, channels in bone_channels.items():
            pose = rig.pose.bones[bone_name]
            rotation = Quaternion((1, 0, 0, 0))
            location = Vector((0.0, 0.0, 0.0))
            scale = Vector((1.0, 1.0, 1.0))
            for channel in channels:
                value = gain * envelope(channel.envelope, t) * (channel.amplitude * waveform(channel, t) + channel.bias)
                if channel.kind == "rotation":
                    rotation = rotation @ Quaternion(Vector(channel.axis).normalized(), math.radians(value))
                elif channel.kind == "location":
                    location += Vector(channel.axis) * value
                elif channel.kind == "scale":
                    scale += Vector(channel.axis) * value
                else:
                    raise ValueError(f"Bone channel kind {channel.kind} is not supported")
            pose.rotation_quaternion = rotation
            pose.location = location
            pose.scale = scale
            kinds = animated_kinds[bone_name]
            if "rotation" in kinds:
                pose.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone_name)
            if "location" in kinds:
                pose.keyframe_insert(data_path="location", frame=frame, group=bone_name)
            if "scale" in kinds:
                pose.keyframe_insert(data_path="scale", frame=frame, group=bone_name)
        for (object_name, key_name), channels in key_channels.items():
            obj = mesh_objects.get(object_name) or bpy.data.objects[object_name]
            block = obj.data.shape_keys.key_blocks[key_name]
            value = 0.0
            for channel in channels:
                value += envelope(channel.envelope, t) * (channel.amplitude * waveform(channel, t) + channel.bias)
            block.value = max(0.0, min(1.0, value))
            block.keyframe_insert(data_path="value", frame=frame)
    action.frame_start = 1
    action.frame_end = spec.frames
    action["loop"] = spec.loop
    rig.animation_data.action = None
    for key in keys.values():
        key.animation_data.action = None
        for block in key.key_blocks:
            block.value = 0.0
    identity_pose(rig)
    return action


def animated_targets(spec: ClipSpec) -> dict[str, list[str]]:
    bones = sorted({channel.target for channel in spec.channels if not channel.target.startswith("shapekey:")})
    keys = sorted({channel.target for channel in spec.channels if channel.target.startswith("shapekey:")})
    return {"bones": bones, "shapeKeys": keys}
