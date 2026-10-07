"""Run source/runtime gates for a specimen candidate without promoting it."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
import author_specimen


def import_backend():
    path = Path(__file__).with_name("validate_ocellaris.py")
    spec = importlib.util.spec_from_file_location("pa_ocellaris_validator", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def configure(backend, context):
    _package_path, _package, _morphology_path, _morphology, candidate, _accepted = context
    backend.ROOT = author_specimen.ROOT
    backend.SOURCE_DIR = candidate
    backend.BLEND_PATH = candidate / "source.blend"
    backend.GLB_PATH = candidate / "lod1.glb"
    backend.MANIFEST_PATH = candidate / "candidate.manifest.json"
    backend.SOURCE_REPORT_PATH = candidate / "validation-source.json"
    backend.RUNTIME_REPORT_PATH = candidate / "validation-runtime.json"


def source_json_receipt(context):
    package_path, package, _morphology_path, _morphology, _candidate, _accepted = context
    hashes = {"package": author_specimen.digest_file(package_path)}
    for key in ("biology", "calibration", "morphology", "sources"):
        hashes[key] = author_specimen.digest_file((package_path.parent / package["files"][key]).resolve())
    return hashes, author_specimen.digest_bytes(author_specimen.canonical(hashes))


def write_receipt(context):
    package_path, package, morphology_path, _morphology, candidate, accepted = context
    source_hashes, source_hash = source_json_receipt(context)
    source_report = candidate / "validation-source.json"
    runtime_report = candidate / "validation-runtime.json"
    geometry = json.loads((candidate / "geometry-digest.json").read_text(encoding="utf-8"))
    glb_hash = author_specimen.digest_file(candidate / "lod1.glb")
    base_hash = package["promotion"]["acceptedHash"]
    if author_specimen.digest_file(accepted) != base_hash:
        raise RuntimeError("Accepted Ocellaris changed during candidate validation")
    builder = {
        "entrypoint": author_specimen.digest_file(Path(__file__).with_name("author_specimen.py")),
        "speciesBackend": author_specimen.digest_file(Path(__file__).with_name("author_ocellaris.py")),
    }
    identity = {"sourceJsonHash": source_hash, "candidateGlbHash": glb_hash,
                "geometryDigest": geometry["geometryDigest"], "builderVersion": builder,
                "blenderVersion": bpy.app.version_string, "baseAcceptedHash": base_hash}
    receipt = {
        "schemaVersion": "pocket-aquarium.specimen-validation/v1",
        "speciesId": package["speciesId"], "status": "passed", "state": "awaiting_user_acceptance",
        "candidateHash": author_specimen.digest_bytes(author_specimen.canonical(identity)), **identity,
        "sourceJsonFiles": source_hashes, "morphologySha256": author_specimen.digest_file(morphology_path),
        "stages": {
            "source": {"status": json.loads(source_report.read_text())["status"], "report": source_report.name,
                       "sha256": author_specimen.digest_file(source_report)},
            "runtime": {"status": json.loads(runtime_report.read_text())["status"], "report": runtime_report.name,
                        "sha256": author_specimen.digest_file(runtime_report)},
        },
        "acceptance": {"performed": False, "requiredAction": "explicit_accept_candidate"},
    }
    (candidate / "validation-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    manifest = json.loads((candidate / "candidate.manifest.json").read_text(encoding="utf-8"))
    manifest["candidate"] = {"state": receipt["state"], "candidateHash": receipt["candidateHash"],
                             "baseAcceptedHash": base_hash, "validationReceipt": "validation-receipt.json"}
    manifest.pop("promotion", None)
    (candidate / "candidate.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2))


def parse_args():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True)
    parser.add_argument("--candidate-dir", required=True)
    parser.add_argument("--stage", choices=("source", "runtime"), required=True)
    return parser.parse_args(raw)


def main():
    args = parse_args()
    context = author_specimen.load_context(args.package, args.candidate_dir)
    author_specimen.configure(context)
    backend = import_backend()
    configure(backend, context)
    report = backend.SOURCE_REPORT_PATH if args.stage == "source" else backend.RUNTIME_REPORT_PATH
    try:
        (backend.source_gate if args.stage == "source" else backend.runtime_gate)()
        if args.stage == "runtime":
            write_receipt(context)
    except Exception as error:
        report.write_text(json.dumps({"schemaVersion": 1, "status": "failed", "stage": args.stage,
                                      "error": str(error)}, indent=2) + "\n", encoding="utf-8")
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Specimen validation failed: {error}", file=sys.stderr)
        sys.exit(1)
