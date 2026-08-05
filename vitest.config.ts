import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    environment: "node",
    hookTimeout: 15000,
    include: ["src/**/*.test.ts"],
    testTimeout: 15000,
  },
});
