"""Hashing helpers: file digests, canonical JSON and geometry digests."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import bpy


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical(value) -> bytes:
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")


def sha256_json(value) -> str:
    return sha256_bytes(canonical(value))


def write_json(path: Path, value) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def mesh_digest(obj) -> dict:
    """Digest of rest-pose vertex positions, topology, UVs, groups and skin weights."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    vertices = [[round(axis, 9) for axis in vertex.co] for vertex in mesh.vertices]
    triangles = [list(item.vertices) for item in mesh.loop_triangles]
    group_names = {group.index: group.name for group in obj.vertex_groups}
    weights = [sorted((group_names[item.group], round(item.weight, 6)) for item in vertex.groups) for vertex in mesh.vertices]
    uvs = []
    if mesh.uv_layers.active:
        uvs = [[round(loop.uv.x, 6), round(loop.uv.y, 6)] for loop in mesh.uv_layers.active.data]
    shape_keys = []
    if mesh.shape_keys:
        for block in mesh.shape_keys.key_blocks:
            shape_keys.append({"name": block.name, "digest": sha256_json([[round(axis, 9) for axis in point.co] for point in block.data])})
    materials = [material.name for material in mesh.materials]
    return {
        "name": obj.name,
        "vertexCount": len(vertices),
        "triangleCount": len(triangles),
        "vertexDigest": sha256_json(vertices),
        "topologyDigest": sha256_json(triangles),
        "uvDigest": sha256_json(uvs),
        "weightDigest": sha256_json(weights),
        "materials": materials,
        "shapeKeys": shape_keys,
    }


def rig_digest(rig) -> dict:
    bones = []
    for bone in rig.data.bones:
        bones.append({
            "name": bone.name,
            "parent": bone.parent.name if bone.parent else None,
            "head": [round(axis, 9) for axis in bone.head_local],
            "tail": [round(axis, 9) for axis in bone.tail_local],
            "deform": bone.use_deform,
        })
    return {"name": rig.name, "boneCount": len(bones), "deformBoneCount": sum(1 for bone in bones if bone["deform"]),
            "boneDigest": sha256_json(bones)}


def geometry_digest(species_id: str, mesh_objects, rig, source_hash: str) -> dict:
    payload = {
        "schemaVersion": 2,
        "speciesId": species_id,
        "sourceSha256": source_hash,
        "objects": [mesh_digest(obj) for obj in sorted(mesh_objects, key=lambda item: item.name)],
        "rig": rig_digest(rig),
    }
    payload["geometryDigest"] = sha256_json(payload)
    return payload
