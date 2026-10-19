"""Wayfarer V9 head-and-shoulders pilot authoring script.

Builds an editable bust candidate from the rights-verified CC0 Blender Studio
"Body Male - Stylized" base already staged in
../wayfarer_v3_staging/wayfarer_v3_artist_staging.blend (opened read-only,
saved as a NEW file in this directory; V3 is never written).

Run (one headless process):
    blender -b -t 4 --factory-startup --python author_v9.py

Outputs: wayfarer_v9_head_shoulders.blend, v9_geometry.json
"""
import bpy, bmesh, json, math, os, time, resource
from mathutils import Vector, Euler, Matrix

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, "..", "wayfarer_v3_staging", "wayfarer_v3_artist_staging.blend"))
OUT_BLEND = os.path.join(HERE, "wayfarer_v9_head_shoulders.blend")

CUT_Z = 1.36          # bust cut (below camera frame)
HEAD_C = Vector((0.0, -0.012, 2.062))   # approximate skull centre used for hair parametrisation
PIVOT = Vector((0.0, 0.0, 1.92))        # camera pivot
CAM_DIST = 2.125
CAM_LENS = 85.0

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def lerp(a, b, t):
    return a + (b - a) * t

def deg(x):
    return math.radians(x)

# --------------------------------------------------------------------------- open source
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)   # immediately fork: V3 untouched from here on

for ob in list(bpy.data.objects):
    if ob.type == 'EMPTY':
        bpy.data.objects.remove(ob)

body = bpy.data.objects["GEO-body_male_stylized"]
eyeL = bpy.data.objects["GEO-body_male_stylized.eye.L"]
eyeR = bpy.data.objects["GEO-body_male_stylized.eye.R"]
for ob in (body, eyeL, eyeR):
    ob.animation_data_clear()
    ob.data.animation_data_clear() if ob.data.animation_data else None
    mw = ob.matrix_world.copy()
    ob.data.transform(mw)
    ob.matrix_world = Matrix.Identity(4)
    ob.data.materials.clear()
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
body.name = "V9_body_bust"; body.data.name = body.name
eyeL.name = "V9_eye_L"; eyeL.data.name = eyeL.name
eyeR.name = "V9_eye_R"; eyeR.data.name = eyeR.name

# ---------------------------------------------------------------- body: widen head, cut bust
me = body.data
for v in me.vertices:
    f = 1.0 + 0.06 * smooth(1.84, 1.93, v.co.z)
    v.co.x *= f
    # subtle jaw squaring: push lower-face sides outward a touch
    if 1.87 < v.co.z < 1.99 and abs(v.co.x) > 0.05 and v.co.y > 0.02:
        v.co.x *= 1.0 + 0.035 * smooth(1.99, 1.92, v.co.z) * smooth(0.02, 0.09, v.co.y)
    # relax the wide-open stare: ease the upper-lid region down a few millimetres
    for ex in (-0.054, 0.054):
        dx = (v.co.x - ex) / 0.052
        if abs(dx) < 1.0 and v.co.y > 0.06 and 2.052 < v.co.z < 2.09:
            fall = (1 - dx * dx) * smooth(2.09, 2.068, v.co.z) * smooth(2.052, 2.06, v.co.z)
            v.co.z -= 0.006 * fall
for eye, sgn in ((eyeL, -1), (eyeR, 1)):
    eye.location.x += sgn * 0.0031

bm = bmesh.new(); bm.from_mesh(me)
geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, CUT_Z), plane_no=(0, 0, -1.0), clear_inner=False, clear_outer=True)
cut_edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)
bm.to_mesh(me); bm.free()
me.update()
for p in me.polygons:
    p.use_smooth = True

# radius table of the body: r_body[u_bin][z_bin] = max horizontal radius (gravity-drape basis)
NU, Z0, Z1, DZ = 72, CUT_Z, 1.96, 0.01
NZ = int(round((Z1 - Z0) / DZ)) + 1
rtab = [[0.0] * NZ for _ in range(NU)]
for v in me.vertices:
    z = v.co.z
    if Z0 - 0.02 <= z <= Z1 + 0.02:
        u = math.degrees(math.atan2(v.co.x, v.co.y)) % 360.0
        iu = int(u / (360.0 / NU)) % NU
        iz = min(NZ - 1, max(0, int(round((z - Z0) / DZ))))
        r = math.hypot(v.co.x, v.co.y)
        for du in (-1, 0, 1):
            j = (iu + du) % NU
            if r > rtab[j][iz]:
                rtab[j][iz] = r
# fill empties downward from above and smooth
for iu in range(NU):
    col = rtab[iu]
    last = 0.0
    for iz in range(NZ - 1, -1, -1):
        if col[iz] == 0.0:
            col[iz] = last
        last = col[iz]
    for iz in range(NZ):
        if col[iz] == 0.0:
            col[iz] = next((c for c in col if c > 0), 0.1)

def r_body(u_deg, z):
    """bilinear body radius."""
    return _bilin(rtab, u_deg, z)

# gravity-drape table: max body radius at/above each z (cloth hanging from the shoulder contact)
TOP_IZ = min(NZ - 1, int(round((1.84 - Z0) / DZ)))   # above 1.84 the front bins hold the jaw, not shoulders
dtab = [[0.0] * NZ for _ in range(NU)]
for iu in range(NU):
    run = 0.0
    for iz in range(TOP_IZ, -1, -1):
        run = max(run, rtab[iu][iz]); dtab[iu][iz] = run
    for iz in range(TOP_IZ + 1, NZ):
        dtab[iu][iz] = rtab[iu][iz]

def _bilin(tab, u_deg, z):
    u = (u_deg % 360.0) / (360.0 / NU)
    iu = int(math.floor(u)); fu = u - iu
    zz = max(0.0, min(NZ - 1.0, (z - Z0) / DZ))
    iz = int(math.floor(zz)); fz = zz - iz
    iz2 = min(NZ - 1, iz + 1)
    a = lerp(tab[iu % NU][iz], tab[iu % NU][iz2], fz)
    b = lerp(tab[(iu + 1) % NU][iz], tab[(iu + 1) % NU][iz2], fz)
    return lerp(a, b, fu)

def r_drape(u_deg, z, top=1.84):
    """radius of cloth hanging under gravity from a shoulder contact: max body radius at/above z."""
    return _bilin(dtab, u_deg, z)

def surf_z(u_deg, R, gap=0.034, z_hi=1.84):
    """height at which the mantle surface (drape radius + gap) reaches radius R, scanning downward."""
    z = z_hi
    while z > CUT_Z:
        if r_drape(u_deg, z) + gap >= R:
            return z
        z -= 0.004
    return CUT_Z

# ------------------------------------------------------------------------ materials
def mat_principled(name, color, rough=0.6, metallic=0.0, sheen=0.0, bump=0.0, bump_scale=40.0, sss=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if sss and "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = sss
        bsdf.inputs["Subsurface Radius"].default_value = (0.9, 0.35, 0.2)
        bsdf.inputs["Subsurface Scale"].default_value = 0.02
    if bump:
        tex = nt.nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = bump_scale
        tex.inputs["Detail"].default_value = 4.0
        bn = nt.nodes.new("ShaderNodeBump")
        bn.inputs["Strength"].default_value = bump
        bn.inputs["Distance"].default_value = 0.002
        nt.links.new(tex.outputs["Fac"], bn.inputs["Height"])
        nt.links.new(bn.outputs["Normal"], bsdf.inputs["Normal"])
    return m

M_skin = mat_principled("V9_skin", (0.62, 0.38, 0.24), rough=0.55, sss=0.12, bump=0.05, bump_scale=120)
M_sclera = mat_principled("V9_eye_sclera", (0.85, 0.82, 0.78), rough=0.25)
M_iris = mat_principled("V9_eye_iris", (0.30, 0.15, 0.05), rough=0.25)
M_pupil = mat_principled("V9_eye_pupil", (0.01, 0.01, 0.01), rough=0.2)
M_brow = mat_principled("V9_brow", (0.12, 0.06, 0.03), rough=0.7)
M_violet = mat_principled("V9_violet_cloth", (0.17, 0.07, 0.46), rough=0.85, sheen=0.35, bump=0.18, bump_scale=90)
M_violet_dark = mat_principled("V9_violet_lining", (0.12, 0.05, 0.34), rough=0.9, sheen=0.3)
M_gold = mat_principled("V9_gold", (0.80, 0.55, 0.16), rough=0.38, metallic=1.0)
M_tunic = mat_principled("V9_tunic", (0.60, 0.46, 0.30), rough=0.9, sheen=0.3, bump=0.15, bump_scale=120)
M_leather = mat_principled("V9_leather", (0.26, 0.13, 0.06), rough=0.5, bump=0.1, bump_scale=60)

# hair: root->tip gradient driven by a float attribute "t" plus a stripe pattern along the lock
M_hair = bpy.data.materials.new("V9_hair"); M_hair.use_nodes = True
nt = M_hair.node_tree; bsdf = nt.nodes["Principled BSDF"]
attr = nt.nodes.new("ShaderNodeAttribute"); attr.attribute_name = "t"
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (0.07, 0.035, 0.015, 1)
ramp.color_ramp.elements[1].position = 1.0; ramp.color_ramp.elements[1].color = (0.27, 0.14, 0.05, 1)
mid = ramp.color_ramp.elements.new(0.55); mid.color = (0.17, 0.085, 0.03, 1)
nt.links.new(attr.outputs["Fac"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.55
if "Coat Weight" in bsdf.inputs:
    bsdf.inputs["Coat Weight"].default_value = 0.08
wave = nt.nodes.new("ShaderNodeTexWave"); wave.inputs["Scale"].default_value = 90.0
wave.inputs["Distortion"].default_value = 3.0; wave.inputs["Detail"].default_value = 2.0
bn = nt.nodes.new("ShaderNodeBump"); bn.inputs["Strength"].default_value = 0.25; bn.inputs["Distance"].default_value = 0.002
nt.links.new(wave.outputs["Fac"], bn.inputs["Height"]); nt.links.new(bn.outputs["Normal"], bsdf.inputs["Normal"])

body.data.materials.append(M_skin)

# eyes: iris/pupil by polygon normal direction
for eye in (eyeL, eyeR):
    eye.data.materials.append(M_sclera); eye.data.materials.append(M_iris); eye.data.materials.append(M_pupil)
    for p in eye.data.polygons:
        p.use_smooth = True
        d = p.normal.dot(Vector((0, 1, 0)))
        p.material_index = 2 if d > math.cos(deg(11)) else (1 if d > math.cos(deg(30)) else 0)

# ------------------------------------------------------------------------ helpers
def new_mesh_object(name, verts, faces, mats, mat_idx=None, collection=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for m in mats:
        me.materials.append(m)
    if mat_idx is not None:
        for p, mi in zip(me.polygons, mat_idx):
            p.material_index = mi
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    (collection or sc.collection).objects.link(ob)
    return ob

def add_subsurf(ob, levels=1, render=2):
    m = ob.modifiers.new("Subdivision", 'SUBSURF'); m.levels = levels; m.render_levels = render
    return m

def add_solidify(ob, thickness, offset=-1.0, rim_mat=None):
    m = ob.modifiers.new("Solidify", 'SOLIDIFY'); m.thickness = thickness; m.offset = offset
    m.use_even_offset = True
    if rim_mat is not None:
        m.material_offset_rim = rim_mat
    return m

def head_surface(direction):
    """ray from skull centre outward: returns (point, normal) on the body surface."""
    d = Vector(direction).normalized()
    ok, loc, nrm, idx = body.ray_cast(HEAD_C + d * 0.6, -d)
    if not ok:
        return HEAD_C + d * 0.17, d
    return loc, nrm

def sph_dir(theta_deg, phi_deg):
    """theta: azimuth (0 = +Y front, +90 = +X character-right); phi: polar from +Z."""
    t, p = deg(theta_deg), deg(phi_deg)
    return Vector((math.sin(p) * math.sin(t), math.sin(p) * math.cos(t), math.cos(p)))

def surface_front(x, z):
    ok, loc, nrm, idx = body.ray_cast(Vector((x, 0.6, z)), Vector((0, -1, 0)))
    return (loc, nrm) if ok else (Vector((x, 0.15, z)), Vector((0, 1, 0)))

# ------------------------------------------------------------------------ eyebrows
def build_brow(sign):
    pts = [(0.016, 2.088, 0.016), (0.034, 2.099, 0.020), (0.052, 2.107, 0.021), (0.070, 2.108, 0.018),
           (0.086, 2.103, 0.013), (0.100, 2.094, 0.008), (0.110, 2.086, 0.004)]
    verts, faces = [], []
    for i, (x, z, h) in enumerate(pts):
        loc, nrm = surface_front(sign * x, z)
        n = nrm.normalized()
        up = Vector((0, 0, 1))
        for k, zz in enumerate((-h * 0.5, h * 0.5)):
            verts.append(loc + up * zz + n * 0.004)
        if i:
            a = (i - 1) * 2
            faces.append((a, a + 1, a + 3, a + 2))
    ob = new_mesh_object("V9_brow_%s" % ("R" if sign > 0 else "L"), verts, faces, [M_brow])
    add_solidify(ob, 0.006, offset=0.0)
    add_subsurf(ob, 1, 2)
    return ob

build_brow(1); build_brow(-1)

# ------------------------------------------------------------------------ hair
def hairline_phi(theta):
    """polar angle of the hairline as a function of azimuth (deg)."""
    s = ((theta + 180) % 360) - 180        # signed: + character-right
    a = abs(s)                              # 0 front .. 180 back
    keys = [(0, 65), (30, 67), (60, 74), (90, 82), (120, 94), (150, 106), (180, 113)]
    for (a0, p0), (a1, p1) in zip(keys, keys[1:]):
        if a0 <= a <= a1:
            t = (a - a0) / (a1 - a0)
            base = lerp(p0, p1, 0.5 - 0.5 * math.cos(math.pi * t))
            # fringe falls lower on the character-left forehead, sweeps higher on the right
            base += 4.0 * smooth(10, -35, s) * smooth(70, 30, a) - 2.5 * smooth(5, 35, s) * smooth(70, 30, a)
            return base
    return 108

def shell_offset(theta, phi):
    a = abs(((theta + 180) % 360) - 180)
    base = lerp(0.024, 0.014, a / 180.0)                 # thicker on top/front, thinner at the back
    base += 0.016 * smooth(55, 20, phi)                  # extra volume on the crown
    base += 0.010 * smooth(60, 30, a) * smooth(25, 45, phi)   # fringe volume
    edge = hairline_phi(theta)
    base *= 1.0 - 0.85 * smooth(edge - 14, edge, phi)    # taper to the hairline
    return max(0.004, base)

def hair_point(theta, phi, off):
    d = sph_dir(theta, phi)
    loc, nrm = head_surface(d)
    n = (nrm.normalized() * 0.5 + d * 0.5).normalized()
    return loc + n * off, n

# scalp shell
NT, NP = 64, 22
verts, faces, mats = [], [], []
for j in range(NP + 1):
    for i in range(NT):
        th = i * 360.0 / NT
        ph = (j / NP) * (hairline_phi(th) + 2.0)
        p, n = hair_point(th, max(ph, 0.5), shell_offset(th, ph))
        verts.append(p)
for j in range(NP):
    for i in range(NT):
        a = j * NT + i; b = j * NT + (i + 1) % NT
        faces.append((a, b, b + NT, a + NT))
shell = new_mesh_object("V9_hair_shell", verts, faces, [M_hair])
tattr = shell.data.attributes.new("t", 'FLOAT', 'POINT')
for i in range(len(verts)):
    tattr.data[i].value = 0.15
bm = bmesh.new(); bm.from_mesh(shell.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
bm.to_mesh(shell.data); bm.free()
add_subsurf(shell, 1, 2)
# soft clump relief on the shell so any exposed patch reads as hair mass, not scalp
clump_tex = bpy.data.textures.new("V9_hair_clumps", 'CLOUDS'); clump_tex.noise_scale = 0.045; clump_tex.noise_depth = 2
disp = shell.modifiers.new("Clumps", 'DISPLACE'); disp.texture = clump_tex; disp.strength = 0.012; disp.mid_level = 0.5

# locks
def flow(theta, phi):
    """desired tangent direction expressed as (d_theta, d_phi) weights."""
    a = ((theta + 180) % 360) - 180      # -180..180, + = character right
    aa = abs(a)
    front = smooth(110, 60, aa)          # 1 on the front half, 0 at the back
    # front half: hair sweeps UP and BACK from the forehead toward the crown, drifting to character-left
    up_back = (-0.45, -1.0)
    # fringe band near the hairline: lateral sweep to character-left; droops on the left temple, lifts on the right
    droop = 0.25 + 0.8 * smooth(0, -45, a) - 0.7 * smooth(5, 40, a)
    fringe = (-1.0, droop)
    wf = smooth(44, 58, phi) * smooth(75, 55, aa)
    # sides: down and back ; back: down with a mild swirl
    side = (0.6 if a > 0 else -0.5, 1.0)
    back = (0.25 * math.sin(deg(2 * theta)), 1.0)
    ws = smooth(55, 80, aa) * smooth(125, 100, aa) * smooth(35, 55, phi)
    wb = smooth(95, 125, aa)
    wu = front * (1 - wf) * (1 - ws)
    tot = wu + wf + ws + wb + 1e-6
    dth = (up_back[0] * wu + fringe[0] * wf + side[0] * ws + back[0] * wb) / tot
    dph = (up_back[1] * wu + fringe[1] * wf + side[1] * ws + back[1] * wb) / tot
    return (dth, dph)

def lock(theta0, phi0, length, width, thick, lift, tip_curl=0.0, wobble=0.0, seed=0):
    steps = max(6, int(length / 0.012))
    R = 0.18
    th, ph = theta0, phi0
    path = []
    dth, dph = flow(th, ph)
    for s in range(steps + 1):
        off_shell = shell_offset(th, ph)
        path.append((th, ph, off_shell))
        f_th, f_ph = flow(th, ph)
        # blend current heading toward the field for smooth curves
        dth = lerp(dth, f_th, 0.45); dph = lerp(dph, f_ph, 0.45)
        dth += wobble * math.sin(seed + s * 0.9)
        nrm = math.hypot(dth, dph) or 1.0
        ds = length / steps
        sinp = max(0.25, math.sin(deg(ph)))
        th += math.degrees(ds / R * dth / nrm / sinp)
        ph += math.degrees(ds / R * dph / nrm)
        if ph < 2.0:          # crossed the crown pole: continue down the far side
            ph = 4.0 - ph; th += 180.0; dph = -dph
    m = 8
    verts, faces, tvals = [], [], []
    for i, (th, ph, offs) in enumerate(path):
        t = i / (len(path) - 1)
        w = width * (0.6 + 0.4 * math.sin(math.pi * min(1.0, t * 1.4 + 0.25))) * (1.0 - 0.62 * smooth(0.55, 1.0, t))
        h = thick * (1.0 - 0.75 * t * t)   # flat spatula tips rather than round drips
        o = offs + lerp(-0.7 * thick, 0.15 * thick, smooth(0.0, 0.22, t)) + lift * t * t + tip_curl * t ** 3
        c, n = hair_point(th, ph, o)
        c2, _ = hair_point(th + 0.001, ph, o)
        # tangent from neighbours
        if i < len(path) - 1:
            nth, nph, noff = path[i + 1]
            cn, _ = hair_point(nth, nph, o)
            tdir = (cn - c).normalized()
        else:
            pth, pph, poff = path[i - 1]
            cp, _ = hair_point(pth, pph, o)
            tdir = (c - cp).normalized()
        b = tdir.cross(n).normalized()
        n2 = b.cross(tdir).normalized()
        for k in range(m):
            ang = 2 * math.pi * k / m
            lat = 0.5 * w * math.cos(ang)
            sa = math.sin(ang)
            nn = h * sa if sa > 0 else 0.3 * h * sa
            nn -= lat * lat / (2 * 0.18)      # follow the skull curvature laterally
            verts.append(c + b * lat + n2 * nn)
            tvals.append(t)
    for i in range(len(path) - 1):
        for k in range(m):
            a0 = i * m + k; a1 = i * m + (k + 1) % m
            faces.append((a0, a1, a1 + m, a0 + m))
    # caps
    faces.append(tuple(range(m))[::-1])
    last = (len(path) - 1) * m
    faces.append(tuple(range(last, last + m)))
    return verts, faces, tvals

import random
rng = random.Random(9)
LV, LF, LT = [], [], []
def add_lock(*args, **kw):
    v, f, t = lock(*args, **kw)
    base = len(LV)
    LV.extend(v); LF.extend([tuple(i + base for i in face) for face in f]); LT.extend(t)

def ring(phi_row, W, aa_min, L, lift_extra=0.0, overhang=6.0, spacing=0.55):
    circ = 2 * math.pi * 0.19 * math.sin(deg(phi_row))
    n = max(5, int(circ / (W * spacing)))
    for i in range(n):
        th = i * 360.0 / n + rng.uniform(-5, 5) + (phi_row * 1.7)
        a = abs(((th + 180) % 360) - 180)
        if a < aa_min or phi_row > hairline_phi(th) - 3:
            continue
        ph = phi_row + rng.uniform(-3, 3)
        length = L * rng.uniform(0.85, 1.15)
        room = (hairline_phi(th) + overhang - ph) / 180 * math.pi * 0.18
        length = min(length, max(0.035, room))
        add_lock(th, ph, length, W * rng.uniform(0.85, 1.2), rng.uniform(0.018, 0.026),
                 rng.uniform(0.001, 0.005) + lift_extra, tip_curl=rng.uniform(0.0, 0.005),
                 wobble=rng.uniform(0, 0.25), seed=rng.random() * 6)

# back & sides (flow runs downward): whorl, crown-back rows then side rows
for (phi_row, W, aa_min, L) in [(8, 0.07, 0, 0.07), (20, 0.08, 95, 0.09), (36, 0.075, 95, 0.095), (52, 0.07, 60, 0.095),
                                 (68, 0.065, 60, 0.085), (84, 0.06, 60, 0.075), (98, 0.06, 110, 0.07)]:
    ring(phi_row, W, aa_min, L)

# front top (flow runs up/back into the crown), three shingled rows
for (phi_row, W, L, lift_extra) in [(58, 0.08, 0.10, 0.004), (47, 0.08, 0.10, 0.006), (36, 0.075, 0.09, 0.008)]:
    circ = 2 * math.pi * 0.19 * math.sin(deg(phi_row))
    n = int(circ / (W * 0.62))
    for i in range(n):
        th = i * 360.0 / n + rng.uniform(-4, 4) + phi_row
        a = abs(((th + 180) % 360) - 180)
        if a > 80:
            continue
        add_lock(th, phi_row + rng.uniform(-2, 2), L * rng.uniform(0.85, 1.1), W * rng.uniform(0.9, 1.15),
                 rng.uniform(0.02, 0.028), rng.uniform(0.004, 0.01) + lift_extra, tip_curl=rng.uniform(0.0, 0.01),
                 wobble=rng.uniform(0, 0.2), seed=rng.random() * 6)

# fringe: wide locks seeded at the hairline, sweeping across toward character-left
for i, th in enumerate((56, 44, 32, 20, 8, -4, -16, -28, -40)):
    add_lock(th, hairline_phi(th) - 4, 0.11 + 0.012 * (i % 3), 0.08, 0.026, 0.006, tip_curl=0.008, wobble=0.15, seed=i)
# swept-up tuft at the front / character-right (rises a little above the crown line)
for i, th in enumerate((14, 26, 38, 50, 2)):
    add_lock(th, 57, 0.11, 0.085, 0.03, 0.016 + 0.004 * i, tip_curl=0.012, wobble=0.1, seed=i + 3)
# ear-top locks and nape locks (nape runs down to the collar line)
for th in (84, -84, 70, -70):
    add_lock(th, 75, 0.07, 0.06, 0.018, 0.002, seed=th)
for th in (136, 148, 160, 172, 184, 196, 208, 220, 232):
    add_lock(th, 100, 0.065, 0.06, 0.016, 0.001, seed=th)

locks = new_mesh_object("V9_hair_locks", LV, LF, [M_hair])
tattr = locks.data.attributes.new("t", 'FLOAT', 'POINT')
for i, t in enumerate(LT):
    tattr.data[i].value = t
add_subsurf(locks, 1, 2)

# ------------------------------------------------------------------------ garments
def drape_patch(name, u0, u1, nu, nv, z_top, z_bot, radial, mats, trim_rows=0, trim_cols=0, closed=False):
    """cylindrical cloth grid. z_top(u), z_bot(u): heights; radial(u, z, v): radius."""
    verts, faces, midx = [], [], []
    cols = nu if closed else nu + 1
    for j in range(nv + 1):
        v = j / nv
        for i in range(cols):
            u = lerp(u0, u1, i / nu)
            zt, zb = z_top(u), z_bot(u)
            z = lerp(zt, zb, v)
            r = radial(u, z, v)
            verts.append(Vector((r * math.sin(deg(u)), r * math.cos(deg(u)), z)))
    for j in range(nv):
        for i in range(nu):
            a = j * cols + i; b = j * cols + ((i + 1) % cols if closed else i + 1)
            faces.append((a, b, b + cols, a + cols))
            trim = j >= nv - trim_rows or (not closed and (i < trim_cols or i >= nu - trim_cols))
            midx.append(1 if trim else 0)
    return new_mesh_object(name, verts, faces, mats, midx)

def folds(u, v, amp, k1=5.0, k2=9.0, phase=0.0):
    return amp * v * v * (0.6 * math.sin(deg(u * k1) + phase) + 0.4 * math.sin(deg(u * k2) + 1.3 + phase))

# tunic (beige, under everything, with V-neck)
def tunic_top(u):
    a = abs(((u + 180) % 360) - 180)
    return 1.84 - 0.13 * smooth(45, 0, a)
tunic = drape_patch("V9_tunic", -70, 70, 40, 16, tunic_top, lambda u: CUT_Z + 0.005,
                    lambda u, z, v: r_body(u, z) + 0.006, [M_tunic], closed=False)
add_solidify(tunic, 0.004, offset=0.0); add_subsurf(tunic, 1, 2)

# robe (violet, open at the front showing the tunic, gold trim down the opening edges)
OPEN = 17.0
robe = drape_patch("V9_robe", OPEN, 360 - OPEN, 96, 20, lambda u: 1.83, lambda u: CUT_Z + 0.002,
                   lambda u, z, v: r_drape(u, z) + 0.014 + folds(u, v, 0.010, 6, 11, 0.7), [M_violet, M_gold],
                   trim_cols=1, closed=False)
add_solidify(robe, 0.008, offset=-1.0, rim_mat=0); add_subsurf(robe, 1, 2)

# leather satchel strap across the chest from character-right shoulder to character-left hip (sits on the tunic/robe)
def strap_patch():
    verts, faces = [], []
    n = 40
    for i in range(n + 1):
        t = i / n
        # path: from shoulder (u=+40, z=1.82) to (u=-45, z=CUT_Z)
        u = lerp(38, -45, t)
        z = lerp(1.70, CUT_Z - 0.01, t)
        r = r_drape(u, z) + 0.024
        c = Vector((r * math.sin(deg(u)), r * math.cos(deg(u)), z))
        # width direction: perpendicular to path, approx along the surface
        tdir = Vector((-math.cos(deg(u)), math.sin(deg(u)), 0)) * (-1 if True else 1)
        nrm = Vector((math.sin(deg(u)), math.cos(deg(u)), 0))
        wdir = (tdir * 0.35 + Vector((0, 0, 1))).normalized()
        wdir = (wdir - nrm * wdir.dot(nrm)).normalized()
        verts.append(c + wdir * 0.022); verts.append(c - wdir * 0.022)
        if i:
            a = (i - 1) * 2
            faces.append((a, a + 1, a + 3, a + 2))
    ob = new_mesh_object("V9_strap", verts, faces, [M_leather])
    add_solidify(ob, 0.006, offset=0.0); add_subsurf(ob, 1, 2)
    return ob
strap_patch()

# mantle (short shoulder cape) : chevron hem at front, longer at back, gold trim along the hem
def mantle_top(u):
    a = abs(((u + 180) % 360) - 180)
    return 1.86 - 0.14 * smooth(40, 0, a)
def mantle_hem(u):
    a = abs(((u + 180) % 360) - 180)
    front = lerp(1.63, 1.55, smooth(0, 62, a))
    back = lerp(1.55, 1.50, smooth(120, 180, a))
    return min(front, back) if a > 62 else front
def mantle_radial(u, z, v):
    return r_drape(u, z) + 0.034 + folds(u, v, 0.014, 5, 9)
mantle = drape_patch("V9_mantle", 0, 360, 144, 24, mantle_top, mantle_hem, mantle_radial, [M_violet, M_gold], trim_rows=2, closed=True)
add_solidify(mantle, 0.010, offset=-1.0, rim_mat=1); add_subsurf(mantle, 1, 2)

# hood hanging on the back
def hood_bot(u):
    return 1.53 + 0.10 * ((u - 180) / 50.0) ** 2
def hood_radial(u, z, v):
    uu = (u - 180) / 50.0
    dome = math.sin(math.pi * v) * max(0.0, 1 - uu * uu) ** 0.7
    return r_drape(u, z) + 0.046 + 0.05 * dome + folds(u, v, 0.008, 8, 13)
hood = drape_patch("V9_hood", 130, 230, 36, 18, lambda u: 1.90, hood_bot, hood_radial, [M_violet, M_gold], trim_rows=2, closed=False)
add_solidify(hood, 0.010, offset=-1.0, rim_mat=1); add_subsurf(hood, 1, 2)

# standing collar around the back of the neck with pointed front ends
C0, C1 = 48.0, 312.0
def r_neck(u):
    """neck surface radius from the body axis at z=1.84: below the chin, above the trapezius flare."""
    return r_body(u, 1.84)
def collar_base(u):
    return 1.78
def collar_top(u):
    a = abs(((u + 180) % 360) - 180)   # 0 front .. 180 back
    top = lerp(1.91, 1.975, smooth(70, 180, a))
    # taper to points at the ends
    end = min(u - C0, C1 - u)
    return lerp(collar_base(u) + 0.02, top, smooth(0, 26, end))
def collar_radial(u, z, v):
    a = abs(((u + 180) % 360) - 180)
    rb = r_neck(u) + lerp(0.042, 0.022, smooth(60, 180, a))   # looser at the jaw, hugging the nape
    return rb + 0.022 * (1 - v)   # flares outward toward the top edge (v=0 is the top row)
collar = drape_patch("V9_collar", C0, C1, 80, 8, collar_top, collar_base, collar_radial, [M_violet_dark, M_gold], closed=False)
# gold on the top edge row (v=0 is the first row of faces)
for p in collar.data.polygons:
    j = p.index // 80
    p.material_index = 1 if j == 0 else 0
add_solidify(collar, 0.007, offset=0.0, rim_mat=0); add_subsurf(collar, 1, 2)

# draped cowl (wrapped scarf): continuous surface from a loose neck opening down onto the chest/shoulders,
# with three fold bulges displaced along its normal. Rests on the mantle; never free-floating.
def cowl_frame(u):
    a = abs(((u + 180) % 360) - 180)
    R_top = r_neck(u) + lerp(0.075, 0.028, smooth(40, 170, a))   # loose U at the front, hugging at the nape
    z_top = max(surf_z(u, R_top) + 0.004, lerp(1.785, 1.80, smooth(0, 180, a)))
    z_hang = lerp(1.625, 1.72, smooth(0, 150, a)) + 0.008 * math.sin(deg(u * 2) + 0.6)
    R_hang = r_drape(u, z_hang) + 0.034 + 0.004
    R_cap = R_top + 0.095
    if R_hang <= R_cap:                      # front/back: cloth hangs down onto the chest/back
        R_bot = max(R_hang, R_top + 0.06)
        z_bot = max(z_hang, surf_z(u, R_bot) + 0.004)
    else:                                    # sides: cloth lies on the shoulder slope, never out to the arm
        R_bot = R_cap
        z_bot = surf_z(u, R_bot) + 0.004
    return R_top, z_top, R_bot, z_bot

def cowl_point(u, v):
    R_top, z_top, R_bot, z_bot = cowl_frame(u)
    a = abs(((u + 180) % 360) - 180)
    r = lerp(R_top, R_bot, v) + lerp(0.010, 0.016, smooth(110, 0, a)) * math.sin(math.pi * v)   # loose barrel sag
    z = lerp(z_top, z_bot, v)
    rad = Vector((math.sin(deg(u)), math.cos(deg(u)), 0.0)); up = Vector((0, 0, 1))
    tan = (rad * (R_bot - R_top) + up * (z_bot - z_top)).normalized()
    nrm = Vector((tan.z * rad.x, tan.z * rad.y, -(tan.x * rad.x + tan.y * rad.y)))
    if nrm.dot(rad) < 0:
        nrm = -nrm
    nrm.normalize()
    vv = v + 0.05 * math.sin(deg(u) + 0.8)
    bump = 0.020 * (0.5 - 0.5 * math.cos(2 * math.pi * 3.0 * vv)) * (0.8 + 0.2 * math.sin(deg(u * 4)))
    bump += 0.001 * math.sin(deg(u * 5) + v * 3)
    bump += 0.008 * (0.5 - 0.5 * math.cos(math.pi * smooth(0.18, 0.0, v)))   # softly rolled top edge
    return rad * r + up * z + nrm * bump, nrm

def cowl():
    nu, nv = 120, 22
    verts, faces = [], []
    for j in range(nv + 1):
        for i in range(nu):
            p, n = cowl_point(i * 360.0 / nu, j / nv)
            verts.append(p)
    for j in range(nv):
        for i in range(nu):
            a0 = j * nu + i; a1 = j * nu + (i + 1) % nu
            faces.append((a0, a1, a1 + nu, a0 + nu))
    ob = new_mesh_object("V9_cowl", verts, faces, [M_violet])
    add_solidify(ob, 0.012, offset=-1.0); add_subsurf(ob, 1, 2)
    return ob
cowl()

# gold sun brooch on the cowl, character-left
def brooch():
    u = -26.0
    centre, nrm = cowl_point(u, 0.62)
    centre = centre + nrm * 0.006
    up = Vector((0, 0, 1)); side = up.cross(nrm).normalized(); up2 = nrm.cross(side).normalized()
    verts, faces = [centre + nrm * 0.004], []
    npts = 16
    for i in range(npts):
        ang = 2 * math.pi * i / npts
        rr = 0.030 if i % 2 == 0 else 0.017
        verts.append(centre + side * (rr * math.cos(ang)) + up2 * (rr * math.sin(ang)))
    for i in range(npts):
        faces.append((0, 1 + i, 1 + (i + 1) % npts))
    ob = new_mesh_object("V9_brooch", verts, faces, [M_gold])
    add_solidify(ob, 0.006, offset=-1.0)
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob
brooch()

# body smoothing
add_subsurf(body, 1, 2)
for eye in (eyeL, eyeR):
    add_subsurf(eye, 1, 1)

# ------------------------------------------------------------------------ camera rig + lights (saved in the file)
rig = bpy.data.objects.new("V9_RIG", None); sc.collection.objects.link(rig); rig.location = PIVOT
cam_data = bpy.data.cameras.new("V9_CAM"); cam_data.lens = CAM_LENS; cam_data.sensor_width = 36.0; cam_data.clip_start = 0.05
cam = bpy.data.objects.new("V9_CAM", cam_data); sc.collection.objects.link(cam); cam.parent = rig
cam.location = (0.0, CAM_DIST, 0.0); cam.rotation_euler = Euler((deg(90), 0, deg(180)), 'XYZ'); sc.camera = cam
def light(name, loc, energy, size, color):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy = energy; ld.size = size; ld.color = color
    ob = bpy.data.objects.new(name, ld); sc.collection.objects.link(ob); ob.parent = rig; ob.location = loc
    ob.rotation_euler = (-Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
light("V9_KEY", (-1.5, 2.0, 1.3), 170, 1.3, (1.0, 0.96, 0.9))
light("V9_FILL", (1.9, 1.7, 0.3), 60, 2.2, (0.9, 0.94, 1.0))
light("V9_RIM", (0.7, -1.6, 1.2), 110, 1.0, (1.0, 1.0, 1.0))
w = sc.world or bpy.data.worlds.new("V9_WORLD"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.42, 0.44, 1.0)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
sc.render.resolution_x = sc.render.resolution_y = 512; sc.render.resolution_percentage = 100
sc.render.engine = 'CYCLES'; sc.cycles.samples = 64; sc.cycles.use_denoising = True; sc.cycles.device = 'CPU'
sc.cycles.max_bounces = 4; sc.render.threads_mode = 'FIXED'; sc.render.threads = 4
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'; sc.render.film_transparent = False
sc.frame_set(1)

# ------------------------------------------------------------------------ save + report
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
dg = bpy.context.evaluated_depsgraph_get()
tris = 0; nobj = 0
for ob in sc.objects:
    if ob.type == 'MESH':
        nobj += 1
        ev = ob.evaluated_get(dg)
        m = ev.to_mesh(); m.calc_loop_triangles(); tris += len(m.loop_triangles); ev.to_mesh_clear()
report = {
    "blend": os.path.basename(OUT_BLEND),
    "source": SRC,
    "meshObjects": nobj,
    "evaluatedTriangles": tris,
    "materials": len([m for m in bpy.data.materials if m.name.startswith("V9_")]),
    "hairLocks": len(LF) and sum(1 for f in LF if len(f) == 8) // 2,
    "authorSeconds": round(time.time() - T0, 2),
    "authorMaxRSSBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    "blender": bpy.app.version_string,
}
with open(os.path.join(HERE, "v9_geometry.json"), "w") as f:
    json.dump(report, f, indent=1)
print("AUTHOR_DONE", json.dumps(report))
