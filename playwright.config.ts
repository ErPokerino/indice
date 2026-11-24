import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:18765",
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "uv run --no-sync python -m tests.serve",
    url: "http://127.0.0.1:18765/api/studio",
    reuseExistingServer: false,
  },
});
