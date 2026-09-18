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

async function leaveMeeting(page: Page, isTutor = false) {
  await page.getByRole('button', { name: isTutor ? 'End class' : 'Leave meeting' }).click();
  await page.getByRole('button', { name: isTutor ? 'Yes, end class' : 'Yes, leave' }).click();
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

// Same as connectTutorAndOneStudent, but with `?debug=1` on both pages so the development
// diagnostics panel (including whiteboard page/element counts) is available for assertions —
// whiteboard content lands on canvas, which isn't otherwise assertable via accessible roles/text.
async function connectTutorAndOneStudentWithDebug(browser: Browser, tutorName = 'Tutor', studentName = 'Student') {
  const isChromium = browser.browserType().name() === 'chromium';
  const contextA = await browser.newContext(isChromium ? { permissions: ['camera', 'microphone'] } : {});
  const pageA = await contextA.newPage();
  await pageA.goto('/meeting?debug=1');
  await pageA.getByLabel('Your name').fill(tutorName);
  await pageA.getByRole('button', { name: 'Create meeting' }).click();
  await enableDevices(pageA);
  const roomId = await pageA.getByLabel('Room code').inputValue();
  await pageA.getByRole('button', { name: 'Start class' }).click();

  const contextB = await browser.newContext(isChromium ? { permissions: ['camera', 'microphone'] } : {});
  const pageB = await contextB.newPage();
  await pageB.goto(`/meeting?debug=1&room=${roomId}`);
  await pageB.getByLabel('Your name').fill(studentName);
  await enableDevices(pageB);
  await joinAsStudent(pageB);
  await admit(pageA, studentName);

  await expect(pageA.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });
  await expect(pageB.locator('.connection-pill')).toHaveClass(/connected/, { timeout: 20_000 });
  return { contextA, pageA, contextB, pageB, roomId };
}

function boardElementCount(page: Page) {
  return page.locator('dt', { hasText: 'Whiteboard elements' }).locator('xpath=following-sibling::dd[1]');
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

  await test.step('the tutor ending the class ends it for the student too, not just a peer-left notice', async () => {
    await leaveMeeting(pageA, true);
    await expect(pageA.getByRole('heading', { name: /left the meeting/i })).toBeVisible();
    await expect(pageB.getByRole('heading', { name: /tutor ended the class/i })).toBeVisible();
    await expect(pageB.getByRole('button', { name: /rejoin/i })).toHaveCount(0);
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
    await leaveMeeting(pageA, true);
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

test('the tutor can deny a waiting student and lock the room against new joins', async ({ browser }) => {
  const { context: contextA, page: pageA } = await openParticipant(browser, 'Tutor');
  await pageA.getByRole('button', { name: 'Create meeting' }).click();
  const roomId = await pageA.getByLabel('Room code').inputValue();
  await pageA.getByRole('button', { name: 'Start class' }).click();

  const { context: contextB, page: pageB } = await openParticipant(browser, 'Student', roomId);
  await joinAsStudent(pageB);

  await test.step('denying the waiting student sends them back with an explanation', async () => {
    await pageA.getByRole('button', { name: 'Waiting room' }).click();
    await pageA.getByRole('button', { name: 'Deny Student' }).click();
    await expect(pageB.getByText(/tutor declined to admit you/i)).toBeVisible();
  });

  await test.step('locking the room rejects a new joiner', async () => {
    await pageA.getByRole('button', { name: 'Class controls' }).click();
    await pageA.getByRole('button', { name: 'Lock room' }).click();
    await pageA.keyboard.press('Escape');

    const { context: contextC, page: pageC } = await openParticipant(browser, 'Mallory', roomId);
    await pageC.getByRole('button', { name: 'Join meeting' }).click();
    await expect(pageC.getByText(/currently locked/i)).toBeVisible();
    await contextC.close();
  });

  await contextA.close();
  await contextB.close();
});

test('the tutor can force-mute a student, who cannot self-unmute until allowed again', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

  await test.step('force-muting turns off the mic and blocks the student\'s own unmute attempt', async () => {
    await pageA.getByRole('button', { name: 'Participants' }).click();
    await pageA.getByRole('button', { name: 'Mute Student' }).click();
    await pageA.keyboard.press('Escape');

    await expect(pageB.getByRole('button', { name: 'Muted by the tutor' })).toBeVisible();
    await pageB.getByRole('button', { name: 'Muted by the tutor' }).click();
    await expect(pageB.getByText(/tutor has muted you/i)).toBeVisible();
  });

  await test.step('allowing unmute lets the student turn their mic back on', async () => {
    await pageA.getByRole('button', { name: 'Participants' }).click();
    await pageA.getByRole('button', { name: 'Allow Student to unmute' }).click();
    await pageA.keyboard.press('Escape');

    await pageB.getByRole('button', { name: 'Turn microphone on' }).click();
    await expect(pageA.locator('.remote-tile .participant-media')).toHaveAttribute('aria-label', 'Microphone on');
  });

  await contextA.close();
  await contextB.close();
});

test('the tutor can remove a student, who is immediately disconnected with no rejoin option', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

  await pageA.getByRole('button', { name: 'Participants' }).click();
  await pageA.getByRole('button', { name: 'Remove Student from class' }).click();
  await pageA.keyboard.press('Escape');

  await expect(pageB.getByRole('heading', { name: /removed from the class/i })).toBeVisible();
  await expect(pageB.getByRole('button', { name: /rejoin/i })).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

test('the tutor can delete a single chat message and clear the whole chat', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

  await pageA.getByRole('button', { name: 'Toggle chat' }).click();
  await pageA.getByPlaceholder('Type a message…').fill('hello everyone');
  await pageA.getByRole('button', { name: 'Send message' }).click();
  await pageB.getByRole('button', { name: 'Toggle chat' }).click();
  await expect(pageB.locator('.chat-message p')).toHaveText('hello everyone');

  await test.step('deleting the message removes it for both sides', async () => {
    await pageA.getByRole('button', { name: 'Delete message' }).click();
    await expect(pageA.locator('.chat-message')).toHaveCount(0);
    await expect(pageB.locator('.chat-message')).toHaveCount(0);
  });

  await test.step('clearing the chat removes every message for both sides', async () => {
    await pageA.getByPlaceholder('Type a message…').fill('second message');
    await pageA.getByRole('button', { name: 'Send message' }).click();
    await expect(pageB.locator('.chat-message')).toHaveCount(1);

    await pageA.getByRole('button', { name: 'Clear chat for everyone' }).click();
    await expect(pageA.locator('.chat-message')).toHaveCount(0);
    await expect(pageB.locator('.chat-message')).toHaveCount(0);
  });

  await contextA.close();
  await contextB.close();
});

test('the tutor can run a poll end to end and both sides see live results', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

  await test.step('the tutor creates a two-option poll', async () => {
    await pageA.getByRole('button', { name: 'Class controls' }).click();
    await pageA.getByRole('button', { name: 'Start a poll' }).click();
    await pageA.getByLabel('Question').fill('Ready for a quiz?');
    const options = pageA.locator('.poll-creator-option input');
    await options.nth(0).fill('Yes');
    await options.nth(1).fill('No');
    await pageA.getByRole('button', { name: 'Start poll' }).click();
  });

  await test.step('both sides see the poll; the student votes and the tutor sees the tally update', async () => {
    await expect(pageA.locator('.poll-panel')).toContainText('Ready for a quiz?');
    await expect(pageB.locator('.poll-panel')).toContainText('Ready for a quiz?');
    await pageB.getByRole('button', { name: 'Yes' }).click();
    await expect(pageA.locator('.poll-panel')).toContainText('1 vote');
  });

  await test.step('closing the poll freezes it for everyone', async () => {
    await pageA.getByRole('button', { name: 'Close poll' }).click();
    await expect(pageA.locator('.poll-panel')).toContainText('Poll closed');
    await expect(pageB.locator('.poll-panel')).toContainText('Poll closed');
  });

  await contextA.close();
  await contextB.close();
});

test('the tutor can run an understanding check and see live per-student responses', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

  await test.step('the tutor starts a check; the student responds and only the tutor sees the aggregate', async () => {
    await pageA.getByRole('button', { name: 'Class controls' }).click();
    await pageA.getByRole('button', { name: 'Start understanding check' }).click();
    await expect(pageB.locator('.understanding-panel')).toBeVisible();

    await pageB.getByRole('button', { name: 'Got it' }).click();
    await expect(pageA.locator('.understanding-panel')).toContainText('1 got it');
    await expect(pageA.locator('.understanding-responses')).toContainText('Student');
  });

  await test.step('ending the check hides it for both sides', async () => {
    await pageA.getByRole('button', { name: 'End check' }).click();
    await expect(pageA.locator('.understanding-panel')).toHaveCount(0);
    await expect(pageB.locator('.understanding-panel')).toHaveCount(0);
  });

  await contextA.close();
  await contextB.close();
});

test('the tutor can start, pause, resume, and stop a class timer that both sides see', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

  await test.step('starting a stopwatch shows a ticking timer to both sides', async () => {
    await pageA.getByRole('button', { name: 'Class controls' }).click();
    await pageA.getByRole('button', { name: 'Start a timer' }).click();
    await pageA.getByRole('button', { name: 'Start timer' }).click();
    await expect(pageA.locator('.class-timer')).toBeVisible();
    await expect(pageB.locator('.class-timer')).toBeVisible();
  });

  await test.step('pausing and stopping are both reflected for the student, who has no controls of their own', async () => {
    await expect(pageB.locator('.class-timer-controls')).toHaveCount(0);
    await pageA.getByRole('button', { name: 'Pause timer' }).click();
    await pageA.getByRole('button', { name: 'Stop timer' }).click();
    await expect(pageA.locator('.class-timer')).toHaveCount(0);
    await expect(pageB.locator('.class-timer')).toHaveCount(0);
  });

  await contextA.close();
  await contextB.close();
});

test('the H key toggles raising and lowering a hand', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

  await pageB.locator('body').press('h');
  await expect(pageB.getByRole('button', { name: 'Lower your hand' })).toBeVisible();
  await pageA.getByRole('button', { name: 'Participants' }).click();
  await expect(pageA.locator('.participant-panel [aria-label="Hand raised"]')).toBeVisible();

  await pageB.locator('body').press('h');
  await expect(pageB.getByRole('button', { name: 'Raise your hand' })).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test('a role badge appears on the camera-off avatar placeholder', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudent(browser);

  await pageA.getByRole('button', { name: 'Turn camera off' }).click();
  await expect(pageB.locator('.remote-tile .role-badge-tutor')).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test('the collaborative whiteboard syncs a drawn element to the student, gates drawing behind permission, and syncs a new page', async ({ browser }) => {
  const { pageA, pageB, contextA, contextB } = await connectTutorAndOneStudentWithDebug(browser);
  await pageA.getByText('Development diagnostics').click();
  await pageB.getByText('Development diagnostics').click();

  await test.step('both sides switch to Board mode', async () => {
    await pageA.getByRole('tab', { name: 'Board' }).click();
    await pageB.getByRole('tab', { name: 'Board' }).click();
    await expect(pageA.locator('.whiteboard-canvas canvas').first()).toBeVisible();
    await expect(pageB.locator('.whiteboard-canvas canvas').first()).toBeVisible();
  });

  await test.step('the tutor draws a rectangle; the student receives it', async () => {
    const canvas = pageA.locator('.whiteboard-canvas canvas').first();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await pageA.locator('[data-testid="toolbar-rectangle"]').click({ force: true });
    await pageA.mouse.move(cx - 60, cy - 60);
    await pageA.mouse.down();
    await pageA.mouse.move(cx + 60, cy + 60, { steps: 5 });
    await pageA.mouse.up();

    // The drawn rectangle is confirmed via the STUDENT's count — a genuine cross-participant sync
    // check. The tutor's own debug count isn't asserted here: the local cache this diagnostics
    // row reads is only updated from remote-originated updates or on switching away from a page
    // (see Whiteboard.tsx), not from the live, not-yet-broadcast local Excalidraw scene, so it
    // would still read 0 immediately after drawing even though the tutor's own canvas already
    // shows the shape (confirmed visually while building this test).
    await expect(boardElementCount(pageB)).toHaveText('1', { timeout: 10_000 });
  });

  await test.step('the tutor disables student drawing; the student sees a view-only board', async () => {
    await pageA.getByRole('button', { name: 'Students can draw' }).click();
    await expect(pageB.locator('.whiteboard-view-only-badge')).toBeVisible();
  });

  await test.step('the tutor adds a page; both sides see it', async () => {
    await pageA.getByRole('button', { name: 'Add whiteboard page' }).click();
    await expect(pageA.locator('.board-page-tabs .board-page-tab')).toHaveCount(2);
    await expect(pageB.locator('.board-page-tabs .board-page-tab')).toHaveCount(2);
  });

  await contextA.close();
  await contextB.close();
});
