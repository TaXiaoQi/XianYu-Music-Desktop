import { defineConfig } from "vitest/config"; // 实现

export default defineConfig({ // 实现
    test: {
        clearMocks: true,
        environment: "node",
        hookTimeout: 15000,
        include: ["src/**/*.test.ts"],
        testTimeout: 15000,
    },
});
