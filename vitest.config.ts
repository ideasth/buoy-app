// Vitest config — kept separate from vite.config.ts so the test runner uses
// the repo root, not the client app directory. Test files live in ./test.

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
  test: {
    root: __dirname,
    // Match both .ts (server/back-end tests) and .tsx (page smoke tests).
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
  },
});
