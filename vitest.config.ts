// Vitest config — kept separate from vite.config.ts so the test runner uses
// the repo root, not the client app directory. Test files live in ./test.

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  test: {
    root: __dirname,
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
