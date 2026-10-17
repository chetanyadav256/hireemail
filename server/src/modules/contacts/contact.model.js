import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    email: { type: String, required: true, maxlength: 254 },
    emailKey: { type: String, required: true, maxlength: 254 },
    hrName: { type: String, default: '', maxlength: 200 },
    companyName: { type: String, default: '', maxlength: 200 },
    designation: { type: String, default: '', maxlength: 200 },
    sourceImportId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactImport', required: true },
    sourceRow: { type: Number, required: true },
    archivedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
    schemaVersion: { type: Number, default: 1 },
  },
  { timestamps: true, versionKey: false },
);
contactSchema.index(
  { userId: 1, emailKey: 1 },
  { unique: true, name: 'contact_owner_email_unique' },
);
contactSchema.index({ userId: 1, archivedAt: 1, _id: -1 });
contactSchema.index({ userId: 1, companyName: 1 });
contactSchema.index({ userId: 1, sourceImportId: 1 });
export const Contact = mongoose.models.Contact ?? mongoose.model('Contact', contactSchema);

// A transaction writes this row before contact/import mutations. Parallel imports,
// edits and deletes for one owner serialize without affecting other owners.
const stateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    revision: { type: Number, default: 0 },
  },
  { versionKey: false },
);
stateSchema.index({ userId: 1 }, { unique: true });
export const ContactOwnerState =
  mongoose.models.ContactOwnerState ?? mongoose.model('ContactOwnerState', stateSchema);
