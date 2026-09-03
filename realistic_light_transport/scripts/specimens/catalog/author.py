"""Generic candidate author/export entrypoint for the RLT visual catalog.

    Blender --background --factory-startup --python catalog/author.py -- \
        --asset <catalog-id> --candidate-dir <dir> --mode author [--variant <id>] [--no-render]
    Blender <candidate>/source.blend --background --python catalog/author.py -- \
        --asset <catalog-id> --candidate-dir <dir> --mode export [--variant <id>]

Ocellaris keeps its own accepted pipeline (author_specimen.py); this entrypoint only
produces `awaiting_user_acceptance` candidates for the visual catalog and never touches
accepted assets.
"""

from __future__ import annotations

import argparse
import copy
import importlib
import json
import sys
from pathlib import Path

import bpy

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from catalog.lib import digest, glb  # noqa: E402
from catalog.lib.contract import BuildResult  # noqa: E402
from catalog.lib.render import render_previews  # noqa: E402
from catalog.lib.rigging import identity_pose  # noqa: E402
from catalog.lib.scene import clear_scene, scene_bounds  # noqa: E402

ROOT = SCRIPTS_ROOT.parents[1]  # realistic_light_transport/
SCHEMA = "pocket-aquarium.asset-source/v1"
BUILDER_VERSION = "catalog-author/1.0.0"
ACCEPTED_OCELLARIS = "ed4d447b2c7d88e91f45699a76b2ff3768144b57e6acb4199000567bafe37ac0"


class Context:
    def __init__(self, species_id: str, candidate_dir: Path, variant: str | None):
        self.species_id = species_id
        self.variant = variant
        self.prefix = f"PA_{species_id}"
        self.candidate_dir = candidate_dir
        self.texture_dir = candidate_dir / "textures"
        self.texture_dir.mkdir(parents=True, exist_ok=True)


def deep_merge(base: dict, overrides: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def load_spec(asset_id: str, variant: str | None):
    source_dir = (ROOT / "art" / "specimens" / asset_id).resolve()
    source_path = source_dir / "asset.source.json"
    spec = json.loads(source_path.read_text(encoding="utf-8"))
    if spec.get("schemaVersion") != SCHEMA or spec.get("id") != asset_id:
        raise ValueError(f"{source_path} is not a valid {SCHEMA} document for {asset_id}")
    # The accepted Ocellaris v1.1.0 package (ocellaris.asset.json, ocellaris.blend, src/assets/...) is built
    # by its own pipeline and is never written here: this entrypoint only writes inside
    # art/specimens/<id>/candidates/<candidate>/, so refinement candidates for ocellaris are allowed and
    # stay awaiting_user_acceptance like every other candidate.
    variants = spec.get("variants", {})
    if variant:
        if variant not in variants:
            raise ValueError(f"Unknown variant {variant} for {asset_id}")
        spec = deep_merge(spec, variants[variant].get("overrides", {}))
        spec["variantId"] = variant
        spec["variantDisplayName"] = variants[variant].get("displayName", variant)
    elif variants:
        raise ValueError(f"{asset_id} defines variants; pass --variant")
    return source_dir, source_path, spec


def candidate_root(asset_id: str) -> Path:
    return (ROOT / "art" / "specimens" / asset_id / "candidates").resolve()


def resolve_candidate_dir(asset_id: str, candidate_arg: str, allow_scratch: bool) -> Path:
    candidate = Path(candidate_arg)
    candidate = candidate.resolve() if candidate.is_absolute() else (ROOT / candidate).resolve()
    allowed = candidate_root(asset_id)
    try:
        candidate.relative_to(allowed)
    except ValueError:
        if not allow_scratch:
            raise ValueError(f"Candidate directory must live under {allowed}")
    candidate.mkdir(parents=True, exist_ok=True)
    return candidate


def plan_path(name: str) -> Path:
    return Path(__file__).resolve().parent / "plans" / f"{name}.py"


def import_plan(name: str, species):
    """Shared plan module when catalog/plans/<name>.py exists, otherwise the species module itself.

    Body plans without a shared implementation yet (gastropod, decapod, coral, ...) live inside the
    species backend, which must then define build(spec, species, ctx).
    """
    if plan_path(name).exists():
        return importlib.import_module(f"catalog.plans.{name}")
    if not hasattr(species, "build"):
        raise ValueError(f"No shared plan catalog/plans/{name}.py and species backend defines no build()")
    return species


def import_species(spec: dict):
    module_name = spec.get("backend", f"catalog.species.{spec['id']}")
    return importlib.import_module(module_name)


def builder_hashes(spec: dict) -> dict:
    lib_dir = Path(__file__).resolve().parent / "lib"
    species_file = Path(__file__).resolve().parent / "species" / f"{spec['id']}.py"
    shared_plan = plan_path(spec["bodyPlan"])
    return {
        "entrypoint": digest.sha256_file(Path(__file__)),
        "validator": digest.sha256_file(Path(__file__).with_name("validate.py")),
        "plan": digest.sha256_file(shared_plan) if shared_plan.exists() else f"species_local:{digest.sha256_file(species_file)}",
        "speciesBackend": digest.sha256_file(species_file),
        "lib": {path.name: digest.sha256_file(path) for path in sorted(lib_dir.glob("*.py"))},
        "builderVersion": BUILDER_VERSION,
    }


def author(asset_id: str, candidate_dir: Path, variant: str | None, render: bool):
    source_dir, source_path, spec = load_spec(asset_id, variant)
    species = import_species(spec)
    plan = import_plan(spec["bodyPlan"], species)
    ctx = Context(asset_id, candidate_dir, variant)
    clear_scene()
    bpy.context.scene.render.fps = 30
    result: BuildResult = plan.build(spec, species, ctx)
    root = bpy.data.objects.new(f"{ctx.prefix}_Root", None)
    bpy.context.collection.objects.link(root)
    root["speciesId"] = asset_id
    root["referenceSizeMeters"] = spec["referenceSize"]["meters"]
    root["sourceForwardAxis"] = "+X"
    root["sourceUpAxis"] = "+Z"
    result.rig.parent = root
    result.root = root
    identity_pose(result.rig)
    bpy.context.scene.frame_set(1)
    low, high = scene_bounds(result.meshes)
    render_receipt = None
    if render:
        preview = spec.get("preview", {})
        render_receipt = render_previews(result.rig, result.meshes, candidate_dir / "renders" / "author-preview.png",
                                         candidate_dir / "renders" / "three-view.png", result.preview_action,
                                         frame=int(preview.get("frame", 10)),
                                         preview_azimuth_degrees=float(preview.get("azimuthDegrees", -55.0)),
                                         preview_elevation_degrees=float(preview.get("elevationDegrees", 22.0)))
        identity_pose(result.rig)
        bpy.context.scene.frame_set(1)
    root.location = (0, 0, 0)
    root.rotation_euler = (0, 0, 0)
    root.scale = (1, 1, 1)
    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE" and obj.animation_data:
            obj.animation_data.action = None
    bpy.context.preferences.filepaths.save_version = 0
    blend_path = candidate_dir / "source.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)

    source_hash = digest.sha256_file(source_path)
    geometry = digest.geometry_digest(asset_id, result.meshes, result.rig, source_hash)
    geometry["variantId"] = variant
    digest.write_json(candidate_dir / "geometry-digest.json", geometry)
    contract = dict(result.contract)
    contract["variantId"] = variant
    contract["previewAction"] = result.preview_action
    contract["restBounds"] = {"min": [round(v, 6) for v in low], "max": [round(v, 6) for v in high]}
    contract["textures"] = [str(path.relative_to(candidate_dir)) for path in result.textures]
    contract["notes"] = result.notes
    contract["render"] = render_receipt
    digest.write_json(candidate_dir / "validation.contract.json", contract)
    print(json.dumps({
        "stage": "author", "asset": asset_id, "variant": variant, "blend": str(blend_path),
        "meshes": {obj.name: len(obj.data.vertices) for obj in result.meshes},
        "deformBones": sum(1 for bone in result.rig.data.bones if bone.use_deform),
        "clips": sorted(clip.name for clip in result.clips), "geometryDigest": geometry["geometryDigest"],
    }, indent=2))


def export(asset_id: str, candidate_dir: Path, variant: str | None):
    source_dir, source_path, spec = load_spec(asset_id, variant)
    contract = digest.read_json(candidate_dir / "validation.contract.json")
    rig = bpy.data.objects.get(contract["rig"])
    if rig is None:
        raise RuntimeError("Saved source is missing its rig")
    meshes = [bpy.data.objects[name] for name in contract["meshes"]]
    expected = sorted(contract["clips"])
    retained = sorted(action.name for action in bpy.data.actions if action.name in contract["clips"])
    if retained != expected:
        raise RuntimeError(f"Saved source did not retain all clips: {retained} vs {expected}")
    for obj in bpy.context.scene.objects:
        if obj.animation_data:
            obj.animation_data.action = None
    for mesh in meshes:
        if mesh.data.shape_keys and mesh.data.shape_keys.animation_data:
            mesh.data.shape_keys.animation_data.action = None
        if mesh.data.shape_keys:
            for block in mesh.data.shape_keys.key_blocks:
                block.value = 0.0
    identity_pose(rig)
    bpy.context.scene.frame_set(1)
    glb_path = candidate_dir / "lod1.glb"
    glb.export_glb(glb_path, contract.get("vertexColorAttribute"))
    metadata = {
        "schemaVersion": 2,
        "speciesId": asset_id,
        "variantId": variant,
        "scientificName": spec["scientificLabel"],
        "biome": "reef",
        "waterType": "salt",
        "assetVersion": spec["assetVersion"],
        "referenceSizeMeters": spec["referenceSize"]["meters"],
        "referenceSizeKind": spec["referenceSize"].get("kind", "adult_total_length"),
        "origin": spec.get("origin", "anatomical_midbody"),
        "forwardAxis": "+X",
        "upAxis": "+Y",
        "lod": 1,
        "candidate": True,
        "sourceManifest": "candidate.manifest.json",
    }
    glb.inject_asset_metadata(glb_path, metadata)
    document, _binary = glb.read_glb(glb_path)
    textures = sorted((candidate_dir / "textures").glob("*.png"))
    source_report = candidate_dir / "validation-source.json"
    source_validation = digest.read_json(source_report) if source_report.exists() else None
    references = digest.read_json(source_dir / "source-references.json")
    manifest = {
        **metadata,
        "displayName": spec.get("variantDisplayName", spec["displayName"]) if variant else spec["displayName"],
        "bodyPlan": spec["bodyPlan"],
        "referenceGrade": spec.get("referenceGrade", "C"),
        "author": "Pocket Aquarium project",
        "contributors": spec.get("contributors", ["Fable species-assets lane"]),
        "rightsStatus": "PROJECT_OWNED",
        "licenseExpression": "NOASSERTION",
        "sourceReferences": references.get("sources", []),
        "referenceUsagePolicy": "References guided proportions and colour placement only; no pixels were sampled, traced or copied.",
        "toolchain": {"blender": bpy.app.version_string, "exporter": "Blender native glTF 2.0 exporter"},
        "sourceSha256": digest.sha256_file(source_path),
        "sourceReferencesSha256": digest.sha256_file(source_dir / "source-references.json"),
        "sourceBlendSha256": digest.sha256_file(candidate_dir / "source.blend"),
        "builder": builder_hashes(spec),
        "runtimeGlbSha256": {"lod1": digest.sha256_file(glb_path)},
        "coordinateContract": {"unitMeters": 1, "source": {"forwardAxis": "+X", "upAxis": "+Z"},
                               "runtime": {"forwardAxis": "+X", "upAxis": "+Y"}, "origin": metadata["origin"]},
        "proceduralTextures": [{"path": str(path.relative_to(candidate_dir)), "sha256": digest.sha256_file(path)} for path in textures],
        "statistics": {
            "triangles": glb.triangle_count(document),
            "materials": len(document.get("materials", [])),
            "bones": sum(1 for bone in rig.data.bones if bone.use_deform),
            "nodes": len(document.get("nodes", [])),
            "skins": len(document.get("skins", [])),
            "morphTargets": sum(len(primitive.get("targets", [])) for mesh in document.get("meshes", []) for primitive in mesh.get("primitives", [])),
            "clips": glb.clip_names(document),
            "vertices": {mesh.name: len(mesh.data.vertices) for mesh in meshes},
            "runtimeBytes": glb_path.stat().st_size,
        },
        "clipRoles": spec["clipRoles"],
        "clipLoops": {name: data["loop"] for name, data in contract["clips"].items()},
        "restBounds": contract.get("restBounds"),
        "renders": {"authorPreview": "renders/author-preview.png", "threeView": "renders/three-view.png",
                    "threeViewPanelOrder": ["side", "top", "front"]},
        "validator": {"status": "source_passed_runtime_pending" if source_validation and source_validation.get("status") == "passed" else "pending",
                      "sourceReport": "validation-source.json", "runtimeReport": "validation-runtime.json"},
        "candidate": {"state": "awaiting_user_acceptance", "acceptedOcellarisHash": ACCEPTED_OCELLARIS},
    }
    digest.write_json(candidate_dir / "candidate.manifest.json", manifest)
    print(json.dumps({"stage": "export", "glb": str(glb_path), "statistics": manifest["statistics"]}, indent=2))


def parse_args():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True)
    parser.add_argument("--candidate-dir", required=True)
    parser.add_argument("--mode", choices=("author", "export"), required=True)
    parser.add_argument("--variant", default=None)
    parser.add_argument("--no-render", action="store_true")
    parser.add_argument("--allow-scratch", action="store_true", help="permit a candidate dir outside art/ for determinism rebuilds")
    return parser.parse_args(raw)


def main():
    args = parse_args()
    candidate_dir = resolve_candidate_dir(args.asset, args.candidate_dir, args.allow_scratch)
    if args.mode == "author":
        author(args.asset, candidate_dir, args.variant, not args.no_render)
    else:
        export(args.asset, candidate_dir, args.variant)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - surface any failure as a non-zero exit for the build wrapper
        import traceback
        traceback.print_exc()
        print(f"Catalog asset build failed: {error}", file=sys.stderr)
        sys.exit(1)
