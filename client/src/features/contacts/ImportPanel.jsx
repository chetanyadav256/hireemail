import { useEffect, useState } from 'react';
import { contactFields } from '@hirereach/contracts';
import { api, getApiErrorMessage } from '../../lib/api.js';
import { useContactMutation } from './contact-api.js';
import { Counts, Pagination } from './ContactComponents.jsx';

const labels = {
  email: 'Email (required)',
  hrName: 'HR name',
  companyName: 'Company',
  designation: 'Designation',
};
export function ImportPanel({ importId, onClose, onSaved }) {
  const mutate = useContactMutation();
  const [file, setFile] = useState(null);
  const [record, setRecord] = useState(null);
  const [sheet, setSheet] = useState('');
  const [mapping, setMapping] = useState(
    Object.fromEntries(contactFields.map((field) => [field, null])),
  );
  const [dirty, setDirty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [rowPage, setRowPage] = useState(1);
  const [rowStatus, setRowStatus] = useState('all');
  const [rowsLoading, setRowsLoading] = useState(false);
  useEffect(() => {
    if (!importId) return;
    const controller = new AbortController();
    api
      .get(`/contact-imports/${importId}`, { signal: controller.signal })
      .then(({ data }) => {
        setRecord(data.data);
        setSheet(data.data.sheet || data.data.sheets[0].name);
        setMapping(
          data.data.mapping || Object.fromEntries(contactFields.map((field) => [field, null])),
        );
        setDirty(data.data.status === 'mapping');
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(getApiErrorMessage(failure));
      });
    return () => controller.abort();
  }, [importId]);
  useEffect(() => {
    if (!record || record.status === 'mapping' || record.expired) return;
    const controller = new AbortController();
    setRowsLoading(true);
    api
      .get(`/contact-imports/${record.id}/rows`, {
        params: { page: rowPage, status: rowStatus, limit: 25 },
        signal: controller.signal,
      })
      .then(({ data }) => {
        setRows(data.data);
        setMeta(data.meta);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setRows([]);
          setMeta(null);
          setError(getApiErrorMessage(failure));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRowsLoading(false);
      });
    return () => controller.abort();
  }, [record, rowPage, rowStatus]);
  async function perform(action) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(getApiErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  function upload(event) {
    event.preventDefault();
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('The file must be no larger than 5 MiB.');
      return;
    }
    void perform(async () => {
      const form = new FormData();
      form.append('file', file);
      const { data } = await mutate('post', '/contact-imports', form);
      setRecord(data.data);
      setSheet(data.data.sheets[0].name);
      setMapping(data.data.suggestedMapping);
      setDirty(true);
    });
  }
  function preview() {
    void perform(async () => {
      const { data } = await mutate('post', `/contact-imports/${record.id}/preview`, {
        expectedVersion: record.version,
        sheet,
        mapping,
      });
      setRecord(data.data);
      setDirty(false);
      setRowPage(1);
      setRowStatus('all');
    });
  }
  function commit() {
    void perform(async () => {
      const { data } = await mutate('post', `/contact-imports/${record.id}/commit`, {
        expectedVersion: record.version,
      });
      setRecord(data.data);
      onSaved();
    });
  }
  const finished = record?.status === 'completed';
  return (
    <section className="panel mt-6 p-5 sm:p-6" aria-label="Contact import">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">UPLOAD · MAP · REVIEW · SAVE</p>
          <h2 className="mt-2 text-lg font-semibold">
            {record ? record.filename : 'Import HR contacts'}
          </h2>
        </div>
        <button className="button-secondary" disabled={busy} onClick={onClose}>
          Close import
        </button>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        CSV, XLSX or XLS · Up to 5 MiB and 5,000 rows. Only email is required. Nothing is added to
        your contacts until you confirm.
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!record && !importId && (
        <form onSubmit={upload} className="mt-5 flex flex-wrap items-end gap-4">
          <label className="text-sm">
            Contact file
            <input
              className="contact-input mt-2"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(event) => setFile(event.target.files[0] || null)}
              disabled={busy}
            />
          </label>
          <button className="button-primary" disabled={busy}>
            {busy ? 'Reading file…' : 'Upload for mapping'}
          </button>
        </form>
      )}
      {record && !finished && !record.expired && (
        <div className="mt-5">
          <label className="text-xs font-medium">
            Worksheet
            <select
              className="contact-input mt-1 max-w-sm"
              value={sheet}
              disabled={busy}
              onChange={(event) => {
                setSheet(event.target.value);
                setMapping(Object.fromEntries(contactFields.map((field) => [field, null])));
                setDirty(true);
              }}
            >
              {record.sheets.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name} ({item.rowCount} rows)
                </option>
              ))}
            </select>
          </label>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {contactFields.map((field) => (
              <label className="text-xs font-medium" key={field}>
                {labels[field]}
                <select
                  aria-label={labels[field]}
                  className="contact-input mt-1"
                  value={mapping[field] ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    setMapping({
                      ...mapping,
                      [field]: event.target.value === '' ? null : Number(event.target.value),
                    });
                    setDirty(true);
                  }}
                >
                  <option value="">{field === 'email' ? 'Choose a column' : 'Not included'}</option>
                  {record.sheets
                    .find((item) => item.name === sheet)
                    ?.columns.map((column, index) => (
                      <option key={index} value={index}>
                        {column} (column {index + 1})
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
          <button
            className="button-secondary mt-4"
            onClick={preview}
            disabled={busy || mapping.email === null}
          >
            {busy ? 'Working…' : 'Preview cleaned contacts'}
          </button>
          {dirty && record.status === 'preview' && (
            <p className="mt-2 text-xs text-amber-800">
              Mapping changed. Refresh the preview before saving.
            </p>
          )}
        </div>
      )}
      {record?.expired && (
        <p className="mt-4 text-sm text-amber-800">
          Preview expired. Upload the source again to view rows or save contacts.
        </p>
      )}
      {record?.counts && (
        <div className="mt-6">
          <Counts counts={record.counts} />
          <p className="mt-3 text-xs text-slate-500">
            {record.counts.total} total data rows. Duplicates include deleted contacts. Email checks
            validate format, not mailbox deliverability.
          </p>
        </div>
      )}
      {record && record.status !== 'mapping' && !record.expired && (
        <div className="mt-5">
          <label className="text-xs font-medium">
            Preview filter
            <select
              className="contact-input mt-1 max-w-xs"
              value={rowStatus}
              onChange={(event) => {
                setRowStatus(event.target.value);
                setRowPage(1);
              }}
            >
              {['all', 'valid', 'invalid', 'duplicate', 'skipped'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  {['Row', 'Email', 'HR name', 'Company', 'Designation', 'Result'].map((label) => (
                    <th className="whitespace-nowrap border-b p-3 font-medium" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="p-3">{row.rowNumber}</td>
                    {['email', 'hrName', 'companyName', 'designation'].map((key) => (
                      <td className="max-w-56 break-words p-3" key={key}>
                        {row.cleaned?.[key] || row.values?.[key] || '—'}
                      </td>
                    ))}
                    <td className="p-3">
                      <span className="font-semibold capitalize">{row.status}</span>
                      {row.reason && (
                        <p className="mt-1 text-slate-500">
                          {row.reason.replaceAll('_', ' ').toLowerCase()}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rowsLoading && (
            <p role="status" className="py-3 text-sm">
              Loading preview…
            </p>
          )}
          {!rowsLoading && !rows.length && (
            <p className="py-3 text-sm text-slate-500">No rows match this filter.</p>
          )}
          <Pagination meta={meta} onPage={setRowPage} disabled={rowsLoading} />
        </div>
      )}
      {finished ? (
        <p role="status" className="mt-5 rounded-lg bg-teal-50 p-4 font-medium text-teal-900">
          Import complete. {record.counts.saved} contacts saved.
        </p>
      ) : (
        record?.status === 'preview' &&
        !record.expired && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <p className="mb-3 text-sm text-slate-600">
              Confirm the preview to save valid contacts. Duplicate checks run again when saving.
            </p>
            <button
              className="button-primary"
              disabled={busy || dirty || rowsLoading}
              onClick={commit}
            >
              {busy ? 'Saving…' : `Confirm and save ${record.counts.valid} contacts`}
            </button>
          </div>
        )
      )}
    </section>
  );
}
