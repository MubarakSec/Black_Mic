const { test, expect } = require('@playwright/test');

// Boot smoke test: the built bundle mounts without page errors.
// Requires the client to be built and the server to be running on the
// configured baseURL (playwright starts it automatically via webServer).
test('app boots without page errors and renders into #root', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  // #root must gain children (React mounted), not render a blank shell
  await expect(page.locator('#root').locator('*').first()).toBeVisible({ timeout: 15000 });

  // The shell UI renders its known landmarks regardless of connection state
  await expect(page.locator('body')).toContainText('Black Mic Studio');

  expect(pageErrors).toEqual([]);
});
