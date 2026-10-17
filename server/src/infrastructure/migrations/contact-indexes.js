import { Contact, ContactOwnerState } from '../../modules/contacts/contact.model.js';
import { ContactImport, ImportRow } from '../../modules/imports/import.model.js';

export async function createContactIndexes() {
  await Promise.all([
    Contact.createIndexes(),
    ContactOwnerState.createIndexes(),
    ContactImport.createIndexes(),
    ImportRow.createIndexes(),
  ]);
}
