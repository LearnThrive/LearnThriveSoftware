import { test, expect } from '@playwright/test';

// plan11.md task 11's EnquiryForm.tsx checklist: "Preserve backend contract and entered form
// values... Errors remain immediate and accessible." This file exercises the actual client
// component end to end. /api/enquiry is mocked via page.route() rather than hit for real — its own
// behaviour (rate limiting, Resend, the auto-reply) is already covered by tests/enquiry.test.mjs,
// and this project has a real RESEND_API_KEY configured, so a genuine POST here would send a real
// email to whatever ENQUIRY_EMAIL currently points at.

async function fillValidForm(page: import('@playwright/test').Page) {
  await page.getByLabel('Parent or guardian name').fill('Jordan Smith');
  await page.getByLabel('Email address').fill('jordan@example.com');
  await page.getByLabel("Student's year group").selectOption({ index: 1 });
  await page.getByLabel('Subject').selectOption({ index: 1 });
  await page
    .getByLabel('What support are you looking for?')
    .fill('Looking for weekly one-to-one support ahead of the summer exams.');
}

test.describe('EnquiryForm', () => {
  test('a valid submission shows the success panel with a checkmark, and can be reset', async ({ page }) => {
    await page.route('**/api/enquiry', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.goto('/book');
    await fillValidForm(page);
    await page.getByRole('button', { name: 'Send enquiry' }).click();

    const success = page.locator('.form-message--success');
    await expect(success).toBeVisible();
    await expect(success.getByText('Your enquiry has been sent.')).toBeVisible();
    await expect(success.locator('.form-success-check')).toBeVisible();

    await success.getByRole('button', { name: 'Send another enquiry' }).click();
    await expect(page.getByLabel('Parent or guardian name')).toBeVisible();
    await expect(page.getByLabel('Parent or guardian name')).toHaveValue('');
  });

  test('a server error is shown immediately and accessibly, and entered values survive it', async ({ page }) => {
    await page.route('**/api/enquiry', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Enquiries are temporarily unavailable. Please try again shortly.' }),
      }),
    );
    await page.goto('/book');
    await fillValidForm(page);
    await page.getByRole('button', { name: 'Send enquiry' }).click();

    const errorPanel = page.getByRole('alert').filter({ hasText: 'There was a problem.' });
    await expect(errorPanel).toBeVisible();
    await expect(errorPanel).toBeFocused();
    await expect(errorPanel).toContainText('Enquiries are temporarily unavailable');

    // Backend contract: the same values the user typed are still in the form, not reset.
    await expect(page.getByLabel('Parent or guardian name')).toHaveValue('Jordan Smith');
    await expect(page.getByLabel('Email address')).toHaveValue('jordan@example.com');
  });

  test('client-side validation blocks submission, focuses the error summary, and never calls the API', async ({ page }) => {
    let apiCalled = false;
    await page.route('**/api/enquiry', (route) => {
      apiCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/book');
    // Leave every field empty and submit immediately.
    await page.getByRole('button', { name: 'Send enquiry' }).click();

    const errorSummary = page.getByRole('alert').filter({ hasText: 'Check the highlighted fields.' });
    await expect(errorSummary).toBeVisible();
    await expect(errorSummary).toBeFocused();
    await expect(page.getByLabel('Parent or guardian name')).toHaveAttribute('aria-invalid', 'true');
    expect(apiCalled).toBe(false);
  });

  test('the progress dots reflect stage completion as fields are filled', async ({ page }) => {
    await page.goto('/book');
    const dots = page.locator('.enquiry-form-progress-dot');
    await expect(dots.nth(0)).not.toHaveClass(/is-complete/);
    await expect(dots.nth(1)).not.toHaveClass(/is-complete/);

    await page.getByLabel('Parent or guardian name').fill('Jordan Smith');
    await page.getByLabel('Email address').fill('jordan@example.com');
    await expect(dots.nth(0)).toHaveClass(/is-complete/);
    await expect(dots.nth(1)).not.toHaveClass(/is-complete/);

    await page.getByLabel("Student's year group").selectOption({ index: 1 });
    await page.getByLabel('Subject').selectOption({ index: 1 });
    await page
      .getByLabel('What support are you looking for?')
      .fill('Looking for weekly one-to-one support ahead of the summer exams.');
    await expect(dots.nth(1)).toHaveClass(/is-complete/);
  });
});
