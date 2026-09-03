"""Build result and validation-contract structures shared by plans, author and validator."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .animation import ClipSpec, animated_targets


@dataclass
class BuildResult:
    rig: object
    root: object
    meshes: list
    clips: list[ClipSpec]
    contract: dict
    preview_action: str
    textures: list[Path] = field(default_factory=list)
    notes: dict = field(default_factory=dict)


def base_contract(spec: dict, rig_name: str, root_name: str, meshes: list[str], size_axis: str = "x",
                  size_tolerance: float = 0.03, triangle_budget=None, sample_stride: int = 2) -> dict:
    reference = spec["referenceSize"]
    return {
        "schemaVersion": "pocket-aquarium.validation-contract/v1",
        "speciesId": spec["id"],
        "rig": rig_name,
        "root": root_name,
        "meshes": list(meshes),
        "closedParts": [],
        "clearance": [],
        "centerPlane": [],
        "axialChain": None,
        "size": {"axis": size_axis, "meters": float(reference["meters"]), "tolerance": size_tolerance,
                 "kind": reference.get("kind", "adult_total_length")},
        "clips": {},
        "clipRoles": dict(spec["clipRoles"]),
        "triangleBudget": list(triangle_budget or spec.get("validation", {}).get("triangleBudget", [5000, 20000])),
        "maxDeformBones": 32,
        "sampleStride": sample_stride,
    }


def register_clips(contract: dict, clips: list[ClipSpec]) -> None:
    for clip in clips:
        targets = animated_targets(clip)
        contract["clips"][clip.name] = {"loop": clip.loop, "frames": clip.frames, **targets}
    roles = contract["clipRoles"]
    for role in ("idle", "locomotion", "response"):
        if role not in roles:
            raise ValueError(f"Clip role {role} is not mapped")
        if roles[role] not in contract["clips"]:
            raise ValueError(f"Clip role {role} maps to missing clip {roles[role]}")
