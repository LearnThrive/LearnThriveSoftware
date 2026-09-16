import { test, expect, type Browser, type Page } from '@playwright/test';

async function openParticipant(browser: Browser, name: string, roomId?: string) {
  // Firefox/WebKit don't support Chromium-style permission grant strings (fake media there is
  // handled entirely by firefoxUserPrefs in playwright.config.ts); only request them on Chromium.
  const isChromium = browser.browserType().name() === 'chromium';
  const context = await browser.newContext(
    isChromium ? { permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] } : {},
  );
  const page = await context.newPage();
  await page.goto(roomId ? `/meeting?room=${roomId}` : '/meeting');
  await page.getByLabel('Your name').fill(name);
  return { context, page };
}

async function enableDevices(page: Page) {
  await page.getByRole('button', { name: /camera & microphone/i }).click();
  await expect(page.locator('.preview-panel video')).not.toHaveClass(/video-hidden/);
}

async function joinMeeting(page: Page) {
  await page.getByRole('button', { name: 'Join meeting' }).click();
}

test('two participants connect over WebRTC, exchange media state, and a third is rejected', async ({ browser }) => {
  const { context: contextA, page: pageA } = await openParticipant(browser, 'Tutor');
  await test.step('first participant creates a meeting and enables devices', async () => {
    await pageA.getByRole('button', { name: 'Create meeting' }).click();
    await enableDevices(pageA);
  });

  const roomId = await pageA.getByLabel('Room code').inputValue();
  expect(roomId).toMatch(/^[a-z0-9][a-z0-9-]{7,47}$/);

  await test.step('first participant joins and waits', async () => {
    await joinMeeting(pageA);
    await expect(pageA.getByRole('region', { name: 'Waiting for another participant' })).toBeVisible();
  });

  const { context: contextB, page: pageB } = await openParticipant(browser, 'Student', roomId);
  await test.step('second participant joins via the invite link', async () => {
    await expect(pageB.getByLabel('Room code')).toHaveValue(roomId);
    await enableDevices(pageB);
    await joinMeeting(pageB);
  });

  await test.step('both peers reach a connected WebRTC state', async () => {
    await expect(pageA.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });
    await expect(pageB.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });
    await expect(pageA.getByRole('region', { name: "Student's video" })).toBeVisible();
    await expect(pageB.getByRole('region', { name: "Tutor's video" })).toBeVisible();
  });

  await test.step('muting and disabling video relay to the peer', async () => {
    await pageA.getByRole('button', { name: 'Turn microphone off' }).click();
    await expect(pageB.locator('.remote-tile .participant-media')).toHaveAttribute('aria-label', 'Microphone off');

    await pageA.getByRole('button', { name: 'Turn camera off' }).click();
    await expect(pageB.locator('.remote-tile .camera-placeholder')).toBeVisible();
  });

  await test.step('a third participant is rejected while the call continues', async () => {
    const { context: contextC, page: pageC } = await openParticipant(browser, 'Intruder', roomId);
    await joinMeeting(pageC);
    await expect(pageC.getByRole('alert')).toContainText('already has two participants');
    await contextC.close();
    await expect(pageA.locator('.connection-pill')).toHaveClass(/connected/);
  });

  await test.step('leaving ends the call for one side and returns the other to waiting', async () => {
    await pageA.getByRole('button', { name: 'Leave meeting' }).click();
    await expect(pageA.getByRole('heading', { name: /left the meeting/i })).toBeVisible();
    await expect(pageB.locator('.connection-pill')).toContainText('Participant left');
    await expect(pageB.getByRole('region', { name: 'Waiting for another participant' })).toBeVisible();
  });

  await contextA.close();
  await contextB.close();
});

test('chat messages send, receive, show an unread badge, and render unsafe-looking text as plain text', async ({ browser }) => {
  const { context: contextA, page: pageA } = await openParticipant(browser, 'Tutor');
  await pageA.getByRole('button', { name: 'Create meeting' }).click();
  await enableDevices(pageA);
  const roomId = await pageA.getByLabel('Room code').inputValue();
  await joinMeeting(pageA);

  const { context: contextB, page: pageB } = await openParticipant(browser, 'Student', roomId);
  await enableDevices(pageB);
  await joinMeeting(pageB);

  await expect(pageA.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });
  await expect(pageB.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });

  let dialogFired = false;
  pageA.on('dialog', (dialog) => { dialogFired = true; void dialog.dismiss(); });
  pageB.on('dialog', (dialog) => { dialogFired = true; void dialog.dismiss(); });
  const malicious = '<img src=x onerror=alert(1)>';

  await test.step('A sends a message; it renders as literal text, never as an element', async () => {
    await pageA.getByRole('button', { name: 'Toggle chat' }).click();
    await pageA.getByPlaceholder('Type a message…').fill(malicious);
    await pageA.getByRole('button', { name: 'Send message' }).click();
    await expect(pageA.locator('.chat-message.own p')).toHaveText(malicious);
    await expect(pageA.locator('.chat-message.own img')).toHaveCount(0);
  });

  await test.step('B sees an unread badge while chat is closed, then the message once opened', async () => {
    await expect(pageB.getByRole('button', { name: 'Toggle chat' }).locator('.unread-badge')).toHaveText('1');
    await pageB.getByRole('button', { name: 'Toggle chat' }).click();
    await expect(pageB.getByRole('button', { name: 'Toggle chat' }).locator('.unread-badge')).toHaveCount(0);
    await expect(pageB.locator('.chat-message:not(.own) p')).toHaveText(malicious);
    await expect(pageB.locator('.chat-message:not(.own) img')).toHaveCount(0);
  });

  expect(dialogFired).toBe(false);
  await contextA.close();
  await contextB.close();
});

test('a participant can leave and rejoin the same room cleanly', async ({ browser }) => {
  const { context: contextA, page: pageA } = await openParticipant(browser, 'Tutor');
  await pageA.getByRole('button', { name: 'Create meeting' }).click();
  const roomId = await pageA.getByLabel('Room code').inputValue();
  await joinMeeting(pageA);
  await expect(pageA.getByRole('region', { name: 'Waiting for another participant' })).toBeVisible();

  await test.step('leaving reaches the ended screen', async () => {
    await pageA.getByRole('button', { name: 'Leave meeting' }).click();
    await expect(pageA.getByRole('heading', { name: /left the meeting/i })).toBeVisible();
  });

  await test.step('rejoining the same room from a fresh pre-join reconnects cleanly, with no ghost participant', async () => {
    await pageA.getByRole('button', { name: 'Back to meeting setup' }).click();
    await pageA.getByLabel('Your name').fill('Tutor');
    await expect(pageA.getByLabel('Room code')).toHaveValue(roomId);
    await joinMeeting(pageA);
    await expect(pageA.getByRole('region', { name: 'Waiting for another participant' })).toBeVisible();
    await expect(pageA.locator('.participant-count')).toHaveText('1 / 2');
    await expect(pageA.locator('.connection-pill')).not.toContainText('Participant left');
  });

  await contextA.close();
});

test('a brief network drop recovers without a false departure notice', async ({ browser }) => {
  const { context: contextA, page: pageA } = await openParticipant(browser, 'Tutor');
  await pageA.getByRole('button', { name: 'Create meeting' }).click();
  await enableDevices(pageA);
  const roomId = await pageA.getByLabel('Room code').inputValue();
  await joinMeeting(pageA);

  const { context: contextB, page: pageB } = await openParticipant(browser, 'Student', roomId);
  await enableDevices(pageB);
  await joinMeeting(pageB);

  await expect(pageA.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });
  await expect(pageB.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });

  await test.step('the peer is marked reconnecting, never a false departure, while offline', async () => {
    await contextB.setOffline(true);
    await expect(pageA.locator('.peer-reconnecting')).toBeVisible({ timeout: 10_000 });
    await expect(pageA.getByRole('region', { name: "Student's video" })).toBeVisible();
  });

  await test.step('coming back online clears the notice and the pairing survives', async () => {
    await contextB.setOffline(false);
    await expect(pageA.locator('.peer-reconnecting')).toBeHidden({ timeout: 15_000 });
    await expect(pageA.getByRole('region', { name: "Student's video" })).toBeVisible();
    await expect(pageB.getByRole('region', { name: "Tutor's video" })).toBeVisible();
    await expect(pageA.locator('.connection-pill')).not.toContainText('Participant left');
  });

  await contextA.close();
  await contextB.close();
});
