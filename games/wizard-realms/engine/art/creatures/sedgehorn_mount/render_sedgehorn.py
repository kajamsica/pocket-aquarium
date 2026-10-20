"""Review renders for the adult sedgehorn mount, alone or with the V9 Wayfarer seated on it.

    blender -b -t 4 --factory-startup --python render_sedgehorn.py -- mount [samples]
    blender -b -t 4 --factory-startup --python render_sedgehorn.py -- ride [samples]
    blender -b -t 4 --factory-startup --python render_sedgehorn.py -- <view> [samples]

mount views (mount_<view>.png, 1024x768 orthographic): front | side | three_quarter | walk (Walk frame 9) | run (Run frame 6)
ride views (ride_<view>.png): the V9 rider appended from ../../characters/wayfarer_v9_game/wayfarer_v9_male.blend, placed at the
RIDER_SEAT_OFFSET recorded in the V9 manifest (rideClips block), rider clip Ride* paired with the mount clip at the same phase:
front | side | three_quarter (RideIdle/Idle frame 1) | walk (RideWalk/Walk frame 9) | run (RideRun/Run frame 6)
Ride views also run the rider-to-mount contact and intersection checks and write them to sedgehorn_manifest.json "riderFit".
No GLB is modified here; records go to sedgehorn_manifest.json "renders".
"""
import bpy, sys, math, os, time, resource, json
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
RIDER_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "characters", "wayfarer_v9_game"))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["mount"]
which = argv[0]; samples = int(argv[1]) if len(argv) > 1 else 48
ANGLES = {"front": 0.0, "three_quarter": 40.0, "side": 90.0, "back": 180.0}
CLIP_FRAMES = {"walk": ("Walk", "RideWalk", 9), "run": ("Run", "RideRun", 6)}
MOUNT_VIEWS = ["front", "side", "three_quarter", "walk", "run"]
RIDE_VIEWS = ["front", "side", "three_quarter", "walk", "run", "back"]
if which == "mount":
    todo = [("mount", v) for v in MOUNT_VIEWS]
elif which == "ride":
    todo = [("ride", v) for v in RIDE_VIEWS]
else:
    kind, _, view = which.partition("_")
    todo = [(kind, view)]

bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, "sedgehorn_adult.blend"))
sc = bpy.context.scene
cam_rig = bpy.data.objects["SH_RIG"]; mount_rig = bpy.data.objects["SedgehornRig"]
mount_meshes = [ob for ob in bpy.data.objects if ob.type == 'MESH' and ob.name.startswith("SH_")]
manifest_path = os.path.join(HERE, "sedgehorn_manifest.json")
m = json.load(open(manifest_path))

def set_clip(rig, name, frame):
    # assign the clip's action directly (NLA mute toggles do not re-evaluate reliably inside one background session)
    for t in rig.animation_data.nla_tracks:
        t.mute = True
    rig.animation_data.action = bpy.data.actions[name] if name else None
    if name is None:
        for pb in rig.pose.bones:
            pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
    rig.update_tag(); sc.frame_set(frame); bpy.context.view_layer.update()

rider_rig = None; rider_meshes = []; rider_offset = None
if any(k == "ride" for k, _ in todo):
    v9 = json.load(open(os.path.join(RIDER_DIR, "male_manifest.json")))
    ride = v9["rideClips"]
    rider_offset = Vector(ride["riderSeatOffsetBlender"])
    with bpy.data.libraries.load(os.path.join(RIDER_DIR, "wayfarer_v9_male.blend"), link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n == "WayfarerV9Rig" or n.startswith("V9_") or n.startswith("Socket.")]
    for ob in dst.objects:
        if ob is None:
            continue
        sc.collection.objects.link(ob)
        if ob.type == 'MESH':
            rider_meshes.append(ob)
        elif ob.type == 'ARMATURE':
            rider_rig = ob
    rider_rig.location = rider_offset
    for ob in rider_meshes:
        if ob.name == "V9_body" and ob.data.shape_keys:
            ob.data.shape_keys.key_blocks["GripRight"].value = 0.0      # rejected morph stays dormant
        if ob.name in ("V9_robe", "V9_tunic") and ob.data.shape_keys and "RideDrape" in ob.data.shape_keys.key_blocks:
            sk = ob.data.shape_keys
            if sk.animation_data:
                for t in sk.animation_data.nla_tracks:
                    t.mute = True
                sk.animation_data.action = None
            sk.key_blocks["RideDrape"].value = 1.0                      # what the ride clips key (weight tracks are 1.0 across Ride*)
        if ob.name == "V9_feet":
            ob.hide_render = True                                         # boots-on riding preview
    bpy.context.view_layer.update()

def rider_fit():
    """Signed clearance of rider surfaces against the mount + tack, and rider sit metrics, at the current frame."""
    dg = bpy.context.evaluated_depsgraph_get()
    trees = []                                        # one BVH per mount shell so the inside test is meaningful per closed surface
    for ob in mount_meshes:
        if ob.name not in ("SH_body", "SH_saddle", "SH_blanket"):
            continue
        ev = ob.evaluated_get(dg); me = ev.to_mesh(); me.transform(ob.matrix_world)
        bm = bmesh.new(); bm.from_mesh(me); ev.to_mesh_clear()
        trees.append((BVHTree.FromBMesh(bm), {"SH_saddle": 0.05, "SH_blanket": 0.025}.get(ob.name))); bm.free()   # (tree, shell depth cap)
    out = {"mountShellsTested": ["SH_body", "SH_saddle", "SH_blanket"]}
    for name in ("V9_body", "V9_robe", "V9_boots", "V9_trousers", "V9_tunic", "V9_satchel", "V9_sleeves"):
        ob = bpy.data.objects.get(name)
        if ob is None:
            continue
        ev = ob.evaluated_get(dg); me = ev.to_mesh()
        inside = 0; deepest = 0.0; nearest = 9.0; n = len(me.vertices)
        for v in me.vertices:
            p = ob.matrix_world @ v.co
            depth = 0.0; near = 9.0
            for tree, cap in trees:
                loc, nrm, idx, dist = tree.find_nearest(p)
                if loc is None:
                    continue
                if nrm.dot(p - loc) < 0 and (cap is None or dist < cap):
                    depth = max(depth, dist)
                else:
                    near = min(near, dist)
            if depth > 0:
                inside += 1; deepest = max(deepest, depth)
            else:
                nearest = min(nearest, near)
        ev.to_mesh_clear()
        out[name] = {"vertices": n, "verticesInsideMount": inside, "deepestPenetrationMeters": round(deepest, 4), "nearestOutsideMeters": round(nearest, 4)}
    body = bpy.data.objects["V9_body"]; ev = body.evaluated_get(dg); me = ev.to_mesh()
    hands = {s: [body.matrix_world @ v.co for v in me.vertices if (body.data.vertices[v.index].co.x > 0.33 if s == "R" else body.data.vertices[v.index].co.x < -0.33)
                 and body.data.vertices[v.index].co.z < 1.25] for s in ("L", "R")}
    out["handCentreWorld"] = {s: [round(c, 3) for c in (sum(hs, Vector()) / len(hs))] for s, hs in hands.items() if hs}
    ev.to_mesh_clear()
    # the V9 body has no pelvis skin (cut under the cloth): pelvis bottom = hip joint minus the seated pelvis depth from the V9 manifest
    hip = rider_rig.matrix_world @ rider_rig.pose.bones["Thigh.R"].head
    drop = json.load(open(os.path.join(RIDER_DIR, "male_manifest.json")))["rideClips"]["seatedPelvisDropMeters"]
    out["hipJointWorldZ"] = round(hip.z, 4)
    out["pelvisBottomWorldZ"] = round(hip.z - (0.95 - drop), 4)
    out["pelvisBottomAboveSeatMeters"] = round(hip.z - (0.95 - drop) - bpy.data.objects["Seat"].matrix_world.translation.z, 4)
    out["seatWorldZ"] = round(bpy.data.objects["Seat"].matrix_world.translation.z, 4)
    out["reinHandWorld"] = {s: [round(c, 3) for c in bpy.data.objects["ReinHand." + s].matrix_world.translation] for s in ("L", "R")}
    boots = bpy.data.objects["V9_boots"]; ev = boots.evaluated_get(dg); me = ev.to_mesh()
    soles = {s: min((boots.matrix_world @ v.co).z for v in me.vertices if (v.co.x > 0) == (s == "R")) for s in ("L", "R")}
    out["bootSoleLowestWorldZ"] = {s: round(z, 4) for s, z in soles.items()}
    out["stirrupTreadWorldZ"] = {s: round(bpy.data.objects["Stirrup." + s].matrix_world.translation.z, 4) for s in ("L", "R")}
    ev.to_mesh_clear()
    return out

records = []; fits = {}
sc.cycles.samples = samples
for kind, view in todo:
    t0 = time.time()
    base = view
    angle = ANGLES["three_quarter" if base in CLIP_FRAMES else base]
    cam_rig.rotation_euler = (0.0, 0.0, math.radians(-angle))
    mount_clip, rider_clip, frame = CLIP_FRAMES.get(base, (None, None, 1))
    if kind == "ride":
        set_clip(mount_rig, mount_clip or "Idle", frame)
        set_clip(rider_rig, rider_clip or "RideIdle", frame)
    else:
        set_clip(mount_rig, mount_clip, frame)
    for ob in rider_meshes:
        if ob.name != "V9_feet":
            ob.hide_render = kind != "ride"
    cam = bpy.data.objects["SH_CAM"]
    cam.data.ortho_scale = 4.9 if kind == "ride" else 4.6
    cam.location.z = 0.45 if kind == "ride" else 0.0
    sc.camera = cam
    out = os.path.join(HERE, "%s_%s.png" % (kind, view))
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    rec = {"view": "%s_%s" % (kind, view), "out": os.path.basename(out), "samples": samples, "seconds": round(time.time() - t0, 2),
           "resolution": [sc.render.resolution_x, sc.render.resolution_y], "engine": "CYCLES/CPU",
           "pose": ("%s frame %d" % (mount_clip, frame)) if mount_clip else "rest", "riderClip": rider_clip if kind == "ride" else None,
           "maxRSSBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
    if kind == "ride":
        fits[rec["view"]] = rider_fit()
    records.append(rec); print("RENDER_DONE", json.dumps(rec), flush=True)

m = json.load(open(manifest_path))
block = m.setdefault("renders", {"views": []})
kept = [r for r in block.get("views", []) if r["view"] not in {r2["view"] for r2 in records}]
block["views"] = kept + records
block["renderedFromGlbSha256"] = m["sha256"]["glb"]
block["settings"] = {"engine": "Cycles CPU", "samples": samples, "threads": 4, "camera": "orthographic SH_CAM, pivot (0,0.45,1.65) Blender", "blender": bpy.app.version_string,
                     "peakRSSMiB": round(max(r["maxRSSBytes"] for r in block["views"]) / 1048576, 1)}
if fits:
    rf = m.setdefault("riderFit", {})
    rf.update(fits); rf["riderGlbSha256"] = json.load(open(os.path.join(RIDER_DIR, "male_manifest.json")))["sha256"]["glb"]
    rf["riderSeatOffsetBlender"] = list(rider_offset)
# A partial rerender does not make older views current. Ride stills also depend on
# the rider .blend, so matching GLB hashes alone cannot establish their freshness.
expected = {"mount_" + view for view in MOUNT_VIEWS} | {"ride_" + view for view in RIDE_VIEWS}
recorded = {rec["view"]: rec for rec in block["views"]}
source_paths = {
    "mount": [os.path.join(HERE, name) for name in ("sedgehorn_adult.blend", "sedgehorn_adult.glb")],
    "ride": [os.path.join(RIDER_DIR, name) for name in ("wayfarer_v9_male.blend", "wayfarer_v9_male.glb")],
}
source_times = {kind: max(map(os.path.getmtime, paths)) for kind, paths in source_paths.items()
                if all(map(os.path.exists, paths))}
rider_manifest_path = os.path.join(RIDER_DIR, "male_manifest.json")
rider_sha = json.load(open(rider_manifest_path))["sha256"]["glb"] if os.path.exists(rider_manifest_path) else None
block["currentForGlb"] = (block["renderedFromGlbSha256"] == m["sha256"]["glb"]
    and rider_sha is not None and m.get("riderFit", {}).get("riderGlbSha256") == rider_sha
    and all(view in recorded and recorded[view]["out"] == view + ".png"
            and view.split("_", 1)[0] in source_times
            and os.path.exists(os.path.join(HERE, view + ".png"))
            and os.path.getmtime(os.path.join(HERE, view + ".png")) >= source_times[view.split("_", 1)[0]]
            for view in expected))
json.dump(m, open(manifest_path, "w"), indent=1)
print("ALL_RENDERS_DONE", json.dumps({"peakRSSMiB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1)}))
