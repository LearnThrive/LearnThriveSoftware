import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.env.SHOT_BASE || 'http://localhost:3210';
const outDir = process.env.SHOT_DIR || 'shots';
const width = Number(process.env.SHOT_WIDTH || 1440);
const height = Number(process.env.SHOT_HEIGHT || 900);
const account = process.env.SHOT_ACCOUNT || 'admin';

const ACCOUNTS = {
  admin: ['admin@learnthrive.dev', 'dev-admin-pass'],
  tutor: ['tutor@learnthrive.dev', 'dev-tutor-pass'],
  client: ['client@learnthrive.dev', 'dev-client-pass'],
  student: ['student@learnthrive.dev', 'dev-student-pass'],
};

const ROUTES = (process.env.SHOT_ROUTES || '/dashboard').split(',');

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

if (account !== 'none') {
  const [email, password] = ACCOUNTS[account];
  await page.goto(base + '/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#login-password').fill(password);
  await Promise.all([page.waitForURL(/\/dashboard$/), page.getByRole('button', { name: 'Sign in' }).click()]);
}

for (const route of ROUTES) {
  await page.goto(base + route, { waitUntil: 'networkidle' });
  const name = `${account}-${width}-${route.replace(/[^a-z0-9]+/gi, '_') || 'root'}`;
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  console.log('shot', route, '->', name + '.png');
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/page errors');
await browser.close();
