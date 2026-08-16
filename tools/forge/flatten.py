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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--angle", type=float, default=2.5, help="normal agreement tolerance, degrees")
    ap.add_argument("--dist", type=float, default=0.002, help="plane distance tolerance, fraction of bbox diagonal")
    ap.add_argument("--min-faces", type=int, default=8, help="regions smaller than this keep their grid")
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
    for member in regions:
        if len(member) < args.min_faces:
            out_faces.extend(faces[fi] for fi in member)
            continue
        avg = np.zeros(3)
        for fi in member:
            avg += normals[fi] * areas[fi]
        unit_n = avg / (np.linalg.norm(avg) + 1e-20)
        loops = boundary_loops(faces, member, edge_faces)
        if not loops:
            out_faces.extend(faces[fi] for fi in member)
            continue
        tris = flatten_region(verts, member, loops, unit_n)
        if not tris or len(tris) >= len(member):
            out_faces.extend(faces[fi] for fi in member)
            continue
        out_faces.extend(tris)
        merged += 1

    with open(args.output, "w") as out:
        for v in verts:
            out.write(f"v {v[0]} {v[1]} {v[2]}\n")
        for face in out_faces:
            out.write("f " + " ".join(str(i + 1) for i in face) + "\n")
    before = len(faces)
    after = len(out_faces)
    print(f"{before} faces -> {after} faces ({merged} flat regions collapsed)")


if __name__ == "__main__":
    sys.exit(main())
