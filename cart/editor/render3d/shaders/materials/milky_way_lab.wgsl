// @material milky_way_lab
// @slug milky-way-lab
// @name Milky Way Lab
// @board gradients
// @variant-labels Summer Core, Winter Arm, Desert Clear
// @kind composition
// @tags lab, gradients, milkyway, stars, night
// @author lab
// @param p_layer_0_opacity: f32 = 0.6315739329268293 range(0.0, 1.0) "Layer 1 opacity"
// @param p_layer_0_amount: f32 = 1.0787919207317072 range(-1.0, 2.0) "Layer 1 amount"
// @param p_layer_0_mask_threshold: f32 = 0.8331030868902439 range(0.0, 1.0) "Layer 1 mask threshold"
// @param p_layer_0_mask_softness: f32 = 0.3814219911156631 range(0.0001, 0.5) "Layer 1 mask softness"
// @param p_layer_0_mask_field_speckle_sparsity: f32 = 0.9199791587271341 range(0.5, 0.99) "Layer 1 mask · Speckle sparsity"
// @param p_layer_0_warp_amount: f32 = 1.5555926067073171 range(0.0, 2.0) "Layer 1 warp"
// @param p_layer_0_warp_warp_ripple_frequency: f32 = 22.0 range(4.0, 60.0) "Layer 1 warp · Wave frequency"
// @param p_layer_1_opacity: f32 = 1.0 range(0.0, 1.0) "Layer 2 opacity"
// @param p_layer_1_mask_threshold: f32 = 0.5 range(0.0, 1.0) "Layer 2 mask threshold"
// @param p_layer_1_mask_softness: f32 = 0.25 range(0.0001, 0.5) "Layer 2 mask softness"
// @param p_layer_1_mask_field_fbm_scale: f32 = 6.0 range(1.0, 24.0) "Layer 2 mask · Noise scale"
// @param p_layer_1_warp_amount: f32 = 1.1433284108231707 range(0.0, 2.0) "Layer 2 warp"
// @param p_layer_1_warp_warp_ripple_frequency: f32 = 22.0 range(4.0, 60.0) "Layer 2 warp · Wave frequency"
fn milky_way_lab(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let lab_slot_0 = vec3f(0.02, 0.03, 0.07); // base · night
  let lab_slot_1 = vec3f(0.72, 0.68, 0.62); // base · bandCol
  let lab_slot_2 = vec3f(0.95, 0.8, 0.58); // base · coreCol
  let lab_slot_3 = vec3f(0.02, 0.02, 0.06); // base · night 2
  let lab_slot_4 = vec3f(0.55, 0.6, 0.72); // base · bandCol 2
  let lab_slot_5 = vec3f(0.7, 0.75, 0.88); // base · coreCol 2
  let lab_slot_6 = vec3f(0.03, 0.02, 0.05); // base · night 3
  let lab_slot_7 = vec3f(0.78, 0.66, 0.72); // base · bandCol 3
  let lab_slot_8 = vec3f(0.98, 0.85, 0.65); // base · coreCol 3
  let lab_slot_9 = vec3f(0.02, 0.02, 0.05); // base · color
  let lab_slot_10 = vec3f(0.45, 0.47, 0.55); // base · color 2
  let lab_slot_11 = vec3f(0.72, 0.7, 0.66); // base · color 3
  let lab_slot_12 = vec3f(0.95, 0.95, 0.99); // base · color 4
  let lab_slot_13 = vec3f(0.38, 0.18, 0.07); // layer 2 · low
  let lab_slot_14 = vec3f(0.8, 0.47, 0.2); // layer 2 · high
  let lab_slot_15 = vec3f(0.18, 0.095, 0.055); // layer 2 · low 2
  let lab_slot_16 = vec3f(0.52, 0.3, 0.15); // layer 2 · high 2
  let lab_slot_17 = vec3f(0.52, 0.34, 0.16); // layer 2 · low 3
  let lab_slot_18 = vec3f(0.92, 0.72, 0.4); // layer 2 · high 3
  let lab_slot_19 = vec3f(0.1, 0.07, 0.035); // layer 2 · color
  let lab_knob_p_layer_0_mask_field_speckle_sparsity = p_layer_0_mask_field_speckle_sparsity; // callee knob anchor
  let lab_knob_p_layer_0_warp_warp_ripple_frequency = p_layer_0_warp_warp_ripple_frequency; // callee knob anchor
  let lab_knob_p_layer_1_mask_field_fbm_scale = p_layer_1_mask_field_fbm_scale; // callee knob anchor
  let lab_knob_p_layer_1_warp_warp_ripple_frequency = p_layer_1_warp_warp_ripple_frequency; // callee knob anchor
  var col = vec3f(0.0, 0.0, 0.0);
  col = milky_way(uv, px, variant, seed);
  {
    var layer_uv = uv;
    mat_param_offset = 6;
    layer_uv = warp_ripple(uv, seed + 7.0, p_layer_0_warp_amount);
    mat_param_offset = 0;
    var factor = p_layer_0_opacity;
    mat_param_offset = 4;
    let mask_v = field_speckle(uv, px, seed + 7.0);
    mat_param_offset = 0;
    let mask_t = p_layer_0_mask_threshold;
    let mask_s = max(p_layer_0_mask_softness, 0.0001);
    factor = factor * smoothstep(mask_t - mask_s, mask_t + mask_s, mask_v);
    let filtered = colormod_hue(col, layer_uv, px, seed + 7.0, p_layer_0_amount);
    col = mix(col, filtered, factor);
  }
  {
    var layer_uv = uv;
    mat_param_offset = 12;
    layer_uv = warp_ripple(uv, seed + 14.0, p_layer_1_warp_amount);
    mat_param_offset = 0;
    var factor = p_layer_1_opacity;
    mat_param_offset = 10;
    let mask_v = field_fbm(uv, px, seed + 14.0);
    mat_param_offset = 0;
    let mask_t = p_layer_1_mask_threshold;
    let mask_s = max(p_layer_1_mask_softness, 0.0001);
    factor = factor * smoothstep(mask_t - mask_s, mask_t + mask_s, mask_v);
    mat_slot_offset = 13;
    let over = wood(layer_uv, px, 0.0, seed + 14.0);
    mat_slot_offset = 0;
    col = surface_blend(0, col, over, factor);
  }
  return sat3(col);
}
// @recipe-json {"version":1,"id":"milky-way-lab","name":"Milky Way Lab","base":{"fn":"milky_way"},"layers":[{"atom":"colormod_hue","opacity":0.6315739329268293,"amount":1.0787919207317072,"mask":{"field":"field_speckle","threshold":0.8331030868902439,"softness":0.3814219911156631},"warp":{"atom":"warp_ripple","amount":1.5555926067073171}},{"atom":"wood","blend":0,"opacity":1,"warp":{"atom":"warp_ripple","amount":1.1433284108231707},"mask":{"field":"field_fbm","threshold":0.5,"softness":0.25}}],"params":{"layer.0.mask.field_speckle.sparsity":0.9199791587271341}}
