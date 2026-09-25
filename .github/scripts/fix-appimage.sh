#!/usr/bin/env bash
# linuxdeploy bundles the build host's display-stack libraries
# (libwayland-*, libxkbcommon, some libxcb-*, libXau, libXdmcp) into the
# AppImage, and AppRun's LD_LIBRARY_PATH makes them shadow the host's own
# copies. On a host with a newer Mesa than the build machine, the shadowed
# libwayland-client makes eglGetDisplay fail with EGL_BAD_PARAMETER and
# WebKitWebProcess aborts before any window appears (see
# https://github.com/tauri-apps/tauri/issues/15976 and #15665). Since Tauri
# has no supported way to exclude libraries from the bundle yet, strip them
# from the built AppImage and repackage so the host provides them instead.
set -euo pipefail

BUNDLE_DIR="src-tauri/target/release/bundle/appimage"
APPIMAGE=$(ls "$BUNDLE_DIR"/*.AppImage)
WORKDIR=$(mktemp -d)

chmod +x "$APPIMAGE"
(cd "$WORKDIR" && "$OLDPWD/$APPIMAGE" --appimage-extract >/dev/null)

rm -f "$WORKDIR"/squashfs-root/usr/lib/{libwayland-client.so.0,libwayland-cursor.so.0,libwayland-egl.so.1,libwayland-server.so.0,libxkbcommon.so.0,libxcb-randr.so.0,libxcb-render.so.0,libxcb-shm.so.0,libXau.so.6,libXdmcp.so.6}

curl -sL -o "$WORKDIR/appimagetool" https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
chmod +x "$WORKDIR/appimagetool"

rm -f "$APPIMAGE"
"$WORKDIR/appimagetool" --appimage-extract-and-run "$WORKDIR/squashfs-root" "$APPIMAGE"

rm -rf "$WORKDIR"
