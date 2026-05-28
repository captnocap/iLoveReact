# Effect Fill Catalog — scape3d texture evaluation

Every fill in `index.tsx` is a procedural `<Effect>` WGSL fragment shader, parameterised
by `[materialId, variant, seed, quality, board]`. This catalog maps each swatch to the
**scape3d** thingymajigger / zone / system it's a candidate texture for, so the eval can
go straight from a swatch ID to "where would this live in the game."

## How to read an ID
`<Board><NN>` — e.g. `E07`. `NN = materialId*3 + variant + 1`, so each material owns three
consecutive numbers = its three **variants** (v0, v1, v2). The on-screen **Quality** toggle
(PSX → PS2 → Preview → Std → Max) is a *runtime* detail grade applied on top — it is not
baked into the ID, so a swatch is stable across grades. PSX/PS2 grades quantise UVs + colour
and dither: that's the game's intended retro register, not a downgrade.

## Boards A–D (codex prototypes) — index only
- **A / Environment** (`A01–A21`): road, concrete, brick, sand, water, grass, wood.
  → ground `ZONE_HEX` (road/sidewalk/sand), generic structure. `water`/`grass` are animated.
- **B / Condemned** (`B01–B21`): mold wall, peel paint, linoleum, bath tile, mildew brick,
  rot siding, rust sheet. → grime-style `CityBuilding`/interior `Wall`/`Floorboard` (style 3).
- **C / Props & Wearables** (`C01–C21`): blade steel, gunmetal, grip polymer, leather, denim,
  fabric, skin. → weapon `ItemType` world models, `Characters3D` clothing/skin ramps.
- **D / Neon Rot** (`D01–D24`): peel wallpaper, motel carpet, rotten rug, neon stucco, pool
  tile, booth vinyl, drop ceiling, PDX carpet. → `enterTo` interiors (motel/cafe), the vice pole.

These hold the **squalor** half of the TONE.md duality well. The two gaps they leave —
the glossy neon **exterior** and the **dealing/crime-scene game-objects** — are Boards E and F.

---

## Board E / Neon Surface — the Drive/Miami *dream* pole
The lit exterior surfaces scape3d's thingymajiggers have no rich fill for yet. Grade these at
**Std/Max** in-game; they're the "looks beautiful" pole, not the grime.

| ID | Material | v0 | v1 | v2 | scape3d target | Live? |
|----|----------|----|----|----|----------------|-------|
| E01–03 | **Stucco Facade** | pink | teal | lilac | `CityBuilding`/`Storefront` face. Richer drop-in for `render3d/textures.ts:facadeTex`; matches `palette3d FACADE`+`windowGlow`+`neonRim` per style. | static |
| E04–06 | **Neon Tube** | pink | cyan | orange | `Sign` thingymajigger glass tube; pairs with `signNeon(tint)`. | **buzz** |
| E07–09 | **Sunset Sky** | dusk | night | dawn | Skybox / backdrop behind the meshed city (the world-as-shader-quad / `Scene3D` sky). | static |
| E10–12 | **Wet Asphalt** | neon-puddle | orange | oil-slick | `road` zone at night (`ZONE_HEX.road`); the wet-neon street look. | static |
| E13–15 | **Car Paint** | candy-red | chrome | matte-black | `vehicle` `AssetKind` body — no thingymajigger exists yet, this is the surface for one. | static |
| E16–18 | **CRT Screen** | terminal-green | web-blue | dead-static | `darknet_cafe` zone monitors, phone/computer `DeviceClass`, dead-internet `WebsiteType` surfaces. | **roll** |
| E19–21 | **Palm Canopy** | lush | dry | silhouette | `PalmTree` thingymajigger canopy face; sky-backed. | static |

## Board F / Contraband & Consequence — the *Spun* squalor game-objects
Not wall grime (Boards B/D own that) but the **loop's** hands-on artifacts: the money sink,
the dealt product, the crime scene the investigation reads. Grade at **PS2/Std** for the
trashy register.

| ID | Material | v0 | v1 | v2 | scape3d target | Live? |
|----|----------|----|----|----|----------------|-------|
| F01–03 | **Cash Stack** | clean | worn | blood | `money`/`wallet` asset, `loot` interaction reward, shop UI. | static |
| F04–06 | **Product Baggie** | crystal | powder | brick | dealing loop product; visualises `ItemInstance.quality` (cook minigame grade). | static |
| F07–09 | **Blood Pool** | fresh | dried | smear | `MurderEvent` floor decal; `BodyDiscovery` (fresh=instant, dried=delayed). | static |
| F10–12 | **Evidence** | hazard-tape | chalk-outline | numbered-marker | the `Case`/investigation made physical at a discovered scene. | static |
| F13–15 | **Refuse** | cardboard | wet-trash | crushed-can | `Dumpster` thingymajigger contents / ground litter in grime zones. | static |
| F16–18 | **Corkboard** | bare | photos | red-string | the "AI playing Clue" `Case` board — safehouse interior / detective surface. | static |
| F19–21 | **Substance** | pills | lines+razor | residue | the `HighState` system's prop; `consumable` `ItemType` use-screen. | static |

## Board G / Liminal — the *threshold* surfaces
Not quite environment, not quite object. These are the surfaces at the edge of state-change:
condensation becoming water, water becoming ice, flame becoming ash, polish becoming patina,
sand becoming glass. Grade at **Std/Max** to preserve the translucent and micro-detail reads.

| ID | Material | v0 | v1 | v2 | scape3d target | Live? |
|----|----------|----|----|----|----------------|-------|
| G01–03 | **Fogged Mirror** | steam | wiped trails | droplets | bathroom/cloakroom interior `Wall`/`Mirror` surface; implies humidity and habitation. | static |
| G04–06 | **Salt Flat** | white | pink-lake | borax | desert `ZONE_HEX` ground (dry lake bed), mineral extraction site. | static |
| G07–09 | **Moss Carpet** | deep green | bright lichen | dried peat | forest `ZONE_HEX` ground, damp `Building` roof, shrine/stone overgrowth. | static |
| G10–12 | **Tarnished Silver** | diagonal buff | circular polish | crosshatch | heirloom `ItemType`, trophy, ritual object; reflects light dynamically. | static |
| G13–15 | **Ice Sheet** | arctic clear | glacial blue | sunset melt | frozen `ZONE_HEX`, glacier face, refrigerated interior. | static |
| G16–18 | **Charcoal Bed** | orange ember | yellow coals | red coals | campfire/bonfire `Event` site, burnt `Building` interior, forge. | **ember** |
| G19–21 | **Stained Glass** | warm cathedral | cool chapel | sunset rose | church/mansion `Building` window, `Sign` backlit pane. | static |

## Board H / Second Pass — the environment do-over
Alternative shader approaches for the core Board A set. Same scape3d targets,
new technique: heavier SDF crispness, more surface storytelling, different colour
science. Grade at **Std/Max** for the aggregate detail to read.

| ID | Material | v0 | v1 | v2 | scape3d target | Live? |
|----|----------|----|----|----|----------------|-------|
| H01–03 | **Asphalt** | double-yellow | crosswalk+manhole | oil+skids | `ZONE_HEX` road / parking lot. Aggregate stones, iridescent oil slicks, tire marks, manhole cover. | static |
| H04–06 | **Sidewalk** | grey | terracotta | flagstone | `ZONE_HEX` sidewalk / pedestrian zone. Irregular poured slabs, expansion joints, rebar rust drips, gum, leaf stains. | static |
| H07–09 | **Stone Wall** | granite | sandstone | basalt | `CityBuilding` masonry face, `Wall` stone variant. Ashlar blocks with irregular edges, lichen, weathering gradient. | static |
| H10–12 | **Dune** | golden | white gypsum | red Martian | desert `ZONE_HEX` ground. Sine-curve ridges with wind ripples, lee-side shadow, sparse vegetation. | static |
| H13–15 | **Deep Water** | deep ocean | tropical | storm grey | `water` zone / ocean backdrop. Sharp whitecaps, caustic light patterns, foam patches, depth gradient. | static |
| H16–18 | **Turf** | mowed stripes | clover meadow | dry summer | park `ZONE_HEX` ground, sports field. Mower stripe bands, clover patches, bare dirt, dandelions. | static |
| H19–21 | **Plank Deck** | fresh cedar | weathered grey | water-stained | pier/boardwalk `ZONE_HEX`, `Building` balcony. Horizontal planks with end-checking cracks, nail pops, water stain. | static |

---

## How these become scape3d textures
Two proven paths (see memory `twod_on_3d_faces` and `render3d/textures.ts`):

1. **Bake → RGBA buffer (static fills).** Most fills are static, so render once and feed the
   `Scene3D.Mesh textureKey` content-hash cache exactly like `facadeTex`/`asphaltTex` today.
   Cheapest; one GPU texture shared across every building/sign of a style.
2. **Live `<Effect>` on a face (the three `Live?` = buzz/roll fills).** `StaticSurface staticKey`
   → `Mesh textureKey` keeps the shader running per-frame. Use only for `Neon Tube` and
   `CRT Screen` (and optionally animated water/grass from Board A). StaticSurface caches paint,
   so animated content must re-render per frame, not bake.

## Strongest candidates to pull first
- **E01–03 Stucco Facade** — directly upgrades the flat `facadeTex`; biggest visible win per the
  duality mandate (the city currently reads more squalor than dream).
- **E07–09 Sunset Sky** — a backdrop is the single largest "Miami" signal and is missing entirely.
- **E16–18 CRT Screen** — the dead-internet is a load-bearing system with no in-world surface.
- **F04–06 Product Baggie** + **F07–09 Blood Pool** — make the dealing loop and murder events
  legible in-world, which is where the emergent "main events" live.

## Open question for the eval
Vehicles (`E13–15 Car Paint`) and the corkboard (`F16–18`) point at content that doesn't have a
thingymajigger yet (no vehicle mesh, no detective surface). Worth deciding whether the texture
demand justifies building those, or whether they wait.
