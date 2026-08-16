#!/usr/bin/env python3
"""Batch image -> draft meshes via the Hunyuan3D-2 shape pipeline.

Usage: python batch3d.py [in_dir] [out_dir]
Per input image drops TWO artifacts, skipping images whose outputs already
exist so the script is safe to re-run over a growing input directory:
  <name>.glb        reduced triangle draft (MAX_FACES cap) - reference/viewing
  <name>_quads.obj  field-aligned quad remesh via Instant Meshes (QUAD_FACES
                    coarse target; pure-quad subdivision lands ~4x that) - the
                    editable topology the studio importer keeps as authored quads
"""
import glob
import os
import subprocess
import sys
import time

os.environ.setdefault("HF_HOME", "/workspace/hf")

from PIL import Image
from hy3dgen.rembg import BackgroundRemover
from hy3dgen.shapegen import (
    DegenerateFaceRemover,
    FaceReducer,
    FloaterRemover,
    Hunyuan3DDiTFlowMatchingPipeline,
)

# Raw isosurface output is ~600k+ uniform triangle soup; reduce to a draft-sized
# mesh before it ever leaves the pod. Topology is never agent work: the quad
# remesh below is what makes a draft editable in the studio.
MAX_FACES = int(os.environ.get("MAX_FACES", "30000"))
QUAD_FACES = int(os.environ.get("QUAD_FACES", "1200"))
INSTANT_MESHES = os.environ.get("INSTANT_MESHES", "/workspace/bin/instant-meshes")


def quad_remesh(mesh, quads_path):
    """Field-aligned quad remesh from the RAW surface (full-fidelity source)."""
    raw_obj = quads_path + ".raw.obj"
    mesh.export(raw_obj)
    try:
        subprocess.run(
            [
                INSTANT_MESHES, raw_obj, "-o", quads_path,
                "-f", str(QUAD_FACES), "-d", "-r", "4", "-p", "4", "-c", "30",
                "-t", str(os.cpu_count() or 8),
            ],
            check=True, capture_output=True, text=True,
        )
    finally:
        os.remove(raw_obj)

in_dir = sys.argv[1] if len(sys.argv) > 1 else "/workspace/in"
out_dir = sys.argv[2] if len(sys.argv) > 2 else "/workspace/out"
os.makedirs(out_dir, exist_ok=True)

paths = sorted(
    p
    for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp")
    for p in glob.glob(os.path.join(in_dir, ext))
)
if not paths:
    print(f"no images in {in_dir}")
    sys.exit(0)

pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained("tencent/Hunyuan3D-2")
remove_background = BackgroundRemover()
remove_floaters = FloaterRemover()
remove_degenerate = DegenerateFaceRemover()
reduce_faces = FaceReducer()

for path in paths:
    name = os.path.splitext(os.path.basename(path))[0]
    out_path = os.path.join(out_dir, name + ".glb")
    quads_path = os.path.join(out_dir, name + "_quads.obj")
    if os.path.exists(out_path) and os.path.exists(quads_path):
        print(f"skip {name} (exists)")
        continue
    started = time.time()
    image = Image.open(path).convert("RGBA")
    alpha_min = image.getextrema()[3][0]
    if alpha_min == 255:  # fully opaque -> no cutout yet, remove background
        image = remove_background(image.convert("RGB"))
    mesh = pipeline(image=image)[0]
    raw_faces = len(mesh.faces)
    quad_remesh(mesh, quads_path)
    mesh = remove_floaters(mesh)
    mesh = remove_degenerate(mesh)
    mesh = reduce_faces(mesh, max_facenum=MAX_FACES)
    mesh.export(out_path)
    print(
        f"{name}: {time.time() - started:.1f}s, {raw_faces} raw -> {len(mesh.faces)} glb + quads obj",
        flush=True,
    )

print("BATCH_DONE")
