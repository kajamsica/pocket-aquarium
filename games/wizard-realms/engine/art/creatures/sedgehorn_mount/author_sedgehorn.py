"""Adult sedgehorn mount for the V9 workbench and opt-in V44 game (after checked juvenile care and maturity; V43 juvenile unrideable).

A heavy marsh ungulate sized for the 2.31 m V9 Wayfarer: elk-like body on splayed marsh hooves, a long neck
and head, reed-segmented back-swept horns ("sedge horns"), a dorsal mane, saddle on a violet blanket with
gold trim, girth, stirrups, bridle and reins. Everything is procedural (metaball core converted to a mesh,
lofted parts, body-offset sampled tack), so the file is the editable source. No external assets.

Conventions (same as the V9 character): authored in Blender with +Y forward and Z up, exported +Y up and
-Z forward, hooves on Y=0. Rig: Root (unkeyed), Pelvis/Spine/Chest/Neck1/Neck2/Head, Tail1/Tail2 and four
legs with Upper/Lower/Cannon/Hoof, 25 joints. Clips Idle, Walk, Run are in place (no root translation; the
Pelvis bone carries only the vertical bob that keeps the lowest planted hoof on the floor).

Reference nodes exported for the workbench lane: Seat (saddle seat surface centre), Stirrup.L/R (tread
centres) and ReinHand.L/R (rein ends where the rider's hands rest). Their rest positions and the per-frame
seat motion of every clip are written to sedgehorn_manifest.json.

Run (one headless process):
    blender -b -t 4 --factory-startup --python author_sedgehorn.py
Outputs: sedgehorn_adult.blend, sedgehorn_adult.glb, sedgehorn_manifest.json
"""
import bpy, bmesh, json, math, os, time, resource, struct, hashlib
from mathutils import Vector, Euler, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_BLEND = os.path.join(HERE, "sedgehorn_adult.blend")
OUT_GLB = os.path.join(HERE, "sedgehorn_adult.glb")
OUT_MANIFEST = os.path.join(HERE, "sedgehorn_manifest.json")

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
def lerp(a, b, t):
    return a + (b - a) * t
def deg(x):
    return math.radians(x)
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
def V(*a):
    return Vector(a)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
sc = bpy.context.scene
sc.render.fps = 24
COLL = bpy.data.collections.new("SedgehornAdult")
sc.collection.children.link(COLL)

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
M_coat = mat_principled("SH_coat", (1.0, 1.0, 1.0), rough=0.9, sheen=0.12, bump=0.22, bump_scale=70, vcol=True)   # white x COLOR_0
M_mane = mat_principled("SH_mane", (0.09, 0.065, 0.03), rough=0.92, sheen=0.1, bump=0.3, bump_scale=50)
M_horn = mat_principled("SH_horn", (0.50, 0.47, 0.30), rough=0.42, bump=0.12, bump_scale=120)
M_hoof = mat_principled("SH_hoof", (0.12, 0.11, 0.10), rough=0.45, bump=0.08, bump_scale=120)
M_eye = mat_principled("SH_eye", (0.09, 0.05, 0.02), rough=0.12)
M_saddle = mat_principled("SH_saddle_leather", (0.30, 0.15, 0.07), rough=0.5, bump=0.1, bump_scale=60)
M_strap = mat_principled("SH_strap_leather", (0.15, 0.075, 0.035), rough=0.55, bump=0.1, bump_scale=60)
M_blanket = mat_principled("SH_blanket_violet", (0.17, 0.07, 0.46), rough=0.85, sheen=0.35, bump=0.18, bump_scale=90)
M_trim = mat_principled("SH_trim_gold", (0.80, 0.55, 0.16), rough=0.38, metallic=1.0)
M_iron = mat_principled("SH_iron", (0.45, 0.45, 0.47), rough=0.4, metallic=1.0)

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
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob); bpy.data.metaballs.remove(mb)
    return me

# calibration: visible radius of a unit metaball at the default stiffness/threshold
K_META = 1.0
cal = meta_mesh([('BALL', V(0, 0, 0), (1.0, 1.0, 1.0), None)], "cal", 0.02)
K_META = max(v.co.x for v in cal.vertices); bpy.data.meshes.remove(cal)
cal2 = meta_mesh([('ELLIPSOID', V(0, 0, 0), (1.0, 2.0, 0.5), None)], "cal2", 0.02)
CAL_ELL = [round(max(abs(v.co[i]) for v in cal2.vertices), 3) for i in range(3)]; bpy.data.meshes.remove(cal2)

# body elements: (type, centre, semi-axes (x lateral, y along, z), aim of the local Y axis)
ELEMENTS = []
def E(co, a, b, c, aim=None):
    ELEMENTS.append(('ELLIPSOID', V(*co), (a, b, c), V(*aim) if aim else None))
def S(co, r):
    ELEMENTS.append(('BALL', V(*co), (r, r, r), None))
E((0, 0.42, 1.47), 0.40, 0.55, 0.46)                       # chest
E((0, -0.15, 1.42), 0.43, 0.62, 0.45)                      # barrel
E((0, -0.72, 1.52), 0.37, 0.46, 0.41)                      # haunches
E((0, 0.62, 1.84), 0.19, 0.30, 0.20)                       # withers
E((0, -0.97, 1.63), 0.24, 0.22, 0.22)                      # croup
E((0, 0.72, 1.08), 0.26, 0.30, 0.22)                       # brisket / chest floor between the forelegs
NECK0, NECK1 = V(0, 0.86, 1.92), V(0, 1.52, 2.46)
for t in (0.0, 0.3, 0.6, 0.85):
    p = NECK0.lerp(NECK1, t); r = lerp(0.25, 0.17, t)
    E(p, r, 0.26, r * 1.15, aim=NECK1 - NECK0)
E((0, 1.68, 2.52), 0.16, 0.21, 0.17)                       # skull
E((0, 1.98, 2.40), 0.12, 0.22, 0.13, aim=(0, 0.92, -0.32)) # muzzle
S((0, 2.20, 2.30), 0.105)                                  # nose
E((0, 1.80, 2.37), 0.14, 0.17, 0.11)                       # jaw / cheeks
FRONT_JOINTS = [V(0.27, 0.72, 1.40), V(0.27, 0.70, 1.02), V(0.26, 0.68, 0.62), V(0.25, 0.66, 0.22)]
HIND_JOINTS = [V(0.27, -0.72, 1.46), V(0.28, -0.50, 1.02), V(0.27, -0.82, 0.62), V(0.25, -0.72, 0.22)]
FRONT_R = [0.17, 0.12, 0.085, 0.07]
HIND_R = [0.19, 0.13, 0.085, 0.07]
def leg_balls(joints, radii, sign):
    for j in range(len(joints) - 1):
        a, b = joints[j], joints[j + 1]
        steps = max(2, int((b - a).length / 0.09))
        for k in range(steps + (1 if j == len(joints) - 2 else 0)):
            t = k / steps
            p = a.lerp(b, t); r = lerp(radii[j], radii[j + 1], t)
            S((sign * p.x, p.y, p.z), r)
for sign in (-1, 1):
    leg_balls(FRONT_JOINTS, FRONT_R, sign)
    leg_balls(HIND_JOINTS, HIND_R, sign)
S((0, -1.06, 1.60), 0.09)                                  # tail dock (the tail itself is a lofted tube below)

core = meta_mesh(ELEMENTS, "SH_core", 0.045)
core_ob = bpy.data.objects.new("SH_core_raw", core); COLL.objects.link(core_ob)
m_smooth = core_ob.modifiers.new("Smooth", 'SMOOTH'); m_smooth.factor = 0.6; m_smooth.iterations = 4
raw_tris = sum(len(p.vertices) - 2 for p in core.polygons)
BODY_TARGET_TRIS = 15000
m_dec = core_ob.modifiers.new("Decimate", 'DECIMATE'); m_dec.ratio = min(1.0, BODY_TARGET_TRIS / max(1, raw_tris)); m_dec.use_collapse_triangulate = True
bpy.context.view_layer.update()
body_me = bpy.data.meshes.new_from_object(core_ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
bpy.data.objects.remove(core_ob); bpy.data.meshes.remove(core)
body_me.name = "SH_body"
for p in body_me.polygons:
    p.use_smooth = True
body_me.materials.append(M_coat)
body = bpy.data.objects.new("SH_body", body_me); COLL.objects.link(body)
# hooves at Y(glTF)=0: lift so the lowest core vertex (hoof balls end at z~0.15; separate hoof meshes reach the floor) stays above the hooves
bm = bmesh.new(); bm.from_mesh(body_me); BODY_BVH = BVHTree.FromBMesh(bm); bm.free()

def body_hit(origin, direction, max_dist=3.0):
    loc, nrm, idx, dist = BODY_BVH.ray_cast(Vector(origin), Vector(direction).normalized(), max_dist)
    return loc, nrm
def body_top(x, y):
    loc, _ = body_hit((x, y, 4.0), (0, 0, -1))
    return loc.z if loc else None

# coat colours baked to COLOR_0: olive marsh coat, pale belly and muzzle, dark dorsal stripe, dark lower legs and tail tuft
COAT, BELLY, DORSAL, SOCK, MUZZLE = (0.27, 0.235, 0.115), (0.46, 0.42, 0.27), (0.14, 0.115, 0.055), (0.15, 0.12, 0.07), (0.36, 0.30, 0.23)
def mix(c0, c1, t):
    return tuple(lerp(a, b, t) for a, b in zip(c0, c1))
col = body_me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
for v in body_me.vertices:
    co = v.co
    c = mix(COAT, BELLY, smooth(1.55, 0.95, co.z) * (1.0 if abs(co.x) < 0.45 else 0.4) * (1.0 if co.y < 1.0 else 0.4))
    c = mix(c, DORSAL, smooth(0.16, 0.03, abs(co.x)) * smooth(1.6, 1.85, co.z) * (1.0 if co.y < 0.9 else 0.0))
    c = mix(c, SOCK, smooth(0.75, 0.35, co.z) * (1.0 if abs(co.x) > 0.1 else 0.0))
    c = mix(c, MUZZLE, smooth(1.85, 2.05, co.y) * smooth(2.55, 2.30, co.z))
    col.data[v.index].color = (*c, 1.0)
body_me.color_attributes.active_color = col

# ------------------------------------------------------------------------ hooves (splayed, cloven)
def hoof(sign, fetlock, front):
    cx, cy = sign * fetlock.x, fetlock.y
    rings = []
    for z, ru, rv, fwd in ((0.25, 0.072, 0.072, 0.0), (0.14, 0.09, 0.10, 0.01), (0.05, 0.125, 0.15, 0.025), (0.0, 0.13, 0.155, 0.03)):
        ring = []
        for k in range(16):
            a = 2 * math.pi * k / 16
            p = V(cx + ru * math.cos(a), cy + fwd + rv * math.sin(a), z)
            if z < 0.1 and abs(a - math.pi / 2) < 0.25:           # cloven notch at the toe
                p.y -= 0.03 * (1 - abs(a - math.pi / 2) / 0.25)
            ring.append(p)
        rings.append(ring)
    return loft(rings, cap_start=True, cap_end=True)
HV, HF = [], []
for sign in (-1, 1):
    for joints in (FRONT_JOINTS, HIND_JOINTS):
        v, f = hoof(sign, joints[-1], joints is FRONT_JOINTS)
        base = len(HV); HV.extend(v); HF.extend(tuple(i + base for i in face) for face in f)
hooves = new_mesh_object("SH_hooves", HV, HF, [M_hoof])

# ------------------------------------------------------------------------ horns, ears, eyes
HORN_PTS = [V(0.07, 1.60, 2.62), V(0.15, 1.46, 2.78), V(0.22, 1.33, 2.95), V(0.245, 1.26, 3.10), V(0.235, 1.26, 3.24)]
TINE_PTS = [V(0.13, 1.50, 2.74), V(0.10, 1.60, 2.86), V(0.085, 1.66, 2.96)]
XV, XF = [], []
def add_part(v, f):
    base = len(XV); XV.extend(v); XF.extend(tuple(i + base for i in face) for face in f)
for sign in (-1, 1):
    pts = catmull([V(sign * p.x, p.y, p.z) for p in HORN_PTS], 5)
    n = len(pts)
    radii = [lerp(0.072, 0.014, i / (n - 1)) * (1 + 0.12 * math.sin(2 * math.pi * 7 * i / (n - 1))) for i in range(n)]
    add_part(*tube(pts, radii, n=10))
    tp = catmull([V(sign * p.x, p.y, p.z) for p in TINE_PTS], 4)
    add_part(*tube(tp, [lerp(0.03, 0.008, i / (len(tp) - 1)) for i in range(len(tp))], n=8))
horns = new_mesh_object("SH_horns", XV, XF, [M_horn])
XV, XF = [], []
for sign in (-1, 1):
    base_p = V(sign * 0.12, 1.60, 2.64); tip = base_p + V(sign * 0.13, -0.10, 0.20)
    pts = [base_p.lerp(tip, t) for t in (0.0, 0.35, 0.7, 1.0)]
    add_part(*tube(pts, None, n=10, ru_rv=[(0.055, 0.022), (0.06, 0.02), (0.04, 0.012), (0.008, 0.005)]))
ears = new_mesh_object("SH_ears", XV, XF, [M_mane])
XV, XF = [], []
for sign in (-1, 1):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=8, radius=0.036)
    bmesh.ops.translate(bm, verts=bm.verts, vec=V(sign * 0.112, 1.80, 2.52))
    bm.verts.ensure_lookup_table()
    add_part([v.co.copy() for v in bm.verts], [tuple(v.index for v in f.verts) for f in bm.faces]); bm.free()
eyes = new_mesh_object("SH_eyes", XV, XF, [M_eye])

# ------------------------------------------------------------------------ tail: tube with a dark tuft
TAIL_PTS = catmull([V(0, -1.04, 1.62), V(0, -1.14, 1.42), V(0, -1.18, 1.22), V(0, -1.18, 1.02), V(0, -1.15, 0.86)], 4)
nt_ = len(TAIL_PTS)
TAIL_R = [lerp(0.075, 0.045, min(1.0, i / (0.55 * (nt_ - 1)))) * (1.0 if i < 0.55 * (nt_ - 1) else 1.0 + 1.1 * math.sin(math.pi * (i - 0.55 * (nt_ - 1)) / (0.45 * (nt_ - 1)))) for i in range(nt_)]
tv, tf = tube(TAIL_PTS, TAIL_R, n=10)
tail_mat_idx = [0 if (f[0] // 10) < 0.55 * (nt_ - 1) else 1 for f in tf]
M_coat_tail = mat_principled("SH_coat_tail", COAT, rough=0.9, sheen=0.12, bump=0.22, bump_scale=70)
tail_ob = new_mesh_object("SH_tail", tv, tf, [M_coat_tail, M_mane], tail_mat_idx)

# ------------------------------------------------------------------------ mane: tented ridge along the neck top and withers
MANE_AXIS = [V(0, y, 2.4) for y in (0.55, 0.68, 0.80)] + [NECK0.lerp(NECK1, t) + V(0, 0, 0.6) for t in (0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.97)]
MV, MF = [], []
tops = []
for i, a in enumerate(MANE_AXIS):
    loc, nrm = body_hit(a, (0, 0, -1))
    if loc is None:
        continue
    tops.append((loc, nrm))
for i, (loc, nrm) in enumerate(tops):
    up = nrm.normalized()
    tangent = (tops[min(i + 1, len(tops) - 1)][0] - tops[max(i - 1, 0)][0]).normalized()
    side = tangent.cross(up).normalized()
    h = 0.14 + 0.04 * math.sin(i * 2.3) + 0.025 * (i % 2)
    base_l = loc + side * 0.065 - up * 0.015; base_r = loc - side * 0.065 - up * 0.015
    tip = loc + up * h - tangent * 0.08
    MV.extend([base_l, tip, base_r])
for i in range(len(tops) - 1):
    a = 3 * i
    MF.append((a, a + 1, a + 4, a + 3)); MF.append((a + 1, a + 2, a + 5, a + 4))
mane = new_mesh_object("SH_mane", MV, MF, [M_mane])

# ------------------------------------------------------------------------ tack: blanket, saddle, girth sampled off the body surface
SPINE_AXIS_Z = 1.40
def shell(name, ys, angles, offset, mats, trim_border=False, rise=None, thickness=0.012):
    verts = []; mat_idx = []
    for r, y in enumerate(ys):
        for c, a in enumerate(angles):
            d = V(math.sin(a), 0, math.cos(a))
            loc, nrm = body_hit((0, y, SPINE_AXIS_Z), d)
            if loc is None:
                loc = V(0, y, SPINE_AXIS_Z) + d * 0.5
            p = loc + d * offset
            if rise:
                p.z += rise(r, a)
            verts.append(p)
    faces = grid_faces(len(ys), len(angles), outward_test=V(0, 0, 1), verts=verts)
    if trim_border:
        for f in faces:
            r = f[0] // len(angles); c = f[0] % len(angles)
            mat_idx.append(1 if (r == 0 or r == len(ys) - 2 or c == 0 or c == len(angles) - 2) else 0)
    ob = new_mesh_object(name, verts, faces, mats, mat_idx if trim_border else None)
    sol = ob.modifiers.new("Solidify", 'SOLIDIFY'); sol.thickness = thickness; sol.offset = -1.0; sol.use_even_offset = True
    return ob, verts
def lin(a, b, n):
    return [lerp(a, b, i / (n - 1)) for i in range(n)]
blanket, _ = shell("SH_blanket", lin(-0.44, 0.42, 9), [deg(a) for a in lin(-95, 95, 17)], 0.012, [M_blanket, M_trim], trim_border=True, thickness=0.012)
SADDLE_YS = lin(-0.30, 0.34, 11); SADDLE_AS = [deg(a) for a in lin(-72, 72, 15)]
def saddle_rise(r, a):
    pommel = 0.075 * smooth(8.0, 10.0, r) * max(0.0, 1 - (a / deg(28)) ** 2)      # narrow low pommel
    cantle = 0.085 * smooth(2.5, 0.0, r) * max(0.0, 1 - (a / deg(62)) ** 2)       # broad cantle
    return pommel + cantle
saddle, saddle_verts = shell("SH_saddle", SADDLE_YS, SADDLE_AS, 0.05, [M_saddle], rise=saddle_rise, thickness=0.035)
SEAT_ROW = 5; SEAT_COL = 7
SEAT = saddle_verts[SEAT_ROW * len(SADDLE_AS) + SEAT_COL].copy()         # top surface of the seat, centre line
girth, _ = shell("SH_girth", lin(0.04, 0.12, 2), [deg(a) for a in lin(-180, 180, 37)], 0.024, [M_strap], thickness=0.01)

# stirrups: straps from the flap edge straight down, irons in the XZ plane (foot passes along Y)
STIRRUP_DROP = 0.455         # tread below the seat: the V9 rider's hip-to-heel drop with the knee at about 100 degrees (author_v9_game.py rideClips)
STIRRUP_OUT = 0.12           # tread centre outboard of the flap edge: the boot hangs beside the barrel's widest line (half-width 0.46 m)
flap_l = saddle_verts[6 * len(SADDLE_AS) + 0]; flap_r = saddle_verts[6 * len(SADDLE_AS) + len(SADDLE_AS) - 1]
STIRRUPS = {}
XV, XF = [], []
for sign, flap in ((-1, flap_l), (1, flap_r)):
    x = flap.x + sign * STIRRUP_OUT; y = flap.y
    z_top = flap.z + 0.02; z_c = SEAT.z - STIRRUP_DROP
    w, t = 0.05, 0.012
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=V(t, w, z_top - z_c))
    bmesh.ops.translate(bm, verts=bm.verts, vec=V(x, y, (z_top + z_c) / 2))
    bm.verts.ensure_lookup_table()
    add_part([v.co.copy() for v in bm.verts], [tuple(v.index for v in f.verts) for f in bm.faces]); bm.free()
    ring = catmull([V(x, y, z_c + 0.085 * math.cos(a)) + V(0.085 * math.sin(a) * 0.95, 0, 0) for a in lin(0, 2 * math.pi, 25)], 1)
    add_part(*tube(ring, [0.011] * len(ring), n=8, caps=(False, False)))
    tread_c = V(x, y, z_c - 0.085)
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, verts=bm.verts, vec=V(0.09, 0.06, 0.014))
    bmesh.ops.translate(bm, verts=bm.verts, vec=tread_c + V(0, 0, 0.007)); bm.verts.ensure_lookup_table()
    add_part([v.co.copy() for v in bm.verts], [tuple(v.index for v in f.verts) for f in bm.faces]); bm.free()
    STIRRUPS["R" if sign > 0 else "L"] = tread_c + V(0, 0, 0.014)     # tread top where the sole rests
stirrups = new_mesh_object("SH_stirrups", XV, XF, [M_iron])

# ------------------------------------------------------------------------ bridle and reins
def ring_around(center, axis, offset, n=20):
    axis = Vector(axis).normalized()
    u = axis.cross(V(0, 0, 1)); u = u.cross(axis).normalized() if u.length > 1e-3 else V(1, 0, 0)
    w = axis.cross(u)
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        d = u * math.cos(a) + w * math.sin(a)
        loc, nrm = body_hit(center, d, 1.0)
        pts.append((loc + d * offset) if loc else center + d * 0.2)
    pts.append(pts[0])
    return pts
XV, XF = [], []
HEAD_AXIS = V(0, 0.76, -0.22)
headstall = ring_around(V(0, 1.60, 2.52), HEAD_AXIS, 0.008)
noseband = ring_around(V(0, 1.98, 2.41), V(0, 0.92, -0.32), 0.008)
add_part(*tube(headstall, [0.012] * len(headstall), n=8, caps=(False, False)))
add_part(*tube(noseband, [0.012] * len(noseband), n=8, caps=(False, False)))
BIT = {}
for sign in (-1, 1):
    hs = min(headstall, key=lambda p: (p.x * sign < 0) * 9 + abs(p.z - 2.45))
    nb = min(noseband, key=lambda p: (p.x * sign < 0) * 9 + abs(p.z - 2.38))
    add_part(*tube([hs, hs.lerp(nb, 0.5) + V(sign * 0.01, 0, 0), nb], [0.011] * 3, n=8))
    bit_c = V(sign * 0.125, 2.03, 2.33); BIT["R" if sign > 0 else "L"] = bit_c
    ring = [bit_c + V(0, 0.03 * math.cos(a), 0.03 * math.sin(a)) for a in lin(0, 2 * math.pi, 17)]
    add_part(*tube(ring, [0.007] * len(ring), n=6, caps=(False, False)))
bridle = new_mesh_object("SH_bridle", XV, XF, [M_strap])

# rein ends sit where the seated V9 rider's open hands rest: elbows bent about 50 degrees, hands just ahead of the pommel
REIN_HAND = {"L": V(-0.17, SEAT.y + 0.22, SEAT.z + 0.32), "R": V(0.17, SEAT.y + 0.22, SEAT.z + 0.32)}
REIN_R = 0.012
XV, XF = [], []
REIN_CLEAR = []
for side, sign in (("L", -1), ("R", 1)):
    ctrl = [BIT[side], V(sign * 0.20, 1.80, 2.27), V(sign * 0.27, 1.45, 2.16), V(sign * 0.27, 1.10, 2.10), V(sign * 0.23, 0.72, 2.07), REIN_HAND[side]]
    pts = catmull(ctrl, 6)
    fixed = []
    for p in pts:
        loc, nrm, idx, dist = BODY_BVH.find_nearest(p)
        inside = nrm.dot(p - loc) < 0
        if inside or dist < REIN_R + 0.012:
            p = loc + nrm * (REIN_R + 0.012)
        fixed.append(p)
    for p in fixed:
        loc, nrm, idx, dist = BODY_BVH.find_nearest(p)
        REIN_CLEAR.append(round((dist if nrm.dot(p - loc) > 0 else -dist) - REIN_R, 4))
    add_part(*tube(fixed, [REIN_R] * len(fixed), n=8))
reins = new_mesh_object("SH_reins", XV, XF, [M_strap])

# body must not poke through the saddle/blanket: both are offset shells, verified below in the manifest

# ------------------------------------------------------------------------ rig
BONE_SPECS = [
    ("Root", None, (0, 0, 0), (0, 0.25, 0)),
    ("Pelvis", "Root", (0, -0.82, 1.68), (0, -0.35, 1.72)),
    ("Spine", "Pelvis", (0, -0.35, 1.72), (0, 0.25, 1.76)),
    ("Chest", "Spine", (0, 0.25, 1.76), (0, 0.80, 1.90)),
    ("Neck1", "Chest", (0, 0.80, 1.90), (0, 1.16, 2.18)),
    ("Neck2", "Neck1", (0, 1.16, 2.18), (0, 1.52, 2.46)),
    ("Head", "Neck2", (0, 1.52, 2.46), (0, 2.24, 2.30)),
    ("Tail1", "Pelvis", (0, -1.04, 1.62), (0, -1.17, 1.26)),
    ("Tail2", "Tail1", (0, -1.17, 1.26), (0, -1.16, 0.86)),
]
for sign, side in ((-1, "L"), (1, "R")):
    fj = [V(sign * p.x, p.y, p.z) for p in FRONT_JOINTS] + [V(sign * 0.25, 0.82, 0.0)]
    hj = [V(sign * p.x, p.y, p.z) for p in HIND_JOINTS] + [V(sign * 0.25, -0.56, 0.0)]
    for prefix, joints, parent in (("Front", fj, "Chest"), ("Hind", hj, "Pelvis")):
        names = ["Upper", "Lower", "Cannon", "Hoof"]
        for i, nm in enumerate(names):
            BONE_SPECS.append((f"{prefix}{nm}.{side}", parent if i == 0 else f"{prefix}{names[i - 1]}.{side}", tuple(joints[i]), tuple(joints[i + 1])))
BONE_SEG = {n: (Vector(h), Vector(t)) for n, _, h, t in BONE_SPECS}
FALLOFF = {"Root": 0.01, "Pelvis": (0.42, 0.40, 0.36), "Spine": (0.46, 0.42, 0.40), "Chest": (0.42, 0.42, 0.40), "Neck1": 0.26, "Neck2": 0.23, "Head": 0.30,
           "Tail1": 0.11, "Tail2": 0.11, "FrontUpper": 0.19, "FrontLower": 0.13, "FrontCannon": 0.10, "FrontHoof": 0.13,
           "HindUpper": 0.21, "HindLower": 0.14, "HindCannon": 0.10, "HindHoof": 0.13}
arm_data = bpy.data.armatures.new("SedgehornAdultArmature")
RIG = bpy.data.objects.new("SedgehornRig", arm_data); COLL.objects.link(RIG)
bpy.context.view_layer.objects.active = RIG; RIG.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, parent, head, tail in BONE_SPECS:
    b = arm_data.edit_bones.new(name); b.head, b.tail = head, tail
    if parent:
        b.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT'); RIG.select_set(False)
for pb in RIG.pose.bones:
    pb.rotation_mode = 'XYZ'

def bone_weight(co, name):
    h, t = BONE_SEG[name]; r = FALLOFF[name.split(".")[0]]
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
    prefix = "Front" if co.y > 0 else "Hind"; s = side_of(co)
    return [f"{prefix}{n}.{s}" for n in ("Upper", "Lower", "Cannon", "Hoof")]
TORSO = ["Pelvis", "Spine", "Chest"]
def body_allowed(co):
    if co.y > 0.88 and co.z > 1.80:
        return ["Chest", "Neck1", "Neck2", "Head"]
    if co.y < -1.0 and co.z < 1.72:
        return ["Pelvis", "Tail1", "Tail2"]
    if co.z < 1.30 and abs(co.x) > 0.10:
        return leg_bones(co) + (["Chest"] if co.y > 0 else ["Pelvis"])
    uppers = [f"{p}Upper.{s}" for p in ("Front", "Hind") for s in ("L", "R")]
    return TORSO + uppers + ["Neck1"]
skin(body, body_allowed)
skin(hooves, lambda co: leg_bones(co)[2:])
for ob in (horns, ears, eyes, bridle):
    skin(ob, ["Head"])
skin(mane, ["Chest", "Neck1", "Neck2", "Head"])
skin(tail_ob, ["Pelvis", "Tail1", "Tail2"])
for ob in (saddle, blanket, girth, stirrups):
    skin(ob, ["Spine"])
skin(reins, ["Head", "Neck2", "Neck1", "Chest", "Spine"])

# reference nodes (exported as empties): seat surface, stirrup treads, rein ends
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

# ------------------------------------------------------------------------ clips: Idle, Walk, Run (in place)
ANIM_BONES = [n for n, _, _, _ in BONE_SPECS if n != "Root"]
def hooves_lowest_z(pose, pelvis_loc):
    for name in ANIM_BONES:
        RIG.pose.bones[name].rotation_euler = pose.get(name, (0, 0, 0))
    RIG.pose.bones["Pelvis"].location = pelvis_loc
    RIG.update_tag(); bpy.context.view_layer.update()
    ev = hooves.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
    zs = {}
    for v in m.vertices:
        key = ("Front" if v.co.y > 0 else "Hind") + "." + side_of(v.co)
        zs[key] = min(zs.get(key, 9.0), v.co.z)
    ev.to_mesh_clear()
    return zs
# probe the Pelvis location axis that is world-up (bone-local), so the floor solve lifts along it
RIG.pose.bones["Pelvis"].location = (0, 0, 0)
_base = hooves_lowest_z({}, (0, 0, 0))
_probe = {ax: hooves_lowest_z({}, tuple(0.1 if i == ax else 0.0 for i in range(3))) for ax in range(3)}
UP_AXIS = max(range(3), key=lambda ax: sum(_probe[ax][k] - _base[k] for k in _base))
UP_SIGN = 1.0 if sum(_probe[UP_AXIS][k] - _base[k] for k in _base) > 0 else -1.0
def pelvis_loc(up):
    return tuple(UP_SIGN * up if i == UP_AXIS else 0.0 for i in range(3))
def floored(raw_fn):
    cache = {}
    def fn(phase):
        if phase not in cache:
            pose, g, extra = raw_fn(phase)
            zs = hooves_lowest_z(pose, pelvis_loc(0.0))
            lift = -min(zs.values()) * g + extra
            cache[phase] = (pose, pelvis_loc(lift), zs, lift)
        return cache[phase][:2]
    fn.cache = cache
    return fn

def leg_cycle(ph, swing, amp, lift, front):
    """Returns (upper, lower, cannon, hoof) local X rotations: + swings the bone tail forward."""
    ph %= 1.0
    if ph < swing:
        q = ph / swing; bell = math.sin(math.pi * q)
        upper = -amp + 2 * amp * smooth(0.0, 1.0, q)
        # fore: elbow flexes the forearm forward, carpus folds the cannon back; hind: stifle folds the tibia back, hock folds the cannon forward
        if front:
            lower, cannon = 0.30 * lift * bell, -0.85 * lift * bell
        else:
            lower, cannon = -0.45 * lift * bell, 0.80 * lift * bell
        hoof = -(upper + lower + cannon) * (1 - bell) - 0.35 * bell
    else:
        q = (ph - swing) / (1 - swing)
        upper = amp - 2 * amp * q
        flex = 0.22 * (1 - (2 * q - 1) ** 2)                       # mid-stance shortening so the hoof stays near the floor through the arc
        lower, cannon = (0.6 * flex, -0.6 * flex) if front else (-0.6 * flex, 0.6 * flex)
        hoof = -(upper + lower + cannon)
    return upper, lower, cannon, hoof
def legs_pose(phases, swing, amp, lift):
    pose = {}
    for key, ph in phases.items():
        prefix, side = key.split(".")
        u, l, c, h = leg_cycle(ph, swing, amp, lift, prefix == "Front")
        pose[f"{prefix}Upper.{side}"] = (u, 0, 0); pose[f"{prefix}Lower.{side}"] = (l, 0, 0)
        pose[f"{prefix}Cannon.{side}"] = (c, 0, 0); pose[f"{prefix}Hoof.{side}"] = (h, 0, 0)
    return pose

IDLE_F, WALK_F, RUN_F = 72, 32, 20
def idle_raw(phase):
    ph = 2 * math.pi * phase
    breath = math.sin(ph * 2)
    pose = {"Chest": (0.012 * breath, 0, 0), "Spine": (-0.006 * breath, 0, 0.012 * math.sin(ph)),
            "Neck1": (0.03 * math.sin(ph + 0.6), 0.04 * math.sin(ph + 1.0), 0),
            "Neck2": (0.03 * math.sin(ph + 0.9), 0.05 * math.sin(ph + 1.0), 0),
            "Head": (-0.05 * math.sin(ph + 1.2), 0.06 * math.sin(ph + 1.3), 0),
            "Tail1": (0.05 * math.sin(ph * 2 + 0.3), 0, 0.30 * math.sin(ph * 2)), "Tail2": (0, 0, 0.35 * math.sin(ph * 2 - 0.9)),
            "Pelvis": (0, 0, 0.012 * math.sin(ph))}
    return pose, 1.0, 0.0
def walk_raw(phase):
    # four-beat lateral walk: LH, LF, RH, RF each a quarter cycle apart; head nods with the forehand, tail swings
    ph = 2 * math.pi * phase
    pose = legs_pose({"Hind.L": phase, "Front.L": phase - 0.25, "Hind.R": phase - 0.5, "Front.R": phase - 0.75}, 0.38, 0.30, 1.0)
    pose.update({"Pelvis": (0.015 * math.sin(2 * ph), 0.03 * math.sin(ph), 0.04 * math.sin(ph)),
                 "Spine": (-0.01 * math.sin(2 * ph), -0.02 * math.sin(ph), -0.02 * math.sin(ph)),
                 "Chest": (0.012 * math.sin(2 * ph + 1.0), -0.02 * math.sin(ph), 0),
                 "Neck1": (0.035 * math.sin(2 * ph + 1.6), 0, 0), "Neck2": (0.03 * math.sin(2 * ph + 1.6), 0, 0),
                 "Head": (-0.06 * math.sin(2 * ph + 1.6), 0, 0),
                 "Tail1": (0.04, 0, 0.22 * math.sin(ph)), "Tail2": (0.0, 0, 0.25 * math.sin(ph - 0.8))})
    return pose, 1.0, 0.0
def run_raw(phase):
    # bounding canter: hind pair lands first, forehand reaches, body pitches and rises through the gathered phase
    ph = 2 * math.pi * phase
    pose = legs_pose({"Hind.L": phase, "Hind.R": phase - 0.08, "Front.L": phase - 0.5, "Front.R": phase - 0.58}, 0.52, 0.48, 1.25)
    pitch = 0.09 * math.sin(ph + 0.4)
    pose.update({"Pelvis": (pitch, 0, 0), "Spine": (0.5 * pitch, 0, 0), "Chest": (-0.2 * pitch, 0, 0),
                 "Neck1": (-0.9 * pitch, 0, 0), "Neck2": (-0.6 * pitch, 0, 0), "Head": (0.9 * pitch, 0, 0),
                 "Tail1": (0.35 + 0.1 * math.sin(ph), 0, 0.05 * math.sin(ph)), "Tail2": (0.25, 0, 0)})
    airborne = max(0.0, math.sin(ph - 2.2))
    return pose, 1.0 - 0.8 * airborne ** 2, 0.10 * airborne ** 2
idle_pose, walk_pose, run_pose = floored(idle_raw), floored(walk_raw), floored(run_raw)
CLIPS = [("Idle", IDLE_F, idle_pose, True, 3), ("Walk", WALK_F, walk_pose, True, 2), ("Run", RUN_F, run_pose, True, 1)]
for clip_name, frames, pose_fn, loop, step in CLIPS:
    for f in range(1, frames + 2):
        pose_fn((f - 1) / frames)
for pb in RIG.pose.bones:
    pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
RIG.update_tag(); bpy.context.view_layer.update()
RIG.animation_data_create()
for clip_name, frames, pose_fn, loop, step in CLIPS:
    action = bpy.data.actions.new(clip_name)
    RIG.animation_data.action = action
    for f in range(1, frames + 2, step):
        pose, loc = pose_fn((f - 1) / frames)
        for name in ANIM_BONES:
            pb = RIG.pose.bones[name]
            pb.rotation_euler = pose.get(name, (0, 0, 0))
            pb.keyframe_insert(data_path="rotation_euler", frame=f, group=name)
        RIG.pose.bones["Pelvis"].location = loc
        RIG.pose.bones["Pelvis"].keyframe_insert(data_path="location", frame=f, group="Pelvis")
    track = RIG.animation_data.nla_tracks.new(); track.name = clip_name
    strip = track.strips.new(clip_name, 1, action)
    if hasattr(strip, "action_slot") and len(action.slots):
        strip.action_slot = action.slots[0]
    track.mute = True
RIG.animation_data.action = None
for pb in RIG.pose.bones:
    pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)

# ------------------------------------------------------------------------ camera rig + lights (saved, not exported)
PIVOT = V(0, 0.45, 1.65)
rig = bpy.data.objects.new("SH_RIG", None); COLL.objects.link(rig); rig.location = PIVOT
cam_data = bpy.data.cameras.new("SH_CAM"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 4.6; cam_data.clip_start = 0.05; cam_data.clip_end = 60.0
cam = bpy.data.objects.new("SH_CAM", cam_data); COLL.objects.link(cam); cam.parent = rig
cam.location = (0.0, 12.0, 0.0); cam.rotation_euler = Euler((deg(90), 0, deg(180)), 'XYZ')
def light(name, loc, energy, size, color, aim):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy = energy; ld.size = size; ld.color = color
    ob = bpy.data.objects.new(name, ld); COLL.objects.link(ob); ob.parent = rig; ob.location = loc
    ob.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob
LIGHTS = [light("SH_KEY", (-5.0, 6.5, 4.5), 1000, 4.0, (1.0, 0.96, 0.9), (0, 0, 0)),
          light("SH_FILL", (6.5, 5.5, 1.0), 320, 7.0, (0.9, 0.94, 1.0), (0, 0, 0)),
          light("SH_RIM", (2.5, -5.5, 4.0), 650, 3.0, (1.0, 1.0, 1.0), (0, 0, 0))]
w = bpy.data.worlds.new("SH_WORLD"); sc.world = w; w.use_nodes = True
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
dg = bpy.context.evaluated_depsgraph_get()
per_object = {}; eval_tris = 0; draw_groups = 0
for ob in MESHES:
    ev = ob.evaluated_get(dg); m = ev.to_mesh(); m.calc_loop_triangles()
    n = len(m.loop_triangles); used = {p.material_index for p in m.polygons}
    per_object[ob.name] = {"triangles": n, "vertices": len(m.vertices), "materials": [ob.data.materials[i].name for i in sorted(used) if i < len(ob.data.materials)]}
    eval_tris += n; draw_groups += max(1, len(used)); ev.to_mesh_clear()

def rest_pose():
    RIG.animation_data.action = None
    for t in RIG.animation_data.nla_tracks:
        t.mute = True
    for pb in RIG.pose.bones:
        pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
    RIG.update_tag(); bpy.context.view_layer.update(); sc.frame_set(1); bpy.context.view_layer.update()
rest_pose()
def apply_pose(pose, loc):
    for name in ANIM_BONES:
        RIG.pose.bones[name].rotation_euler = pose.get(name, (0, 0, 0))
    RIG.pose.bones["Pelvis"].location = loc
    RIG.update_tag(); bpy.context.view_layer.update()
def to_gltf(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]
CLIP_EVIDENCE = {}
for clip_name, frames, pose_fn, loop, step in CLIPS:
    hoof_z = {k: [] for k in ("Front.L", "Front.R", "Hind.L", "Hind.R")}
    seat_track = []; lifts = []
    for f in range(1, frames + 1):
        pose, loc = pose_fn((f - 1) / frames)
        apply_pose(pose, loc)
        zs = pose_fn.cache[(f - 1) / frames][2]
        for k in hoof_z:
            hoof_z[k].append(round(zs[k] + pose_fn.cache[(f - 1) / frames][3], 3))
        seat_track.append(to_gltf(REFS["Seat"].matrix_world.translation))
        lifts.append(round(pose_fn.cache[(f - 1) / frames][3], 4))
    p0, l0 = pose_fn(0.0); p1, l1 = pose_fn(1.0)
    CLIP_EVIDENCE[clip_name] = {
        "frames": frames, "fps": 24, "keyStepFrames": step, "loops": loop, "inPlace": True,
        "loopClosure": {"poseAtPhase0EqualsPhase1": set(p0) == set(p1) and all(max(abs(a - b) for a, b in zip(p0[k], p1[k])) < 1e-9 for k in p0)
                        and max(abs(a - b) for a, b in zip(l0, l1)) < 1e-9},
        "hoofLowestPointPerFrameMeters": hoof_z,
        "lowestHoofMinZ": round(min(min(v) for v in hoof_z.values()), 4),
        "swingHoofPeakZ": round(max(max(v) for v in hoof_z.values()), 4),
        "pelvisVerticalOffsetMeters": {"min": min(lifts), "max": max(lifts)},
        "seatPositionPerFrameGlb": seat_track,
        "seatRestGlb": to_gltf(SEAT),
        "seatDeltaPerFrameGlb": [[round(a - b, 4) for a, b in zip(s, to_gltf(SEAT))] for s in seat_track],
    }
rest_pose()

# rest-pose contact/intersection evidence: saddle and blanket shells must sit outside the body, reins clear the neck/body
def shell_clearance(ob):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
    inside = 0; dmin = 9.0
    for v in m.vertices:
        loc, nrm, idx, dist = BODY_BVH.find_nearest(v.co)
        if nrm.dot(v.co - loc) < 0:
            inside += 1
        dmin = min(dmin, dist if nrm.dot(v.co - loc) > 0 else -dist)
    ev.to_mesh_clear()
    return {"verticesInsideBody": inside, "minSignedDistanceMeters": round(dmin, 4)}
TACK_CLEAR = {ob.name: shell_clearance(ob) for ob in (saddle, blanket, stirrups, reins, horns, bridle)}

# ------------------------------------------------------------------------ GLB structure validation (minimal parser)
def parse_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2
    off = 12; gltf = None; bin_chunk = None
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off); off += 8
        chunk = data[off:off + clen]; off += clen
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            bin_chunk = chunk
    return gltf, bin_chunk
gltf, bin_chunk = parse_glb(OUT_GLB)
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
             for i, n in enumerate(nodes) if n.get("extras", {}).get("role", "").startswith("rider_")}
skins = gltf.get("skins", [])
joint_names = [nodes[j]["name"] for j in skins[0]["joints"]] if skins else []
animations = {}
for a in gltf.get("animations", []):
    dur = max((acc[s["input"]]["max"][0] for s in a.get("samplers", [])), default=0.0)
    animations[a["name"]] = {"channels": len(a.get("channels", [])), "durationSeconds": round(dur, 3)}
eyes_mesh = next((m for m in gltf["meshes"] if m["name"] == "SH_eyes"), None)
checks = {
    "clipsIdleWalkRun": set(animations) == {"Idle", "Walk", "Run"} and all(v["durationSeconds"] > 0 for v in animations.values()),
    "runShorterThanWalk": animations["Run"]["durationSeconds"] < animations["Walk"]["durationSeconds"],
    "oneSkinWith25Joints": len(skins) == 1 and len(joint_names) == 25 and set(joint_names) == {n for n, _, _, _ in BONE_SPECS},
    "hoovesOnFloor": abs(pos_min[1]) < 0.005,
    "forwardIsNegativeZ": bool(eyes_mesh) and all(acc[p["attributes"]["POSITION"]]["max"][2] < -1.5 for p in eyes_mesh["primitives"]),
    "riderReferenceNodes": set(ref_nodes) == {"Seat", "Stirrup.L", "Stirrup.R", "ReinHand.L", "ReinHand.R"},
    "noCameras": "cameras" not in gltf, "noLights": "KHR_lights_punctual" not in gltf.get("extensionsUsed", []),
    "clipsLoopClosed": all(v["loopClosure"]["poseAtPhase0EqualsPhase1"] for v in CLIP_EVIDENCE.values()),
    "plantedHoovesOnFloor": all(v["lowestHoofMinZ"] > -0.005 for v in CLIP_EVIDENCE.values()),
    "tackOutsideBody": all(v["verticesInsideBody"] == 0 for k, v in TACK_CLEAR.items() if k in ("SH_saddle", "SH_blanket", "SH_reins")),
    "reinsClearOfBody": min(REIN_CLEAR) >= 0.0,
    "bodyUnderTriangleBudget": eval_tris <= 40000,
}
manifest = {
    "asset": "sedgehorn_adult.glb", "status": "playable adult ground mount in opt-in V44 after checked juvenile care and maturity; the V43 juvenile remains unrideable",
    "species": "adult sedgehorn (mature ground mount); the V43 juvenile companion is a different, unrideable creature",
    "sourceAxes": "Blender: +Y forward, Z up, metres", "glbAxes": "+Y up, -Z forward (export_yup)",
    "boundsMetersGlb": {"min": [round(c, 3) for c in pos_min], "max": [round(c, 3) for c in pos_max]},
    "heightToHornTipMeters": round(pos_max[1], 3), "lengthMeters": round(pos_max[2] - pos_min[2], 3),
    "seat": {
        "node": "Seat", "role": "rider_seat", "surface": "top surface of the saddle seat on the centre line, rest pose",
        "glbPosition": to_gltf(SEAT),
        "riderRootHint": "place the rider's root (its floor origin) at Seat minus the rider's seated pelvis-bottom height; the V9 manifest rideClips block gives the exact RIDER_SEAT_OFFSET",
        "stirrupTreadGlb": {k: to_gltf(v) for k, v in STIRRUPS.items()}, "stirrupDropBelowSeatMeters": STIRRUP_DROP,
        "reinHandGlb": {k: to_gltf(v) for k, v in REIN_HAND.items()},
        "saddleTopSurfaceOffsetFromBodyMeters": 0.05, "saddleShellThicknessMeters": 0.035, "blanketThicknessMeters": 0.012,
    },
    "referenceNodes": ref_nodes,
    "deformBones": joint_names, "animationClips": animations, "clipEvidence": CLIP_EVIDENCE,
    "seatMotionContract": "clipEvidence.<clip>.seatDeltaPerFrameGlb is the saddle's displacement from rest per frame (glTF axes); the rider's Ride* clips key the same deltas on the rider Hips so the rider stays seated",
    "meshObjects": [ob.name for ob in MESHES], "perObject": per_object,
    "trianglesEvaluated": eval_tris, "drawGroups": draw_groups, "materialCount": len(bpy.data.materials), "glbBytes": os.path.getsize(OUT_GLB),
    "budget": {"targetTriangles": 40000, "trianglesMet": eval_tris <= 40000, "bodyCoreRawTriangles": raw_tris, "bodyCoreTargetTriangles": BODY_TARGET_TRIS},
    "metaballCalibration": {"visibleRadiusOfUnitBall": round(K_META, 4), "ellipsoidSize(1,2,0.5)Extents": CAL_ELL},
    "tackClearance": TACK_CLEAR, "reinClearanceToBodyMeters": {"min": min(REIN_CLEAR), "samples": len(REIN_CLEAR)},
    "sha256": {"glb": GLB_SHA, "blend": BLEND_SHA},
    "glbChecks": checks, "glbStructureValid": all(checks.values()),
    "peakProcessMemoryMB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1),
    "authorSeconds": round(time.time() - T0, 1), "blender": bpy.app.version_string,
    "command": "blender -b -t 4 --factory-startup --python author_sedgehorn.py",
}
prev = json.load(open(OUT_MANIFEST)) if os.path.exists(OUT_MANIFEST) else {}
for key in ("renders",):
    if key in prev:
        manifest[key] = prev[key]; manifest[key]["currentForGlb"] = False
with open(OUT_MANIFEST, "w") as f:
    json.dump(manifest, f, indent=1)
print("SEDGEHORN_DONE", json.dumps({"tris": eval_tris, "checks": checks, "seat": to_gltf(SEAT), "sha": GLB_SHA[:12], "peakMB": manifest["peakProcessMemoryMB"]}))
