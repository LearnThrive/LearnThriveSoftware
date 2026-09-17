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

// Joins an existing room as a student — lands in the waiting room, not the meeting itself.
async function joinAsStudent(page: Page) {
  await page.getByRole('button', { name: 'Join meeting' }).click();
  await expect(page.locator('.waiting-admission-panel')).toBeVisible();
}

async function admit(tutorPage: Page, studentName: string) {
  const trigger = tutorPage.getByRole('button', { name: 'Waiting room' });
  const panel = tutorPage.locator('.waiting-room-panel');
  if (!(await panel.isVisible())) await trigger.click();
  await tutorPage.getByRole('button', { name: `Admit ${studentName}` }).click();
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

async function connectTutorAndOneStudent(browser: Browser, tutorName = 'Tutor', studentName = 'Student') {
  const { context: contextA, page: pageA } = await openParticipant(browser, tutorName);
  await pageA.getByRole('button', { name: 'Create meeting' }).click();
  await enableDevices(pageA);
  // The room code must be read before submitting — "Start class" navigates straight into the
  // meeting and the pre-join form (including this field) is gone once that happens.
  const roomId = await pageA.getByLabel('Room code').inputValue();
  await pageA.getByRole('button', { name: 'Start class' }).click();

  const { context: contextB, page: pageB } = await openParticipant(browser, studentName, roomId);
  await enableDevices(pageB);
  await joinAsStudent(pageB);
  await admit(pageA, studentName);

  await expect(pageA.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });
  await expect(pageB.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });
  return { contextA, pageA, contextB, pageB, roomId };
}

test('a tutor and one student connect over WebRTC, exchange media state, and a third joiner waits undisturbed', async ({ browser }) => {
  const { context: contextA, page: pageA } = await openParticipant(browser, 'Tutor');
  await test.step('the tutor creates a class and enables devices', async () => {
    await pageA.getByRole('button', { name: 'Create meeting' }).click();
    await enableDevices(pageA);
  });

  const roomId = await pageA.getByLabel('Room code').inputValue();
  expect(roomId).toMatch(/^[a-z0-9][a-z0-9-]{7,47}$/);

  await test.step('the tutor starts the class and waits', async () => {
    await pageA.getByRole('button', { name: 'Start class' }).click();
    await expect(pageA.getByRole('region', { name: 'Waiting for other participants' })).toBeVisible();
  });

  const { context: contextB, page: pageB } = await openParticipant(browser, 'Student', roomId);
  await test.step('a student joins via the invite link and waits to be admitted', async () => {
    await expect(pageB.getByLabel('Room code')).toHaveValue(roomId);
    await enableDevices(pageB);
    await joinAsStudent(pageB);
  });

  await test.step('the tutor sees the waiting-room badge and admits the student', async () => {
    await expect(pageA.getByRole('button', { name: 'Waiting room' }).locator('.unread-badge')).toHaveText('1');
    await admit(pageA, 'Student');
  });

  await test.step('both reach a connected WebRTC state', async () => {
    await expect(pageA.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });
    await expect(pageB.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });
    await expect(mainViewControl(pageA, 'Student')).toBeVisible();
    await expect(mainViewControl(pageB, 'Tutor')).toBeVisible();
    await expect(pageA.locator('.participant-count')).toHaveText('2 / 4');
  });

  await test.step('muting and disabling video relay to the peer', async () => {
    await pageA.getByRole('button', { name: 'Turn microphone off' }).click();
    await expect(pageB.locator('.remote-tile .participant-media')).toHaveAttribute('aria-label', 'Microphone off');

    await pageA.getByRole('button', { name: 'Turn camera off' }).click();
    await expect(pageB.locator('.remote-tile .camera-placeholder')).toBeVisible();
  });

  // A second *tutor* attempt is rejected server-side (see server/signalling.test.ts's
  // "rejects a second tutor" test) — that's not reachable through the real UI, since the only
  // way a client ever declares role:'tutor' is via "Create meeting", which always mints a fresh
  // room code rather than joining an existing one, so there's no browser flow that produces it.
  await test.step('a third joiner (another student) waits undisturbed while the call continues', async () => {
    const { context: contextC, page: pageC } = await openParticipant(browser, 'Cate', roomId);
    await enableDevices(pageC);
    await joinAsStudent(pageC);
    await expect(pageA.getByRole('button', { name: 'Waiting room' }).locator('.unread-badge')).toHaveText('1');
    await expect(pageA.locator('.connection-pill')).toHaveClass(/connected/);
    await contextC.close();
  });

  await test.step('leaving ends the call for one side and returns the other to waiting', async () => {
    await leaveMeeting(pageA);
    await expect(pageA.getByRole('heading', { name: /left the meeting/i })).toBeVisible();
    // "X left" is a transient toast, not baked into the persistent connection pill — with up to
    // 3 other participants possible, one leaving shouldn't make the whole headline status say
    // "left" while others might still be connected. The pill instead reflects the aggregate
    // state, which correctly becomes "Waiting…" once the student has no peers left at all.
    await expect(pageB.locator('.participant-toast')).toContainText('Tutor left the meeting');
    await expect(pageB.locator('.connection-pill')).toContainText('Waiting');
    await expect(pageB.getByRole('region', { name: 'Waiting for other participants' })).toBeVisible();
  });

  await contextA.close();
  await contextB.close();
});

test('a second student waits, and Admit All admits everyone currently waiting', async ({ browser }) => {
  const { contextA, pageA, contextB, roomId } = await connectTutorAndOneStudent(browser);

  const { context: contextC, page: pageC } = await openParticipant(browser, 'Cate', roomId);
  await test.step('a second student joins and waits while the call with the first continues', async () => {
    await enableDevices(pageC);
    await joinAsStudent(pageC);
    await expect(pageA.getByRole('button', { name: 'Waiting room' }).locator('.unread-badge')).toHaveText('1');
    await expect(pageA.locator('.connection-pill')).toHaveClass(/connected/);
  });

  await test.step('Admit All admits the second student, and all three end up connected', async () => {
    await pageA.getByRole('button', { name: 'Waiting room' }).click();
    await pageA.getByRole('button', { name: 'Admit all' }).click();
    await expect(pageC.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });
    await expect(pageA.locator('.participant-count')).toHaveText('3 / 4');
    await expect(mainViewControl(pageA, 'Student')).toBeVisible();
    await expect(mainViewControl(pageA, 'Cate')).toBeVisible();
  });

  await contextA.close();
  await contextB.close();
  await contextC.close();
});

test('chat messages send, receive, show an unread badge, and render unsafe-looking text as plain text', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

  let dialogFired = false;
  pageA.on('dialog', (dialog) => { dialogFired = true; void dialog.dismiss(); });
  pageB.on('dialog', (dialog) => { dialogFired = true; void dialog.dismiss(); });
  const malicious = '<img src=x onerror=alert(1)>';

  await test.step('the tutor sends a message; it renders as literal text, never as an element', async () => {
    await pageA.getByRole('button', { name: 'Toggle chat' }).click();
    await pageA.getByPlaceholder('Type a message…').fill(malicious);
    await pageA.getByRole('button', { name: 'Send message' }).click();
    await expect(pageA.locator('.chat-message.own p')).toHaveText(malicious);
    await expect(pageA.locator('.chat-message.own img')).toHaveCount(0);
  });

  await test.step('the student sees an unread badge while chat is closed, then the message once opened', async () => {
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

test('the tutor can leave and rejoin the same room cleanly, as the tutor', async ({ browser }) => {
  const { context: contextA, page: pageA } = await openParticipant(browser, 'Tutor');
  await pageA.getByRole('button', { name: 'Create meeting' }).click();
  const roomId = await pageA.getByLabel('Room code').inputValue();
  await pageA.getByRole('button', { name: 'Start class' }).click();
  await expect(pageA.getByRole('region', { name: 'Waiting for other participants' })).toBeVisible();

  await test.step('leaving reaches the ended screen', async () => {
    await leaveMeeting(pageA);
    await expect(pageA.getByRole('heading', { name: /left the meeting/i })).toBeVisible();
  });

  await test.step('rejoining the same room from a fresh pre-join reconnects as the tutor, with no ghost participant', async () => {
    await pageA.getByRole('button', { name: 'Return to meeting setup' }).click();
    await pageA.getByLabel('Your name').fill('Tutor');
    await expect(pageA.getByLabel('Room code')).toHaveValue(roomId);
    await pageA.getByRole('button', { name: 'Start class' }).click();
    await expect(pageA.getByRole('region', { name: 'Waiting for other participants' })).toBeVisible();
    await expect(pageA.locator('.participant-count')).toHaveText('1 / 4');
  });

  await contextA.close();
});

test('a brief network drop recovers without a false departure notice, and chat still works afterwards', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

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
    // Genuinely reconnected, not stuck in some in-between state — a false departure would show
    // as a transient toast, not as this pill ever failing to reach "connected" again.
    await expect(pageA.locator('.connection-pill')).toHaveClass(/connected/);
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

test('clicking a tile changes the main view, side-by-side works, and the participant panel shows roles', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

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
    await expect(pageA.locator('.focus-strip')).toHaveCount(0);
  });

  await test.step('the People panel lists both participants with their roles and live mic/camera state', async () => {
    await pageA.getByRole('button', { name: 'Participants' }).click();
    const panel = pageA.locator('.participant-panel');
    await expect(panel).toContainText('Tutor (You)');
    await expect(panel).toContainText('Tutor');
    await expect(panel).toContainText('Student');
    await expect(panel.locator('.role-badge-tutor')).toBeVisible();
    await expect(panel.locator('.role-badge-student')).toBeVisible();
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
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

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
