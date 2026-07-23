const { test, expect } = require('@playwright/test');

test.describe('Black Mic Studio E2E Streaming Suite', () => {
  test('should connect sender and receiver to the same room and stream audio', async ({ browser }) => {
    // 1. Setup the Receiver Page (PC)
    const receiverContext = await browser.newContext({
      permissions: ['microphone'],
      ignoreHTTPSErrors: true,
    });
    const receiverPage = await receiverContext.newPage();
    await receiverPage.goto('https://localhost:3001');

    // 2. Setup the Sender Page (Phone)
    const senderContext = await browser.newContext({
      permissions: ['microphone'],
      ignoreHTTPSErrors: true,
    });
    const senderPage = await senderContext.newPage();
    await senderPage.goto('https://localhost:3001');

    const testRoomId = 'TEST' + Math.floor(100 + Math.random() * 900);

    // 3. Enter Room ID on both pages
    await senderPage.getByLabel('Studio Room ID').fill(testRoomId);
    await receiverPage.getByLabel('Studio Room ID').fill(testRoomId);

    // 4. Click Phone (Microphone) on Sender Page
    await senderPage.click('button[aria-label="Use this device as the phone microphone"]');
    
    // 5. Click PC (Receiver) on Receiver Page
    await receiverPage.click('button[aria-label="Use this device as the PC audio receiver"]');

    // 6. Verify Sender Status goes to broadcasting
    await expect(senderPage.locator('.status-badge').first()).toContainText('Broadcasting', { timeout: 10000 });
    
    // 7. Verify Receiver Status goes to streaming
    await expect(receiverPage.locator('.status-badge').first()).toContainText('Receiving phone audio', { timeout: 10000 });

    // 8. Verify Room State (2 members: 1 sender, 1 receiver)
    await expect(receiverPage.locator('.room-state-strip')).toContainText('Phone: 1');
    await expect(receiverPage.locator('.room-state-strip')).toContainText('PC: 1');
    await expect(receiverPage.locator('.room-state-strip')).toContainText('System mic: Ready');

    // 9. Let it stream for 2.5 seconds to accumulate bitrate telemetry
    await receiverPage.waitForTimeout(2500);

    // 10. Check Bitrate Telemetry
    const bitrateStat = receiverPage.locator('.telemetry-strip .telemetry-stat').nth(1);
    await expect(bitrateStat).toContainText('kbps');
    const bitrateText = await bitrateStat.locator('.telemetry-stat-value').innerText();
    const bitrateNum = parseInt(bitrateText.replace(/[^0-9]/g, ''), 10);
    
    console.log(`[E2E Test] Measured active streaming bitrate: ${bitrateNum} kbps`);
    expect(bitrateNum).toBeGreaterThan(0);

    // 11. Verify recording state resets across a receiver disconnect
    await receiverPage.getByRole('button', { name: /Record Audio Only/i }).click();
    await expect(receiverPage.getByRole('button', { name: /Stop Audio Recording/i })).toBeVisible();
    await receiverPage.click('.disconnect-button');
    await expect(receiverPage.getByRole('button', { name: /PC audio receiver/i })).toBeVisible();
    await receiverPage.getByRole('button', { name: /PC audio receiver/i }).click();
    await expect(receiverPage.getByRole('button', { name: /Record Audio Only/i })).toBeVisible();

    // 12. Cleanup and disconnect
    await receiverPage.click('.disconnect-button');
    await senderPage.click('.disconnect-button');

    await receiverContext.close();
    await senderContext.close();
  });

  test('should show an honest waiting state before a phone connects', async ({ page }) => {
    const testRoomId = 'WAIT' + Math.floor(100 + Math.random() * 900);
    await page.goto('https://localhost:3001');
    await page.getByLabel('Studio Room ID').fill(testRoomId);

    await page.getByRole('button', { name: /PC audio receiver/i }).click();

    await expect(page.locator('.status-badge').first()).toContainText('Waiting for phone');
    await expect(page.locator('.room-state-strip')).toContainText('Phone: 0');
    await expect(page.getByRole('button', { name: 'Mute Phone Mic' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Record Audio Only/i })).toBeDisabled();
    await expect(page.locator('.status-badge').first()).not.toContainText('Receiving phone audio');
  });

  test('should recover to setup when microphone permission is denied', async ({ browser }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const deniedMediaDevices = {
        getUserMedia: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: deniedMediaDevices,
      });
    });
    await page.goto('https://localhost:3001');

    await page.getByRole('button', { name: /phone microphone/i }).click();

    await expect(page.getByRole('alert')).toContainText('Allow microphone access');
    await expect(page.getByRole('button', { name: /phone microphone/i })).toBeEnabled();
    await context.close();
  });

  test('should reject a duplicate PC receiver without disrupting the active one', async ({ browser }) => {
    const firstContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const secondContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const firstReceiver = await firstContext.newPage();
    const secondReceiver = await secondContext.newPage();
    const testRoomId = 'DUP' + Math.floor(100 + Math.random() * 900);

    await firstReceiver.goto('https://localhost:3001');
    await firstReceiver.getByLabel('Studio Room ID').fill(testRoomId);
    await firstReceiver.getByRole('button', { name: /PC audio receiver/i }).click();
    await expect(firstReceiver.locator('.room-state-strip')).toContainText('PC: 1');

    await secondReceiver.goto('https://localhost:3001');
    await secondReceiver.getByLabel('Studio Room ID').fill(testRoomId);
    await secondReceiver.getByRole('button', { name: /PC audio receiver/i }).click();

    await expect(secondReceiver.getByRole('alert')).toContainText('already connected');
    await expect(firstReceiver.locator('.room-state-strip')).toContainText('PC: 1');

    await firstContext.close();
    await secondContext.close();
  });
});
