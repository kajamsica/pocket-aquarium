"""Compose the V9 game-asset review sheets (PIL only, no Blender).

    python3 contact_sheet_v9_game.py

Writes contact_sheet.png (four full-body views) and comparison_vs_v9.png
(approved V9 staging bust row / this asset at the V9 camera / this asset full body),
then records their sha256 in male_manifest.json under "reviewSheets".
"""
import os, json, hashlib
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
V9_STAGING = os.path.normpath(os.path.join(HERE, "..", "wayfarer_v9_approved"))   # byte-identical copies of the approved V9 renders
BAREFOOT_VIEWS = ["barefoot_front", "barefoot_three_quarter", "barefoot_side", "barefoot_walk"]
VIEWS = ["front", "three_quarter", "side", "back"]
BG = (108, 108, 112)
BAR = 18
BODY_W, BODY_H = 576, 1024
CELL = 512


def label(img, y, text):
    d = ImageDraw.Draw(img)
    d.rectangle((0, y, img.width, y + BAR), fill=(30, 30, 34))
    d.text((6, y + 3), text, fill=(235, 235, 235))


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


# 1) four full-body views at native scale
sheet = Image.new("RGB", (4 * BODY_W, BODY_H + BAR), BG)
for i, v in enumerate(VIEWS):
    im = Image.open(os.path.join(HERE, "male_%s.png" % v)).convert("RGB")
    assert im.size == (BODY_W, BODY_H), im.size
    sheet.paste(im, (i * BODY_W, BAR))
label(sheet, 0, "Wayfarer V9 game asset (wayfarer_v9_male.glb source)  |  front / three-quarter / side / back  |  576x1024, Cycles CPU 64spp, orthographic, same lights  |  boots on (V9_boots)")
sheet.save(os.path.join(HERE, "contact_sheet.png"))

# 1b) barefoot variant: V9_boots hidden, V9_feet shown; last cell is the Walk clip at frame 7
bare = Image.new("RGB", (4 * BODY_W, BODY_H + BAR), BG)
for i, v in enumerate(BAREFOOT_VIEWS):
    im = Image.open(os.path.join(HERE, "male_%s.png" % v)).convert("RGB")
    assert im.size == (BODY_W, BODY_H), im.size
    bare.paste(im, (i * BODY_W, BAR))
label(bare, 0, "Barefoot variant (V9_feet visible, V9_boots hidden = gear.boots false)  |  front / three-quarter / side / three-quarter at Walk frame 7  |  576x1024")
bare.save(os.path.join(HERE, "barefoot_sheet.png"))

# 2) comparison: approved V9 staging bust (top) vs this asset at the V9 bust camera (middle) vs this asset full body (bottom)
rows = 3
cmp_img = Image.new("RGB", (4 * CELL, rows * (CELL + BAR)), BG)
staging_sha = {}
for i, v in enumerate(VIEWS):
    p = os.path.join(V9_STAGING, "v9_%s.png" % v)
    staging_sha[v] = sha(p)
    cmp_img.paste(Image.open(p).convert("RGB"), (i * CELL, BAR))
label(cmp_img, 0, "APPROVED V9 (wayfarer_v9_staging/v9_*.png, bottom row of comparison_vs_reference.png)  front sha256 %s..." % staging_sha["front"][:16])
y1 = CELL + BAR
for i, v in enumerate(VIEWS):
    cmp_img.paste(Image.open(os.path.join(HERE, "v9match_%s.png" % v)).convert("RGB"), (i * CELL, y1 + BAR))
label(cmp_img, y1, "THIS ASSET at the identical V9 bust camera, lights and pivot (v9match_*.png)  |  game mesh, no subsurf")
y2 = 2 * (CELL + BAR)
for i, v in enumerate(VIEWS):
    im = Image.open(os.path.join(HERE, "male_%s.png" % v)).convert("RGB")
    h = CELL
    w = int(round(BODY_W * h / BODY_H))
    cell = Image.new("RGB", (CELL, CELL), BG)
    cell.paste(im.resize((w, h), Image.LANCZOS), ((CELL - w) // 2, 0))
    cmp_img.paste(cell, (i * CELL, y2 + BAR))
label(cmp_img, y2, "THIS ASSET full body (male_*.png scaled to fit)  |  2.313 m, 17 bones, Idle/Walk/Turn, 7 sockets")
cmp_img.save(os.path.join(HERE, "comparison_vs_v9.png"))

# 3) record hashes
mp = os.path.join(HERE, "male_manifest.json")
m = json.load(open(mp))
m["reviewSheets"] = {
    "contactSheet": "contact_sheet.png",
    "barefootSheet": "barefoot_sheet.png",
    "comparisonVsV9": "comparison_vs_v9.png",
    "approvedV9RenderSha256": staging_sha,
    "sha256": {
        "contact_sheet.png": sha(os.path.join(HERE, "contact_sheet.png")),
        "barefoot_sheet.png": sha(os.path.join(HERE, "barefoot_sheet.png")),
        "comparison_vs_v9.png": sha(os.path.join(HERE, "comparison_vs_v9.png")),
        **{"male_%s.png" % v: sha(os.path.join(HERE, "male_%s.png" % v)) for v in VIEWS + BAREFOOT_VIEWS},
        **{"v9match_%s.png" % v: sha(os.path.join(HERE, "v9match_%s.png" % v)) for v in VIEWS},
    },
}
json.dump(m, open(mp, "w"), indent=2)
print("sheets written")
