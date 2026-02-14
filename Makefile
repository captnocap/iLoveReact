# react-love Makefile
# Builds: QuickJS shared library + bundled React apps for both targets

QUICKJS_DIR = quickjs
NATIVE_GAME = examples/native-hud/game
LIB_DIR = $(NATIVE_GAME)/lib
STORYBOOK_LOVE = examples/storybook/love
STORYBOOK_LIB = $(STORYBOOK_LOVE)/lib

.PHONY: all clean dist-clean setup build build-native build-web build-storybook build-storybook-native run dev dev-storybook storybook storybook-web install dist-storybook cli-setup

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

# ── Dist (consumer-facing distributable) ─────────────────
#
# Produces a single self-extracting binary that runs on any x86_64 Linux
# with zero dependencies. Bundles Love2D, all shared libraries (including
# glibc and ld-linux), libquickjs, and the .love game archive.
#
# The binary extracts to ~/.cache/ilovereact-demo/<hash>/ on first run
# and launches via the bundled dynamic linker (ld-linux), bypassing the
# host's glibc entirely. Same technique as Steam Runtime / AppImage.
#
# This is ONLY for end-user distribution. Developer tooling (CLI, dev
# server, `love .` workflow) lives in the CLI/dev sections below and
# expects Love2D + deps installed on the dev machine.

DIST_DIR = dist
DIST_BINARY = $(DIST_DIR)/ilovereact-demo
STAGING_DIR = /tmp/ilovereact-demo-staging
PAYLOAD_DIR = /tmp/ilovereact-demo-payload

# Only linux-vdso is kernel-injected and cannot be bundled.
VDSO_EXCLUDE = linux-vdso

dist-storybook: build-storybook-native setup
	@echo "=== Packaging single-file binary ==="
	mkdir -p $(DIST_DIR)
	rm -rf $(DIST_BINARY)
	rm -rf $(STAGING_DIR) $(PAYLOAD_DIR)
	# ── Build the .love zip ──
	mkdir -p $(STAGING_DIR)/lua
	cp $(STORYBOOK_LOVE)/bundle.js $(STAGING_DIR)/
	cp packaging/storybook/main.lua $(STAGING_DIR)/
	cp packaging/storybook/conf.lua $(STAGING_DIR)/
	cp lua/*.lua $(STAGING_DIR)/lua/
	cd $(STAGING_DIR) && zip -9 -r /tmp/ilovereact-demo.love .
	# ── Assemble payload directory ──
	# Don't fuse — ld-linux invocation breaks /proc/self/exe detection.
	# Instead, keep love binary and .love zip separate; pass .love as arg.
	mkdir -p $(PAYLOAD_DIR)/lib
	cp $$(readlink -f $$(which love)) $(PAYLOAD_DIR)/love.bin
	cp /tmp/ilovereact-demo.love $(PAYLOAD_DIR)/game.love
	cp $(QUICKJS_DIR)/libquickjs.so $(PAYLOAD_DIR)/lib/
	@LIBMPV=$$(ldconfig -p | grep 'libmpv.so.2 ' | head -1 | sed 's/.*=> //'); \
	if [ -n "$$LIBMPV" ]; then \
		cp "$$LIBMPV" $(PAYLOAD_DIR)/lib/libmpv.so.2; \
		echo "  Bundled libmpv.so.2"; \
		ldd "$$LIBMPV" | grep "=> /" | grep -v '$(VDSO_EXCLUDE)' | \
			awk '{print $$1, $$3}' | while read soname path; do \
				if [ ! -f $(PAYLOAD_DIR)/lib/"$$soname" ]; then \
					real=$$(readlink -f "$$path"); \
					cp "$$real" $(PAYLOAD_DIR)/lib/"$$soname"; \
				fi; \
			done; \
	fi
	@if [ -f cli/runtime/bin/tor ]; then \
		mkdir -p $(PAYLOAD_DIR)/bin; \
		cp cli/runtime/bin/tor $(PAYLOAD_DIR)/bin/tor; \
		chmod +x $(PAYLOAD_DIR)/bin/tor; \
		echo "  Bundled tor"; \
		ldd $(PAYLOAD_DIR)/bin/tor | grep "=> /" | grep -v '$(VDSO_EXCLUDE)' | \
			awk '{print $$1, $$3}' | while read soname path; do \
				if [ ! -f $(PAYLOAD_DIR)/lib/"$$soname" ]; then \
					real=$$(readlink -f "$$path"); \
					cp "$$real" $(PAYLOAD_DIR)/lib/"$$soname"; \
				fi; \
			done; \
	fi
	@echo "--- Bundling shared libraries ---"
	ldd $(PAYLOAD_DIR)/love.bin | grep "=> /" | grep -v '$(VDSO_EXCLUDE)' | \
		awk '{print $$1, $$3}' | while read soname path; do \
			real=$$(readlink -f "$$path"); \
			cp "$$real" $(PAYLOAD_DIR)/lib/"$$soname"; \
		done
	# ── Bundle the dynamic linker itself ──
	cp $$(readlink -f /lib64/ld-linux-x86-64.so.2) $(PAYLOAD_DIR)/lib/ld-linux-x86-64.so.2
	# ── Create launcher that uses bundled ld-linux ──
	printf '#!/bin/sh\nDIR="$$(cd "$$(dirname "$$0")" && pwd)"\nexec "$$DIR/lib/ld-linux-x86-64.so.2" --inhibit-cache --library-path "$$DIR/lib" "$$DIR/love.bin" "$$DIR/game.love" "$$@"\n' > $(PAYLOAD_DIR)/run
	chmod +x $(PAYLOAD_DIR)/run
	# ── Pack into single self-extracting binary ──
	cd $(PAYLOAD_DIR) && tar czf /tmp/ilovereact-demo.tar.gz .
	printf '#!/bin/sh\nset -e\nAPP_DIR=$${XDG_CACHE_HOME:-$$HOME/.cache}/ilovereact-demo\nSIG=$$(md5sum "$$0" 2>/dev/null | cut -c1-8 || cksum "$$0" | cut -d" " -f1)\nCACHE="$$APP_DIR/$$SIG"\nif [ ! -f "$$CACHE/.ready" ]; then\n  rm -rf "$$APP_DIR"\n  mkdir -p "$$CACHE"\n  SKIP=$$(awk '"'"'/^__ARCHIVE__$$/{print NR + 1; exit}'"'"' "$$0")\n  tail -n+"$$SKIP" "$$0" | tar xz -C "$$CACHE"\n  touch "$$CACHE/.ready"\nfi\nexec "$$CACHE/run" "$$@"\n__ARCHIVE__\n' > $(DIST_BINARY)
	cat /tmp/ilovereact-demo.tar.gz >> $(DIST_BINARY)
	chmod +x $(DIST_BINARY)
	# ── Cleanup ──
	rm -rf $(STAGING_DIR) $(PAYLOAD_DIR) /tmp/ilovereact-demo.love /tmp/ilovereact-demo.tar.gz
	@echo "=== Done: $(DIST_BINARY) ==="
	@echo "  Size: $$(du -h $(DIST_BINARY) | cut -f1)"
	@echo "  Run:  ./$(DIST_BINARY)"

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

dev-storybook: setup $(STORYBOOK_LIB)/libquickjs.so node_modules
	npx esbuild \
		--bundle \
		--format=iife \
		--global-name=ReactLoveStorybook \
		--target=es2020 \
		--jsx=automatic \
		--outfile=$(STORYBOOK_LOVE)/bundle.js \
		--watch \
		examples/storybook/src/native-main.tsx

# ── CLI setup (developer tooling — expects Love2D installed) ──

cli-setup: setup
	@echo "=== Populating CLI runtime ==="
	rm -rf cli/runtime
	mkdir -p cli/runtime/lua cli/runtime/lib cli/runtime/bin cli/runtime/ilovereact
	cp lua/*.lua cli/runtime/lua/
	cp $(QUICKJS_DIR)/libquickjs.so cli/runtime/lib/
	@LIBMPV=$$(ldconfig -p | grep 'libmpv.so.2 ' | head -1 | sed 's/.*=> //'); \
	if [ -n "$$LIBMPV" ]; then \
		cp "$$LIBMPV" cli/runtime/lib/libmpv.so.2; \
		echo "  Bundled libmpv.so.2"; \
	else \
		echo "  Warning: libmpv.so.2 not found — video playback won't be bundled"; \
	fi
	@TOR=$$(which tor 2>/dev/null); \
	if [ -n "$$TOR" ]; then \
		cp "$$(readlink -f "$$TOR")" cli/runtime/bin/tor; \
		chmod +x cli/runtime/bin/tor; \
		echo "  Bundled tor"; \
	else \
		echo "  Warning: tor not found — .onion hosting won't be bundled"; \
	fi
	cp -r packages/shared cli/runtime/ilovereact/shared
	cp -r packages/native cli/runtime/ilovereact/native
	cp -r packages/router cli/runtime/ilovereact/router
	cp -r packages/storage cli/runtime/ilovereact/storage
	cp -r packages/components cli/runtime/ilovereact/components
	@echo "=== CLI runtime ready. Run: cd cli && npm link ==="

# ── Clean ───────────────────────────────────────────────

dist-clean:
	rm -rf $(DIST_DIR)
	rm -rf $${XDG_CACHE_HOME:-$$HOME/.cache}/ilovereact-demo

clean: dist-clean
	rm -f $(NATIVE_GAME)/bundle.js
	rm -f examples/web-overlay/dist/app.js
	rm -f examples/storybook/dist/storybook.js
	rm -f $(STORYBOOK_LOVE)/bundle.js
	rm -rf $(LIB_DIR)
	rm -rf $(STORYBOOK_LIB)
	rm -rf node_modules
