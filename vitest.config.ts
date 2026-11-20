import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    plugins: [vue()],
    test: {
        clearMocks: true,
        environment: "node",
        hookTimeout: 15000,
        include: ["src/**/*.test.ts"],
        testTimeout: 15000,
    },
});
