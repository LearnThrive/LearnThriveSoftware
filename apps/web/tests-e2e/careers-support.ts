import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { currentAgreement } from '../src/lib/safeguarding-agreement';

// Shared by the careers, reconfirmation and subject-request specs: small real files, a PNG that is too big to
// upload as it is, the agreement's right answers, and a mock of the POST routes. Every spec MOCKS the three
// POST routes: this project has real email credentials in its environment, so a genuine POST would send a real
// email. The routes' own behaviour is covered by tests/careersApply.test.mjs, reconfirm.test.mjs and
// subjectRequest.test.mjs with the email network call replaced.

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** A valid RGB PNG of random noise: it does not compress, so it is about 3 bytes a pixel. */
export function noisePng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let i = 1; i < row.length; i += 1) row[i] = Math.floor(Math.random() * 256);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const agreement = currentAgreement;
export const rightAnswers = Object.fromEntries(currentAgreement.understanding.map((question) => [question.id, question.correctOptionId]));

/** Waits for the human check to finish (the proof of work runs in a worker, usually well under a second). */
export async function humanCheckDone(page: Page) {
  await expect(page.getByText('Checked: you are a person.')).toBeVisible({ timeout: 30_000 });
}

export interface Captured {
  calls: number;
  contentType: string;
  body: string;
}

/** Replaces a POST route with a canned answer and records what the browser sent. */
export async function mockPost(page: Page, pattern: string, answer: { status?: number; json: unknown }): Promise<Captured> {
  const captured: Captured = { calls: 0, contentType: '', body: '' };
  await page.route(pattern, (route) => {
    const request = route.request();
    captured.calls += 1;
    captured.contentType = request.headers()['content-type'] ?? '';
    captured.body = (request.postDataBuffer() ?? Buffer.alloc(0)).toString('latin1');
    return route.fulfill({ status: answer.status ?? 200, contentType: 'application/json', body: JSON.stringify(answer.json) });
  });
  return captured;
}

/** Chooses an option in a focused <select> with the keyboard alone (type-ahead on the option's text). */
export async function chooseByKeyboard(page: Page, label: string | RegExp, optionText: string) {
  const select = page.getByLabel(label);
  const value = (await select.locator('option', { hasText: optionText }).first().getAttribute('value')) ?? optionText;
  await select.focus();
  await page.keyboard.type(optionText, { delay: 15 });
  await expect(select).toHaveValue(value);
}

/** axe-core (WCAG 2 A and AA) over the page as it is now. Fails with the violations listed. */
export async function expectNoAxeViolations(page: Page, label: string) {
  const source = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  await page.addScriptTag({ content: source });
  const results = (await page.evaluate(async () => {
    // @ts-expect-error injected global, no types installed for the browser build
    return await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
  })) as { violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> };
  const lines = results.violations.map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`);
  expect(results.violations, `${label}: ${results.violations.length} accessibility violation(s)\n\n${lines.join('\n\n')}`).toEqual([]);
}
