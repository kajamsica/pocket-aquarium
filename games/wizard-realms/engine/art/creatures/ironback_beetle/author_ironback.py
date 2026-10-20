"""Ironback pack beetle: broad six-legged hauling mount for the Wizard Realms mount pack (asset staging only).

Silhouette: a low, wide beetle 3.9 m long and 2.7 m across the planted feet. A domed pronotum shield overhangs a
small tucked head with short down-curved mandibles and clubbed antennae; behind it five stepped, overlapping
dorsal plates with bronze rims cover the abdomen. Six jointed legs (coxa/femur/tibia/tarsus) rise beside the shell
and end in clawed pads. Tack: a low cargo saddle on the first plate just behind the pronotum rim (the rim is the
pommel), violet blanket with gold trim, two harness girths, side panniers and a bundle roll, iron stirrup pegs on the
plate rim, and two guide lines from bronze hooks on the pronotum to the rider's hands. Everything is procedural
(metaball core for the body, legs and head; parametric plates; tack sampled off the shell with a BVH).

Conventions follow ../sedgehorn_mount/author_sedgehorn.py and ../MOUNT_PACK_DESIGN_BRIEF.md: Blender +Y forward,
Z up, feet on Z=0; exported +Y up, -Z forward. Rig: Root (unkeyed), Thorax (keyed floor-solve location), Abdomen,
Head, Mandible.L/R, Antenna1/2.L/R, six legs x Coxa/Femur/Tibia/Tarsus = 34 joints. Clips Idle, Trundle, Haul are
in place; the rider gait map is riderClipMap in ironback_manifest.json.

Run on the render machine only (one headless process):
    blender -b -t 4 --factory-startup --python author_ironback.py
Outputs: ironback_beetle.blend, ironback_beetle.glb, ironback_manifest.json (design blocks are preserved)
"""
import bpy, bmesh, json, math, os, time, resource, struct, hashlib
from mathutils import Vector, Euler, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_BLEND = os.path.join(HERE, "ironback_beetle.blend")
OUT_GLB = os.path.join(HERE, "ironback_beetle.glb")
OUT_MANIFEST = os.path.join(HERE, "ironback_manifest.json")
PFX = "IB_"
TRI_BUDGET = 40000
BODY_TARGET_TRIS = 12000

# ------------------------------------------------------------------------ small helpers
def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
def lerp(a, b, t):
    return a + (b - a) * t
def deg(x):
    return math.radians(x)
def lin(a, b, n):
    return [lerp(a, b, i / (n - 1)) for i in range(n)]
def mix(c0, c1, t):
    return tuple(lerp(a, b, t) for a, b in zip(c0, c1))
def V(*a):
    return Vector(a)
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
def pl(points, y):
    """Cosine-smoothed piecewise interpolation through (y, value) control points."""
    pts = sorted(points, key=lambda p: p[0])
    if y <= pts[0][0]:
        return pts[0][1]
    for (y0, v0), (y1, v1) in zip(pts, pts[1:]):
        if y <= y1:
            t = (y - y0) / (y1 - y0)
            return lerp(v0, v1, 0.5 - 0.5 * math.cos(math.pi * t))
    return pts[-1][1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
sc = bpy.context.scene
sc.render.fps = 24
COLL = bpy.data.collections.new("IronbackBeetle")
sc.collection.children.link(COLL)
def dg():
    return bpy.context.evaluated_depsgraph_get()

# ------------------------------------------------------------------------ materials
def mat_principled(name, color, rough=0.6, metallic=0.0, sheen=0.0, bump=0.0, bump_scale=40.0, vcol=False, emission=None, emission_strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if emission is not None and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if vcol:
        vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    if bump:
        tex = nt.nodes.new("ShaderNodeTexNoise"); tex.inputs["Scale"].default_value = bump_scale; tex.inputs["Detail"].default_value = 4.0
        bn = nt.nodes.new("ShaderNodeBump"); bn.inputs["Strength"].default_value = bump; bn.inputs["Distance"].default_value = 0.002
        nt.links.new(tex.outputs["Fac"], bn.inputs["Height"]); nt.links.new(bn.outputs["Normal"], bsdf.inputs["Normal"])
    m.use_backface_culling = False
    return m
M_chitin = mat_principled(PFX + "chitin", (1.0, 1.0, 1.0), rough=0.55, sheen=0.05, bump=0.15, bump_scale=60, vcol=True)   # white x COLOR_0
M_shell = mat_principled(PFX + "shell_iron", (0.09, 0.11, 0.16), rough=0.32, metallic=0.25, bump=0.08, bump_scale=25)
M_rim = mat_principled(PFX + "rim_bronze", (0.55, 0.36, 0.16), rough=0.40, metallic=1.0)
M_claw = mat_principled(PFX + "claw", (0.10, 0.09, 0.08), rough=0.40, bump=0.08, bump_scale=120)
M_eye = mat_principled(PFX + "eye_compound", (0.05, 0.05, 0.07), rough=0.18, bump=0.5, bump_scale=300)
M_saddle = mat_principled(PFX + "saddle_leather", (0.30, 0.15, 0.07), rough=0.5, bump=0.1, bump_scale=60)
M_strap = mat_principled(PFX + "strap_leather", (0.15, 0.075, 0.035), rough=0.55, bump=0.1, bump_scale=60)
M_blanket = mat_principled(PFX + "blanket_violet", (0.17, 0.07, 0.46), rough=0.85, sheen=0.35, bump=0.18, bump_scale=90)
M_trim = mat_principled(PFX + "trim_gold", (0.80, 0.55, 0.16), rough=0.38, metallic=1.0)
M_iron = mat_principled(PFX + "iron", (0.45, 0.45, 0.47), rough=0.4, metallic=1.0)
M_canvas = mat_principled(PFX + "pannier_canvas", (0.42, 0.36, 0.26), rough=0.9, sheen=0.3, bump=0.25, bump_scale=80)

def new_mesh_object(name, verts, faces, mats, mat_idx=None):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    for m in mats:
        me.materials.append(m)
    if mat_idx is not None:
        for p, mi in zip(me.polygons, mat_idx):
            p.material_index = mi
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me); COLL.objects.link(ob)
    return ob

# ------------------------------------------------------------------------ geometry helpers
def loft(rings, cap_start=False, cap_end=False):
    verts, faces = [], []
    n = len(rings[0])
    for r in rings:
        verts.extend(r)
    for i in range(len(rings) - 1):
        for k in range(n):
            a = i * n + k; b = i * n + (k + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap_start:
        faces.append(tuple(reversed(range(n))))
    if cap_end:
        faces.append(tuple((len(rings) - 1) * n + k for k in range(n)))
    return verts, faces
def frames_along(points):
    T = []
    for i in range(len(points)):
        a = points[max(i - 1, 0)]; b = points[min(i + 1, len(points) - 1)]
        T.append((b - a).normalized())
    N = T[0].cross(V(0, 0, 1))
    if N.length < 1e-3:
        N = T[0].cross(V(1, 0, 0))
    N.normalize(); out = []
    for t in T:
        N = (N - t * N.dot(t)).normalized(); out.append((t, N, t.cross(N)))
    return out
def tube(points, radii, n=12, caps=(True, True), ru_rv=None):
    rings = []
    for i, (p, (t, N, B)) in enumerate(zip(points, frames_along(points))):
        ru, rv = (radii[i], radii[i]) if ru_rv is None else ru_rv[i]
        rings.append([p + N * ru * math.cos(a) + B * rv * math.sin(a) for a in (2 * math.pi * k / n for k in range(n))])
    return loft(rings, *caps)
def catmull(pts, samples):
    out = []
    P = [pts[0]] + list(pts) + [pts[-1]]
    for i in range(1, len(P) - 2):
        for k in range(samples):
            t = k / samples
            p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(pts[-1])
    return out
def grid_faces(rows, cols, outward_test=None, verts=None):
    faces = []
    for r in range(rows - 1):
        for c in range(cols - 1):
            a = r * cols + c
            faces.append((a, a + 1, a + cols + 1, a + cols))
    if outward_test is not None and verts is not None:
        a, b, c = (verts[i] for i in faces[0][:3])
        nrm = (b - a).cross(c - a)
        if nrm.dot(outward_test) < 0:
            faces = [tuple(reversed(f)) for f in faces]
    return faces
def sphere_part(center, radius, scale=(1, 1, 1), u=14, v=8):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius)
    bmesh.ops.scale(bm, verts=bm.verts, vec=V(*scale))
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(center)); bm.verts.ensure_lookup_table()
    out = ([v.co.copy() for v in bm.verts], [tuple(v.index for v in f.verts) for f in bm.faces]); bm.free()
    return out
def box_part(center, size):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=V(*size)); bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(center)); bm.verts.ensure_lookup_table()
    out = ([v.co.copy() for v in bm.verts], [tuple(v.index for v in f.verts) for f in bm.faces]); bm.free()
    return out
class Parts:
    def __init__(self):
        self.v = []; self.f = []
    def add(self, v, f):
        base = len(self.v); self.v.extend(v); self.f.extend(tuple(i + base for i in face) for face in f)

def bvh_of(objects):
    """BVH over the evaluated (modifier-applied) meshes of several objects, all at identity transforms."""
    bpy.context.view_layer.update(); d = dg()
    bm = bmesh.new()
    for ob in objects:
        ev = ob.evaluated_get(d); me = ev.to_mesh(); bm.from_mesh(me); ev.to_mesh_clear()
    tree = BVHTree.FromBMesh(bm); bm.free()
    return tree
def outer_hit(bvh, origin, direction, reach=5.0):
    """Outermost surface along a ray from `origin`: cast inward from far outside so stacked shells resolve to the top one."""
    d = Vector(direction).normalized()
    loc, nrm, idx, dist = bvh.ray_cast(Vector(origin) + d * reach, -d, reach * 2)
    return loc, nrm
def top_hit(bvh, x, y):
    loc, nrm = outer_hit(bvh, (x, y, 0.0), (0, 0, 1))
    return loc, nrm
def signed_clearance(bvh, p):
    loc, nrm, idx, dist = bvh.find_nearest(Vector(p))
    if loc is None:
        return 9.0
    return dist if nrm.dot(Vector(p) - loc) > 0 else -dist

# ------------------------------------------------------------------------ metaball core -> mesh
def meta_mesh(elements, name, res, threshold=0.6):
    mb = bpy.data.metaballs.new(name); mb.resolution = res; mb.render_resolution = res; mb.threshold = threshold
    for kind, co, size, aim in elements:
        el = mb.elements.new(); el.type = kind; el.co = co; el.radius = 1.0 / K_META
        if kind == 'ELLIPSOID':
            el.size_x, el.size_y, el.size_z = size
            if aim is not None:
                el.rotation = V(0, 1, 0).rotation_difference(aim.normalized())
        else:
            el.radius = size[0] / K_META
    ob = bpy.data.objects.new(name + "_mb", mb); COLL.objects.link(ob)
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg()))
    bpy.data.objects.remove(ob); bpy.data.metaballs.remove(mb)
    return me
K_META = 1.0
cal = meta_mesh([('BALL', V(0, 0, 0), (1.0, 1.0, 1.0), None)], "cal", 0.02)
K_META = max(v.co.x for v in cal.vertices); bpy.data.meshes.remove(cal)
cal2 = meta_mesh([('ELLIPSOID', V(0, 0, 0), (1.0, 2.0, 0.5), None)], "cal2", 0.02)
CAL_ELL = [round(max(abs(v.co[i]) for v in cal2.vertices), 3) for i in range(3)]; bpy.data.meshes.remove(cal2)

ELEMENTS = []
def E(co, a, b, c, aim=None):
    ELEMENTS.append(('ELLIPSOID', V(*co), (a, b, c), V(*aim) if aim else None))
def S(co, r):
    ELEMENTS.append(('BALL', V(*co), (r, r, r), None))
# body masses (all hidden under the plates except the underside, flanks, head and legs)
E((0, 0.55, 0.82), 0.62, 0.52, 0.42)                      # thorax
E((0, -0.45, 0.85), 0.76, 0.80, 0.44)                     # fore abdomen
E((0, -1.15, 0.70), 0.50, 0.50, 0.26)                     # rear abdomen taper
E((0, 1.12, 0.70), 0.34, 0.20, 0.26)                      # neck bridge under the pronotum
E((0, 1.40, 0.66), 0.30, 0.28, 0.24)                      # head capsule
E((0, 1.62, 0.60), 0.20, 0.14, 0.13)                      # clypeus / front of the face
# legs: joint chains (right side; x mirrored), radii per joint. Chain = attach, coxa end, knee, ankle, foot
LEGS = {
    "Fore": ([V(0.42, 0.78, 0.60), V(0.62, 0.84, 0.72), V(0.98, 0.98, 1.08), V(1.18, 1.08, 0.40), V(1.24, 1.14, 0.045)], [0.17, 0.15, 0.13, 0.075, 0.05]),
    "Mid": ([V(0.48, 0.05, 0.58), V(0.68, 0.05, 0.70), V(1.08, 0.04, 1.08), V(1.30, 0.00, 0.40), V(1.36, -0.02, 0.045)], [0.18, 0.16, 0.14, 0.08, 0.05]),
    "Hind": ([V(0.46, -0.62, 0.60), V(0.66, -0.72, 0.70), V(1.02, -0.90, 1.10), V(1.24, -1.04, 0.40), V(1.30, -1.10, 0.045)], [0.17, 0.15, 0.13, 0.075, 0.05]),
}
def leg_balls(joints, radii, sign):
    for j in range(len(joints) - 1):
        a, b = joints[j], joints[j + 1]
        steps = max(2, int((b - a).length / 0.08))
        for k in range(steps + (1 if j == len(joints) - 2 else 0)):
            t = k / steps
            p = a.lerp(b, t); r = lerp(radii[j], radii[j + 1], t)
            if j in (1, 2) and k == 0:
                r *= 1.15                                           # knee / ankle knuckle
            S((sign * p.x, p.y, p.z), r)
for sign in (-1, 1):
    for joints, radii in LEGS.values():
        leg_balls(joints, radii, sign)

core = meta_mesh(ELEMENTS, PFX + "core", 0.05)
core_ob = bpy.data.objects.new(PFX + "core_raw", core); COLL.objects.link(core_ob)
m_smooth = core_ob.modifiers.new("Smooth", 'SMOOTH'); m_smooth.factor = 0.6; m_smooth.iterations = 4
raw_tris = sum(len(p.vertices) - 2 for p in core.polygons)
m_dec = core_ob.modifiers.new("Decimate", 'DECIMATE'); m_dec.ratio = min(1.0, BODY_TARGET_TRIS / max(1, raw_tris)); m_dec.use_collapse_triangulate = True
bpy.context.view_layer.update()
body_me = bpy.data.meshes.new_from_object(core_ob.evaluated_get(dg()))
bpy.data.objects.remove(core_ob); bpy.data.meshes.remove(core)
body_me.name = PFX + "body"
for p in body_me.polygons:
    p.use_smooth = True
body_me.materials.append(M_chitin)
body = bpy.data.objects.new(PFX + "body", body_me); COLL.objects.link(body)
BODY_BVH = bvh_of([body])

# chitin colours baked to COLOR_0: umber underbelly and legs, darker leg tips, blue-black head, bronze-brown knee knuckles
BELLY, FLANK, TIP, HEAD_C, KNUCKLE = (0.17, 0.125, 0.085), (0.12, 0.10, 0.09), (0.07, 0.06, 0.055), (0.07, 0.08, 0.11), (0.30, 0.20, 0.10)
col = body_me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
for v in body_me.vertices:
    co = v.co
    c = mix(FLANK, BELLY, smooth(0.75, 0.40, co.z))
    c = mix(c, TIP, smooth(0.55, 0.12, co.z) * (1.0 if abs(co.x) > 0.8 else 0.0))
    c = mix(c, KNUCKLE, smooth(0.95, 1.08, co.z) * (1.0 if abs(co.x) > 0.8 else 0.0))
    c = mix(c, HEAD_C, smooth(1.05, 1.25, co.y))
    col.data[v.index].color = (*c, 1.0)
body_me.color_attributes.active_color = col

# ------------------------------------------------------------------------ feet: clawed pads (lowest points define the floor)
FOOT_PTS = {}
feet_parts = Parts(); FOOT_GROUP_RANGES = []
for prefix, (joints, radii) in LEGS.items():
    for sign, side in ((-1, "L"), (1, "R")):
        fp = V(sign * joints[-1].x, joints[-1].y, joints[-1].z); FOOT_PTS[prefix + "." + side] = fp
        start = len(feet_parts.v)
        pad_c = V(fp.x, fp.y, 0.045)
        feet_parts.add(*sphere_part(pad_c, 0.075, scale=(1.0, 1.1, 0.6)))
        out = V(sign, 0.0, 0.0)
        fwd = (V(fp.x, fp.y, 0) - V(sign * joints[0].x, joints[0].y, 0)).normalized()        # claws point away from the body
        for k in (-1, 1):
            side_v = fwd.cross(V(0, 0, 1)) * (0.035 * k)
            ctrl = [pad_c + fwd * 0.03 + side_v + V(0, 0, 0.02), pad_c + fwd * 0.10 + side_v * 1.3 + V(0, 0, 0.03), pad_c + fwd * 0.17 + side_v * 1.5 + V(0, 0, -0.045)]
            pts = catmull(ctrl, 4)
            feet_parts.add(*tube(pts, [lerp(0.028, 0.006, i / (len(pts) - 1)) for i in range(len(pts))], n=8))
        FOOT_GROUP_RANGES.append((prefix + "." + side, start, len(feet_parts.v)))
feet = new_mesh_object(PFX + "feet", feet_parts.v, feet_parts.f, [M_claw])
FOOT_GROUP = {}
for key, a, b in FOOT_GROUP_RANGES:
    for i in range(a, b):
        FOOT_GROUP[i] = key

# ------------------------------------------------------------------------ shell: pronotum + five stepped plates (parametric, solidified)
PRONOTUM_PROF = {"top": lambda y: pl([(1.08, 1.22), (0.60, 1.54), (0.18, 1.56)], y),      # rear lip clears plate1 (1.48 + 0.045 shell) by ~3 cm
                 "w": lambda y: pl([(1.08, 0.56), (0.60, 0.80), (0.18, 0.84)], y),
                 "rim": lambda y: pl([(1.08, 0.72), (0.60, 0.56), (0.18, 0.52)], y)}
ABDOMEN_PROF = {"top": lambda y: pl([(0.30, 1.48), (-0.30, 1.47), (-0.80, 1.40), (-1.20, 1.28), (-1.60, 1.08), (-1.80, 0.95)], y),
                "w": lambda y: pl([(0.30, 0.84), (-0.40, 0.92), (-0.90, 0.86), (-1.30, 0.70), (-1.60, 0.52), (-1.80, 0.36)], y),
                "rim": lambda y: pl([(0.30, 0.52), (-0.80, 0.50), (-1.30, 0.50), (-1.80, 0.58)], y)}
def plate(name, y_front, y_back, step, prof, rows=13, cols=25, theta_max=deg(90), lip=0.02, centre=None, thickness=0.04):
    verts = []; mat_idx = []
    for r in range(rows):
        t = r / (rows - 1); y = lerp(y_front, y_back, t)
        top = prof["top"](y) - step; rim = prof["rim"](y); W = prof["w"](y) * (1.0 + lip * smooth(0.6, 1.0, t))
        H = top - rim
        for c in range(cols):
            s = -1 + 2 * c / (cols - 1); a = theta_max * math.copysign(abs(s) ** 0.8, s)
            ca = math.cos(a)
            x = W * math.sin(a); z = rim + H * math.copysign(abs(ca) ** 0.8, ca)
            if centre:
                z += centre(x, t)
            verts.append(V(x, y, z))
    faces = grid_faces(rows, cols, outward_test=V(0, 0, 1), verts=verts)
    for f in faces:
        a = min(f); r = a // cols; c = a % cols
        mat_idx.append(1 if (r == rows - 2 or c == 0 or c == cols - 2) else 0)        # rear edge and side rims in bronze
    ob = new_mesh_object(name, verts, faces, [M_shell, M_rim], mat_idx)
    sol = ob.modifiers.new("Solidify", 'SOLIDIFY'); sol.thickness = thickness; sol.offset = 1.0; sol.use_even_offset = True
    return ob
seam = lambda x, t: -0.012 * math.exp(-(x / 0.04) ** 2)                      # elytra seam groove on the abdomen plates
keel = lambda x, t: 0.035 * math.exp(-(x / 0.12) ** 2) * (1 - 0.6 * t)          # pronotum central keel fading rearward
pronotum = plate(PFX + "pronotum", 1.08, 0.18, 0.0, PRONOTUM_PROF, rows=15, cols=27, lip=0.0, centre=keel, thickness=0.045)
PLATE_SPECS = [("plate1", 0.30, -0.25, 0.00), ("plate2", -0.17, -0.72, 0.05), ("plate3", -0.64, -1.19, 0.10), ("plate4", -1.11, -1.58, 0.15), ("plate5", -1.50, -1.80, 0.20)]
plates = [plate(PFX + n, yf, yb, st, ABDOMEN_PROF, centre=seam) for n, yf, yb, st in PLATE_SPECS]
plate1 = plates[0]
SHELL_BVH = bvh_of([pronotum] + plates)
UNION_BVH = bvh_of([body, pronotum] + plates)

# ------------------------------------------------------------------------ head details: mandibles, antennae, compound eyes
mand = Parts()
for sign in (-1, 1):
    ctrl = [V(sign * 0.15, 1.70, 0.55), V(sign * 0.21, 1.88, 0.50), V(sign * 0.15, 2.02, 0.46), V(sign * 0.04, 2.10, 0.43)]
    pts = catmull(ctrl, 5)
    mand.add(*tube(pts, [lerp(0.055, 0.010, (i / (len(pts) - 1)) ** 0.8) for i in range(len(pts))], n=10))
mandibles = new_mesh_object(PFX + "mandibles", mand.v, mand.f, [M_claw])
ANT_BASE, ANT_MID, ANT_TIP = V(0.22, 1.58, 0.80), V(0.36, 1.72, 0.98), V(0.52, 1.84, 1.16)
ant = Parts()
for sign in (-1, 1):
    pts = catmull([V(sign * p.x, p.y, p.z) for p in (ANT_BASE, ANT_MID, ANT_TIP)], 5)
    ant.add(*tube(pts, [lerp(0.035, 0.014, i / (len(pts) - 1)) for i in range(len(pts))], n=8))
    club_c = V(sign * ANT_TIP.x, ANT_TIP.y, ANT_TIP.z) + V(sign * 0.05, 0.04, 0.05)
    ant.add(*sphere_part(club_c, 0.07, scale=(0.75, 1.3, 0.5)))
antennae = new_mesh_object(PFX + "antennae", ant.v, ant.f, [M_claw])
eye = Parts()
for sign in (-1, 1):
    eye.add(*sphere_part(V(sign * 0.27, 1.40, 0.72), 0.085, scale=(0.8, 1.0, 1.0), u=16, v=10))
eyes = new_mesh_object(PFX + "eyes", eye.v, eye.f, [M_eye])

# ------------------------------------------------------------------------ tack sampled off the shell
AXIS_Z = 0.85
def shell_on(name, bvh, ys, angles, offset, mats, rise=None, thickness=0.012, trim_border=False):
    verts = []; mat_idx = []
    for r, y in enumerate(ys):
        for c, a in enumerate(angles):
            d = V(math.sin(a), 0, math.cos(a))
            loc, nrm = outer_hit(bvh, (0, y, AXIS_Z), d)
            if loc is None:
                loc = V(0, y, AXIS_Z) + d * 0.6
            p = loc + d * offset
            if rise:
                p.z += rise(r, a)
            verts.append(p)
    faces = grid_faces(len(ys), len(angles), outward_test=V(0, 0, 1), verts=verts)
    if trim_border:
        for f in faces:
            a0 = min(f); r = a0 // len(angles); c = a0 % len(angles)
            mat_idx.append(1 if (r == 0 or r == len(ys) - 2 or c == 0 or c == len(angles) - 2) else 0)
    ob = new_mesh_object(name, verts, faces, mats, mat_idx if trim_border else None)
    sol = ob.modifiers.new("Solidify", 'SOLIDIFY'); sol.thickness = thickness; sol.offset = -1.0; sol.use_even_offset = True
    return ob, verts
PLATE1_BVH = bvh_of([plate1])
blanket, _ = shell_on(PFX + "blanket", PLATE1_BVH, lin(-0.30, 0.14, 9), [deg(a) for a in lin(-66, 66, 17)], 0.018, [M_blanket, M_trim], trim_border=True)
SADDLE_YS = lin(-0.20, 0.10, 11); SADDLE_AS = [deg(a) for a in lin(-48, 48, 15)]        # stays on plate 1 and ends 8 cm short of the pronotum rear lip (y=0.18)
def saddle_rise(r, a):
    pommel = 0.05 * smooth(8.0, 10.0, r) * max(0.0, 1 - (a / deg(24)) ** 2)          # low pommel: the pronotum rim does the real job
    cantle = 0.10 * smooth(2.5, 0.0, r) * max(0.0, 1 - (a / deg(44)) ** 2)           # broad cantle for the hauling seat
    rear_corner_clearance = 0.02 * smooth(2.5, 0.0, r)
    return pommel + cantle + rear_corner_clearance
saddle, saddle_verts = shell_on(PFX + "saddle", PLATE1_BVH, SADDLE_YS, SADDLE_AS, 0.075, [M_saddle], rise=saddle_rise, thickness=0.025)
SEAT = saddle_verts[5 * len(SADDLE_AS) + 7].copy()
_seat_hit = top_hit(PLATE1_BVH, 0.0, SEAT.y)[0]
SEAT_PLATE_Z = _seat_hit.z if _seat_hit else None

# girths: two full loops over the blanket and under the belly; cargo loop over the bags added after the bags exist
def ring_loop(bvh, y, offset, n=40, z_axis=AXIS_Z):
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        d = V(math.sin(a), 0, math.cos(a))
        loc, nrm = outer_hit(bvh, (0, y, z_axis), d)
        pts.append((loc + d * offset) if loc else V(0, y, z_axis) + d * 0.6)
    pts.append(pts[0])
    return pts
TACK_BVH = bvh_of([body, pronotum, saddle, blanket] + plates)
girth = Parts()
for y in (-0.20, 0.04):
    ring = ring_loop(TACK_BVH, y, 0.018)
    girth.add(*tube(ring, None, n=8, caps=(False, False), ru_rv=[(0.012, 0.04)] * len(ring)))
girths = new_mesh_object(PFX + "girths", girth.v, girth.f, [M_strap])

# stirrup pegs on the plate rim: bracket from the plate surface up to an iron tread
STIRRUP_X, STIRRUP_Y = 0.74, -0.06
STIRRUPS = {}
pegs = Parts()
for sign, side in ((-1, "L"), (1, "R")):
    loc, nrm = top_hit(PLATE1_BVH, sign * STIRRUP_X, STIRRUP_Y)
    base = (loc if loc else V(sign * STIRRUP_X, STIRRUP_Y, 0.9)) + V(sign * 0.09, 0, 0.030)
    tread_top = base + V(sign * 0.10, 0, -0.13)
    pegs.add(*tube([base, tread_top], [0.022, 0.022], n=10))
    pegs.add(*box_part(tread_top - V(0, 0, 0.008), (0.16, 0.11, 0.016)))
    pegs.add(*tube([tread_top + V(sign * 0.08, -0.05, 0.0), tread_top + V(sign * 0.08, -0.05, 0.12), tread_top + V(sign * 0.08, 0.05, 0.12), tread_top + V(sign * 0.08, 0.05, 0.0)], [0.008] * 4, n=6, caps=(False, False)))
    STIRRUPS[side] = tread_top.copy()
stirrups = new_mesh_object(PFX + "stirrup_pegs", pegs.v, pegs.f, [M_iron])

# cargo: soft panniers resting on the plate2/3 slopes, bundle roll behind the cantle, cargo girth over them
PACK = {}
cargo = Parts()
for sign, side in ((-1, "L"), (1, "R")):
    loc, nrm = outer_hit(SHELL_BVH, (0, -0.62, AXIS_Z), V(sign * 0.78, 0, 0.62))
    centre = (loc + nrm.normalized() * 0.255) if loc else V(sign * 0.92, -0.62, 1.1)      # bag radius 0.216 lateral: rests on the plate without sinking in
    PACK[side] = centre.copy()
    cargo.add(*sphere_part(centre, 0.30, scale=(0.72, 1.0, 0.85), u=18, v=12))
    cargo.add(*sphere_part(centre + V(0, 0, 0.24), 0.17, scale=(1.1, 1.35, 0.35), u=14, v=8))          # rolled flap over the bag mouth
pannier = new_mesh_object(PFX + "panniers", cargo.v, cargo.f, [M_canvas])
_roll_hit = top_hit(SHELL_BVH, 0.0, -0.44)[0]
roll_z = (_roll_hit.z if _roll_hit else 1.40) + 0.135
roll_pts = [V(x, -0.44, roll_z) for x in lin(-0.46, 0.46, 7)]
rv, rf = tube(roll_pts, [0.10, 0.125, 0.13, 0.13, 0.13, 0.125, 0.10], n=14)
bundle = new_mesh_object(PFX + "bundle", rv, rf, [M_canvas])
CARGO_BVH = bvh_of([body, pronotum, pannier, bundle] + plates)
cg = Parts()
for y in (-0.62, -0.44):
    ring = ring_loop(CARGO_BVH, y, 0.016)
    cg.add(*tube(ring, None, n=8, caps=(False, False), ru_rv=[(0.012, 0.035)] * len(ring)))
cargo_straps = new_mesh_object(PFX + "cargo_straps", cg.v, cg.f, [M_strap])

# guide lines: bronze hooks on the pronotum front rim, lines back to the rider's hands, pushed clear of the shell
REIN_HAND = {"L": V(-0.17, SEAT.y + 0.22, SEAT.z + 0.32), "R": V(0.17, SEAT.y + 0.22, SEAT.z + 0.32)}
REIN_R = 0.011
lines = Parts(); hooks = Parts(); REIN_CLEAR = []
for side, sign in (("L", -1), ("R", 1)):
    hloc, hnrm = top_hit(SHELL_BVH, sign * 0.40, 0.95)
    hook = (hloc + V(0, 0, 0.02)) if hloc else V(sign * 0.40, 0.95, 1.40)
    ring = [hook + V(0, 0.03 * math.cos(a), 0.03 * math.sin(a)) + V(0, 0, 0.03) for a in lin(0, 2 * math.pi, 17)]
    hooks.add(*tube(ring, [0.008] * len(ring), n=6, caps=(False, False)))
    ctrl = [hook + V(0, 0, 0.05), V(sign * 0.42, 0.72, hook.z + 0.14), V(sign * 0.36, 0.45, SEAT.z + 0.12), REIN_HAND[side]]
    fixed = []
    for p in catmull(ctrl, 6):
        loc, nrm, idx, dist = SHELL_BVH.find_nearest(p)
        if loc is not None and (nrm.dot(p - loc) < 0 or dist < REIN_R + 0.012):
            p = loc + nrm * (REIN_R + 0.012)
        fixed.append(p)
    for p in fixed:
        REIN_CLEAR.append(round(signed_clearance(SHELL_BVH, p) - REIN_R, 4))
    lines.add(*tube(fixed, [REIN_R] * len(fixed), n=8))
reins = new_mesh_object(PFX + "guide_lines", lines.v, lines.f, [M_strap])
hook_ob = new_mesh_object(PFX + "hooks", hooks.v, hooks.f, [M_rim])

# ------------------------------------------------------------------------ rig
BONE_SPECS = [
    ("Root", None, (0, 0, 0), (0, 0.25, 0)),
    ("Thorax", "Root", (0, -0.10, 0.90), (0, 0.70, 0.92)),
    ("Abdomen", "Thorax", (0, -0.10, 0.90), (0, -1.40, 0.78)),
    ("Head", "Thorax", (0, 1.12, 0.68), (0, 1.70, 0.56)),
]
for sign, side in ((-1, "L"), (1, "R")):
    BONE_SPECS.append((f"Mandible.{side}", "Head", (sign * 0.15, 1.70, 0.55), (sign * 0.04, 2.10, 0.43)))
    BONE_SPECS.append((f"Antenna1.{side}", "Head", (sign * ANT_BASE.x, ANT_BASE.y, ANT_BASE.z), (sign * ANT_MID.x, ANT_MID.y, ANT_MID.z)))
    BONE_SPECS.append((f"Antenna2.{side}", f"Antenna1.{side}", (sign * ANT_MID.x, ANT_MID.y, ANT_MID.z), (sign * ANT_TIP.x + sign * 0.05, ANT_TIP.y + 0.04, ANT_TIP.z + 0.05)))
    for prefix, (joints, radii) in LEGS.items():
        j = [V(sign * p.x, p.y, p.z) for p in joints]
        names = ["Coxa", "Femur", "Tibia", "Tarsus"]
        for i, nm in enumerate(names):
            BONE_SPECS.append((f"{prefix}{nm}.{side}", "Thorax" if i == 0 else f"{prefix}{names[i - 1]}.{side}", tuple(j[i]), tuple(j[i + 1])))
BONE_SEG = {n: (Vector(h), Vector(t)) for n, _, h, t in BONE_SPECS}
def falloff_for(name):
    base = name.split(".")[0]
    table = {"Root": 0.01, "Thorax": (0.75, 0.75, 0.55), "Abdomen": (0.85, 1.0, 0.55), "Head": 0.36, "Mandible": 0.08, "Antenna1": 0.07, "Antenna2": 0.09}
    if base in table:
        return table[base]
    for seg, r in (("Coxa", 0.20), ("Femur", 0.17), ("Tibia", 0.12), ("Tarsus", 0.10)):
        if base.endswith(seg):
            return r
    return 0.2
arm_data = bpy.data.armatures.new("IronbackArmature")
RIG = bpy.data.objects.new("IronbackRig", arm_data); COLL.objects.link(RIG)
bpy.context.view_layer.objects.active = RIG; RIG.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, parent, head, tail in BONE_SPECS:
    b = arm_data.edit_bones.new(name); b.head, b.tail = head, tail
    if parent:
        b.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT'); RIG.select_set(False)
for pb in RIG.pose.bones:
    pb.rotation_mode = 'QUATERNION'
BONE_B = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}
Q_ID = Quaternion()
def rot(bone, world_axis, angle):
    """Local quaternion rotating `bone` about a world/armature axis (valid while its parents are near rest)."""
    axis = (BONE_B[bone].transposed() @ Vector(world_axis)).normalized()
    return Quaternion(axis, angle)
def Q(*qs):
    out = Quaternion()
    for q in qs:
        out = out @ q
    return out
BODY_BONE = "Thorax"
def body_loc(lift):
    return tuple(BONE_B[BODY_BONE].transposed() @ Vector((0.0, 0.0, lift)))

def bone_weight(co, name):
    h, t = BONE_SEG[name]; r = falloff_for(name)
    ab = t - h; l2 = ab.length_squared
    s = max(0.0, min(1.0, (co - h).dot(ab) / l2)) if l2 else 0.0
    p = co - (h + ab * s)
    d2 = (p.x / r[0]) ** 2 + (p.y / r[1]) ** 2 + (p.z / r[2]) ** 2 if isinstance(r, tuple) else p.length_squared / (r * r)
    return math.exp(-d2)
def skin(ob, allowed, max_inf=4):
    groups = {}
    for v in ob.data.vertices:
        names = allowed(v.co) if callable(allowed) else allowed
        ws = sorted(((bone_weight(v.co, n), n) for n in names), reverse=True)[:max_inf]
        tot = sum(w for w, _ in ws) or 1.0
        kept = [(w / tot, n) for w, n in ws if w / tot >= 0.02]
        tot2 = sum(w for w, _ in kept) or 1.0
        if not kept:
            kept = [(1.0, names[0])]
        for w, n in kept:
            groups.setdefault(n, []).append((v.index, w / tot2))
    for n, items in groups.items():
        vg = ob.vertex_groups.new(name=n)
        for idx, w in items:
            vg.add([idx], w, 'REPLACE')
    mod = ob.modifiers.new("Armature", 'ARMATURE'); mod.object = RIG
    ob.parent = RIG
def side_of(co):
    return "R" if co.x > 0 else "L"
def leg_prefix(co):
    return min(LEGS, key=lambda k: abs(LEGS[k][0][0].y - co.y))
def leg_bones(co):
    p = leg_prefix(co); s = side_of(co)
    return [f"{p}{n}.{s}" for n in ("Coxa", "Femur", "Tibia", "Tarsus")]
body_bones = ["Thorax", "Abdomen", "Head"] + [f"{p}{n}.{s}" for p in LEGS for s in ("L", "R") for n in ("Coxa", "Femur", "Tibia", "Tarsus")]
skin(body, body_bones)
skin(feet, lambda co: leg_bones(co)[2:])
skin(mandibles, lambda co: ["Mandible." + side_of(co), "Head"])
skin(antennae, lambda co: ["Antenna2." + side_of(co), "Antenna1." + side_of(co)])
skin(eyes, ["Head"])
for ob in (pronotum, plate1, saddle, blanket, girths, stirrups, reins, hook_ob):
    skin(ob, ["Thorax"])
for ob in plates[1:] + [pannier, bundle, cargo_straps]:
    skin(ob, ["Abdomen"])

REFS = {}
def ref_node(name, bone, point, role):
    e = bpy.data.objects.new(name, None); COLL.objects.link(e)
    e.empty_display_type = 'PLAIN_AXES'; e.empty_display_size = 0.05
    e.parent = RIG; e.parent_type = 'BONE'; e.parent_bone = bone
    bpy.context.view_layer.update()
    e.matrix_world = Matrix.Translation(Vector(point)); e["role"] = role
    REFS[name] = e; return e
ref_node("Seat", "Thorax", SEAT, "rider_seat")
ref_node("Stirrup.L", "Thorax", STIRRUPS["L"], "rider_stirrup")
ref_node("Stirrup.R", "Thorax", STIRRUPS["R"], "rider_stirrup")
ref_node("ReinHand.L", "Thorax", REIN_HAND["L"], "rider_rein_hand")
ref_node("ReinHand.R", "Thorax", REIN_HAND["R"], "rider_rein_hand")
ref_node("Pack.L", "Abdomen", PACK["L"], "cargo_socket")
ref_node("Pack.R", "Abdomen", PACK["R"], "cargo_socket")

# ------------------------------------------------------------------------ clips: Idle, Trundle, Haul (in place, floor solved)
ANIM_BONES = [n for n, _, _, _ in BONE_SPECS if n != "Root"]
def apply_pose(pose, loc):
    for name in ANIM_BONES:
        RIG.pose.bones[name].rotation_quaternion = pose.get(name, Q_ID)
    RIG.pose.bones[BODY_BONE].location = loc
    RIG.update_tag(); bpy.context.view_layer.update()
def feet_lowest(pose, loc):
    apply_pose(pose, loc)
    ev = feet.evaluated_get(dg()); m = ev.to_mesh()
    zs = {}
    for v in m.vertices:
        k = FOOT_GROUP[v.index]; zs[k] = min(zs.get(k, 9.0), v.co.z)
    ev.to_mesh_clear()
    return zs
_a = feet_lowest({}, body_loc(0.0)); _b = feet_lowest({}, body_loc(0.10))
LIFT_PROBE = sum(_b[k] - _a[k] for k in _a) / len(_a)
if abs(LIFT_PROBE - 0.10) > 1e-3:                       # analytic axis failed: fall back to probing the bone-local axis like the Sedgehorn
    _probe = {ax: feet_lowest({}, tuple(0.1 if i == ax else 0.0 for i in range(3))) for ax in range(3)}
    UP_AXIS = max(range(3), key=lambda ax: abs(sum(_probe[ax][k] - _a[k] for k in _a)))
    UP_SIGN = 1.0 if sum(_probe[UP_AXIS][k] - _a[k] for k in _a) > 0 else -1.0
    def body_loc(lift):
        return tuple(UP_SIGN * lift if i == UP_AXIS else 0.0 for i in range(3))
    _b = feet_lowest({}, body_loc(0.10)); LIFT_PROBE = sum(_b[k] - _a[k] for k in _a) / len(_a)
def floored(raw_fn):
    cache = {}
    def fn(phase):
        if phase not in cache:
            pose, g, extra = raw_fn(phase)
            zs = feet_lowest(pose, body_loc(0.0))
            lift = max(-min(zs.values()) * g + extra, -min(zs.values()))
            cache[phase] = (pose, body_loc(lift), zs, lift)
        return cache[phase][:2]
    fn.cache = cache
    return fn

LIFT_AXIS = {"R": (0, -1, 0), "L": (0, 1, 0)}            # out x up: positive angle raises the leg tip on either side
def leg_cycle(ph, swing, amp, lift):
    """(coxa yaw, femur lift, tibia fold) for one leg. Stance retracts the coxa from +amp to -amp with the leg held, so the planted
    foot keeps its height; swing protracts it while the femur lifts and the tibia folds the foot in under the knee."""
    ph %= 1.0
    if ph < swing:
        q = ph / swing; bell = math.sin(math.pi * q)
        return -amp + 2 * amp * smooth(0.0, 1.0, q), 0.55 * lift * bell, -0.75 * lift * bell
    q = (ph - swing) / (1 - swing)
    return amp - 2 * amp * q, 0.0, 0.0
def legs_pose(phases, swing, amp, lift, stance=(0.0, 0.0)):
    pose = {}
    for key, ph in phases.items():
        prefix, side = key.split("."); sign = 1 if side == "R" else -1
        yaw, fem, tib = leg_cycle(ph, swing, amp[prefix], lift)
        fem += stance[0]; tib += stance[1]
        pose[f"{prefix}Coxa.{side}"] = rot(f"{prefix}Coxa.{side}", (0, 0, 1), sign * yaw)
        pose[f"{prefix}Femur.{side}"] = rot(f"{prefix}Femur.{side}", LIFT_AXIS[side], fem)
        pose[f"{prefix}Tibia.{side}"] = rot(f"{prefix}Tibia.{side}", LIFT_AXIS[side], tib)
        pose[f"{prefix}Tarsus.{side}"] = rot(f"{prefix}Tarsus.{side}", LIFT_AXIS[side], -(fem + tib) * 0.8)
    return pose
TRIPOD_A = {"Fore.L": 0.0, "Mid.R": 0.0, "Hind.L": 0.0}
TRIPOD_B = {"Fore.R": 0.5, "Mid.L": 0.5, "Hind.R": 0.5}
def head_pose(pose, ph, yaw=0.0, pitch=0.0, mand=0.0, ant=(0.0, 0.0)):
    pose["Head"] = Q(rot("Head", (0, 0, 1), yaw), rot("Head", (1, 0, 0), pitch))
    for sign, side in ((-1, "L"), (1, "R")):
        pose[f"Mandible.{side}"] = rot(f"Mandible.{side}", (0, 0, 1), -sign * mand)
        pose[f"Antenna1.{side}"] = Q(rot(f"Antenna1.{side}", (0, 0, 1), sign * ant[0]), rot(f"Antenna1.{side}", (1, 0, 0), ant[1]))
        pose[f"Antenna2.{side}"] = Q(rot(f"Antenna2.{side}", (0, 0, 1), sign * ant[0] * 0.6), rot(f"Antenna2.{side}", (1, 0, 0), ant[1] * 1.2))
def body_pose(pose, pitch=0.0, roll=0.0, yaw=0.0, abdomen=0.0):
    pose["Thorax"] = Q(rot("Thorax", (1, 0, 0), pitch), rot("Thorax", (0, 1, 0), roll), rot("Thorax", (0, 0, 1), yaw))
    pose["Abdomen"] = rot("Abdomen", (1, 0, 0), abdomen)

IDLE_F, TRUNDLE_F, HAUL_F = 96, 40, 24
def idle_raw(phase):
    ph = 2 * math.pi * phase
    pose = {}
    body_pose(pose, pitch=0.004 * math.sin(2 * ph), roll=0.010 * math.sin(ph), abdomen=-0.008 * math.sin(2 * ph))
    head_pose(pose, ph, yaw=0.06 * math.sin(ph + 0.8), pitch=0.03 * math.sin(2 * ph + 1.4), mand=0.06 + 0.05 * math.sin(3 * ph),
              ant=(0.22 * math.sin(2 * ph), 0.16 * math.sin(2 * ph + 1.1)))
    # weight shift: the resting legs keep contact; coxae ease fore and aft a little so the stance is not frozen
    for key in list(TRIPOD_A) + list(TRIPOD_B):
        prefix, side = key.split("."); sign = 1 if side == "R" else -1
        pose[f"{prefix}Coxa.{side}"] = rot(f"{prefix}Coxa.{side}", (0, 0, 1), sign * 0.02 * math.sin(ph + (0.0 if key in TRIPOD_A else math.pi)))
    return pose, 1.0, 0.0
def trundle_raw(phase):
    ph = 2 * math.pi * phase
    phases = dict(TRIPOD_A); phases.update(TRIPOD_B)
    pose = legs_pose({k: phase - v for k, v in phases.items()}, 0.42, {"Fore": 0.20, "Mid": 0.17, "Hind": 0.20}, 1.0)
    body_pose(pose, pitch=0.010 * math.sin(2 * ph + 0.5), roll=0.022 * math.sin(ph), yaw=0.012 * math.sin(ph), abdomen=-0.006 * math.sin(2 * ph))
    head_pose(pose, ph, yaw=0.04 * math.sin(ph), pitch=0.025 * math.sin(2 * ph), mand=0.05, ant=(0.18 * math.sin(ph), 0.12 * math.sin(2 * ph)))
    return pose, 1.0, 0.012 * math.sin(2 * ph)
def haul_raw(phase):
    ph = 2 * math.pi * phase
    phases = dict(TRIPOD_A); phases.update(TRIPOD_B)
    pose = legs_pose({k: phase - v for k, v in phases.items()}, 0.50, {"Fore": 0.30, "Mid": 0.26, "Hind": 0.30}, 1.25, stance=(0.16, 0.05))
    body_pose(pose, pitch=0.030 * math.sin(2 * ph + 0.6) + 0.02, roll=0.030 * math.sin(ph), yaw=0.015 * math.sin(ph), abdomen=-0.012 * math.sin(2 * ph))
    head_pose(pose, ph, yaw=0.03 * math.sin(ph), pitch=0.05 * math.sin(2 * ph) - 0.05, mand=0.10 + 0.04 * math.sin(2 * ph), ant=(0.10 * math.sin(2 * ph), -0.25 + 0.1 * math.sin(2 * ph)))
    return pose, 1.0, 0.02 * math.sin(2 * ph + 0.3)
idle_pose, trundle_pose, haul_pose = floored(idle_raw), floored(trundle_raw), floored(haul_raw)
CLIPS = [("Idle", IDLE_F, idle_pose, True, 3), ("Trundle", TRUNDLE_F, trundle_pose, True, 2), ("Haul", HAUL_F, haul_pose, True, 1)]
for clip_name, frames, pose_fn, loop, step in CLIPS:
    for f in range(1, frames + 2):
        pose_fn((f - 1) / frames)
def rest_pose():
    if RIG.animation_data:
        RIG.animation_data.action = None
        for t in RIG.animation_data.nla_tracks:
            t.mute = True
    for pb in RIG.pose.bones:
        pb.rotation_quaternion = Q_ID; pb.location = (0, 0, 0)
    RIG.update_tag(); bpy.context.view_layer.update()
rest_pose()
RIG.animation_data_create()
for clip_name, frames, pose_fn, loop, step in CLIPS:
    action = bpy.data.actions.new(clip_name)
    RIG.animation_data.action = action
    for f in range(1, frames + 2, step):
        pose, loc = pose_fn((f - 1) / frames)
        for name in ANIM_BONES:
            pb = RIG.pose.bones[name]
            pb.rotation_quaternion = pose.get(name, Q_ID)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=f, group=name)
        RIG.pose.bones[BODY_BONE].location = loc
        RIG.pose.bones[BODY_BONE].keyframe_insert(data_path="location", frame=f, group=BODY_BONE)
    track = RIG.animation_data.nla_tracks.new(); track.name = clip_name
    strip = track.strips.new(clip_name, 1, action)
    if hasattr(strip, "action_slot") and len(action.slots):
        strip.action_slot = action.slots[0]
    track.mute = True
rest_pose()

# ------------------------------------------------------------------------ camera rig + lights (saved, not exported)
PIVOT = V(0, 0.10, 0.85)
cam_rig = bpy.data.objects.new(PFX + "RIG", None); COLL.objects.link(cam_rig); cam_rig.location = PIVOT
cam_data = bpy.data.cameras.new(PFX + "CAM"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 5.4; cam_data.clip_start = 0.05; cam_data.clip_end = 60.0
cam = bpy.data.objects.new(PFX + "CAM", cam_data); COLL.objects.link(cam); cam.parent = cam_rig
cam.location = (0.0, 12.0, 0.0); cam.rotation_euler = Euler((deg(90), 0, deg(180)), 'XYZ')
def light(name, loc, energy, size, color, aim):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy = energy; ld.size = size; ld.color = color
    ob = bpy.data.objects.new(name, ld); COLL.objects.link(ob); ob.parent = cam_rig; ob.location = loc
    ob.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob
light(PFX + "KEY", (-5.0, 6.5, 4.5), 1000, 4.0, (1.0, 0.96, 0.9), (0, 0, 0))
light(PFX + "FILL", (6.5, 5.5, 1.0), 320, 7.0, (0.9, 0.94, 1.0), (0, 0, 0))
light(PFX + "RIM", (2.5, -5.5, 4.0), 650, 3.0, (1.0, 1.0, 1.0), (0, 0, 0))
w = bpy.data.worlds.new(PFX + "WORLD"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.42, 0.44, 1.0); w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.use_denoising = True; sc.cycles.device = 'CPU'; sc.cycles.max_bounces = 4
sc.render.threads_mode = 'FIXED'; sc.render.threads = 4; sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
sc.render.resolution_x, sc.render.resolution_y = 1024, 768; sc.render.resolution_percentage = 100
sc.frame_start = 1; sc.frame_end = IDLE_F; sc.frame_set(1); sc.camera = cam

# ------------------------------------------------------------------------ save + export
MESHES = [ob for ob in COLL.objects if ob.type == 'MESH']
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
BLEND_SHA = sha256(OUT_BLEND)
bpy.ops.object.select_all(action='DESELECT')
for ob in [RIG, *MESHES, *REFS.values()]:
    ob.select_set(True)
bpy.context.view_layer.objects.active = RIG
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                          export_apply=True, export_animations=True, export_animation_mode='NLA_TRACKS',
                          export_extras=True, export_cameras=False, export_lights=False,
                          export_vertex_color='ACTIVE', export_image_format='NONE')
GLB_SHA = sha256(OUT_GLB)

# ------------------------------------------------------------------------ evidence
d = dg()
per_object = {}; eval_tris = 0; draw_groups = 0
for ob in MESHES:
    ev = ob.evaluated_get(d); m = ev.to_mesh(); m.calc_loop_triangles()
    n = len(m.loop_triangles); used = {p.material_index for p in m.polygons}
    per_object[ob.name] = {"triangles": n, "vertices": len(m.vertices), "materials": [ob.data.materials[i].name for i in sorted(used) if i < len(ob.data.materials)]}
    eval_tris += n; draw_groups += max(1, len(used)); ev.to_mesh_clear()
def to_gltf(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]
def quat_close(a, b):
    return min((a - b).magnitude, (a + b).magnitude) < 1e-9
CLIP_EVIDENCE = {}
for clip_name, frames, pose_fn, loop, step in CLIPS:
    foot_z = {k: [] for k in FOOT_PTS}
    seat_track = []; lifts = []
    for f in range(1, frames + 1):
        phase = (f - 1) / frames
        pose, loc = pose_fn(phase)
        apply_pose(pose, loc)
        zs = pose_fn.cache[phase][2]; lift = pose_fn.cache[phase][3]
        for k in foot_z:
            foot_z[k].append(round(zs[k] + lift, 3))
        seat_track.append(to_gltf(REFS["Seat"].matrix_world.translation)); lifts.append(round(lift, 4))
    p0, l0 = pose_fn(0.0); p1, l1 = pose_fn(1.0)
    CLIP_EVIDENCE[clip_name] = {
        "frames": frames, "fps": 24, "keyStepFrames": step, "loops": loop, "inPlace": True,
        "loopClosure": {"poseAtPhase0EqualsPhase1": set(p0) == set(p1) and all(quat_close(p0[k], p1[k]) for k in p0) and max(abs(a - b) for a, b in zip(l0, l1)) < 1e-9},
        "footLowestPointPerFrameMeters": foot_z,
        "lowestFootMinZ": round(min(min(v) for v in foot_z.values()), 4),
        "swingFootPeakZ": round(max(max(v) for v in foot_z.values()), 4),
        "bodyVerticalOffsetMeters": {"min": min(lifts), "max": max(lifts)},
        "seatPositionPerFrameGlb": seat_track, "seatRestGlb": to_gltf(SEAT),
        "seatDeltaPerFrameGlb": [[round(a - b, 4) for a, b in zip(s, to_gltf(SEAT))] for s in seat_track],
    }
rest_pose()

def shell_clearance(ob, bvh):
    ev = ob.evaluated_get(dg()); m = ev.to_mesh()
    inside = 0; dmin = 9.0; inside_samples = []
    for v in m.vertices:
        s = signed_clearance(bvh, v.co)
        if s < 0:
            inside += 1
            if len(inside_samples) < 8:
                inside_samples.append([round(c, 4) for c in v.co])
        dmin = min(dmin, s)
    ev.to_mesh_clear()
    return {"verticesInsideSurface": inside, "minSignedDistanceMeters": round(dmin, 4), "insideSamples": inside_samples}
TACK_CLEAR = {"IB_saddle": shell_clearance(saddle, PLATE1_BVH), "IB_blanket": shell_clearance(blanket, PLATE1_BVH),
              "IB_stirrup_pegs": shell_clearance(stirrups, PLATE1_BVH), "IB_guide_lines": shell_clearance(reins, SHELL_BVH),
              "IB_panniers": shell_clearance(pannier, SHELL_BVH), "IB_bundle": shell_clearance(bundle, SHELL_BVH)}
PLATE_GAPS = {}
for (n, yf, yb, st), nxt in zip(PLATE_SPECS, PLATE_SPECS[1:]):
    y_mid = (nxt[1] + yb) / 2
    PLATE_GAPS[n + "->" + nxt[0]] = round((ABDOMEN_PROF["top"](y_mid) - st - 0.04) - (ABDOMEN_PROF["top"](y_mid) - nxt[3]), 4)

# ------------------------------------------------------------------------ GLB structure validation (minimal parser)
def parse_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2
    off = 12; gltf = None
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off); off += 8
        chunk = data[off:off + clen]; off += clen
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8"))
    return gltf
gltf = parse_glb(OUT_GLB)
acc = gltf["accessors"]
pos_min = [9, 9, 9]; pos_max = [-9, -9, -9]
for mesh in gltf["meshes"]:
    for prim in mesh["primitives"]:
        a = acc[prim["attributes"]["POSITION"]]
        pos_min = [min(p, q) for p, q in zip(pos_min, a["min"])]; pos_max = [max(p, q) for p, q in zip(pos_max, a["max"])]
nodes = gltf["nodes"]
def node_matrix(n):
    t = Matrix.Translation(Vector(n.get("translation", (0, 0, 0))))
    q = n.get("rotation", (0, 0, 0, 1)); r = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
    s = Matrix.Diagonal(Vector((*n.get("scale", (1, 1, 1)), 1)))
    return t @ r @ s
world = [None] * len(nodes)
def walk(i, pm):
    world[i] = pm @ node_matrix(nodes[i])
    for c in nodes[i].get("children", []):
        walk(c, world[i])
for scene in gltf["scenes"]:
    for ri in scene["nodes"]:
        walk(ri, Matrix.Identity(4))
ref_nodes = {n["name"]: {"role": n.get("extras", {}).get("role"), "glbPosition": [round(c, 4) for c in world[i].to_translation()]}
             for i, n in enumerate(nodes) if "role" in n.get("extras", {})}
skins = gltf.get("skins", [])
joint_names = [nodes[j]["name"] for j in skins[0]["joints"]] if skins else []
animations = {}
for a in gltf.get("animations", []):
    dur = max((acc[s["input"]]["max"][0] for s in a.get("samplers", [])), default=0.0)
    animations[a["name"]] = {"channels": len(a.get("channels", [])), "durationSeconds": round(dur, 3)}
mand_mesh = next((m for m in gltf["meshes"] if m["name"] == PFX + "mandibles"), None)
CLIP_SET = {c[0] for c in CLIPS}
checks = {
    "clipsIdleTrundleHaul": set(animations) == CLIP_SET and all(v["durationSeconds"] > 0 for v in animations.values()),
    "haulShorterThanTrundle": animations.get("Haul", {}).get("durationSeconds", 9) < animations.get("Trundle", {}).get("durationSeconds", 0),
    "oneSkinWith34Joints": len(skins) == 1 and len(joint_names) == len(BONE_SPECS) and set(joint_names) == {n for n, _, _, _ in BONE_SPECS},
    "feetOnFloor": abs(pos_min[1]) < 0.005,
    "forwardIsNegativeZ": bool(mand_mesh) and all(acc[p["attributes"]["POSITION"]]["max"][2] < -1.5 for p in mand_mesh["primitives"]),
    "riderReferenceNodes": {"Seat", "Stirrup.L", "Stirrup.R", "ReinHand.L", "ReinHand.R"} <= set(ref_nodes),
    "cargoSockets": {"Pack.L", "Pack.R"} <= set(ref_nodes),
    "noCameras": "cameras" not in gltf, "noLights": "KHR_lights_punctual" not in gltf.get("extensionsUsed", []),
    "clipsLoopClosed": all(v["loopClosure"]["poseAtPhase0EqualsPhase1"] for v in CLIP_EVIDENCE.values()),
    "plantedFeetOnFloor": all(v["lowestFootMinZ"] > -0.005 for v in CLIP_EVIDENCE.values()),
    "tackOutsideShell": all(TACK_CLEAR[k]["verticesInsideSurface"] == 0 for k in ("IB_saddle", "IB_blanket", "IB_stirrup_pegs", "IB_panniers", "IB_bundle")),
    "guideLinesClearOfShell": min(REIN_CLEAR) >= 0.0,
    "seatOnPlateOne": SEAT_PLATE_Z is not None and 0.03 <= SEAT.z - SEAT_PLATE_Z <= 0.09,
    "stirrupDropInRange": all(0.40 <= SEAT.z - STIRRUPS[s].z <= 0.70 for s in STIRRUPS),
    "platesStepDownWithoutTouching": all(g > 0.0 for g in PLATE_GAPS.values()),
    "rootLiftAxisResolved": abs(LIFT_PROBE - 0.10) < 1e-3,
    "underTriangleBudget": eval_tris <= TRI_BUDGET,
    "sixLegs": len(FOOT_PTS) == 6,
}
prev = json.load(open(OUT_MANIFEST)) if os.path.exists(OUT_MANIFEST) else {}
manifest = {
    "asset": "ironback_beetle.glb", "generated": True,
    "status": "source authored and exported; staging only, no runtime support and no visual approval until rendered stills are reviewed",
    "species": "ironback pack beetle (six-legged hauling mount)",
    "sourceAxes": "Blender: +Y forward, Z up, metres", "glbAxes": "+Y up, -Z forward (export_yup)",
    "boundsMetersGlb": {"min": [round(c, 3) for c in pos_min], "max": [round(c, 3) for c in pos_max]},
    "heightMeters": round(pos_max[1], 3), "lengthMeters": round(pos_max[2] - pos_min[2], 3), "widthMeters": round(pos_max[0] - pos_min[0], 3),
    "seat": {
        "node": "Seat", "role": "rider_seat", "surface": "top surface of the cargo saddle on the centre line, rest pose",
        "glbPosition": to_gltf(SEAT),
        "riderRootHint": "place the rider's root (its floor origin) at Seat minus the rider's seated pelvis-bottom height (V9: 0.823 m) plus 0.02 forward",
        "stirrupTreadGlb": {k: to_gltf(v) for k, v in STIRRUPS.items()}, "stirrupDropBelowSeatMeters": round(SEAT.z - STIRRUPS["R"].z, 4),
        "stirrupStyle": "iron pegs on the plate rim; the rider's legs drape over the shell dome",
        "reinHandGlb": {k: to_gltf(v) for k, v in REIN_HAND.items()}, "reinStyle": "guide lines from pronotum hooks, no bridle",
        "saddleTopSurfaceOffsetFromPlateMeters": 0.05, "saddleShellThicknessMeters": 0.035, "blanketThicknessMeters": 0.012,
        "seatAbovePlateMeters": round(SEAT.z - SEAT_PLATE_Z, 4) if SEAT_PLATE_Z is not None else None,
    },
    "cargoSockets": {k: to_gltf(v) for k, v in PACK.items()},
    "referenceNodes": ref_nodes,
    "deformBones": joint_names, "animationClips": animations, "clipEvidence": CLIP_EVIDENCE,
    "seatMotionContract": "clipEvidence.<clip>.seatDeltaPerFrameGlb is the saddle's displacement from rest per frame (glTF axes) for a per-species rider ride solve",
    "meshObjects": [ob.name for ob in MESHES], "perObject": per_object,
    "trianglesEvaluated": eval_tris, "drawGroups": draw_groups, "materialCount": len(bpy.data.materials), "glbBytes": os.path.getsize(OUT_GLB),
    "budget": {"targetTriangles": TRI_BUDGET, "trianglesMet": eval_tris <= TRI_BUDGET, "bodyCoreRawTriangles": raw_tris, "bodyCoreTargetTriangles": BODY_TARGET_TRIS},
    "metaballCalibration": {"visibleRadiusOfUnitBall": round(K_META, 4), "ellipsoidSize(1,2,0.5)Extents": CAL_ELL},
    "tackClearance": TACK_CLEAR, "guideLineClearanceToShellMeters": {"min": min(REIN_CLEAR), "samples": len(REIN_CLEAR)},
    "plateOverlapGapsMeters": PLATE_GAPS, "floorSolveProbe": {"liftRequested": 0.10, "feetRaised": round(LIFT_PROBE, 4)},
    "sha256": {"glb": GLB_SHA, "blend": BLEND_SHA},
    "glbChecks": checks, "glbStructureValid": all(checks.values()),
    "peakProcessMemoryMB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1),
    "authorSeconds": round(time.time() - T0, 1), "blender": bpy.app.version_string,
    "command": "blender -b -t 4 --factory-startup --python author_ironback.py",
}
for key in ("design", "traversalRole", "riderClipMap", "renders"):
    if key in prev:
        manifest[key] = prev[key]
if "renders" in manifest:
    manifest["renders"]["currentForGlb"] = False
with open(OUT_MANIFEST, "w") as f:
    json.dump(manifest, f, indent=1)
print("IRONBACK_DONE", json.dumps({"tris": eval_tris, "checks": checks, "seat": to_gltf(SEAT), "sha": GLB_SHA[:12], "peakMB": manifest["peakProcessMemoryMB"]}))
