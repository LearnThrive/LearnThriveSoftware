import { test, expect, type Page } from '@playwright/test';
import { PASSWORD, address, confirm, distinctVisitor, expectAxeClean, link, signUp } from './account-support';
import { hydrated } from './careers-support';

// Learner identity in a browser (docs/IDENTITY.md), on the fourth dev server: Study Buddy on the mock model with the children's switch
// ON (ASSISTANT_MINORS_APPROVED) so the per-learner rules (consent, login, supervised view) are what decide, not the deployment.
// Covers the guardian's side (add a student, consent, supervised view, leaving it with a password) and the learner's own login from an
// invitation, including that a learner never reaches the account, billing or the guardian controls.

distinctVisitor();

async function guardian(page: Page) {
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  // Enrolled, so the household has the Library benefit Study Buddy needs.
  expect((await page.request.post('/api/dev/library-seed', { data: { action: 'enrol', email } })).ok()).toBe(true);
  return email;
}

async function addStudent(page: Page, name: string, year: string) {
  await page.getByRole('button', { name: 'Add a student' }).click();
  const form = page.getByRole('form', { name: 'Add a student' });
  await form.getByLabel('First name or nickname').fill(name);
  await form.getByLabel('Year group (optional)').fill(year);
  await form.getByRole('button', { name: 'Add student' }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}

test('a guardian adds a young learner, agrees to Study Buddy, views as them, and needs their password to come back', async ({ page }) => {
  test.setTimeout(90_000);
  await guardian(page);
  await page.goto('/account/learners');
  await hydrated(page);
  await addStudent(page, 'Kit', 'Year 3');
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name: 'Kit' }) });
  await expect(card).toContainText('too young for a sign-in of their own');
  await expectAxeClean(page, 'the learners page');

  await card.getByRole('checkbox', { name: /may use Study Buddy/ }).click();
  await expect(card).toContainText('Study Buddy agreed');
  await card.getByRole('checkbox', { name: /Allow the supervised view/ }).click();
  await expect(card).toContainText('Supervised view on');
  await card.getByRole('button', { name: 'View as Kit' }).click();
  await expect(page).toHaveURL(/\/library\/study-buddy$/);

  const banner = page.getByRole('region', { name: 'Supervised view' });
  await expect(banner).toContainText('Viewing as Kit');
  // The account and the guardian controls are shut inside the view, by the server as well as the menu.
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Account' })).toHaveCount(0);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/library\/study-buddy$/);
  await page.goto('/account/learners');
  await expect(page).toHaveURL(/\/library\/study-buddy$/);
  const closed = await page.request.get('/api/learners');
  expect(closed.status()).toBe(403);
  expect((await closed.json()).code).toBe('leave_learner_view');

  // Study Buddy works as the learner, with no adult confirmation asked: the guardian's agreement stands in for it.
  await expect(page.getByRole('heading', { level: 1, name: 'Study Buddy' })).toBeVisible();
  await page.getByRole('textbox').first().fill('What is 6 x 7?');
  await page.getByRole('button', { name: /send/i }).click();
  await expect(page.locator('article[aria-label="Study Buddy"]').last()).toContainText('Good question', { timeout: 20_000 });
  await expectAxeClean(page, 'Study Buddy in the supervised view');

  // Leaving needs the password.
  await banner.getByRole('button', { name: 'Leave this view' }).click();
  await banner.getByLabel('Your password').fill('not the password at all');
  await banner.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(banner.getByRole('alert')).toContainText('not right');
  await banner.getByLabel('Your password').fill(PASSWORD);
  await banner.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/learners$/);
  await expect(page.getByRole('region', { name: 'Supervised view' })).toHaveCount(0);

  // Back as the guardian: the learner's conversation is not in the guardian's own history, and can only be deleted.
  const mine = await page.request.get('/api/assistant/sessions');
  expect((await mine.json()).sessions).toEqual([]);
  page.once('dialog', (dialog) => void dialog.accept());
  await card.getByRole('button', { name: 'Delete conversations' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Conversations deleted' })).toBeVisible();
});

test('an older learner is invited, makes their account, accepts, and has Study Buddy but no account administration', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await guardian(page);
  await page.goto('/account/learners');
  await hydrated(page);
  await addStudent(page, 'Ava', 'Year 10');
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name: 'Ava' }) });
  await card.getByRole('checkbox', { name: /may use Study Buddy/ }).click();
  await expect(card).toContainText('Study Buddy agreed');
  const learnerEmail = address();
  await card.getByLabel(/email address \(optional\)/).fill(learnerEmail);
  await card.getByRole('button', { name: 'Invite to sign in' }).click();
  const invitation = card.getByRole('status').filter({ hasText: 'Give Ava this link' });
  await expect(invitation).toBeVisible();
  const inviteLink = (await invitation.locator('code').innerText()).trim();
  expect(inviteLink).toContain('/learner/accept?token=');
  await expect(card).toContainText('Invitation waiting');

  // The learner, in their own browser, with no session.
  const learnerContext = await browser.newContext({ baseURL: 'http://localhost:3103' });
  const learner = await learnerContext.newPage();
  await learner.goto(inviteLink.replace(/^https?:\/\/[^/]+/, ''));
  await hydrated(learner);
  await expectAxeClean(learner, 'the invitation page');
  const form = learner.getByRole('form', { name: 'Make your account' });
  await expect(form.getByLabel('Email address')).toHaveValue(learnerEmail);
  await form.getByLabel('Your first name').fill('Ava');
  await form.getByLabel('Choose a password').fill(PASSWORD);
  await form.getByRole('button', { name: 'Make my account' }).click();
  await expect(learner.getByText('We have sent you an email')).toBeVisible();
  await learner.goto(await link(learner, learnerEmail, 'signup'));
  await hydrated(learner);
  await learner.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(learner).toHaveURL(/\/account$/);

  // Opening the invitation again, now signed in, accepts it.
  await learner.goto(inviteLink.replace(/^https?:\/\/[^/]+/, ''));
  await hydrated(learner);
  await learner.getByRole('button', { name: 'Accept the invitation' }).click();
  await expect(learner).toHaveURL(/\/library\/study-buddy$/);
  await expect(learner.getByRole('heading', { level: 1, name: 'Study Buddy' })).toBeVisible();
  await learner.getByRole('textbox').first().fill('What is 6 x 7?');
  await learner.getByRole('button', { name: /send/i }).click();
  await expect(learner.locator('article[aria-label="Study Buddy"]').last()).toContainText('Good question', { timeout: 20_000 });

  // A learner is not an account holder: no billing, no guardian pages, no guardian API.
  await learner.goto('/account');
  await expect(learner.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await expect(learner.getByText(/subscri/i)).toHaveCount(0);
  await expect(learner.getByRole('link', { name: /Manage your learners/ })).toHaveCount(0);
  expect((await learner.goto('/account/learners'))?.status()).toBe(404);
  expect((await learner.request.get('/api/learners')).status()).toBe(403);
  expect((await learner.request.post('/api/billing/create-portal-session', { headers: { Origin: 'http://localhost:3103' } })).status()).not.toBe(200);
  // And the invitation cannot be used twice.
  const again = await learner.request.post('/api/learner/accept', { data: { token: new URL(inviteLink).searchParams.get('token') }, headers: { Origin: 'http://localhost:3103' } });
  expect(again.status()).toBe(410);

  // The guardian suspends the login: the learner's next request is refused although their session is still valid.
  await page.reload();
  await hydrated(page);
  await card.getByRole('button', { name: 'Suspend login' }).click();
  await expect(card).toContainText('suspended');
  const chat = await learner.request.get('/api/assistant/sessions');
  expect(chat.status()).toBe(403);
  await learnerContext.close();
});
