"""Static review renders of the exported Wayfarer V9 game mesh. One headless process renders every view.

    blender -b -t 4 --factory-startup --python render_v9_game.py -- all [samples]
    blender -b -t 4 --factory-startup --python render_v9_game.py -- front [samples]

Body views (male_<view>.png, 576x1024, orthographic turnaround): front | three_quarter | side | back (boots on)
Barefoot views (male_barefoot_<view>.png): barefoot_front | barefoot_three_quarter | barefoot_side | barefoot_walk (Walk frame 7)
V9 match views (v9match_<view>.png, 512x512): the exact V9 bust camera, pivot, lens, distance and lights
from wayfarer_v9_staging, so the game mesh can be compared one-to-one with the approved V9 renders.
Renders use the same evaluated geometry the GLB export applied (no extra subdivision).
Writes a "renders" block into male_manifest.json.
"""
import bpy, sys, math, os, time, resource, json

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["all"]
which = argv[0]
samples = int(argv[1]) if len(argv) > 1 else 64
ANGLES = {"front": 0.0, "three_quarter": 40.0, "side": 90.0, "back": 180.0}
# barefoot_<view>: V9_boots hidden, V9_feet shown (gear.boots=false state); barefoot_walk is the three-quarter view at Walk frame 7
BAREFOOT = ["barefoot_front", "barefoot_three_quarter", "barefoot_side", "barefoot_walk"]
VIEWS = list(ANGLES) + ["v9_" + v for v in ANGLES] + BAREFOOT
todo = VIEWS if which == "all" else [which]

bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, "wayfarer_v9_male.blend"))
sc = bpy.context.scene
rig = bpy.data.objects["V9_RIG"]
feet, boots = bpy.data.objects["V9_feet"], bpy.data.objects["V9_boots"]
skel = bpy.data.objects["WayfarerV9Rig"]
def set_clip(name, frame):
    for t in skel.animation_data.nla_tracks:
        t.mute = name is None or t.name != name
    sc.frame_set(frame)
bust_lights = [bpy.data.objects[n] for n in ("V9_KEY", "V9_FILL", "V9_RIM")]
body_lights = [bpy.data.objects[n] for n in ("V9G_KEY", "V9G_FILL", "V9G_RIM")]
sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.use_denoising = True; sc.cycles.device = 'CPU'
sc.render.threads_mode = 'FIXED'; sc.render.threads = 4
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'

records = []
for view in todo:
    t0 = time.time()
    bust = view.startswith("v9_")
    barefoot = view.startswith("barefoot_")
    base = view[3:] if bust else view[9:] if barefoot else view
    angle = ANGLES["three_quarter" if base == "walk" else base]
    rig.rotation_euler = (0.0, 0.0, math.radians(-angle))
    boots.hide_render = barefoot
    feet.hide_render = not barefoot
    set_clip("Walk" if base == "walk" else None, 7 if base == "walk" else 1)
    sc.camera = bpy.data.objects["V9_CAM" if bust else "V9G_CAM_BODY"]
    for ob in bust_lights:
        ob.hide_render = not bust
    for ob in body_lights:
        ob.hide_render = bust
    if bust:
        sc.render.resolution_x = sc.render.resolution_y = 512
        out = os.path.join(HERE, "v9match_%s.png" % view[3:])
    else:
        sc.render.resolution_x, sc.render.resolution_y = 576, 1024
        out = os.path.join(HERE, "male_%s.png" % view)
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    rec = {"view": view, "out": os.path.basename(out), "samples": samples, "seconds": round(time.time() - t0, 2),
           "resolution": [sc.render.resolution_x, sc.render.resolution_y], "engine": "CYCLES/CPU",
           "camera": sc.camera.name, "footwear": "V9_feet" if barefoot else "V9_boots",
           "pose": "Walk frame 7" if base == "walk" else "rest",
           "maxRSSBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
    records.append(rec)
    print("RENDER_DONE", json.dumps(rec), flush=True)

manifest_path = os.path.join(HERE, "male_manifest.json")
if os.path.exists(manifest_path):
    m = json.load(open(manifest_path))
    block = m.setdefault("renders", {"views": [], "settings": {}})
    kept = [r for r in block["views"] if r["view"] not in {r2["view"] for r2 in records}]
    block["views"] = kept + records
    block["settings"] = {"engine": "Cycles CPU", "samples": samples, "denoise": "OpenImageDenoise", "maxBounces": sc.cycles.max_bounces,
                         "threads": 4, "viewTransform": sc.view_settings.view_transform,
                         "bodyCamera": "orthographic, ortho_scale 2.62, pivot (0,0,1.16), 576x1024",
                         "v9MatchCamera": "85 mm, 36 mm sensor, pivot (0,0,1.92), distance 2.125 m, 512x512, V9 lights",
                         "command": "blender -b -t 4 --factory-startup --python render_v9_game.py -- all 64",
                         "blender": bpy.app.version_string,
                         "peakRSSMiB": round(max(r["maxRSSBytes"] for r in block["views"]) / 1048576, 1)}
    json.dump(m, open(manifest_path, "w"), indent=1)
print("ALL_RENDERS_DONE", json.dumps({"peakRSSMiB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1)}))
