const { defineConfig, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { BUILD_ROOT } = require('./scripts/buildpaths.js');

// Endpoint security blocks ~/Library/Application Support/Firefox, and Firefox
// before 153.6 hangs headless when it cannot read profiles.ini there.
const firefoxHome = path.join(BUILD_ROOT, 'firefox-home');
fs.mkdirSync(firefoxHome, { recursive: true });
const firefoxEnv = { ...process.env, CFFIXED_USER_HOME: firefoxHome };

// `test/` holds the DOM-free node:test units; `tests/` holds these browser
// tests, which are what actually cover the drawing tools.
module.exports = defineConfig({
  testDir: './tests',
  outputDir: path.join(BUILD_ROOT, 'test-results'),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: process.env.CI ? undefined : 3,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: { env: firefoxEnv } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ],
  webServer: [
    { command: 'node tests/support/static-server.js', port: 4174, reuseExistingServer: !process.env.CI }
  ]
});
