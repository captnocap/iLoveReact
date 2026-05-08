// launcher.c — engine channel selector
//
// Thin launcher that dlopen's the right engine .so at runtime.
// Cart code is compiled in statically. Engine is loaded dynamically.
//
// Usage:
//   ./my_app                      → loads libreactjit-core.stable.so
//   ./my_app --engine=nightly     → loads libreactjit-core.nightly.so
//   ./my_app --engine=bleeding    → loads libreactjit-core.bleeding.so
//   RJIT_ENGINE=bleeding ./my_app → same via env var
//
// The cart provides: app_get_root, app_get_init, app_get_tick, app_get_title
// The engine provides: rjit_engine_run, rjit_state_*

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dlfcn.h>
#include <unistd.h>

// Engine function typedefs (must match api.zig extern declarations)
typedef struct { float x, y, w, h; } LayoutRect;

typedef struct {
    const char *title;
    void *root;
    const char *js_logic_ptr;
    unsigned long js_logic_len;
    const char *lua_logic_ptr;
    unsigned long lua_logic_len;
    void (*init)(void);
    void (*tick)(unsigned int);
} EngineConfig;

typedef int (*rjit_engine_run_fn)(const EngineConfig *config);
typedef unsigned long (*rjit_state_create_slot_fn)(long initial);
typedef long (*rjit_state_get_slot_fn)(unsigned long id);
typedef void (*rjit_state_set_slot_fn)(unsigned long id, long val);
typedef unsigned long (*rjit_state_create_slot_float_fn)(double initial);
typedef double (*rjit_state_get_slot_float_fn)(unsigned long id);
typedef void (*rjit_state_set_slot_float_fn)(unsigned long id, double val);
typedef unsigned long (*rjit_state_create_slot_bool_fn)(int initial);
typedef int (*rjit_state_get_slot_bool_fn)(unsigned long id);
typedef void (*rjit_state_set_slot_bool_fn)(unsigned long id, int val);
typedef unsigned long (*rjit_state_create_slot_string_fn)(const char *ptr, unsigned long len);
typedef const char *(*rjit_state_get_slot_string_ptr_fn)(unsigned long id);
typedef unsigned long (*rjit_state_get_slot_string_len_fn)(unsigned long id);
typedef void (*rjit_state_set_slot_string_fn)(unsigned long id, const char *ptr, unsigned long len);
typedef void (*rjit_state_mark_dirty_fn)(void);
typedef int (*rjit_state_is_dirty_fn)(void);
typedef void (*rjit_state_clear_dirty_fn)(void);

// Global function pointers — cart code calls these
rjit_engine_run_fn              g_rjit_engine_run;
rjit_state_create_slot_fn       g_rjit_state_create_slot;
rjit_state_get_slot_fn          g_rjit_state_get_slot;
rjit_state_set_slot_fn          g_rjit_state_set_slot;
rjit_state_create_slot_float_fn g_rjit_state_create_slot_float;
rjit_state_get_slot_float_fn    g_rjit_state_get_slot_float;
rjit_state_set_slot_float_fn    g_rjit_state_set_slot_float;
rjit_state_create_slot_bool_fn  g_rjit_state_create_slot_bool;
rjit_state_get_slot_bool_fn     g_rjit_state_get_slot_bool;
rjit_state_set_slot_bool_fn     g_rjit_state_set_slot_bool;
rjit_state_create_slot_string_fn g_rjit_state_create_slot_string;
rjit_state_get_slot_string_ptr_fn g_rjit_state_get_slot_string_ptr;
rjit_state_get_slot_string_len_fn g_rjit_state_get_slot_string_len;
rjit_state_set_slot_string_fn   g_rjit_state_set_slot_string;
rjit_state_mark_dirty_fn        g_rjit_state_mark_dirty;
rjit_state_is_dirty_fn          g_rjit_state_is_dirty;
rjit_state_clear_dirty_fn       g_rjit_state_clear_dirty;

// Trampoline functions — these have the exact symbol names that cart .o expects
unsigned long rjit_state_create_slot(long v)           { return g_rjit_state_create_slot(v); }
long          rjit_state_get_slot(unsigned long id)    { return g_rjit_state_get_slot(id); }
void          rjit_state_set_slot(unsigned long id, long v) { g_rjit_state_set_slot(id, v); }
unsigned long rjit_state_create_slot_float(double v)   { return g_rjit_state_create_slot_float(v); }
double        rjit_state_get_slot_float(unsigned long id) { return g_rjit_state_get_slot_float(id); }
void          rjit_state_set_slot_float(unsigned long id, double v) { g_rjit_state_set_slot_float(id, v); }
unsigned long rjit_state_create_slot_bool(int v)       { return g_rjit_state_create_slot_bool(v); }
int           rjit_state_get_slot_bool(unsigned long id) { return g_rjit_state_get_slot_bool(id); }
void          rjit_state_set_slot_bool(unsigned long id, int v) { g_rjit_state_set_slot_bool(id, v); }
unsigned long rjit_state_create_slot_string(const char *p, unsigned long l) { return g_rjit_state_create_slot_string(p, l); }
const char   *rjit_state_get_slot_string_ptr(unsigned long id) { return g_rjit_state_get_slot_string_ptr(id); }
unsigned long rjit_state_get_slot_string_len(unsigned long id) { return g_rjit_state_get_slot_string_len(id); }
void          rjit_state_set_slot_string(unsigned long id, const char *p, unsigned long l) { g_rjit_state_set_slot_string(id, p, l); }
void          rjit_state_mark_dirty(void)              { g_rjit_state_mark_dirty(); }
int           rjit_state_is_dirty(void)                { return g_rjit_state_is_dirty(); }
void          rjit_state_clear_dirty(void)             { g_rjit_state_clear_dirty(); }
int           rjit_engine_run(const EngineConfig *c)   { return g_rjit_engine_run(c); }

static void *load_sym(void *handle, const char *name) {
    void *sym = dlsym(handle, name);
    if (!sym) {
        fprintf(stderr, "[launcher] Missing symbol: %s\n", name);
        exit(1);
    }
    return sym;
}

// Cart entry point (defined in the cart .o, linked statically)
extern int main_cart(void);

int main(int argc, char **argv) {
    // Determine engine channel
    const char *channel = "stable";

    // Check env first
    const char *env = getenv("RJIT_ENGINE");
    if (env && env[0]) channel = env;

    // CLI flag overrides env
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "--engine=", 9) == 0) {
            channel = argv[i] + 9;
        }
    }

    // Build .so path
    char so_path[512];
    // Look relative to executable
    snprintf(so_path, sizeof(so_path), "libreactjit-core.%s.so", channel);

    // Try loading
    void *engine = dlopen(so_path, RTLD_NOW | RTLD_GLOBAL);
    if (!engine) {
        // Try with lib/ prefix
        char so_path2[512];
        snprintf(so_path2, sizeof(so_path2), "zig-out/lib/libreactjit-core.%s.so", channel);
        engine = dlopen(so_path2, RTLD_NOW | RTLD_GLOBAL);
    }
    if (!engine) {
        // Try absolute path from executable dir
        char exe_dir[256] = "";
        ssize_t len = readlink("/proc/self/exe", exe_dir, sizeof(exe_dir) - 1);
        if (len > 0) {
            exe_dir[len] = 0;
            char *last_slash = strrchr(exe_dir, '/');
            if (last_slash) *last_slash = 0;
            char so_path3[512];
            snprintf(so_path3, sizeof(so_path3), "%s/../lib/libreactjit-core.%s.so", exe_dir, channel);
            engine = dlopen(so_path3, RTLD_NOW | RTLD_GLOBAL);
        }
    }
    if (!engine) {
        fprintf(stderr, "[launcher] Failed to load engine channel '%s': %s\n", channel, dlerror());
        fprintf(stderr, "[launcher] Available channels: stable, nightly, bleeding\n");
        fprintf(stderr, "[launcher] Run 'rjit core' to build, then 'rjit promote stable'\n");
        return 1;
    }

    // Resolve all symbols
    g_rjit_engine_run             = (rjit_engine_run_fn)load_sym(engine, "rjit_engine_run");
    g_rjit_state_create_slot      = (rjit_state_create_slot_fn)load_sym(engine, "rjit_state_create_slot");
    g_rjit_state_get_slot         = (rjit_state_get_slot_fn)load_sym(engine, "rjit_state_get_slot");
    g_rjit_state_set_slot         = (rjit_state_set_slot_fn)load_sym(engine, "rjit_state_set_slot");
    g_rjit_state_create_slot_float = (rjit_state_create_slot_float_fn)load_sym(engine, "rjit_state_create_slot_float");
    g_rjit_state_get_slot_float   = (rjit_state_get_slot_float_fn)load_sym(engine, "rjit_state_get_slot_float");
    g_rjit_state_set_slot_float   = (rjit_state_set_slot_float_fn)load_sym(engine, "rjit_state_set_slot_float");
    g_rjit_state_create_slot_bool = (rjit_state_create_slot_bool_fn)load_sym(engine, "rjit_state_create_slot_bool");
    g_rjit_state_get_slot_bool    = (rjit_state_get_slot_bool_fn)load_sym(engine, "rjit_state_get_slot_bool");
    g_rjit_state_set_slot_bool    = (rjit_state_set_slot_bool_fn)load_sym(engine, "rjit_state_set_slot_bool");
    g_rjit_state_create_slot_string = (rjit_state_create_slot_string_fn)load_sym(engine, "rjit_state_create_slot_string");
    g_rjit_state_get_slot_string_ptr = (rjit_state_get_slot_string_ptr_fn)load_sym(engine, "rjit_state_get_slot_string_ptr");
    g_rjit_state_get_slot_string_len = (rjit_state_get_slot_string_len_fn)load_sym(engine, "rjit_state_get_slot_string_len");
    g_rjit_state_set_slot_string  = (rjit_state_set_slot_string_fn)load_sym(engine, "rjit_state_set_slot_string");
    g_rjit_state_mark_dirty       = (rjit_state_mark_dirty_fn)load_sym(engine, "rjit_state_mark_dirty");
    g_rjit_state_is_dirty         = (rjit_state_is_dirty_fn)load_sym(engine, "rjit_state_is_dirty");
    g_rjit_state_clear_dirty      = (rjit_state_clear_dirty_fn)load_sym(engine, "rjit_state_clear_dirty");

    if (strcmp(channel, "stable") != 0) {
        fprintf(stderr, "[rjit] Engine channel: %s\n", channel);
    }

    // Hand off to cart
    return main_cart();
}
