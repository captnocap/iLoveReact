# react-love Makefile
# Builds: QuickJS shared library + bundled React apps for both targets

QUICKJS_DIR = quickjs
NATIVE_GAME = examples/native-hud/game
LIB_DIR = $(NATIVE_GAME)/lib
STORYBOOK_LOVE = examples/storybook/love
STORYBOOK_LIB = $(STORYBOOK_LOVE)/lib

.PHONY: all clean setup build build-native build-web build-storybook build-storybook-native run dev storybook storybook-web install

all: setup build

# ── Dependencies ────────────────────────────────────────

install: node_modules

node_modules:
	npm install

# ── QuickJS setup (native target only) ──────────────────

setup: $(LIB_DIR)/libquickjs.so

$(QUICKJS_DIR):
	git clone https://github.com/quickjs-ng/quickjs.git $(QUICKJS_DIR)

# Copy our shim into the QuickJS source tree before building.
# The canonical copy lives in native/quickjs-shim/ (tracked in git).
$(QUICKJS_DIR)/qjs_ffi_shim.c: native/quickjs-shim/qjs_ffi_shim.c $(QUICKJS_DIR)
	cp native/quickjs-shim/qjs_ffi_shim.c $(QUICKJS_DIR)/qjs_ffi_shim.c

$(LIB_DIR):
	mkdir -p $(LIB_DIR)

$(LIB_DIR)/libquickjs.so: $(QUICKJS_DIR) $(QUICKJS_DIR)/qjs_ffi_shim.c $(LIB_DIR)
	cd $(QUICKJS_DIR) && \
	$(CC) -shared -fPIC -O2 -D_GNU_SOURCE -DQUICKJS_NG_BUILD -I. \
		-o libquickjs.so \
		cutils.c dtoa.c libregexp.c libunicode.c quickjs.c quickjs-libc.c qjs_ffi_shim.c \
		-lm -lpthread -ldl
	cp $(QUICKJS_DIR)/libquickjs.so $(LIB_DIR)/

# Copy libquickjs to storybook
$(STORYBOOK_LIB)/libquickjs.so: $(LIB_DIR)/libquickjs.so
	mkdir -p $(STORYBOOK_LIB)
	cp $(LIB_DIR)/libquickjs.so $(STORYBOOK_LIB)/

# ── Build targets ───────────────────────────────────────

build: build-native build-web build-storybook-native build-storybook

build-native: node_modules
	npx esbuild \
		--bundle \
		--format=iife \
		--global-name=ReactLove \
		--target=es2020 \
		--jsx=automatic \
		--outfile=$(NATIVE_GAME)/bundle.js \
		examples/native-hud/src/main.tsx

build-web: node_modules
	npx esbuild \
		--bundle \
		--format=esm \
		--target=es2020 \
		--jsx=automatic \
		--outfile=examples/web-overlay/dist/app.js \
		examples/web-overlay/src/main.tsx

build-storybook: node_modules
	npx esbuild \
		--bundle \
		--format=esm \
		--target=es2020 \
		--jsx=automatic \
		--outfile=examples/storybook/dist/storybook.js \
		examples/storybook/src/main.tsx

build-storybook-native: node_modules
	npx esbuild \
		--bundle \
		--format=iife \
		--global-name=ReactLoveStorybook \
		--target=es2020 \
		--jsx=automatic \
		--outfile=$(STORYBOOK_LOVE)/bundle.js \
		examples/storybook/src/native-main.tsx

# ── Storybook ──────────────────────────────────────────

storybook: setup build-storybook-native build-storybook $(STORYBOOK_LIB)/libquickjs.so
	@echo ""
	@echo "=== Storybook ready ==="
	@echo "  Native:  cd $(STORYBOOK_LOVE) && love ."
	@echo "  Web:     cd examples/storybook && python3 -m http.server 8080"
	@echo ""

storybook-web: build-storybook
	@echo "Web storybook built. Serve with: cd examples/storybook && python3 -m http.server 8080"

# ── Run ─────────────────────────────────────────────────

run: build-native setup
	cd $(NATIVE_GAME) && love .

# ── Dev mode (watch + run) ──────────────────────────────

dev:
	npx esbuild \
		--bundle \
		--format=iife \
		--global-name=ReactLove \
		--target=es2020 \
		--jsx=automatic \
		--outfile=$(NATIVE_GAME)/bundle.js \
		--watch \
		examples/native-hud/src/main.tsx

# ── Clean ───────────────────────────────────────────────

clean:
	rm -f $(NATIVE_GAME)/bundle.js
	rm -f examples/web-overlay/dist/app.js
	rm -f examples/storybook/dist/storybook.js
	rm -f $(STORYBOOK_LOVE)/bundle.js
	rm -rf $(LIB_DIR)
	rm -rf $(STORYBOOK_LIB)
	rm -rf node_modules
