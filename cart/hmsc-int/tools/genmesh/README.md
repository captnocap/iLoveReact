# genmesh — local text/image → 3D prop pipeline

The repo-owned version of [modly](https://github.com/lightningpixel/modly)'s idea:
a local diffusion model turns a prompt or image into a 3D mesh, **baked straight
into the hmsc-int prop registry** — no separate app, no manual export/import.

```
"red fire hydrant"  ──▶  SD-Turbo (text→image)  ──▶  reference image
        │ or                                              │
   reference image ──────────────────────────────────────┤
                                                          ▼
                                          Shap-E img2img (image→3D)
                                                          ▼
                                                        GLB
                                                          ▼
                                  importPropMesh.mjs (existing baker)
                                                          ▼
                                      placeable prop in the catalog
```

## Use

```bash
tools/genprop "red fire hydrant" --kind imported.hydrant --height 0.9
tools/genprop ./chair.png        --kind imported.chair  --label Chair
```

First positional arg is a **text prompt** or an **image path** (auto-detected).
Prop options (`--kind/--label/--height/--color/--solid/--cover`) forward to
`importPropMesh.mjs`; generation options (`--backend/--seed/--steps/--keep-glb`)
forward to `genmesh.py`.

## How it runs

- **Isolated venv** (`.venv/`, gitignored) on the system python — NOT the conda
  env (which has broken/conflicting ML packages). Built by `setup.sh`, called
  automatically on first `genprop` run. Weights cache in `~/.cache/huggingface`.
- **GPU:** needs CUDA. Validated on an RTX 3060 (12 GB). torch+torchvision come
  from the cu124 wheel index (the one with cp313 wheels).

## Models

| Stage | Model | Notes |
|-------|-------|-------|
| text→image | `stabilityai/sd-turbo` | 4-step distilled SD; the prompt's quality gates the 3D result |
| image→3D | `openai/shap-e-img2img` | fast, zero-build, lower fidelity (blobby) |

**Backend is swappable** (`genmesh.py --backend`). Shap-E is the zero-friction
default that proves the pipeline end-to-end. The intended quality upgrade is
**Stable Fast 3D** (modly's own default — its `texture_baker`/`uv_unwrapper` are
SF3D's) or **Hunyuan3D-2-mini**; both are image→3D so they drop in behind the
same flag once their custom CUDA ops are built. Track that as the follow-up.
