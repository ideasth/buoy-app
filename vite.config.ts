import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Stage 17: multi-entry build for apex + availability SPAs (family retired 9 Nov 2026).
    rollupOptions: {
      // Two entry points.
      // availability/index.html → dist/public/availability/index.html
      // index.html → dist/public/index.html (apex)
      input: {
        main: path.resolve(import.meta.dirname, "client", "index.html"),
        availability: path.resolve(import.meta.dirname, "client", "availability", "index.html"),
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
