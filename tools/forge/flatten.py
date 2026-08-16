#!/usr/bin/env python3
"""Collapse coplanar regions of a quad/tri mesh to their boundary polygons.

Usage: python flatten.py in.obj out.obj [--angle 2.5] [--dist 0.002]

The counterpart of uniform quad remeshing (req_4577): Instant Meshes holds shape
by spending density everywhere, which wastes hundreds of faces on flats. This
pass region-grows connected faces whose normals agree within --angle degrees and
whose vertices lie within --dist * bbox_diagonal of the region plane, then
replaces each region's interior with an earcut triangulation of its boundary
loops. A flat cap becomes ~2 triangles; ornament never qualifies and keeps its
grid. Every boundary vertex is preserved, so no cracks open against neighbours.
Plain QEM decimation is NOT a substitute: it averages error everywhere and
wobbles the feature edges this pass preserves by construction.
"""
import argparse
import math
import sys

import numpy as np
import mapbox_earcut


def parse_obj(path):
    verts, faces = [], []
    for line in open(path):
        if line.startswith("v "):
            verts.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("f "):
            faces.append([int(tok.split("/")[0]) - 1 for tok in line.split()[1:]])
    return np.array(verts, dtype=np.float64), faces


def face_normal_area(verts, face):
    n = np.zeros(3)
    pts = verts[face]
    for i in range(len(face)):  # Newell
        a, b = pts[i], pts[(i + 1) % len(face)]
        n += np.cross(a, b)
    length = np.linalg.norm(n)
    return (n / length if length > 1e-20 else n), length * 0.5


def build_adjacency(faces):
    edge_faces = {}
    for fi, face in enumerate(faces):
        for i in range(len(face)):
            e = (min(face[i], face[(i + 1) % len(face)]), max(face[i], face[(i + 1) % len(face)]))
            edge_faces.setdefault(e, []).append(fi)
    adj = [[] for _ in faces]
    for linked in edge_faces.values():
        for a in linked:
            for b in linked:
                if a != b:
                    adj[a].append(b)
    return adj, edge_faces


def grow_regions(verts, faces, normals, areas, adj, cos_tol, dist_tol):
    region_of = [-1] * len(faces)
    regions = []
    for seed in range(len(faces)):
        if region_of[seed] >= 0 or areas[seed] < 1e-20:
            continue
        member = [seed]
        region_of[seed] = len(regions)
        avg_n = normals[seed] * areas[seed]
        centroid = verts[faces[seed]].mean(axis=0)
        queue = [seed]
        while queue:
            f = queue.pop()
            unit_n = avg_n / (np.linalg.norm(avg_n) + 1e-20)
            for nb in adj[f]:
                if region_of[nb] >= 0:
                    continue
                if np.dot(normals[nb], unit_n) < cos_tol:
                    continue
                if np.max(np.abs((verts[faces[nb]] - centroid) @ unit_n)) > dist_tol:
                    continue
                region_of[nb] = region_of[seed]
                member.append(nb)
                avg_n += normals[nb] * areas[nb]
                queue.append(nb)
        regions.append(member)
    return regions


def boundary_loops(faces, member, edge_faces):
    inside = set(member)
    # Directed boundary edges preserve winding: an edge of a member face whose
    # opposite face is outside the region.
    next_vert = {}
    for fi in member:
        face = faces[fi]
        for i in range(len(face)):
            a, b = face[i], face[(i + 1) % len(face)]
            linked = edge_faces[(min(a, b), max(a, b))]
            if sum(1 for x in linked if x in inside) == 1:
                next_vert[a] = b
    loops = []
    seen = set()
    for start in list(next_vert):
        if start in seen:
            continue
        loop, v = [], start
        while True:
            loop.append(v)
            seen.add(v)
            v = next_vert.get(v)
            if v is None or v == start:
                break
            if v in seen and v != start:
                break
        if v == start and len(loop) >= 3:
            loops.append(loop)
    return loops


def flatten_region(verts, member, loops, unit_n):
    # Basis in the region plane; earcut in 2D with hole support.
    axis = np.array([1.0, 0.0, 0.0]) if abs(unit_n[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(unit_n, axis)
    u /= np.linalg.norm(u)
    w = np.cross(unit_n, u)

    def project(loop):
        pts = verts[loop]
        return np.stack([pts @ u, pts @ w], axis=1)

    def signed_area(p2):
        return 0.5 * float(np.sum(p2[:, 0] * np.roll(p2[:, 1], -1) - np.roll(p2[:, 0], -1) * p2[:, 1]))

    projected = [(loop, project(loop)) for loop in loops]
    projected.sort(key=lambda item: -abs(signed_area(item[1])))
    flat_pts, rings, order = [], [], []
    for loop, p2 in projected:
        flat_pts.extend(p2)
        order.extend(loop)
        rings.append(len(flat_pts))
    tri_idx = mapbox_earcut.triangulate_float64(np.array(flat_pts), np.array(rings, dtype=np.uint32))
    tris = []
    for t in range(0, len(tri_idx), 3):
        tri = [order[tri_idx[t]], order[tri_idx[t + 1]], order[tri_idx[t + 2]]]
        a, b, c = verts[tri[0]], verts[tri[1]], verts[tri[2]]
        if np.dot(np.cross(b - a, c - a), unit_n) < 0:
            tri.reverse()
        tris.append(tri)
    return tris


def plane_basis(unit_n):
    axis = np.array([1.0, 0.0, 0.0]) if abs(unit_n[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(unit_n, axis)
    u /= np.linalg.norm(u)
    return u, np.cross(unit_n, u)


def flatten_region_union(verts, faces, member, unit_n, simplify_dist, new_verts, base):
    """The user's ring-walk outcome computed as robust 2D geometry (req_4583): project
    the region's faces onto its plane, boolean-union them into one clean polygon
    (holes included), Douglas-Peucker the outline, then triangulate. A rectangle
    lands at its corners -> 2 triangles; a door front keeps its panel holes. The
    boundary-loop chasing this replaces broke on jittery isosurface boundaries
    (self-intersecting simplified loops -> earcut garbage -> missing faces)."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    u, w = plane_basis(unit_n)
    origin = verts[faces[member[0]][0]]

    def to2d(i):
        p = verts[i] - origin
        return (float(p @ u), float(p @ w))

    polys = []
    for fi in member:
        poly = Polygon([to2d(i) for i in faces[fi]])
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_valid and not poly.is_empty and poly.area > 0:
            polys.append(poly)
    if not polys:
        return None
    merged = unary_union(polys)
    if merged.is_empty:
        return None
    geoms = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]

    tris = []
    for geom in geoms:
        geom = geom.simplify(simplify_dist, preserve_topology=True)
        if geom.is_empty or geom.area <= 0:
            continue
        rings_pts = [list(geom.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in geom.interiors]
        flat_pts, rings = [], []
        for ring in rings_pts:
            flat_pts.extend(ring)
            rings.append(len(flat_pts))
        idx = mapbox_earcut.triangulate_float64(np.array(flat_pts), np.array(rings, dtype=np.uint32))
        ids = []
        for x, y in flat_pts:
            p3 = origin + u * x + w * y
            key = (round(p3[0], 6), round(p3[1], 6), round(p3[2], 6))
            if key not in new_verts:
                new_verts[key] = base + len(new_verts)
            ids.append(new_verts[key])
        for t in range(0, len(idx), 3):
            tri = [ids[idx[t]], ids[idx[t + 1]], ids[idx[t + 2]]]
            a2, b2, c2 = flat_pts[idx[t]], flat_pts[idx[t + 1]], flat_pts[idx[t + 2]]
            cross2 = (b2[0] - a2[0]) * (c2[1] - a2[1]) - (b2[1] - a2[1]) * (c2[0] - a2[0])
            if cross2 < 0:
                tri.reverse()
            tris.append(tri)
    return tris if tris else None


def panelize_region(verts, faces, member, unit_n, edge_faces, min_run):
    """The user's full walkthrough as math (req_4587): straighten each boundary run,
    weld the shared verts onto the straightened lines so neighbours stretch to meet
    the clean edge (their extrude-then-weld seal — the step whose absence left
    hundreds of penetrating slivers in earlier passes), then rebuild the region as
    the few-corner polygon. MUTATES verts: boundary verts move onto their fitted
    lines and the whole region flattens onto its plane."""
    u, w = plane_basis(unit_n)
    origin = verts[faces[member[0]][0]].copy()

    loops = boundary_loops(faces, member, edge_faces)
    if not loops:
        return None

    def to2d(i):
        p = verts[i] - origin
        return np.array([p @ u, p @ w])

    new_loops = []
    for loop in loops:
        pts = [to2d(i) for i in loop]
        count = len(loop)
        if count < 4:
            new_loops.append(loop)
            continue
        # Split the loop into runs of consistent direction (~the user's straight
        # edges). A run break happens where the local direction turns > 35 deg.
        dirs = []
        for i in range(count):
            d = pts[(i + 1) % count] - pts[i]
            n = np.linalg.norm(d)
            dirs.append(d / n if n > 1e-12 else np.array([1.0, 0.0]))
        breaks = [i for i in range(count) if np.dot(dirs[(i - 1) % count], dirs[i]) < math.cos(math.radians(35))]
        if len(breaks) < 3:
            new_loops.append(loop)
            continue
        runs = []
        for bi in range(len(breaks)):
            start, end = breaks[bi], breaks[(bi + 1) % len(breaks)]
            idxs = list(range(start, end + 1)) if end >= start else list(range(start, count)) + list(range(0, end + 1))
            runs.append(idxs)
        # Fit a line per run (mean point + principal direction); short runs keep
        # their chord so chamfers survive.
        lines = []
        for run in runs:
            rp = np.array([pts[i] for i in run])
            mean = rp.mean(axis=0)
            if len(run) >= min_run:
                _, _, vt = np.linalg.svd(rp - mean)
                direction = vt[0]
            else:
                chord = rp[-1] - rp[0]
                n = np.linalg.norm(chord)
                direction = chord / n if n > 1e-12 else np.array([1.0, 0.0])
            lines.append((mean, direction))
        # Corners = consecutive line intersections; parallel neighbours fall back
        # to the shared vertex.
        corners = []
        for bi in range(len(lines)):
            (m1, d1), (m2, d2) = lines[bi], lines[(bi + 1) % len(lines)]
            denom = d1[0] * d2[1] - d1[1] * d2[0]
            if abs(denom) < 1e-9:
                corners.append(pts[runs[bi][-1]])
            else:
                t = ((m2[0] - m1[0]) * d2[1] - (m2[1] - m1[1]) * d2[0]) / denom
                corners.append(m1 + d1 * t)
        # THE SEAL: project every run vert onto its fitted line, in-plane — the
        # neighbours' shared verts move with it, so the clean edge stays sewn.
        for bi, run in enumerate(runs):
            mean, direction = lines[bi]
            for i in run:
                p = pts[i]
                proj = mean + direction * float((p - mean) @ direction)
                verts[loop[i]] = origin + u * proj[0] + w * proj[1]
        new_loops.append([np.asarray(c, dtype=np.float64) for c in corners])

    # Triangulate exterior + holes together (largest |area| ring is the outer).
    rings2d = []
    for entry in new_loops:
        ring = [np.asarray(to2d(i)) for i in entry] if entry and isinstance(entry[0], (int, np.integer)) else entry
        if len(ring) >= 3:
            rings2d.append(ring)
    if not rings2d:
        return None

    def ring_area(ring):
        return 0.5 * sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1]
                         for i in range(len(ring)))

    rings2d.sort(key=lambda r: -abs(ring_area(r)))
    flat_pts, ring_ends = [], []
    for ring in rings2d:
        flat_pts.extend([(float(p[0]), float(p[1])) for p in ring])
        ring_ends.append(len(flat_pts))
    idx = mapbox_earcut.triangulate_float64(np.array(flat_pts), np.array(ring_ends, dtype=np.uint32))
    return origin, u, w, flat_pts, idx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--angle", type=float, default=2.5, help="normal agreement tolerance, degrees")
    ap.add_argument("--dist", type=float, default=0.002, help="plane distance tolerance, fraction of bbox diagonal")
    ap.add_argument("--min-faces", type=int, default=8, help="regions smaller than this keep their grid")
    ap.add_argument("--simplify", type=float, default=0.0, metavar="FRAC",
                    help="rebuild each flat region via 2D polygon union + Douglas-Peucker at "
                         "FRAC * bbox_diagonal (0 = off, keep every boundary vertex crack-free)")
    ap.add_argument("--panelize", action="store_true",
                    help="straighten boundary runs, WELD neighbour verts onto the straightened "
                         "lines (sealed seams), rebuild regions as few-corner panels (req_4587)")
    ap.add_argument("--min-run", type=int, default=4, help="panelize: verts needed to line-fit a run")
    args = ap.parse_args()

    verts, faces = parse_obj(args.input)
    diag = float(np.linalg.norm(verts.max(axis=0) - verts.min(axis=0)))
    cos_tol = math.cos(math.radians(args.angle))
    dist_tol = args.dist * diag

    normal_area = [face_normal_area(verts, f) for f in faces]
    normals = np.array([n for n, _ in normal_area])
    areas = np.array([a for _, a in normal_area])
    adj, edge_faces = build_adjacency(faces)
    regions = grow_regions(verts, faces, normals, areas, adj, cos_tol, dist_tol)

    out_faces = []
    merged = 0
    new_verts = {}
    for member in regions:
        if len(member) < args.min_faces:
            out_faces.extend(faces[fi] for fi in member)
            continue
        avg = np.zeros(3)
        for fi in member:
            avg += normals[fi] * areas[fi]
        unit_n = avg / (np.linalg.norm(avg) + 1e-20)
        if args.panelize:
            result = panelize_region(verts, faces, member, unit_n, edge_faces, args.min_run)
            tris = None
            if result is not None:
                origin, u, w, flat_pts, idx = result
                ids = []
                for x, y in flat_pts:
                    p3 = origin + u * x + w * y
                    key = (round(p3[0], 6), round(p3[1], 6), round(p3[2], 6))
                    if key not in new_verts:
                        new_verts[key] = len(verts) + len(new_verts)
                    ids.append(new_verts[key])
                tris = []
                for t in range(0, len(idx), 3):
                    tri = [ids[idx[t]], ids[idx[t + 1]], ids[idx[t + 2]]]
                    a2, b2, c2 = flat_pts[idx[t]], flat_pts[idx[t + 1]], flat_pts[idx[t + 2]]
                    cr = (b2[0] - a2[0]) * (c2[1] - a2[1]) - (b2[1] - a2[1]) * (c2[0] - a2[0])
                    if cr < 0:
                        tri.reverse()
                    tris.append(tri)
        elif args.simplify > 0:
            tris = flatten_region_union(verts, faces, member, unit_n, args.simplify * diag, new_verts, len(verts))
        else:
            loops = boundary_loops(faces, member, edge_faces)
            tris = flatten_region(verts, member, loops, unit_n) if loops else None
        if not tris or len(tris) >= len(member):
            out_faces.extend(faces[fi] for fi in member)
            continue
        out_faces.extend(tris)
        merged += 1

    with open(args.output, "w") as out:
        for v in verts:
            out.write(f"v {v[0]} {v[1]} {v[2]}\n")
        for key, _ in sorted(new_verts.items(), key=lambda item: item[1]):
            out.write(f"v {key[0]} {key[1]} {key[2]}\n")
        for face in out_faces:
            out.write("f " + " ".join(str(i + 1) for i in face) + "\n")
    before = len(faces)
    after = len(out_faces)
    print(f"{before} faces -> {after} faces ({merged} flat regions collapsed)")


if __name__ == "__main__":
    sys.exit(main())
