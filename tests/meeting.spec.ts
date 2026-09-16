import { test, expect, type Browser, type Page } from '@playwright/test';

async function openParticipant(browser: Browser, name: string, roomId?: string) {
  const context = await browser.newContext({
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
  });
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
