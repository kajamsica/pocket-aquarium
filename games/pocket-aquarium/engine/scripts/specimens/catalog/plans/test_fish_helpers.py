"""Pure geometry-option tests for the Blender-dependent shared fish plan."""

from __future__ import annotations

import ast
import math
from pathlib import Path
import unittest


HELPERS = {
    "_bounded_number",
    "_offset_pair",
    "_lip_geometry",
    "_paired_filament_options",
    "_filament_reach",
    "_tube_adornment_geometry",
}


def _load_helpers():
    source_path = Path(__file__).with_name("fish.py")
    tree = ast.parse(source_path.read_text(), filename=str(source_path))
    future = [node for node in tree.body if isinstance(node, ast.ImportFrom) and node.module == "__future__"]
    functions = future + [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in HELPERS]
    namespace = {"math": math}
    exec(compile(ast.Module(functions, type_ignores=[]), str(source_path), "exec"), namespace)
    return namespace


H = _load_helpers()


class FishPlanHelperTests(unittest.TestCase):
    def test_omitted_lip_options_reproduce_legacy_points_and_radii(self):
        scale, snout_x, mouth_z, width, radius = 1.25, 0.04, -0.002, 0.003, 0.0004
        upper, lower = H["_lip_geometry"]({}, scale, snout_x, mouth_z, width, radius)

        self.assertEqual(upper, (
            [(snout_x - 0.0012 * scale, -width, mouth_z + 0.0005 * scale),
             (snout_x + 0.0008 * scale, 0.0, mouth_z),
             (snout_x - 0.0012 * scale, width, mouth_z + 0.0005 * scale)],
            [radius * 0.6, radius, radius * 0.6],
        ))
        self.assertEqual(lower, (
            [(snout_x - 0.0016 * scale, -width * 0.9, mouth_z - 0.0009 * scale),
             (snout_x + 0.0002 * scale, 0.0, mouth_z - 0.0011 * scale),
             (snout_x - 0.0016 * scale, width * 0.9, mouth_z - 0.0009 * scale)],
            [radius * 0.5, radius * 0.8, radius * 0.5],
        ))

    def test_lip_options_independently_shape_upper_and_lower_lips(self):
        upper, lower = H["_lip_geometry"]({
            "upperLip": {"centerOffset": [0.002, 0.001], "cornerOffset": [-0.0005, 0.0]},
            "lowerLip": {"centerOffset": [0.001, -0.002], "widthScale": 1.2,
                         "cornerRadiusScale": 0.7, "centerRadiusScale": 1.4},
        }, 1.0, 0.03, 0.0, 0.002, 0.0003)

        self.assertEqual(upper[0][1], (0.032, 0.0, 0.001))
        self.assertEqual(lower[0][1], (0.031, 0.0, -0.002))
        self.assertEqual(lower[0][0][1], -0.0024)
        for actual, expected in zip(lower[1], [0.00021, 0.00042, 0.00021]):
            self.assertAlmostEqual(actual, expected)

    def test_lip_options_reject_malformed_or_unbounded_values(self):
        cases = [
            {"upperLip": []},
            {"upperLip": {"centerOffset": [0.0]}},
            {"upperLip": {"centerOffset": [0.0, float("inf")]}},
            {"upperLip": {"widthScale": 0.0}},
            {"lowerLip": {"typo": 1.0}},
        ]
        for mouth in cases:
            with self.subTest(mouth=mouth), self.assertRaises(ValueError):
                H["_lip_geometry"](mouth, 1.0, 0.03, 0.0, 0.002, 0.0003)

    def test_distal_filament_is_opt_in_narrow_and_distal(self):
        self.assertIsNone(H["_paired_filament_options"]({"name": "pelvic"}))
        options = H["_paired_filament_options"]({
            "name": "pelvic",
            "distalFilament": {"length": 0.008, "center": 0.5, "width": 0.2,
                               "taperPower": 2.0, "distalPower": 2.0},
        })
        self.assertEqual(H["_filament_reach"](options, 0.5, 1.0), 0.008)
        self.assertEqual(H["_filament_reach"](options, 0.5, 0.0), 0.0)
        self.assertEqual(H["_filament_reach"](options, 0.25, 1.0), 0.0)
        with self.assertRaises(ValueError):
            H["_paired_filament_options"]({"name": "pelvic", "distalFilament": {"width": 0.2}})

    def test_tube_adornment_validates_curve_and_taper_contract(self):
        points, radii, segments = H["_tube_adornment_geometry"]({
            "type": "tube",
            "name": "barbel_L",
            "points": [[0.03, -0.002, -0.003], [0.034, -0.004, -0.004], [0.038, -0.006, -0.003]],
            "radii": [0.0003, 0.0002, 0.00005],
            "segments": 6,
            "bone": "Jaw",
        })
        self.assertEqual(points[-1], (0.038, -0.006, -0.003))
        self.assertEqual(radii, [0.0003, 0.0002, 0.00005])
        self.assertEqual(segments, 6)

        malformed = [
            {"type": "tube", "name": "bad", "points": [[0, 0, 0]], "radii": [0.001]},
            {"type": "tube", "name": "bad", "points": [[0, 0, 0], [1, 0, 0]], "radii": [0.001]},
            {"type": "tube", "name": "bad", "points": [[0, 0, 0], [0, 0, 0]], "radii": [0.001, 0.001]},
            {"type": "tube", "name": "bad", "points": [[0, 0, 0], [1, 0, 0]], "radii": [0.001, 0.001], "segments": 2},
            {"type": "tube", "name": "bad", "points": [[0, 0, 0], [1, 0, 0]], "radii": [0.001, 0.001], "typo": 1},
        ]
        for adornment in malformed:
            with self.subTest(adornment=adornment), self.assertRaises(ValueError):
                H["_tube_adornment_geometry"](adornment)


if __name__ == "__main__":
    unittest.main()
