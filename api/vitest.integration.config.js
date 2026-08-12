import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./src/__tests__/setup/globalSetup.js"],
    setupFiles: ["./src/__tests__/setup/perTest.js"],
    include: ["src/__tests__/integration/**/*.test.js"],
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/prism_test",
      JWT_SECRET: "integration-test-secret",
      PRISM_AI_PROVIDER: "none",
    },
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30000,
  },
});
