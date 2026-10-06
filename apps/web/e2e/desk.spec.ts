import { expect, test } from '@playwright/test';

test('replay runs → setup appears → card click focuses chart → copilot explains the setup', async ({ page }) => {
  await page.goto('/');

  // Live feed: header shows a 2-decimal price and the replay chip (never MOCK DATA).
  await expect(page.getByTestId('last-price')).toHaveText(/^\d+\.\d{2}$/);
  await expect(page.getByTestId('feed-label')).toContainText('replay');
  await expect(page.getByTestId('mock-badge')).toHaveCount(0);

  // Charts render (lightweight-charts creates canvases) and agents stream into the log.
  await expect(page.getByTestId('main-chart').locator('canvas').first()).toBeVisible();
  await expect(page.getByTestId('activity-log').locator('li').first()).toBeVisible();

  // A setup appears from the engine (replay at 600× produces one within a couple of minutes at most).
  const card = page.getByTestId('setup-card').first();
  await expect(card).toBeVisible({ timeout: 110_000 });
  const cardText = (await card.textContent()) ?? '';
  const playbook = /\bA\b/.test(cardText.slice(0, 4)) ? 'A' : 'B';

  // Clicking the card focuses the chart: card pressed, playbook + entry timeframe tabs switch.
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const expectedTf = playbook === 'A' ? 'M15' : 'M5';
  await expect(page.getByRole('tablist', { name: 'Timeframe' }).getByRole('button', { name: new RegExp(`^${expectedTf}$`) })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tablist', { name: 'Playbook' }).getByRole('button', { name: new RegExp(`^${playbook} ·`) })).toHaveAttribute('aria-pressed', 'true');

  // Chat: ask why the setup is valid and get an Indonesian reply that cites the setup.
  const input = page.getByLabel('Pesan untuk copilot');
  await input.fill('kenapa setup ini valid?');
  await input.press('Enter');
  const messages = page.getByTestId('chat-messages');
  await expect(messages).toContainText('kenapa setup ini valid?');
  await expect(messages.getByText(/copilot/i).first()).toBeVisible();
  await expect(messages).toContainText(/Setup .* (status|VALID)|Bias M(30|15)/, { timeout: 30_000 });
});

test('keyboard shortcuts switch timeframe and playbook; theme toggles the data attribute', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('last-price').waitFor();
  await page.keyboard.press('4');
  await expect(page.getByRole('tablist', { name: 'Timeframe' }).getByRole('button', { name: /^M30$/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('a');
  await expect(page.getByRole('tablist', { name: 'Playbook' }).getByRole('button', { name: /^A ·/ })).toHaveAttribute('aria-pressed', 'true');
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.keyboard.press('t');
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
});
