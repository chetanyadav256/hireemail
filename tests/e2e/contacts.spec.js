import { expect, test } from '@playwright/test';

async function mockContacts(page, initial = []) {
  const state = { contacts: initial, imports: [], commits: 0, edits: 0 };
  const mapping = { email: null, hrName: 2, companyName: 1, designation: null };
  const record = {
    id: '111111111111111111111111',
    filename: 'recruiters.csv',
    status: 'mapping',
    version: 0,
    sheets: [{ name: 'CSV', columns: ['Mailbox', 'Company', 'HR Name'], rowCount: 3 }],
    createdAt: new Date().toISOString(),
    previewExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    expired: false,
    suggestedMapping: mapping,
  };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const reply = (data, status = 200) => route.fulfill({ status, json: { data } });
    const list = (items) => {
      const pageNumber = Number(url.searchParams.get('page') || 1);
      const limit = Number(url.searchParams.get('limit') || 25);
      return route.fulfill({
        json: {
          data: items.slice((pageNumber - 1) * limit, pageNumber * limit),
          meta: {
            page: pageNumber,
            limit,
            total: items.length,
            pages: Math.ceil(items.length / limit),
          },
        },
      });
    };
    if (path === '/auth/me')
      return reply({
        user: {
          id: 'owner',
          name: 'Taylor Example',
          email: 'taylor@example.test',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });
    if (path === '/auth/csrf') return reply({ csrfToken: 'x'.repeat(43) });
    if (path === '/contacts/statistics')
      return reply({
        active: state.contacts.filter((c) => !c.archivedAt).length,
        archived: state.contacts.filter((c) => c.archivedAt).length,
        companies: ['Acme'],
        imports: state.imports.length,
        duplicates: 0,
      });
    if (request.method() !== 'GET') expect(request.headers()['x-csrf-token']).toBe('x'.repeat(43));
    if (path === '/contact-imports' && request.method() === 'POST') {
      state.imports = [record];
      return reply(record, 201);
    }
    if (path.endsWith('/preview')) {
      const body = request.postDataJSON();
      expect(body.mapping.email).toBe(0);
      Object.assign(record, {
        mapping: body.mapping,
        sheet: 'CSV',
        status: 'preview',
        version: record.version + 1,
        counts: { total: 3, valid: 1, invalid: 1, duplicate: 0, skipped: 1, saved: 0 },
      });
      return reply(record);
    }
    if (path.endsWith('/commit')) {
      expect(request.postDataJSON().expectedVersion).toBe(record.version);
      state.commits += 1;
      state.contacts.push({
        id: '222222222222222222222222',
        email: 'hr@example.test',
        hrName: 'Morgan',
        companyName: 'Acme',
        designation: '',
        version: 0,
        archivedAt: null,
      });
      Object.assign(record, {
        status: 'completed',
        version: record.version + 1,
        counts: { ...record.counts, saved: 1 },
      });
      return reply(record);
    }
    if (path.endsWith('/rows'))
      return list(
        [
          {
            rowNumber: 2,
            status: 'valid',
            cleaned: { email: 'hr@example.test', hrName: 'Morgan', companyName: 'Acme' },
          },
          {
            rowNumber: 3,
            status: 'invalid',
            reason: 'INVALID_EMAIL_OR_FIELDS',
            values: { email: 'not-an-email' },
          },
          { rowNumber: 4, status: 'skipped', reason: 'EMPTY_ROW' },
        ].filter(
          (row) =>
            url.searchParams.get('status') === 'all' ||
            row.status === url.searchParams.get('status'),
        ),
      );
    if (path === '/contact-imports') return list(state.imports);
    if (path.startsWith('/contact-imports/')) return reply(record);
    if (path === '/contacts') {
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const status = url.searchParams.get('status');
      const company = url.searchParams.get('company');
      return list(
        state.contacts.filter(
          (c) =>
            [c.email, c.hrName, c.companyName].join(' ').toLowerCase().includes(search) &&
            (!company || c.companyName === company) &&
            (status === 'all' || (status === 'archived' ? c.archivedAt : !c.archivedAt)),
        ),
      );
    }
    if (path.startsWith('/contacts/')) {
      const contact = state.contacts.find((c) => path.endsWith(c.id));
      expect(contact).toBeTruthy();
      if (request.method() === 'DELETE') {
        contact.archivedAt = new Date().toISOString();
        contact.version += 1;
        return route.fulfill({ status: 204 });
      }
      const body = request.postDataJSON();
      expect(body.expectedVersion).toBe(contact.version);
      Object.assign(contact, body, { version: contact.version + 1 });
      if (body.archived === false) contact.archivedAt = null;
      state.edits += 1;
      return reply(contact);
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
  });
  return state;
}

test('map, preview, explicitly save, select, edit, delete, restore, and inspect history', async ({
  page,
}, testInfo) => {
  const state = await mockContacts(page);
  await page.goto('/contacts');
  await expect(page.getByText('No contacts match this view')).toBeVisible();
  await page.getByRole('button', { name: 'Import contacts', exact: true }).click();
  await page
    .getByLabel('Contact file')
    .setInputFiles({
      name: 'recruiters.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Mailbox,Company,HR Name\nhr@example.test,Acme,Morgan\nnot-an-email,,\n,,',
      ),
    });
  await page.getByRole('button', { name: 'Upload for mapping' }).click();
  await expect(page.getByRole('button', { name: 'Preview cleaned contacts' })).toBeDisabled();
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue('1');
  await page.getByLabel('Email (required)').selectOption('0');
  await page.getByRole('button', { name: 'Preview cleaned contacts' }).click();
  await expect(page.getByText('not-an-email', { exact: true })).toBeVisible();
  expect(state.contacts).toHaveLength(0);
  expect(state.commits).toBe(0);
  await page.getByLabel('Company', { exact: true }).selectOption('');
  await expect(page.getByRole('button', { name: 'Confirm and save 1 contacts' })).toBeDisabled();
  await page.getByLabel('Company', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Preview cleaned contacts' }).click();
  await expect(page.getByRole('button', { name: 'Confirm and save 1 contacts' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('contact-preview.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Confirm and save 1 contacts' }).click();
  await expect(page.getByText('Import complete. 1 contacts saved.')).toBeVisible();
  expect(state.commits).toBe(1);
  await page.getByRole('button', { name: 'Close import' }).click();
  await page.getByLabel('Select hr@example.test', { exact: true }).check();
  await expect(page.getByText(/1 selected for a future campaign/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit hr@example.test' }).click();
  await page
    .getByRole('form', { name: 'Edit contact' })
    .getByLabel('HR name')
    .fill('Morgan Updated');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Morgan Updated', { exact: true })).toBeVisible();
  expect(state.edits).toBe(1);
  await page.getByRole('button', { name: 'Delete hr@example.test' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByText('No contacts match this view')).toBeVisible();
  await page.getByLabel('Contact status').selectOption('archived');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('No contacts match this view')).toBeVisible();
  await page.getByRole('button', { name: 'Import history', exact: true }).click();
  await expect(page.getByText('recruiters.csv', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View import' }).click();
  await expect(page.getByText('Import complete. 1 contacts saved.')).toBeVisible();
});

test('search, company filter, pagination and selection work on small screens', async ({
  page,
}, testInfo) => {
  await mockContacts(
    page,
    Array.from({ length: 26 }, (_, index) => ({
      id: String(index),
      email: `hr${index}@example.test`,
      hrName: `Recruiter ${index}`,
      companyName: index === 25 ? 'Elsewhere' : 'Acme',
      designation: 'Recruiter',
      version: 0,
      archivedAt: null,
    })),
  );
  await page.goto('/contacts');
  await expect(page.getByText(/26 records/)).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('hr25@example.test', { exact: true })).toBeVisible();
  await page.getByLabel('Select hr25@example.test').check();
  await page.getByLabel('Search contacts').fill('Recruiter 0');
  await expect(page.getByText(/1 records/)).toBeVisible();
  await expect(page.getByText('hr0@example.test', { exact: true })).toBeVisible();
  await page.getByLabel('Search contacts').fill('');
  await page.getByLabel('Company filter').selectOption('Acme');
  await expect(page.getByText(/25 records/)).toBeVisible();
  await page.getByLabel('Select all visible active contacts').check();
  await expect(page.getByText(/26 selected for a future campaign/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(page.getByText(/selected for a future campaign/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('contacts.png'), fullPage: true });
});
