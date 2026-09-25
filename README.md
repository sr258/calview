# CalView

A CalDAV calendar viewer / appointment planner, packaged as a Tauri v2 desktop application.

## Prerequisites

Install these via your platform's package manager rather than manual downloads.

### Node.js and Rust

| Tool | Linux | macOS | Windows |
|------|-------|-------|---------|
| Node.js (LTS) | `apt install nodejs npm` (or `nvm install --lts`) | `brew install node` | `winget install OpenJS.NodeJS.LTS` |
| Rust | `rustup` via [rustup.rs](https://rustup.rs) or `apt install rustup` | `brew install rustup` | `winget install Rustlang.Rustup` |

After installing `rustup`, run `rustup default stable` if it wasn't set up automatically.

### Tauri system dependencies

**Linux (Debian/Ubuntu)**

```bash
sudo apt update
sudo apt install pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf build-essential libssl-dev
```

**macOS**

```bash
xcode-select --install
```

**Windows**

WebView2 ships with Windows 10/11. Install the Visual Studio Build Tools (C++ workload) if not already present:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
```

See the [official Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for details and less common platforms.

## Setup

```bash
npm ci
```

## Development

```bash
npm run dev        # Vite dev server only (http://localhost:5173)
npx tauri dev       # Full desktop app in a Tauri window
```

## Testing

```bash
npm test            # Run all tests once
npm run test:watch  # Watch mode
```

## Building

```bash
npm run build        # TypeScript check + Vite production build
npx tauri build       # Full desktop app bundle (installer/AppImage/etc.)
```

See `AGENTS.md` for architecture details and the release process.
