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
Walk / Turn clips, GLB export with +Y up / -Z forward, GLB structure validation and the manifest. Later additions:
Run, TurnLeft/TurnRight, Jump, Chop/Dig/Mine/Cast work actions, the dormant GripRight morph, and riding
(RideIdle/RideWalk/RideRun seated clips plus the RideDrape robe/tunic morph) authored against ../../creatures/sedgehorn_mount.

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

# ------------------------------------------------------------------------ rejected right-hand grip experiment: shape key "GripRight"
# Basis is the accepted open hand (weight 0). This alternate shape key remains exported as dormant historical work;
# the user rejected its closed wrist/finger pose. Game and workbench must leave its influence at 0 for every tool.
# The following geometry is retained for export reproducibility, not as an instruction to activate the morph.
import numpy as np
GRIP_R = 0.0275             # fit radius: axe/pick/spade shafts are 0.045..0.055 m thick; wand/staff 0.035..0.05 sits 3..8 mm looser
GRIP_TILT = 20.0            # handle axis leans this far forward of vertical in the rest pose
GRIP_WRIST = 70.0           # wrist extension (degrees), ramped over the first 5 cm below the wrist
hand_idx = [v.index for v in body.data.vertices if v.co.x > 0.36 and v.co.z < 1.20]
HP = np.array([body.data.vertices[i].co[:] for i in hand_idx])
W = Vector(HP[(HP[:, 2] > 1.14) & (HP[:, 2] < 1.18)].mean(0))                        # wrist centre
_, _, Vt = np.linalg.svd(HP - HP.mean(0), full_matrices=False)
f_hand = Vector(Vt[0]); f_hand = -f_hand if f_hand.z > 0 else f_hand                  # fingers point down
n_palm = Vector(Vt[2]); n_palm = n_palm if n_palm.x < 0 else -n_palm                  # palm faces the body (medial)
k_hand = f_hand.cross(n_palm).normalized()
rel = HP - np.array(HP.mean(0)); s_all = rel @ np.array(f_hand); u_all = rel @ np.array(k_hand)
mid = np.abs(s_all) < 0.03
if -u_all[mid].min() > u_all[mid].max():
    k_hand = -k_hand; u_all = -u_all                                                  # thumb side is +k
S_W = (HP - np.array(W)) @ np.array(f_hand)                                           # distance below the wrist
thumb = (u_all > 0.075) & (S_W < 0.17)
rot_sign = 1.0 if (Matrix.Rotation(deg(90), 4, n_palm) @ f_hand).y > 0 else -1.0     # fingers swing forward
def wrist_rotated(co, sw):
    return W + Matrix.Rotation(rot_sign * deg(GRIP_WRIST) * smooth(0.0, 0.05, sw), 4, n_palm) @ (Vector(co) - W)
f_ext = (Matrix.Rotation(rot_sign * deg(GRIP_WRIST), 4, n_palm) @ f_hand).normalized()
g_axis = Vector((0.0, math.sin(deg(GRIP_TILT)), math.cos(deg(GRIP_TILT))))           # handle axis (world, rest pose)
m_c = (-n_palm - g_axis * (-n_palm).dot(g_axis)).normalized()                         # from the handle toward the back of the hand
f_c = g_axis.cross(m_c).normalized()
if f_c.dot(f_ext) < 0:
    f_c = -f_c
S_K = 0.146                                                                           # knuckle line below the wrist
palm_pts = [wrist_rotated(HP[j], S_W[j]) for j in range(len(hand_idx)) if S_K - 0.04 < S_W[j] < S_K and not thumb[j]]
K = sum(palm_pts, Vector()) / len(palm_pts)                                           # local hand centre at the knuckles
K = K - f_c * (K - W).dot(f_c) + f_c * S_K                                            # ...kept on the knuckle plane
t_palm = max((p - K).dot(n_palm) for p in palm_pts)                                   # palm-side half thickness at the knuckles
finger_pts = [wrist_rotated(HP[j], S_W[j]) for j in range(len(hand_idx)) if S_W[j] > S_K + 0.03 and not thumb[j]]
Kf = sum(finger_pts, Vector()) / len(finger_pts)                                      # finger mid-line centre
t_finger = max((p - Kf).dot(n_palm) for p in finger_pts)                              # finger palm-side half thickness
def grip_deform(rho_a, rho_f):
    """Curl the fingers around the handle axis placed rho_a from the palm mid-plane, finger mid-line at radius rho_f."""
    A = K + n_palm * rho_a
    d_f0 = (Kf - A).dot(m_c)                                                          # finger mid-line distance before the curl
    out = []
    for j in range(len(hand_idx)):
        v = wrist_rotated(HP[j], S_W[j])
        if not thumb[j]:
            sp = (v - K).dot(f_c)
            if sp > 0:
                theta = min(sp / rho_f, 2.6)
                d = (v - A).dot(m_c) - (d_f0 - rho_f) * smooth(0.0, 0.4, theta)
                u = (v - A).dot(g_axis)
                v = A + g_axis * u + d * (m_c * math.cos(theta) + f_c * math.sin(theta))
        r_vec = (v - A) - g_axis * (v - A).dot(g_axis)
        if r_vec.length < GRIP_R + 0.002:                                             # never let skin sit inside the handle
            v = v + r_vec.normalized() * (GRIP_R + 0.002 - r_vec.length)
        out.append(v)
    return A, d_f0, out
def radial_of(A, coords):
    return [((v - A) - g_axis * (v - A).dot(g_axis)).length for v in coords]
# pass 1 from the measured thicknesses, then tighten by the measured palm/finger slack (the clamp keeps skin outside the handle)
rho_a = GRIP_R + t_palm + 0.003
rho_f = GRIP_R + t_finger + 0.002
A_grip, d_f0, grip_co = grip_deform(rho_a, rho_f)
r1 = radial_of(A_grip, grip_co)
slack_palm = min(r1[j] for j in range(len(hand_idx)) if S_K - 0.04 < S_W[j] < S_K and not thumb[j]) - (GRIP_R + 0.003)
slack_finger = min(r1[j] for j in range(len(hand_idx)) if S_W[j] > S_K + 0.02 and not thumb[j]) - (GRIP_R + 0.002)
rho_a -= max(0.0, slack_palm); rho_f -= max(0.0, slack_finger)
A_grip, d_f0, grip_co = grip_deform(rho_a, rho_f)
body.shape_key_add(name="Basis", from_mix=False)
grip_key = body.shape_key_add(name="GripRight", from_mix=False)
for i, v in zip(hand_idx, grip_co):
    grip_key.data[i].co = v
grip_key.value = 0.0
radial = radial_of(A_grip, grip_co)
finger_radial = sorted(r for r, j in zip(radial, range(len(hand_idx))) if S_W[j] > S_K + 0.02 and not thumb[j])
palm_radial = sorted(r for r, j in zip(radial, range(len(hand_idx))) if S_K - 0.04 < S_W[j] < S_K and not thumb[j])
thumb_radial = sorted(r for r, j in zip(radial, range(len(hand_idx))) if thumb[j])
def pct(a, q):
    return round(a[min(len(a) - 1, int(q * len(a)))], 4)
GRIP = {
    "node": "V9_body", "morphTarget": "GripRight", "basisWeight": 0.0, "grippedWeight": 1.0,
    "usageStatus": "rejected_dormant", "runtimeWeight": 0.0,
    "usageNote": "User rejected the closed GripRight pose. Game and workbench keep the original open Basis hand at weight 0 for every tool; never activate this morph.",
    "fitRadiusMeters": GRIP_R, "wristExtensionDeg": GRIP_WRIST, "handleTiltForwardDeg": GRIP_TILT,
    "handleAxisBlender": {"point": [round(x, 4) for x in A_grip], "direction": [round(x, 4) for x in g_axis]},
    "handleAxisGlb": {"point": [round(A_grip.x, 4), round(A_grip.z, 4), round(-A_grip.y, 4)],
                      "direction": [round(g_axis.x, 4), round(g_axis.z, 4), round(-g_axis.y, 4)]},
    "handVertices": len(hand_idx), "thumbVertices": int(thumb.sum()),
    "measuredMeters": {"palmHalfThickness": round(t_palm, 4), "fingerHalfThickness": round(t_finger, 4),
                       "pass1SlackPalm": round(slack_palm, 4), "pass1SlackFinger": round(slack_finger, 4),
                       "axisFromPalmMidPlane": round(rho_a, 4), "fingerWrapRadius": round(rho_f, 4), "fingerMidLineBeforeCurl": round(d_f0, 4)},
    "skinToHandleAxisMeters": {"min": round(min(radial), 4), "verticesInsideHandle": sum(1 for r in radial if r < GRIP_R),
                               "fingerVerticesTouching(<=R+5mm)": sum(1 for r in finger_radial if r <= GRIP_R + 0.005),
                               "fingerRadialP0_P10_P50": [pct(finger_radial, 0), pct(finger_radial, 0.1), pct(finger_radial, 0.5)],
                               "palmRadialP0_P10_P50": [pct(palm_radial, 0), pct(palm_radial, 0.1), pct(palm_radial, 0.5)],
                               "thumbRadialP0_P10": [pct(thumb_radial, 0), pct(thumb_radial, 0.1)],
                               "fingerWrapDeg": round(math.degrees(2.6))},
}

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

# ------------------------------------------------------------------------ right-hand finger bones (approved ToolGrip follow-up)
# Ten child bones of Hand.R: two per finger (knuckle -> PIP, PIP -> tip) and two for the thumb (CMC -> MCP, MCP -> tip). They are
# deform bones so the exported skin can curl the fingers, but no on-foot or ride clip keys them: at rest they carry Hand.R's own
# transform, so the approved open hand and every existing clip deform exactly as before (verified below and in the GLB checks).
# Landmarks come from the hand mesh itself: the four fingers are the connected tubes below the finger web, the thumb is the
# lateral (+k) lobe of the palm block. Roll: local +Z points to the palm side, so rotation about local +X curls toward the palm.
_hand_pos = {vi: j for j, vi in enumerate(hand_idx)}
_hand_adj = {j: [] for j in range(len(hand_idx))}
for e in body.data.edges:
    a, b = e.vertices
    if a in _hand_pos and b in _hand_pos:
        _hand_adj[_hand_pos[a]].append(_hand_pos[b]); _hand_adj[_hand_pos[b]].append(_hand_pos[a])
U_W = (HP - np.array(W)) @ np.array(k_hand)                                           # across the hand, + toward the thumb
N_W = (HP - np.array(W)) @ np.array(n_palm)                                           # + toward the palm side
def _hand_components(mask):
    seen = set(); comps = []
    for s in np.where(mask)[0]:
        if s in seen:
            continue
        stack = [s]; seen.add(s); comp = []
        while stack:
            x = stack.pop(); comp.append(x)
            for y in _hand_adj[x]:
                if mask[y] and y not in seen:
                    seen.add(y); stack.append(y)
        comps.append(np.array(comp))
    return comps
FINGER_WEB = 0.15                                                                     # below this distance from the wrist the fingers are separate tubes
FINGER_MCP = FINGER_WEB - 0.015                                                       # knuckle joints sit 1.5 cm above the web
FINGER_NAMES = ["Index", "Middle", "Ring", "Pinky"]
_fcomps = sorted(_hand_components(S_W > FINGER_WEB), key=lambda c: -U_W[c].mean())
assert len(_fcomps) == 4, "expected four finger tubes below the web, found %d" % len(_fcomps)
_thumb_comp = max(_hand_components((U_W > 0.07) & (S_W > 0.02) & (S_W < 0.17)), key=len)
FINGER_COMP = dict(zip(FINGER_NAMES, _fcomps)); FINGER_COMP["Thumb"] = _thumb_comp
FINGER_U = {n: float(U_W[c][(S_W[c] > FINGER_WEB) & (S_W[c] < FINGER_WEB + 0.03)].mean()) for n, c in zip(FINGER_NAMES, _fcomps)}
def _hand_point(s, u, nn):
    return Vector(W) + f_hand * s + k_hand * u + n_palm * nn
def _centre(mask):
    return float(U_W[mask].mean()), float(N_W[mask].mean())
FINGER_JOINTS = {}                                                                    # name -> (mcp_s, pip_s, tip_s, head, mid, tip) in rest world space
for name, comp in zip(FINGER_NAMES, _fcomps):
    cm = np.zeros(len(hand_idx), bool); cm[comp] = True
    tip_s = float(S_W[comp].max())
    pip_s = FINGER_MCP + 0.45 * (tip_s - FINGER_MCP)                                  # proximal phalanx 45 % of knuckle-to-tip; middle+distal share one bone
    strip = (np.abs(U_W - FINGER_U[name]) < 0.02) & (U_W < 0.07)
    u0, n0 = _centre(strip & (np.abs(S_W - FINGER_MCP) < 0.012))
    u1, n1 = _centre(cm & (np.abs(S_W - pip_s) < 0.012))
    u2, n2 = _centre(cm & (S_W > tip_s - 0.015))
    FINGER_JOINTS[name] = (FINGER_MCP, pip_s, tip_s, _hand_point(FINGER_MCP, u0, n0), _hand_point(pip_s, u1, n1), _hand_point(tip_s, u2, n2))
_tm = np.zeros(len(hand_idx), bool); _tm[_thumb_comp] = True
THUMB_CMC, THUMB_MCP = 0.03, 0.085                                                    # along the hand from the wrist
_thumb_tip_s = float(S_W[_thumb_comp].max())
_tu0, _tn0 = _centre(_tm & (S_W < THUMB_CMC + 0.025))
_tu1, _tn1 = _centre(_tm & (np.abs(S_W - THUMB_MCP) < 0.012))
_tu2, _tn2 = _centre(_tm & (S_W > _thumb_tip_s - 0.015))
FINGER_JOINTS["Thumb"] = (THUMB_CMC, THUMB_MCP, _thumb_tip_s, _hand_point(THUMB_CMC, _tu0 - 0.01, _tn0 - 0.01),
                          _hand_point(THUMB_MCP, _tu1, _tn1), _hand_point(_thumb_tip_s, _tu2, _tn2))
THUMB_CURL_DIR = (-k_hand + n_palm).normalized()                                      # thumb flexes toward the fingers and the palm side
FINGER_SPECS = []                                                                     # (name, parent, head, tail, roll target)
for name in FINGER_NAMES + ["Thumb"]:
    _, _, _, h, m, t = FINGER_JOINTS[name]
    curl = THUMB_CURL_DIR if name == "Thumb" else n_palm
    FINGER_SPECS.append(("%s1.R" % name, "Hand.R", h, m, curl))
    FINGER_SPECS.append(("%s2.R" % name, "%s1.R" % name, m, t, curl))
FINGER_BONES = [n for n, *_ in FINGER_SPECS]
bpy.ops.object.mode_set(mode='EDIT')
for name, parent, head, tail, roll_target in FINGER_SPECS:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = head, tail
    b.parent = arm_data.edit_bones[parent]
    b.align_roll(roll_target)
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

# Finger weights are carved out of each hand vertex's existing Hand.R share only (Hand.R + finger bones = the old Hand.R weight;
# Forearm.R/Spine shares untouched), so with the finger bones at rest the skinning is identical to the approved export.
# Membership: finger tubes by mesh connectivity below the web, nearest finger centre across the knuckle band, thumb lobe by
# connectivity; smooth ramps into Hand.R above the knuckles and between the two segments. Influences stay at four or fewer:
# where a vertex already has three body bones and would need both segments, the smaller segment share folds into the larger.
FINGER_WEIGHT_STATS = {"verticesWeighted": 0, "hardSegmentSplits": 0, "maxInfluences": 0, "perBone": {}}
_finger_comp_sets = {n: set(c.tolist()) for n, c in FINGER_COMP.items()}
def finger_membership(j):
    """-> (finger name or None, ramp into the finger from Hand.R, split from segment 1 to segment 2)."""
    s = S_W[j]
    if _tm[j]:
        return "Thumb", smooth(THUMB_CMC - 0.01, THUMB_CMC + 0.03, s), smooth(THUMB_MCP - 0.012, THUMB_MCP + 0.012, s)
    if s > FINGER_WEB:
        name = next((n for n in FINGER_NAMES if j in _finger_comp_sets[n]), None)
    elif s < FINGER_MCP - 0.02 or U_W[j] > 0.07:
        name = None
    else:
        name = min(FINGER_NAMES, key=lambda n: abs(U_W[j] - FINGER_U[n]))
    if name is None:
        return None, 0.0, 0.0
    pip_s = FINGER_JOINTS[name][1]
    return name, smooth(FINGER_MCP - 0.015, FINGER_MCP + 0.015, s), smooth(pip_s - 0.012, pip_s + 0.012, s)
hand_vg = body.vertex_groups["Hand.R"]
finger_vgs = {n: body.vertex_groups.new(name=n) for n in FINGER_BONES}
for j, vi in enumerate(hand_idx):
    name, ramp, split = finger_membership(j)
    if name is None or ramp <= 0.0:
        continue
    v = body.data.vertices[vi]
    existing = {body.vertex_groups[g.group].name: g.weight for g in v.groups}
    w_hand = existing.get("Hand.R", 0.0)
    if w_hand <= 0.0:
        continue
    w_f = w_hand * ramp
    w1, w2 = w_f * (1.0 - split), w_f * split
    others = len([g for g in existing if g != "Hand.R"]) + (1 if w_hand - w_f > 1e-6 else 0)
    if w1 > 1e-6 and w2 > 1e-6 and others + 2 > 4:
        FINGER_WEIGHT_STATS["hardSegmentSplits"] += 1
        if w1 >= w2:
            w1, w2 = w_f, 0.0
        else:
            w1, w2 = 0.0, w_f
    if w_hand - w_f > 1e-6:
        hand_vg.add([vi], w_hand - w_f, 'REPLACE')
    else:
        hand_vg.remove([vi])
    for bone_n, w in (("%s1.R" % name, w1), ("%s2.R" % name, w2)):
        if w > 1e-6:
            finger_vgs[bone_n].add([vi], w, 'REPLACE')
            FINGER_WEIGHT_STATS["perBone"][bone_n] = FINGER_WEIGHT_STATS["perBone"].get(bone_n, 0) + 1
    FINGER_WEIGHT_STATS["verticesWeighted"] += 1
    FINGER_WEIGHT_STATS["maxInfluences"] = max(FINGER_WEIGHT_STATS["maxInfluences"], len(body.data.vertices[vi].groups))
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

# ------------------------------------------------------------------------ animation clips: Idle, Walk, Run, Turn (legacy), TurnLeft, TurnRight, Jump
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

def run_pose(phase):
    # in-place run, 0.75 s cycle: longer stride with a forward lean, high heel kick in the back swing, elbows held
    # bent with a strong counter-swing, pelvis/spine counter-rotation and a flight-phase rise at maximum leg split
    ph = 2 * math.pi * phase; s = math.sin(ph)
    kick_l = max(0.0, -math.sin(ph - 0.5)); kick_r = max(0.0, math.sin(ph - 0.5))
    # bone-local X: Thigh + = hip flexion, Shin - = knee flexion, Foot + = toes up, Spine/Head + = lean back (probed on the rig)
    pose = {"Thigh.L": (0.15 + 0.75 * s, 0, 0), "Thigh.R": (0.15 - 0.75 * s, 0, 0),
            "Shin.L": (-(0.15 + 1.15 * kick_l), 0, 0), "Shin.R": (-(0.15 + 1.15 * kick_r), 0, 0),
            "Foot.L": (0.55 * kick_l + 0.60 * max(0.0, -s) + 0.45 * max(0.0, s), 0, 0),    # toes up through toe-off and knee drive
            "Foot.R": (0.55 * kick_r + 0.60 * max(0.0, s) + 0.45 * max(0.0, -s), 0, 0),
            "UpperArm.L": (-0.05 - 0.45 * s, 0, 0), "UpperArm.R": (-0.05 + 0.45 * s, 0, 0),   # 0.45 keeps the sleeve top under the mantle
            "Forearm.L": (1.15 + 0.25 * max(0.0, -s), 0, 0), "Forearm.R": (1.15 + 0.25 * max(0.0, s), 0, 0),
            "Hips": (0, -0.08 * s, 0.03 * s), "Spine": (-0.14 - 0.02 * math.cos(2 * ph), 0.14 * s, 0),
            "Neck": (0.04, 0, 0), "Head": (0.09, -0.05 * s, 0)}
    return pose, (0, 0.020 - 0.025 * math.cos(2 * ph), 0)

def turn_pose(phase):
    yaw = 0.52 * smooth(0.0, 1.0, phase); st = math.sin(math.pi * phase)
    pose = {"Hips": (0, yaw, 0), "Head": (0, 0.25 * st, 0), "Spine": (0, 0.08 * st, 0),
            "Thigh.R": (0.18 * st, 0, 0), "Shin.R": (-0.30 * st, 0, 0), "UpperArm.L": (0.05 * st, 0, 0), "UpperArm.R": (-0.05 * st, 0, 0)}
    return pose, (0, 0.004 * st, 0)

# --- stepping turns and a pose-only jump. Pose functions below return (pose, (hips_x, grounded_weight, hips_z)); `floored`
# turns the grounded weight into the Hips vertical offset that puts the lowest planted foot point on the floor plane, so
# crouches and heel-raises never push feet through the ground and airborne frames keep the root at zero (physics owns Y).
# Probed bone-local axes: Hips +Y = positive yaw (turn left, CCW from above), Hips location X = world X (lateral shift),
# Thigh +Y = toes toward +X (twist), Thigh/UpperArm +Z = limb toward -X, so the exact mirror swaps L/R and negates Y, Z and hips X.
def feet_lowest_z(pose, hips_x, hips_z):
    for name in ANIM_BONES:
        RIG.pose.bones[name].rotation_euler = pose.get(name, (0, 0, 0))
    RIG.pose.bones["Hips"].location = (hips_x, 0.0, hips_z)
    RIG.update_tag(); bpy.context.view_layer.update()
    ev = feet.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
    z = min(v.co.z for v in m.vertices); ev.to_mesh_clear()
    return z
def floored(raw_fn):
    cache = {}
    def fn(phase):
        if phase not in cache:
            pose, (hx, g, hz) = raw_fn(phase)
            lift = -feet_lowest_z(pose, hx, hz) * g if g > 0 else 0.0
            cache[phase] = (pose, (hx, round(lift, 5), hz))
        return cache[phase]
    fn.cache = cache
    return fn
def mirror_pose(fn):
    def mirrored(phase):
        pose, (hx, g, hz) = fn(phase)
        out = {}
        for name, (x, y, z) in pose.items():
            n = name[:-2] + {".L": ".R", ".R": ".L"}[name[-2:]] if name[-2:] in (".L", ".R") else name
            out[n] = (x, -y, -z)
        return out, (-hx, g, hz)
    return mirrored

TURN_T, TURN_A, TURN_F = 0.28, 0.20, 0.10   # thigh twist, step-out abduction, planted fore/aft drift (radians)
def lift_window(q):
    return max(0.0, math.sin(math.pi * q) - 0.12) / 0.88          # lift bell with a short double-support dwell at both ends
def turn_left_raw(phase):
    # TurnLeft (A key, positive yaw). The left foot steps out first (phase 0 to 0.5), the right foot follows (0.5 to 1).
    # While a foot is planted the simulation rotates the body over it, so planted thighs drift linearly toward the start of
    # their next step (toes toward +X, left foot forward / right foot back); the lifted foot swings to the opposite end.
    # The drift of 2*TURN_T per half cycle matches a sustained yaw of about 0.84 rad/s; other rates slide the planted foot.
    p = phase % 1.0
    if p < 0.5:
        q = p / 0.5; sw = smooth(0.0, 1.0, q); lift_l, lift_r = lift_window(q), 0.0
        tw_l, tw_r = TURN_T * (1 - 2 * sw), -TURN_T + 2 * TURN_T * q
        fl_l, fl_r = TURN_F * (1 - 2 * sw), TURN_F * (1 - 2 * q)
        ab_l, ab_r = TURN_A * (0.35 + 0.65 * sw), 0.0
    else:
        q = (p - 0.5) / 0.5; sw = smooth(0.0, 1.0, q); lift_l, lift_r = 0.0, lift_window(q)
        tw_l, tw_r = -TURN_T + 2 * TURN_T * q, TURN_T * (1 - 2 * sw)
        fl_l, fl_r = -TURN_F + 2 * TURN_F * q, -TURN_F + 2 * TURN_F * sw
        ab_l, ab_r = TURN_A * (1.0 - 0.65 * q), 0.08 * math.sin(math.pi * q)
    s = math.sin(2 * math.pi * p)
    def leg(side, tw, fl, ab, lift, hip, knee):
        thigh = fl + hip * lift; shin = -knee * lift
        foot = -(thigh + shin) - 0.10 * lift                     # sole stays level with the floor; lifted foot hangs slightly toe-down
        return {"Thigh." + side: (thigh, tw, ab), "Shin." + side: (shin, 0, 0), "Foot." + side: (foot, 0, 0)}
    # the follow foot swings forward, which lowers its arc, so it gets more hip and knee for a similar clearance
    pose = {**leg("L", tw_l, fl_l, ab_l, lift_l, 0.38, 0.70), **leg("R", tw_r, fl_r, ab_r, lift_r, 0.46, 1.00),
            "Hips": (0, 0.12 * s, -0.03 * s), "Spine": (-0.03, -0.06 * s, 0.03 * s), "Neck": (0, 0.10, 0), "Head": (0, 0.26, 0),
            "UpperArm.L": (0.10 * lift_r - 0.05 * lift_l, 0, 0.08 * lift_l), "UpperArm.R": (0.10 * lift_l - 0.05 * lift_r, 0, -0.08 * lift_r),
            "Forearm.L": (0.12 + 0.10 * lift_r, 0, 0), "Forearm.R": (0.12 + 0.10 * lift_l, 0, 0)}
    return pose, (0.045 * s, 1.0, 0.0)                                   # weight shifts over the planted foot; net zero per cycle
turn_left_pose = floored(turn_left_raw)
turn_right_pose = floored(mirror_pose(turn_left_raw))

# Jump: symmetric key poses at the manifest phase markers, smoothstep-blended; grounded weight 1 on the floor, 0 airborne.
# Symmetric entries ("Thigh") expand to .L as given and .R with Y/Z negated.
JUMP_KEYS = [
    ("rest",      0.00, {}, 1.0),
    ("crouch",    0.22, {"Thigh": (0.85, 0, 0.04), "Shin": (-1.45, 0, 0), "Foot": (0.60, 0, 0), "Spine": (-0.35, 0, 0), "Neck": (0.05, 0, 0),
                         "Head": (0.20, 0, 0), "UpperArm": (-0.55, 0, 0.10), "Forearm": (0.25, 0, 0)}, 1.0),
    ("push",      0.33, {"Thigh": (0.08, 0, 0.03), "Shin": (-0.10, 0, 0), "Foot": (-0.32, 0, 0), "Spine": (0.06, 0, 0), "Head": (-0.02, 0, 0),
                         "UpperArm": (1.00, 0, 0.15), "Forearm": (0.35, 0, 0)}, 1.0),
    ("tuck",      0.50, {"Thigh": (1.05, 0, 0.06), "Shin": (-1.55, 0, 0), "Foot": (0.15, 0, 0), "Spine": (-0.22, 0, 0), "Neck": (0.05, 0, 0),
                         "Head": (0.12, 0, 0), "UpperArm": (0.55, 0, 0.25), "Forearm": (0.70, 0, 0)}, 0.0),
    ("reach",     0.72, {"Thigh": (0.35, 0, 0.08), "Shin": (-0.35, 0, 0), "Foot": (-0.12, 0, 0), "Spine": (-0.05, 0, 0),
                         "UpperArm": (0.30, 0, 0.35), "Forearm": (0.30, 0, 0)}, 0.0),
    ("touchdown", 0.80, {"Thigh": (0.45, 0, 0.08), "Shin": (-0.75, 0, 0), "Foot": (0.30, 0, 0), "Spine": (-0.15, 0, 0), "Head": (0.08, 0, 0),
                         "UpperArm": (0.45, 0, 0.30), "Forearm": (0.35, 0, 0)}, 1.0),
    ("absorb",    0.90, {"Thigh": (0.95, 0, 0.06), "Shin": (-1.55, 0, 0), "Foot": (0.60, 0, 0), "Spine": (-0.40, 0, 0), "Neck": (0.05, 0, 0),
                         "Head": (0.22, 0, 0), "UpperArm": (0.65, 0, 0.20), "Forearm": (0.45, 0, 0)}, 1.0),
    ("rest",      1.00, {}, 1.0)]
def expand_symmetric(pose):
    out = {}
    for name, (x, y, z) in pose.items():
        if name in ("Thigh", "Shin", "Foot", "UpperArm", "Forearm"):
            out[name + ".L"] = (x, y, z); out[name + ".R"] = (x, -y, -z)
        else:
            out[name] = (x, y, z)
    return out
JUMP_EXPANDED = [(n, ph, expand_symmetric(p), g) for n, ph, p, g in JUMP_KEYS]
def jump_raw(phase):
    p = min(max(phase, 0.0), 1.0)
    for (n0, p0, a, g0), (n1, p1, b, g1) in zip(JUMP_EXPANDED, JUMP_EXPANDED[1:]):
        if p0 <= p <= p1:
            t = smooth(p0, p1, p) if p1 > p0 else 1.0
            pose = {k: tuple(a.get(k, (0, 0, 0))[i] + (b.get(k, (0, 0, 0))[i] - a.get(k, (0, 0, 0))[i]) * t for i in range(3))
                    for k in set(a) | set(b)}
            return pose, (0.0, g0 + (g1 - g0) * t, 0.0)
    raise ValueError(phase)
jump_pose = floored(jump_raw)

# Work actions stay in place and begin/end at the standing rest pose. The right hand carries an equipped tool through
# its existing socket and independent ToolGrip layer; Cast also reads as a barehanded gesture. No Root or finger pose is keyed.
# Each middle pose is an intentional silhouette: axe overhead/down, spade thrust/lever, pick cross-body/recoil, spell raise/aim.
WORK_ACTION_KEYS = {
    "Chop": [
        (0.00, {}),
        (0.18, {"Spine": (0.10, -0.12, 0.08), "Head": (-0.08, 0.08, 0),
                "UpperArm.R": (1.45, 0, -0.05), "Forearm.R": (0.15, 0, 0), "Hand.R": (0.60, 0, 0.05),
                "UpperArm.L": (0.70, -0.08, 0.16), "Forearm.L": (0.85, 0, 0)}),
        (0.43, {"Spine": (-0.34, 0.13, -0.08), "Head": (0.15, -0.07, 0),
                "UpperArm.R": (0.55, 0, -0.12), "Forearm.R": (0.15, 0, 0), "Hand.R": (-1.00, 0, -0.05),
                "UpperArm.L": (0.08, 0.06, 0.04), "Forearm.L": (0.70, 0, 0),
                "Thigh.L": (0.12, 0, 0), "Thigh.R": (-0.10, 0, 0)}),
        (0.62, {"Spine": (-0.22, 0.07, -0.04), "Head": (0.09, 0, 0),
                "UpperArm.R": (0.48, 0, -0.06), "Forearm.R": (0.38, 0, 0), "Hand.R": (-0.75, 0, 0),
                "UpperArm.L": (0.02, 0, 0.03)}),
        (1.00, {}),
    ],
    # The spade blade is on local -Y, opposite its carry vector; the T-handle stays above the hand at the plant.
    "Dig": [
        (0.00, {}),
        (0.20, {"Spine": (0.06, -0.08, 0), "Head": (-0.02, 0.06, 0),
                "UpperArm.R": (1.15, 0, 0), "Forearm.R": (-0.10, 0, 0), "Hand.R": (-1.35, 0, 0),
                "UpperArm.L": (0.45, 0, 0.08), "Forearm.L": (0.68, 0, 0)}),
        (0.44, {"Spine": (-0.38, 0, 0), "Head": (0.17, 0, 0),
                "UpperArm.R": (0.30, 0, 0), "Forearm.R": (-0.20, 0, 0), "Hand.R": (-0.60, 0, 0),
                "UpperArm.L": (0.25, 0, 0.05), "Forearm.L": (0.44, 0, 0),
                "Thigh.L": (0.32, 0, 0), "Thigh.R": (0.26, 0, 0),
                "Shin.L": (-0.42, 0, 0), "Shin.R": (-0.36, 0, 0)}),
        (0.68, {"Spine": (0.10, 0.10, 0), "Head": (-0.03, -0.05, 0),
                "UpperArm.R": (0.75, 0, 0), "Forearm.R": (-0.20, 0, 0), "Hand.R": (-0.90, 0, 0),
                "UpperArm.L": (-0.18, 0, 0.06), "Forearm.L": (0.90, 0, 0),
                "Thigh.L": (0.12, 0, 0), "Thigh.R": (0.10, 0, 0),
                "Shin.L": (-0.14, 0, 0), "Shin.R": (-0.12, 0, 0)}),
        (1.00, {}),
    ],
    "Mine": [
        (0.00, {}),
        (0.24, {"Spine": (0.10, 0.27, -0.10), "Head": (-0.04, -0.12, 0),
                "UpperArm.R": (1.35, 0.18, -0.35), "Forearm.R": (0.25, 0, 0), "Hand.R": (0.65, 0, 0.16),
                "UpperArm.L": (0.45, -0.08, 0.20), "Forearm.L": (0.65, 0, 0)}),
        (0.47, {"Spine": (-0.31, -0.24, 0.10), "Head": (0.13, 0.11, 0),
                "UpperArm.R": (0.55, -0.15, 0.35), "Forearm.R": (0.15, 0, 0), "Hand.R": (-0.90, 0, -0.10),
                "UpperArm.L": (0.12, 0.10, -0.08), "Forearm.L": (0.58, 0, 0)}),
        (0.65, {"Spine": (-0.10, -0.10, 0.03), "Head": (0.04, 0.03, 0),
                "UpperArm.R": (0.70, 0, -0.16), "Forearm.R": (0.90, 0, 0), "Hand.R": (-0.40, 0, 0.06),
                "UpperArm.L": (-0.12, 0, 0.06)}),
        (1.00, {}),
    ],
    "Cast": [
        (0.00, {}),
        (0.25, {"Spine": (0.13, -0.13, 0), "Head": (-0.09, 0.08, 0),
                "UpperArm.R": (0.30, 0, -0.05), "Forearm.R": (0.20, 0, 0), "Hand.R": (1.15, 0, 0),
                "UpperArm.L": (-0.24, 0, 0.38), "Forearm.L": (0.48, 0, 0)}),
        (0.56, {"Spine": (-0.08, 0.09, 0), "Head": (-0.02, -0.05, 0),
                "UpperArm.R": (0.55, -0.08, -0.10), "Forearm.R": (1.05, 0, 0), "Hand.R": (-0.90, 0, 0),
                "UpperArm.L": (-0.52, 0, 0.55), "Forearm.L": (0.68, 0, 0), "Hand.L": (-0.16, 0, 0)}),
        (0.72, {"Spine": (-0.05, 0.06, 0), "Head": (0, -0.03, 0),
                "UpperArm.R": (0.55, -0.04, -0.08), "Forearm.R": (1.05, 0, 0), "Hand.R": (-0.90, 0, 0),
                "UpperArm.L": (-0.44, 0, 0.42), "Forearm.L": (0.62, 0, 0)}),
        (1.00, {}),
    ],
}

def work_action_pose(keys):
    def fn(phase):
        p = min(max(phase, 0.0), 1.0)
        for (p0, a), (p1, b) in zip(keys, keys[1:]):
            if p0 <= p <= p1:
                t = smooth(p0, p1, p)
                pose = {name: tuple(lerp(a.get(name, (0, 0, 0))[i], b.get(name, (0, 0, 0))[i], t) for i in range(3))
                        for name in a.keys() | b.keys()}
                return pose, (0.0, 0.0, 0.0)
        raise ValueError(phase)
    return fn
WORK_ACTIONS = {name: work_action_pose(keys) for name, keys in WORK_ACTION_KEYS.items()}

# ------------------------------------------------------------------------ riding: seated pose, RideIdle/RideWalk/RideRun, robe drape morph
# The adult sedgehorn (../../creatures/sedgehorn_mount) is the reference mount. Its manifest gives the saddle seat point, stirrup
# treads, rein-hand points and the per-frame seat motion of its Idle/Walk/Run clips (all glTF space: +Y up, -Z forward). The rider
# clips are authored in the rider's own space; the viewer places the rider root at RIDER_SEAT_OFFSET (rideClips.riderSeatOffsetGlb)
# above the mount origin, so the seated pelvis rests on the seat. Legs and arms are solved once (aim/2-bone IK) against the seat,
# stirrups and rein points; the gait layers only add the seat motion to Hips plus small torso/arm follow-through.
MOUNT_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "creatures", "sedgehorn_mount"))
MOUNT_BLEND = os.path.join(MOUNT_DIR, "sedgehorn_adult.blend")
MOUNT_MANIFEST = os.path.join(MOUNT_DIR, "sedgehorn_manifest.json")
mount_m = json.load(open(MOUNT_MANIFEST)) if os.path.exists(MOUNT_MANIFEST) else {}
MOUNT_AVAILABLE = bool(mount_m) and os.path.exists(MOUNT_BLEND)
def gltf_to_blender(p):
    return Vector((p[0], -p[2], p[1]))
def blender_to_gltf(p):
    return [round(p.x, 4), round(p.z, 4), round(-p.y, 4)]
_seat = mount_m.get("seat", {})
SEAT_B = gltf_to_blender(_seat.get("glbPosition", [0.0, 1.9732, -0.02]))
STIRRUP_B = {s: gltf_to_blender(_seat.get("stirrupTreadGlb", {}).get(s, [0.576 * (1 if s == "R" else -1), 1.372, -0.084])) for s in ("L", "R")}
REIN_B = {s: gltf_to_blender(_seat.get("reinHandGlb", {}).get(s, [0.17 * (1 if s == "R" else -1), 2.293, -0.24])) for s in ("L", "R")}
SEATED_PELVIS_DROP = 0.823                 # hip-joint height 0.95 minus the seated pelvis-bottom depth (0.127) measured on the tunic/trousers
RIDE_ROOT = Vector((0.0, SEAT_B.y + 0.02, SEAT_B.z - SEATED_PELVIS_DROP))    # rider floor origin in mount space (Blender axes)
RIDE_GAITS = {"RideIdle": "Idle", "RideWalk": "Walk", "RideRun": "Run"}
RIDE_FRAMES = {g: int(mount_m.get("clipEvidence", {}).get(m_, {}).get("frames", {"Idle": 72, "Walk": 32, "Run": 20}[m_]))
               for g, m_ in RIDE_GAITS.items()}
RIDE_STEP = {"RideIdle": 3, "RideWalk": 2, "RideRun": 1}
SEAT_DELTA = {g: [tuple(d) for d in mount_m.get("clipEvidence", {}).get(m_, {}).get("seatDeltaPerFrameGlb", [])] for g, m_ in RIDE_GAITS.items()}
RIDE_LEAN = {"RideIdle": -0.04, "RideWalk": -0.06, "RideRun": -0.16}       # Spine X (negative leans forward)
KNEE_POLE = (0.75, 1.0, 0.15)                                                # knee direction off the hip-to-ankle line: out (x mirrors), forward, slightly up
HAND_DIR = Vector((0.08, 0.90, -0.42)).normalized()                         # open hand sloping down onto the rein end (right side; x mirrors)
HAND_PRONATION = 0.7                                                         # palm normal = (-0.7 inward, 0, -1 down) normalised: resting on the rein, thumb forward
ANKLE_ABOVE_TREAD = 0.115                                                    # ankle joint above the stirrup tread: boot sole (0.108 below the joint) clears the tread by 7 mm

def set_pose(pose, hips_loc=(0.0, 0.0, 0.0)):
    for name in ANIM_BONES:
        RIG.pose.bones[name].rotation_euler = pose.get(name, (0, 0, 0))
    RIG.pose.bones["Hips"].location = hips_loc
    RIG.update_tag(); bpy.context.view_layer.update()
def bone_world_rot(pb):
    return pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()
def aim_bone(name, target_dir, twist=0.0, hint=None):
    """Rotate a bone (in its parent's current pose) so its axis points along target_dir (armature space). `hint` = (axis, vector)
    rolls the bone so its rest local axis ('X' lateral or 'Z' front, see the probed rest axes) points as close as possible to the
    vector; otherwise the shortest arc from the rest direction is used, plus `twist` about the target."""
    pb = RIG.pose.bones[name]; B = pb.bone.matrix_local.to_3x3()
    rest_dir = (B @ Vector((0, 1, 0))).normalized(); t = Vector(target_dir).normalized()
    if hint is None:
        Rw = Matrix.Rotation(twist, 3, t) @ rest_dir.rotation_difference(t).to_matrix()
    else:
        axis, vec = hint
        a0 = (B @ (Vector((1, 0, 0)) if axis == 'X' else Vector((0, 0, 1)))).normalized()
        a0 = (a0 - rest_dir * a0.dot(rest_dir)).normalized()
        a1 = Vector(vec) - t * Vector(vec).dot(t); a1 = a1.normalized()
        F0 = Matrix((a0, rest_dir, a0.cross(rest_dir))).transposed(); F1 = Matrix((a1, t, a1.cross(t))).transposed()
        Rw = Matrix.Rotation(twist, 3, t) @ F1 @ F0.inverted()
    Rp = bone_world_rot(pb.parent) if pb.parent else Matrix.Identity(3)
    pb.rotation_euler = (B.inverted() @ Rp.inverted() @ Rw @ B).to_euler('XYZ')
    RIG.update_tag(); bpy.context.view_layer.update()
    return tuple(round(c, 6) for c in pb.rotation_euler)
def two_bone_elbow(S, W, a, b, pole):
    d = W - S; L = min(d.length, a + b - 1e-3); dn = d.normalized()
    cos_a = max(-1.0, min(1.0, (a * a + L * L - b * b) / (2 * a * L)))
    perp = pole - dn * pole.dot(dn)
    perp = perp.normalized() if perp.length > 1e-6 else Vector((0, -1, 0))
    return S + dn * (a * cos_a) + perp * (a * math.sqrt(max(0.0, 1 - cos_a * cos_a)))

def solve_ride_pose(lean):
    """Seated pose in armature space with the rig origin at RIDE_ROOT: thighs splayed over the barrel, shins aimed at the stirrup
    treads, feet level in the irons, hands aimed at the rein ends with the original open hand geometry (GripRight stays 0)."""
    pose = {"Hips": (0.03, 0, 0), "Spine": (lean, 0, 0), "Neck": (-0.35 * lean, 0, 0), "Head": (-0.55 * lean, 0, 0)}
    set_pose(pose)
    for sign, side in ((-1, "L"), (1, "R")):
        # leg: 2-bone IK from the hip joint to the stirrup ankle point, knee pushed forward-and-out by the pole so the thigh
        # splays over the barrel and the calf hangs beside the flank
        hip = RIG.pose.bones["Thigh." + side].head
        thigh_len = (BONE_SEG["Thigh." + side][1] - BONE_SEG["Thigh." + side][0]).length
        shin_len = (BONE_SEG["Shin." + side][1] - BONE_SEG["Shin." + side][0]).length
        ankle_target = (STIRRUP_B[side] - RIDE_ROOT) + Vector((0.0, -0.035, ANKLE_ABOVE_TREAD))
        knee_t = two_bone_elbow(hip, ankle_target, thigh_len, shin_len, Vector((sign * KNEE_POLE[0], KNEE_POLE[1], KNEE_POLE[2])))
        pose["Thigh." + side] = aim_bone("Thigh." + side, knee_t - hip, hint=('Z', (sign * 0.5, 1.0, 0.2)))      # kneecap forward-out
        knee = RIG.pose.bones["Thigh." + side].tail
        pose["Shin." + side] = aim_bone("Shin." + side, ankle_target - knee, hint=('Z', (sign * 0.4, 1.0, 0.0)))   # shin front forward-out
        pose["Foot." + side] = aim_bone("Foot." + side, Vector((sign * 0.10, 0.93, -0.18)), hint=('Z', (sign * 0.15, 0.0, 1.0)))   # sole down
        shoulder = RIG.pose.bones["UpperArm." + side].head
        a = (BONE_SEG["UpperArm." + side][1] - BONE_SEG["UpperArm." + side][0]).length
        b = (BONE_SEG["Forearm." + side][1] - BONE_SEG["Forearm." + side][0]).length
        hd = Vector((sign * HAND_DIR.x, HAND_DIR.y, HAND_DIR.z))
        wrist_target = (REIN_B[side] - RIDE_ROOT) - hd * 0.125
        elbow = two_bone_elbow(shoulder, wrist_target, a, b, Vector((sign * 0.55, -1.0, -0.25)))
        pose["UpperArm." + side] = aim_bone("UpperArm." + side, elbow - shoulder, hint=('Z', (sign * 0.2, 1.0, 0.0)))          # elbow back
        pose["Forearm." + side] = aim_bone("Forearm." + side, wrist_target - RIG.pose.bones["Forearm." + side].head, hint=('Z', (0.0, 0.3, 1.0)))
        # rest palms face medially (local -X right, +X left); local X toward (p, 0, sign) turns each palm down-and-inward over its rein
        pose["Hand." + side] = aim_bone("Hand." + side, hd, hint=('X', (HAND_PRONATION, 0.0, float(sign))))
    report = {}
    for sign, side in ((-1, "L"), (1, "R")):
        hd = Vector((sign * HAND_DIR.x, HAND_DIR.y, HAND_DIR.z))
        hand = RIG.pose.bones["Hand." + side]
        report[side] = {"kneeGlb": blender_to_gltf(RIDE_ROOT + RIG.pose.bones["Thigh." + side].tail),
                        "ankleGlb": blender_to_gltf(RIDE_ROOT + RIG.pose.bones["Shin." + side].tail),
                        "toeGlb": blender_to_gltf(RIDE_ROOT + RIG.pose.bones["Foot." + side].tail),
                        "wristGlb": blender_to_gltf(RIDE_ROOT + hand.head),
                        "knuckleGlb": blender_to_gltf(RIDE_ROOT + hand.head.lerp(hand.tail, 0.6)),
                        "knuckleToReinHandMeters": round(((RIDE_ROOT + hand.head.lerp(hand.tail, 0.6)) - REIN_B[side]).length, 4),
                        "wristToIkTargetMeters": round(((RIDE_ROOT + hand.head) - (REIN_B[side] - hd * 0.125)).length, 4),
                        "ankleToStirrupTargetMeters": round(((RIDE_ROOT + RIG.pose.bones["Shin." + side].tail) - (STIRRUP_B[side] + Vector((0.0, -0.035, ANKLE_ABOVE_TREAD)))).length, 4)}
    set_pose({})
    return pose, report
RIDE_STATIC, RIDE_REPORT = {}, {}
for g in RIDE_GAITS:
    RIDE_STATIC[g], RIDE_REPORT[g] = solve_ride_pose(RIDE_LEAN[g])

def ride_pose_factory(gait):
    static = RIDE_STATIC[gait]; frames = RIDE_FRAMES[gait]; deltas = SEAT_DELTA[gait]
    def add(pose, name, d):
        x, y, z = pose.get(name, (0, 0, 0)); pose[name] = (x + d[0], y + d[1], z + d[2])
    def fn(phase):
        p = phase % 1.0; ph = 2 * math.pi * p
        d = deltas[int(round(p * frames)) % frames] if deltas else (0.0, 0.0, 0.0)
        pose = dict(static)
        if gait == "RideIdle":
            s = math.sin(ph)
            add(pose, "Spine", (0.012 * s, 0, 0)); add(pose, "Head", (-0.008 * s, 0.035 * math.sin(ph + 1.0), 0))
            add(pose, "UpperArm.L", (0.01 * s, 0, 0)); add(pose, "UpperArm.R", (0.01 * s, 0, 0))
        elif gait == "RideWalk":
            s2 = math.sin(2 * ph); s = math.sin(ph)
            add(pose, "Hips", (0.03 * s2, 0, 0.9 * d[0])); add(pose, "Spine", (-0.03 * s2, 0, -0.6 * d[0])); add(pose, "Head", (0.0, 0.03 * s, 0))
            add(pose, "UpperArm.L", (0.025 * s2, 0, 0)); add(pose, "UpperArm.R", (0.025 * s2, 0, 0))
            add(pose, "Forearm.L", (0.02 * s2, 0, 0)); add(pose, "Forearm.R", (0.02 * s2, 0, 0))
        else:
            dy = d[1]
            add(pose, "Hips", (0.4 * dy, 0, 0)); add(pose, "Spine", (0.9 * dy, 0, 0)); add(pose, "Head", (-0.5 * dy, 0, 0))
            add(pose, "UpperArm.L", (0.6 * dy, 0, 0)); add(pose, "UpperArm.R", (0.6 * dy, 0, 0))
        # Hips bone-local axes (X = world X, Y = up, Z = back) coincide with glTF axes, so the seat delta is applied as-is
        return pose, (round(d[0], 5), round(d[1], 5), round(d[2], 5))
    return fn
ride_idle_pose, ride_walk_pose, ride_run_pose = (ride_pose_factory(g) for g in ("RideIdle", "RideWalk", "RideRun"))

# Robe and tunic drape morph "RideDrape": with the thighs flexed, the skirt rows weighted to Thigh/Shin would swing into the
# saddle and barrel. The morph re-lays every skirt vertex below the hips as cloth falling from the hip ring under gravity: it
# drops row by row along its rest spacing, is pushed out of the mount body/tack and the rider's own legs, and slides down the
# local slope so the rest length is kept. The result is inverted through the seated skinning matrices, so the morph is a rest-
# space offset that the ride clips key to 1 and every on-foot clip keys to 0.
from mathutils.bvhtree import BVHTree
RIDE_FIT = {"mountReferenceAvailable": MOUNT_AVAILABLE}
DRAPE = {}
def load_mount_collision():
    before = {k: set(getattr(bpy.data, k).keys()) for k in ("objects", "meshes", "materials", "armatures", "actions", "node_groups", "images", "collections")}
    with bpy.data.libraries.load(MOUNT_BLEND, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in ("SH_body", "SH_saddle", "SH_blanket")]   # closed/consistently oriented shells only; the girth ring has mixed normals
    ref = bpy.data.collections.new("MountRefTemp"); sc.collection.children.link(ref)
    for ob in dst.objects:
        if ob is not None:
            ref.objects.link(ob)
            for mod in list(ob.modifiers):
                if mod.type == 'ARMATURE':
                    ob.modifiers.remove(mod)
    bpy.context.view_layer.update()
    dg_ = bpy.context.evaluated_depsgraph_get()
    # one BVH per closed shell: the inside test (nearest point normal) is only meaningful per shell, a point under the saddle
    # would otherwise be judged "outside" by the saddle's inner face while sitting inside the body
    # (tree, depth cap): a thin shell cannot be penetrated deeper than its thickness, which also rejects the false "inside" the
    # nearest-face normal test gives for points off a shell's rim; the closed body volume needs no cap
    caps = {"SH_body": None, "SH_saddle": 0.05, "SH_blanket": 0.025}
    trees = [(world_bvh(ob, dg_), caps.get(ob.name, 0.05)) for ob in dst.objects if ob is not None]
    all_bm = bmesh.new()
    for ob in dst.objects:
        if ob is not None:
            ev = ob.evaluated_get(dg_); me = ev.to_mesh(); me.transform(ob.matrix_world); all_bm.from_mesh(me); ev.to_mesh_clear()
    all_tree = BVHTree.FromBMesh(all_bm); all_bm.free()
    def cleanup():
        for k, names in before.items():
            coll = getattr(bpy.data, k)
            for n in list(coll.keys()):
                if n not in names:
                    coll.remove(coll[n])
    return trees, all_tree, cleanup
def world_bvh(ob, dg_):
    ev = ob.evaluated_get(dg_); me = ev.to_mesh(); me.transform(ob.matrix_world)
    bm = bmesh.new(); bm.from_mesh(me); ev.to_mesh_clear()
    tree = BVHTree.FromBMesh(bm); bm.free(); return tree
def rider_leg_bvhs():
    dg_ = bpy.context.evaluated_depsgraph_get()
    return [(world_bvh(trousers, dg_), 0.10), (world_bvh(boots, dg_), 0.10)]
def drape_cloth(ob, cols, start_z, trees, gap=0.016, iters=220, settle_iters=70, g_step=0.006, passes=3):
    """Position-based cloth settle for a drape_patch grid (row-major rows from the top, `cols` u samples per row).
    Rows at or above start_z keep their skinned position and pin the sheet; every row below is released from the pose,
    hung straight down from its anchor, then settled: a gravity step per iteration, Gauss-Seidel distance constraints on the
    grid edges and both diagonals (rest lengths from the authored garment), and a push-out of every mount/leg shell with a
    `gap` clearance. The last `settle_iters` iterations run without gravity so the edges relax to their rest lengths.
    Returns (rest, target world positions, draped mask)."""
    dg_ = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg_); me = ev.to_mesh(); posed = [ob.matrix_world @ v.co for v in me.vertices]; ev.to_mesh_clear()
    rest = [v.co.copy() for v in ob.data.vertices]
    nrows = len(rest) // cols
    def collide(C):
        for _ in range(3):
            moved = False
            for tree, cap in trees:
                loc, nrm, idx, dist = tree.find_nearest(C)
                if loc is not None and (C - loc).dot(nrm) < gap and (cap is None or dist < cap + gap):
                    C = loc + nrm * gap; moved = True
            if not moved:
                break
        return C
    draped = [rest[k].z < start_z for k in range(len(rest))]
    x = list(posed)
    for i in range(cols):                                   # initial state: hang each column straight down from its anchor row
        anchor = None
        for j in range(nrows):
            k = j * cols + i
            if not draped[k]:
                continue
            if anchor is None:
                anchor = x[(j - 1) * cols + i] - rest[(j - 1) * cols + i] if j > 0 else Vector((0, 0, 0))
            x[k] = collide(anchor + rest[k])
    edges = []
    for j in range(nrows):
        for i in range(cols):
            k = j * cols + i
            for (dj, di) in ((0, 1), (1, 0), (1, 1), (1, -1)):
                jj, ii = j + dj, i + di
                if 0 <= jj < nrows and 0 <= ii < cols:
                    kk = jj * cols + ii
                    if draped[k] or draped[kk]:
                        edges.append((k, kk, (rest[k] - rest[kk]).length))
    free = [k for k in range(len(rest)) if draped[k]]
    down = Vector((0, 0, g_step))
    for it in range(iters):
        if it < iters - settle_iters:
            for k in free:
                x[k] = x[k] - down
        for _ in range(passes):
            for a, b, L in edges:
                d = x[b] - x[a]; dl = d.length
                if dl < 1e-9:
                    continue
                corr = d * (1.0 - L / dl)
                if draped[a] and draped[b]:
                    x[a] = x[a] + corr * 0.5; x[b] = x[b] - corr * 0.5
                elif draped[a]:
                    x[a] = x[a] + corr
                else:
                    x[b] = x[b] - corr
        for k in free:
            x[k] = collide(x[k])
    strain = max(abs((x[b] - x[a]).length - L) for a, b, L in edges) if edges else 0.0
    drape_cloth.last_strain = round(strain, 4)
    return rest, x, draped
def skin_matrix(ob, vi):
    M = Matrix.Diagonal((0.0, 0.0, 0.0, 0.0))
    for g in ob.data.vertices[vi].groups:
        pb = RIG.pose.bones[ob.vertex_groups[g.group].name]
        M = M + (pb.matrix @ pb.bone.matrix_local.inverted()) * g.weight
    return M
def bake_drape_morph(ob, cols, start_z, trees):
    rest, target, draped = drape_cloth(ob, cols, start_z, trees)
    if not ob.data.shape_keys:
        ob.shape_key_add(name="Basis", from_mix=False)
    key = ob.shape_key_add(name="RideDrape", from_mix=False); key.value = 0.0
    skin_err = 0.0; moved = []
    for i, (r, t, d) in enumerate(zip(rest, target, draped)):
        M = skin_matrix(ob, i)
        if not d:
            skin_err = max(skin_err, (RIDE_ROOT + (M @ r) - t).length)
            continue
        key.data[i].co = M.inverted() @ (t - RIDE_ROOT)
        moved.append((key.data[i].co - r).length)
    return {"vertices": len(rest), "drapedVertices": len(moved), "maxRestOffsetMeters": round(max(moved), 4) if moved else 0.0,
            "maxEdgeStrainMeters": drape_cloth.last_strain,
            "meanRestOffsetMeters": round(sum(moved) / len(moved), 4) if moved else 0.0,
            "skinningReconstructionErrorMeters": round(skin_err, 6), "drapeStartZ": start_z}
def fit_against(trees, names, label):
    """Per rider mesh: vertices inside any mount shell (body, saddle, blanket), deepest penetration, nearest outside distance."""
    dg_ = bpy.context.evaluated_depsgraph_get(); out = {}
    for name in names:
        ob = bpy.data.objects[name]; ev = ob.evaluated_get(dg_); me = ev.to_mesh()
        inside = 0; deepest = 0.0; nearest = 9.0; lowest = 9.0; nverts = len(me.vertices)
        for v in me.vertices:
            p = ob.matrix_world @ v.co; lowest = min(lowest, p.z)
            depth = 0.0; near = 9.0
            for tree, cap in trees:
                loc, nrm, idx, dist = tree.find_nearest(p)
                if loc is None:
                    continue
                if (p - loc).dot(nrm) < 0 and (cap is None or dist < cap):
                    depth = max(depth, dist)
                else:
                    near = min(near, dist)
            if depth > 0:
                inside += 1; deepest = max(deepest, depth)
            else:
                nearest = min(nearest, near)
        ev.to_mesh_clear()
        out[name] = {"vertices": nverts, "verticesInsideMount": inside, "deepestPenetrationMeters": round(deepest, 4),
                     "nearestOutsideMeters": round(nearest, 4), "lowestWorldZ": round(lowest, 4)}
    return out
if MOUNT_AVAILABLE:
    mount_trees, mount_tree, mount_cleanup = load_mount_collision()
    RIG.location = RIDE_ROOT
    pose0, hips0 = ride_idle_pose(0.0)
    set_pose(pose0, hips0)
    RIDE_FIT["beforeDrape"] = fit_against(mount_trees, ["V9_robe", "V9_tunic"], "before")
    leg_trees = rider_leg_bvhs()
    DRAPE["V9_robe"] = bake_drape_morph(robe, 96 + 1, 0.98, mount_trees + leg_trees)
    DRAPE["V9_tunic"] = bake_drape_morph(tunic, 40 + 1, 0.98, mount_trees + leg_trees)
    for ob in (robe, tunic):
        ob.data.shape_keys.key_blocks["RideDrape"].value = 1.0
    set_pose(pose0, hips0)
    RIDE_FIT["rideIdleFrame1"] = fit_against(mount_trees, ["V9_robe", "V9_tunic", "V9_trousers", "V9_boots", "V9_sleeves", "V9_body", "V9_satchel"], "after")
    RIDE_FIT["note"] = "rideIdleFrame1 is measured against the rest-pose mount; animated frames (both rigs moving) are measured by render_sedgehorn.py and recorded in sedgehorn_manifest.json riderFit"
    for ob in (robe, tunic):
        ob.data.shape_keys.key_blocks["RideDrape"].value = 0.0
    set_pose({})
    RIG.location = (0.0, 0.0, 0.0)
    mount_cleanup()
    RIG.update_tag(); bpy.context.view_layer.update()

CLIPS = [("Idle", 48, idle_pose, True, 3), ("Walk", 24, walk_pose, True, 3), ("Run", 18, run_pose, True, 2),
         ("Turn", 24, turn_pose, False, 3),                 # legacy single-leg pivot, kept for compatibility until runtime hookup
         ("TurnLeft", 32, turn_left_pose, True, 2), ("TurnRight", 32, turn_right_pose, True, 2),
         ("Jump", 36, jump_pose, False, 2),                 # (name, cycle frames at 24 fps, pose, loops, key step)
         ("RideIdle", RIDE_FRAMES["RideIdle"], ride_idle_pose, True, RIDE_STEP["RideIdle"]),
         ("RideWalk", RIDE_FRAMES["RideWalk"], ride_walk_pose, True, RIDE_STEP["RideWalk"]),
         ("RideRun", RIDE_FRAMES["RideRun"], ride_run_pose, True, RIDE_STEP["RideRun"]),
         ("Chop", 28, WORK_ACTIONS["Chop"], False, 2), ("Dig", 32, WORK_ACTIONS["Dig"], False, 2),
         ("Mine", 30, WORK_ACTIONS["Mine"], False, 2), ("Cast", 36, WORK_ACTIONS["Cast"], False, 2)]
for clip_name, frames, pose_fn, loop, step in CLIPS:        # warm the floor-solve caches before any action is assigned
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

# RideDrape weight tracks: 1 across the three ride clips, 0 across every on-foot clip (same NLA track names as the rig, so the
# glTF exporter merges them into the same animations; a clip switch in the viewer then always carries the right drape state)
def key_morph_tracks(ob):
    sk = ob.data.shape_keys
    if sk.animation_data is None:
        sk.animation_data_create()
    kb = sk.key_blocks["RideDrape"]
    for clip_name, frames, pose_fn, loop, step in CLIPS:
        action = bpy.data.actions.new("%s_%s" % (ob.name, clip_name))
        sk.animation_data.action = action
        value = 1.0 if clip_name in RIDE_GAITS else 0.0
        for f in (1, frames + 1):
            kb.value = value
            kb.keyframe_insert(data_path="value", frame=f)
        track = sk.animation_data.nla_tracks.new(); track.name = clip_name
        strip = track.strips.new(clip_name, 1, action)
        if hasattr(strip, "action_slot") and len(action.slots):
            strip.action_slot = action.slots[0]
        track.mute = True
    sk.animation_data.action = None
    kb.value = 0.0
if MOUNT_AVAILABLE:
    for ob in (robe, tunic):
        key_morph_tracks(ob)

# ------------------------------------------------------------------------ ToolGrip: finger-only constant clip (approved grip follow-up)
# Representative shaft: a cylinder of radius TOOL_GRIP_SHAFT_R along world Y at rest (handle trailing toward the back, working head
# forward, as the user specified for the carry) whose axis passes through the runtime's shared contact line RUNTIME_CONTACT_GLB
# (src/view/WizardScene.tsx `V9_RIGHT_HAND_CONTACT`, inspected read-only). The runtime mounts the tool once against the REST
# Socket.RightHand (`rightHandToolMountFor(mainHand, restSocket)`) so the shaft is hand-relative and rides the posed hand; while a
# tool is equipped it also slerps UpperArm.R/Forearm.R 70 % toward rest (`applyV9EquippedCarryPose`, V9_EQUIPPED_CARRY_STRENGTH).
# Nothing moves the hand toward a tool: each finger is curled (two segments, fixed proximal:distal ratio) to the largest subtle
# angle at which its skin still clears the shaft surface; the thumb adducts toward the shaft the same way. Only the ten finger
# bones are keyed, as a constant two-key clip: no Hand.R/arm/Hips/robe/face channel, so playing it on top of any locomotion clip
# only closes the fingers. The art-side derived placement (tangent to the open hand 2 cm below the knuckles) is still computed
# as ART_SHAFT_C so the manifest reports how far the runtime line sits from it.
TOOL_GRIP_SHAFT_R = 0.0475                  # axe 0.045-0.055, spade 0.045-0.05, pick 0.045-0.052, wand 0.035-0.05 at mid shaft (WizardScene radii)
TOOL_GRIP_GAP = 0.003                       # open-hand clearance used by the art-side derived placement (diagnostic only)
TOOL_GRIP_SKIN_GAP = 0.0015                 # curled finger skin must stay at least this far outside the shaft
TOOL_GRIP_S = FINGER_MCP + 0.02             # art-side derived placement: shaft centre 2 cm below the knuckle line (diagnostic only)
RUNTIME_CONTACT_GLB = (0.402, 0.984, 0.0345)    # V9_RIGHT_HAND_CONTACT, rest-pose glTF point on the shaft axis (x, up, z)
RUNTIME_CARRY_BLEND = 0.7                       # V9_EQUIPPED_CARRY_STRENGTH: equipped right arm slerped this far toward rest
TOOL_GRIP_MAX_DEG = {"Index": (38.0, 34.0), "Middle": (40.0, 36.0), "Ring": (40.0, 36.0), "Pinky": (38.0, 34.0), "Thumb": (32.0, 18.0)}
                                            # thumb cap raised from 18/10: the runtime line sits 2.3 cm lower than the art-side placement, so the
                                            # thumb has to adduct further to reach it
TOOL_GRIP_FRAMES = 12                       # constant clip length (0.5 s at 24 fps) so viewers get a non-zero duration
def eval_hand():
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
    out = np.array([m.vertices[i].co[:] for i in hand_idx]); ev.to_mesh_clear(); return out
def set_fingers(angles):
    for name in FINGER_NAMES + ["Thumb"]:
        d1, d2 = angles.get(name, (0.0, 0.0))
        RIG.pose.bones["%s1.R" % name].rotation_euler = (deg(d1), 0.0, 0.0)
        RIG.pose.bones["%s2.R" % name].rotation_euler = (deg(d2), 0.0, 0.0)
    RIG.update_tag(); bpy.context.view_layer.update()
def shaft_clearance(points, centre_xz, radius=TOOL_GRIP_SHAFT_R, axis=None, centre=None):
    """Signed clearance of points to a cylinder (negative = inside): world-Y axis through centre_xz, or `axis` through `centre`."""
    if axis is None:
        d = np.sqrt((points[:, 0] - centre_xz[0]) ** 2 + (points[:, 2] - centre_xz[1]) ** 2)
        return d - radius
    a = np.array(axis, float); a /= np.linalg.norm(a)
    rel = points - np.array(centre, float)
    perp = rel - np.outer(rel @ a, a)
    return np.linalg.norm(perp, axis=1) - radius
set_fingers({})
OPEN_HAND = eval_hand()
NEUTRAL_HAND_DRIFT = float(np.abs(OPEN_HAND - HP).max())                             # finger bones at rest must not move the approved hand
SHAFT_C = Vector((RUNTIME_CONTACT_GLB[0], -RUNTIME_CONTACT_GLB[2], RUNTIME_CONTACT_GLB[1]))   # rest-pose world (Blender) point on the shaft axis
SHAFT_CX, SHAFT_CY, SHAFT_CZ = SHAFT_C
_art_cz = (Vector(W) + f_hand * TOOL_GRIP_S).z                                        # art-side derived placement, diagnostic only
_band = np.abs(OPEN_HAND[:, 2] - _art_cz) < TOOL_GRIP_SHAFT_R
_art_cx = float(min(OPEN_HAND[j, 0] - math.sqrt(max(0.0, TOOL_GRIP_SHAFT_R ** 2 - (OPEN_HAND[j, 2] - _art_cz) ** 2))
                    for j in np.where(_band)[0])) - TOOL_GRIP_GAP
ART_SHAFT_C = Vector((_art_cx, float(OPEN_HAND[:, 1].mean()), _art_cz))
_open_clear = shaft_clearance(OPEN_HAND, (SHAFT_CX, SHAFT_CZ))
OPEN_HAND_RUNTIME_GAP = float(_open_clear.min())                                      # the runtime line must sit outside the approved open hand
FINGER_VERTS = {}                                                                     # finger -> hand-array indices it moves
for j in range(len(hand_idx)):
    name, ramp, _ = finger_membership(j)
    if name is not None and ramp > 0.0:
        FINGER_VERTS.setdefault(name, []).append(j)
FINGER_VERTS = {n: np.array(v) for n, v in FINGER_VERTS.items()}
TOOL_GRIP_DEG = {n: (0.0, 0.0) for n in TOOL_GRIP_MAX_DEG}
_locked = set()
_thumb_best = float(_open_clear[FINGER_VERTS["Thumb"]].min())                         # the thumb sweeps past the shaft rather than onto it:
for step in range(1, 41):                                                             # 2.5 % increments of each finger's cap
    trial = {n: (TOOL_GRIP_MAX_DEG[n][0] * step / 40.0, TOOL_GRIP_MAX_DEG[n][1] * step / 40.0) for n in TOOL_GRIP_MAX_DEG if n not in _locked}
    if not trial:
        break
    set_fingers({**TOOL_GRIP_DEG, **trial})
    posed = eval_hand()
    cl = shaft_clearance(posed, (SHAFT_CX, SHAFT_CZ))
    for n, ang in trial.items():
        c_min = float(cl[FINGER_VERTS[n]].min())
        if n == "Thumb":                                                              # keep the angle that brings it closest, not the largest
            if c_min < TOOL_GRIP_SKIN_GAP:
                _locked.add(n)
            elif c_min < _thumb_best:
                _thumb_best = c_min; TOOL_GRIP_DEG[n] = ang
        elif c_min >= TOOL_GRIP_SKIN_GAP:
            TOOL_GRIP_DEG[n] = ang
        else:
            _locked.add(n)
set_fingers(TOOL_GRIP_DEG)
GRIPPED_HAND = eval_hand()
_grip_clear = shaft_clearance(GRIPPED_HAND, (SHAFT_CX, SHAFT_CZ))
def _clear_stats(cl, sel):
    c = cl[sel]
    return {"minMeters": round(float(c.min()), 4), "verticesInsideShaft": int((c < 0).sum()), "verticesWithin5mm": int((c <= 0.005).sum()),
            "verticesWithin10mm": int((c <= 0.010).sum())}
TOOL_GRIP_REST_FIT = {"openHand": _clear_stats(_open_clear, np.arange(len(hand_idx))),
                      "grippedHand": _clear_stats(_grip_clear, np.arange(len(hand_idx))),
                      "perFinger": {n: {"open": _clear_stats(_open_clear, FINGER_VERTS[n]), "gripped": _clear_stats(_grip_clear, FINGER_VERTS[n]),
                                        "maxVertexTravelMeters": round(float(np.linalg.norm(GRIPPED_HAND[FINGER_VERTS[n]] - OPEN_HAND[FINGER_VERTS[n]], axis=1).max()), 4)}
                                    for n in FINGER_NAMES + ["Thumb"]}}
action = bpy.data.actions.new("ToolGrip")
RIG.animation_data.action = action
for f in (1, TOOL_GRIP_FRAMES + 1):
    for name in FINGER_BONES:
        RIG.pose.bones[name].keyframe_insert(data_path="rotation_euler", frame=f, group=name)
track = RIG.animation_data.nla_tracks.new(); track.name = "ToolGrip"
strip = track.strips.new("ToolGrip", 1, action)
if hasattr(strip, "action_slot") and len(action.slots):
    strip.action_slot = action.slots[0]
track.mute = True
RIG.animation_data.action = None
set_fingers({})
HAND_REST_INV = RIG.pose.bones["Hand.R"].bone.matrix_local.inverted()
def posed_shaft():
    """The rest shaft point and axis carried by the posed Hand.R: (centre, hand-relative axis direction)."""
    m = (RIG.matrix_world @ RIG.pose.bones["Hand.R"].matrix) @ HAND_REST_INV
    return m @ SHAFT_C, (m.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()

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

# ------------------------------------------------------------------------ ToolGrip channel contract (GLB post-pass)
# The NLA_TRACKS exporter bakes every bone into every track (constant rest channels included; its "keep constant armature
# channels" switch cannot tell a keyed-but-constant bone from an unkeyed one in NLA mode, so it would also drop the ride clips'
# constant seated legs). The .blend already holds the contract (ToolGrip keys only the finger bones; no other action keys
# them), so the GLB is rewritten to match it: finger channels are removed from every other clip, and ToolGrip keeps only the
# finger rotation channels. Work actions also omit the exporter's constant Root translation channel. The remaining channels
# are byte-identical to the exporter's output, and orphaned accessors/bufferViews are pruned (indices remapped, binary blob untouched).
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

def write_glb(path, gltf, blob):
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    blob = bytes(blob) + b"\0" * (-len(blob) % 4)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A)); fh.write(js)
        fh.write(struct.pack("<II", len(blob), 0x004E4942)); fh.write(blob)

def apply_tool_grip_channel_contract(path):
    gltf, blob, _ = parse_glb(path)
    names = [n.get("name") for n in gltf["nodes"]]
    report = {}
    for a in gltf.get("animations", []):
        keep = []
        for ch in a["channels"]:
            finger = names[ch["target"]["node"]] in FINGER_BONES
            target = ch["target"]
            wanted = (finger and target["path"] == "rotation") if a["name"] == "ToolGrip" else (
                not finger and not (a["name"] in WORK_ACTIONS and names[target["node"]] == "Root" and target["path"] == "translation"))
            if wanted:
                keep.append(ch)
        used = sorted({ch["sampler"] for ch in keep}); remap = {o: i for i, o in enumerate(used)}
        report[a["name"]] = {"channelsBefore": len(a["channels"]), "channelsAfter": len(keep), "samplersRemoved": len(a["samplers"]) - len(used)}
        a["samplers"] = [a["samplers"][o] for o in used]
        for ch in keep:
            ch["sampler"] = remap[ch["sampler"]]
        a["channels"] = keep
    used_acc = set()
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            used_acc.update(prim.get("attributes", {}).values())
            if "indices" in prim:
                used_acc.add(prim["indices"])
            for t in prim.get("targets", []):
                used_acc.update(t.values())
    for sk in gltf.get("skins", []):
        if "inverseBindMatrices" in sk:
            used_acc.add(sk["inverseBindMatrices"])
    for a in gltf.get("animations", []):
        for s in a["samplers"]:
            used_acc.update((s["input"], s["output"]))
    acc_map = {o: i for i, o in enumerate(sorted(used_acc))}
    n_acc_before, n_bv_before = len(gltf["accessors"]), len(gltf["bufferViews"])
    gltf["accessors"] = [gltf["accessors"][o] for o in sorted(used_acc)]
    used_bv = set()
    for acc in gltf["accessors"]:
        if "bufferView" in acc:
            used_bv.add(acc["bufferView"])
        if "sparse" in acc:                                   # morph targets (GripRight, RideDrape) are sparse accessors
            used_bv.update((acc["sparse"]["indices"]["bufferView"], acc["sparse"]["values"]["bufferView"]))
    used_bv.update(im["bufferView"] for im in gltf.get("images", []) if "bufferView" in im)
    used_bv = sorted(used_bv)
    bv_map = {o: i for i, o in enumerate(used_bv)}
    gltf["bufferViews"] = [gltf["bufferViews"][o] for o in used_bv]
    for acc in gltf["accessors"]:
        if "bufferView" in acc:
            acc["bufferView"] = bv_map[acc["bufferView"]]
        if "sparse" in acc:
            acc["sparse"]["indices"]["bufferView"] = bv_map[acc["sparse"]["indices"]["bufferView"]]
            acc["sparse"]["values"]["bufferView"] = bv_map[acc["sparse"]["values"]["bufferView"]]
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            prim["attributes"] = {k: acc_map[v] for k, v in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = acc_map[prim["indices"]]
            if "targets" in prim:
                prim["targets"] = [{k: acc_map[v] for k, v in t.items()} for t in prim["targets"]]
    for sk in gltf.get("skins", []):
        if "inverseBindMatrices" in sk:
            sk["inverseBindMatrices"] = acc_map[sk["inverseBindMatrices"]]
    for a in gltf.get("animations", []):
        for s in a["samplers"]:
            s["input"], s["output"] = acc_map[s["input"]], acc_map[s["output"]]
    for im in gltf.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = bv_map[im["bufferView"]]
    report["accessorsPruned"] = n_acc_before - len(gltf["accessors"])
    report["bufferViewsPruned"] = n_bv_before - len(gltf["bufferViews"])
    write_glb(path, gltf, blob)
    return report
TOOL_GRIP_CHANNEL_PASS = apply_tool_grip_channel_contract(OUT_GLB)

# ------------------------------------------------------------------------ Run timeline normalization (GLB post-pass)
# The NLA strips start at frame 1, so every exported sampler's first key is at 1/24 s. For a LoopRepeat clip Three.js holds the
# first pose from t=0 until that key each cycle: on Run a 41.7 ms stop every 0.79 s, invisible unarmed but an obvious hand/axe
# hitch with a long tool equipped. Only Run is moved: Idle/Walk are phase-driven by the runtime, and the ride clips must keep the
# mount's durations. Run's two time (input) accessors are exclusive to Run and each sit in their own bufferView, so their floats
# are rewritten in place as t -> (round(t*fps) - 1)/fps: first key 0, closing key 18/24 = 0.75 s, same key count, same outputs,
# samplers, channels and interpolation; no other byte of the file changes.
def normalize_clip_timeline(path, clip_name, fps=24):
    gltf, blob, _ = parse_glb(path)
    blob = bytearray(blob)
    clip = next(a for a in gltf["animations"] if a["name"] == clip_name)
    inputs = sorted({s["input"] for s in clip["samplers"]})
    elsewhere = {s["input"] for a in gltf["animations"] if a is not clip for s in a["samplers"]} \
        | {s["output"] for a in gltf["animations"] for s in a["samplers"]}
    assert not (set(inputs) & elsewhere), "%s time accessors are shared with other data; in-place rewrite unsafe" % clip_name
    bv_users = {}
    for i, acc in enumerate(gltf["accessors"]):
        if "bufferView" in acc:
            bv_users.setdefault(acc["bufferView"], []).append(i)
    report = {"clip": clip_name, "fps": fps, "inputAccessors": []}
    for i in inputs:
        acc = gltf["accessors"][i]; bv = gltf["bufferViews"][acc["bufferView"]]
        assert acc["componentType"] == 5126 and acc["type"] == "SCALAR" and bv_users[acc["bufferView"]] == [i] and "byteStride" not in bv
        off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        fmt = "<%df" % acc["count"]
        old = struct.unpack_from(fmt, blob, off)
        struct.pack_into(fmt, blob, off, *((round(t * fps) - 1) / fps for t in old))
        new = struct.unpack_from(fmt, blob, off)
        assert new[0] == 0.0 and all(b > a for a, b in zip(new, new[1:])), "normalized timeline must start at 0 and stay increasing"
        acc["min"], acc["max"] = [new[0]], [new[-1]]
        report["inputAccessors"].append({"accessor": i, "keys": acc["count"], "firstKeyBefore": round(old[0], 7), "lastKeyBefore": round(old[-1], 7),
                                         "firstKeyAfter": new[0], "lastKeyAfter": new[-1]})
    report["samplersUsingTheseAccessors"] = len(clip["samplers"])
    write_glb(path, gltf, blob)
    return report
RUN_TIMELINE_PASS = normalize_clip_timeline(OUT_GLB, "Run")

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
               "Run@frame5": clip_displacement(run_pose, 18, 5), "Run@frame14": clip_displacement(run_pose, 18, 14),
               "Turn@frame13": clip_displacement(turn_pose, 24, 13), "TurnLeft@frame9": clip_displacement(turn_left_pose, 32, 9),
               "TurnRight@frame9": clip_displacement(turn_right_pose, 32, 9), "Jump@frame19": clip_displacement(jump_pose, 36, 19)}

# ToolGrip through the locomotion clips, open and gripped hand at the same frames, shaft hand-relative as the runtime mounts it
# (fixed in Hand.R space, rides the socket with its rotation, so the finger clearances are the rest values unless the wrist's own
# skinning shears the hand). Two arm regimes:
#  clipArm:        the clip's right arm as exported (unequipped presentation, or the first frames before the carry blend settles);
#  equippedCarry:  UpperArm.R/Forearm.R slerped RUNTIME_CARRY_BLEND toward rest, what `applyV9EquippedCarryPose` shows while a tool
#                  is equipped. Bone rotations are relative to rest, so the slerp target is identity.
def _carry_blend(euler_xyz, blend):
    q = Euler(euler_xyz, 'XYZ').to_quaternion(); q = q.slerp(Quaternion((1.0, 0.0, 0.0, 0.0)), blend)
    return tuple(q.to_euler('XYZ'))
def tool_grip_frame_fit(pose_fn, frames, frame):
    pose, hips_loc = pose_fn((frame - 1) / frames)
    out = {}
    for arm_label, blend in (("clipArm", 0.0), ("equippedCarry", RUNTIME_CARRY_BLEND)):
        for name in ANIM_BONES:
            rot = pose.get(name, (0, 0, 0))
            RIG.pose.bones[name].rotation_euler = _carry_blend(rot, blend) if blend and name in ("UpperArm.R", "Forearm.R") else rot
        RIG.pose.bones["Hips"].location = hips_loc
        for label, angles in (("open", {}), ("gripped", TOOL_GRIP_DEG)):
            set_fingers(angles)
            c, axis = posed_shaft()
            hand = eval_hand()
            cl_h = shaft_clearance(hand, None, axis=axis, centre=c)
            out["%s.%s" % (arm_label, label)] = {"shaftAxisPointGlb": blender_to_gltf(c), "shaftAxisGlb": blender_to_gltf(axis),
                                                 **_clear_stats(cl_h, np.arange(len(hand_idx))),
                                                 "perFinger": {n: _clear_stats(cl_h, FINGER_VERTS[n]) for n in FINGER_NAMES + ["Thumb"]}}
    rest_pose()
    return out
TOOL_GRIP_FRAME_FIT = {"Idle@frame1": tool_grip_frame_fit(idle_pose, 48, 1), "Idle@frame25": tool_grip_frame_fit(idle_pose, 48, 25),
                       "Walk@frame7": tool_grip_frame_fit(walk_pose, 24, 7), "Walk@frame19": tool_grip_frame_fit(walk_pose, 24, 19),
                       "Run@frame5": tool_grip_frame_fit(run_pose, 18, 5), "Run@frame14": tool_grip_frame_fit(run_pose, 18, 14)}
# Run clip proof: foot height through the cycle (stance foot near the floor, swing foot clear), loop closure and
# amplitude contrast against Walk, all from the same pose functions that keyed the NLA actions
def foot_heights(pose_fn, frames):
    lows = {"L": [], "R": []}
    for f in range(1, frames + 1):
        pose, hips_loc = pose_fn((f - 1) / frames)
        for name in ANIM_BONES:
            RIG.pose.bones[name].rotation_euler = pose.get(name, (0, 0, 0))
        RIG.pose.bones["Hips"].location = hips_loc
        RIG.update_tag(); bpy.context.view_layer.update()
        cos = eval_coords(feet)
        for side in lows:
            lows[side].append(round(min(c.z for c, r in zip(cos, feet_rest) if side_of(r) == side), 3))
    rest_pose()
    return lows
run_heights = foot_heights(run_pose, 18)
p0, h0 = run_pose(0.0); p1, h1 = run_pose(1.0)
RUN_CLIP = {
    "cycleFrames": 18, "fps": 24, "keyStepFrames": 2, "inPlace": True,
    "loopClosure": {"poseAtPhase0EqualsPhase1": all(max(abs(a - b) for a, b in zip(p0[k], p1[k])) < 1e-9 for k in p0) and h0 == h1},
    "footLowestPointPerFrameMeters": run_heights,
    "stanceFootMinZ": min(min(run_heights["L"]), min(run_heights["R"])),
    "swingFootMaxOfMinZ": max(max(run_heights["L"]), max(run_heights["R"])),
    "amplitudeVsWalkRadians": {"thighSwing": {"Walk": 0.32, "Run": 0.75}, "kneeFlex": {"Walk": 0.55, "Run": 1.30},
                               "upperArmSwing": {"Walk": 0.22, "Run": 0.45}, "forearmHold": {"Walk": 0.10, "Run": 1.15},
                               "spineLean": {"Walk": 0.04, "Run": 0.14}, "spineTwist": {"Walk": 0.06, "Run": 0.14},
                               "hipsBobMeters": {"Walk": 0.012, "Run": 0.025}},
}

# Stepping turns and Jump proof, from the same pose functions that keyed the NLA actions
def pose_equal(fn, a, b):
    pa, ha = fn(a); pb, hb = fn(b)
    return set(pa) == set(pb) and all(max(abs(x - y) for x, y in zip(pa[k], pb[k])) < 1e-9 for k in pa) and \
        max(abs(x - y) for x, y in zip(ha, hb)) < 1e-9
def hips_track(fn, frames):
    ys = [fn((f - 1) / frames)[0].get("Hips", (0, 0, 0))[1] for f in range(1, frames + 1)]
    xs = [fn((f - 1) / frames)[1][0] for f in range(1, frames + 1)]
    zs = [fn((f - 1) / frames)[1][1] for f in range(1, frames + 1)]
    return {"yawRadians": {"min": round(min(ys), 4), "max": round(max(ys), 4), "mean": round(sum(ys) / len(ys), 5)},
            "lateralMeters": {"min": round(min(xs), 4), "max": round(max(xs), 4), "mean": round(sum(xs) / len(xs), 5)},
            "verticalMeters": {"min": round(min(zs), 4), "max": round(max(zs), 4)}, "forwardMetersBoneLocal": 0.0,
            "note": "offsets are Hips bone-local; the bone axis is tilted about 3 deg, so a vertical offset couples about 5 percent into glTF forward (-Z)"}
def lifted_frames(fn, frames, heights):
    out = {}
    for side in ("L", "R"):
        out[side] = [f for f, z in zip(range(1, frames + 1), heights[side]) if z > 0.01]
    return out
STEP_TURNS = {}
for clip_name, fn in (("TurnLeft", turn_left_pose), ("TurnRight", turn_right_pose)):
    heights = foot_heights(fn, 32)
    STEP_TURNS[clip_name] = {
        "cycleFrames": 32, "fps": 24, "keyStepFrames": 2, "loops": True, "inPlace": True,
        "yawDirection": "positive yaw, A key (counter-clockwise from above)" if clip_name == "TurnLeft" else "negative yaw, D key (clockwise from above)",
        "steppingOrder": ("left foot steps out (frames 1-16), right foot follows (17-32)" if clip_name == "TurnLeft"
                          else "right foot steps out (frames 1-16), left foot follows (17-32)"),
        "loopClosure": {"poseAtPhase0EqualsPhase1": pose_equal(fn, 0.0, 1.0), "bothFeetPlantedAtSeam": heights["L"][0] < 0.005 and heights["R"][0] < 0.005},
        "footLowestPointPerFrameMeters": heights,
        "liftedFrames(>1cm)": lifted_frames(fn, 32, heights),
        "plantedFootMinZ": min(min(heights["L"]), min(heights["R"])), "swingFootPeakZ": max(max(heights["L"]), max(heights["R"])),
        "hipsTrack": hips_track(fn, 32),
        "amplitudesRadians": {"thighTwist": TURN_T, "stepOutAbduction": TURN_A, "plantedDrift": TURN_F, "hipYaw": 0.12, "chestCounterYaw": 0.06,
                              "pelvisRoll": 0.03, "headYawIntoTurn": 0.26, "armBalance": 0.10},
        "assumedSustainedYawRateRadPerSec": round(2 * TURN_T / (16 / 24.0), 3),
    }
STEP_TURNS["mirror"] = "TurnRight is the exact mirror of TurnLeft: L/R bones swapped, Y and Z rotations and Hips X location negated"
jump_heights = foot_heights(jump_pose, 36)
jump_keys_report = []
for name, ph, _, g in JUMP_KEYS:
    pose, (hx, hy, hz) = jump_pose(ph)
    jump_keys_report.append({"phase": ph, "frame": round(1 + ph * 36, 1), "name": name, "grounded": g, "hipsVerticalOffsetMeters": round(hy, 4)})
JUMP_RANGES = {"takeoff": [0.0, 0.33], "airborne": [0.33, 0.78], "landing": [0.78, 1.0],
               "crouch": [0.0, 0.22], "push": [0.22, 0.33], "tuck": [0.33, 0.62], "tuckHold": [0.44, 0.62], "reach": [0.62, 0.78],
               "touchdown": [0.78, 0.80], "absorb": [0.80, 0.90], "recover": [0.90, 1.0]}
grounded_frames = [f for f in range(1, 37) if (f - 1) / 36 <= 0.33 or (f - 1) / 36 >= 0.80]
airborne_frames = [f for f in range(1, 37) if 0.44 <= (f - 1) / 36 <= 0.62]
JUMP_CLIP = {
    "frames": 36, "fps": 24, "keyStepFrames": 2, "loops": False, "poseOnly": True,
    "rootRule": "Hips location is the body's own crouch/extension offset (vertical, zero horizontal); airborne frames keep it at 0. No world-space arc is baked: game physics owns world Y.",
    "phaseMarkersNormalized": JUMP_RANGES,
    "phaseMarkersSeconds": {k: [round(a * 1.5, 3), round(b * 1.5, 3)] for k, (a, b) in JUMP_RANGES.items()},
    "keyPoses": jump_keys_report,
    "footLowestPointPerFrameMeters": jump_heights,
    "groundedFramesMinZ": round(min(min(jump_heights[s][f - 1] for s in ("L", "R")) for f in grounded_frames), 4),
    "airborneFramesMinZ": round(min(min(jump_heights[s][f - 1] for s in ("L", "R")) for f in airborne_frames), 4),
    "hipsTrack": hips_track(jump_pose, 36),
    "runtimeHint": "play takeoff 0 to 0.33 on jump input, hold or ping-pong inside tuckHold 0.44 to 0.62 while airborne, play 0.62 to 1.0 on ground contact",
    "poseSpaceNote": "between push and tuckHold (0.33 to 0.44) and in reach (0.62 to 0.78) the extended feet dip up to about 2 cm below the root floor plane; the character is airborne in physics there, so this is not ground penetration",
}
# Ride clips proof: loop closure, Hips track (seat follow), frame counts against the mount clips
def ride_hips_track(fn, frames):
    locs = [fn((f - 1) / frames)[1] for f in range(1, frames + 1)]
    yaws = [fn((f - 1) / frames)[0].get("Hips", (0, 0, 0))[1] for f in range(1, frames + 1)]
    comp = lambda i: {"min": round(min(l[i] for l in locs), 4), "max": round(max(l[i] for l in locs), 4), "mean": round(sum(l[i] for l in locs) / len(locs), 5)}
    return {"lateralMeters": comp(0), "verticalMeters": comp(1), "backwardMeters": comp(2),
            "yawRadians": {"min": round(min(yaws), 4), "max": round(max(yaws), 4)},
            "note": "Hips bone-local offsets equal the mount seat delta (glTF x, y, z) for the same frame; the rider follows the saddle, no drift"}
RIDE_CLIPS = {}
for g, m_ in RIDE_GAITS.items():
    fn = {"RideIdle": ride_idle_pose, "RideWalk": ride_walk_pose, "RideRun": ride_run_pose}[g]
    RIDE_CLIPS[g] = {"cycleFrames": RIDE_FRAMES[g], "fps": 24, "keyStepFrames": RIDE_STEP[g], "loops": True, "inPlace": True,
                     "mountClip": m_, "mountClipFrames": mount_m.get("clipEvidence", {}).get(m_, {}).get("frames"),
                     "mountClipDurationSeconds": mount_m.get("animationClips", {}).get(m_, {}).get("durationSeconds"),
                     "loopClosure": {"poseAtPhase0EqualsPhase1": pose_equal(fn, 0.0, 1.0)},
                     "hipsTrack": ride_hips_track(fn, RIDE_FRAMES[g]),
                     "seatDeltaSource": "sedgehorn_manifest.json clipEvidence.%s.seatDeltaPerFrameGlb" % m_ if SEAT_DELTA[g] else "none (mount manifest missing): static seat",
                     "spineLeanRadians": RIDE_LEAN[g], "staticPoseSolve": RIDE_REPORT[g]}

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

# ------------------------------------------------------------------------ GLB structure validation (minimal parser, defined above the export)
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
weight_targets = {}
node_names = [n.get("name") for n in nodes]
finger_channels = {}
for a in gltf.get("animations", []):
    dur = max((acc[s["input"]]["max"][0] for s in a.get("samplers", [])), default=0.0)
    first = min((acc[s["input"]]["min"][0] for s in a.get("samplers", [])), default=0.0)
    animations[a["name"]] = {"channels": len(a.get("channels", [])), "durationSeconds": round(dur, 3), "firstKeySeconds": round(first, 4)}
    by_path = {}
    for ch in a.get("channels", []):
        by_path[ch["target"].get("path")] = by_path.get(ch["target"].get("path"), 0) + 1
    animations[a["name"]]["channelsByPath"] = by_path
    finger_channels[a["name"]] = sorted("%s.%s" % (node_names[ch["target"]["node"]], ch["target"]["path"]) for ch in a.get("channels", [])
                                        if node_names[ch["target"]["node"]] in FINGER_BONES)
    animations[a["name"]]["fingerChannels"] = len(finger_channels[a["name"]])
    wt = {}
    for ch in a.get("channels", []):
        if ch["target"].get("path") == "weights":
            s = a["samplers"][ch["sampler"]]
            o = acc[s["output"]]; bv = gltf["bufferViews"][o["bufferView"]]
            start = bv.get("byteOffset", 0) + o.get("byteOffset", 0)
            vals = struct.unpack_from("<%df" % o["count"], blob, start)
            wt[node_names[ch["target"]["node"]]] = {"min": round(min(vals), 3), "max": round(max(vals), 3)}
    weight_targets[a["name"]] = wt
    animations[a["name"]]["morphWeightTracks"] = wt
ext_used = gltf.get("extensionsUsed", [])
checks = {
    "clipsIdleWalkRunTurn": {"Idle", "Walk", "Run", "Turn"} <= set(animations) and all(v["durationSeconds"] > 0 for v in animations.values()),
    "clipsTurnLeftTurnRightJump": {"TurnLeft", "TurnRight", "Jump"} <= set(animations) and len(animations) == 15
                                  and all(animations[k]["durationSeconds"] > 0 for k in ("TurnLeft", "TurnRight", "Jump")),
    "clipsChopDigMineCast": set(WORK_ACTIONS) <= set(animations)
                             and all(animations[k]["durationSeconds"] > 0 and not finger_channels[k]
                                     and not any(node_names[ch["target"]["node"]] == "Root" and ch["target"]["path"] == "translation"
                                                 for ch in next(a for a in gltf["animations"] if a["name"] == k)["channels"])
                                     for k in WORK_ACTIONS),
    "toolGripClipFingerRotationOnly": animations.get("ToolGrip", {}).get("durationSeconds", 0) > 0
                                      and animations.get("ToolGrip", {}).get("channelsByPath") == {"rotation": len(FINGER_BONES)}
                                      and finger_channels.get("ToolGrip") == sorted("%s.rotation" % n for n in FINGER_BONES),
    "locomotionAndRideClipsHaveNoFingerChannels": all(not finger_channels[k] for k in animations if k != "ToolGrip"),
    "neutralHandUnchangedByFingerBones": NEUTRAL_HAND_DRIFT < 1e-5,
    "toolGripFingersClearOfRepresentativeShaft": TOOL_GRIP_REST_FIT["grippedHand"]["verticesInsideShaft"] == 0
                                                 and TOOL_GRIP_REST_FIT["openHand"]["verticesInsideShaft"] == 0,
    "toolGripIsSubtleCurl": all(TOOL_GRIP_DEG[n][0] <= 45.0 and TOOL_GRIP_DEG[n][1] <= 40.0 for n in TOOL_GRIP_DEG),
    "openHandClearsRuntimeContactShaft": OPEN_HAND_RUNTIME_GAP >= 0.0,
    "toolGripFourFingersTouchRuntimeShaft": all(TOOL_GRIP_REST_FIT["perFinger"][n]["gripped"]["minMeters"] <= 0.005 for n in FINGER_NAMES),
    "clipsRideIdleWalkRun": {"RideIdle", "RideWalk", "RideRun"} <= set(animations) and all(animations[k]["durationSeconds"] > 0 for k in RIDE_GAITS),
    "rideClipDurationsMatchMount": all(RIDE_CLIPS[g]["mountClipDurationSeconds"] is not None
                                       and abs(animations.get(g, {}).get("durationSeconds", -1) - RIDE_CLIPS[g]["mountClipDurationSeconds"]) < 1e-3 for g in RIDE_GAITS),
    "rideClipsLoopClosed": all(RIDE_CLIPS[g]["loopClosure"]["poseAtPhase0EqualsPhase1"] for g in RIDE_GAITS),
    "rideClipsNoNetRootMotion": all(abs(RIDE_CLIPS[g]["hipsTrack"]["lateralMeters"]["mean"]) < 0.005 and abs(RIDE_CLIPS[g]["hipsTrack"]["backwardMeters"]["mean"]) < 0.02
                                    and RIDE_CLIPS[g]["hipsTrack"]["yawRadians"] == {"min": 0.0, "max": 0.0} for g in RIDE_GAITS),
    "gripRightNeverAnimated": all("V9_body" not in wt for wt in weight_targets.values()),
    "runShorterThanWalk": animations.get("Run", {}).get("durationSeconds", 9) < animations.get("Walk", {}).get("durationSeconds", 0),
    "runTimelineStartsAtZeroNoHeldFrame": animations.get("Run", {}).get("firstKeySeconds") == 0.0
                                          and abs(animations.get("Run", {}).get("durationSeconds", 0) - RUN_CLIP["cycleFrames"] / RUN_CLIP["fps"]) < 1e-6
                                          and all(r["firstKeyAfter"] == 0.0 and r["lastKeyAfter"] == 0.75 for r in RUN_TIMELINE_PASS["inputAccessors"]),
    "stepTurnsLoopClosed": all(STEP_TURNS[k]["loopClosure"]["poseAtPhase0EqualsPhase1"] and STEP_TURNS[k]["loopClosure"]["bothFeetPlantedAtSeam"]
                               for k in ("TurnLeft", "TurnRight")),
    "stepTurnsNoNetRootMotion": all(abs(STEP_TURNS[k]["hipsTrack"]["yawRadians"]["mean"]) < 1e-3 and abs(STEP_TURNS[k]["hipsTrack"]["lateralMeters"]["mean"]) < 1e-3
                                    and STEP_TURNS[k]["hipsTrack"]["forwardMetersBoneLocal"] == 0.0 for k in ("TurnLeft", "TurnRight")),
    "stepTurnsPlantedFootOnFloor": all(STEP_TURNS[k]["plantedFootMinZ"] > -0.005 for k in ("TurnLeft", "TurnRight")),
    "jumpGroundedFeetOnFloor": JUMP_CLIP["groundedFramesMinZ"] > -0.005,
    "jumpAirborneFeetClear": JUMP_CLIP["airborneFramesMinZ"] > 0.05 and JUMP_CLIP["hipsTrack"]["verticalMeters"]["min"] <= 0.0,
    "oneSkinWith17BodyJointsPlus10FingerJoints": len(skins) == 1 and len(joint_names) == 17 + len(FINGER_BONES) == 27,
    "jointNamesMatchV2PlusRightFingers": set(joint_names) == {n for n, _, _, _ in BONE_SPECS} | set(FINGER_BONES),
    "sevenSocketsWithRole": len(socket_nodes) == 7 and all(v["role"] == "equipment_socket" for v in socket_nodes.values()),
    "noCameras": "cameras" not in gltf,
    "noLights": "KHR_lights_punctual" not in ext_used,
    "floorAtZero": abs(pos_min[1]) < 0.005,
    "heightInRange": 2.1 <= (pos_max[1] - pos_min[1]) <= 2.4,
}
def glb_indices_in_range():
    n_acc, n_bv = len(acc), len(gltf.get("bufferViews", []))
    for a in acc:
        if a.get("bufferView", 0) >= n_bv or ("sparse" in a and max(a["sparse"]["indices"]["bufferView"], a["sparse"]["values"]["bufferView"]) >= n_bv):
            return False
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            refs = list(prim["attributes"].values()) + ([prim["indices"]] if "indices" in prim else []) + [v for t in prim.get("targets", []) for v in t.values()]
            if any(r >= n_acc for r in refs):
                return False
    return all(s["input"] < n_acc and s["output"] < n_acc for a_ in gltf.get("animations", []) for s_ in [a_["samplers"]] for s in s_) \
        and all(sk.get("inverseBindMatrices", 0) < n_acc for sk in skins)
def sparse_target_max_displacement(mesh_name, target_index=0):
    mesh = next((m for m in gltf.get("meshes", []) if m.get("name") == mesh_name), None)
    worst = 0.0
    for prim in (mesh or {}).get("primitives", []):
        a = acc[prim["targets"][target_index]["POSITION"]]
        if "sparse" not in a:
            continue
        sp = a["sparse"]; vb = gltf["bufferViews"][sp["values"]["bufferView"]]
        vals = struct.unpack_from("<%df" % (sp["count"] * 3), blob, vb.get("byteOffset", 0) + sp["values"].get("byteOffset", 0))
        worst = max(worst, max(math.sqrt(vals[i] ** 2 + vals[i + 1] ** 2 + vals[i + 2] ** 2) for i in range(0, len(vals), 3)))
    return worst
GRIP_MORPH_MAX_BLENDER = max((Vector(v) - Vector(HP[j])).length for j, v in enumerate(grip_co))
GRIP_MORPH_MAX_GLB = sparse_target_max_displacement("V9_body")
eye_mesh = next((m for m in gltf.get("meshes", []) if m.get("name") == "V9_eyes"), None)
checks["forwardIsNegativeZ"] = bool(eye_mesh) and all(
    acc[p["attributes"]["POSITION"]]["max"][2] < 0 for p in eye_mesh["primitives"])   # the eyes sit entirely on the -Z side
checks["glbIndicesInRangeAfterChannelPass"] = glb_indices_in_range()
checks["gripRightTargetDataIntactAfterChannelPass"] = abs(GRIP_MORPH_MAX_BLENDER - GRIP_MORPH_MAX_GLB) < 1e-3   # sparse morph buffers survived the prune
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
body_mesh = next((m for m in gltf.get("meshes", []) if m.get("name") == "V9_body"), {})
body_targets = [p.get("targets", []) for p in body_mesh.get("primitives", [])]
checks["gripRightMorphExported"] = (body_mesh.get("extras", {}).get("targetNames") == ["GripRight"]
                                    and bool(body_targets) and all(len(t) == 1 and "POSITION" in t[0] for t in body_targets)
                                    and body_mesh.get("weights", [0.0]) == [0.0])
checks["gripRightSkinClearOfHandle"] = GRIP["skinToHandleAxisMeters"]["verticesInsideHandle"] == 0
GRIP["glb"] = {"meshName": body_mesh.get("name"), "targetNames": body_mesh.get("extras", {}).get("targetNames"),
               "defaultWeights": body_mesh.get("weights"), "primitivesWithTargets": len(body_targets)}
drape_meshes = {m.get("name"): m for m in gltf.get("meshes", []) if m.get("name") in ("V9_robe", "V9_tunic")}
checks["rideDrapeMorphExported"] = MOUNT_AVAILABLE and all(
    drape_meshes.get(n, {}).get("extras", {}).get("targetNames") == ["RideDrape"] and drape_meshes.get(n, {}).get("weights", [0.0]) == [0.0]
    and all(len(p.get("targets", [])) == 1 for p in drape_meshes.get(n, {}).get("primitives", [])) for n in ("V9_robe", "V9_tunic"))
checks["rideDrapeWeightTracksComplete"] = MOUNT_AVAILABLE and all(
    weight_targets.get(c, {}).get(n, {}).get("max") == (1.0 if c in RIDE_GAITS else 0.0) and weight_targets.get(c, {}).get(n, {}).get("min") == (1.0 if c in RIDE_GAITS else 0.0)
    for c, *_ in CLIPS for n in ("V9_robe", "V9_tunic"))
_fit = RIDE_FIT.get("rideIdleFrame1", {})
checks["rideLegsClearOfMount"] = MOUNT_AVAILABLE and all(_fit.get(n, {}).get("deepestPenetrationMeters", 1) < 0.025 for n in ("V9_boots", "V9_trousers"))   # calf/boot contact with the flank, under 2.5 cm
checks["rideClothClearOfMount"] = MOUNT_AVAILABLE and all(_fit.get(n, {}).get("deepestPenetrationMeters", 1) < 0.02 for n in ("V9_robe", "V9_tunic"))
checks["rideHandsAtReins"] = all(RIDE_REPORT[g][s]["knuckleToReinHandMeters"] < 0.06 for g in RIDE_GAITS for s in ("L", "R"))
checks["rideBootsOnStirrups"] = all(RIDE_REPORT[g][s]["ankleToStirrupTargetMeters"] < 0.03 for g in RIDE_GAITS for s in ("L", "R"))
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
                         "reuse": "17 deform-bone names/hierarchy, seven socket names with role extras, NLA clip layout (Idle/Walk/Turn, plus Run authored here); "
                                  "no V2 geometry, materials or weights are used"},
        "authoredHere": ["full-length V9_robe", "V9_sleeves", "V9_belt (+buckle)", "V9_trousers", "V9_boots", "V9_feet (barefoot variant, split from the CC0 body)", "V9_satchel",
                         "V9_strap hip extension", "distance-falloff skinning", "Idle/Walk/Run/Turn/TurnLeft/TurnRight/Jump/RideIdle/RideWalk/RideRun/Chop/Dig/Mine/Cast clips", "RideDrape robe/tunic morph", "sockets", "camera/light rigs",
                         "right-hand finger bones (10) and the finger-only ToolGrip clip"],
        "thirdPartyPixelsOrMeshes": "none beyond the CC0 base mesh; concept sheets are visual targets only",
        "license": "Derived asset: CC0 base mesh plus original Wizard Realms geometry, materials and rig authored in-repo.",
    },
    "sourceAxes": {"up": "+Z", "forward": "+Y", "origin": "floor between feet"},
    "glbAxes": {"up": "+Y", "forward": "-Z", "origin": "floor between feet"},
    "boundsMetersGlb": {"min": [round(x, 4) for x in pos_min], "max": [round(x, 4) for x in pos_max]},
    "boundsMetersBlender": {"min": [round(pos_min[0], 4), round(-pos_max[2], 4), round(pos_min[1], 4)],
                            "max": [round(pos_max[0], 4), round(-pos_min[2], 4), round(pos_max[1], 4)]},
    "heightMeters": round(height, 4),
    "deformBones": [n for n, _, _, _ in BONE_SPECS] + FINGER_BONES,
    "fingerBones": FINGER_BONES,
    "toolGrip": {
        "clip": "ToolGrip", "poseStatus": "solved_against_runtime_contact",
        "poseStatusNote": "Finger angles were solved against the representative shaft below: axis through the runtime's shared contact line "
                          "V9_RIGHT_HAND_CONTACT (src/view/WizardScene.tsx, read-only) along glTF Z at rest, hand-relative as rightHandToolMountFor "
                          "mounts it against the rest Socket.RightHand. If that constant or the mount regime changes, re-run author_v9_game.py with "
                          "RUNTIME_CONTACT_GLB updated; bones, weights, channels and the neutral hand do not depend on it.",
        "runtimeContract": {"contactGlb": list(RUNTIME_CONTACT_GLB), "contactSource": "src/view/WizardScene.tsx V9_RIGHT_HAND_CONTACT",
                            "mount": "hand-relative: rightHandToolMountFor(mainHand, restSocket) places the shaft axis through the contact once, "
                                     "in rest Socket.RightHand space; carry along avatar -Z (axe/pick/wand) or +Z (spade)",
                            "equippedArmCarryBlend": RUNTIME_CARRY_BLEND,
                            "artDerivedAxisPointRestGlb": blender_to_gltf(ART_SHAFT_C),
                            "runtimeMinusArtDerivedGlb": [round(a - b, 4) for a, b in zip(blender_to_gltf(SHAFT_C), blender_to_gltf(ART_SHAFT_C))],
                            "openHandClearanceToRuntimeShaftMeters": round(OPEN_HAND_RUNTIME_GAP, 4)},
        "channels": ["%s.rotation" % n for n in FINGER_BONES],
        "channelRule": "finger bones only, constant two-key clip; no Hand.R, arm, Hips, Root, robe/tunic weight or face channel. On-foot and ride clips "
                       "carry no finger channels, so ToolGrip layered at weight 1 only closes the fingers. GripRight stays at weight 0 and unanimated.",
        "usage": "play ToolGrip (loop, weight 1) alongside the locomotion clip only while a main-hand tool is equipped; stop it to return to the approved open hand",
        "durationSeconds": animations.get("ToolGrip", {}).get("durationSeconds"),
        "curlDegrees": {n: {"knuckle": round(TOOL_GRIP_DEG[n][0], 1), "secondJoint": round(TOOL_GRIP_DEG[n][1], 1),
                            "capKnuckle": TOOL_GRIP_MAX_DEG[n][0], "capSecondJoint": TOOL_GRIP_MAX_DEG[n][1]} for n in FINGER_NAMES + ["Thumb"]},
        "curlAxis": "each finger bone's local +X (palm-side roll); positive curls toward the palm; the thumb rolls toward the fingers and palm",
        "representativeShaft": {"radiusMeters": TOOL_GRIP_SHAFT_R, "openHandGapMeters": TOOL_GRIP_GAP,
                                "axisDirectionGlb": [0.0, 0.0, 1.0], "axisPointRestGlb": blender_to_gltf(SHAFT_C),
                                "axisPointRestBlender": [round(c, 4) for c in SHAFT_C],
                                "axisPointInSocketRightHandGlb": None,          # filled below from the exported socket transform
                                "placementRule": "axis through the runtime contact line (handle to the back, head forward, along glTF Z at rest), hand-relative; "
                                                 "the hand is not moved toward the tool and the open hand must clear the shaft"},
        "restFit": TOOL_GRIP_REST_FIT,
        "clipFrameFit": TOOL_GRIP_FRAME_FIT,
        "fingerJointsRestBlender": {n: {"knuckle": [round(c, 4) for c in FINGER_JOINTS[n][3]], "secondJoint": [round(c, 4) for c in FINGER_JOINTS[n][4]],
                                        "tip": [round(c, 4) for c in FINGER_JOINTS[n][5]]} for n in FINGER_NAMES + ["Thumb"]},
        "weights": FINGER_WEIGHT_STATS,
        "neutralHandMaxDriftMeters": NEUTRAL_HAND_DRIFT,
        "glbChannelPass": {"rule": "post-export: finger channels removed from every clip except ToolGrip; ToolGrip keeps only the ten finger rotation "
                                   "channels (the NLA exporter bakes every bone into every track). Remaining channels are the exporter's own output; "
                                   "orphaned accessors/bufferViews pruned with indices remapped, binary blob untouched.",
                           "perClip": TOOL_GRIP_CHANNEL_PASS},
    },
    "equipmentSockets": socket_nodes,
    "animationClips": animations,
    "workActionClips": {name: {"durationSeconds": animations.get(name, {}).get("durationSeconds"), "loops": False,
                                "inPlace": True, "neutralAtStartAndEnd": True} for name in WORK_ACTIONS},
    "runClip": {**RUN_CLIP,
                "glbTimeline": {"firstKeySeconds": animations.get("Run", {}).get("firstKeySeconds"), "closingKeySeconds": animations.get("Run", {}).get("durationSeconds"),
                                "rule": "post-export: Run's time accessors are shifted so the first key is t=0 and the closing (loop-matching) key is cycleFrames/fps; "
                                        "LoopRepeat then has no held first frame. Output values, channel set, interpolation and every other clip are untouched. "
                                        "Idle/Walk/Turn/Jump and the ride clips keep the exporter's 1/24 s start (the runtime drives Idle/Walk by phase; "
                                        "ride clips must keep the mount's durations).",
                                "pass": RUN_TIMELINE_PASS}},
    "stepTurnClips": STEP_TURNS,
    "jumpClip": JUMP_CLIP,
    "rideClips": {
        "clips": RIDE_CLIPS,
        "mountAsset": {"glb": os.path.relpath(os.path.join(MOUNT_DIR, "sedgehorn_adult.glb"), HERE), "manifest": os.path.relpath(MOUNT_MANIFEST, HERE),
                       "mountGlbSha256": mount_m.get("sha256", {}).get("glb"), "available": MOUNT_AVAILABLE},
        "riderSeatOffsetGlb": blender_to_gltf(RIDE_ROOT),
        "riderSeatOffsetBlender": [round(c, 4) for c in RIDE_ROOT],
        "riderSeatOffsetRule": "mount-local translation of the rider root (its floor origin), no rotation: Seat.glbPosition + (0, -%.3f, +0.02 forward); "
                               "rider and mount both face -Z. Apply as RIDER_SEAT_OFFSET in the workbench; the ride clips then put the pelvis on the seat." % SEATED_PELVIS_DROP,
        "seatGlb": blender_to_gltf(SEAT_B), "stirrupTreadGlb": {s: blender_to_gltf(v) for s, v in STIRRUP_B.items()}, "reinHandGlb": {s: blender_to_gltf(v) for s, v in REIN_B.items()},
        "seatedPelvisDropMeters": SEATED_PELVIS_DROP,
        "staticPose": {"kneePoleBlender": list(KNEE_POLE),
                       "handDirectionBlender": [round(c, 3) for c in HAND_DIR], "handPalmNormalBlender(right)": [round(c, 3) for c in Vector((-HAND_PRONATION, 0.0, -1.0)).normalized()], "ankleAboveTreadMeters": ANKLE_ABOVE_TREAD,
                       "solver": "2-bone IK hip/knee/ankle to the stirrup tread + ankle height with the knee pole; foot aimed level; 2-bone IK upper arm/forearm to the rein end minus 12.5 cm along the hand; hand aimed along the rein with the palm turned down-and-in"},
        "gripRight": "weight 0 in every clip and never animated; the open Basis hand rests on the rein ends",
        "heldTools": "the workbench hides held tools in riding mode; sockets are unchanged",
        "drapeMorph": {"name": "RideDrape", "meshes": DRAPE, "weightRule": "1.0 across RideIdle/RideWalk/RideRun, 0.0 across all on-foot clips (keyed in every clip)",
                       "method": "skirt rows below z=0.98 released from the pose and settled as position-based cloth (gravity steps, grid and diagonal distance constraints at the authored rest lengths, 1.6 cm push-out from the mount body/saddle/blanket and the rider's trousers/boots), then inverted through the seated skinning matrices into a rest-space offset"},
        "fit": RIDE_FIT,
    },
    "footwearVariants": FOOTWEAR,
    "gripMorph": GRIP,
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
        "Skinning is smooth distance falloff, tuned for the Idle/Walk/Run/Turn/TurnLeft/TurnRight/Jump amplitudes, not hand-painted weights.",
        "Riding: the robe and tunic skirt use the RideDrape morph (solved once for the seated pose) instead of cloth simulation; it is keyed 1 in the ride clips and 0 elsewhere, so a blend between an on-foot and a ride clip crossfades the drape.",
        "Run is in place with no root motion or foot IK; the stance foot dips a few centimetres through the floor at mid-stance.",
        "V9_feet and V9_boots are both exported visible; the runtime must toggle them (feet sole and boot sole share the floor plane).",
    ],
    "peakProcessMemoryMB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1),
    "authorSeconds": round(time.time() - T0, 2),
    "blender": bpy.app.version_string,
    "command": "blender -b -t 4 --factory-startup --python author_v9_game.py",
    "scopeGuards": {"editsOutsideThisDirectory": "only byte-identical copies added to ../wayfarer_v9_approved", "github": False,
                    "commit": False, "previewPorts": False, "gameSave": False, "v3DirectoryModified": False, "v9StagingModified": False},
}
_si = next(i for i, n_ in enumerate(nodes) if n_.get("name") == "Socket.RightHand")
_sm = world[_si]
manifest["toolGrip"]["representativeShaft"]["axisPointInSocketRightHandGlb"] = [round(c, 4) for c in (_sm.inverted() @ Vector(blender_to_gltf(SHAFT_C)))]
manifest["toolGrip"]["representativeShaft"]["axisDirectionInSocketRightHandGlb"] = [round(c, 4) for c in (_sm.to_3x3().inverted() @ Vector((0.0, 0.0, 1.0))).normalized()]
# carry the render and review-sheet records over from the previous manifest; each block states which GLB it was rendered from,
# so a reviewer can tell stale proofs apart from current ones without re-rendering unchanged views
prev = json.load(open(OUT_MANIFEST)) if os.path.exists(OUT_MANIFEST) else {}
for key in ("renders", "reviewSheets", "toolGripRenders", "toolGripReviewSheet"):
    if key in prev:
        manifest[key] = prev[key]
        manifest[key]["currentForGlb"] = prev[key].get("renderedFromGlbSha256") == GLB_SHA
with open(OUT_MANIFEST, "w") as f:
    json.dump(manifest, f, indent=1)
print("AUTHOR_DONE", json.dumps({k: manifest[k] for k in ("trianglesGlb", "trianglesEvaluated", "drawGroups", "materialCount",
                                                           "glbBytes", "heightMeters", "glbStructureValid", "glbChecks",
                                                           "peakProcessMemoryMB", "authorSeconds")}))
