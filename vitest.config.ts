import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    env: { PINGUFUNK_WRITES_ENABLED: "1" },
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**", "src/services/**"],
      exclude: ["**/*.test.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
