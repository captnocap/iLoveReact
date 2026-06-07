# WBVEHICLES.CAPTURE.md -- WBSTEP6-0606 parity table

Source census: `editors/workbench/census/vehicles.md`.

Scope: additive vehicle Workbench source. `/vehicles` remains untouched until
the later flip commit. The source uses the existing vehicle stream, route twig
keys, `editors/vehicles/edits.ts`, the shared `shell/fields.tsx` renderer, the
shared workbench stage/lens frame, and the existing agnostic paint bench.

Model correction after user verdict: the old route persisted the vehicle body
choice under `VehicleDoc.style`, but the Workbench boundary treats that value as
the vehicle identity. Roster rows display `ambulance`/`pickup` rather than
generic `car-N`, new documents mint identity-based ids, and the panel exposes
`vehicle` plus independent `service`. Raw legacy stream keys like `car-1` stay
internal and are not shown in the contract. `style` is not a user-facing
workbench field; future visual variation belongs to the shared paint/material
vocabulary.

## Capability Coverage

| id | old `/vehicles` route source | workbench coverage |
|---|---|---|
| C1 | `editors/vehicles/VehiclesRoute.tsx:183`, `:192` opens the stream/session and closes on leave. | ACCOUNTED: `vehicles/store.ts:327-343` opens the same `vehicles` channel under `/workbench`; `vehicles/store.ts:150-159` writes the same session commits. |
| C2 | `VehiclesRoute.tsx:193`, `:194`, `:370` restore/select active vehicle from persisted garage. | ACCOUNTED: `vehicles/store.ts:115-129`, `:198-205`, `:248-255`; roster displays vehicle identity at `vehicles/store.ts:58-83` and source wiring at `vehicles/panel.ts:130-148`; tested at `vehicles/source.test.ts:54-65`. |
| C3 | `VehiclesRoute.tsx:233`, `:373`, `:480` creates a generated active vehicle. | ACCOUNTED: `vehicles/store.ts:163-183` authors an identity-based id; hero/empty actions at `vehicles/panel.ts:152-164`; tested at `vehicles/source.test.ts:67-78`. |
| C4 | `VehiclesRoute.tsx:243`, `:374` deletes active vehicle. | ACCOUNTED: `vehicles/store.ts:186-195`; remove hero action at `vehicles/panel.ts:159`; tested at `vehicles/source.test.ts:80-88`. |
| C5 | `VehiclesRoute.tsx:379`, `:383` changes the persisted body choice that old route called style. | ACCOUNTED as vehicle identity: panel enum `vehicles/panel.ts:57-65`; stream edit door `vehicles/store.ts:269-272`; style language absent from the Workbench panel/contract; tested at `vehicles/source.test.ts:90-98`. |
| C6 | `VehiclesRoute.tsx:386`, `:390` changes service/role. | ACCOUNTED as independent service: panel enum `vehicles/panel.ts:57-65`; stream edit door `vehicles/store.ts:86-95`, `:273-276`; tested not to rewrite vehicle identity at `vehicles/source.test.ts:100-108`. |
| C7 | `VehiclesRoute.tsx:251`, `:397`, `:399` previews motion DSL and playback. | ACCOUNTED: view state `vehicles/store.ts:121-129`, `:208-214`, `:312-313`; panel `vehicles/panel.ts:67-74`; stage playback/build `vehicles/Stage.tsx:107-117`; tested at `vehicles/source.test.ts:110-120`. |
| C8 | `VehiclesRoute.tsx:401`, `:404`, `:406`, `:407` toggles overlays and reroll/repaint. | ACCOUNTED: view/edit doors `vehicles/store.ts:264-267`, `:314-315`; panel `vehicles/panel.ts:76-84`; stage overlays `vehicles/Stage.tsx:54-85`, `:188`; tested at `vehicles/source.test.ts:122-135`. |
| C9 | `VehiclesRoute.tsx:413`, `:418`, `:419` deep-links vehicle parts to `/cutout`. | ACCOUNTED by agnostic paint source: `workbench/paint/source.tsx:41`, `workbench/paint/store.ts:267` (vehicle save branch); vehicle source adds a direct PAINT doorway at `vehicles/panel.ts:16-19`, `:156-157`, `vehicles/PaintLens.tsx:22-37`; tested at `vehicles/source.test.ts:202-208`. |
| C10 | `VehiclesRoute.tsx:425`, `:429`, `:432` edits gas side and gas port Z. | ACCOUNTED: panel fields `vehicles/panel.ts:86-92`; stream edit doors `vehicles/store.ts:277-287`; tested at `vehicles/source.test.ts:137-147`. |
| C11 | `VehiclesRoute.tsx:435`, `:439`, `:441` selects hitbox/part groups. | ACCOUNTED: selection twig state `vehicles/store.ts:121-129`, `:289-292`; panel `vehicles/panel.ts:94-109`; stage selected highlight `vehicles/Stage.tsx:54-64`; tested at `vehicles/source.test.ts:149-155`. |
| C12 | `VehiclesRoute.tsx:446`, `:450`, `:456` repairs/damages/wrecks. | ACCOUNTED: damage doors `vehicles/store.ts:294-310`; panel `vehicles/panel.ts:94-109`; tested at `vehicles/source.test.ts:157-171`. |
| C13 | `VehiclesRoute.tsx:461`, `:464`, `:470` shows contract/readout values. | ACCOUNTED: `vehicles/panel.ts:111-125` exposes `vehicle` and `service`, hides raw stream id, and omits `style`; tested at `vehicles/source.test.ts:173-187`. |
| C14 | `VehiclesRoute.tsx:103`, `:297`, `:487`, `:501`, `:503` renders mesh, hitboxes, anchors, paint captures, and orbit viewport. | ACCOUNTED: source mounted on `/workbench` at `sources.ts:15`, `:23`; stage mesh/camera/captures at `vehicles/Stage.tsx:33-88`, `:119-193`; tested at `vehicles/source.test.ts:189-199`. |

## Tests

`editors/workbench/vehicles/source.test.ts` covers all 14 census rows, with C9
asserting the vehicle source's PAINT doorway while the agnostic paint bench
retains ownership of the painting surface and save route.

Verifier result:

`tools/rjit game verify`

Vehicle source: `editors/workbench/vehicles: 13/13 passed`.

Full verifier currently remains red outside this lane:
`[game] VERDICT RED -- 1/1 oracle, 67/69 suites, 2/2 scripts`; failures are
`cart/hmsc-int/editors/items/items.test.ts` and
`cart/hmsc-int/editors/voxels/voxels.test.ts`.
