#!/usr/bin/env python
"""TRELLIS.2 batch: /workspace/in-t2/*.png|jpg -> /workspace/out-t2/<name>.glb.

PBR GLB (base color / roughness / metallic / opacity, WebP textures). Skips images
whose output already exists, so it is safe to re-run. Prints one `t2 -> name.glb`
line per piece and BATCH_DONE at the end (same polling grammar as batch3d.py).

Env knobs:
  T2_DECIMATE  decimation target faces passed to o_voxel to_glb   (default 300000)
  T2_TEX       texture size                                       (default 2048)
"""
import os
os.environ.setdefault("ATTN_BACKEND", "sdpa")  # no flash-attn on this lane (torch 2.9.1+cu128)
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ.setdefault("HF_HOME", "/workspace/hf")

import sys
import glob
import time
import traceback

sys.path.insert(0, "/workspace/TRELLIS.2")  # trellis2 is run-from-repo, not pip-installed

from PIL import Image  # noqa: E402
from trellis2.pipelines import Trellis2ImageTo3DPipeline  # noqa: E402
import o_voxel  # noqa: E402

IN_DIR = "/workspace/in-t2"
OUT_DIR = "/workspace/out-t2"
DECIMATE = int(os.environ.get("T2_DECIMATE", "300000"))
TEX = int(os.environ.get("T2_TEX", "2048"))

images = sorted(
    p for pat in ("*.png", "*.jpg", "*.jpeg", "*.webp")
    for p in glob.glob(os.path.join(IN_DIR, pat))
)
todo = [
    p for p in images
    if not os.path.exists(os.path.join(OUT_DIR, os.path.splitext(os.path.basename(p))[0] + ".glb"))
]
print(f"[t2] {len(images)} images, {len(todo)} to generate (decimate={DECIMATE}, tex={TEX})")
if not todo:
    print("BATCH_DONE")
    sys.exit(0)

pipeline = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
pipeline.cuda()

failed = []
for path in todo:
    name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(OUT_DIR, name + ".glb")
    t0 = time.time()
    try:
        image = Image.open(path)
        mesh = pipeline.run(image)[0]
        mesh.simplify(16777216)  # nvdiffrast vertex limit, per upstream example.py
        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices,
            faces=mesh.faces,
            attr_volume=mesh.attrs,
            coords=mesh.coords,
            attr_layout=mesh.layout,
            voxel_size=mesh.voxel_size,
            aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=DECIMATE,
            texture_size=TEX,
            remesh=True,
            remesh_band=1,
            remesh_project=0,
            verbose=False,
        )
        glb.export(out, extension_webp=True)
        print(f"t2 -> {name}.glb ({time.time() - t0:.1f}s)", flush=True)
    except Exception:
        failed.append(name)
        print(f"t2 FAILED {name}:", flush=True)
        traceback.print_exc()

if failed:
    print(f"[t2] {len(failed)} failed: {', '.join(failed)}")
print("BATCH_DONE")
