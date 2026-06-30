#!/usr/bin/env python3
"""Generate the PROPVARETY-0613 prop batch: dozens of skinnable furniture/shelf/desk/chair/computer/poster/etc variants."""

import json
from dataclasses import dataclass
from typing import Literal

@dataclass
class PropDef:
    kind: str
    label: str
    solid: bool
    footprint_radius: float
    height: float
    tile_kind: str = "wall"
    footprint_width: float | None = None
    footprint_depth: float | None = None
    traffic: str = "none"
    mount: str | None = None
    seat_pose: str | None = None
    seat_height: float | None = None
    seat_capacity: int | None = None
    container_category: str | None = None
    container_capacity: int | None = None
    container_fill: float | None = None
    container_search: float | None = None
    container_access: str | None = None
    cover_class: str | None = None
    dynamics_radius: float | None = None
    dynamics_restitution: float | None = None
    category: str = "furniture"


def seat(pose: str, height: float, capacity: int):
    return dict(seat_pose=pose, seat_height=height, seat_capacity=capacity)


def container(category: str, capacity: int, fill: float, seconds: float, access: str = "open"):
    return dict(container_category=category, container_capacity=capacity, container_fill=fill, container_search=seconds, container_access=access)


def fmt_def(p: PropDef) -> str:
    lines = [f"  {p.kind}: {{", f"    kind: '{p.kind}',", f"    label: '{p.label}',"]
    if p.solid:
        lines.append("    solid: true,")
    else:
        lines.append("    solid: false,")
    lines.append(f"    footprintRadiusMeters: {p.footprint_radius},")
    if p.footprint_width is not None:
        lines.append(f"    footprintWidthMeters: {p.footprint_width},")
    if p.footprint_depth is not None:
        lines.append(f"    footprintDepthMeters: {p.footprint_depth},")
    lines.append(f"    heightMeters: {p.height},")
    lines.append(f"    tileKind: '{p.tile_kind}',")
    lines.append(f"    trafficControl: '{p.traffic}',")
    if p.mount:
        lines.append(f"    mount: '{p.mount}',")
    if p.seat_pose:
        lines.append(f"    seat: {{ pose: '{p.seat_pose}', seatHeightMeters: {p.seat_height}, capacity: {p.seat_capacity} }},")
    if p.container_category:
        lines.append(f"    container: {{ lootCategory: '{p.container_category}', capacity: {p.container_capacity}, spawnFillChance: {p.container_fill}, searchSeconds: {p.container_search}, access: '{p.container_access}' }},")
    if p.cover_class:
        lines.append(f"    coverClass: '{p.cover_class}',")
    if p.dynamics_radius is not None:
        lines.append(f"    dynamics: {{ bodyRadiusMeters: {p.dynamics_radius}, restitution: {p.dynamics_restitution} }},")
    lines.append("  },")
    return "\n".join(lines)


# ── the batch ───────────────────────────────────────────────────────────────

PROPS: list[PropDef] = []

# chairs (12)
PROPS += [
    PropDef("stool", "Stool", True, 0.22, 0.65, **seat("sit", 0.45, 1), category="furniture"),
    PropDef("barStool", "Bar Stool", True, 0.24, 1.05, **seat("sit", 0.75, 1), category="furniture"),
    PropDef("officeChair", "Office Chair", True, 0.30, 0.95, **seat("sit", 0.45, 1), category="furniture"),
    PropDef("armChair", "Armchair", True, 0.45, 0.95, footprint_width=0.9, footprint_depth=0.9, **seat("sit", 0.42, 1), category="furniture"),
    PropDef("diningChair", "Dining Chair", True, 0.30, 0.95, **seat("sit", 0.45, 1), category="furniture"),
    PropDef("foldingChair", "Folding Chair", True, 0.30, 0.90, **seat("sit", 0.43, 1), category="furniture"),
    PropDef("rockingChair", "Rocking Chair", True, 0.35, 0.95, footprint_width=0.7, footprint_depth=0.9, **seat("sit", 0.42, 1), category="furniture"),
    PropDef("wheelchair", "Wheelchair", True, 0.35, 0.95, footprint_width=0.7, footprint_depth=0.9, **seat("sit", 0.45, 1), category="furniture"),
    PropDef("parkChair", "Park Chair", True, 0.32, 0.95, **seat("sit", 0.45, 1), category="furniture"),
    PropDef("plasticChair", "Plastic Chair", True, 0.30, 0.85, **seat("sit", 0.43, 1), category="furniture"),
    PropDef("stoolRed", "Red Stool", True, 0.22, 0.65, **seat("sit", 0.45, 1), category="furniture"),
    PropDef("stoolBlue", "Blue Stool", True, 0.22, 0.65, **seat("sit", 0.45, 1), category="furniture"),
]

# desks / tables (12)
PROPS += [
    PropDef("officeDesk", "Office Desk", True, 0.85, 0.76, footprint_width=1.7, footprint_depth=0.8, cover_class="soft", category="household"),
    PropDef("receptionDesk", "Reception Desk", True, 1.0, 1.15, footprint_width=2.0, footprint_depth=0.9, **container("office", 3, 0.5, 3.0), category="household"),
    PropDef("schoolDesk", "School Desk", True, 0.40, 0.75, footprint_width=0.8, footprint_depth=0.6, **container("office", 1, 0.4, 2.0), category="household"),
    PropDef("workbench", "Workbench", True, 0.90, 0.92, footprint_width=1.8, footprint_depth=0.9, **container("tools", 4, 0.6, 3.5), category="household"),
    PropDef("draftingTable", "Drafting Table", True, 0.60, 1.05, footprint_width=1.2, footprint_depth=0.8, category="household"),
    PropDef("diningTable", "Dining Table", True, 1.0, 0.76, footprint_width=2.0, footprint_depth=1.0, cover_class="soft", category="furniture"),
    PropDef("coffeeTable", "Coffee Table", True, 0.60, 0.45, footprint_width=1.2, footprint_depth=0.7, cover_class="soft", category="furniture"),
    PropDef("nightStand", "Nightstand", True, 0.30, 0.55, footprint_width=0.6, footprint_depth=0.45, **container("junk", 2, 0.45, 2.0), category="household"),
    PropDef("conferenceTable", "Conference Table", True, 1.4, 0.76, footprint_width=2.8, footprint_depth=1.2, cover_class="soft", category="furniture"),
    PropDef("picnicTable", "Picnic Table", True, 0.95, 0.78, footprint_width=1.9, footprint_depth=1.3, **seat("sit", 0.45, 4), category="furniture"),
    PropDef("sideTable", "Side Table", True, 0.30, 0.55, cover_class="soft", category="furniture"),
    PropDef("cardTable", "Card Table", True, 0.45, 0.72, footprint_width=0.9, footprint_depth=0.9, cover_class="soft", category="furniture"),
]

# shelves (10)
PROPS += [
    PropDef("wallShelf", "Wall Shelf", True, 0.40, 0.60, footprint_width=0.8, footprint_depth=0.25, mount="wall", cover_class="soft", category="furniture"),
    PropDef("bookShelf", "Bookshelf", True, 0.45, 2.0, footprint_width=0.9, footprint_depth=0.4, **container("office", 5, 0.55, 3.0), category="furniture"),
    PropDef("kitchenShelf", "Kitchen Shelf", True, 0.50, 1.8, footprint_width=1.0, footprint_depth=0.4, **container("kitchen", 5, 0.6, 2.5), category="household"),
    PropDef("metalShelf", "Metal Shelf", True, 0.55, 1.9, footprint_width=1.1, footprint_depth=0.45, **container("tools", 5, 0.5, 3.0), category="commerce"),
    PropDef("wireShelf", "Wire Shelf", True, 0.50, 1.8, footprint_width=1.0, footprint_depth=0.4, **container("kitchen", 4, 0.5, 2.5), category="commerce"),
    PropDef("longShelf", "Long Shelf", True, 1.2, 1.9, footprint_width=2.4, footprint_depth=0.5, **container("tools", 6, 0.6, 3.0), category="commerce"),
    PropDef("shortShelf", "Short Shelf", True, 0.30, 0.9, footprint_width=0.6, footprint_depth=0.35, **container("junk", 3, 0.5, 2.0), category="furniture"),
    PropDef("cornerShelf", "Corner Shelf", True, 0.35, 1.6, footprint_width=0.7, footprint_depth=0.7, **container("office", 3, 0.45, 2.5), category="furniture"),
    PropDef("bathroomShelf", "Bathroom Shelf", True, 0.30, 0.75, footprint_width=0.6, footprint_depth=0.25, mount="wall", **container("bathroom", 2, 0.35, 2.0), category="household"),
    PropDef("warehouseShelf", "Warehouse Shelf", True, 1.5, 3.0, footprint_width=3.0, footprint_depth=0.9, **container("tools", 8, 0.7, 4.0), category="commerce"),
]

# couches (8)
PROPS += [
    PropDef("sofa", "Sofa", True, 1.0, 0.85, footprint_width=2.0, footprint_depth=0.9, **seat("sit", 0.42, 3), cover_class="soft", category="furniture"),
    PropDef("loveseat", "Loveseat", True, 0.75, 0.85, footprint_width=1.5, footprint_depth=0.9, **seat("sit", 0.42, 2), cover_class="soft", category="furniture"),
    PropDef("sectional", "Sectional Sofa", True, 1.3, 0.85, footprint_width=2.6, footprint_depth=1.3, **seat("sit", 0.42, 4), cover_class="soft", category="furniture"),
    PropDef("ottoman", "Ottoman", True, 0.35, 0.45, footprint_width=0.7, footprint_depth=0.7, cover_class="soft", category="furniture"),
    PropDef("chaiseLounge", "Chaise Lounge", True, 0.95, 0.80, footprint_width=1.9, footprint_depth=0.8, **seat("lay", 0.38, 1), cover_class="soft", category="furniture"),
    PropDef("sofaRed", "Red Sofa", True, 1.0, 0.85, footprint_width=2.0, footprint_depth=0.9, **seat("sit", 0.42, 3), cover_class="soft", category="furniture"),
    PropDef("sofaBlue", "Blue Sofa", True, 1.0, 0.85, footprint_width=2.0, footprint_depth=0.9, **seat("sit", 0.42, 3), cover_class="soft", category="furniture"),
    PropDef("sofaGreen", "Green Sofa", True, 1.0, 0.85, footprint_width=2.0, footprint_depth=0.9, **seat("sit", 0.42, 3), cover_class="soft", category="furniture"),
]

# computers / electronics (10)
PROPS += [
    PropDef("laptop", "Laptop", True, 0.20, 0.05, footprint_width=0.4, footprint_depth=0.3, mount="surface", **container("office", 1, 0.3, 2.0), category="household"),
    PropDef("monitor", "Monitor", True, 0.25, 0.50, footprint_width=0.5, footprint_depth=0.18, mount="surface", category="household"),
    PropDef("serverRack", "Server Rack", True, 0.35, 2.0, footprint_width=0.7, footprint_depth=0.8, **container("office", 4, 0.5, 3.0), category="household"),
    PropDef("terminal", "Terminal", True, 0.30, 1.45, footprint_width=0.6, footprint_depth=0.55, **container("office", 2, 0.4, 3.0), category="commerce"),
    PropDef("tv", "Television", True, 0.35, 0.90, footprint_width=0.7, footprint_depth=0.20, mount="wall", category="household"),
    PropDef("tvSmall", "Small TV", True, 0.20, 0.45, footprint_width=0.4, footprint_depth=0.15, mount="surface", category="household"),
    PropDef("tvLarge", "Large TV", True, 0.65, 1.1, footprint_width=1.3, footprint_depth=0.25, mount="wall", category="household"),
    PropDef("radio", "Radio", True, 0.14, 0.18, footprint_width=0.28, footprint_depth=0.16, mount="surface", category="media"),
    PropDef("cashRegister", "Cash Register", True, 0.18, 0.25, footprint_width=0.36, footprint_depth=0.32, mount="surface", **container("valuables", 2, 0.5, 2.5), category="shops"),
    PropDef("securityCamera", "Security Camera", True, 0.08, 0.25, footprint_depth=0.16, mount="wall", category="shops"),
]

# posters / signs / boards (10)
PROPS += [
    PropDef("posterSmall", "Small Poster", True, 0.08, 1.0, footprint_depth=0.16, mount="wall", cover_class="none", category="signs"),
    PropDef("posterLarge", "Large Poster", True, 0.10, 2.3, footprint_depth=0.20, mount="wall", cover_class="none", category="signs"),
    PropDef("posterWide", "Wide Poster", True, 0.12, 1.2, footprint_width=2.4, footprint_depth=0.20, mount="wall", cover_class="none", category="signs"),
    PropDef("posterTall", "Tall Poster", True, 0.06, 2.8, footprint_depth=0.12, mount="wall", cover_class="none", category="signs"),
    PropDef("flyer", "Flyer", True, 0.06, 0.35, footprint_depth=0.12, mount="wall", cover_class="none", category="signs"),
    PropDef("noticeBoard", "Notice Board", True, 0.10, 1.5, footprint_width=2.0, footprint_depth=0.18, mount="wall", cover_class="none", category="signs"),
    PropDef("bulletinBoard", "Bulletin Board", True, 0.12, 1.4, footprint_width=2.4, footprint_depth=0.20, mount="wall", cover_class="none", category="signs"),
    PropDef("chalkboard", "Chalkboard", True, 0.10, 1.4, footprint_width=2.0, footprint_depth=0.16, mount="wall", cover_class="none", category="signs"),
    PropDef("whiteboard", "Whiteboard", True, 0.10, 1.4, footprint_width=2.0, footprint_depth=0.16, mount="wall", cover_class="none", category="signs"),
    PropDef("neonSign", "Neon Sign", True, 0.08, 0.7, footprint_width=1.6, footprint_depth=0.14, mount="wall", cover_class="none", category="signs"),
]

# beds / bath / household extras (8)
PROPS += [
    PropDef("bunkBed", "Bunk Bed", True, 0.55, 1.9, footprint_width=1.1, footprint_depth=2.1, **seat("lay", 0.45, 2), cover_class="soft", category="household"),
    PropDef("crib", "Crib", True, 0.35, 0.95, footprint_width=0.7, footprint_depth=1.3, **seat("lay", 0.40, 1), cover_class="soft", category="household"),
    PropDef("vanity", "Vanity", True, 0.40, 1.5, footprint_width=0.8, footprint_depth=0.5, **container("bathroom", 2, 0.35, 2.0), category="household"),
    PropDef("bathTub", "Bathtub", True, 0.40, 0.55, footprint_width=0.8, footprint_depth=1.6, **seat("sit", 0.30, 1), cover_class="soft", category="household"),
    PropDef("medicineCabinet", "Medicine Cabinet", True, 0.12, 0.75, footprint_width=0.24, footprint_depth=0.15, mount="wall", **container("bathroom", 2, 0.4, 2.0), category="household"),
    PropDef("towelRack", "Towel Rack", True, 0.12, 0.7, footprint_width=0.6, footprint_depth=0.18, mount="wall", cover_class="none", category="household"),
    PropDef("showerStall", "Shower Stall", True, 0.60, 2.1, footprint_width=1.2, footprint_depth=1.2, cover_class="hard", category="household"),
    PropDef("toilet", "Toilet", True, 0.22, 0.75, footprint_width=0.44, footprint_depth=0.55, **seat("sit", 0.40, 1), cover_class="soft", category="household"),
]


def kind_union_lines() -> str:
    lines = ["  // ── PROPVARETY-0613: furniture / shelf / desk / chair / computer / poster / bath variety drop ──"]
    for p in PROPS:
        lines.append(f"  | '{p.kind}'")
    return "\n".join(lines)


def kind_definitions() -> str:
    lines = ["  // ── PROPVARETY-0613: dozens of skinnable variants ─────────────────────────"]
    for p in PROPS:
        lines.append(fmt_def(p))
    return "\n".join(lines)


def categories_patch() -> dict[str, list[str]]:
    patch: dict[str, list[str]] = {}
    for p in PROPS:
        patch.setdefault(p.category, []).append(p.kind)
    return patch


def categories_insert() -> str:
    patch = categories_patch()
    return json.dumps(patch, indent=2)


print("=== KIND_UNION ===")
print(kind_union_lines())
print("\n=== DEFINITIONS ===")
print(kind_definitions())
print("\n=== CATEGORIES_PATCH ===")
print(categories_insert())
