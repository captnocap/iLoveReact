// @material product_baggie
// @slug product-baggie
// @name Product Baggie
// @board contraband
// @variant-labels Crystal, Powder, Brick
// @kind surface
// @tags contraband, product, baggie
// @author legacy
fn product_baggie(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Plastic baggie sheen over product — the dealing loop's quality grade made
  // visible. 0 crystal (glass), 1 fine powder, 2 pressed brick.
  var content = vec3f(0.82, 0.86, 0.92);
  if (variant < 0.5) {
    let g = uv * 9.0;
    let cidx = floor(g);
    let fl = fract(g);
    let facet = rand(cidx + vec2f(seed, seed * 2.0));
    let cedge = max(1.0 - smoothstep(0.0, 0.10, fl.x), 1.0 - smoothstep(0.0, 0.10, fl.y));
    content = mix(vec3f(0.60, 0.70, 0.82), vec3f(0.92, 0.98, 1.0), facet);
    content = content + vec3f(0.6, 0.6, 0.6) * cedge * step(0.6, facet);
  } else if (variant < 1.5) {
    content = mix(vec3f(0.80, 0.80, 0.84), vec3f(0.98, 0.97, 0.99), fbm(uv.x * 30.0 + seed, uv.y * 30.0, 5.0) * 0.5 + 0.5);
    content = content - vec3f(0.08, 0.08, 0.08) * speckle(px, 1.6, seed, 0.6);
  } else {
    content = mix(vec3f(0.46, 0.34, 0.22), vec3f(0.66, 0.50, 0.32), fbm(uv.x * 7.0 + seed, uv.y * 7.0, 4.0) * 0.5 + 0.5);
    let wrap = line_near(uv.x - 0.5, 0.02) + line_near(uv.y - 0.5, 0.02);
    content = content - vec3f(0.12, 0.12, 0.12) * sat(wrap);
  }
  let wrinkle = line_near(snoise(uv.x * 6.0 + seed, uv.y * 9.0 - seed), 0.02);
  let sheen = smoothstep(0.45, 0.5, abs(fract((uv.x + uv.y) * 1.5 + 0.2) - 0.5));
  var col = content + vec3f(0.10, 0.10, 0.10) * wrinkle;
  col = col + vec3f(0.22, 0.22, 0.22) * (1.0 - sheen) * 0.5;
  return sat3(col);
}
