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
    await senderPage.fill('input[aria-label="Studio Room Identification Code"]', testRoomId);
    await receiverPage.fill('input[aria-label="Studio Room Identification Code"]', testRoomId);

    // 4. Click Phone (Microphone) on Sender Page
    await senderPage.click('button[aria-label="Use this device as the phone microphone"]');
    
    // 5. Click PC (Receiver) on Receiver Page
    await receiverPage.click('button[aria-label="Use this device as the PC audio receiver"]');

    // 6. Verify Sender Status goes to broadcasting
    await expect(senderPage.locator('.status-badge').first()).toContainText('Broadcasting', { timeout: 10000 });
    
    // 7. Verify Receiver Status goes to streaming
    await expect(receiverPage.locator('.status-badge').first()).toContainText('streaming', { timeout: 10000 });

    // 8. Verify Room State (2 members: 1 sender, 1 receiver)
    await expect(receiverPage.locator('.room-state-strip')).toContainText('Phone: 1');
    await expect(receiverPage.locator('.room-state-strip')).toContainText('PC: 1');

    // 9. Let it stream for 2.5 seconds to accumulate bitrate telemetry
    await receiverPage.waitForTimeout(2500);

    // 10. Check Bitrate Telemetry
    const bitrateStat = receiverPage.locator('.telemetry-strip .telemetry-stat').nth(1);
    await expect(bitrateStat).toContainText('kbps');
    const bitrateText = await bitrateStat.locator('.telemetry-stat-value').innerText();
    const bitrateNum = parseInt(bitrateText.replace(/[^0-9]/g, ''), 10);
    
    console.log(`[E2E Test] Measured active streaming bitrate: ${bitrateNum} kbps`);
    expect(bitrateNum).toBeGreaterThan(0);

    // 11. Cleanup and disconnect
    await receiverPage.click('.disconnect-button');
    await senderPage.click('.disconnect-button');

    await receiverContext.close();
    await senderContext.close();
  });
});
