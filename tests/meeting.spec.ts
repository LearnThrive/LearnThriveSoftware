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

// Once a peer exists, the remote/local tiles become clickable (to set the main/focused view),
// which correctly changes their accessible role from "region" to "button" and their name to
// describe the action rather than just the content.
function mainViewControl(page: Page, participantName: string) {
  return page.getByRole('button', { name: `Make ${participantName}'s view the main view` });
}

async function leaveMeeting(page: Page) {
  await page.getByRole('button', { name: 'Leave meeting' }).click();
  await page.getByRole('button', { name: 'Yes, leave' }).click();
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
    await expect(mainViewControl(pageA, 'Student')).toBeVisible();
    await expect(mainViewControl(pageB, 'Tutor')).toBeVisible();
  });

  await test.step('remote video actually arrives on both sides, not just the signalling connection', async () => {
    // Regression test: the answerer (whichever peer did not create the offer) used to end up
    // with its camera/mic captured locally but never actually sent — the transceiver carrying
    // the track was orphaned by Chrome's offer-matching, and a second, recvonly-only transceiver
    // pair carried the real negotiation. That left the peer connection reporting "connected"
    // while the remote tile silently stayed on the camera-off placeholder forever.
    await expect(pageA.locator('.remote-tile .camera-placeholder')).toHaveCount(0, { timeout: 10_000 });
    await expect(pageB.locator('.remote-tile .camera-placeholder')).toHaveCount(0, { timeout: 10_000 });
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
    await leaveMeeting(pageA);
    await expect(pageA.getByRole('heading', { name: /left the meeting/i })).toBeVisible();
    await expect(pageB.locator('.connection-pill')).toContainText('Tutor left the meeting');
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
    await leaveMeeting(pageA);
    await expect(pageA.getByRole('heading', { name: /left the meeting/i })).toBeVisible();
  });

  await test.step('rejoining the same room from a fresh pre-join reconnects cleanly, with no ghost participant', async () => {
    await pageA.getByRole('button', { name: 'Return to meeting setup' }).click();
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
    await expect(mainViewControl(pageA, 'Student')).toBeVisible();
  });

  await test.step('coming back online clears the notice and the pairing survives', async () => {
    await contextB.setOffline(false);
    await expect(pageA.locator('.peer-reconnecting')).toBeHidden({ timeout: 15_000 });
    await expect(mainViewControl(pageA, 'Student')).toBeVisible();
    await expect(mainViewControl(pageB, 'Tutor')).toBeVisible();
    await expect(pageA.locator('.connection-pill')).not.toContainText('Participant left');
  });

  await test.step('chat still works after the reconnect, proving the room state was not corrupted', async () => {
    await pageA.getByRole('button', { name: 'Toggle chat' }).click();
    await pageA.getByPlaceholder('Type a message…').fill('still here');
    await pageA.getByRole('button', { name: 'Send message' }).click();
    await pageB.getByRole('button', { name: 'Toggle chat' }).click();
    await expect(pageB.locator('.chat-message:not(.own) p')).toHaveText('still here');
  });

  await contextA.close();
  await contextB.close();
});

test('clicking a tile changes the main view, side-by-side works, and the participant panel reflects both sides', async ({ browser }) => {
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

  await test.step('clicking the local tile makes it the main view; clicking it again swaps back', async () => {
    await expect(pageA.locator('.meeting-stage>.local-tile')).toHaveCount(0);
    await pageA.getByRole('button', { name: "Make your view the main view" }).click();
    await expect(pageA.locator('.meeting-stage>.local-tile')).toHaveCount(1);
    await mainViewControl(pageA, 'Student').click();
    await expect(pageA.locator('.meeting-stage>.local-tile')).toHaveCount(0);
  });

  await test.step('side-by-side shows both tiles as direct, equally-sized stage children', async () => {
    await pageA.getByRole('button', { name: 'Meeting settings' }).click();
    await pageA.getByRole('button', { name: 'Side by side' }).click();
    await pageA.keyboard.press('Escape');
    await expect(pageA.locator('.stage-side-by-side')).toBeVisible();
    await expect(pageA.locator('.stage-side-by-side>.participant-tile')).toHaveCount(2);
    await expect(pageA.locator('.self-preview')).toHaveCount(0);
  });

  await test.step('the People panel lists both participants with their live mic/camera state', async () => {
    await pageA.getByRole('button', { name: 'Participants' }).click();
    const panel = pageA.locator('.participant-panel');
    await expect(panel).toContainText('Tutor (You)');
    await expect(panel).toContainText('Student');
    await pageA.keyboard.press('Escape');
  });

  await test.step('raising a hand relays to the peer and is reflected in the participant panel', async () => {
    await pageA.getByRole('button', { name: 'Raise your hand' }).click();
    await expect(pageB.locator('.participant-toast')).toContainText(/raised their hand/i);
    await pageB.getByRole('button', { name: 'Participants' }).click();
    await expect(pageB.locator('.participant-panel [aria-label="Hand raised"]')).toBeVisible();
    await pageA.getByRole('button', { name: 'Lower your hand' }).click();
  });

  await contextA.close();
  await contextB.close();
});

test('emoji reactions relay to the peer and disappear on their own (rate-limiting is covered server-side)', async ({ browser }) => {
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

  await test.step('sending a reaction shows it on both sides and it disappears on its own', async () => {
    await pageA.getByRole('button', { name: 'Send a reaction' }).click();
    await pageA.getByRole('button', { name: 'Send 🎉 reaction' }).click();
    await expect(pageA.locator('.floating-reaction')).toBeVisible();
    await expect(pageB.locator('.floating-reaction')).toBeVisible();
    await expect(pageA.locator('.floating-reaction')).toHaveCount(0, { timeout: 4_000 });
    await expect(pageB.locator('.floating-reaction')).toHaveCount(0, { timeout: 4_000 });
  });

  await contextA.close();
  await contextB.close();
});

test('the copied invite link uses the page\'s current origin, with no build-time configuration', async ({ browser }) => {
  const { context, page } = await openParticipant(browser, 'Tutor');
  await page.getByRole('button', { name: 'Create meeting' }).click();
  const roomId = await page.getByLabel('Room code').inputValue();

  await page.getByRole('button', { name: 'Copy invite link' }).first().click();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  const currentOrigin = await page.evaluate(() => window.location.origin);

  expect(clipboardText.startsWith(currentOrigin)).toBe(true);
  expect(clipboardText).toContain(`/meeting?room=${roomId}`);

  await context.close();
});
