/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      "/api/caldav": {
        target: "https://isb-kalender.zit.mwn.de/caldav.php",
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
