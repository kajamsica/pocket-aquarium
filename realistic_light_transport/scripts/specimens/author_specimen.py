"""Build an allowlisted specimen candidate from its package and morphology JSON."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
SUPPORTED = {"ocellaris": "author_ocellaris.py"}


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_file(path: Path) -> str:
    return digest_bytes(path.read_bytes())


def canonical(value) -> bytes:
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode()


def load_context(package_arg: str, candidate_arg: str):
    package_path = (ROOT / package_arg).resolve() if not Path(package_arg).is_absolute() else Path(package_arg).resolve()
    package = json.loads(package_path.read_text(encoding="utf-8"))
    species = package.get("speciesId")
    if package.get("schemaVersion") != "pocket-aquarium.specimen-package/v1" or species not in SUPPORTED:
        raise ValueError("Unsupported specimen package")
    specimen_root = (ROOT / "art" / "specimens" / species).resolve()
    package_path.relative_to(specimen_root)
    allowed = (specimen_root / "candidates").resolve()
    candidate = (ROOT / candidate_arg).resolve() if not Path(candidate_arg).is_absolute() else Path(candidate_arg).resolve()
    candidate.relative_to(allowed)
    morphology_path = (package_path.parent / package["files"]["morphology"]).resolve()
    morphology = json.loads(morphology_path.read_text(encoding="utf-8"))
    if morphology.get("speciesId") != species or morphology.get("schemaVersion") != "pocket-aquarium.morphology/v1":
        raise ValueError("Morphology does not match specimen package")
    sampling = morphology["sampling"]
    if len(sampling["ringPositions"]) != 48 or sampling["ringSampleCount"] != 48 or sampling["capMode"] != "center_fan":
        raise ValueError("Ocellaris topology contract changed")
    if any(float(station.get("centerY", 0)) != 0 for station in morphology["controlStations"]):
        raise ValueError("The Ocellaris backend requires bilateral centerY zero")
    accepted_package = json.loads((specimen_root / "specimen.package.json").read_text(encoding="utf-8"))
    if package["promotion"]["acceptedHash"] != accepted_package["promotion"]["acceptedHash"]:
        raise ValueError("Candidate package has a stale accepted hash")
    accepted = (specimen_root / accepted_package["files"]["acceptedAsset"]).resolve()
    if digest_file(accepted) != package["promotion"]["acceptedHash"]:
        raise ValueError("Accepted asset hash does not match package")
    candidate.mkdir(parents=True, exist_ok=True)
    return package_path, package, morphology_path, morphology, candidate, accepted


def import_backend(species: str):
    path = Path(__file__).with_name(SUPPORTED[species])
    spec = importlib.util.spec_from_file_location(f"pa_{species}_author", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def configure(context):
    package_path, package, morphology_path, morphology, candidate, accepted = context
    backend = import_backend(package["speciesId"])
    backend.SCIENTIFIC_NAME = package["scientificName"]
    backend.VERSION = package["revisions"]["asset"]
    backend.ADULT_LENGTH_METERS = morphology["adultLengthMeters"]
    backend.BODY_STATIONS = tuple(
        (item["x"], item["halfWidth"], item["dorsalHeight"], item["ventralDepth"], item["centerZ"])
        for item in morphology["controlStations"]
    )
    backend.STATIONS = tuple((x, *backend.interpolate_station(x)) for x in morphology["sampling"]["ringPositions"])
    backend.CROSS_SECTION_EXPONENT = morphology["sampling"]["crossSectionExponent"]
    backend.SOURCE_DIR = candidate
    backend.TEXTURE_DIR = candidate / "textures"
    backend.GLB_DIR = candidate
    backend.BLEND_PATH = candidate / "source.blend"
    backend.GLB_PATH = candidate / "lod1.glb"
    backend.MANIFEST_PATH = candidate / "candidate.manifest.json"
    backend.PREVIEW_PATH = candidate / "renders" / "author-preview.png"
    backend.SOURCE_VALIDATION_PATH = candidate / "validation-source.json"
    backend.RUNTIME_VALIDATION_PATH = candidate / "validation-runtime.json"
    backend.EXPORT_SCRIPT_PATH = Path(__file__).resolve()
    backend.VALIDATOR_SCRIPT_PATH = Path(__file__).with_name("validate_specimen.py")
    backend.SOURCE_MANIFEST_NAME = "candidate.manifest.json"
    return backend


def write_geometry_digest(backend, context):
    _package_path, package, morphology_path, _morphology, candidate, _accepted = context
    objects = []
    for name in ("PA_ocellaris_Body", "PA_ocellaris_Fins"):
        mesh = bpy.data.objects[name].data
        mesh.calc_loop_triangles()
        vertices = [[round(axis, 9) for axis in vertex.co] for vertex in mesh.vertices]
        triangles = [list(item.vertices) for item in mesh.loop_triangles]
        objects.append({"name": name, "vertexCount": len(vertices), "triangleCount": len(triangles),
                        "vertexDigest": digest_bytes(canonical(vertices)), "topologyDigest": digest_bytes(canonical(triangles))})
    payload = {"schemaVersion": 1, "speciesId": package["speciesId"], "morphologySha256": digest_file(morphology_path), "objects": objects}
    payload["geometryDigest"] = digest_bytes(canonical(payload))
    (candidate / "geometry-digest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def parse_args():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True)
    parser.add_argument("--candidate-dir", required=True)
    parser.add_argument("--mode", choices=("author", "export"), required=True)
    return parser.parse_args(raw)


def main():
    args = parse_args()
    context = load_context(args.package, args.candidate_dir)
    backend = configure(context)
    if args.mode == "author":
        backend.author_source()
        write_geometry_digest(backend, context)
    else:
        backend.export_runtime()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Specimen build failed: {error}", file=sys.stderr)
        sys.exit(1)
