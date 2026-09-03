"""GLB export, metadata injection and binary inspection (no third-party parsers)."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import bpy


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def export_glb(path: Path, vertex_color: str | None = None):
    kwargs = dict(
        filepath=str(path), export_format="GLB", export_yup=True,
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_bake_animation=True, export_frame_step=1, export_skins=True,
        export_all_influences=False, export_influence_nb=4, export_texcoords=True,
        export_normals=True, export_tangents=True, export_materials="EXPORT",
        export_extras=True, export_cameras=False, export_lights=False, export_apply=False,
        export_current_frame=False, export_morph=True, export_morph_normal=False, export_morph_tangent=False,
        export_image_format="AUTO", export_merge_animation="ACTION", export_optimize_animation_size=False,
    )
    if vertex_color:
        kwargs["export_vertex_color"] = "NAME"
        kwargs["export_vertex_color_name"] = vertex_color
    else:
        kwargs["export_vertex_color"] = "NONE"
    bpy.ops.export_scene.gltf(**kwargs)


def read_chunks(path: Path):
    data = path.read_bytes()
    if len(data) < 20:
        raise RuntimeError("GLB is too small to be valid")
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2:
        raise RuntimeError("Not a glTF 2.0 GLB container")
    if length != len(data):
        raise RuntimeError(f"GLB declared length {length} differs from file size {len(data)}")
    offset = 12
    chunks = []
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        payload = data[offset + 8:offset + 8 + chunk_length]
        if len(payload) != chunk_length:
            raise RuntimeError("Truncated GLB chunk")
        chunks.append((chunk_type, payload))
        offset += 8 + chunk_length
    return chunks


def read_glb(path: Path):
    chunks = read_chunks(path)
    document = json.loads(chunks[0][1].rstrip(b" \0"))
    binary = next((payload for kind, payload in chunks if kind == BIN_CHUNK), b"")
    return document, binary


def inject_asset_metadata(path: Path, metadata: dict) -> None:
    chunks = read_chunks(path)
    document = json.loads(chunks[0][1].rstrip(b" \0"))
    document.setdefault("asset", {})["extras"] = {"pocketAquarium": metadata}
    encoded = json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8")
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    chunks[0] = (JSON_CHUNK, encoded)
    total = 12 + sum(8 + len(payload) for _, payload in chunks)
    output = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    for chunk_type, payload in chunks:
        output.extend(struct.pack("<II", len(payload), chunk_type))
        output.extend(payload)
    path.write_bytes(output)


COMPONENT_FORMATS = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
TYPE_WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def accessor_values(document, binary, accessor_index: int):
    accessor = document["accessors"][accessor_index]
    if "bufferView" not in accessor:
        width = TYPE_WIDTHS[accessor["type"]]
        return [tuple([0.0] * width) for _ in range(accessor["count"])]
    view = document["bufferViews"][accessor["bufferView"]]
    component = COMPONENT_FORMATS[accessor["componentType"]]
    width = TYPE_WIDTHS[accessor["type"]]
    component_size = struct.calcsize("<" + component)
    stride = view.get("byteStride", component_size * width)
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    end = start + (accessor["count"] - 1) * stride + component_size * width
    if end > view.get("byteOffset", 0) + view["byteLength"] or end > len(binary):
        raise RuntimeError(f"Accessor {accessor_index} reads outside its buffer view")
    values = [struct.unpack_from("<" + component * width, binary, start + index * stride) for index in range(accessor["count"])]
    if accessor.get("normalized"):
        scale = {5121: 255.0, 5123: 65535.0, 5120: 127.0, 5122: 32767.0}[accessor["componentType"]]
        values = [tuple(component_value / scale for component_value in value) for value in values]
    return values


def triangle_count(document) -> int:
    total = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            mode = primitive.get("mode", 4)
            if mode != 4:
                continue
            if "indices" in primitive:
                total += document["accessors"][primitive["indices"]]["count"] // 3
            else:
                total += document["accessors"][primitive["attributes"]["POSITION"]]["count"] // 3
    return total


def all_finite(values) -> bool:
    return all(math.isfinite(component) for value in values for component in value)


def clip_names(document) -> list[str]:
    return sorted(animation.get("name", "") for animation in document.get("animations", []))


def clip_durations(document, binary) -> dict[str, float]:
    durations = {}
    for animation in document.get("animations", []):
        duration = 0.0
        for sampler in animation.get("samplers", []):
            times = accessor_values(document, binary, sampler["input"])
            if times:
                duration = max(duration, times[-1][0])
        durations[animation.get("name", "")] = duration
    return durations
