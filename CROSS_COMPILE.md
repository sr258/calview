# Cross-Compiling CalView for Windows on Linux

This guide documents how to build a Windows `.exe` from a Linux host using `cargo-xwin` and the Tauri CLI.

## Prerequisites

### System Packages

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  clang \
  lld
```

### Symlinks

The `clang` package does not always install `clang-cl`, `llvm-lib`, or `llvm-rc` under those exact names. Create symlinks if they are missing (adjust the version number to match your installed LLVM version):

```bash
sudo ln -sf /usr/bin/clang-18 /usr/bin/clang-cl
sudo ln -sf /usr/bin/llvm-ar-18 /usr/bin/llvm-lib
sudo ln -sf /usr/bin/llvm-rc-18 /usr/bin/llvm-rc
```

Verify they are available:

```bash
which clang-cl lld-link llvm-lib llvm-rc
```

### Rust Toolchain

```bash
cargo install cargo-xwin
rustup target add x86_64-pc-windows-msvc
```

`cargo-xwin` automatically downloads the Windows SDK headers and libraries on first use and caches them in `~/.cache/cargo-xwin/xwin/`.

## Building

### Why not just `cargo xwin build`?

Running `cargo xwin build` directly compiles the Rust code correctly but bypasses the Tauri CLI. The Tauri CLI is responsible for:

1. Building the frontend (`npm run build`)
2. Embedding the frontend assets into the binary
3. Setting the correct build mode (production vs development)

Without the Tauri CLI, the resulting binary runs in **dev mode** and tries to load the UI from `http://localhost:5173` instead of the embedded assets — resulting in a blank/invisible window.

### Correct Build Command

Use `npx tauri build` with environment variables that point the C/C++ toolchain at `clang-cl` and the Windows SDK headers from `cargo-xwin`'s cache:

```bash
XWIN_DIR="$HOME/.cache/cargo-xwin/xwin"

CC_x86_64_pc_windows_msvc="clang-cl" \
CXX_x86_64_pc_windows_msvc="clang-cl" \
AR_x86_64_pc_windows_msvc="llvm-lib" \
CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER="lld-link" \
CFLAGS_x86_64_pc_windows_msvc="-imsvc ${XWIN_DIR}/crt/include -imsvc ${XWIN_DIR}/sdk/include/ucrt -imsvc ${XWIN_DIR}/sdk/include/um -imsvc ${XWIN_DIR}/sdk/include/shared" \
RUSTFLAGS="-Lnative=${XWIN_DIR}/crt/lib/x86_64 -Lnative=${XWIN_DIR}/sdk/lib/um/x86_64 -Lnative=${XWIN_DIR}/sdk/lib/ucrt/x86_64" \
npx tauri build --target x86_64-pc-windows-msvc --no-bundle
```

> **Note:** If `~/.cache/cargo-xwin/xwin/` does not exist yet, run `cargo xwin build --target x86_64-pc-windows-msvc` once inside `src-tauri/` to trigger the SDK download first.

### What the Environment Variables Do

| Variable | Purpose |
|----------|---------|
| `CC_x86_64_pc_windows_msvc` | Tells `cc-rs` to use `clang-cl` instead of `cl.exe` |
| `CXX_x86_64_pc_windows_msvc` | Same for C++ compilation |
| `AR_x86_64_pc_windows_msvc` | Tells `cc-rs` to use `llvm-lib` instead of `lib.exe` |
| `CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER` | Tells Cargo to link with `lld-link` instead of `link.exe` |
| `CFLAGS_x86_64_pc_windows_msvc` | Provides Windows SDK/CRT include paths to `clang-cl` |
| `RUSTFLAGS` | Provides Windows SDK/CRT library paths to the linker |

## Output

The build produces two files that must be kept together:

```
src-tauri/target/x86_64-pc-windows-msvc/release/calview.exe
src-tauri/target/x86_64-pc-windows-msvc/release/calview_lib.dll
```

Copy both to the same folder on a Windows machine. The target machine must have **WebView2** installed (included by default on Windows 10 1803+ and Windows 11).

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `failed to find tool "lib.exe"` | Missing `AR` env var or `llvm-lib` | Set `AR_x86_64_pc_windows_msvc=llvm-lib` and create the symlink |
| `failed to find tool "clang-cl"` | `clang-cl` not installed or not on PATH | `sudo ln -s /usr/bin/clang-18 /usr/bin/clang-cl` |
| `'assert.h' file not found` | Windows SDK headers not in include path | Set `CFLAGS_x86_64_pc_windows_msvc` with `-imsvc` paths (see build command above) |
| `called Result::unwrap() on Err: NotAttempted("llvm-rc")` | `llvm-rc` not found | `sudo ln -s /usr/bin/llvm-rc-18 /usr/bin/llvm-rc` |
| App runs on Windows but no window appears | Built with `cargo xwin build` instead of `npx tauri build` | Use the full `npx tauri build` command above so assets are embedded |
