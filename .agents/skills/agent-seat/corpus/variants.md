# Phase: variants

**Forward obligation —** The semantic table must survive skinning untouched; it is rigging data.

---

## 4 · Multiple skins — paint variants are the wardrobe

One mesh, many looks. Each accepted skin becomes a named variant; variants do not multiply
palette entries (skins are instance wardrobe, ruled):

```bash
tools/seat action paint-variant '{"operation":"save-new","name":"graphite dark"}'
tools/seat action uv-atlas '{"operation":"import","path":".../skin_2.png"}'   # next look
tools/seat action paint-variant '{"operation":"save-new","name":"steel light"}'
tools/seat action paint-variant '{"operation":"read"}'                        # list
tools/seat action paint-variant '{"operation":"load","id":"1"}'               # switch
tools/seat save
```

`save-new` writes `paints/paint_N.png` + `paint_N.json` (cornerUv + raster base, zero
strokes — a full LOOK) and runs UV coverage cleanup: off-island pixels are cleared, so the
banked skin is tighter than the raw import. Finish with `tools/seat save` and, when
durability is material, `tools/seat semantic-status` — the semantic table must survive
skinning untouched (it is rigging data; dropping it is a bug, not a cost).
