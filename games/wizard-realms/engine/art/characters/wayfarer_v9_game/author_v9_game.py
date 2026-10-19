"""Wayfarer V9 playable asset: full-body completion and rig of the user-approved V9 sculpt.

Approved visual target: the bottom V9 row of wayfarer_v9_staging/comparison_vs_reference.png
(user-owned, read-only staging directory in /Volumes/git/wizard-realms-resume-20261016; its blend and
author_v9.py sha256 are recorded in male_manifest.json). The head edits, eyebrows, hair shell, hair locks,
tunic top, strap, mantle, hood, standing collar, cowl and brooch code below is ported from author_v9.py
without design changes (same constants, same seeded RNG, same radius-table math) so the V9 head, face,
hair and upper garments reproduce on the UNCUT CC0 body: there is no bust seam because no cut is made.

New in this file (technical completion in V9 style, authorised by the lane): full-length open robe with
gold trim, bell sleeves with gold cuffs, leather belt and buckle, trousers, boots, hip satchel, removal of
body faces hidden under cloth, the V2-compatible 17-deform-bone rig, seven equipment sockets, Idle /
Walk / Turn clips, GLB export with +Y up / -Z forward, GLB structure validation and the manifest.

Base mesh: Blender Studio "Human Base Meshes" v1.4.1, collection "Body Male - Stylized", CC0, as staged
in ../wayfarer_v3_staging/wayfarer_v3_artist_staging.blend (opened read-only, saved-as here first).

Budget choices: V9's Subdivision and Solidify modifiers are not used on the game mesh (the V9 bust was
300k evaluated triangles); cloth is single-sided sheets with double-sided materials, the brows and brooch
keep their small Solidify, and the hair root-to-tip gradient is baked to vertex colours so it survives GLB.

Run (one headless process):
    blender -b -t 4 --factory-startup --python author_v9_game.py
Outputs: wayfarer_v9_male.blend, wayfarer_v9_male.glb, male_manifest.json
"""
import bpy, bmesh, json, math, os, time, resource, random, struct, hashlib
from mathutils import Vector, Euler, Matrix, Quaternion

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, "..", "wayfarer_v3_staging", "wayfarer_v3_artist_staging.blend"))
V3_MANIFEST = os.path.normpath(os.path.join(HERE, "..", "wayfarer_v3_staging", "STAGING_MANIFEST.json"))
V9_APPROVED = os.path.normpath(os.path.join(HERE, "..", "wayfarer_v9_approved"))   # byte-identical copies of the approved V9 staging source
V9_STAGING_ORIGIN = "/Volumes/git/wizard-realms-resume-20261016/games/wizard-realms/engine/art/characters/wayfarer_v9_staging"
V9_APPROVED_SHA256 = {   # recorded from the user-owned staging directory on 2026-10-19; the copies must match exactly
    "author_v9.py": "65d922d3d8d3e1950f302f7f27fd86737d9fd790340095e56230a961f5e304d8",
    "wayfarer_v9_head_shoulders.blend": "85c98714bdcf347fdf5a4324fd49d2a6da126e309e0a6b886760e6ea976d9249",
    "v9_front.png": "12d8608640657effd050218a217768f3d026cf63975d81d23306bbe7ad829a1e",
    "v9_three_quarter.png": "9e77953fc700ec56146d9a1292da527b77fab0b809f61a58bc6205bcc17bbf4b",
    "v9_side.png": "77e3662ee93afe410f60f4bc6ef4ff3b65a52185d9b834bd930922bc0624523d",
    "v9_back.png": "52052e5b2c61be74382cbb305b0a9078d38ed0f876a160968aaaee51b474ad94",
}
FEET_TOP = 0.58                           # barefoot variant: base-mesh skin kept from the floor up to here (under the trouser hem at 0.42)
V2_DIR = os.path.normpath(os.path.join(HERE, "..", "wayfarer_v2"))
OUT_BLEND = os.path.join(HERE, "wayfarer_v9_male.blend")
OUT_GLB = os.path.join(HERE, "wayfarer_v9_male.glb")
OUT_MANIFEST = os.path.join(HERE, "male_manifest.json")

CUT_Z = 1.36                              # V9 bust-cut height: only the lower bound of the V9 radius table now
HEAD_C = Vector((0.0, -0.012, 2.062))     # V9 skull centre for hair parametrisation
PIVOT = Vector((0.0, 0.0, 1.92))          # V9 bust camera pivot (reused by render_v9_game.py)
CAM_DIST = 2.125
CAM_LENS = 85.0
BODY_PIVOT = Vector((0.0, 0.0, 1.16))     # full-body turnaround pivot

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

# --------------------------------------------------------------------------- open source (read-only)
bpy.ops.wm.open_mainfile(filepath=SRC)
bpy.context.preferences.filepaths.save_version = 0
sc = bpy.context.scene
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)   # fork immediately: V3 is never written

body = bpy.data.objects["GEO-body_male_stylized"]
eyeL = bpy.data.objects["GEO-body_male_stylized.eye.L"]
eyeR = bpy.data.objects["GEO-body_male_stylized.eye.R"]
staged = {ob.name: ob.matrix_world.copy() for ob in (body, eyeL, eyeR)}   # staging frame: 180 deg Z, x1.2553
for ob in list(bpy.data.objects):
    if ob not in (body, eyeL, eyeR):
        bpy.data.objects.remove(ob)
COLL = bpy.data.collections.new("WayfarerV9Game")
sc.collection.children.link(COLL)
for ob in (body, eyeL, eyeR):
    ob.animation_data_clear()
    if ob.data.animation_data:
        ob.data.animation_data_clear()
    ob.parent = None
    ob.data.transform(staged[ob.name])
    ob.matrix_world = Matrix.Identity(4)
    ob.data.materials.clear()
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    COLL.objects.link(ob)
    ob.hide_viewport = ob.hide_render = False
for c in list(sc.collection.children):
    if c is not COLL:
        sc.collection.children.unlink(c)
body.name = "V9_body"; body.data.name = body.name
eyeL.name = "V9_eye_L"; eyeL.data.name = eyeL.name
eyeR.name = "V9_eye_R"; eyeR.data.name = eyeR.name

# ---------------------------------------------------------------- V9 head edits (ported unchanged)
me = body.data
for v in me.vertices:
    f = 1.0 + 0.06 * smooth(1.84, 1.93, v.co.z)
    v.co.x *= f
    if 1.87 < v.co.z < 1.99 and abs(v.co.x) > 0.05 and v.co.y > 0.02:
        v.co.x *= 1.0 + 0.035 * smooth(1.99, 1.92, v.co.z) * smooth(0.02, 0.09, v.co.y)
    for ex in (-0.054, 0.054):
        dx = (v.co.x - ex) / 0.052
        if abs(dx) < 1.0 and v.co.y > 0.06 and 2.052 < v.co.z < 2.09:
            fall = (1 - dx * dx) * smooth(2.09, 2.068, v.co.z) * smooth(2.052, 2.06, v.co.z)
            v.co.z -= 0.006 * fall
for eye, sgn in ((eyeL, -1), (eyeR, 1)):
    eye.location.x += sgn * 0.0031
me.update()
for p in me.polygons:
    p.use_smooth = True

# ---------------------------------------------------------------- radius tables
NU = 72
DZ = 0.01

def build_tables(points, z0, z1, nu=NU, dz=DZ, top=1.84):
    """V9 radius table (max horizontal radius per azimuth/height bin) and its gravity-drape table."""
    nz = int(round((z1 - z0) / dz)) + 1
    rtab = [[0.0] * nz for _ in range(nu)]
    for co in points:
        z = co.z
        if z0 - 0.02 <= z <= z1 + 0.02:
            u = math.degrees(math.atan2(co.x, co.y)) % 360.0
            iu = int(u / (360.0 / nu)) % nu
            iz = min(nz - 1, max(0, int(round((z - z0) / dz))))
            r = math.hypot(co.x, co.y)
            for du in (-1, 0, 1):
                j = (iu + du) % nu
                if r > rtab[j][iz]:
                    rtab[j][iz] = r
    for iu in range(nu):
        col = rtab[iu]
        last = 0.0
        for iz in range(nz - 1, -1, -1):
            if col[iz] == 0.0:
                col[iz] = last
            last = col[iz]
        for iz in range(nz):
            if col[iz] == 0.0:
                col[iz] = next((c for c in col if c > 0), 0.1)
    top_iz = min(nz - 1, int(round((top - z0) / dz)))
    dtab = [[0.0] * nz for _ in range(nu)]
    for iu in range(nu):
        run = 0.0
        for iz in range(top_iz, -1, -1):
            run = max(run, rtab[iu][iz]); dtab[iu][iz] = run
        for iz in range(top_iz + 1, nz):
            dtab[iu][iz] = rtab[iu][iz]
    return rtab, dtab, nz

def _bilin(tab, u_deg, z, z0, nz, nu=NU, dz=DZ):
    u = (u_deg % 360.0) / (360.0 / nu)
    iu = int(math.floor(u)); fu = u - iu
    zz = max(0.0, min(nz - 1.0, (z - z0) / dz))
    iz = int(math.floor(zz)); fz = zz - iz
    iz2 = min(nz - 1, iz + 1)
    a = lerp(tab[iu % nu][iz], tab[iu % nu][iz2], fz)
    b = lerp(tab[(iu + 1) % nu][iz], tab[(iu + 1) % nu][iz2], fz)
    return lerp(a, b, fu)

def is_arm(co):
    return abs(co.x) > 0.22 and 0.86 < co.z < 1.81

# V9 table: z 1.36..1.96, every vertex (arms included), exactly as the bust used for its upper garments
R9, D9, NZ9 = build_tables((v.co for v in me.vertices), CUT_Z, 1.96)
# torso table: full height, arms excluded; drives the full-length robe, tunic, belt and satchel
RT, DT, NZT = build_tables((v.co for v in me.vertices if not is_arm(v.co)), 0.0, 1.96)

def r_body(u_deg, z):
    return _bilin(R9, u_deg, z, CUT_Z, NZ9)

def r_drape(u_deg, z, top=1.84):
    return _bilin(D9, u_deg, z, CUT_Z, NZ9)

def r_torso(u_deg, z):
    return _bilin(RT, u_deg, z, 0.0, NZT)

def r_tdrape(u_deg, z):
    return _bilin(DT, u_deg, z, 0.0, NZT)

def surf_z(u_deg, R, gap=0.034, z_hi=1.84):
    z = z_hi
    while z > CUT_Z:
        if r_drape(u_deg, z) + gap >= R:
            return z
        z -= 0.004
    return CUT_Z

# ------------------------------------------------------------------------ materials (V9 + three new)
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
    m.use_backface_culling = False     # glTF doubleSided: cloth is exported as single sheets
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
M_leather_dark = mat_principled("V9_leather_dark", (0.15, 0.075, 0.035), rough=0.55, bump=0.1, bump_scale=60)
M_trouser = mat_principled("V9_trouser", (0.22, 0.145, 0.085), rough=0.9, sheen=0.2, bump=0.12, bump_scale=120)

# hair: V9 root->tip ramp, now read from the baked vertex colour "Col" so Cycles and the GLB agree
HAIR_RAMP = [(0.0, (0.07, 0.035, 0.015)), (0.55, (0.17, 0.085, 0.03)), (1.0, (0.27, 0.14, 0.05))]
def hair_color(t):
    for (p0, c0), (p1, c1) in zip(HAIR_RAMP, HAIR_RAMP[1:]):
        if t <= p1:
            f = (t - p0) / (p1 - p0)
            return tuple(lerp(a, b, f) for a, b in zip(c0, c1))
    return HAIR_RAMP[-1][1]

M_hair = bpy.data.materials.new("V9_hair"); M_hair.use_nodes = True
nt = M_hair.node_tree; bsdf = nt.nodes["Principled BSDF"]
vcol = nt.nodes.new("ShaderNodeVertexColor"); vcol.layer_name = "Col"
bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)   # glTF baseColorFactor multiplies COLOR_0: keep it white
nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.55
if "Coat Weight" in bsdf.inputs:
    bsdf.inputs["Coat Weight"].default_value = 0.08
wave = nt.nodes.new("ShaderNodeTexWave"); wave.inputs["Scale"].default_value = 90.0
wave.inputs["Distortion"].default_value = 3.0; wave.inputs["Detail"].default_value = 2.0
bn = nt.nodes.new("ShaderNodeBump"); bn.inputs["Strength"].default_value = 0.25; bn.inputs["Distance"].default_value = 0.002
nt.links.new(wave.outputs["Fac"], bn.inputs["Height"]); nt.links.new(bn.outputs["Normal"], bsdf.inputs["Normal"])
M_hair.use_backface_culling = False

body.data.materials.append(M_skin)

for eye in (eyeL, eyeR):
    eye.data.materials.append(M_sclera); eye.data.materials.append(M_iris); eye.data.materials.append(M_pupil)
    for p in eye.data.polygons:
        p.use_smooth = True
        d = p.normal.dot(Vector((0, 1, 0)))
        p.material_index = 2 if d > math.cos(deg(11)) else (1 if d > math.cos(deg(30)) else 0)

# ------------------------------------------------------------------------ helpers
def new_mesh_object(name, verts, faces, mats, mat_idx=None):
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
    COLL.objects.link(ob)
    return ob

def add_subsurf(ob, levels=1, render=1):
    m = ob.modifiers.new("Subdivision", 'SUBSURF'); m.levels = levels; m.render_levels = render
    return m

def add_solidify(ob, thickness, offset=-1.0, rim_mat=None):
    m = ob.modifiers.new("Solidify", 'SOLIDIFY'); m.thickness = thickness; m.offset = offset
    m.use_even_offset = True
    if rim_mat is not None:
        m.material_offset_rim = rim_mat
    return m

def join_objects(name, parts):
    """Merge mesh objects with identity transforms into one object (material slots unioned)."""
    mats = []
    for ob in parts:
        for m in ob.data.materials:
            if m not in mats:
                mats.append(m)
    verts, faces, midx, smooth_flags = [], [], [], []
    for ob in parts:
        base = len(verts)
        verts.extend(v.co.copy() for v in ob.data.vertices)
        for p in ob.data.polygons:
            faces.append(tuple(base + i for i in p.vertices))
            midx.append(mats.index(ob.data.materials[p.material_index]))
            smooth_flags.append(p.use_smooth)
    new = new_mesh_object(name, verts, faces, mats, midx)
    for p, s in zip(new.data.polygons, smooth_flags):
        p.use_smooth = s
    for ob in parts:
        data = ob.data
        bpy.data.objects.remove(ob)
        bpy.data.meshes.remove(data)
    return new

def recalc_normals(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()

def head_surface(direction):
    d = Vector(direction).normalized()
    ok, loc, nrm, idx = body.ray_cast(HEAD_C + d * 0.6, -d)
    if not ok:
        return HEAD_C + d * 0.17, d
    return loc, nrm

def sph_dir(theta_deg, phi_deg):
    t, p = deg(theta_deg), deg(phi_deg)
    return Vector((math.sin(p) * math.sin(t), math.sin(p) * math.cos(t), math.cos(p)))

def surface_front(x, z):
    ok, loc, nrm, idx = body.ray_cast(Vector((x, 0.6, z)), Vector((0, -1, 0)))
    return (loc, nrm) if ok else (Vector((x, 0.15, z)), Vector((0, 1, 0)))

# ------------------------------------------------------------------------ eyebrows (V9)
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
    return new_mesh_object("V9_brow_%s" % ("R" if sign > 0 else "L"), verts, faces, [M_brow])

brows = join_objects("V9_brows", [build_brow(1), build_brow(-1)])
add_solidify(brows, 0.006, offset=0.0)
add_subsurf(brows, 1, 1)

# ------------------------------------------------------------------------ hair (V9)
def hairline_phi(theta):
    s = ((theta + 180) % 360) - 180
    a = abs(s)
    keys = [(0, 65), (30, 67), (60, 74), (90, 82), (120, 94), (150, 106), (180, 113)]
    for (a0, p0), (a1, p1) in zip(keys, keys[1:]):
        if a0 <= a <= a1:
            t = (a - a0) / (a1 - a0)
            base = lerp(p0, p1, 0.5 - 0.5 * math.cos(math.pi * t))
            base += 4.0 * smooth(10, -35, s) * smooth(70, 30, a) - 2.5 * smooth(5, 35, s) * smooth(70, 30, a)
            return base
    return 108

def shell_offset(theta, phi):
    a = abs(((theta + 180) % 360) - 180)
    base = lerp(0.024, 0.014, a / 180.0)
    base += 0.016 * smooth(55, 20, phi)
    base += 0.010 * smooth(60, 30, a) * smooth(25, 45, phi)
    edge = hairline_phi(theta)
    base *= 1.0 - 0.85 * smooth(edge - 14, edge, phi)
    return max(0.004, base)

def hair_point(theta, phi, off):
    d = sph_dir(theta, phi)
    loc, nrm = head_surface(d)
    n = (nrm.normalized() * 0.5 + d * 0.5).normalized()
    return loc + n * off, n

def bake_hair_color(ob, tvals):
    col = ob.data.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    for i, t in enumerate(tvals):
        col.data[i].color = (*hair_color(t), 1.0)
    ob.data.color_attributes.active_color = col

NT, NP = 64, 22
verts, faces = [], []
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
bake_hair_color(shell, [0.15] * len(shell.data.vertices))
clump_tex = bpy.data.textures.new("V9_hair_clumps", 'CLOUDS'); clump_tex.noise_scale = 0.045; clump_tex.noise_depth = 2
disp = shell.modifiers.new("Clumps", 'DISPLACE'); disp.texture = clump_tex; disp.strength = 0.012; disp.mid_level = 0.5

def flow(theta, phi):
    a = ((theta + 180) % 360) - 180
    aa = abs(a)
    front = smooth(110, 60, aa)
    up_back = (-0.45, -1.0)
    droop = 0.25 + 0.8 * smooth(0, -45, a) - 0.7 * smooth(5, 40, a)
    fringe = (-1.0, droop)
    wf = smooth(44, 58, phi) * smooth(75, 55, aa)
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
        dth = lerp(dth, f_th, 0.45); dph = lerp(dph, f_ph, 0.45)
        dth += wobble * math.sin(seed + s * 0.9)
        nrm = math.hypot(dth, dph) or 1.0
        ds = length / steps
        sinp = max(0.25, math.sin(deg(ph)))
        th += math.degrees(ds / R * dth / nrm / sinp)
        ph += math.degrees(ds / R * dph / nrm)
        if ph < 2.0:
            ph = 4.0 - ph; th += 180.0; dph = -dph
    m = 8
    verts, faces, tvals = [], [], []
    for i, (th, ph, offs) in enumerate(path):
        t = i / (len(path) - 1)
        w = width * (0.6 + 0.4 * math.sin(math.pi * min(1.0, t * 1.4 + 0.25))) * (1.0 - 0.62 * smooth(0.55, 1.0, t))
        h = thick * (1.0 - 0.75 * t * t)
        o = offs + lerp(-0.7 * thick, 0.15 * thick, smooth(0.0, 0.22, t)) + lift * t * t + tip_curl * t ** 3
        c, n = hair_point(th, ph, o)
        c2, _ = hair_point(th + 0.001, ph, o)
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
            nn -= lat * lat / (2 * 0.18)
            verts.append(c + b * lat + n2 * nn)
            tvals.append(t)
    for i in range(len(path) - 1):
        for k in range(m):
            a0 = i * m + k; a1 = i * m + (k + 1) % m
            faces.append((a0, a1, a1 + m, a0 + m))
    faces.append(tuple(range(m))[::-1])
    last = (len(path) - 1) * m
    faces.append(tuple(range(last, last + m)))
    return verts, faces, tvals

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

for (phi_row, W, aa_min, L) in [(8, 0.07, 0, 0.07), (20, 0.08, 95, 0.09), (36, 0.075, 95, 0.095), (52, 0.07, 60, 0.095),
                                 (68, 0.065, 60, 0.085), (84, 0.06, 60, 0.075), (98, 0.06, 110, 0.07)]:
    ring(phi_row, W, aa_min, L)
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
for i, th in enumerate((56, 44, 32, 20, 8, -4, -16, -28, -40)):
    add_lock(th, hairline_phi(th) - 4, 0.11 + 0.012 * (i % 3), 0.08, 0.026, 0.006, tip_curl=0.008, wobble=0.15, seed=i)
for i, th in enumerate((14, 26, 38, 50, 2)):
    add_lock(th, 57, 0.11, 0.085, 0.03, 0.016 + 0.004 * i, tip_curl=0.012, wobble=0.1, seed=i + 3)
for th in (84, -84, 70, -70):
    add_lock(th, 75, 0.07, 0.06, 0.018, 0.002, seed=th)
for th in (136, 148, 160, 172, 184, 196, 208, 220, 232):
    add_lock(th, 100, 0.065, 0.06, 0.016, 0.001, seed=th)

locks = new_mesh_object("V9_hair_locks", LV, LF, [M_hair])
tattr = locks.data.attributes.new("t", 'FLOAT', 'POINT')
for i, t in enumerate(LT):
    tattr.data[i].value = t
bake_hair_color(locks, LT)
HAIR_LOCK_COUNT = sum(1 for f in LF if len(f) == 8) // 2

# ------------------------------------------------------------------------ garments
def drape_patch(name, u0, u1, nu, nv, z_top, z_bot, radial, mats, trim_rows=0, trim_cols=0, closed=False):
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

# tunic: V9 V-neck top, now continued to mid-thigh (shows in the robe opening below the belt)
TUNIC_BOT = 0.74
def tunic_top(u):
    a = abs(((u + 180) % 360) - 180)
    return 1.84 - 0.13 * smooth(45, 0, a)
def tunic_radial(u, z, v):
    return r_torso(u, z) + 0.006 + 0.007 * smooth(1.15, 0.74, z) * math.sin(deg(u * 7) + 0.4)
tunic = drape_patch("V9_tunic", -70, 70, 40, 24, tunic_top, lambda u: TUNIC_BOT + 0.008 * math.sin(deg(u * 5)),
                    tunic_radial, [M_tunic], closed=False)

# robe: V9 front opening and gold edge trim, continued as a full-length robe with a gold hem.
# Above the old cut the fold amplitude equals V9's; below it grows gently and the skirt flares.
OPEN = 17.0
ROBE_TOP = 1.83
def robe_hem(u):
    a = abs(((u + 180) % 360) - 180)
    return 0.30 - 0.06 * smooth(55, OPEN, a)
def robe_radial(u, z, v):
    fv = (ROBE_TOP - z) / (ROBE_TOP - CUT_Z)
    amp = 0.010 * min(fv, 1.0) ** 2 + 0.018 * max(0.0, fv - 1.0) / 2.3
    fold = amp * (0.6 * math.sin(deg(u * 6) + 0.7) + 0.4 * math.sin(deg(u * 11) + 1.3 + 0.7))
    flare = 0.08 * smooth(1.25, 0.28, z)
    return r_tdrape(u, z) + 0.014 + fold + flare
robe = drape_patch("V9_robe", OPEN, 360 - OPEN, 96, 30, lambda u: ROBE_TOP, robe_hem, robe_radial,
                   [M_violet, M_gold], trim_rows=1, trim_cols=1, closed=False)

# belt over the robe at the waist, with a gold buckle at the front
BELT_Z = 1.10
belt = drape_patch("V9_belt_band", 0, 360, 48, 2, lambda u: BELT_Z + 0.03, lambda u: BELT_Z - 0.03,
                   lambda u, z, v: robe_radial(u, z, v) + 0.006, [M_leather_dark], closed=True)

def buckle():
    R = robe_radial(0.0, BELT_Z, 0.5) + 0.006 + 0.004
    rad, side, up = Vector((0, 1, 0)), Vector((1, 0, 0)), Vector((0, 0, 1))
    c = rad * R + up * BELT_Z
    outer, inner = (0.040, 0.032), (0.026, 0.018)
    verts = []
    for layer in (0.0, 0.008):
        for (w, h) in (outer, inner):
            for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                verts.append(c + rad * layer + side * (sx * w) + up * (sz * h))
    faces = []
    for L in (0, 8):
        for i in range(4):
            faces.append((L + i, L + (i + 1) % 4, L + 4 + (i + 1) % 4, L + 4 + i))        # ring face
    for i in range(4):
        faces.append((i, (i + 1) % 4, 8 + (i + 1) % 4, 8 + i))                              # outer wall
        faces.append((4 + i, 4 + (i + 1) % 4, 12 + (i + 1) % 4, 12 + i))                    # inner wall
    ob = new_mesh_object("V9_buckle", verts, faces, [M_gold])
    for p in ob.data.polygons:
        p.use_smooth = False
    recalc_normals(ob)
    return ob
belt = join_objects("V9_belt", [belt, buckle()])

# leather satchel strap: V9 segment (character-right shoulder to the old cut) unchanged, then continued
# over the belt down to the satchel on the character-left hip
SATCHEL_U, SATCHEL_Z = -80.0, 1.00
def strap_patch():
    stations = []
    n = 40
    for i in range(n + 1):
        t = i / n
        stations.append((lerp(38, -45, t), lerp(1.70, CUT_Z - 0.01, t), 0.024))
    m = 16
    for i in range(1, m + 1):
        t = i / m
        u = lerp(-45, SATCHEL_U, 0.5 - 0.5 * math.cos(math.pi * t))
        z = lerp(CUT_Z - 0.01, SATCHEL_Z + 0.085, t)
        stations.append((u, z, 0.024 + 0.006 * smooth(0.0, 0.5, t)))
    verts, faces = [], []
    for i, (u, z, off) in enumerate(stations):
        r = r_tdrape(u, z) + off
        c = Vector((r * math.sin(deg(u)), r * math.cos(deg(u)), z))
        tdir = Vector((-math.cos(deg(u)), math.sin(deg(u)), 0)) * (-1 if True else 1)
        nrm = Vector((math.sin(deg(u)), math.cos(deg(u)), 0))
        wdir = (tdir * 0.35 + Vector((0, 0, 1))).normalized()
        wdir = (wdir - nrm * wdir.dot(nrm)).normalized()
        verts.append(c + wdir * 0.022); verts.append(c - wdir * 0.022)
        if i:
            a = (i - 1) * 2
            faces.append((a, a + 1, a + 3, a + 2))
    return new_mesh_object("V9_strap", verts, faces, [M_leather])
strap_patch()

# mantle (V9)
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

# hood (V9)
def hood_bot(u):
    return 1.53 + 0.10 * ((u - 180) / 50.0) ** 2
def hood_radial(u, z, v):
    uu = (u - 180) / 50.0
    dome = math.sin(math.pi * v) * max(0.0, 1 - uu * uu) ** 0.7
    return r_drape(u, z) + 0.046 + 0.05 * dome + folds(u, v, 0.008, 8, 13)
hood = drape_patch("V9_hood", 130, 230, 36, 18, lambda u: 1.90, hood_bot, hood_radial, [M_violet, M_gold], trim_rows=2, closed=False)

# standing collar (V9)
C0, C1 = 48.0, 312.0
def r_neck(u):
    return r_body(u, 1.84)
def collar_base(u):
    return 1.78
def collar_top(u):
    a = abs(((u + 180) % 360) - 180)
    top = lerp(1.91, 1.975, smooth(70, 180, a))
    end = min(u - C0, C1 - u)
    return lerp(collar_base(u) + 0.02, top, smooth(0, 26, end))
def collar_radial(u, z, v):
    a = abs(((u + 180) % 360) - 180)
    rb = r_neck(u) + lerp(0.042, 0.022, smooth(60, 180, a))
    return rb + 0.022 * (1 - v)
collar = drape_patch("V9_collar", C0, C1, 80, 8, collar_top, collar_base, collar_radial, [M_violet_dark, M_gold], closed=False)
for p in collar.data.polygons:
    j = p.index // 80
    p.material_index = 1 if j == 0 else 0

# cowl (V9)
def cowl_frame(u):
    a = abs(((u + 180) % 360) - 180)
    R_top = r_neck(u) + lerp(0.075, 0.028, smooth(40, 170, a))
    z_top = max(surf_z(u, R_top) + 0.004, lerp(1.785, 1.80, smooth(0, 180, a)))
    z_hang = lerp(1.625, 1.72, smooth(0, 150, a)) + 0.008 * math.sin(deg(u * 2) + 0.6)
    R_hang = r_drape(u, z_hang) + 0.034 + 0.004
    R_cap = R_top + 0.095
    if R_hang <= R_cap:
        R_bot = max(R_hang, R_top + 0.06)
        z_bot = max(z_hang, surf_z(u, R_bot) + 0.004)
    else:
        R_bot = R_cap
        z_bot = surf_z(u, R_bot) + 0.004
    return R_top, z_top, R_bot, z_bot

def cowl_point(u, v):
    R_top, z_top, R_bot, z_bot = cowl_frame(u)
    a = abs(((u + 180) % 360) - 180)
    r = lerp(R_top, R_bot, v) + lerp(0.010, 0.016, smooth(110, 0, a)) * math.sin(math.pi * v)
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
    bump += 0.008 * (0.5 - 0.5 * math.cos(math.pi * smooth(0.18, 0.0, v)))
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
    return new_mesh_object("V9_cowl", verts, faces, [M_violet])
cowl()

# brooch (V9)
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

# ------------------------------------------------------------------------ new: sleeves
ARM_SHOULDER, ARM_ELBOW, ARM_WRIST = (0.25, -0.07, 1.76), (0.42, -0.094, 1.41), (0.505, -0.045, 1.15)
def sleeve(sign):
    P0 = Vector((sign * ARM_SHOULDER[0], ARM_SHOULDER[1], ARM_SHOULDER[2]))
    P1 = Vector((sign * ARM_ELBOW[0], ARM_ELBOW[1], ARM_ELBOW[2]))
    P2 = Vector((sign * ARM_WRIST[0], ARM_WRIST[1], ARM_WRIST[2]))
    d1 = (P1 - P0).normalized(); d2 = (P2 - P1).normalized()
    L1 = (P1 - P0).length; L2 = (P2 - P1).length; L = L1 + L2; te = L1 / L
    def centre(t):
        s = t * L
        return P0 + d1 * s if s <= L1 else P1 + d2 * (s - L1)
    def tangent(t):
        return d1.lerp(d2, smooth(te - 0.12, te + 0.12, t)).normalized()
    def radius(t):
        arm = lerp(0.082, 0.064, smooth(0.05, te, t))
        arm = lerp(arm, 0.050, smooth(te, 1.0, t))
        bell = 0.060 * smooth(0.60, 1.0, t) ** 1.4
        cone = smooth(0.0, 0.16, t)
        return (arm + 0.016 + bell) * (0.15 + 0.85 * cone)
    NS, NR = 16, 16
    fwd = Vector((0, 1, 0))
    verts, faces, midx = [], [], []
    for j in range(NS + 1):
        t = j / NS
        c = centre(t) - d1 * 0.03 * (1 - smooth(0, 0.16, t))
        tan = tangent(t); r = radius(t)
        b = tan.cross(fwd).normalized(); n = b.cross(tan).normalized()
        for i in range(NR):
            a = 2 * math.pi * i / NR
            fold = 0.005 * math.sin(5 * a + 2.0 * t) * smooth(0.25, 0.9, t)
            verts.append(c + (b * math.cos(a) + n * math.sin(a)) * (r + fold))
    c = centre(1.0); tan = tangent(1.0); r = radius(1.0) - 0.016
    b = tan.cross(fwd).normalized(); n = b.cross(tan).normalized()
    for i in range(NR):
        a = 2 * math.pi * i / NR
        verts.append(c - tan * 0.004 + (b * math.cos(a) + n * math.sin(a)) * r)
    for j in range(NS + 1):
        for i in range(NR):
            a0 = j * NR + i; a1 = j * NR + (i + 1) % NR
            faces.append((a0, a1, a1 + NR, a0 + NR))
            midx.append(1 if j >= NS - 1 else 0)
    ob = new_mesh_object("V9_sleeve_%s" % ("R" if sign > 0 else "L"), verts, faces, [M_violet, M_gold], midx)
    recalc_normals(ob)
    return ob
sleeves = join_objects("V9_sleeves", [sleeve(1), sleeve(-1)])

# ------------------------------------------------------------------------ new: trousers and boots
LEG_NU, LEG_DZ = 56, 0.02
def leg_table(sign):
    cx, cy = sign * 0.122, -0.060
    pts = (Vector((v.co.x - cx, v.co.y - cy, v.co.z)) for v in me.vertices if 0.02 < sign * v.co.x < 0.30 and v.co.z < 1.03)   # 0.30 keeps the little toe (|x| up to 0.2355) inside the boot; hands hang beyond 0.45
    rt, _, nz = build_tables(pts, 0.0, 1.02, nu=LEG_NU, dz=LEG_DZ, top=1.02)
    return rt, nz, (cx, cy)

def leg_r(tab, u, z):
    rt, nz, _ = tab
    return _bilin(rt, u, z, 0.0, nz, nu=LEG_NU, dz=LEG_DZ)

def leg_tube(name, tab, z_top, z_bot, nrows, nsides, gap, mats, midx_fn=None, sole=False, lip=0.0, window=0.0):
    rt, nz, (cx, cy) = tab
    verts, faces, midx = [], [], []
    def ring_vert(u, z, r):
        return Vector((cx + r * math.sin(deg(u)), cy + r * math.cos(deg(u)), z))
    def wall_r(u, z):
        if not window:
            return leg_r(tab, u, z)
        # local gravity drape: the wall at z must clear the widest skin within `window` above it and a few degrees either side,
        # so the bilinear table never lets the heel or toe bulge poke through a ring interval
        step = (z_top - z_bot) / nrows
        return max(leg_r(tab, u + du, max(z_bot, min(z_top, z + dzz)))
                   for du in (-4.0, 0.0, 4.0) for dzz in (-step, -0.5 * step, 0.0, 0.02, 0.04, window))
    for j in range(nrows + 1):
        z = lerp(z_top, z_bot, j / nrows)
        for i in range(nsides):
            u = i * 360.0 / nsides
            verts.append(ring_vert(u, z, wall_r(u, z) + gap(z)))
    for j in range(nrows):
        for i in range(nsides):
            a0 = j * nsides + i; a1 = j * nsides + (i + 1) % nsides
            faces.append((a0, a1, a1 + nsides, a0 + nsides)); midx.append(midx_fn(j) if midx_fn else 0)
    if lip:
        base = len(verts)
        for i in range(nsides):
            u = i * 360.0 / nsides
            verts.append(ring_vert(u, z_top, wall_r(u, z_top) + gap(z_top) - lip))
        for i in range(nsides):
            faces.append((base + i, base + (i + 1) % nsides, (i + 1) % nsides, i)); midx.append(midx_fn(0) if midx_fn else 0)
    if sole:
        last = nrows * nsides
        verts.append(Vector((cx, cy, z_bot)))
        for i in range(nsides):
            faces.append((last + i, last + (i + 1) % nsides, len(verts) - 1)); midx.append(0)
    ob = new_mesh_object(name, verts, faces, mats, midx)
    recalc_normals(ob)
    return ob

legs = {1: leg_table(1), -1: leg_table(-1)}
BOOT_TOP = 0.47
trousers = join_objects("V9_trousers", [
    leg_tube("V9_trouser_%d" % s, legs[s], 1.00, 0.42, 8, 20, lambda z: 0.008, [M_trouser]) for s in (1, -1)])
boots = join_objects("V9_boots", [
    leg_tube("V9_boot_%d" % s, legs[s], BOOT_TOP, 0.0, 16, 28, lambda z: 0.010 + 0.014 * smooth(0.40, BOOT_TOP, z),
             [M_leather, M_leather_dark], midx_fn=lambda j: 1 if j < 2 else 0, sole=True, lip=0.02, window=0.06) for s in (1, -1)])

# ------------------------------------------------------------------------ new: satchel
def box(name, centre, half, frame, mat):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=2.0)
    for v in bm.verts:
        v.co = centre + frame[0] * (v.co.x * half[0]) + frame[1] * (v.co.y * half[1]) + frame[2] * (v.co.z * half[2])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free(); mesh.materials.append(mat)
    for p in mesh.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, mesh); COLL.objects.link(ob)
    return ob

def satchel():
    u = SATCHEL_U
    rad = Vector((math.sin(deg(u)), math.cos(deg(u)), 0.0)); up = Vector((0, 0, 1)); side = up.cross(rad).normalized()
    frame = (rad, side, up)
    R = robe_radial(u, SATCHEL_Z, 0.5)
    bag = box("V9_satchel_bag", rad * (R + 0.046) + up * SATCHEL_Z, (0.046, 0.100, 0.085), frame, M_leather)
    flap = box("V9_satchel_flap", rad * (R + 0.054) + up * (SATCHEL_Z + 0.047), (0.054, 0.104, 0.040), frame, M_leather_dark)
    clasp = box("V9_satchel_clasp", rad * (R + 0.054 + 0.054 + 0.004) + up * (SATCHEL_Z + 0.016), (0.005, 0.012, 0.014), frame, M_gold)
    ob = join_objects("V9_satchel", [bag, flap, clasp])
    bev = ob.modifiers.new("Bevel", 'BEVEL'); bev.width = 0.008; bev.segments = 2; bev.use_clamp_overlap = True
    bev.harden_normals = True
    return ob
satchel()

# ------------------------------------------------------------------------ eyes: join, drop the hidden back half
for eye in (eyeL, eyeR):
    bm = bmesh.new(); bm.from_mesh(eye.data)
    back = [f for f in bm.faces if f.normal.dot(Vector((0, 1, 0))) < -0.3]
    bmesh.ops.delete(bm, geom=back, context='FACES')
    bm.to_mesh(eye.data); bm.free(); eye.data.update()
    eye.data.transform(Matrix.Translation(eye.location)); eye.location = (0, 0, 0)
eyes = join_objects("V9_eyes", [eyeL, eyeR])

# ------------------------------------------------------------------------ feet: barefoot variant split off the base mesh
# Gameplay starts barefoot, so the CC0 body's own feet and lower shins (floor .. FEET_TOP) become a separate skinned
# object V9_feet. Runtime shows V9_feet when gear.boots is false and V9_boots when it is true; both are exported.
feet_mesh = body.data.copy(); feet_mesh.name = "V9_feet"
feet = bpy.data.objects.new("V9_feet", feet_mesh); COLL.objects.link(feet)
bm = bmesh.new(); bm.from_mesh(feet_mesh)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z >= FEET_TOP], context='FACES')
bm.to_mesh(feet_mesh); bm.free(); feet_mesh.update()
feet_mesh.materials.clear(); feet_mesh.materials.append(M_skin)
dec = feet.modifiers.new("Decimate", 'DECIMATE'); dec.ratio = 0.45; dec.use_collapse_triangulate = True   # base-mesh toes are dense; feet are mostly under the hem
FEET_BOUNDS = {"min": [round(min(v.co[i] for v in feet_mesh.vertices), 4) for i in range(3)],
               "max": [round(max(v.co[i] for v in feet_mesh.vertices), 4) for i in range(3)]}

# ------------------------------------------------------------------------ body: remove faces hidden under cloth
bm = bmesh.new(); bm.from_mesh(body.data)
hidden = []
for f in bm.faces:
    c = f.calc_center_median()
    if is_arm(c):
        if c.z > 1.30:                      # upper arm and elbow: under the sleeve and mantle
            hidden.append(f)
    elif c.z < 1.60:                        # torso below the cowl, legs and feet: under robe, trousers (feet live in V9_feet)
        hidden.append(f)
bmesh.ops.delete(bm, geom=hidden, context='FACES')
bm.to_mesh(body.data); bm.free(); body.data.update()

# ------------------------------------------------------------------------ rig (V2 bone names and hierarchy)
BONE_SPECS = [
    ("Root", None, (0, 0, 0.0), (0, 0, 0.12)),
    ("Hips", "Root", (0, -0.035, 0.93), (0, -0.025, 1.12)),
    ("Spine", "Hips", (0, -0.025, 1.12), (0, -0.035, 1.74)),
    ("Neck", "Spine", (0, -0.035, 1.74), (0, -0.02, 1.88)),
    ("Head", "Neck", (0, -0.02, 1.88), (0, -0.01, 2.26)),
]
for sign, side in ((-1, "L"), (1, "R")):
    BONE_SPECS.extend([
        (f"UpperArm.{side}", "Spine", (sign * 0.25, -0.07, 1.76), (sign * 0.42, -0.094, 1.41)),
        (f"Forearm.{side}", f"UpperArm.{side}", (sign * 0.42, -0.094, 1.41), (sign * 0.505, -0.045, 1.16)),
        (f"Hand.{side}", f"Forearm.{side}", (sign * 0.505, -0.045, 1.16), (sign * 0.52, -0.02, 0.92)),
        (f"Thigh.{side}", "Hips", (sign * 0.11, -0.035, 0.95), (sign * 0.121, -0.057, 0.50)),
        (f"Shin.{side}", f"Thigh.{side}", (sign * 0.121, -0.057, 0.50), (sign * 0.128, -0.06, 0.10)),
        (f"Foot.{side}", f"Shin.{side}", (sign * 0.128, -0.06, 0.10), (sign * 0.15, 0.17, 0.02)),
    ])
BONE_SEG = {n: (Vector(h), Vector(t)) for n, _, h, t in BONE_SPECS}
FALLOFF = {"Hips": (0.26, 0.22, 0.10), "Spine": (0.30, 0.24, 0.10), "Neck": (0.11, 0.11, 0.06), "Head": (0.30, 0.30, 0.20),
           "UpperArm": 0.10, "Forearm": 0.085, "Hand": 0.10, "Thigh": 0.14, "Shin": 0.13, "Foot": 0.12}

arm_data = bpy.data.armatures.new("WayfarerV9Humanoid")
RIG = bpy.data.objects.new("WayfarerV9Rig", arm_data)
COLL.objects.link(RIG)
bpy.context.view_layer.objects.active = RIG
RIG.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, parent, head, tail in BONE_SPECS:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = head, tail
    if parent:
        b.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
RIG.select_set(False)
for pb in RIG.pose.bones:
    pb.rotation_mode = 'XYZ'

def bone_weight(co, name):
    h, t = BONE_SEG[name]
    r = FALLOFF[name.split(".")[0]]
    ab = t - h
    l2 = ab.length_squared
    s = max(0.0, min(1.0, (co - h).dot(ab) / l2)) if l2 else 0.0
    p = co - (h + ab * s)
    if isinstance(r, tuple):
        d2 = (p.x / r[0]) ** 2 + (p.y / r[1]) ** 2 + (p.z / r[2]) ** 2
    else:
        d2 = p.length_squared / (r * r)
    return math.exp(-d2)

def skin(ob, allowed, max_inf=4):
    """Smooth distance-falloff skinning against bone segments; `allowed` is a list or a function of the vertex."""
    groups = {}
    for v in ob.data.vertices:
        names = allowed(v.co) if callable(allowed) else allowed
        ws = sorted(((bone_weight(v.co, n), n) for n in names), reverse=True)[:max_inf]
        tot = sum(w for w, _ in ws) or 1.0
        kept = [(w / tot, n) for w, n in ws if w / tot >= 0.02]
        tot2 = sum(w for w, _ in kept) or 1.0
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

skin(body, lambda co: ["Head"] if co.z > 1.92 else
     ["Head", "Neck", "Spine", "UpperArm.L", "UpperArm.R", "Forearm.L", "Forearm.R", "Hand.L", "Hand.R"])
for ob in (eyes, brows, shell, locks):
    skin(ob, ["Head"])
skin(collar, ["Neck", "Head", "Spine"])
skin(bpy.data.objects["V9_cowl"], ["Spine", "Neck"])
skin(bpy.data.objects["V9_brooch"], ["Spine", "Neck"])
skin(mantle, ["Spine", "Neck", "UpperArm.L", "UpperArm.R"])
skin(hood, ["Spine", "Neck", "UpperArm.L", "UpperArm.R"])
skin(tunic, ["Spine", "Hips", "Thigh.L", "Thigh.R"])
skin(robe, ["Spine", "Hips", "Thigh.L", "Thigh.R", "Shin.L", "Shin.R"])
skin(bpy.data.objects["V9_strap"], ["Spine", "Hips"])
skin(belt, ["Hips", "Spine"])
skin(bpy.data.objects["V9_satchel"], ["Hips"])
skin(sleeves, lambda co: ["UpperArm.%s" % side_of(co), "Forearm.%s" % side_of(co), "Spine"])
skin(trousers, lambda co: ["Hips", "Thigh.%s" % side_of(co), "Shin.%s" % side_of(co)])
skin(boots, lambda co: ["Shin.%s" % side_of(co), "Foot.%s" % side_of(co)])
skin(feet, lambda co: ["Thigh.%s" % side_of(co), "Shin.%s" % side_of(co), "Foot.%s" % side_of(co)])

# ------------------------------------------------------------------------ equipment sockets (V2 contract)
bpy.context.view_layer.update()
SOCKET_SPECS = [("Socket.RightHand", "Hand.R", (0.50, -0.02, 1.02)),
                ("Socket.LeftHand", "Hand.L", (-0.50, -0.02, 1.02)),
                ("Socket.Head", "Head", (0, -0.01, 2.30)),
                ("Socket.Chest", "Spine", (0, 0.22, 1.50)),
                ("Socket.Legs", "Hips", (0, 0, 0.90)),
                ("Socket.RightFoot", "Foot.R", (0.15, 0.19, 0.03)),
                ("Socket.LeftFoot", "Foot.L", (-0.15, 0.19, 0.03))]
SOCKETS = []
for name, bone, point in SOCKET_SPECS:
    empty = bpy.data.objects.new(name, None)
    COLL.objects.link(empty)
    empty.empty_display_type = 'PLAIN_AXES'
    empty.empty_display_size = 0.035
    empty.parent = RIG
    empty.parent_type = 'BONE'
    empty.parent_bone = bone
    bpy.context.view_layer.update()
    empty.matrix_world = Matrix.Translation(Vector(point))
    empty["role"] = "equipment_socket"
    SOCKETS.append(empty)

# ------------------------------------------------------------------------ animation clips: Idle, Walk, Turn
sc.render.fps = 24
ANIM_BONES = [n for n, _, _, _ in BONE_SPECS if n != "Root"]

def walk_pose(phase):
    ph = 2 * math.pi * phase; s = math.sin(ph)
    pose = {"Thigh.L": (0.32 * s, 0, 0), "Thigh.R": (-0.32 * s, 0, 0),
            "Shin.L": (-0.55 * max(0.0, math.sin(ph - math.pi - 0.3)), 0, 0),
            "Shin.R": (-0.55 * max(0.0, math.sin(ph - 0.3)), 0, 0),
            "UpperArm.L": (-0.22 * s, 0, 0), "UpperArm.R": (0.22 * s, 0, 0),
            "Forearm.L": (0.10 + 0.08 * max(0.0, -s), 0, 0), "Forearm.R": (0.10 + 0.08 * max(0.0, s), 0, 0),
            "Spine": (0.04, 0.06 * s, 0), "Head": (-0.03, -0.05 * s, 0), "Hips": (0, 0, 0.02 * s)}
    return pose, (0, 0.012 * math.cos(2 * ph) - 0.006, 0)

def idle_pose(phase):
    ph = 2 * math.pi * phase; s = math.sin(ph)
    pose = {"Spine": (0.02 + 0.015 * s, 0, 0), "Neck": (-0.01 * s, 0, 0), "Head": (-0.012 * s, 0.03 * math.sin(ph + 1.0), 0),
            "UpperArm.L": (0.015 * s, 0, -0.01 * s), "UpperArm.R": (0.015 * s, 0, 0.01 * s)}
    return pose, (0, 0.006 * s, 0)

def turn_pose(phase):
    yaw = 0.52 * smooth(0.0, 1.0, phase); st = math.sin(math.pi * phase)
    pose = {"Hips": (0, yaw, 0), "Head": (0, 0.25 * st, 0), "Spine": (0, 0.08 * st, 0),
            "Thigh.R": (0.18 * st, 0, 0), "Shin.R": (-0.30 * st, 0, 0), "UpperArm.L": (0.05 * st, 0, 0), "UpperArm.R": (-0.05 * st, 0, 0)}
    return pose, (0, 0.004 * st, 0)

CLIPS = [("Idle", 48, idle_pose, True), ("Walk", 24, walk_pose, True), ("Turn", 24, turn_pose, False)]
RIG.animation_data_create()
for clip_name, frames, pose_fn, loop in CLIPS:
    action = bpy.data.actions.new(clip_name)
    RIG.animation_data.action = action
    for f in range(1, frames + 2, 3):
        phase = (f - 1) / frames
        pose, hips_loc = pose_fn(phase)
        for name in ANIM_BONES:
            pb = RIG.pose.bones[name]
            pb.rotation_euler = pose.get(name, (0, 0, 0))
            pb.keyframe_insert(data_path="rotation_euler", frame=f, group=name)
        RIG.pose.bones["Hips"].location = hips_loc
        RIG.pose.bones["Hips"].keyframe_insert(data_path="location", frame=f, group="Hips")
    track = RIG.animation_data.nla_tracks.new()
    track.name = clip_name
    strip = track.strips.new(clip_name, 1, action)
    if hasattr(strip, "action_slot") and len(action.slots):
        strip.action_slot = action.slots[0]
    track.mute = True
RIG.animation_data.action = None
for pb in RIG.pose.bones:
    pb.rotation_euler = (0, 0, 0)
    pb.location = (0, 0, 0)

# ------------------------------------------------------------------------ camera rigs + lights (saved, not exported)
rig = bpy.data.objects.new("V9_RIG", None); COLL.objects.link(rig); rig.location = PIVOT
cam_data = bpy.data.cameras.new("V9_CAM"); cam_data.lens = CAM_LENS; cam_data.sensor_width = 36.0; cam_data.clip_start = 0.05
cam = bpy.data.objects.new("V9_CAM", cam_data); COLL.objects.link(cam); cam.parent = rig
cam.location = (0.0, CAM_DIST, 0.0); cam.rotation_euler = Euler((deg(90), 0, deg(180)), 'XYZ')
body_cam_data = bpy.data.cameras.new("V9G_CAM_BODY"); body_cam_data.type = 'ORTHO'; body_cam_data.ortho_scale = 2.62
body_cam_data.clip_start = 0.05; body_cam_data.clip_end = 50.0
body_cam = bpy.data.objects.new("V9G_CAM_BODY", body_cam_data); COLL.objects.link(body_cam); body_cam.parent = rig
body_cam.location = (0.0, 8.0, BODY_PIVOT.z - PIVOT.z); body_cam.rotation_euler = Euler((deg(90), 0, deg(180)), 'XYZ')
sc.camera = cam

def light(name, loc, energy, size, color, aim):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy = energy; ld.size = size; ld.color = color
    ob = bpy.data.objects.new(name, ld); COLL.objects.link(ob); ob.parent = rig; ob.location = loc
    ob.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob
BUST_LIGHTS = [light("V9_KEY", (-1.5, 2.0, 1.3), 170, 1.3, (1.0, 0.96, 0.9), (0, 0, 0)),
               light("V9_FILL", (1.9, 1.7, 0.3), 60, 2.2, (0.9, 0.94, 1.0), (0, 0, 0)),
               light("V9_RIM", (0.7, -1.6, 1.2), 110, 1.0, (1.0, 1.0, 1.0), (0, 0, 0))]
bz = BODY_PIVOT.z - PIVOT.z
BODY_LIGHTS = [light("V9G_KEY", (-3.6, 4.8, bz + 3.1), 1000, 3.1, (1.0, 0.96, 0.9), (0, 0, bz)),
               light("V9G_FILL", (4.6, 4.1, bz + 0.7), 350, 5.3, (0.9, 0.94, 1.0), (0, 0, bz)),
               light("V9G_RIM", (1.7, -3.8, bz + 2.9), 640, 2.4, (1.0, 1.0, 1.0), (0, 0, bz))]
for ob in BODY_LIGHTS:
    ob.hide_render = True
w = sc.world or bpy.data.worlds.new("V9_WORLD"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.42, 0.44, 1.0)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
sc.render.resolution_x = sc.render.resolution_y = 512; sc.render.resolution_percentage = 100
sc.render.engine = 'CYCLES'; sc.cycles.samples = 64; sc.cycles.use_denoising = True; sc.cycles.device = 'CPU'
sc.cycles.max_bounces = 4; sc.render.threads_mode = 'FIXED'; sc.render.threads = 4
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'; sc.render.film_transparent = False
sc.frame_start = 1; sc.frame_end = 48
sc.frame_set(1)

# ------------------------------------------------------------------------ save + export
MESHES = [ob for ob in COLL.objects if ob.type == 'MESH']
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
BLEND_SHA = sha256(OUT_BLEND)

bpy.ops.object.select_all(action='DESELECT')
for ob in [RIG, *MESHES, *SOCKETS]:
    ob.select_set(True)
bpy.context.view_layer.objects.active = RIG
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                          export_apply=True, export_animations=True, export_animation_mode='NLA_TRACKS',
                          export_extras=True, export_cameras=False, export_lights=False,
                          export_vertex_color='ACTIVE', export_image_format='NONE')   # only the hair meshes carry "Col"

# ------------------------------------------------------------------------ evaluated geometry report (Blender side)
dg = bpy.context.evaluated_depsgraph_get()
per_object = {}
eval_tris = 0
draw_groups = 0
for ob in MESHES:
    ev = ob.evaluated_get(dg)
    m = ev.to_mesh(); m.calc_loop_triangles()
    n = len(m.loop_triangles); used = {p.material_index for p in m.polygons}
    per_object[ob.name] = {"triangles": n, "materials": [ob.data.materials[i].name for i in sorted(used) if i < len(ob.data.materials)]}
    eval_tris += n; draw_groups += max(1, len(used))
    ev.to_mesh_clear()

# ------------------------------------------------------------------------ barefoot variant evidence (rest clearance + clip deformation)
from mathutils.bvhtree import BVHTree
def eval_coords(ob):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
    out = [v.co.copy() for v in m.vertices]; ev.to_mesh_clear(); return out
def rest_pose():
    # the glTF exporter steps through the NLA tracks; make the rest state explicit before measuring
    RIG.animation_data.action = None
    for t in RIG.animation_data.nla_tracks:
        t.mute = True
    for pb in RIG.pose.bones:
        pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
    RIG.update_tag(); bpy.context.view_layer.update()
    sc.frame_set(1); bpy.context.view_layer.update()
rest_pose()
dg = bpy.context.evaluated_depsgraph_get()
feet_rest = eval_coords(feet)
bev = boots.evaluated_get(dg); bm_boots = bmesh.new(); bm_boots.from_mesh(bev.to_mesh()); bev.to_mesh_clear()
boot_tree = BVHTree.FromBMesh(bm_boots)
clear = []; outside = 0; on_floor = 0; above_boot = 0; outside_z = []
for co in feet_rest:
    if co.z <= 0.005:
        on_floor += 1; continue          # sole points share the floor plane with the boot sole by design
    if co.z >= BOOT_TOP - 0.03:
        above_boot += 1; continue        # shin above the boot opening: legitimately outside, covered by the trouser tube
    loc, nrm, _, dist = boot_tree.find_nearest(co)
    clear.append(dist)
    if nrm.dot(co - loc) > 0:
        outside += 1; outside_z.append(round(co.z, 3))
bm_boots.free()
tev = trousers.evaluated_get(dg); bm_tr = bmesh.new(); bm_tr.from_mesh(tev.to_mesh()); tev.to_mesh_clear()
tr_tree = BVHTree.FromBMesh(bm_tr); shin_out = 0; shin_clear = []
for co in feet_rest:
    if 0.44 <= co.z < FEET_TOP - 0.005:
        loc, nrm, _, dist = tr_tree.find_nearest(co); shin_clear.append(dist)
        if nrm.dot(co - loc) > 0:
            shin_out += 1
bm_tr.free()
def clip_displacement(pose_fn, frames, frame):
    # apply the exact pose the clip keys at this frame (same functions that keyed the NLA actions), bypassing NLA evaluation,
    # which does not reliably re-evaluate on mute toggles inside one background session
    pose, hips_loc = pose_fn((frame - 1) / frames)
    for name in ANIM_BONES:
        RIG.pose.bones[name].rotation_euler = pose.get(name, (0, 0, 0))
    RIG.pose.bones["Hips"].location = hips_loc
    RIG.update_tag(); bpy.context.view_layer.update()
    moved = eval_coords(feet)
    d = {"L": 0.0, "R": 0.0}
    for a, b in zip(feet_rest, moved):
        d[side_of(a)] = max(d[side_of(a)], (b - a).length)
    rest_pose()
    return {k: round(v, 4) for k, v in d.items()}
feet_deform = {"Walk@frame7": clip_displacement(walk_pose, 24, 7), "Walk@frame19": clip_displacement(walk_pose, 24, 19),
               "Turn@frame13": clip_displacement(turn_pose, 24, 13)}
FOOTWEAR = {
    "barefootMesh": "V9_feet", "bootsMesh": "V9_boots",
    "runtimeRule": "show V9_feet when gear.boots is false, V9_boots when true; both nodes are exported visible",
    "feetSource": "CC0 base-mesh feet and lower shins below z=%.2f m, skinned to Thigh/Shin/Foot per side" % FEET_TOP,
    "feetBoundsBlender": FEET_BOUNDS,
    "feetVertices": len(feet_rest),
    "restClearanceToBootsMeters": {"min": round(min(clear), 4), "median": round(sorted(clear)[len(clear) // 2], 4),
                                   "verticesUnder2mm": sum(1 for d in clear if d < 0.002), "verticesOutsideBoots": outside,
                                   "outsideZRange": [min(outside_z), max(outside_z)] if outside_z else None,
                                   "soleVerticesOnFloorPlane": on_floor, "shinVerticesAboveBootOpening": above_boot,
                                   "zoneChecked": "0.005 < z < %.2f" % (BOOT_TOP - 0.03)},
    "restClearanceShinToTrousersMeters": {"min": round(min(shin_clear), 4) if shin_clear else None, "verticesOutsideTrousers": shin_out,
                                          "zoneChecked": "0.44 <= z < %.3f" % (FEET_TOP - 0.005)},
    "maxVertexDisplacementMeters": feet_deform,
}

# ------------------------------------------------------------------------ GLB structure validation (minimal parser)
def parse_glb(path):
    data = open(path, "rb").read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2, "not a GLB v2"
    off = 12; gltf = None; blob = None
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off); off += 8
        chunk = data[off:off + clen]; off += clen
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk)
        elif ctype == 0x004E4942:
            blob = chunk
    return gltf, blob, len(data)

gltf, blob, GLB_BYTES = parse_glb(OUT_GLB)
acc = gltf.get("accessors", [])
glb_tris = 0
pos_min = [1e9] * 3; pos_max = [-1e9] * 3
for mesh in gltf.get("meshes", []):
    for prim in mesh.get("primitives", []):
        mode = prim.get("mode", 4)
        count = acc[prim["indices"]]["count"] if "indices" in prim else acc[prim["attributes"]["POSITION"]]["count"]
        glb_tris += count // 3 if mode == 4 else 0
        a = acc[prim["attributes"]["POSITION"]]
        pos_min = [min(p, q) for p, q in zip(pos_min, a["min"])]; pos_max = [max(p, q) for p, q in zip(pos_max, a["max"])]

def node_matrix(n):
    if "matrix" in n:
        mm = n["matrix"]
        return Matrix([[mm[0], mm[4], mm[8], mm[12]], [mm[1], mm[5], mm[9], mm[13]], [mm[2], mm[6], mm[10], mm[14]], [mm[3], mm[7], mm[11], mm[15]]])
    t = Matrix.Translation(Vector(n.get("translation", (0, 0, 0))))
    q = n.get("rotation", (0, 0, 0, 1))
    r = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
    s = Matrix.Diagonal(Vector((*n.get("scale", (1, 1, 1)), 1)))
    return t @ r @ s

nodes = gltf.get("nodes", [])
world = [None] * len(nodes)
def walk(i, parent_m):
    world[i] = parent_m @ node_matrix(nodes[i])
    for c in nodes[i].get("children", []):
        walk(c, world[i])
for scene in gltf.get("scenes", []):
    for root_i in scene.get("nodes", []):
        walk(root_i, Matrix.Identity(4))
socket_nodes = {}
for i, n in enumerate(nodes):
    if n.get("name", "").startswith("Socket."):
        p = world[i].to_translation() if world[i] is not None else Vector((0, 0, 0))
        socket_nodes[n["name"]] = {"role": n.get("extras", {}).get("role"),
                                   "glbPosition": [round(p.x, 3), round(p.y, 3), round(p.z, 3)]}
skins = gltf.get("skins", [])
joint_names = [nodes[j]["name"] for j in skins[0]["joints"]] if skins else []
animations = {}
for a in gltf.get("animations", []):
    dur = max((acc[s["input"]]["max"][0] for s in a.get("samplers", [])), default=0.0)
    animations[a["name"]] = {"channels": len(a.get("channels", [])), "durationSeconds": round(dur, 3)}
ext_used = gltf.get("extensionsUsed", [])
checks = {
    "clipsIdleWalkTurn": set(animations) == {"Idle", "Walk", "Turn"},
    "oneSkinWith17Joints": len(skins) == 1 and len(joint_names) == 17,
    "jointNamesMatchV2": set(joint_names) == {n for n, _, _, _ in BONE_SPECS},
    "sevenSocketsWithRole": len(socket_nodes) == 7 and all(v["role"] == "equipment_socket" for v in socket_nodes.values()),
    "noCameras": "cameras" not in gltf,
    "noLights": "KHR_lights_punctual" not in ext_used,
    "floorAtZero": abs(pos_min[1]) < 0.005,
    "heightInRange": 2.1 <= (pos_max[1] - pos_min[1]) <= 2.4,
}
eye_mesh = next((m for m in gltf.get("meshes", []) if m.get("name") == "V9_eyes"), None)
checks["forwardIsNegativeZ"] = bool(eye_mesh) and all(
    acc[p["attributes"]["POSITION"]]["max"][2] < 0 for p in eye_mesh["primitives"])   # the eyes sit entirely on the -Z side
height = pos_max[1] - pos_min[1]
GLB_SHA = sha256(OUT_GLB)

v3 = json.load(open(V3_MANIFEST)) if os.path.exists(V3_MANIFEST) else {}
v9_src = {}
for fn, expected in V9_APPROVED_SHA256.items():
    p = os.path.join(V9_APPROVED, fn)
    v9_src[fn] = sha256(p) if os.path.exists(p) else None
    if v9_src[fn] != expected:
        raise RuntimeError("approved V9 source mismatch: %s %s != %s" % (fn, v9_src[fn], expected))
checks["feetAndBootsExported"] = {"V9_feet", "V9_boots"} <= {m.get("name") for m in gltf.get("meshes", [])}
checks["feetOnFloor"] = FEET_BOUNDS["min"][2] <= 0.005
checks["feetInsideBoots"] = outside == 0 and min(clear) >= 0.002
checks["feetDeformInWalkTurn"] = all(v > 0.01 for d in feet_deform.values() for v in d.values())
v2_blend = os.path.join(V2_DIR, "wayfarer_v2_male.blend")

manifest = {
    "status": "v9_playable_candidate_exported_runtime_inspection_pending",
    "gender": "male",
    "asset": {"glb": "wayfarer_v9_male.glb", "blend": "wayfarer_v9_male.blend", "authoring": "author_v9_game.py",
              "renders": "render_v9_game.py", "sheets": "contact_sheet_v9_game.py"},
    "designReference": "../../concepts/wayfarer-male-concept-v4.png",
    "approvedVisualTarget": {
        "description": "Bottom V9 row of wayfarer_v9_staging/comparison_vs_reference.png (user-approved head/shoulders sculpt). "
                       "The middle V10 row is rejected. Head, face and hair are not redesigned here.",
        "approvedDirectory": "../wayfarer_v9_approved",
        "approvedSha256": v9_src,
        "approvedSha256Verified": True,
        "copiedFrom": V9_STAGING_ORIGIN,
        "portedFromAuthorV9": ["head widening / jaw squaring / lid ease", "V9_brows", "V9_hair_shell", "V9_hair_locks (124)",
                               "V9_tunic top", "V9_robe opening and gold trim", "V9_strap shoulder segment", "V9_mantle",
                               "V9_hood", "V9_collar", "V9_cowl", "V9_brooch", "V9 materials and palette"],
    },
    "provenance": {
        "baseMesh": {
            "publisher": v3.get("source", {}).get("publisher", "Blender Studio and community contributions"),
            "title": v3.get("source", {}).get("title", "Human Base Meshes"),
            "version": v3.get("source", {}).get("version", "1.4.1"),
            "collection": v3.get("source", {}).get("selectedCollection", "Body Male - Stylized"),
            "license": v3.get("source", {}).get("license", "CC0"),
            "licenseEvidence": v3.get("source", {}).get("licenseEvidence"),
            "bundleSha256": v3.get("source", {}).get("localBundleSHA256"),
            "stagedBlend": "../wayfarer_v3_staging/wayfarer_v3_artist_staging.blend",
            "stagedBlendSha256": sha256(SRC),
            "howUsed": "opened read-only and saved-as into this directory; body and eye meshes kept with the V9 head edits, "
                       "drivers/vertex groups cleared, materials replaced, faces hidden under cloth deleted, uncut (no bust seam)",
        },
        "rigReference": {"path": "../wayfarer_v2/wayfarer_v2_male.blend", "sha256": sha256(v2_blend) if os.path.exists(v2_blend) else None,
                         "reuse": "17 deform-bone names/hierarchy, seven socket names with role extras, Idle/Walk/Turn NLA clip layout; "
                                  "no V2 geometry, materials or weights are used"},
        "authoredHere": ["full-length V9_robe", "V9_sleeves", "V9_belt (+buckle)", "V9_trousers", "V9_boots", "V9_feet (barefoot variant, split from the CC0 body)", "V9_satchel",
                         "V9_strap hip extension", "distance-falloff skinning", "Idle/Walk/Turn clips", "sockets", "camera/light rigs"],
        "thirdPartyPixelsOrMeshes": "none beyond the CC0 base mesh; concept sheets are visual targets only",
        "license": "Derived asset: CC0 base mesh plus original Wizard Realms geometry, materials and rig authored in-repo.",
    },
    "sourceAxes": {"up": "+Z", "forward": "+Y", "origin": "floor between feet"},
    "glbAxes": {"up": "+Y", "forward": "-Z", "origin": "floor between feet"},
    "boundsMetersGlb": {"min": [round(x, 4) for x in pos_min], "max": [round(x, 4) for x in pos_max]},
    "boundsMetersBlender": {"min": [round(pos_min[0], 4), round(-pos_max[2], 4), round(pos_min[1], 4)],
                            "max": [round(pos_max[0], 4), round(-pos_min[2], 4), round(pos_max[1], 4)]},
    "heightMeters": round(height, 4),
    "deformBones": [n for n, _, _, _ in BONE_SPECS],
    "equipmentSockets": socket_nodes,
    "animationClips": animations,
    "footwearVariants": FOOTWEAR,
    "meshObjects": len(MESHES),
    "drawGroups": draw_groups,
    "materialCount": len(gltf.get("materials", [])),
    "exportedMeshes": len(gltf.get("meshes", [])),
    "trianglesEvaluated": eval_tris,
    "trianglesGlb": glb_tris,
    "perObject": per_object,
    "hairLocks": HAIR_LOCK_COUNT,
    "glbBytes": GLB_BYTES,
    "sha256": {"glb": GLB_SHA, "blend": BLEND_SHA},
    "glbChecks": checks,
    "glbStructureValid": all(checks.values()),
    "budget": {"targetTriangles": 40000, "targetDrawGroups": 32, "targetGlbBytes": 5 * 1024 * 1024,
               "trianglesMet": glb_tris <= 40000, "drawGroupsMet": draw_groups <= 32, "glbBytesMet": GLB_BYTES <= 5 * 1024 * 1024},
    "compromises": [
        "No Subdivision or Solidify on the game mesh (V9 bust renders used subsurf render level 2 at 300k triangles); cloth is "
        "single-sided sheets with double-sided materials, brows and brooch keep a small Solidify.",
        "Procedural bump, sheen, coat and subsurface shader detail does not export to glTF; flat PBR factors only. The hair "
        "root-to-tip gradient is baked to vertex colours (COLOR_0).",
        "Below the mantle the robe is torso-fitted with separate sleeves; the V9 bust robe wrapped the arms as a poncho.",
        "Skinning is smooth distance falloff, tuned for the Idle/Walk/Turn amplitudes, not hand-painted weights.",
        "V9_feet and V9_boots are both exported visible; the runtime must toggle them (feet sole and boot sole share the floor plane).",
    ],
    "peakProcessMemoryMB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1),
    "authorSeconds": round(time.time() - T0, 2),
    "blender": bpy.app.version_string,
    "command": "blender -b -t 4 --factory-startup --python author_v9_game.py",
    "scopeGuards": {"editsOutsideThisDirectory": "only byte-identical copies added to ../wayfarer_v9_approved", "github": False,
                    "commit": False, "previewPorts": False, "gameSave": False, "v3DirectoryModified": False, "v9StagingModified": False},
}
with open(OUT_MANIFEST, "w") as f:
    json.dump(manifest, f, indent=1)
print("AUTHOR_DONE", json.dumps({k: manifest[k] for k in ("trianglesGlb", "trianglesEvaluated", "drawGroups", "materialCount",
                                                           "glbBytes", "heightMeters", "glbStructureValid", "glbChecks",
                                                           "peakProcessMemoryMB", "authorSeconds")}))
