import { expect, test } from '@playwright/test';

async function mockAuthenticated(page) {
  await page.route('**/api/v1/contacts?*', (route) => route.fulfill({ json: { data: [], meta: { total: 0, page: 1, limit: 25, pages: 0 } } }));
  await page.route('**/api/v1/contacts/statistics', (route) => route.fulfill({ json: { data: { active: 0, archived: 0, imports: 0, duplicates: 0, companies: [] } } }));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        data: {
          user: {
            id: 'synthetic-user-id',
            name: 'Taylor Example',
            email: 'taylor@example.test',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    }),
  );
}

test('dashboard shows readiness and navigation works at both widths', async ({
  page,
  isMobile,
}, testInfo) => {
  await mockAuthenticated(page);
  await page.route('**/api/v1/health/ready', (route) =>
    route.fulfill({ json: { data: { status: 'ok', service: 'hirereach-api' } } }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your next chapter starts here.' })).toBeVisible();
  await expect(page.getByText('API and database connected')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  for (const label of ['Contacts', 'Resume', 'Campaigns', 'Settings', 'Dashboard']) {
    if (isMobile) await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      label === 'Dashboard' ? 'Your next chapter starts here.' : label,
    );
    if (isMobile)
      await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('connection errors are visible and retry recovers', async ({ page }) => {
  await mockAuthenticated(page);
  await page.route('**/api/v1/health/ready', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'NOT_READY' } } }),
  );
  await page.goto('/dashboard');
  await expect(page.getByText('Connection unavailable')).toBeVisible();
  await page.unroute('**/api/v1/health/ready');
  await page.route('**/api/v1/health/ready', (route) =>
    route.fulfill({ json: { data: { status: 'ok', service: 'hirereach-api' } } }),
  );
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByText('API and database connected')).toBeVisible();
});

test('deep links and unknown routes render useful pages', async ({ page }) => {
  await mockAuthenticated(page);
  await page.goto('/resumes');
  await expect(page.getByRole('heading', { name: 'Resume', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Resume', exact: true })).toBeVisible();
  await page.goto('/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('redirects protected pages to login and opens dashboard after successful sign-in', async ({ page }) => {
  await page.route('**/api/v1/health/ready', (route) =>
    route.fulfill({ json: { data: { status: 'ok', service: 'hirereach-api' } } }),
  );
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }),
  );
  await page.route('**/api/v1/auth/csrf', (route) => route.fulfill({ json: { data: { csrfToken: 'x'.repeat(43) } } }));
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      json: {
        data: {
          user: {
            id: 'synthetic-user-id',
            name: 'Taylor Example',
            email: 'taylor@example.test',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    }),
  );
  await page.goto('/contacts');
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('Email').fill('taylor@example.test');
  await page.getByLabel('Password').fill('a-long-test-passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page.getByRole('heading', { name: 'Your next chapter starts here.' })).toBeVisible();
  await expect(page.getByText('Taylor Example')).toBeVisible();
});

test('registration validates fields and confirms successful submission', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }),
  );
  await page.route('**/api/v1/auth/csrf', (route) =>
    route.fulfill({ json: { data: { csrfToken: 'x'.repeat(43) } } }),
  );
  await page.route('**/api/v1/auth/register', (route) =>
    route.fulfill({
      status: 201,
      json: { data: { message: 'If the account can be created, registration was successful.' } },
    }),
  );
  await page.goto('/register');
  await page.getByLabel('Name').fill('Taylor Example');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Email').fill('taylor@example.test');
  await page.getByLabel('Password').fill('a-long-test-passphrase');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('registration was successful');
});
