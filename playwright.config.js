const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
const { BUILD_ROOT } = require('./scripts/buildpaths.js');

// `test/` holds the DOM-free node:test units; `tests/` holds these browser
// tests, which are what actually cover the drawing tools.
module.exports = defineConfig({
  testDir: './tests',
  outputDir: path.join(BUILD_ROOT, 'test-results'),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ],
  webServer: [
    { command: 'node tests/support/static-server.js', port: 4174, reuseExistingServer: !process.env.CI }
  ]
});
