import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { expect, test } from '@playwright/test';
import { AuthRateLimit } from '../../server/src/modules/auth/auth-rate-limit.model.js';
import { Session } from '../../server/src/modules/auth/session.model.js';
import { User } from '../../server/src/modules/auth/user.model.js';
import { Contact, ContactOwnerState } from '../../server/src/modules/contacts/contact.model.js';
import { ContactImport, ImportRow } from '../../server/src/modules/imports/import.model.js';

function requireIsolatedReplicaSet(uri) {
  if (!uri) throw new Error('Set TEST_MONGODB_URI to a dedicated local test replica set.');
  const parsed = new URL(uri);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) ||
    !/_test$/iu.test(databaseName) ||
    !parsed.searchParams.has('replicaSet')
  ) {
    throw new Error('Live API browser tests require a local replica-set database ending in _test.');
  }
}

test('live browser-to-API registration, CSV import, contact lifecycle, ownership, and logout', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    process.env.RUN_LIVE_API_E2E !== 'true',
    'Set RUN_LIVE_API_E2E=true and point the API at an isolated test replica set.',
  );
  test.skip(testInfo.project.name !== 'desktop', 'Run the destructive live smoke once.');

  const testUri = process.env.TEST_MONGODB_URI;
  requireIsolatedReplicaSet(testUri);
  await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 });
  const identity = randomUUID();
  const email = `live-${identity}@example.test`;
  const otherEmail = `live-other-${identity}@example.test`;
  let ownerId;

  try {
    await page.goto('/register');
    await page.getByLabel('Name').fill('Live Smoke User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('a-live-smoke-passphrase');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status')).toContainText('registration was successful');
    ownerId = (await User.findOne({ email }).select('_id').lean())?._id;
    expect(ownerId).toBeTruthy();

    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('a-live-smoke-passphrase');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/u);
    await expect(page.getByText('Live Smoke User')).toBeVisible();
    await page.getByRole('link', { name: 'Contacts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible();

    const csvRows = [
      ['Recruiter Email', 'HR Name', 'Company', 'Designation'],
      ...Array.from({ length: 26 }, (_, index) => [
        `${identity.slice(0, 8)}-${String(index + 1).padStart(2, '0')}@example.test`,
        `Smoke Recruiter ${String(index + 1).padStart(2, '0')}`,
        index % 2 ? 'Smoke Company B' : 'Smoke Company A',
        'Recruiter',
      ]),
    ];
    csvRows.push(
      [csvRows[1][0].toUpperCase(), 'Duplicate row', 'Smoke Company A', 'Recruiter'],
      ['invalid-email', 'Invalid row', '', ''],
    );
    const csv = `${csvRows.map((row) => row.join(',')).join('\n')}\n`;

    await page.getByRole('button', { name: 'Import contacts', exact: true }).click();
    await page.getByLabel('Contact file').setInputFiles({
      name: 'live-smoke.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await page.getByRole('button', { name: 'Upload for mapping' }).click();
    await expect(page.getByRole('button', { name: 'Preview cleaned contacts' })).toBeEnabled();
    await page.getByRole('button', { name: 'Preview cleaned contacts' }).click();
    await expect(page.getByText('28 total data rows.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm and save 26 contacts' })).toBeEnabled();
    const stagedImport = await ContactImport.findOne({ userId: ownerId })
      .sort({ createdAt: -1 })
      .lean();
    expect(stagedImport?.status).toBe('preview');
    expect(stagedImport.counts).toMatchObject({ total: 28, valid: 26, duplicate: 1, invalid: 1 });
    expect(await Contact.countDocuments({ userId: ownerId })).toBe(0);

    const csrf = async (target) =>
      target.evaluate(async () => (await (await fetch('/api/v1/auth/csrf')).json()).data.csrfToken);
    const stalePreview = await page.evaluate(
      async ({ id, token }) => {
        const response = await fetch(`/api/v1/contact-imports/${id}/preview`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
          body: JSON.stringify({
            expectedVersion: 0,
            sheet: 'CSV',
            mapping: { email: 0, hrName: 1, companyName: 2, designation: 3 },
          }),
        });
        return response.status;
      },
      { id: String(stagedImport._id), token: await csrf(page) },
    );
    expect(stalePreview).toBe(409);

    await page.getByRole('button', { name: 'Confirm and save 26 contacts' }).click();
    await expect(page.getByText('Import complete. 26 contacts saved.')).toBeVisible();
    const persisted = await Contact.find({ userId: ownerId }).sort({ email: 1 }).lean();
    expect(persisted).toHaveLength(26);
    expect(persisted.every((contact) => contact.sourceImportId.equals(stagedImport._id))).toBe(
      true,
    );

    const repeatedCommit = await page.evaluate(
      async ({ id, token, expectedVersion }) => {
        const response = await fetch(`/api/v1/contact-imports/${id}/commit`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
          body: JSON.stringify({ expectedVersion }),
        });
        return { status: response.status, body: await response.json() };
      },
      {
        id: String(stagedImport._id),
        token: await csrf(page),
        expectedVersion: stagedImport.version,
      },
    );
    expect(repeatedCommit.status).toBe(200);
    expect(repeatedCommit.body.data.counts.saved).toBe(26);
    expect(await Contact.countDocuments({ userId: ownerId })).toBe(26);

    await page.getByRole('button', { name: 'Close import' }).click();
    await expect(page.getByText(/26 records · Page 1 of 2/u)).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText(/Page 2 of 2/u)).toBeVisible();
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await page.getByLabel('Company filter').selectOption('Smoke Company A');
    await expect(page.getByText(/13 records/u)).toBeVisible();
    await page.getByLabel('Company filter').selectOption('');

    const editedEmail = persisted[0].email;
    await page.getByLabel('Search contacts').fill(editedEmail);
    await expect(page.getByText(editedEmail, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Edit ${editedEmail}` }).click();
    await page
      .getByRole('form', { name: 'Edit contact' })
      .getByLabel('HR name')
      .fill('Edited by live smoke');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Edited by live smoke', { exact: true })).toBeVisible();
    const edited = await Contact.findOne({ userId: ownerId, email: editedEmail }).lean();
    expect(edited.hrName).toBe('Edited by live smoke');
    expect(edited.version).toBe(1);

    const foreignPage = await browser.newPage();
    try {
      await foreignPage.goto('/register');
      await foreignPage.getByLabel('Name').fill('Other Live User');
      await foreignPage.getByLabel('Email').fill(otherEmail);
      await foreignPage.getByLabel('Password').fill('another-live-passphrase');
      await foreignPage.getByRole('button', { name: 'Create account' }).click();
      await expect(foreignPage.getByRole('status')).toContainText('registration was successful');
      await foreignPage.getByRole('link', { name: 'Sign in', exact: true }).click();
      await foreignPage.getByLabel('Email').fill(otherEmail);
      await foreignPage.getByLabel('Password').fill('another-live-passphrase');
      await foreignPage.getByRole('button', { name: 'Sign in' }).click();
      await expect(foreignPage).toHaveURL(/\/dashboard$/u);
      const foreignStatus = await foreignPage.evaluate(
        async ({ id, contact }) => {
          const csrfResponse = await fetch('/api/v1/auth/csrf');
          const token = (await csrfResponse.json()).data.csrfToken;
          const response = await fetch(`/api/v1/contacts/${id}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
            body: JSON.stringify({
              expectedVersion: contact.version,
              email: contact.email,
              hrName: 'Unauthorized change',
              companyName: contact.companyName,
              designation: contact.designation,
            }),
          });
          return response.status;
        },
        { id: String(edited._id), contact: edited },
      );
      expect(foreignStatus).toBe(404);
    } finally {
      await foreignPage.close();
    }

    await page.getByRole('button', { name: `Delete ${editedEmail}` }).click();
    await page.getByRole('button', { name: 'Confirm delete' }).click();
    await expect(page.getByText('No contacts match this view')).toBeVisible();
    expect((await Contact.findById(edited._id).lean()).archivedAt).toBeTruthy();
    await page.getByLabel('Contact status').selectOption('archived');
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText('No contacts match this view')).toBeVisible();
    await page.getByLabel('Contact status').selectOption('active');
    await expect(page.getByText('Edited by live smoke', { exact: true })).toBeVisible();
    expect((await Contact.findById(edited._id).lean()).archivedAt).toBeNull();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/u);
    await page.goto('/contacts');
    await expect(page).toHaveURL(/\/login$/u);
  } finally {
    const testUsers = await User.find({ email: { $in: [email, otherEmail] } })
      .select('_id')
      .lean();
    const userIds = testUsers.map((user) => user._id);
    if (userIds.length) {
      await Contact.deleteMany({ userId: { $in: userIds } });
      await ImportRow.deleteMany({ userId: { $in: userIds } });
      await ContactImport.deleteMany({ userId: { $in: userIds } });
      await ContactOwnerState.deleteMany({ userId: { $in: userIds } });
      await Session.deleteMany({ userId: { $in: userIds } });
      await User.deleteMany({ _id: { $in: userIds } });
    }
    if (ownerId)
      await Session.deleteMany({ userId: ownerId });
    await AuthRateLimit.deleteMany({
      key: /^(csrf|register|login|login-account|logout|me|contacts:)/,
    });
    await mongoose.disconnect();
  }
});
