import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT) || 3100

// The production server serves the SPA from dist/, so run `npm run build`
// before `playwright test` (the test:e2e script does both).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Allow overriding the browser binary (e.g. preinstalled Chromium in CI sandboxes)
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: `NODE_ENV=development AUTH_DISABLED=1 PORT=${PORT} DATA_DIR=.e2e-data npx tsx server/index.ts`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
