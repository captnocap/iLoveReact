#!/usr/bin/env python
"""genmesh.py — local text/image -> 3D mesh (GLB) for the hmsc-int prop pipeline.

Mirrors modly's architecture (diffusion models running on the local GPU) but
owned by THIS repo: one isolated venv (see setup.sh), weights auto-downloaded
from HuggingFace to the usual ~/.cache/huggingface, output a GLB that
importPropMesh.mjs bakes straight into the prop registry. No separate app, no
manual export/import.

Backends are uniformly IMAGE->3D so a higher-quality model (Stable Fast 3D,
Hunyuan3D-2-mini) can drop in later behind the same --backend flag. TEXT input
is handled by a text->image stage (SD-Turbo) in front — exactly like handing
modly an image — so the 3D backend never has to care whether the prompt was
words or a picture.

Usage:
  genmesh.py --out out.glb --text "red fire hydrant"
  genmesh.py --out out.glb --image photo.png
  genmesh.py --out out.glb --text "..." --seed 0 --steps 64

This is invoked by ../genprop; you normally don't call it directly.
"""
import argparse
import os
import sys


def log(msg: str) -> None:
    print(f"[genmesh] {msg}", file=sys.stderr, flush=True)


# ── Stage 1: text -> reference image (SD-Turbo, 1-4 step) ──────────────────────
def text_to_image(prompt: str, seed: int):
    import torch
    from diffusers import AutoPipelineForText2Image

    log(f"text->image (SD-Turbo): {prompt!r}")
    pipe = AutoPipelineForText2Image.from_pretrained(
        "stabilityai/sd-turbo", torch_dtype=torch.float16, variant="fp16"
    ).to("cuda")
    g = torch.Generator("cuda").manual_seed(seed)
    # SD-Turbo is distilled: few steps, no CFG. Center the subject in the prompt.
    img = pipe(
        prompt=f"{prompt}, single object, centered, plain white background, product shot",
        num_inference_steps=4,
        guidance_scale=0.0,
        generator=g,
    ).images[0]
    del pipe
    torch.cuda.empty_cache()
    return img


# ── Background removal: isolate the subject on white (helps img->3D a lot) ─────
def remove_bg(img):
    try:
        from PIL import Image
        from rembg import remove

        log("removing background (rembg)")
        cut = remove(img.convert("RGBA"))  # RGBA with alpha
        bg = Image.new("RGBA", cut.size, (255, 255, 255, 255))
        bg.alpha_composite(cut)
        return bg.convert("RGB")
    except Exception as e:  # rembg is best-effort; a clean studio image is fine raw
        log(f"rembg skipped ({e}); using image as-is")
        return img.convert("RGB")


# ── Stage 2: -> mesh (Shap-E; swappable backend) ───────────────────────────────
# Shap-E has two heads. Native TEXT->3D is volumetric and is the right default for
# a prompt. IMG2IMG conditions on a single view and frequently collapses depth to
# a flat slab (measured: a hydrant came out 0.05 thick vs 2.0 tall), so it's only
# used when the user actually supplies an image. A higher-quality image->3D model
# (SF3D/Hunyuan3D) is the planned drop-in for the image path — see README.
def text_to_mesh_shape(prompt: str, seed: int, steps: int, guidance: float):
    import torch
    from diffusers import ShapEPipeline

    log(f"text->3D (Shap-E, steps={steps}, guidance={guidance})")
    pipe = ShapEPipeline.from_pretrained("openai/shap-e", torch_dtype=torch.float32).to("cuda")
    g = torch.Generator("cuda").manual_seed(seed)
    res = pipe(
        prompt=prompt,
        num_inference_steps=steps,
        guidance_scale=guidance,  # text head wants strong CFG (~15)
        frame_size=256,
        output_type="mesh",
        generator=g,
    )
    mesh = res.images[0]
    del pipe
    torch.cuda.empty_cache()
    return mesh


def image_to_mesh_shape(img, seed: int, steps: int, guidance: float):
    import torch
    from diffusers import ShapEImg2ImgPipeline

    log(f"image->3D (Shap-E img2img, steps={steps}, guidance={guidance})")
    # Shap-E is small; run fp32 — fp16 tends to NaN the latents on this model.
    pipe = ShapEImg2ImgPipeline.from_pretrained(
        "openai/shap-e-img2img", torch_dtype=torch.float32
    ).to("cuda")
    g = torch.Generator("cuda").manual_seed(seed)
    res = pipe(
        image=img,
        num_inference_steps=steps,
        guidance_scale=guidance,
        frame_size=256,
        output_type="mesh",
        generator=g,
    )
    mesh = res.images[0]
    del pipe
    torch.cuda.empty_cache()
    return mesh


def shap_e_to_trimesh(mesh):
    import numpy as np
    import trimesh

    # Shap-E returns torch tensors (on CUDA) — pull to host before numpy.
    def arr(x):
        try:
            import torch
            if isinstance(x, torch.Tensor):
                return x.detach().cpu().numpy()
        except Exception:
            pass
        return np.asarray(x)

    verts = arr(mesh.verts).astype(np.float64)
    faces = arr(mesh.faces).astype(np.int64)
    colors = None
    ch = getattr(mesh, "vertex_channels", None)
    if ch and all(k in ch for k in ("R", "G", "B")):
        rgb = np.stack([arr(ch["R"]), arr(ch["G"]), arr(ch["B"])], axis=1)
        colors = (np.clip(rgb, 0.0, 1.0) * 255).astype(np.uint8)
    return trimesh.Trimesh(vertices=verts, faces=faces, vertex_colors=colors, process=False)


# ── Decimate + orient + normalize ─────────────────────────────────────────────
def decimate(tm, target_faces: int):
    """Shap-E emits ~90k faces; a game prop wants a few thousand. Quadric-decimate
    to target_faces so the baked geometry literal stays small (importPropMesh
    inlines every vertex into a .ts Float32Array)."""
    if target_faces <= 0 or len(tm.faces) <= target_faces:
        return tm
    try:
        d = tm.simplify_quadric_decimation(face_count=target_faces)
        log(f"decimated {len(tm.faces)} -> {len(d.faces)} faces")
        return d
    except Exception as e:
        log(f"decimation skipped ({e}); keeping {len(tm.faces)} faces")
        return tm


def finalize(tm, up: str):
    """Center on origin and orient Y-up. Shap-E emits meshes whose 'up' is +Z;
    importPropMesh treats +Y as height, so rotate Z-up -> Y-up by default. The
    --up flag lets us correct per-model if a backend differs."""
    import numpy as np
    import trimesh

    if up == "z":  # rotate so original +Z becomes +Y
        R = trimesh.transformations.rotation_matrix(-np.pi / 2.0, [1, 0, 0])
        tm.apply_transform(R)
    elif up == "y":
        pass
    tm.apply_translation(-tm.bounds.mean(axis=0))
    return tm


def main() -> None:
    ap = argparse.ArgumentParser(description="local text/image -> 3D GLB")
    ap.add_argument("--out", required=True, help="output .glb path")
    ap.add_argument("--text", help="text prompt (runs text->image first)")
    ap.add_argument("--image", help="reference image path (skips text->image)")
    ap.add_argument("--backend", default="shap-e", choices=["shap-e"])
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--steps", type=int, default=64, help="diffusion steps")
    ap.add_argument("--guidance", type=float, default=None,
                    help="CFG; default 15 for text->3D, 3 for img->3D")
    ap.add_argument("--via-image", action="store_true",
                    help="force the text->image->3D route even for a text prompt "
                         "(needed for image-only backends like SF3D)")
    ap.add_argument("--up", default="z", choices=["y", "z"], help="source up-axis")
    ap.add_argument("--faces", type=int, default=3000,
                    help="decimate to this many faces (0 = keep full resolution)")
    ap.add_argument("--no-rembg", action="store_true", help="skip background removal")
    ap.add_argument("--save-image", help="also dump the intermediate reference image")
    a = ap.parse_args()
    if not a.text and not a.image:
        ap.error("provide --text or --image")

    # Route: a bare text prompt goes straight through Shap-E's volumetric text->3D
    # head; an image (or --via-image) goes through the image->3D head.
    use_image_path = bool(a.image) or a.via_image

    if a.backend != "shap-e":
        raise SystemExit(f"unknown backend: {a.backend}")

    if not use_image_path:
        g = a.guidance if a.guidance is not None else 15.0
        mesh = text_to_mesh_shape(a.text, a.seed, a.steps, g)
    else:
        from PIL import Image

        if a.image:
            log(f"reference image: {a.image}")
            img = Image.open(a.image).convert("RGB")
        else:
            img = text_to_image(a.text, a.seed)
        if not a.no_rembg:
            img = remove_bg(img)
        if a.save_image:
            img.save(a.save_image)
            log(f"reference image -> {a.save_image}")
        g = a.guidance if a.guidance is not None else 3.0
        mesh = image_to_mesh_shape(img, a.seed, a.steps, g)
    tm = shap_e_to_trimesh(mesh)
    tm = decimate(tm, a.faces)

    tm = finalize(tm, a.up)
    out_dir = os.path.dirname(os.path.abspath(a.out))
    os.makedirs(out_dir, exist_ok=True)
    tm.export(a.out)
    log(f"wrote {a.out}  verts={len(tm.vertices)} faces={len(tm.faces)}")


if __name__ == "__main__":
    main()
