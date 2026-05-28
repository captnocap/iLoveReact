# onnxruntime — vendored prebuilt

Microsoft ONNX Runtime, CPU-only Linux x64 build. Used by `framework/ml/`
to run small inference models (currently MobileSAM for image segmentation
in `cart/cutout`).

## Version

- **Release**: v1.26.0
- **Variant**: `onnxruntime-linux-x64` (CPU only — no CUDA, no GPU providers)
- **Source URL**: https://github.com/microsoft/onnxruntime/releases/download/v1.26.0/onnxruntime-linux-x64-1.26.0.tgz
- **Archive sha256**: `1254da24fb389cf39dc0ff3451ab48301740ffbfcbaf646849df92f80ee92c57`
- **Date vendored**: 2026-05-17

## Layout

```
lib/
  libonnxruntime.so          → libonnxruntime.so.1     (symlink)
  libonnxruntime.so.1        → libonnxruntime.so.1.26.0 (symlink)
  libonnxruntime.so.1.26.0   (real ~22MB shared library)
include/
  onnxruntime_c_api.h        (primary C API — what we link against)
  onnxruntime_cxx_api.h      (C++ wrapper — not used from Zig)
  core/                      (internal headers, included for completeness)
  ... other headers
```

## How it's linked

`build.zig` gates this dep behind `-Dhas-onnx=true`. When enabled:
- `addIncludePath("deps/onnxruntime/include")` — for `@cImport(onnxruntime_c_api.h)`
- `addLibraryPath("deps/onnxruntime/lib")` + `linkSystemLibrary("onnxruntime")`
- `addRPath("$ORIGIN")` so the shipped binary finds the .so alongside it
- Ship pipeline copies `libonnxruntime.so*` next to the binary

The cart triggers the build flag automatically when it imports
`runtime/hooks/useSegment.ts` (see `sdk/dependency-registry.json`).

## Upgrading

1. Download new release tarball from the official GitHub releases
2. Verify sha256 against the release page's checksums
3. Replace `lib/libonnxruntime.so*` and `include/*` from the new archive
4. Update Version section above (URL, sha256, date)
5. Test inference still works (`./scripts/dev cutout` → SAM tool)

## Why vendored prebuilt instead of...

- **Auto-download at build time**: brittle — opaque dependency on
  whoever hosts the release. Builds break when offline. Reproducibility
  suffers.
- **System package**: ABI drift between user systems would break inference
  silently or at load time. Forces every collaborator to install matching
  versions.
- **Submodule of source repo**: building onnxruntime from source takes
  ~hours and requires its own toolchain. Not worth it for a binary we use
  unmodified.

Vendoring matches the existing `deps/libfvad/` and `deps/whisper.cpp/`
patterns.

## License

ONNX Runtime is MIT-licensed. See `lib/` directory's parent for the full
LICENSE + ThirdPartyNotices files in the original archive. Not redistributed
here to keep the vendored footprint small; download the original release
for the full text.
