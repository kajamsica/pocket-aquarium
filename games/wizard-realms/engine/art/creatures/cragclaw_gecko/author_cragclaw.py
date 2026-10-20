"""Cragclaw gecko: compact cliff-climbing mount for the Wizard Realms mount pack (asset staging only).

Silhouette: a stocky 3.6 m gecko only 1.06 m at the back. Broad triangular head with large side-set amber eyes under
brow ridges and dark vertical slit pupils, wide mouth line, knobbly tubercle rows along the back, semi-sprawled legs
with five-toed splayed feet ending in round gripping toe pads, and a long thick counterbalance tail carried curled up
off the ground. Tack: a climbing saddle with a high cantle and knee rolls, violet blanket with gold trim, two girths,
breast collar and a crupper around the tail root (the saddle cannot slide on steep routes), stirrups, light headstall
and reins. Everything is procedural (metaball core; tube toes with pad spheres; tack sampled off the body with a BVH).

Conventions follow ../sedgehorn_mount/author_sedgehorn.py and ../MOUNT_PACK_DESIGN_BRIEF.md: Blender +Y forward,
Z up, toe pads on Z=0; exported +Y up, -Z forward. Rig: Root (unkeyed), Pelvis (keyed floor-solve location), Spine,
Chest, Neck, Head, Jaw, Tail1-4, four legs x Upper/Lower/Foot = 23 joints. Clips Idle, Creep, Scurry are in place.

Run on the render machine only (one headless process):
    blender -b -t 4 --factory-startup --python author_cragclaw.py
Outputs: cragclaw_gecko.blend, cragclaw_gecko.glb, cragclaw_manifest.json (design blocks are preserved)
"""
import bpy, bmesh, json, math, os, time, resource, struct, hashlib
from mathutils import Vector, Euler, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_BLEND = os.path.join(HERE, "cragclaw_gecko.blend")
OUT_GLB = os.path.join(HERE, "cragclaw_gecko.glb")
OUT_MANIFEST = os.path.join(HERE, "cragclaw_manifest.json")
PFX = "CG_"
TRI_BUDGET = 40000
BODY_TARGET_TRIS = 14000

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
COLL = bpy.data.collections.new("CragclawGecko")
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
SLATE, OCHRE, THROAT_C, MOUTH_C, TUBERCLE_C = (0.30, 0.34, 0.40), (0.62, 0.45, 0.18), (0.78, 0.74, 0.62), (0.08, 0.06, 0.06), (0.18, 0.20, 0.25)
M_skin = mat_principled(PFX + "skin", (1.0, 1.0, 1.0), rough=0.60, sheen=0.08, bump=0.35, bump_scale=55, vcol=True)   # white x COLOR_0
M_toe = mat_principled(PFX + "toe", SLATE, rough=0.60, bump=0.3, bump_scale=70)
M_pad = mat_principled(PFX + "toe_pad", (0.80, 0.76, 0.66), rough=0.45, sheen=0.2, bump=0.2, bump_scale=140)
M_tubercle = mat_principled(PFX + "tubercle", TUBERCLE_C, rough=0.5, bump=0.2, bump_scale=120)
M_eye = mat_principled(PFX + "eye_amber", (0.88, 0.58, 0.14), rough=0.10)
M_pupil = mat_principled(PFX + "pupil", (0.03, 0.03, 0.03), rough=0.1)
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
E((0, 1.42, 0.78), 0.20, 0.22, 0.12)                      # snout
E((0, 1.05, 0.84), 0.36, 0.42, 0.22)                      # broad head
E((0, 0.85, 0.82), 0.40, 0.22, 0.22)                      # jowls: the triangle's wide back corners
E((0, 1.10, 0.68), 0.32, 0.38, 0.11)                      # lower jaw mass
E((0, 0.62, 0.84), 0.30, 0.20, 0.26)                      # short neck
E((0, 0.25, 0.72), 0.44, 0.55, 0.34)                      # fore trunk
E((0, -0.35, 0.72), 0.46, 0.55, 0.34)                     # hind trunk
E((0, -0.85, 0.70), 0.40, 0.40, 0.30)                     # hips
TAIL_CTRL = [(V(0, -1.20, 0.66), 0.26), (V(0, -1.55, 0.60), 0.21), (V(0, -1.90, 0.58), 0.16), (V(0, -2.20, 0.66), 0.11), (V(0, -2.42, 0.82), 0.07), (V(0, -2.55, 1.00), 0.045)]
TAIL_PTS = catmull([p for p, _ in TAIL_CTRL], 4)
for i, p in enumerate(TAIL_PTS):
    t = i / (len(TAIL_PTS) - 1) * (len(TAIL_CTRL) - 1); j = min(int(t), len(TAIL_CTRL) - 2)
    S(p, lerp(TAIL_CTRL[j][1], TAIL_CTRL[j + 1][1], t - j))
LEGS = {
    "Fore": ([V(0.36, 0.60, 0.70), V(0.70, 0.50, 0.70), V(0.78, 0.74, 0.22), V(0.84, 0.92, 0.05)], [0.17, 0.13, 0.095, 0.07]),
    "Hind": ([V(0.36, -0.60, 0.68), V(0.72, -0.44, 0.72), V(0.80, -0.66, 0.22), V(0.88, -0.48, 0.05)], [0.18, 0.14, 0.095, 0.07]),
}
def leg_balls(joints, radii, sign):
    for j in range(len(joints) - 2):                            # last segment is the foot (separate mesh)
        a, b = joints[j], joints[j + 1]
        steps = max(2, int((b - a).length / 0.08))
        for k in range(steps + (1 if j == len(joints) - 3 else 0)):
            t = k / steps
            p = a.lerp(b, t); r = lerp(radii[j], radii[j + 1], t)
            if j == 1 and k == 0:
                r *= 1.12
            S((sign * p.x, p.y, p.z), r)
for sign in (-1, 1):
    for joints, radii in LEGS.values():
        leg_balls(joints, radii, sign)

core = meta_mesh(ELEMENTS, PFX + "core", 0.045)
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
body_me.materials.append(M_skin)
body = bpy.data.objects.new(PFX + "body", body_me); COLL.objects.link(body)
BODY_BVH = bvh_of([body])
AXIS_Z = 0.72
TAIL_MIN_Z = min(v.co.z for v in body_me.vertices if v.co.y < -1.30)

# skin colours baked to COLOR_0: slate base, ochre transverse bands over the back and tail, pale throat/belly, dark mouth line
col = body_me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
for v in body_me.vertices:
    co = v.co
    c = mix(SLATE, THROAT_C, smooth(0.62, 0.40, co.z) * (1.0 if abs(co.x) < 0.5 else 0.3))
    band = smooth(0.55, 0.85, 0.5 + 0.5 * math.sin(co.y * 6.5 + 0.4 * math.sin(co.x * 5)))
    c = mix(c, OCHRE, band * smooth(0.55, 0.75, co.z) * (1.0 if co.y < 0.75 else 0.3))
    c = mix(c, MOUTH_C, (1.0 if co.y > 0.95 else 0.0) * smooth(0.025, 0.010, abs(co.z - 0.735)) * smooth(0.0, 0.1, co.y - 0.95))
    col.data[v.index].color = (*c, 1.0)
body_me.color_attributes.active_color = col

# ------------------------------------------------------------------------ feet: five splayed toes with gripping pads (pads define the floor)
FOOT_PTS = {}
TOE_ANGLES = [deg(a) for a in (-75, -37.5, 0, 37.5, 75)]
TOE_LEN = [0.20, 0.24, 0.26, 0.24, 0.20]
ft = Parts()
for prefix, (joints, radii) in LEGS.items():
    for sign, side in ((-1, "L"), (1, "R")):
        wrist = V(sign * joints[2].x, joints[2].y, joints[2].z); fc = V(sign * joints[3].x, joints[3].y, 0.0)
        FOOT_PTS[prefix + "." + side] = fc
        fwd = (V(fc.x, fc.y, 0) - V(wrist.x, wrist.y, 0)).normalized()
        sidev = fwd.cross(V(0, 0, 1))
        ft.add(*sphere_part(fc + V(0, 0, 0.065), 0.12, scale=(1.0, 1.0, 0.5)), 0)                 # palm
        ft.add(*tube([wrist + V(0, 0, 0.02), fc + V(0, 0, 0.07)], [0.08, 0.09], n=10), 0)       # ankle to palm
        for th, L in zip(TOE_ANGLES, TOE_LEN):
            d = fwd * math.cos(th) + sidev * math.sin(th)
            pts = catmull([fc + d * 0.05 + V(0, 0, 0.065), fc + d * (0.5 * L) + V(0, 0, 0.075), fc + d * L + V(0, 0, 0.04)], 4)
            ft.add(*tube(pts, [lerp(0.048, 0.030, i / (len(pts) - 1)) for i in range(len(pts))], n=8), 0)
            ft.add(*sphere_part(fc + d * (L + 0.02) + V(0, 0, 0.032), 0.052, scale=(1.15, 1.25, 0.62)), 1)   # gripping pad, bottom on Z=0
feet = new_mesh_object(PFX + "feet", ft.v, ft.f, [M_toe, M_pad], ft.mi)
def foot_group(co):
    return ("Fore" if co.y > 0 else "Hind") + "." + ("R" if co.x > 0 else "L")

# ------------------------------------------------------------------------ eyes, pupils, brow ridges, tubercles
EYE_C = {s: V(sg * 0.30, 1.02, 0.95) for s, sg in (("L", -1), ("R", 1))}
eye = Parts(); pupil = Parts(); brow = Parts()
for s, c in EYE_C.items():
    sg = 1 if s == "R" else -1
    eye.add(*sphere_part(c, 0.11, u=18, v=12))
    pupil.add(*sphere_part(c + V(sg * 0.105, 0.025, 0.0), 0.06, scale=(0.25, 0.45, 1.0)))          # vertical slit proud of the eye surface (r 0.11) by ~1 cm
    ring = [c + V(sg * 0.02, 0.135 * math.cos(a), 0.135 * math.sin(a)) for a in lin(deg(15), deg(165), 11)]
    brow.add(*tube(ring, [0.032] * len(ring), n=8))
eyes = new_mesh_object(PFX + "eyes", eye.v, eye.f, [M_eye])
pupils = new_mesh_object(PFX + "pupils", pupil.v, pupil.f, [M_pupil])
brows = new_mesh_object(PFX + "brow_ridges", brow.v, brow.f, [M_tubercle])
tb = Parts(); TUBERCLES = 0
for y in lin(-1.35, 0.75, 12):
    if -0.30 < y < 0.50:
        continue                                                     # saddle station stays smooth
    for a in (-0.78, -0.30, 0.30, 0.78):
        loc, nrm = outer_hit(BODY_BVH, (0, y, AXIS_Z), (math.sin(a), 0, math.cos(a)))
        if loc is None:
            continue
        r = 0.032 + 0.012 * math.cos(y * 3.1 + a)
        tb.add(*sphere_part(loc + nrm.normalized() * (0.35 * r), r, scale=(1.0, 1.0, 0.75), u=8, v=5)); TUBERCLES += 1
tubercles = new_mesh_object(PFX + "tubercles", tb.v, tb.f, [M_tubercle])

# ------------------------------------------------------------------------ tack sampled off the body
def shell_on(name, bvh, ys, angles, offset, mats, rise=None, thickness=0.012, trim_border=False):
    verts = []; mat_idx = []
    for r, y in enumerate(ys):
        for c, a in enumerate(angles):
            d = V(math.sin(a), 0, math.cos(a))
            loc, nrm = outer_hit(bvh, (0, y, AXIS_Z), d)
            if loc is None:
                loc = V(0, y, AXIS_Z) + d * 0.5
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
blanket, _ = shell_on(PFX + "blanket", BODY_BVH, lin(-0.22, 0.50, 9), [deg(a) for a in lin(-88, 88, 17)], 0.020, [M_blanket, M_trim], trim_border=True)
SADDLE_YS = lin(-0.12, 0.42, 11); SADDLE_AS = [deg(a) for a in lin(-66, 66, 15)]
def saddle_rise(r, a):
    pommel = 0.07 * smooth(7.5, 10.0, r) * max(0.0, 1 - (a / deg(26)) ** 2)
    cantle = 0.13 * smooth(2.5, 0.0, r) * max(0.0, 1 - (a / deg(56)) ** 2)                      # high cantle for steep routes
    knee_roll = 0.05 * smooth(6.0, 9.0, r) * smooth(deg(28), deg(50), abs(a)) * smooth(deg(66), deg(58), abs(a))
    return pommel + cantle + knee_roll
saddle, saddle_verts = shell_on(PFX + "saddle", BODY_BVH, SADDLE_YS, SADDLE_AS, 0.05, [M_saddle], rise=saddle_rise, thickness=0.035)
SEAT = saddle_verts[5 * len(SADDLE_AS) + 7].copy()
def ring_loop(bvh, y, offset, n=40, z_axis=AXIS_Z):
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        d = V(math.sin(a), 0, math.cos(a))
        loc, nrm = outer_hit(bvh, (0, y, z_axis), d)
        pts.append((loc + d * offset) if loc else V(0, y, z_axis) + d * 0.5)
    pts.append(pts[0])
    return pts
def surface_path(bvh, pts, offset, z_axis=AXIS_Z, keep_first=False, keep_last=False):
    """Project a chord of points radially (about the body axis at z_axis) onto the outermost surface + offset, so straps
    follow convex heads and shoulders instead of cutting through them."""
    out = []
    for i, p in enumerate(pts):
        if (keep_first and i == 0) or (keep_last and i == len(pts) - 1):
            out.append(p.copy()); continue
        d = V(p.x, 0, p.z - z_axis)
        if d.length < 1e-4:
            d = V(0, 0, 1)
        d.normalize()
        loc, nrm = outer_hit(bvh, (0, p.y, z_axis), d)
        out.append((loc + d * offset) if loc else p.copy())
    return out
TACK_BVH = bvh_of([body, saddle, blanket])
straps = Parts()
for y in (-0.02, 0.30):
    ring = ring_loop(TACK_BVH, y, 0.018)
    straps.add(*tube(ring, None, n=8, caps=(False, False), ru_rv=[(0.012, 0.04)] * len(ring)))
crupper_ring = ring_loop(BODY_BVH, -1.25, 0.016, z_axis=0.66)                             # crupper loop around the tail root
straps.add(*tube(crupper_ring, None, n=8, caps=(False, False), ru_rv=[(0.012, 0.03)] * len(crupper_ring)))
# breastplate: two straps from the saddle front over the shoulders (ahead of the fore-leg roots at y 0.60) to a chest
# ring under the throat; every point is projected onto the surface so the straps hug the shoulder
chest_loc, _ = outer_hit(BODY_BVH, (0, 0.82, 0.80), (0, 0, -1))
CHEST = (chest_loc + V(0, 0, -0.016)) if chest_loc else V(0, 0.82, 0.30)
straps.add(*tube([CHEST + V(0.03 * math.cos(a), 0, 0.03 * math.sin(a)) for a in lin(0, 2 * math.pi, 17)], [0.008] * 17, n=6, caps=(False, False)))
front_l = saddle_verts[10 * len(SADDLE_AS) + 2]; front_r = saddle_verts[10 * len(SADDLE_AS) + len(SADDLE_AS) - 3]
for sign, fr in ((-1, front_l), (1, front_r)):
    chord = [fr.lerp(CHEST, t) for t in lin(0.0, 1.0, 11)]
    for q in chord[1:-1]:
        q.y += 0.10 * math.sin(math.pi * ((q.y - fr.y) / (CHEST.y - fr.y)))        # bow forward over the shoulder, clear of the leg root
    pts = surface_path(BODY_BVH, chord, 0.016, z_axis=0.80, keep_first=True, keep_last=True)
    straps.add(*tube(catmull(pts, 2), None, n=8, ru_rv=[(0.012, 0.03)] * (2 * (len(pts) - 1) + 1)))
cantle_c = saddle_verts[0 * len(SADDLE_AS) + 7]
crup_top = max(crupper_ring, key=lambda p: p.z)
cr_pts = []
for p in catmull([cantle_c + V(0, -0.02, 0.0), V(0, -0.60, 0), V(0, -0.95, 0), crup_top], 6):
    loc, nrm = outer_hit(TACK_BVH, (p.x, p.y, 0.0), (0, 0, 1))          # over the blanket edge, then along the spine to the tail root
    cr_pts.append((loc + V(0, 0, 0.012)) if loc else p)
cr_pts[0] = cantle_c + V(0, -0.02, 0.0)
straps.add(*tube(cr_pts, None, n=8, ru_rv=[(0.03, 0.01)] * len(cr_pts)))
for i, p in enumerate(straps.v):
    loc, nrm, _, dist = BODY_BVH.find_nearest(p)
    if loc is not None and (nrm.dot(p - loc) < 0 or dist < 0.004):
        straps.v[i] = loc + nrm * 0.004
strap_ob = new_mesh_object(PFX + "straps", straps.v, straps.f, [M_strap])

STIRRUP_DROP, STIRRUP_X = 0.46, 0.58
flap_l = saddle_verts[6 * len(SADDLE_AS) + 0]; flap_r = saddle_verts[6 * len(SADDLE_AS) + len(SADDLE_AS) - 1]
STIRRUPS = {}
stp = Parts()
for sign, flap in ((-1, flap_l), (1, flap_r)):
    x = sign * STIRRUP_X; y = flap.y
    z_top = flap.z + 0.02; z_c = SEAT.z - STIRRUP_DROP + 0.085
    stp.add(*tube([V(flap.x, y, z_top), V(x, y, z_c + 0.09)], None, n=8, ru_rv=[(0.04, 0.012), (0.04, 0.012)]))
    ring = catmull([V(x, y, z_c + 0.085 * math.cos(a)) + V(0.085 * math.sin(a) * 0.95, 0, 0) for a in lin(0, 2 * math.pi, 25)], 1)
    stp.add(*tube(ring, [0.011] * len(ring), n=8, caps=(False, False)))
    tread_c = V(x, y, z_c - 0.085)
    stp.add(*box_part(tread_c + V(0, 0, 0.007), (0.09, 0.06, 0.014)))
    STIRRUPS["R" if sign > 0 else "L"] = tread_c + V(0, 0, 0.014)
stirrups = new_mesh_object(PFX + "stirrups", stp.v, stp.f, [M_iron])

REIN_HAND = {"L": V(-0.17, SEAT.y + 0.22, SEAT.z + 0.32), "R": V(0.17, SEAT.y + 0.22, SEAT.z + 0.32)}
REIN_R = 0.011
br = Parts()
headstall = ring_loop(BODY_BVH, 0.84, 0.016, n=24, z_axis=0.80)                           # 4 mm proud of the skin (tube r 0.012)
noseband = ring_loop(BODY_BVH, 1.32, 0.016, n=24, z_axis=0.76)
br.add(*tube(headstall, [0.012] * len(headstall), n=8, caps=(False, False)))
br.add(*tube(noseband, [0.012] * len(noseband), n=8, caps=(False, False)))
REIN_ROOT = {}
for sign, side in ((-1, "L"), (1, "R")):
    hs = min(headstall, key=lambda p: (p.x * sign < 0) * 9 + abs(p.z - 0.84))
    nb = min(noseband, key=lambda p: (p.x * sign < 0) * 9 + abs(p.z - 0.78))
    cheek = surface_path(BODY_BVH, [hs.lerp(nb, t) for t in lin(0.0, 1.0, 7)], 0.015, z_axis=0.78, keep_first=True, keep_last=True)
    br.add(*tube(cheek, [0.011] * len(cheek), n=8))                                       # cheek strap hugs the convex jowl
    REIN_ROOT[side] = hs.copy()
bridle = new_mesh_object(PFX + "bridle", br.v, br.f, [M_strap])
rn = Parts(); REIN_CLEAR = []
for side, sign in (("L", -1), ("R", 1)):
    ctrl = [REIN_ROOT[side], V(sign * 0.38, 0.66, 1.08), V(sign * 0.30, 0.50, SEAT.z + 0.16), REIN_HAND[side]]
    fixed = []
    for p in catmull(ctrl, 6):
        loc, nrm, idx, dist = BODY_BVH.find_nearest(p)
        if loc is not None and (nrm.dot(p - loc) < 0 or dist < REIN_R + 0.012):
            p = loc + nrm * (REIN_R + 0.012)
        fixed.append(p)
    for p in fixed:
        REIN_CLEAR.append(round(signed_clearance(BODY_BVH, p) - REIN_R, 4))
    rn.add(*tube(fixed, [REIN_R] * len(fixed), n=8))
reins = new_mesh_object(PFX + "reins", rn.v, rn.f, [M_strap])

# ------------------------------------------------------------------------ rig
TAIL_JOINTS = [tuple(p) for p, _ in TAIL_CTRL[:5]] + [tuple(TAIL_CTRL[5][0])]
BONE_SPECS = [
    ("Root", None, (0, 0, 0), (0, 0.25, 0)),
    ("Pelvis", "Root", (0, -0.85, 0.72), (0, -0.30, 0.74)),
    ("Spine", "Pelvis", (0, -0.30, 0.74), (0, 0.25, 0.76)),
    ("Chest", "Spine", (0, 0.25, 0.76), (0, 0.65, 0.80)),
    ("Neck", "Chest", (0, 0.65, 0.80), (0, 0.90, 0.84)),
    ("Head", "Neck", (0, 0.90, 0.84), (0, 1.62, 0.78)),
    ("Jaw", "Head", (0, 0.95, 0.68), (0, 1.55, 0.64)),
    ("Tail1", "Pelvis", TAIL_JOINTS[0], TAIL_JOINTS[1]),
    ("Tail2", "Tail1", TAIL_JOINTS[1], TAIL_JOINTS[2]),
    ("Tail3", "Tail2", TAIL_JOINTS[2], TAIL_JOINTS[3]),
    ("Tail4", "Tail3", TAIL_JOINTS[3], TAIL_JOINTS[5]),
]
for sign, side in ((-1, "L"), (1, "R")):
    for prefix, (joints, radii) in LEGS.items():
        j = [V(sign * p.x, p.y, p.z) for p in joints]
        names = ["Upper", "Lower", "Foot"]
        for i, nm in enumerate(names):
            BONE_SPECS.append((f"{prefix}{nm}.{side}", ("Chest" if prefix == "Fore" else "Pelvis") if i == 0 else f"{prefix}{names[i - 1]}.{side}", tuple(j[i]), tuple(j[i + 1])))
BONE_SEG = {n: (Vector(h), Vector(t)) for n, _, h, t in BONE_SPECS}
def falloff_for(name):
    base = name.split(".")[0]
    table = {"Root": 0.01, "Pelvis": (0.46, 0.42, 0.34), "Spine": (0.50, 0.45, 0.38), "Chest": (0.48, 0.42, 0.38), "Neck": 0.34, "Head": 0.42, "Jaw": 0.24,
             "Tail1": 0.30, "Tail2": 0.24, "Tail3": 0.17, "Tail4": 0.12}
    if base in table:
        return table[base]
    for seg, r in (("Upper", 0.19), ("Lower", 0.13), ("Foot", 0.13)):
        if base.endswith(seg):
            return r
    return 0.2
arm_data = bpy.data.armatures.new("CragclawArmature")
RIG = bpy.data.objects.new("CragclawRig", arm_data); COLL.objects.link(RIG)
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
    return [f"{p}{n}.{s}" for n in ("Upper", "Lower", "Foot")]
TAILS = ["Tail1", "Tail2", "Tail3", "Tail4"]
TORSO = ["Pelvis", "Spine", "Chest", "Neck"]
def body_allowed(co):
    if co.y > 0.78 and co.z > 0.45:
        return ["Head", "Neck"] + (["Jaw"] if co.z < 0.72 else [])
    if abs(co.x) > 0.34 and co.z < 0.85 and (0.30 < co.y < 1.05 or -0.95 < co.y < -0.20):
        return leg_bones(co) + (["Chest"] if co.y > 0 else ["Pelvis"])
    if co.y < -1.05:
        return ["Pelvis"] + TAILS
    return TORSO
skin(body, body_allowed)
skin(feet, lambda co: leg_bones(co)[1:])
skin(tubercles, lambda co: (["Pelvis"] + TAILS) if co.y < -1.05 else TORSO)
for ob in (eyes, pupils, brows, bridle):
    skin(ob, ["Head"])
for ob in (saddle, blanket, stirrups):
    skin(ob, ["Spine"])
skin(strap_ob, lambda co: (["Pelvis", "Tail1"] if co.y < -0.9 else (["Chest", "Neck"] if co.y > 0.5 else ["Spine", "Chest", "Pelvis"])))
skin(reins, ["Head", "Neck", "Chest", "Spine"])

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

# ------------------------------------------------------------------------ clips: Idle, Creep, Scurry (in place, floor solved)
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

LIFT_AXIS = {"R": (0, -1, 0), "L": (0, 1, 0)}
def leg_cycle(ph, swing, amp, lift):
    ph %= 1.0
    if ph < swing:
        q = ph / swing; bell = math.sin(math.pi * q)
        return -amp + 2 * amp * smooth(0.0, 1.0, q), 0.50 * lift * bell, -0.65 * lift * bell
    q = (ph - swing) / (1 - swing)
    return amp - 2 * amp * q, 0.0, 0.0
def legs_pose(phases, swing, amp, lift):
    pose = {}
    for key, ph in phases.items():
        prefix, side = key.split("."); sign = 1 if side == "R" else -1
        yaw, up, fold = leg_cycle(ph, swing, amp, lift)
        pose[f"{prefix}Upper.{side}"] = Q(rot(f"{prefix}Upper.{side}", (0, 0, 1), sign * yaw), rot(f"{prefix}Upper.{side}", LIFT_AXIS[side], up))
        pose[f"{prefix}Lower.{side}"] = rot(f"{prefix}Lower.{side}", LIFT_AXIS[side], fold)
        pose[f"{prefix}Foot.{side}"] = Q(rot(f"{prefix}Foot.{side}", LIFT_AXIS[side], -(up + fold) * 0.9), rot(f"{prefix}Foot.{side}", (0, 0, 1), -sign * yaw * 0.6))
    return pose
def body_wave(pose, amp, ph, lag=0.35):
    pose["Pelvis"] = rot("Pelvis", (0, 0, 1), -0.5 * amp * math.sin(ph))
    pose["Spine"] = rot("Spine", (0, 0, 1), amp * math.sin(ph))
    pose["Chest"] = rot("Chest", (0, 0, 1), 0.8 * amp * math.sin(ph - lag))
    pose["Neck"] = rot("Neck", (0, 0, 1), -0.5 * amp * math.sin(ph - lag))
    pose["Head"] = rot("Head", (0, 0, 1), -0.6 * amp * math.sin(ph - lag))
    for i, name in enumerate(TAILS):
        pose[name] = rot(name, (0, 0, 1), -amp * (0.9 + 0.3 * i) * math.sin(ph - 0.6 * (i + 1)))

IDLE_F, CREEP_F, SCURRY_F = 96, 56, 24
def idle_raw(phase):
    ph = 2 * math.pi * phase
    pose = {}
    body_wave(pose, 0.008, ph)
    pose["Head"] = Q(pose["Head"], rot("Head", (0, 1, 0), 0.07 * math.sin(ph + 0.6)), rot("Head", (1, 0, 0), 0.03 * math.sin(2 * ph)))      # curious head tilt
    pose["Jaw"] = rot("Jaw", (1, 0, 0), -0.02 - 0.015 * math.sin(3 * ph))                                                             # throat pulse
    pose["Chest"] = Q(pose["Chest"], rot("Chest", (1, 0, 0), 0.008 * math.sin(2 * ph)))
    pose["Tail3"] = Q(pose["Tail3"], rot("Tail3", (1, 0, 0), 0.08 * math.sin(ph - 1.0)))
    pose["Tail4"] = Q(pose["Tail4"], rot("Tail4", (1, 0, 0), 0.14 * math.sin(ph - 1.6)))                                               # tail-tip curl
    return pose, 1.0, 0.0
def creep_raw(phase):
    ph = 2 * math.pi * phase
    pose = legs_pose({"Fore.L": phase, "Hind.R": phase, "Fore.R": phase - 0.5, "Hind.L": phase - 0.5}, 0.36, 0.30, 1.1)
    body_wave(pose, 0.05, ph)
    pose["Pelvis"] = Q(pose["Pelvis"], rot("Pelvis", (0, 1, 0), 0.02 * math.sin(ph)))
    pose["Head"] = Q(pose["Head"], rot("Head", (1, 0, 0), 0.02 * math.sin(2 * ph)))
    pose["Jaw"] = rot("Jaw", (1, 0, 0), -0.015)
    return pose, 1.0, 0.006 * math.sin(2 * ph)
def scurry_raw(phase):
    ph = 2 * math.pi * phase
    pose = legs_pose({"Fore.L": phase, "Hind.R": phase, "Fore.R": phase - 0.5, "Hind.L": phase - 0.5}, 0.50, 0.40, 0.9)
    body_wave(pose, 0.10, ph, lag=0.5)
    pose["Pelvis"] = Q(pose["Pelvis"], rot("Pelvis", (0, 1, 0), 0.03 * math.sin(ph)), rot("Pelvis", (1, 0, 0), 0.02 * math.sin(2 * ph)))
    pose["Head"] = Q(pose["Head"], rot("Head", (1, 0, 0), -0.04))
    pose["Jaw"] = rot("Jaw", (1, 0, 0), -0.03)
    return pose, 1.0, 0.014 * math.sin(2 * ph + 0.4)
idle_pose, creep_pose, scurry_pose = floored(idle_raw), floored(creep_raw), floored(scurry_raw)
CLIPS = [("Idle", IDLE_F, idle_pose, True, 3), ("Creep", CREEP_F, creep_pose, True, 2), ("Scurry", SCURRY_F, scurry_pose, True, 1)]
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
PIVOT = V(0, -0.35, 0.70)
cam_rig = bpy.data.objects.new(PFX + "RIG", None); COLL.objects.link(cam_rig); cam_rig.location = PIVOT
cam_data = bpy.data.cameras.new(PFX + "CAM"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 5.0; cam_data.clip_start = 0.05; cam_data.clip_end = 60.0
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
TACK_CLEAR = {ob.name: shell_clearance(ob, BODY_BVH) for ob in (saddle, blanket, stirrups, reins, strap_ob, bridle, brows)}

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
eyes_mesh = next((m for m in gltf["meshes"] if m["name"] == PFX + "eyes"), None)
CLIP_SET = {c[0] for c in CLIPS}
checks = {
    "clipsIdleCreepScurry": set(animations) == CLIP_SET and all(v["durationSeconds"] > 0 for v in animations.values()),
    "scurryShorterThanCreep": animations.get("Scurry", {}).get("durationSeconds", 9) < animations.get("Creep", {}).get("durationSeconds", 0),
    "oneSkinWith23Joints": len(skins) == 1 and len(joint_names) == len(BONE_SPECS) and set(joint_names) == {n for n, _, _, _ in BONE_SPECS},
    "feetOnFloor": abs(pos_min[1]) < 0.005,
    "forwardIsNegativeZ": bool(eyes_mesh) and all(acc[p["attributes"]["POSITION"]]["max"][2] < -0.8 for p in eyes_mesh["primitives"]),
    "riderReferenceNodes": {"Seat", "Stirrup.L", "Stirrup.R", "ReinHand.L", "ReinHand.R"} <= set(ref_nodes),
    "noCameras": "cameras" not in gltf, "noLights": "KHR_lights_punctual" not in gltf.get("extensionsUsed", []),
    "clipsLoopClosed": all(v["loopClosure"]["poseAtPhase0EqualsPhase1"] for v in CLIP_EVIDENCE.values()),
    "plantedFeetOnFloor": all(v["lowestFootMinZ"] > -0.005 for v in CLIP_EVIDENCE.values()),
    "tackOutsideBody": all(TACK_CLEAR[k]["verticesInsideSurface"] == 0 for k in (PFX + "saddle", PFX + "blanket", PFX + "reins", PFX + "straps", PFX + "bridle")),
    "reinsClearOfBody": min(REIN_CLEAR) >= 0.0,
    "tailCarriedOffGround": TAIL_MIN_Z > 0.15,
    "stirrupDropInRange": all(0.40 <= SEAT.z - STIRRUPS[s].z <= 0.55 for s in STIRRUPS),
    "stirrupsClearOfBody": all(signed_clearance(BODY_BVH, STIRRUPS[s]) > 0.03 for s in STIRRUPS),
    "rootLiftAxisResolved": abs(LIFT_PROBE - 0.10) < 1e-3,
    "underTriangleBudget": eval_tris <= TRI_BUDGET,
    "fiveToesPerFoot": len(TOE_ANGLES) == 5 and len(FOOT_PTS) == 4,
}
prev = json.load(open(OUT_MANIFEST)) if os.path.exists(OUT_MANIFEST) else {}
manifest = {
    "asset": "cragclaw_gecko.glb", "generated": True,
    "status": "source authored and exported; staging only, no runtime support and no visual approval until rendered stills are reviewed",
    "species": "cragclaw gecko (compact cliff-climbing mount)",
    "sourceAxes": "Blender: +Y forward, Z up, metres", "glbAxes": "+Y up, -Z forward (export_yup)",
    "boundsMetersGlb": {"min": [round(c, 3) for c in pos_min], "max": [round(c, 3) for c in pos_max]},
    "heightMeters": round(pos_max[1], 3), "lengthMeters": round(pos_max[2] - pos_min[2], 3), "widthMeters": round(pos_max[0] - pos_min[0], 3),
    "seat": {
        "node": "Seat", "role": "rider_seat", "surface": "top surface of the climbing saddle on the centre line, rest pose",
        "glbPosition": to_gltf(SEAT),
        "riderRootHint": "place the rider's root (its floor origin) at Seat minus the rider's seated pelvis-bottom height (V9: 0.823 m) plus 0.02 forward",
        "stirrupTreadGlb": {k: to_gltf(v) for k, v in STIRRUPS.items()}, "stirrupDropBelowSeatMeters": round(SEAT.z - STIRRUPS["R"].z, 4),
        "stirrupStyle": "hanging stirrups beside the flank; high cantle, knee rolls, breast collar and crupper hold the saddle on steep routes",
        "reinHandGlb": {k: to_gltf(v) for k, v in REIN_HAND.items()}, "reinStyle": "light headstall behind the jowls with noseband",
        "saddleTopSurfaceOffsetFromBodyMeters": 0.05, "saddleShellThicknessMeters": 0.035, "blanketThicknessMeters": 0.012,
    },
    "tailLowestRestZMeters": round(TAIL_MIN_Z, 4), "tubercleCount": TUBERCLES,
    "referenceNodes": ref_nodes,
    "deformBones": joint_names, "animationClips": animations, "clipEvidence": CLIP_EVIDENCE,
    "seatMotionContract": "clipEvidence.<clip>.seatDeltaPerFrameGlb is the saddle's displacement from rest per frame (glTF axes) for a per-species rider ride solve",
    "meshObjects": [ob.name for ob in MESHES], "perObject": per_object,
    "trianglesEvaluated": eval_tris, "drawGroups": draw_groups, "materialCount": len(bpy.data.materials), "glbBytes": os.path.getsize(OUT_GLB),
    "budget": {"targetTriangles": TRI_BUDGET, "trianglesMet": eval_tris <= TRI_BUDGET, "bodyCoreRawTriangles": raw_tris, "bodyCoreTargetTriangles": BODY_TARGET_TRIS},
    "metaballCalibration": {"visibleRadiusOfUnitBall": round(K_META, 4), "ellipsoidSize(1,2,0.5)Extents": CAL_ELL},
    "tackClearance": TACK_CLEAR, "reinClearanceToBodyMeters": {"min": min(REIN_CLEAR), "samples": len(REIN_CLEAR)},
    "floorSolveProbe": {"liftRequested": 0.10, "feetRaised": round(LIFT_PROBE, 4)},
    "sha256": {"glb": GLB_SHA, "blend": BLEND_SHA},
    "glbChecks": checks, "glbStructureValid": all(checks.values()),
    "peakProcessMemoryMB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1),
    "authorSeconds": round(time.time() - T0, 1), "blender": bpy.app.version_string,
    "command": "blender -b -t 4 --factory-startup --python author_cragclaw.py",
}
for key in ("design", "traversalRole", "riderClipMap", "renders"):
    if key in prev:
        manifest[key] = prev[key]
if "renders" in manifest:
    manifest["renders"]["currentForGlb"] = False
with open(OUT_MANIFEST, "w") as f:
    json.dump(manifest, f, indent=1)
print("CRAGCLAW_DONE", json.dumps({"tris": eval_tris, "checks": checks, "seat": to_gltf(SEAT), "sha": GLB_SHA[:12], "peakMB": manifest["peakProcessMemoryMB"]}))
