"""Barrow mole: heavy subterranean tunnelling mount for the Wizard Realms mount pack (asset staging only).

Silhouette: a 3.9 m pear-shaped burrower, 1.72 m at the shoulder hump and 1.6 m across the shoulders, with no neck:
the wedge snout grows straight out of the shoulders and ends in a pink nose pad with tiny bead eyes. Huge outward-
facing spade forepaws with five long ivory claws, short plantigrade hind feet with small claws, a stubby tail. Five
keeled dorsal plates sit in the fur from the neck to the rump plus two shoulder guards; a fur ruff collars the neck.
Tack: saddle behind the shoulder hump between dorsal plates two and three (the plate ahead is the pommel), violet
blanket with gold trim, two girths, hanging stirrups, a snout band with two lead lines to the rider's hands. Everything
is procedural (metaball core; tube claws; plates and tack sampled off the body with a BVH).

Conventions follow ../sedgehorn_mount/author_sedgehorn.py and ../MOUNT_PACK_DESIGN_BRIEF.md: Blender +Y forward,
Z up, claws and pads on Z=0; exported +Y up, -Z forward. Rig: Root (unkeyed), Pelvis (keyed floor-solve location),
Spine, Chest, Head, Snout, Tail, four legs x Upper/Lower/Paw = 19 joints. Clips Idle, Shuffle, Lope, Dig are in place.

Run on the render machine only (one headless process):
    blender -b -t 4 --factory-startup --python author_barrow.py
Outputs: barrow_mole.blend, barrow_mole.glb, barrow_manifest.json (design blocks are preserved)
"""
import bpy, bmesh, json, math, os, time, resource, struct, hashlib
from mathutils import Vector, Euler, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_BLEND = os.path.join(HERE, "barrow_mole.blend")
OUT_GLB = os.path.join(HERE, "barrow_mole.glb")
OUT_MANIFEST = os.path.join(HERE, "barrow_manifest.json")
PFX = "BM_"
TRI_BUDGET = 40000
BODY_TARGET_TRIS = 15000

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

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
sc = bpy.context.scene
sc.render.fps = 24
COLL = bpy.data.collections.new("BarrowMole")
sc.collection.children.link(COLL)
def dg():
    return bpy.context.evaluated_depsgraph_get()

# ------------------------------------------------------------------------ materials
def mat_principled(name, color, rough=0.6, metallic=0.0, sheen=0.0, bump=0.0, bump_scale=40.0, vcol=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if vcol:
        vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    if bump:
        tex = nt.nodes.new("ShaderNodeTexNoise"); tex.inputs["Scale"].default_value = bump_scale; tex.inputs["Detail"].default_value = 4.0
        bn = nt.nodes.new("ShaderNodeBump"); bn.inputs["Strength"].default_value = bump; bn.inputs["Distance"].default_value = 0.002
        nt.links.new(tex.outputs["Fac"], bn.inputs["Height"]); nt.links.new(bn.outputs["Normal"], bsdf.inputs["Normal"])
    m.use_backface_culling = False
    return m
UMBER, FLANK, MUZZLE, BELLY = (0.20, 0.13, 0.08), (0.32, 0.26, 0.20), (0.62, 0.55, 0.45), (0.38, 0.32, 0.26)
M_fur = mat_principled(PFX + "fur", (1.0, 1.0, 1.0), rough=0.95, sheen=0.3, bump=0.3, bump_scale=90, vcol=True)   # white x COLOR_0
M_ruff = mat_principled(PFX + "fur_ruff", UMBER, rough=0.95, sheen=0.3, bump=0.3, bump_scale=70)
M_plate = mat_principled(PFX + "plate_iron_brown", (0.22, 0.17, 0.13), rough=0.55, metallic=0.1, bump=0.15, bump_scale=30)
M_plate_edge = mat_principled(PFX + "plate_worn_edge", (0.42, 0.36, 0.28), rough=0.45, metallic=0.2)
M_claw = mat_principled(PFX + "claw_ivory", (0.82, 0.76, 0.62), rough=0.35, bump=0.08, bump_scale=140)
M_pad = mat_principled(PFX + "paw_pad", (0.36, 0.26, 0.22), rough=0.6, bump=0.15, bump_scale=120)
M_nose = mat_principled(PFX + "nose_pink", (0.80, 0.45, 0.42), rough=0.3, sheen=0.3, bump=0.25, bump_scale=200)
M_eye = mat_principled(PFX + "eye_bead", (0.03, 0.03, 0.03), rough=0.08)
M_saddle = mat_principled(PFX + "saddle_leather", (0.30, 0.15, 0.07), rough=0.5, bump=0.1, bump_scale=60)
M_strap = mat_principled(PFX + "strap_leather", (0.15, 0.075, 0.035), rough=0.55, bump=0.1, bump_scale=60)
M_blanket = mat_principled(PFX + "blanket_violet", (0.17, 0.07, 0.46), rough=0.85, sheen=0.35, bump=0.18, bump_scale=90)
M_trim = mat_principled(PFX + "trim_gold", (0.80, 0.55, 0.16), rough=0.38, metallic=1.0)
M_iron = mat_principled(PFX + "iron", (0.45, 0.45, 0.47), rough=0.4, metallic=1.0)

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
        self.v = []; self.f = []; self.mi = []
    def add(self, v, f, mat=0):
        base = len(self.v); self.v.extend(v); self.f.extend(tuple(i + base for i in face) for face in f); self.mi.extend([mat] * len(f))
def bvh_of(objects):
    bpy.context.view_layer.update(); d = dg()
    bm = bmesh.new()
    for ob in objects:
        ev = ob.evaluated_get(d); me = ev.to_mesh(); bm.from_mesh(me); ev.to_mesh_clear()
    tree = BVHTree.FromBMesh(bm); bm.free()
    return tree
def outer_hit(bvh, origin, direction, reach=5.0):
    d = Vector(direction).normalized()
    loc, nrm, idx, dist = bvh.ray_cast(Vector(origin) + d * reach, -d, reach * 2)
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
E((0, 1.62, 0.84), 0.26, 0.40, 0.22, aim=(0, 0.95, -0.18))   # wedge snout, drooping toward the nose
E((0, 1.25, 0.98), 0.42, 0.40, 0.36)                          # head, no neck: flows into the shoulders
E((0, 0.70, 1.12), 0.78, 0.55, 0.60)                          # massive shoulder hump (1.56 m wide)
E((0, 0.75, 0.75), 0.55, 0.45, 0.35)                          # chest floor
E((0, 0.05, 1.05), 0.68, 0.60, 0.55)                          # mid body
E((0, -0.65, 0.95), 0.56, 0.60, 0.48)                         # rump
E((0, -1.25, 0.80), 0.40, 0.40, 0.36)                         # rump end
LEGS = {
    "Fore": ([V(0.55, 0.85, 0.85), V(0.80, 1.00, 0.55), V(0.90, 1.20, 0.25), V(0.98, 1.38, 0.10)], [0.24, 0.20, 0.16, 0.12]),
    "Hind": ([V(0.42, -0.80, 0.78), V(0.62, -0.60, 0.50), V(0.66, -0.85, 0.20), V(0.72, -0.60, 0.06)], [0.20, 0.15, 0.11, 0.09]),
}
def leg_balls(joints, radii, sign):
    for j in range(len(joints) - 2):                            # the paw is a separate mesh
        a, b = joints[j], joints[j + 1]
        steps = max(2, int((b - a).length / 0.08))
        for k in range(steps + (1 if j == len(joints) - 3 else 0)):
            t = k / steps
            p = a.lerp(b, t); r = lerp(radii[j], radii[j + 1], t)
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
body_me.materials.append(M_fur)
body = bpy.data.objects.new(PFX + "body", body_me); COLL.objects.link(body)
BODY_BVH = bvh_of([body])
AXIS_Z = 1.00

# fur colours baked to COLOR_0: umber back, grey-brown flanks, lighter belly, pale muzzle
col = body_me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
for v in body_me.vertices:
    co = v.co
    c = mix(UMBER, FLANK, smooth(1.35, 0.85, co.z))
    c = mix(c, BELLY, smooth(0.75, 0.40, co.z) * (1.0 if abs(co.x) < 0.5 else 0.4))
    c = mix(c, MUZZLE, smooth(1.35, 1.75, co.y) * smooth(1.25, 0.95, co.z))
    col.data[v.index].color = (*c, 1.0)
body_me.color_attributes.active_color = col

# ------------------------------------------------------------------------ paws: spade forepaws with five long claws, plantigrade hind feet (lowest points define the floor)
FOOT_PTS = {}
pw = Parts()
CLAW_ANGLES_FORE = [deg(a) for a in (-50, -25, 0, 25, 50)]
CLAW_ANGLES_HIND = [deg(a) for a in (-36, -12, 12, 36)]
for prefix, (joints, radii) in LEGS.items():
    for sign, side in ((-1, "L"), (1, "R")):
        wrist = V(sign * joints[2].x, joints[2].y, joints[2].z); pc = V(sign * joints[3].x, joints[3].y, 0.0)
        FOOT_PTS[prefix + "." + side] = pc
        fwd = (V(pc.x, pc.y, 0) - V(wrist.x, wrist.y, 0)).normalized()
        if prefix == "Fore":
            fwd = (fwd + V(sign * 0.55, 0, 0)).normalized()                                  # spade palms face outward-forward
        sidev = fwd.cross(V(0, 0, 1))
        if prefix == "Fore":
            pw.add(*sphere_part(pc + V(0, 0, 0.12), 0.26, scale=(1.0, 1.0, 0.42), u=16, v=10), 1)   # broad palm
            pw.add(*tube([wrist + V(0, 0, 0.02), pc + V(0, 0, 0.15)], [0.13, 0.13], n=10), 1)
            for th in CLAW_ANGLES_FORE:
                d = fwd * math.cos(th) + sidev * math.sin(th)
                pts = catmull([pc + d * 0.16 + V(0, 0, 0.11), pc + d * 0.34 + V(0, 0, 0.10), pc + d * 0.48 + V(0, 0, 0.03), pc + d * 0.55 + V(0, 0, 0.011)], 4)   # tip ring (r 0.01) touches Z=0
                pw.add(*tube(pts, [lerp(0.055, 0.010, (i / (len(pts) - 1)) ** 0.9) for i in range(len(pts))], n=8), 0)
        else:
            pw.add(*sphere_part(pc + V(0, 0, 0.07), 0.16, scale=(0.9, 1.3, 0.38), u=14, v=8), 1)   # plantigrade pad
            pw.add(*tube([wrist + V(0, 0, 0.02), pc + V(0, 0, 0.12)], [0.09, 0.09], n=10), 1)
            for th in CLAW_ANGLES_HIND:
                d = fwd * math.cos(th) + sidev * math.sin(th)
                pts = catmull([pc + d * 0.14 + V(0, 0, 0.06), pc + d * 0.24 + V(0, 0, 0.045), pc + d * 0.30 + V(0, 0, 0.009)], 4)
                pw.add(*tube(pts, [lerp(0.035, 0.008, i / (len(pts) - 1)) for i in range(len(pts))], n=8), 0)
paws = new_mesh_object(PFX + "paws", pw.v, pw.f, [M_claw, M_pad], pw.mi)
def foot_group(co):
    return ("Fore" if co.y > 0 else "Hind") + "." + ("R" if co.x > 0 else "L")

# ------------------------------------------------------------------------ nose, eyes, tail, fur ruff
nose = new_mesh_object(PFX + "nose", *sphere_part(V(0, 1.96, 0.76), 0.10, scale=(1.1, 0.8, 0.9), u=16, v=10), [M_nose])
ey = Parts()
for sign in (-1, 1):
    ey.add(*sphere_part(V(sign * 0.18, 1.60, 0.98), 0.028, u=10, v=6))
eyes = new_mesh_object(PFX + "eyes", ey.v, ey.f, [M_eye])
TAIL_PTS = catmull([V(0, -1.58, 0.74), V(0, -1.78, 0.66), V(0, -1.95, 0.55)], 4)
tail_ob = new_mesh_object(PFX + "tail", *tube(TAIL_PTS, [lerp(0.075, 0.025, i / (len(TAIL_PTS) - 1)) for i in range(len(TAIL_PTS))], n=10), [M_ruff])
def ring_loop(bvh, y, offset, n=40, z_axis=AXIS_Z):
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        d = V(math.sin(a), 0, math.cos(a))
        loc, nrm = outer_hit(bvh, (0, y, z_axis), d)
        pts.append((loc + d * offset) if loc else V(0, y, z_axis) + d * 0.6)
    pts.append(pts[0])
    return pts
ruff = Parts()
ruff_ring = ring_loop(BODY_BVH, 1.08, 0.0, n=22, z_axis=0.98)[:-1]
for i, p in enumerate(ruff_ring):
    d = (p - V(0, 1.08, 0.98)); d.y = 0; d.normalize()
    base_l = p + d.cross(V(0, 1, 0)) * 0.07; base_r = p - d.cross(V(0, 1, 0)) * 0.07
    tip = p + d * (0.07 + 0.025 * (i % 3)) + V(0, -0.20, 0)
    ruff.add([base_l - d * 0.02, tip, base_r - d * 0.02], [(0, 1, 2)])
ruff_ob = new_mesh_object(PFX + "ruff", ruff.v, ruff.f, [M_ruff])

# ------------------------------------------------------------------------ dorsal plates, shoulder guards, tack sampled off the body
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
    sol = ob.modifiers.new("Solidify", 'SOLIDIFY'); sol.thickness = thickness; sol.offset = 1.0; sol.use_even_offset = True
    return ob, verts
def plate_rise(rows):
    def rise(r, a):
        t = r / (rows - 1)
        return 0.05 * math.exp(-(a / deg(10)) ** 2) + 0.025 * smooth(0.75, 1.0, 1 - t)        # central keel + raised front lip over the plate behind
    return rise
PLATE_SPECS = [("plate1", 1.15, 0.80), ("plate2", 0.82, 0.42), ("plate3", -0.38, -0.70), ("plate4", -0.68, -1.04), ("plate5", -1.02, -1.38)]
plates = []
for name, yf, yb in PLATE_SPECS:
    ob, _ = shell_on(PFX + name, BODY_BVH, lin(yf, yb, 7), [deg(a) for a in lin(-42, 42, 13)], 0.02, [M_plate, M_plate_edge], rise=plate_rise(7), thickness=0.05, trim_border=True)
    plates.append(ob)
guards = []
for sign in (-1, 1):
    angs = [deg(a) for a in lin(48, 86, 9)] if sign > 0 else [deg(a) for a in lin(-86, -48, 9)]
    ob, _ = shell_on(PFX + ("guard.R" if sign > 0 else "guard.L"), BODY_BVH, lin(0.98, 0.46, 7), angs, 0.02, [M_plate, M_plate_edge], thickness=0.045, trim_border=True)
    guards.append(ob)
blanket, _ = shell_on(PFX + "blanket", BODY_BVH, lin(-0.32, 0.38, 9), [deg(a) for a in lin(-82, 82, 17)], 0.012, [M_blanket, M_trim], trim_border=True)
SADDLE_YS = lin(-0.25, 0.30, 11); SADDLE_AS = [deg(a) for a in lin(-60, 60, 15)]
def saddle_rise(r, a):
    pommel = 0.06 * smooth(7.5, 10.0, r) * max(0.0, 1 - (a / deg(26)) ** 2)      # low pommel: plate2 ahead does the bracing
    cantle = 0.10 * smooth(2.5, 0.0, r) * max(0.0, 1 - (a / deg(52)) ** 2)
    return pommel + cantle
saddle, saddle_verts = shell_on(PFX + "saddle", BODY_BVH, SADDLE_YS, SADDLE_AS, 0.05, [M_saddle], rise=saddle_rise, thickness=0.035)
SEAT = saddle_verts[5 * len(SADDLE_AS) + 7].copy()
TACK_BVH = bvh_of([body, saddle, blanket] + plates + guards)
girth = Parts()
for y in (-0.15, 0.18):
    ring = ring_loop(TACK_BVH, y, 0.018)
    girth.add(*tube(ring, None, n=8, caps=(False, False), ru_rv=[(0.012, 0.045)] * len(ring)))
girths = new_mesh_object(PFX + "girths", girth.v, girth.f, [M_strap])

STIRRUP_DROP, STIRRUP_X = 0.48, 0.76
flap_l = saddle_verts[6 * len(SADDLE_AS) + 0]; flap_r = saddle_verts[6 * len(SADDLE_AS) + len(SADDLE_AS) - 1]
STIRRUPS = {}
stp = Parts()
for sign, flap in ((-1, flap_l), (1, flap_r)):
    x = sign * STIRRUP_X; y = flap.y
    z_top = flap.z + 0.02; z_c = SEAT.z - STIRRUP_DROP + 0.085
    stp.add(*tube([V(flap.x, y, z_top), V(x, y, z_c + 0.09)], None, n=8, ru_rv=[(0.045, 0.012), (0.045, 0.012)]))
    ring = catmull([V(x, y, z_c + 0.085 * math.cos(a)) + V(0.085 * math.sin(a) * 0.95, 0, 0) for a in lin(0, 2 * math.pi, 25)], 1)
    stp.add(*tube(ring, [0.011] * len(ring), n=8, caps=(False, False)))
    tread_c = V(x, y, z_c - 0.085)
    stp.add(*box_part(tread_c + V(0, 0, 0.007), (0.09, 0.06, 0.014)))
    STIRRUPS["R" if sign > 0 else "L"] = tread_c + V(0, 0, 0.014)
stirrups = new_mesh_object(PFX + "stirrups", stp.v, stp.f, [M_iron])

# snout band and lead lines (no bit): the band sits behind the nose, lines run over the shoulder hump to the hands
REIN_HAND = {"L": V(-0.17, SEAT.y + 0.22, SEAT.z + 0.32), "R": V(0.17, SEAT.y + 0.22, SEAT.z + 0.32)}
REIN_R = 0.012
hb = Parts()
# the snout slopes steeply here, so the band is a strip of three rings each projected at its own y (a single tube
# 3.5 cm wide would sink its rear edge into the head); Solidify pushes the 1.2 cm thickness outward
BAND_Y, BAND_HALF_W = 1.45, 0.018
band_rings = [ring_loop(BODY_BVH, y, 0.012, n=28, z_axis=0.90)[:-1] for y in (BAND_Y - BAND_HALF_W, BAND_Y, BAND_Y + BAND_HALF_W)]
band = band_rings[1] + [band_rings[1][0]]
band_ob = new_mesh_object(PFX + "snout_band", *loft(band_rings), [M_strap])
sol = band_ob.modifiers.new("Solidify", 'SOLIDIFY'); sol.thickness = 0.012; sol.offset = 1.0; sol.use_even_offset = True
LEAD_ROOT = {}
for sign, side in ((-1, "L"), (1, "R")):
    LEAD_ROOT[side] = min(band, key=lambda p: (p.x * sign < 0) * 9 + abs(p.z - 1.00)).copy()
    ring = [LEAD_ROOT[side] + V(sign * 0.02, 0, 0) + V(0, 0.03 * math.cos(a), 0.03 * math.sin(a)) for a in lin(0, 2 * math.pi, 17)]
    hb.add(*tube(ring, [0.007] * len(ring), n=6, caps=(False, False)))
harness = new_mesh_object(PFX + "head_harness", hb.v, hb.f, [M_strap])
ln = Parts(); REIN_CLEAR = []
for side, sign in (("L", -1), ("R", 1)):
    ctrl = [LEAD_ROOT[side] + V(sign * 0.03, 0, 0), V(sign * 0.46, 1.10, 1.50), V(sign * 0.40, 0.72, SEAT.z + 0.22), REIN_HAND[side]]
    fixed = []
    for p in catmull(ctrl, 6):
        loc, nrm, idx, dist = TACK_BVH.find_nearest(p)
        if loc is not None and (nrm.dot(p - loc) < 0 or dist < REIN_R + 0.012):
            p = loc + nrm * (REIN_R + 0.012)
        fixed.append(p)
    for p in fixed:
        REIN_CLEAR.append(round(signed_clearance(TACK_BVH, p) - REIN_R, 4))
    ln.add(*tube(fixed, [REIN_R] * len(fixed), n=8))
leads = new_mesh_object(PFX + "lead_lines", ln.v, ln.f, [M_strap])

# ------------------------------------------------------------------------ rig
BONE_SPECS = [
    ("Root", None, (0, 0, 0), (0, 0.25, 0)),
    ("Pelvis", "Root", (0, -1.00, 1.00), (0, -0.35, 1.05)),
    ("Spine", "Pelvis", (0, -0.35, 1.05), (0, 0.35, 1.08)),
    ("Chest", "Spine", (0, 0.35, 1.08), (0, 0.95, 1.10)),
    ("Head", "Chest", (0, 0.95, 1.10), (0, 1.60, 0.92)),
    ("Snout", "Head", (0, 1.60, 0.92), (0, 2.02, 0.76)),
    ("Tail", "Pelvis", (0, -1.58, 0.74), (0, -1.95, 0.55)),
]
for sign, side in ((-1, "L"), (1, "R")):
    for prefix, (joints, radii) in LEGS.items():
        j = [V(sign * p.x, p.y, p.z) for p in joints]
        names = ["Upper", "Lower", "Paw"]
        for i, nm in enumerate(names):
            BONE_SPECS.append((f"{prefix}{nm}.{side}", ("Chest" if prefix == "Fore" else "Pelvis") if i == 0 else f"{prefix}{names[i - 1]}.{side}", tuple(j[i]), tuple(j[i + 1])))
BONE_SEG = {n: (Vector(h), Vector(t)) for n, _, h, t in BONE_SPECS}
def falloff_for(name):
    base = name.split(".")[0]
    table = {"Root": 0.01, "Pelvis": (0.62, 0.60, 0.50), "Spine": (0.72, 0.60, 0.56), "Chest": (0.80, 0.56, 0.60), "Head": 0.46, "Snout": 0.30, "Tail": 0.10}
    if base in table:
        return table[base]
    for seg, r in (("ForeUpper", 0.27), ("ForeLower", 0.20), ("ForePaw", 0.22), ("HindUpper", 0.22), ("HindLower", 0.15), ("HindPaw", 0.16)):
        if base == seg:
            return r
    return 0.2
arm_data = bpy.data.armatures.new("BarrowArmature")
RIG = bpy.data.objects.new("BarrowRig", arm_data); COLL.objects.link(RIG)
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
    axis = (BONE_B[bone].transposed() @ Vector(world_axis)).normalized()
    return Quaternion(axis, angle)
def Q(*qs):
    out = Quaternion()
    for q in qs:
        out = out @ q
    return out
BODY_BONE = "Pelvis"
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
def leg_bones(co):
    p = "Fore" if co.y > 0 else "Hind"; s = side_of(co)
    return [f"{p}{n}.{s}" for n in ("Upper", "Lower", "Paw")]
TORSO = ["Pelvis", "Spine", "Chest"]
def body_allowed(co):
    if co.y > 1.50:
        return ["Snout", "Head"]
    if co.y > 1.05 and co.z > 0.55:
        return ["Head", "Chest"]
    if abs(co.x) > 0.48 and co.z < 0.95 and (0.70 < co.y < 1.50 or -1.10 < co.y < -0.35):
        return leg_bones(co) + (["Chest"] if co.y > 0 else ["Pelvis"])
    return TORSO
skin(body, body_allowed)
skin(paws, lambda co: leg_bones(co)[1:])
skin(nose, ["Snout"]); skin(eyes, ["Head"]); skin(harness, ["Head", "Snout"]); skin(band_ob, ["Head", "Snout"]); skin(tail_ob, ["Tail", "Pelvis"]); skin(ruff_ob, ["Head", "Chest"])
for ob in (saddle, blanket, girths, stirrups):
    skin(ob, ["Spine"])
skin(plates[0], ["Chest", "Head"]); skin(plates[1], ["Chest"]); skin(plates[2], ["Spine", "Pelvis"]); skin(plates[3], ["Pelvis"]); skin(plates[4], ["Pelvis"])
for ob in guards:
    skin(ob, ["Chest"])
skin(leads, ["Head", "Chest", "Spine"])

REFS = {}
def ref_node(name, bone, point, role):
    e = bpy.data.objects.new(name, None); COLL.objects.link(e)
    e.empty_display_type = 'PLAIN_AXES'; e.empty_display_size = 0.05
    e.parent = RIG; e.parent_type = 'BONE'; e.parent_bone = bone
    bpy.context.view_layer.update()
    e.matrix_world = Matrix.Translation(Vector(point)); e["role"] = role
    REFS[name] = e; return e
ref_node("Seat", "Spine", SEAT, "rider_seat")
ref_node("Stirrup.L", "Spine", STIRRUPS["L"], "rider_stirrup")
ref_node("Stirrup.R", "Spine", STIRRUPS["R"], "rider_stirrup")
ref_node("ReinHand.L", "Spine", REIN_HAND["L"], "rider_rein_hand")
ref_node("ReinHand.R", "Spine", REIN_HAND["R"], "rider_rein_hand")

# ------------------------------------------------------------------------ clips: Idle, Shuffle, Lope, Dig (in place, floor solved)
ANIM_BONES = [n for n, _, _, _ in BONE_SPECS if n != "Root"]
def apply_pose(pose, loc):
    for name in ANIM_BONES:
        RIG.pose.bones[name].rotation_quaternion = pose.get(name, Q_ID)
    RIG.pose.bones[BODY_BONE].location = loc
    RIG.update_tag(); bpy.context.view_layer.update()
def feet_lowest(pose, loc):
    apply_pose(pose, loc)
    ev = paws.evaluated_get(dg()); m = ev.to_mesh()
    zs = {}
    for v in m.vertices:
        k = foot_group(v.co); zs[k] = min(zs.get(k, 9.0), v.co.z)
    ev.to_mesh_clear()
    return zs
_a = feet_lowest({}, body_loc(0.0)); _b = feet_lowest({}, body_loc(0.10))
LIFT_PROBE = sum(_b[k] - _a[k] for k in _a) / len(_a)
if abs(LIFT_PROBE - 0.10) > 1e-3:
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

X = (1, 0, 0)
def leg_cycle(ph, swing, amp, lift):
    """(upper swing about world X: + brings the paw forward, lower fold, paw counter) for legs that hang under the body."""
    ph %= 1.0
    if ph < swing:
        q = ph / swing; bell = math.sin(math.pi * q)
        upper = -amp + 2 * amp * smooth(0.0, 1.0, q)
        return upper, -0.9 * lift * bell, 0.45 * lift * bell
    q = (ph - swing) / (1 - swing)
    upper = amp - 2 * amp * q
    flex = 0.18 * (1 - (2 * q - 1) ** 2)
    return upper, -0.5 * flex, 0.5 * flex
def legs_pose(phases, swing, amp, lift):
    pose = {}
    for key, ph in phases.items():
        prefix, side = key.split(".")
        u, l, p = leg_cycle(ph, swing, amp, lift)
        pose[f"{prefix}Upper.{side}"] = rot(f"{prefix}Upper.{side}", X, u)
        pose[f"{prefix}Lower.{side}"] = rot(f"{prefix}Lower.{side}", X, l)
        pose[f"{prefix}Paw.{side}"] = rot(f"{prefix}Paw.{side}", X, p - u * 0.5)
    return pose
def body_pose(pose, pitch=0.0, roll=0.0, yaw=0.0, spine=0.0, chest=0.0):
    pose["Pelvis"] = Q(rot("Pelvis", X, pitch), rot("Pelvis", (0, 1, 0), roll), rot("Pelvis", (0, 0, 1), yaw))
    pose["Spine"] = rot("Spine", X, spine); pose["Chest"] = rot("Chest", X, chest)
def head_pose(pose, yaw=0.0, pitch=0.0, snout_yaw=0.0, snout_pitch=0.0):
    pose["Head"] = Q(rot("Head", (0, 0, 1), yaw), rot("Head", X, pitch))
    pose["Snout"] = Q(rot("Snout", (0, 0, 1), snout_yaw), rot("Snout", X, snout_pitch))

IDLE_F, SHUFFLE_F, LOPE_F, DIG_F = 96, 44, 24, 36
def idle_raw(phase):
    ph = 2 * math.pi * phase
    pose = {}
    body_pose(pose, roll=0.008 * math.sin(ph), spine=-0.004 * math.sin(2 * ph), chest=0.012 * math.sin(2 * ph))
    head_pose(pose, yaw=0.06 * math.sin(ph + 0.5), pitch=0.03 * math.sin(2 * ph + 1.0), snout_yaw=0.08 * math.sin(3 * ph), snout_pitch=0.06 * math.sin(3 * ph + 0.9))
    pose["Tail"] = rot("Tail", (0, 0, 1), 0.25 * math.sin(2 * ph))
    for sign, side in ((-1, "L"), (1, "R")):
        pose[f"ForePaw.{side}"] = rot(f"ForePaw.{side}", X, 0.04 * math.sin(ph + (0 if side == "R" else math.pi)))       # claws flex
    return pose, 1.0, 0.0
def shuffle_raw(phase):
    ph = 2 * math.pi * phase
    pose = legs_pose({"Hind.L": phase, "Fore.L": phase - 0.25, "Hind.R": phase - 0.5, "Fore.R": phase - 0.75}, 0.38, 0.26, 1.0)
    body_pose(pose, pitch=0.012 * math.sin(2 * ph), roll=0.05 * math.sin(ph), yaw=0.02 * math.sin(ph), spine=-0.01 * math.sin(2 * ph), chest=0.01 * math.sin(2 * ph + 1.0))
    head_pose(pose, yaw=0.12 * math.sin(ph), pitch=-0.06 + 0.03 * math.sin(2 * ph), snout_yaw=0.10 * math.sin(4 * ph), snout_pitch=0.05 * math.sin(4 * ph + 0.7))
    pose["Tail"] = rot("Tail", (0, 0, 1), 0.2 * math.sin(ph))
    return pose, 1.0, 0.0
def lope_raw(phase):
    ph = 2 * math.pi * phase
    pose = legs_pose({"Hind.L": phase, "Hind.R": phase - 0.06, "Fore.L": phase - 0.5, "Fore.R": phase - 0.56}, 0.52, 0.42, 1.2)
    pitch = 0.10 * math.sin(ph + 0.4)
    body_pose(pose, pitch=pitch, spine=0.5 * pitch, chest=-0.3 * pitch)
    head_pose(pose, pitch=-0.6 * pitch - 0.04, snout_pitch=0.3 * pitch)
    pose["Tail"] = rot("Tail", X, 0.3 + 0.15 * math.sin(ph))
    airborne = max(0.0, math.sin(ph - 2.2))
    return pose, 1.0 - 0.8 * airborne ** 2, 0.08 * airborne ** 2
def dig_raw(phase):
    ph = 2 * math.pi * phase
    pose = {}
    for sign, side, off in ((-1, "L", math.pi), (1, "R", 0.0)):
        s = math.sin(ph + off); c = math.cos(ph + off)
        # stroke: reach forward-high, then sweep outward and back with the palm raking the wall
        pose[f"ForeUpper.{side}"] = Q(rot(f"ForeUpper.{side}", X, 0.15 + 0.45 * s), rot(f"ForeUpper.{side}", (0, 0, 1), sign * (0.10 + 0.25 * max(0.0, -c))))
        pose[f"ForeLower.{side}"] = rot(f"ForeLower.{side}", X, -0.35 - 0.35 * max(0.0, s))
        pose[f"ForePaw.{side}"] = Q(rot(f"ForePaw.{side}", X, -0.2 + 0.25 * s), rot(f"ForePaw.{side}", (0, 1, 0), sign * 0.3))
        pose[f"HindUpper.{side}"] = rot(f"HindUpper.{side}", X, 0.12)
        pose[f"HindLower.{side}"] = rot(f"HindLower.{side}", X, -0.10)
        pose[f"HindPaw.{side}"] = rot(f"HindPaw.{side}", X, -0.02)
    body_pose(pose, pitch=-0.06 + 0.03 * math.sin(2 * ph), roll=0.04 * math.sin(ph), spine=-0.03, chest=-0.04 + 0.02 * math.sin(2 * ph))
    head_pose(pose, yaw=0.04 * math.sin(ph), pitch=-0.10 + 0.05 * math.sin(2 * ph + 0.5), snout_yaw=0.12 * math.sin(4 * ph), snout_pitch=0.08 * math.sin(4 * ph + 0.6))
    pose["Tail"] = rot("Tail", (0, 0, 1), 0.15 * math.sin(2 * ph))
    return pose, 1.0, 0.0
idle_pose, shuffle_pose, lope_pose, dig_pose = floored(idle_raw), floored(shuffle_raw), floored(lope_raw), floored(dig_raw)
CLIPS = [("Idle", IDLE_F, idle_pose, True, 3), ("Shuffle", SHUFFLE_F, shuffle_pose, True, 2), ("Lope", LOPE_F, lope_pose, True, 1), ("Dig", DIG_F, dig_pose, True, 2)]
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
PIVOT = V(0, 0.15, 0.95)
cam_rig = bpy.data.objects.new(PFX + "RIG", None); COLL.objects.link(cam_rig); cam_rig.location = PIVOT
cam_data = bpy.data.cameras.new(PFX + "CAM"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 5.2; cam_data.clip_start = 0.05; cam_data.clip_end = 60.0
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
TACK_CLEAR = {ob.name: shell_clearance(ob, BODY_BVH) for ob in [saddle, blanket, stirrups, harness, band_ob] + plates + guards}
TACK_CLEAR[leads.name] = shell_clearance(leads, TACK_BVH)

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
nose_mesh = next((m for m in gltf["meshes"] if m["name"] == PFX + "nose"), None)
CLIP_SET = {c[0] for c in CLIPS}
checks = {
    "clipsIdleShuffleLopeDig": set(animations) == CLIP_SET and all(v["durationSeconds"] > 0 for v in animations.values()),
    "lopeShorterThanShuffle": animations.get("Lope", {}).get("durationSeconds", 9) < animations.get("Shuffle", {}).get("durationSeconds", 0),
    "oneSkinWith19Joints": len(skins) == 1 and len(joint_names) == len(BONE_SPECS) and set(joint_names) == {n for n, _, _, _ in BONE_SPECS},
    "feetOnFloor": abs(pos_min[1]) < 0.005,
    "forwardIsNegativeZ": bool(nose_mesh) and all(acc[p["attributes"]["POSITION"]]["max"][2] < -1.7 for p in nose_mesh["primitives"]),
    "riderReferenceNodes": {"Seat", "Stirrup.L", "Stirrup.R", "ReinHand.L", "ReinHand.R"} <= set(ref_nodes),
    "noCameras": "cameras" not in gltf, "noLights": "KHR_lights_punctual" not in gltf.get("extensionsUsed", []),
    "clipsLoopClosed": all(v["loopClosure"]["poseAtPhase0EqualsPhase1"] for v in CLIP_EVIDENCE.values()),
    "plantedFeetOnFloor": all(v["lowestFootMinZ"] > -0.005 for v in CLIP_EVIDENCE.values()),
    "tackOutsideBody": all(TACK_CLEAR[k]["verticesInsideSurface"] == 0 for k in (PFX + "saddle", PFX + "blanket", PFX + "snout_band", PFX + "head_harness")),
    "platesOutsideBody": all(TACK_CLEAR[ob.name]["verticesInsideSurface"] == 0 for ob in plates + guards),
    "leadLinesClear": min(REIN_CLEAR) >= 0.0,
    "seatBetweenPlatesTwoAndThree": PLATE_SPECS[2][1] < SEAT.y < PLATE_SPECS[1][2],
    "stirrupDropInRange": all(0.40 <= SEAT.z - STIRRUPS[s].z <= 0.55 for s in STIRRUPS),
    "stirrupsClearOfBody": all(signed_clearance(BODY_BVH, STIRRUPS[s]) > 0.03 for s in STIRRUPS),
    "rootLiftAxisResolved": abs(LIFT_PROBE - 0.10) < 1e-3,
    "underTriangleBudget": eval_tris <= TRI_BUDGET,
    "fiveClawsPerForepaw": len(CLAW_ANGLES_FORE) == 5 and len(FOOT_PTS) == 4,
}
prev = json.load(open(OUT_MANIFEST)) if os.path.exists(OUT_MANIFEST) else {}
manifest = {
    "asset": "barrow_mole.glb", "generated": True,
    "status": "source authored and exported; staging only, no runtime support and no visual approval until rendered stills are reviewed",
    "species": "barrow mole (heavy subterranean tunnelling mount)",
    "sourceAxes": "Blender: +Y forward, Z up, metres", "glbAxes": "+Y up, -Z forward (export_yup)",
    "boundsMetersGlb": {"min": [round(c, 3) for c in pos_min], "max": [round(c, 3) for c in pos_max]},
    "heightMeters": round(pos_max[1], 3), "lengthMeters": round(pos_max[2] - pos_min[2], 3), "widthMeters": round(pos_max[0] - pos_min[0], 3),
    "seat": {
        "node": "Seat", "role": "rider_seat", "surface": "top surface of the saddle on the centre line between dorsal plates two and three, rest pose",
        "glbPosition": to_gltf(SEAT),
        "riderRootHint": "place the rider's root (its floor origin) at Seat minus the rider's seated pelvis-bottom height (V9: 0.823 m) plus 0.02 forward",
        "stirrupTreadGlb": {k: to_gltf(v) for k, v in STIRRUPS.items()}, "stirrupDropBelowSeatMeters": round(SEAT.z - STIRRUPS["R"].z, 4),
        "stirrupStyle": "hanging stirrups wide of the barrel (x=+-0.76) because the body is 1.36 m wide at the saddle",
        "reinHandGlb": {k: to_gltf(v) for k, v in REIN_HAND.items()}, "reinStyle": "snout band with two lead lines over the shoulder hump; no bit",
        "saddleTopSurfaceOffsetFromBodyMeters": 0.05, "saddleShellThicknessMeters": 0.035, "blanketThicknessMeters": 0.012,
    },
    "plates": {n: {"yFront": yf, "yBack": yb} for n, yf, yb in PLATE_SPECS},
    "referenceNodes": ref_nodes,
    "deformBones": joint_names, "animationClips": animations, "clipEvidence": CLIP_EVIDENCE,
    "seatMotionContract": "clipEvidence.<clip>.seatDeltaPerFrameGlb is the saddle's displacement from rest per frame (glTF axes) for a per-species rider ride solve",
    "meshObjects": [ob.name for ob in MESHES], "perObject": per_object,
    "trianglesEvaluated": eval_tris, "drawGroups": draw_groups, "materialCount": len(bpy.data.materials), "glbBytes": os.path.getsize(OUT_GLB),
    "budget": {"targetTriangles": TRI_BUDGET, "trianglesMet": eval_tris <= TRI_BUDGET, "bodyCoreRawTriangles": raw_tris, "bodyCoreTargetTriangles": BODY_TARGET_TRIS},
    "metaballCalibration": {"visibleRadiusOfUnitBall": round(K_META, 4), "ellipsoidSize(1,2,0.5)Extents": CAL_ELL},
    "tackClearance": TACK_CLEAR, "leadLineClearanceMeters": {"min": min(REIN_CLEAR), "samples": len(REIN_CLEAR)},
    "floorSolveProbe": {"liftRequested": 0.10, "feetRaised": round(LIFT_PROBE, 4)},
    "sha256": {"glb": GLB_SHA, "blend": BLEND_SHA},
    "glbChecks": checks, "glbStructureValid": all(checks.values()),
    "peakProcessMemoryMB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1),
    "authorSeconds": round(time.time() - T0, 1), "blender": bpy.app.version_string,
    "command": "blender -b -t 4 --factory-startup --python author_barrow.py",
}
for key in ("design", "traversalRole", "riderClipMap", "renders"):
    if key in prev:
        manifest[key] = prev[key]
if "renders" in manifest:
    manifest["renders"]["currentForGlb"] = False
with open(OUT_MANIFEST, "w") as f:
    json.dump(manifest, f, indent=1)
print("BARROW_DONE", json.dumps({"tris": eval_tris, "checks": checks, "seat": to_gltf(SEAT), "sha": GLB_SHA[:12], "peakMB": manifest["peakProcessMemoryMB"]}))
