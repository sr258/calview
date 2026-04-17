/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import licensesPlugin from "./plugins/vite-plugin-licenses.js";

export default defineConfig({
  plugins: [preact(), licensesPlugin()],
  server: {
    proxy: {
      "/api/caldav": {
        target: "https://isb-kalender.zit.mwn.de",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/caldav/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});
