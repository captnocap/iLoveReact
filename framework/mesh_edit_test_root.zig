//! Test ROOT shim for the mesh-edit unit target (req_4671). A Zig module's file
//! imports are bounded by its root file's DIRECTORY — and model_paint (imported
//! by mesh_edit) reaches ../diag/, so a module rooted at framework/gpu/ cannot
//! compile: the suite silently stopped building when those imports landed. Rooting
//! the module HERE keeps every transitive file import inside framework/.
pub const impl = @import("gpu/mesh_edit.zig");

test {
    _ = impl; // run mesh_edit's inline tests (mirror twins, follow, weld) under this root
}
