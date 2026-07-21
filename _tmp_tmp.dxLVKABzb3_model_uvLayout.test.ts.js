(() => {
  // cart/editor/model/uvLayout.ts
  var UV_LAYOUT_TUNING = {
    gutterTexels: 2,
    minimumIslandTexels: 1,
    vertexHandleHitPx: 8,
    middleMouseButtonsMask: 2,
    checkerPx: 20,
    canvasPaddingPx: 16,
    defaultNativeScale: 4,
    minimumZoom: 0.05,
    maximumZoom: 32,
    vertexSnapTexels: 0.5,
    pointMatchEpsilon: 1e-4
  };
  var integer = (value) => Math.round(Number.isFinite(value) ? value : 0);
  var clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  function shouldPanUvCanvas(tool, mouseButtonsMask) {
    return tool === "pan" || (integer(mouseButtonsMask) & UV_LAYOUT_TUNING.middleMouseButtonsMask) !== 0;
  }
  function parseUvIslandRects(rects, groups, triangles) {
    if (!rects || rects.length % 4 !== 0) return [];
    const out = [];
    for (let index = 0; index < rects.length; index += 4) {
      out.push({
        x: integer(rects[index]),
        y: integer(rects[index + 1]),
        w: Math.max(1, integer(rects[index + 2])),
        h: Math.max(1, integer(rects[index + 3])),
        group: integer(groups?.[index / 4] ?? 4294967295) >>> 0,
        triangles: []
      });
    }
    if (triangles && triangles.length % 7 === 0) {
      for (let index = 0; index < triangles.length; index += 7) {
        const islandIndex = integer(triangles[index]);
        const island = out[islandIndex];
        if (!island) continue;
        const local = [];
        for (let corner = 0; corner < 3; corner += 1) {
          const x = Number(triangles[index + 1 + corner * 2]);
          const y = Number(triangles[index + 2 + corner * 2]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            local.length = 0;
            break;
          }
          local.push((x - island.x) / island.w, (y - island.y) / island.h);
        }
        if (local.length === 6) island.triangles.push({
          // __model_atlas_read emits every face in render-face order. Keeping that
          // row identity is what lets a deformed triangle round-trip exactly.
          face: index / 7,
          points: [local[0], local[1], local[2], local[3], local[4], local[5]]
        });
      }
    }
    return out;
  }
  function flattenUvIslandRects(rects) {
    const out = new Uint32Array(rects.length * 4);
    rects.forEach((rect, index) => {
      out[index * 4] = rect.x;
      out[index * 4 + 1] = rect.y;
      out[index * 4 + 2] = rect.w;
      out[index * 4 + 3] = rect.h;
    });
    return out;
  }
  function flattenUvFaceCorners(rects) {
    let faceCount = 0;
    for (const rect of rects) {
      for (const triangle of rect.triangles ?? []) faceCount = Math.max(faceCount, triangle.face + 1);
    }
    if (faceCount === 0) return null;
    const seen = new Uint8Array(faceCount);
    const out = new Float32Array(faceCount * 6);
    for (const rect of rects) {
      for (const triangle of rect.triangles ?? []) {
        if (!Number.isInteger(triangle.face) || triangle.face < 0 || triangle.face >= faceCount || seen[triangle.face]) return null;
        seen[triangle.face] = 1;
        for (let corner = 0; corner < 3; corner += 1) {
          const x = rect.x + triangle.points[corner * 2] * rect.w;
          const y = rect.y + triangle.points[corner * 2 + 1] * rect.h;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          out[triangle.face * 6 + corner * 2] = x;
          out[triangle.face * 6 + corner * 2 + 1] = y;
        }
      }
    }
    for (const present of seen) if (!present) return null;
    return out;
  }
  function moveUvIsland(rect, dx, dy, atlasW, atlasH) {
    return {
      ...rect,
      x: clamp(integer(rect.x + dx), 0, Math.max(0, atlasW - rect.w)),
      y: clamp(integer(rect.y + dy), 0, Math.max(0, atlasH - rect.h))
    };
  }
  function resizeUvIsland(rect, dw, dh, atlasW, atlasH) {
    return {
      ...rect,
      w: clamp(integer(rect.w + dw), UV_LAYOUT_TUNING.minimumIslandTexels, Math.max(UV_LAYOUT_TUNING.minimumIslandTexels, atlasW - rect.x)),
      h: clamp(integer(rect.h + dh), UV_LAYOUT_TUNING.minimumIslandTexels, Math.max(UV_LAYOUT_TUNING.minimumIslandTexels, atlasH - rect.y))
    };
  }
  function resizeUvIslandFromCorner(rect, corner, dx, dy, atlasW, atlasH) {
    const minSize = UV_LAYOUT_TUNING.minimumIslandTexels;
    const left = corner === "nw" || corner === "sw" ? clamp(integer(rect.x + dx), 0, rect.x + rect.w - minSize) : rect.x;
    const top = corner === "nw" || corner === "ne" ? clamp(integer(rect.y + dy), 0, rect.y + rect.h - minSize) : rect.y;
    const right = corner === "ne" || corner === "se" ? clamp(integer(rect.x + rect.w + dx), rect.x + minSize, atlasW) : rect.x + rect.w;
    const bottom = corner === "se" || corner === "sw" ? clamp(integer(rect.y + rect.h + dy), rect.y + minSize, atlasH) : rect.y + rect.h;
    return { ...rect, x: left, y: top, w: right - left, h: bottom - top };
  }
  function absoluteTrianglePoints(rect, triangle) {
    return [
      rect.x + triangle.points[0] * rect.w,
      rect.y + triangle.points[1] * rect.h,
      rect.x + triangle.points[2] * rect.w,
      rect.y + triangle.points[3] * rect.h,
      rect.x + triangle.points[4] * rect.w,
      rect.y + triangle.points[5] * rect.h
    ];
  }
  var sameUvPoint = (ax, ay, bx, by) => Math.abs(ax - bx) <= UV_LAYOUT_TUNING.pointMatchEpsilon && Math.abs(ay - by) <= UV_LAYOUT_TUNING.pointMatchEpsilon;
  function uvIslandVertices(rect) {
    const vertices = [];
    for (const triangle of rect.triangles ?? []) {
      const points = absoluteTrianglePoints(rect, triangle);
      for (let corner = 0; corner < 3; corner += 1) {
        const x = points[corner * 2];
        const y = points[corner * 2 + 1];
        if (!vertices.some((vertex) => sameUvPoint(vertex.x, vertex.y, x, y))) vertices.push({ x, y });
      }
    }
    return vertices;
  }
  var snapUvVertex = (value) => Math.round(value / UV_LAYOUT_TUNING.vertexSnapTexels) * UV_LAYOUT_TUNING.vertexSnapTexels;
  function moveUvIslandVertex(rect, vertexIndex, dx, dy, atlasW, atlasH) {
    if (atlasW < 1 || atlasH < 1 || !rect.triangles?.length) return rect;
    const vertices = uvIslandVertices(rect);
    const selected = vertices[vertexIndex];
    if (!selected) return rect;
    const minX = Math.min(0.5, atlasW * 0.5);
    const minY = Math.min(0.5, atlasH * 0.5);
    const targetX = clamp(snapUvVertex(selected.x + dx), minX, atlasW - minX);
    const targetY = clamp(snapUvVertex(selected.y + dy), minY, atlasH - minY);
    const absolute = rect.triangles.map((triangle) => {
      const points = [...absoluteTrianglePoints(rect, triangle)];
      for (let corner = 0; corner < 3; corner += 1) {
        const at = corner * 2;
        if (!sameUvPoint(points[at], points[at + 1], selected.x, selected.y)) continue;
        points[at] = targetX;
        points[at + 1] = targetY;
      }
      return { face: triangle.face, points };
    });
    let lowX = Number.POSITIVE_INFINITY;
    let lowY = Number.POSITIVE_INFINITY;
    let highX = Number.NEGATIVE_INFINITY;
    let highY = Number.NEGATIVE_INFINITY;
    for (const triangle of absolute) {
      for (let corner = 0; corner < 3; corner += 1) {
        lowX = Math.min(lowX, triangle.points[corner * 2]);
        lowY = Math.min(lowY, triangle.points[corner * 2 + 1]);
        highX = Math.max(highX, triangle.points[corner * 2]);
        highY = Math.max(highY, triangle.points[corner * 2 + 1]);
      }
    }
    const x = clamp(Math.floor(lowX), 0, atlasW - 1);
    const y = clamp(Math.floor(lowY), 0, atlasH - 1);
    const right = clamp(Math.max(x + 1, Math.ceil(highX)), x + 1, atlasW);
    const bottom = clamp(Math.max(y + 1, Math.ceil(highY)), y + 1, atlasH);
    const w = right - x;
    const h = bottom - y;
    return {
      ...rect,
      x,
      y,
      w,
      h,
      triangles: absolute.map((triangle) => ({
        face: triangle.face,
        points: [
          (triangle.points[0] - x) / w,
          (triangle.points[1] - y) / h,
          (triangle.points[2] - x) / w,
          (triangle.points[3] - y) / h,
          (triangle.points[4] - x) / w,
          (triangle.points[5] - y) / h
        ]
      }))
    };
  }
  function pointInTriangle(triangle, u, v) {
    const edge = (ax, ay, bx, by) => (u - bx) * (ay - by) - (ax - bx) * (v - by);
    const d0 = edge(triangle[0], triangle[1], triangle[2], triangle[3]);
    const d1 = edge(triangle[2], triangle[3], triangle[4], triangle[5]);
    const d2 = edge(triangle[4], triangle[5], triangle[0], triangle[1]);
    const epsilon = 1e-5;
    const hasNegative = d0 < -epsilon || d1 < -epsilon || d2 < -epsilon;
    const hasPositive = d0 > epsilon || d1 > epsilon || d2 > epsilon;
    return !(hasNegative && hasPositive);
  }
  function hitUvIsland(rects, x, y) {
    let hit = -1;
    let area = Number.POSITIVE_INFINITY;
    rects.forEach((rect, index) => {
      if (x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h) return;
      if (rect.triangles?.length) {
        const u = (x - rect.x) / Math.max(1, rect.w);
        const v = (y - rect.y) / Math.max(1, rect.h);
        if (!rect.triangles.some((triangle) => pointInTriangle(triangle.points, u, v))) return;
      }
      const nextArea = rect.w * rect.h;
      if (nextArea <= area) {
        area = nextArea;
        hit = index;
      }
    });
    return hit;
  }
  function uniformUvPack(rects, atlasW, atlasH) {
    if (!rects.length || atlasW < 1 || atlasH < 1) return [];
    const aspect = atlasW / Math.max(1, atlasH);
    const columns = Math.max(1, Math.ceil(Math.sqrt(rects.length * aspect)));
    const rows = Math.max(1, Math.ceil(rects.length / columns));
    const cellW = Math.max(1, Math.floor(atlasW / columns));
    const cellH = Math.max(1, Math.floor(atlasH / rows));
    const gutter = UV_LAYOUT_TUNING.gutterTexels;
    const packedW = Math.max(1, cellW - gutter);
    const packedH = Math.max(1, cellH - gutter);
    return rects.map((rect, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      return {
        ...rect,
        x: column * cellW,
        y: row * cellH,
        w: Math.min(packedW, atlasW - column * cellW),
        h: Math.min(packedH, atlasH - row * cellH)
      };
    });
  }
  function uvRectPath(rects, scaleX, scaleY, offsetX = 0, offsetY = 0) {
    return rects.map((rect) => {
      const x0 = offsetX + rect.x * scaleX;
      const y0 = offsetY + rect.y * scaleY;
      const x1 = offsetX + (rect.x + rect.w) * scaleX;
      const y1 = offsetY + (rect.y + rect.h) * scaleY;
      return `M ${x0},${y0} L ${x1},${y0} L ${x1},${y1} L ${x0},${y1} Z`;
    }).join(" ");
  }
  function uvIslandBoundaryPath(rects, scaleX, scaleY, offsetX = 0, offsetY = 0) {
    return rects.map((rect) => {
      if (!rect.triangles?.length) return uvRectPath([rect], scaleX, scaleY, offsetX, offsetY);
      const edges = /* @__PURE__ */ new Map();
      const keyFor = (a, b) => {
        const ak = `${a[0].toFixed(5)},${a[1].toFixed(5)}`;
        const bk = `${b[0].toFixed(5)},${b[1].toFixed(5)}`;
        return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
      };
      rect.triangles.forEach((triangle) => {
        const trianglePoints = triangle.points;
        const points = [
          [trianglePoints[0], trianglePoints[1]],
          [trianglePoints[2], trianglePoints[3]],
          [trianglePoints[4], trianglePoints[5]]
        ];
        for (let edge = 0; edge < 3; edge += 1) {
          const a = points[edge];
          const b = points[(edge + 1) % 3];
          const key = keyFor(a, b);
          const existing = edges.get(key);
          if (existing) existing.count += 1;
          else edges.set(key, { count: 1, a, b });
        }
      });
      let path = "";
      edges.forEach((edge) => {
        if (edge.count !== 1) return;
        const ax = offsetX + (rect.x + edge.a[0] * rect.w) * scaleX;
        const ay = offsetY + (rect.y + edge.a[1] * rect.h) * scaleY;
        const bx = offsetX + (rect.x + edge.b[0] * rect.w) * scaleX;
        const by = offsetY + (rect.y + edge.b[1] * rect.h) * scaleY;
        path += `M ${ax},${ay} L ${bx},${by} `;
      });
      return path;
    }).join(" ");
  }

  // cart/editor/model/uvLayout.test.ts
  var passed = 0;
  var failed = 0;
  var log = globalThis.print ?? ((s) => globalThis.__writeStdout?.(`${s}
`));
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      log(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      log(`FAIL  ${name}: ${error.message}`);
    }
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  test("UV rect parsing and flattening preserve every island and group", () => {
    const parsed = parseUvIslandRects(
      [1, 2, 3, 4, 8, 9, 5, 6],
      [17, 23],
      [0, 1, 2, 4, 2, 1, 6, 1, 8, 9, 13, 9, 8, 15]
    );
    assert(parsed.length === 2 && parsed[1].group === 23, "island metadata was dropped");
    assert(parsed[0].triangles?.length === 1 && parsed[1].triangles?.length === 1, "triangle silhouettes were dropped");
    assert(parsed[0].triangles?.[0]?.face === 0 && parsed[1].triangles?.[0]?.face === 1, "render-face row identity was dropped");
    assert([...flattenUvIslandRects(parsed)].join(",") === "1,2,3,4,8,9,5,6", "rect serialization drifted");
    assert([...flattenUvFaceCorners(parsed)].join(",") === "1,2,4,2,1,6,8,9,13,9,8,15", "exact face-corner serialization drifted");
  });
  test("real UV handles sit on triangle vertices and collapse shared fan corners", () => {
    const rect = parseUvIslandRects(
      [0, 0, 10, 10],
      [1],
      [0, 0.5, 0.5, 9.5, 0.5, 9.5, 9.5, 0, 0.5, 0.5, 9.5, 9.5, 0.5, 9.5]
    )[0];
    const vertices = uvIslandVertices(rect);
    assert(vertices.length === 4, `quad exposed ${vertices.length} handles instead of its four real corners`);
    assert(vertices[0].x === 0.5 && vertices[0].y === 0.5, "first handle missed the authored UV vertex");
  });
  test("moving a UV vertex rewrites coincident face corners without moving the rest", () => {
    const rect = parseUvIslandRects(
      [0, 0, 10, 10],
      [1],
      [0, 0.5, 0.5, 9.5, 0.5, 9.5, 9.5, 0, 0.5, 0.5, 9.5, 9.5, 0.5, 9.5]
    )[0];
    const changed = moveUvIslandVertex(rect, 0, 2, 3, 32, 32);
    const corners = flattenUvFaceCorners([changed]);
    assert(corners[0] === 2.5 && corners[1] === 3.5, "first triangle did not follow its real vertex");
    assert(corners[6] === 2.5 && corners[7] === 3.5, "shared triangle corner tore at the fan seam");
    assert(corners[2] === 9.5 && corners[3] === 0.5 && corners[10] === 0.5 && corners[11] === 9.5, "unselected UV vertices moved");
  });
  test("whole-island movement changes sampling coordinates, not triangle-local geometry", () => {
    const rect = parseUvIslandRects([10, 20, 10, 10], [1], [0, 10.5, 20.5, 19.5, 20.5, 10.5, 29.5])[0];
    const moved = moveUvIsland(rect, 20, 15, 64, 64);
    const corners = flattenUvFaceCorners([moved]);
    assert([...corners].join(",") === "30.5,35.5,39.5,35.5,30.5,44.5", "moving the shape failed to move its exact texture-sampling coordinates");
  });
  test("move and resize stay inside the atlas without requiring text selection", () => {
    const rect = { x: 4, y: 5, w: 8, h: 9, group: 0 };
    const moved = moveUvIsland(rect, 100, -100, 32, 24);
    assert(moved.x === 24 && moved.y === 0, "move did not clamp to the atlas");
    const resized = resizeUvIsland(moved, 100, -100, 32, 24);
    assert(resized.w === 8 && resized.h === 1, "resize did not clamp to remaining bounds");
  });
  test("four-corner resize keeps the opposite corner fixed", () => {
    const rect = { x: 10, y: 12, w: 20, h: 16, group: 0 };
    const northwest = resizeUvIslandFromCorner(rect, "nw", 5, -4, 64, 64);
    assert(northwest.x === 15 && northwest.y === 8 && northwest.w === 15 && northwest.h === 20, "northwest handle moved the fixed corner");
    const southeast = resizeUvIslandFromCorner(rect, "se", 80, -80, 64, 64);
    assert(southeast.x === 10 && southeast.y === 12 && southeast.w === 54 && southeast.h === 1, "southeast handle escaped its bounds");
  });
  test("hit testing chooses the smallest overlapping island", () => {
    const rects = parseUvIslandRects([0, 0, 20, 20, 5, 5, 3, 3], [1, 2]);
    assert(hitUvIsland(rects, 6, 6) === 1, "nested island was unreachable");
  });
  test("triangle hit testing rejects empty space inside a sliver bounding box", () => {
    const rects = parseUvIslandRects([0, 0, 20, 20], [1], [0, 0, 0, 20, 0, 0, 2]);
    assert(hitUvIsland(rects, 10, 1) === 0, "visible sliver was not selectable");
    assert(hitUvIsland(rects, 10, 15) === -1, "empty bounding-box space masqueraded as UV geometry");
  });
  test("island boundary removes an authored quad triangulation diagonal", () => {
    const rects = parseUvIslandRects(
      [0, 0, 10, 10],
      [1],
      [0, 0, 0, 10, 0, 10, 10, 0, 0, 0, 10, 10, 0, 10]
    );
    const path = uvIslandBoundaryPath(rects, 1, 1);
    assert((path.match(/ L /g) ?? []).length === 4, "shared triangle edge leaked into the authored-face outline");
  });
  test("primary drag selects one face while hand tool or middle drag pans", () => {
    assert(!shouldPanUvCanvas("select", 1), "primary button was mistaken for middle-button pan");
    assert(shouldPanUvCanvas("select", 2), "middle button did not pan from the select tool");
    assert(shouldPanUvCanvas("pan", 1), "hand tool did not pan with the primary button");
  });
  test("uniform pack gives every island an equal, bounded cell", () => {
    const rects = parseUvIslandRects([0, 0, 1, 7, 0, 0, 20, 1, 0, 0, 3, 9, 0, 0, 8, 2], [0, 1, 2, 3]);
    const packed = uniformUvPack(rects, 64, 64);
    assert(packed.length === 4, "pack dropped islands");
    assert(packed.every((rect) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= 64 && rect.y + rect.h <= 64), "pack escaped atlas");
    assert(new Set(packed.map((rect) => `${rect.w}x${rect.h}`)).size === 1, "pack did not normalize cell shapes");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed) throw new Error(`${failed} test(s) failed`);
})();
