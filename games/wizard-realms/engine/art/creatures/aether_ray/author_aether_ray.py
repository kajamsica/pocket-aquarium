"""Aether ray: wide gliding manta-like flying mount for the Wizard Realms mount pack (asset staging only).

Silhouette: a 6.0 m wingspan disc with a 3.2 m central chord, thin tapering wing membrane, two forward-curling cephalic
lobes framing a wide mouth slit, side-set eyes, five pairs of gill slits underneath, a small dorsal fin and a long whip
tail ending in a diamond fin (4.6 m behind the head). Aether-cyan glow spots along the wings are separate emissive meshes
so the glow exports to glTF. Riding gear: a padded dorsal deck behind the head with a raised bolster seat, stirrup loops
on the deck and a curved iron grip rail instead of reins (its hand points are exported as ReinHand so the rider arm
solve is unchanged). No legs at all: this is not a winged quadruped. The body is a lofted closed surface of spanwise
rings (chord, sweep and thickness profiles) under a Subdivision Surface, not metaballs.

Conventions follow ../sedgehorn_mount/author_sedgehorn.py and ../MOUNT_PACK_DESIGN_BRIEF.md: Blender +Y forward,
Z up, landed belly on Z=0.02; exported +Y up, -Z forward. Rig: Root (unkeyed), Body (keyed hover bob), Head, Lobe.L/R,
WingA/B/C.L/R, Tail1-4, Fin = 16 joints. Clips Idle (landed), Glide, Soar are in place; flight clips record how far the
wing tips dip below the origin plane so the runtime keeps altitude.

Run on the render machine only (one headless process):
    blender -b -t 4 --factory-startup --python author_aether_ray.py
Outputs: aether_ray.blend, aether_ray.glb, aether_ray_manifest.json (design blocks are preserved)
"""
import bpy, bmesh, json, math, os, time, resource, struct, hashlib
from mathutils import Vector, Euler, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_BLEND = os.path.join(HERE, "aether_ray.blend")
OUT_GLB = os.path.join(HERE, "aether_ray.glb")
OUT_MANIFEST = os.path.join(HERE, "aether_ray_manifest.json")
PFX = "AR_"
TRI_BUDGET = 40000

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
COLL = bpy.data.collections.new("AetherRay")
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
    if emission is not None:
        key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
        bsdf.inputs[key].default_value = (*emission, 1.0)
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
DORSAL, VENTRAL, DARK = (0.14, 0.10, 0.36), (0.80, 0.78, 0.90), (0.10, 0.08, 0.20)
GLOW = (0.35, 0.85, 1.0)
M_skin = mat_principled(PFX + "skin", (1.0, 1.0, 1.0), rough=0.35, sheen=0.4, bump=0.06, bump_scale=20, vcol=True)   # white x COLOR_0
M_lobe = mat_principled(PFX + "lobe", DORSAL, rough=0.35, sheen=0.4, bump=0.06, bump_scale=30)
M_dark = mat_principled(PFX + "slit_dark", DARK, rough=0.5)
M_fin = mat_principled(PFX + "fin", (0.22, 0.16, 0.48), rough=0.3, sheen=0.5)
M_eye = mat_principled(PFX + "eye", (0.92, 0.95, 1.0), rough=0.08)
M_pupil = mat_principled(PFX + "pupil", (0.02, 0.02, 0.05), rough=0.08)
M_glow = mat_principled(PFX + "aether_glow", GLOW, rough=0.3, emission=GLOW, emission_strength=4.0)
M_deck = mat_principled(PFX + "deck_violet", (0.17, 0.07, 0.46), rough=0.85, sheen=0.35, bump=0.18, bump_scale=90)
M_trim = mat_principled(PFX + "trim_gold", (0.80, 0.55, 0.16), rough=0.38, metallic=1.0)
M_seat = mat_principled(PFX + "seat_leather", (0.30, 0.15, 0.07), rough=0.5, bump=0.1, bump_scale=60)
M_strap = mat_principled(PFX + "strap_leather", (0.15, 0.075, 0.035), rough=0.55, bump=0.1, bump_scale=60)
M_iron = mat_principled(PFX + "iron", (0.45, 0.45, 0.47), rough=0.4, metallic=1.0)

def new_mesh_object(name, verts, faces, mats, mat_idx=None, recalc=False):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    if recalc:
        bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free(); me.update()
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
class Parts:
    def __init__(self):
        self.v = []; self.f = []
    def add(self, v, f):
        base = len(self.v); self.v.extend(v); self.f.extend(tuple(i + base for i in face) for face in f)
def bvh_of(objects):
    bpy.context.view_layer.update(); d = dg()
    bm = bmesh.new()
    for ob in objects:
        ev = ob.evaluated_get(d); me = ev.to_mesh(); bm.from_mesh(me); ev.to_mesh_clear()
    tree = BVHTree.FromBMesh(bm); bm.free()
    return tree
def outer_hit(bvh, origin, direction, reach=6.0):
    d = Vector(direction).normalized()
    loc, nrm, idx, dist = bvh.ray_cast(Vector(origin) + d * reach, -d, reach * 2)
    return loc, nrm
def top_hit(bvh, x, y):
    return outer_hit(bvh, (x, y, 0.0), (0, 0, 1))
def bottom_hit(bvh, x, y):
    return outer_hit(bvh, (x, y, 0.5), (0, 0, -1))
def signed_clearance(bvh, p):
    loc, nrm, idx, dist = bvh.find_nearest(Vector(p))
    if loc is None:
        return 9.0
    return dist if nrm.dot(Vector(p) - loc) > 0 else -dist

# ------------------------------------------------------------------------ body: lofted spanwise rings (chord / sweep / thickness profiles)
SPAN = 3.0
STATIONS, RING_N = 49, 32
def chord(u):
    return 3.2 * math.sqrt(max(0.0, 1 - u * u)) * (1 - 0.35 * abs(u)) + 0.10
def y_mid(u):
    return -0.55 * abs(u) ** 1.4                                     # tips sweep back
def thick(u):
    return 0.06 + 0.70 * (1 - abs(u)) ** 1.7 * (1 - 0.3 * abs(u))
BELLY_Z = 0.055
rings = []; ring_is_top = []
for i in range(STATIONS):
    u = -1 + 2 * i / (STATIONS - 1); x = SPAN * u
    c = chord(u); t = thick(u); zc = BELLY_Z + 0.4 * t
    ring = []
    for k in range(RING_N):
        a = 2 * math.pi * k / RING_N
        ca, sa = math.cos(a), math.sin(a)
        taper = 1 - 0.5 * max(0.0, -ca)                            # thinner trailing half (airfoil-like section)
        y = y_mid(u) + 0.5 * c * ca
        z = zc + 0.5 * t * taper * sa * (1.15 if sa > 0 else 0.8)   # domed back, flatter belly resting on Z=0.02
        ring.append(V(x, y, z)); ring_is_top.append(sa)
    rings.append(ring)
bv, bf = loft(rings, cap_start=True, cap_end=True)
body = new_mesh_object(PFX + "body", bv, bf, [M_skin], recalc=True)
sub = body.modifiers.new("Subsurf", 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
body_me = body.data
BODY_BVH = bvh_of([body])

# skin colours baked to COLOR_0: indigo back blending to lavender-white underside, darker leading-edge head, pale wing tips
col = body_me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
for v in body_me.vertices:
    co = v.co; u = co.x / SPAN; t = thick(u); zc = BELLY_Z + 0.4 * t
    top = smooth(zc - 0.12 * t, zc + 0.12 * t, co.z)
    c = mix(VENTRAL, DORSAL, top)
    c = mix(c, (0.10, 0.07, 0.28), top * smooth(0.6, 1.3, co.y) * smooth(0.9, 0.3, abs(co.x)))        # darker head crown
    c = mix(c, (0.46, 0.42, 0.72), top * smooth(0.75, 1.0, abs(u)))                                   # pale wing tips
    col.data[v.index].color = (*c, 1.0)
body_me.color_attributes.active_color = col

# ------------------------------------------------------------------------ cephalic lobes, eyes, mouth slit, gill slits, dorsal fin, tail with diamond fin
LOBE_CTRL = [V(0.62, 1.15, 0.30), V(0.66, 1.60, 0.26), V(0.60, 1.85, 0.12), V(0.55, 1.92, 0.08)]
lobes = Parts()
for sign in (-1, 1):
    pts = catmull([V(sign * p.x, p.y, p.z) for p in LOBE_CTRL], 6)
    lobes.add(*tube(pts, [lerp(0.14, 0.055, (i / (len(pts) - 1)) ** 0.9) for i in range(len(pts))], n=12))
lobe_ob = new_mesh_object(PFX + "lobes", lobes.v, lobes.f, [M_lobe])
sub = lobe_ob.modifiers.new("Subsurf", 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
eye = Parts(); pupil = Parts()
EYE_C = {s: V(sg * 0.80, 1.20, 0.31) for s, sg in (("L", -1), ("R", 1))}
for s, c in EYE_C.items():
    sg = 1 if s == "R" else -1
    eye.add(*sphere_part(c, 0.075, u=16, v=10))
    pupil.add(*sphere_part(c + V(sg * 0.055, 0.03, 0.01), 0.04, scale=(0.5, 1.0, 1.0)))
eyes = new_mesh_object(PFX + "eyes", eye.v, eye.f, [M_eye])
pupils = new_mesh_object(PFX + "pupils", pupil.v, pupil.f, [M_pupil])
slits = Parts()
mouth = []
for x in lin(-0.50, 0.50, 11):
    u = x / SPAN; p = V(x, y_mid(u) + 0.5 * chord(u) - 0.02, BELLY_Z + 0.4 * thick(u))
    mouth.append(p)
slits.add(*tube(mouth, None, n=8, ru_rv=[(0.016, 0.045)] * len(mouth)))
for sign in (-1, 1):
    for k in range(5):
        yk = 0.95 - 0.22 * k
        pts = []
        for xs in lin(0.14, 0.56, 6):
            loc, nrm = bottom_hit(BODY_BVH, sign * xs, yk - 0.10 * (xs / 0.56) ** 2)
            if loc is not None:
                pts.append(loc - V(0, 0, 0.004))
        if len(pts) >= 3:
            slits.add(*tube(pts, None, n=8, ru_rv=[(0.012, 0.03)] * len(pts)))
slit_ob = new_mesh_object(PFX + "mouth_gills", slits.v, slits.f, [M_dark])
fin = Parts()
base_pts, top_pts = [], []
for y in lin(-1.00, -1.45, 10):
    loc, nrm = top_hit(BODY_BVH, 0.0, y)
    if loc is None:
        continue
    h = 0.32 * math.sin(math.pi * (y + 1.45) / 0.45) ** 0.7
    base_pts.append(loc - V(0, 0, 0.02)); top_pts.append(loc + V(0, -0.12, h))
fv = base_pts + top_pts
fin.add(fv, grid_faces(2, len(base_pts), outward_test=V(1, 0, 0), verts=fv))
TAIL_CTRL = [V(0, -1.55, 0.30), V(0, -2.40, 0.22), V(0, -3.30, 0.30), V(0, -4.20, 0.48), V(0, -4.60, 0.55)]
TAIL_PTS = catmull(TAIL_CTRL, 6)
tail_ob = new_mesh_object(PFX + "tail", *tube(TAIL_PTS, [lerp(0.11, 0.02, (i / (len(TAIL_PTS) - 1)) ** 0.8) for i in range(len(TAIL_PTS))], n=10), [M_lobe])
fin.add([V(0, -4.35, 0.52), V(0.17, -4.56, 0.55), V(0, -4.80, 0.575), V(-0.17, -4.56, 0.55)], [(0, 1, 2, 3)])          # diamond tail fin
fin_ob = new_mesh_object(PFX + "fins", fin.v, fin.f, [M_fin])
sol = fin_ob.modifiers.new("Solidify", 'SOLIDIFY'); sol.thickness = 0.018; sol.offset = 0.0; sol.use_even_offset = True

# glow spots: emissive flattened spheres along two arcs on each wing (exported as emissive materials)
glow = Parts(); SPOTS = []
for sign in (-1, 1):
    for k in range(10):
        f = k / 9
        for arc, (x0, x1, y0, y1) in enumerate(((0.75, 2.80, 0.55, -0.45), (0.95, 2.55, -0.10, -0.95))):
            x = sign * lerp(x0, x1, f); y = lerp(y0, y1, f) + 0.06 * math.sin(k * 1.7 + arc)
            loc, nrm = top_hit(BODY_BVH, x, y)
            if loc is None:
                continue
            r = (0.065 if arc == 0 else 0.045) * (1 - 0.45 * f)
            glow.add(*sphere_part(loc + nrm.normalized() * 0.004, r, scale=(1.0, 1.0, 0.35), u=10, v=6)); SPOTS.append(loc)
glow_ob = new_mesh_object(PFX + "glow_spots", glow.v, glow.f, [M_glow])

# ------------------------------------------------------------------------ dorsal riding platform: padded deck, bolster seat, stirrup loops, grip rail
def deck_grid(name, bvh, xs, ys, offset, mats, rise=None, thickness=0.03, trim_border=False):
    verts = []; mat_idx = []
    for r, y in enumerate(ys):
        for c, x in enumerate(xs):
            loc, nrm = top_hit(bvh, x, y)
            p = (loc + V(0, 0, offset)) if loc is not None else V(x, y, 0.8)
            if rise:
                p.z += rise(r, c, x, y)
            verts.append(p)
    faces = grid_faces(len(ys), len(xs), outward_test=V(0, 0, 1), verts=verts)
    if trim_border:
        for f in faces:
            a0 = min(f); r = a0 // len(xs); c = a0 % len(xs)
            mat_idx.append(1 if (r == 0 or r == len(ys) - 2 or c == 0 or c == len(xs) - 2) else 0)
    ob = new_mesh_object(name, verts, faces, mats, mat_idx if trim_border else None)
    sol = ob.modifiers.new("Solidify", 'SOLIDIFY'); sol.thickness = thickness; sol.offset = -1.0; sol.use_even_offset = True
    return ob, verts
deck, _ = deck_grid(PFX + "deck", BODY_BVH, lin(-0.66, 0.66, 13), lin(-0.42, 0.58, 11), 0.05, [M_deck, M_trim], thickness=0.04, trim_border=True)
DECK_BVH = bvh_of([deck])
SEAT_XS = lin(-0.30, 0.30, 9); SEAT_YS = lin(-0.24, 0.28, 11)
def seat_rise(r, c, x, y):
    xn = x / 0.30; yn = (y - 0.02) / 0.26
    bolster = 0.26 * smooth(0.0, 0.45, 1 - abs(xn)) * smooth(0.0, 0.35, 1 - abs(yn))
    cantle = 0.08 * smooth(-0.04, -0.20, y) * max(0.0, 1 - xn * xn)
    pommel = 0.04 * smooth(0.12, 0.26, y) * max(0.0, 1 - (xn / 0.6) ** 2)
    return bolster + cantle + pommel
seat_ob, seat_verts = deck_grid(PFX + "seat", DECK_BVH, SEAT_XS, SEAT_YS, 0.07, [M_seat], rise=seat_rise, thickness=0.06)
SEAT = seat_verts[5 * len(SEAT_XS) + 4].copy()
sub = seat_ob.modifiers.new("Subsurf", 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
STIRRUP_X = 0.60
STIRRUPS = {}
loops = Parts()
for sign, side in ((-1, "L"), (1, "R")):
    loc, nrm = top_hit(DECK_BVH, sign * STIRRUP_X, SEAT.y - 0.06)
    base = loc if loc is not None else V(sign * STIRRUP_X, SEAT.y - 0.06, 0.6)
    arc = [base + V(0.075 * math.cos(a), 0, 0.075 * math.sin(a)) for a in lin(0, math.pi, 13)]
    loops.add(*tube(arc, None, n=8, ru_rv=[(0.012, 0.035)] * len(arc)))                      # leather loop the boot slides under
    STIRRUPS[side] = base + V(0, 0, 0.012)
loop_ob = new_mesh_object(PFX + "stirrup_loops", loops.v, loops.f, [M_strap])
REIN_HAND = {"L": V(-0.20, SEAT.y + 0.27, SEAT.z + 0.30), "R": V(0.20, SEAT.y + 0.27, SEAT.z + 0.30)}
y0 = SEAT.y + 0.24
rail_ctrl = [V(-0.25, y0, SEAT.z + 0.02), V(-0.24, y0 + 0.03, SEAT.z + 0.26), V(-0.12, y0 + 0.05, SEAT.z + 0.345), V(0.0, y0 + 0.055, SEAT.z + 0.36),
             V(0.12, y0 + 0.05, SEAT.z + 0.345), V(0.24, y0 + 0.03, SEAT.z + 0.26), V(0.25, y0, SEAT.z + 0.02)]
rail_pts = catmull(rail_ctrl, 5)
rail = Parts()
rail.add(*tube(rail_pts, [0.018] * len(rail_pts), n=10))
for sign in (-1, 1):
    rail.add(*sphere_part(V(sign * 0.25, y0, SEAT.z + 0.02), 0.03, scale=(1.4, 1.4, 0.6)))        # rail feet on the seat front
rail_ob = new_mesh_object(PFX + "grip_rail", rail.v, rail.f, [M_iron])
RAIL = {"L": V(-0.24, y0 + 0.03, SEAT.z + 0.26), "R": V(0.24, y0 + 0.03, SEAT.z + 0.26)}
RAIL_HAND_GAP = {s: round(min((p - REIN_HAND[s]).length for p in rail_pts) - 0.018, 4) for s in ("L", "R")}

# ------------------------------------------------------------------------ rig
BONE_SPECS = [
    ("Root", None, (0, 0, 0), (0, 0.25, 0)),
    ("Body", "Root", (0, -0.60, 0.35), (0, 0.60, 0.36)),
    ("Head", "Body", (0, 0.60, 0.36), (0, 1.55, 0.30)),
    ("Fin", "Body", (0, -1.00, 0.55), (0, -1.32, 0.90)),
    ("Tail1", "Body", tuple(TAIL_CTRL[0]), tuple(TAIL_CTRL[1])),
    ("Tail2", "Tail1", tuple(TAIL_CTRL[1]), tuple(TAIL_CTRL[2])),
    ("Tail3", "Tail2", tuple(TAIL_CTRL[2]), tuple(TAIL_CTRL[3])),
    ("Tail4", "Tail3", tuple(TAIL_CTRL[3]), tuple(TAIL_CTRL[4])),
]
for sign, side in ((-1, "L"), (1, "R")):
    BONE_SPECS.append((f"Lobe.{side}", "Head", (sign * 0.62, 1.15, 0.30), (sign * 0.55, 1.92, 0.08)))
    BONE_SPECS.append((f"WingA.{side}", "Body", (sign * 0.30, 0.0, 0.35), (sign * 1.10, -0.10, 0.30)))
    BONE_SPECS.append((f"WingB.{side}", f"WingA.{side}", (sign * 1.10, -0.10, 0.30), (sign * 2.00, -0.25, 0.25)))
    BONE_SPECS.append((f"WingC.{side}", f"WingB.{side}", (sign * 2.00, -0.25, 0.25), (sign * 3.00, -0.55, 0.10)))
BONE_SEG = {n: (Vector(h), Vector(t)) for n, _, h, t in BONE_SPECS}
def falloff_for(name):
    base = name.split(".")[0]
    return {"Root": 0.01, "Body": (0.55, 1.0, 0.5), "Head": (0.60, 0.6, 0.4), "Fin": 0.22, "Tail1": 0.28, "Tail2": 0.22, "Tail3": 0.16, "Tail4": 0.10,
            "Lobe": 0.16, "WingA": (0.62, 1.4, 0.5), "WingB": (0.55, 1.2, 0.4), "WingC": (0.5, 0.9, 0.3)}[base]
arm_data = bpy.data.armatures.new("AetherRayArmature")
RIG = bpy.data.objects.new("AetherRayRig", arm_data); COLL.objects.link(RIG)
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
BODY_BONE = "Body"
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
def wing_bones(co):
    s = side_of(co)
    return [f"WingA.{s}", f"WingB.{s}", f"WingC.{s}"]
TAILS = ["Tail1", "Tail2", "Tail3", "Tail4"]
def body_allowed(co):
    if abs(co.x) > 0.32:
        return wing_bones(co) + ["Body"]
    if co.y > 0.62:
        return ["Head", "Body"]
    if co.y < -1.35:
        return ["Tail1", "Body"]
    return ["Body", "WingA.L", "WingA.R", "Head"]
skin(body, body_allowed)
skin(glow_ob, lambda co: wing_bones(co) + ["Body"])
skin(slit_ob, lambda co: ["Head", "Body"] if abs(co.x) < 0.7 else wing_bones(co))
skin(lobe_ob, lambda co: ["Lobe." + side_of(co), "Head"])
for ob in (eyes, pupils):
    skin(ob, ["Head"])
skin(tail_ob, ["Body"] + TAILS)
skin(fin_ob, lambda co: ["Tail4", "Tail3"] if co.y < -4.0 else ["Fin", "Body"])
for ob in (deck, seat_ob, loop_ob, rail_ob):
    skin(ob, ["Body"])

REFS = {}
def ref_node(name, bone, point, role):
    e = bpy.data.objects.new(name, None); COLL.objects.link(e)
    e.empty_display_type = 'PLAIN_AXES'; e.empty_display_size = 0.05
    e.parent = RIG; e.parent_type = 'BONE'; e.parent_bone = bone
    bpy.context.view_layer.update()
    e.matrix_world = Matrix.Translation(Vector(point)); e["role"] = role
    REFS[name] = e; return e
ref_node("Seat", "Body", SEAT, "rider_seat")
ref_node("Stirrup.L", "Body", STIRRUPS["L"], "rider_stirrup")
ref_node("Stirrup.R", "Body", STIRRUPS["R"], "rider_stirrup")
ref_node("ReinHand.L", "Body", REIN_HAND["L"], "rider_rein_hand")
ref_node("ReinHand.R", "Body", REIN_HAND["R"], "rider_rein_hand")
ref_node("Rail.L", "Body", RAIL["L"], "rail_grip")
ref_node("Rail.R", "Body", RAIL["R"], "rail_grip")

# ------------------------------------------------------------------------ clips: Idle (landed), Glide, Soar (in place; hover bob on Body, no floor solve)
ANIM_BONES = [n for n, _, _, _ in BONE_SPECS if n != "Root"]
def apply_pose(pose, loc):
    for name in ANIM_BONES:
        RIG.pose.bones[name].rotation_quaternion = pose.get(name, Q_ID)
    RIG.pose.bones[BODY_BONE].location = loc
    RIG.update_tag(); bpy.context.view_layer.update()
def body_lowest(pose, loc):
    apply_pose(pose, loc)
    out = {}
    for ob in (body, lobe_ob, tail_ob):
        ev = ob.evaluated_get(dg()); m = ev.to_mesh()
        out[ob.name] = min(v.co.z for v in m.vertices)
        ev.to_mesh_clear()
    return out
_a = body_lowest({}, body_loc(0.0)); _b = body_lowest({}, body_loc(0.10))
LIFT_PROBE = sum(_b[k] - _a[k] for k in _a) / len(_a)
if abs(LIFT_PROBE - 0.10) > 1e-3:
    _probe = {ax: body_lowest({}, tuple(0.1 if i == ax else 0.0 for i in range(3))) for ax in range(3)}
    UP_AXIS = max(range(3), key=lambda ax: abs(sum(_probe[ax][k] - _a[k] for k in _a)))
    UP_SIGN = 1.0 if sum(_probe[UP_AXIS][k] - _a[k] for k in _a) > 0 else -1.0
    def body_loc(lift):
        return tuple(UP_SIGN * lift if i == UP_AXIS else 0.0 for i in range(3))
    _b = body_lowest({}, body_loc(0.10)); LIFT_PROBE = sum(_b[k] - _a[k] for k in _a) / len(_a)

LIFT_AXIS = {"R": (0, -1, 0), "L": (0, 1, 0)}            # out x up: positive angle raises the wing tip on either side
def wings(pose, ph, amps, lags=(0.0, 0.6, 1.2), twist=0.0, up_only=False):
    for sign, side in ((-1, "L"), (1, "R")):
        for name, amp, lag in zip(("WingA", "WingB", "WingC"), amps, lags):
            s = math.sin(ph - lag)
            ang = amp * (0.5 - 0.5 * math.cos(ph - lag)) if up_only else amp * s
            q = rot(f"{name}.{side}", LIFT_AXIS[side], ang)
            if twist and name == "WingC":
                q = Q(q, rot(f"WingC.{side}", (sign, 0, 0), twist * math.sin(ph - lag - 0.4)))
            pose[f"{name}.{side}"] = q
def tail_wave(pose, ph, amp, lag=0.55, lateral=0.0):
    for i, name in enumerate(TAILS):
        pose[name] = Q(rot(name, (1, 0, 0), amp * (0.6 + 0.5 * i) * math.sin(ph - lag * (i + 1))), rot(name, (0, 0, 1), lateral * math.sin(ph - lag * (i + 1) + 0.8)))
def lobes_pose(pose, ph, curl):
    for sign, side in ((-1, "L"), (1, "R")):
        pose[f"Lobe.{side}"] = Q(rot(f"Lobe.{side}", (1, 0, 0), curl * math.sin(ph + (0.0 if side == "R" else 0.5))), rot(f"Lobe.{side}", (0, 0, 1), -sign * 0.5 * curl * math.sin(ph + 1.2)))

IDLE_F, GLIDE_F, SOAR_F = 96, 48, 32
def idle_raw(phase):
    ph = 2 * math.pi * phase
    pose = {}
    wings(pose, ph, (0.015, 0.035, 0.07), lags=(0.0, 0.5, 1.0), up_only=True)                 # landed: tips lift only, never below the floor
    tail_wave(pose, ph, 0.02, lateral=0.05)
    lobes_pose(pose, ph, 0.02)
    pose["Head"] = rot("Head", (1, 0, 0), 0.01 * math.sin(2 * ph))
    pose["Fin"] = rot("Fin", (0, 0, 1), 0.04 * math.sin(ph + 0.3))
    return pose, 0.0
def glide_raw(phase):
    ph = 2 * math.pi * phase
    pose = {}
    wings(pose, ph, (0.10, 0.16, 0.22), twist=0.08)
    tail_wave(pose, ph, 0.06, lateral=0.03)
    lobes_pose(pose, ph, 0.05)
    pose["Body"] = rot("Body", (1, 0, 0), 0.02 * math.sin(ph - 0.4))
    pose["Head"] = rot("Head", (1, 0, 0), -0.015 * math.sin(ph - 0.4))
    return pose, 0.05 * (0.5 + 0.5 * math.sin(ph - 0.9))
def soar_raw(phase):
    ph = 2 * math.pi * phase
    pose = {}
    wings(pose, ph, (0.22, 0.34, 0.48), twist=0.15)
    tail_wave(pose, ph, 0.10, lateral=0.04)
    lobes_pose(pose, ph, 0.04)
    pose["Body"] = rot("Body", (1, 0, 0), 0.04 + 0.06 * math.sin(ph - 0.4))
    pose["Head"] = rot("Head", (1, 0, 0), -0.03 * math.sin(ph - 0.4))
    pose["Fin"] = rot("Fin", (0, 0, 1), 0.03 * math.sin(ph))
    return pose, 0.08 * (0.5 + 0.5 * math.sin(ph - 0.9))
def flight(raw_fn):
    cache = {}
    def fn(phase):
        if phase not in cache:
            pose, bob = raw_fn(phase)
            cache[phase] = (pose, body_loc(bob), bob)
        return cache[phase][:2]
    fn.cache = cache
    return fn
idle_pose, glide_pose, soar_pose = flight(idle_raw), flight(glide_raw), flight(soar_raw)
CLIPS = [("Idle", IDLE_F, idle_pose, True, 3), ("Glide", GLIDE_F, glide_pose, True, 2), ("Soar", SOAR_F, soar_pose, True, 1)]
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
PIVOT = V(0, -0.60, 0.45)
cam_rig = bpy.data.objects.new(PFX + "RIG", None); COLL.objects.link(cam_rig); cam_rig.location = PIVOT
cam_data = bpy.data.cameras.new(PFX + "CAM"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 7.6; cam_data.clip_start = 0.05; cam_data.clip_end = 60.0
cam = bpy.data.objects.new(PFX + "CAM", cam_data); COLL.objects.link(cam); cam.parent = cam_rig
cam.location = (0.0, 14.0, 0.0); cam.rotation_euler = Euler((deg(90), 0, deg(180)), 'XYZ')
def light(name, loc, energy, size, color, aim):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy = energy; ld.size = size; ld.color = color
    ob = bpy.data.objects.new(name, ld); COLL.objects.link(ob); ob.parent = cam_rig; ob.location = loc
    ob.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob
light(PFX + "KEY", (-6.0, 7.5, 5.5), 1400, 5.0, (1.0, 0.96, 0.9), (0, 0, 0))
light(PFX + "FILL", (7.5, 6.5, 1.5), 420, 8.0, (0.9, 0.94, 1.0), (0, 0, 0))
light(PFX + "RIM", (3.0, -6.5, 5.0), 800, 3.5, (1.0, 1.0, 1.0), (0, 0, 0))
w = bpy.data.worlds.new(PFX + "WORLD"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.36, 0.36, 0.42, 1.0); w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
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
    lowest = []; tips = []; seat_track = []; bobs = []
    for f in range(1, frames + 1):
        phase = (f - 1) / frames
        pose, loc = pose_fn(phase)
        zs = body_lowest(pose, loc)
        lowest.append(round(min(zs.values()), 3))
        tips.append(round(RIG.pose.bones["WingC.R"].tail.z, 3))
        seat_track.append(to_gltf(REFS["Seat"].matrix_world.translation)); bobs.append(round(pose_fn.cache[phase][2], 4))
    p0, l0 = pose_fn(0.0); p1, l1 = pose_fn(1.0)
    CLIP_EVIDENCE[clip_name] = {
        "frames": frames, "fps": 24, "keyStepFrames": step, "loops": loop, "inPlace": True, "floorSolved": False,
        "loopClosure": {"poseAtPhase0EqualsPhase1": set(p0) == set(p1) and all(quat_close(p0[k], p1[k]) for k in p0) and max(abs(a - b) for a, b in zip(l0, l1)) < 1e-9},
        "lowestPointPerFrameMeters": lowest, "lowestPointMinZ": min(lowest),
        "wingTipZPerFrameMeters": tips, "wingTipRange": {"min": min(tips), "max": max(tips)},
        "bodyHoverBobMeters": {"min": min(bobs), "max": max(bobs)},
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
TACK_CLEAR = {deck.name: shell_clearance(deck, BODY_BVH), seat_ob.name: shell_clearance(seat_ob, DECK_BVH), loop_ob.name: shell_clearance(loop_ob, DECK_BVH),
              rail_ob.name: shell_clearance(rail_ob, DECK_BVH), glow_ob.name: shell_clearance(glow_ob, BODY_BVH), eyes.name: shell_clearance(eyes, BODY_BVH)}

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
lobe_mesh = next((m for m in gltf["meshes"] if m["name"] == PFX + "lobes"), None)
emissive_mats = [m.get("name") for m in gltf.get("materials", []) if any(c > 0.0 for c in m.get("emissiveFactor", [0, 0, 0]))]
CLIP_SET = {c[0] for c in CLIPS}
checks = {
    "clipsIdleGlideSoar": set(animations) == CLIP_SET and all(v["durationSeconds"] > 0 for v in animations.values()),
    "soarShorterThanGlide": animations.get("Soar", {}).get("durationSeconds", 9) < animations.get("Glide", {}).get("durationSeconds", 0),
    "oneSkinWith16Joints": len(skins) == 1 and len(joint_names) == len(BONE_SPECS) and set(joint_names) == {n for n, _, _, _ in BONE_SPECS},
    "landedBellyOnFloor": -0.005 < pos_min[1] < 0.04,
    "forwardIsNegativeZ": bool(lobe_mesh) and all(acc[p["attributes"]["POSITION"]]["max"][2] < -1.0 for p in lobe_mesh["primitives"]),
    "riderReferenceNodes": {"Seat", "Stirrup.L", "Stirrup.R", "ReinHand.L", "ReinHand.R"} <= set(ref_nodes),
    "railGripNodes": {"Rail.L", "Rail.R"} <= set(ref_nodes),
    "noCameras": "cameras" not in gltf, "noLights": "KHR_lights_punctual" not in gltf.get("extensionsUsed", []),
    "clipsLoopClosed": all(v["loopClosure"]["poseAtPhase0EqualsPhase1"] for v in CLIP_EVIDENCE.values()),
    "idleNeverBelowFloor": CLIP_EVIDENCE["Idle"]["lowestPointMinZ"] > -0.005,
    "deckAndSeatOutsideBody": TACK_CLEAR[deck.name]["verticesInsideSurface"] == 0 and TACK_CLEAR[seat_ob.name]["verticesInsideSurface"] == 0,
    "handsRestOnRail": all(RAIL_HAND_GAP[s] <= 0.03 for s in RAIL_HAND_GAP),
    "stirrupDropInRange": all(0.40 <= SEAT.z - STIRRUPS[s].z <= 0.65 for s in STIRRUPS),
    "noLegBones": not any(("Upper" in n or "Leg" in n or "Hoof" in n or "Paw" in n) for n in joint_names),
    "wingspanAtLeast5p8": (pos_max[0] - pos_min[0]) >= 5.8,
    "emissiveSpotsExported": len(emissive_mats) >= 1 and len(SPOTS) >= 30,
    "rootLiftAxisResolved": abs(LIFT_PROBE - 0.10) < 1e-3,
    "underTriangleBudget": eval_tris <= TRI_BUDGET,
}
prev = json.load(open(OUT_MANIFEST)) if os.path.exists(OUT_MANIFEST) else {}
manifest = {
    "asset": "aether_ray.glb", "generated": True,
    "status": "source authored and exported; staging only, no runtime support and no visual approval until rendered stills are reviewed",
    "species": "aether ray (wide gliding manta-like flying mount)",
    "sourceAxes": "Blender: +Y forward, Z up, metres", "glbAxes": "+Y up, -Z forward (export_yup)",
    "boundsMetersGlb": {"min": [round(c, 3) for c in pos_min], "max": [round(c, 3) for c in pos_max]},
    "heightMeters": round(pos_max[1], 3), "lengthMeters": round(pos_max[2] - pos_min[2], 3), "wingspanMeters": round(pos_max[0] - pos_min[0], 3),
    "seat": {
        "node": "Seat", "role": "rider_seat", "surface": "top surface of the bolster seat on the dorsal deck, centre line, landed rest pose",
        "glbPosition": to_gltf(SEAT),
        "riderRootHint": "place the rider's root (its floor origin) at Seat minus the rider's seated pelvis-bottom height (V9: 0.823 m) plus 0.02 forward",
        "stirrupTreadGlb": {k: to_gltf(v) for k, v in STIRRUPS.items()}, "stirrupDropBelowSeatMeters": round(SEAT.z - STIRRUPS["R"].z, 4),
        "stirrupStyle": "leather loops on the deck; the boot slides under the loop and rests on the deck",
        "reinHandGlb": {k: to_gltf(v) for k, v in REIN_HAND.items()}, "reinStyle": "curved iron grip rail ahead of the seat; ReinHand points lie on the rail", "railHandGapMeters": RAIL_HAND_GAP,
        "railGripGlb": {k: to_gltf(v) for k, v in RAIL.items()},
        "deckOffsetFromBodyMeters": 0.05, "deckThicknessMeters": 0.04, "seatBolsterRiseMeters": 0.26,
    },
    "flightClipLowestPointMeters": {c: CLIP_EVIDENCE[c]["lowestPointMinZ"] for c in ("Glide", "Soar")},
    "flightRule": "Glide/Soar wing tips dip below the landed origin plane by flightClipLowestPointMeters; the runtime must keep the origin at least that far above terrain while flying. Idle is the landed clip.",
    "referenceNodes": ref_nodes,
    "deformBones": joint_names, "animationClips": animations, "clipEvidence": CLIP_EVIDENCE,
    "seatMotionContract": "clipEvidence.<clip>.seatDeltaPerFrameGlb is the seat's displacement from rest per frame (glTF axes) for a per-species rider ride solve",
    "meshObjects": [ob.name for ob in MESHES], "perObject": per_object, "emissiveMaterials": emissive_mats, "glowSpotCount": len(SPOTS),
    "trianglesEvaluated": eval_tris, "drawGroups": draw_groups, "materialCount": len(bpy.data.materials), "glbBytes": os.path.getsize(OUT_GLB),
    "budget": {"targetTriangles": TRI_BUDGET, "trianglesMet": eval_tris <= TRI_BUDGET, "bodyStations": STATIONS, "bodyRingPoints": RING_N},
    "tackClearance": TACK_CLEAR, "floorSolveProbe": {"liftRequested": 0.10, "bodyRaised": round(LIFT_PROBE, 4)},
    "sha256": {"glb": GLB_SHA, "blend": BLEND_SHA},
    "glbChecks": checks, "glbStructureValid": all(checks.values()),
    "peakProcessMemoryMB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1),
    "authorSeconds": round(time.time() - T0, 1), "blender": bpy.app.version_string,
    "command": "blender -b -t 4 --factory-startup --python author_aether_ray.py",
}
for key in ("design", "traversalRole", "riderClipMap", "renders"):
    if key in prev:
        manifest[key] = prev[key]
if "renders" in manifest:
    manifest["renders"]["currentForGlb"] = False
with open(OUT_MANIFEST, "w") as f:
    json.dump(manifest, f, indent=1)
print("AETHER_RAY_DONE", json.dumps({"tris": eval_tris, "checks": checks, "seat": to_gltf(SEAT), "sha": GLB_SHA[:12], "peakMB": manifest["peakProcessMemoryMB"]}))
