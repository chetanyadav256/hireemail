import { useState } from 'react';
import { contactInputSchema } from '@hirereach/contracts';

export function Pagination({ meta, onPage, disabled = false }) {
  if (!meta) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500">
      <p>
        {meta.total} records · Page {meta.page} of {Math.max(1, meta.pages)}
      </p>
      <div className="flex gap-2">
        <button
          className="button-secondary"
          disabled={disabled || meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          Previous
        </button>
        <button
          className="button-secondary"
          disabled={disabled || meta.page >= meta.pages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
export function Counts({ counts }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {['valid', 'invalid', 'duplicate', 'skipped'].map((key) => (
        <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs capitalize text-slate-500">{key}</p>
          <p className="mt-1 text-xl font-semibold">{counts?.[key] ?? 0}</p>
        </div>
      ))}
    </div>
  );
}
export function ContactEditor({ contact, onSave, onCancel, busy, error }) {
  const [fields, setFields] = useState({
    email: contact.email,
    hrName: contact.hrName,
    companyName: contact.companyName,
    designation: contact.designation,
  });
  const [validation, setValidation] = useState('');
  function submit(event) {
    event.preventDefault();
    const result = contactInputSchema.safeParse(fields);
    if (!result.success) {
      setValidation(result.error.issues[0].message);
      return;
    }
    setValidation('');
    onSave({ ...result.data, expectedVersion: contact.version });
  }
  return (
    <form className="panel mt-6 p-6" onSubmit={submit} aria-label="Edit contact">
      <h2 className="font-semibold">Edit contact</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {[
          ['email', 'Email'],
          ['hrName', 'HR name'],
          ['companyName', 'Company'],
          ['designation', 'Designation'],
        ].map(([key, label]) => (
          <label key={key} className="text-xs font-medium">
            {label}
            <input
              className="contact-input mt-1"
              type={key === 'email' ? 'email' : 'text'}
              required={key === 'email'}
              maxLength={key === 'email' ? 254 : 200}
              value={fields[key]}
              onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      {(error || validation) && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error || validation}
        </p>
      )}
      <div className="mt-5 flex gap-3">
        <button className="button-primary" disabled={busy}>
          Save changes
        </button>
        <button className="button-secondary" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
