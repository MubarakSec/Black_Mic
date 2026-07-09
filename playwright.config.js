const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'https://localhost:3001',
    ignoreHTTPSErrors: true, // Handle self-signed certs
    trace: 'on-first-retry',
    permissions: ['microphone'], // Grant mic permission to fake chrome
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'PORT=3001 node server.js',
    url: 'https://localhost:3001',
    reuseExistingServer: true,
    ignoreHTTPSErrors: true,
    timeout: 10000,
  },
});
