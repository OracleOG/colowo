import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    // DB tests share one database; run files one at a time.
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/colowo_test",
      SESSION_SECRET: "test-secret-test-secret-test-secret-123",
      MEMBER_NO_PREFIX: "CLW",
    },
  },
});
