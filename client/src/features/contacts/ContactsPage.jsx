import { useEffect, useState } from 'react';
import { api, getApiErrorMessage } from '../../lib/api.js';
import { Icon } from '../../components/Icon.jsx';
import { ContactEditor, Pagination } from './ContactComponents.jsx';
import { ImportPanel } from './ImportPanel.jsx';
import { useContactMutation } from './contact-api.js';

export function ContactsPage() {
  const mutate = useContactMutation();
  const [tab, setTab] = useState('contacts');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState({
    page: 1,
    limit: 25,
    search: '',
    status: 'active',
    company: '',
  });
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [importPanel, setImportPanel] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editError, setEditError] = useState('');
  useEffect(() => {
    const timer = setTimeout(
      () => setQuery((value) => (value.search === search ? value : { ...value, search, page: 1 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = tab === 'contacts' ? query : { page: query.page, limit: query.limit };
    Promise.all([
      api.get(tab === 'contacts' ? '/contacts' : '/contact-imports', {
        params,
        signal: controller.signal,
      }),
      api.get('/contacts/statistics', { signal: controller.signal }),
    ])
      .then(([list, statistics]) => {
        setItems(list.data.data);
        setMeta(list.data.meta);
        setStats(statistics.data.data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setError(getApiErrorMessage(failure));
          setItems([]);
          setMeta(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, tab, refresh]);
  function reload() {
    setRefresh((value) => value + 1);
  }
  function changeFilter(fields) {
    setQuery({ ...query, ...fields, page: 1 });
  }
  function select(id, value) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  async function save(fields) {
    setBusy(true);
    setEditError('');
    try {
      await mutate('patch', `/contacts/${editing.id}`, fields);
      setEditing(null);
      reload();
    } catch (failure) {
      setEditError(getApiErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function removeOrRestore(contact, restore = false) {
    setBusy(true);
    setError('');
    try {
      if (restore)
        await mutate('patch', `/contacts/${contact.id}`, {
          email: contact.email,
          hrName: contact.hrName,
          companyName: contact.companyName,
          designation: contact.designation,
          expectedVersion: contact.version,
          archived: false,
        });
      else await mutate('delete', `/contacts/${contact.id}`, { expectedVersion: contact.version });
      select(contact.id, false);
      setDeleting(null);
      reload();
    } catch (failure) {
      setError(getApiErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const visibleActive = tab === 'contacts' ? items.filter((item) => !item.archivedAt) : [];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow">YOUR NETWORK, ORGANIZED</p>
          <h1 className="page-title">Contacts</h1>
          <p className="mt-2 text-sm text-slate-500">
            Import, review, and keep your recruiter contacts in one place.
          </p>
        </div>
        <button className="button-primary" onClick={() => setImportPanel('new')}>
          <Icon name="contacts" className="h-4 w-4" />
          Import contacts
        </button>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Active contacts', stats?.active],
          ['Deleted contacts', stats?.archived],
          ['Imports (90 days)', stats?.imports],
          ['Duplicates (90 days)', stats?.duplicates],
        ].map(([label, value]) => (
          <div className="panel p-5" key={label}>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value ?? '—'}</p>
          </div>
        ))}
      </div>
      {importPanel && (
        <ImportPanel
          key={importPanel}
          importId={importPanel === 'new' ? null : importPanel}
          onClose={() => {
            setImportPanel(null);
            reload();
          }}
          onSaved={reload}
        />
      )}
      {editing && (
        <ContactEditor
          key={editing.id}
          contact={editing}
          onSave={save}
          onCancel={() => setEditing(null)}
          busy={busy}
          error={editError}
        />
      )}
      <section className="panel mt-6 overflow-hidden" aria-label="Contact dashboard">
        <div className="flex gap-5 border-b border-slate-100 px-5 pt-4">
          {[
            ['contacts', 'All contacts'],
            ['history', 'Import history'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`border-b-2 pb-4 text-sm font-semibold ${tab === value ? 'border-teal-600 text-teal-800' : 'border-transparent text-slate-500'}`}
              aria-pressed={tab === value}
              onClick={() => {
                setLoading(true);
                setItems([]);
                setMeta(null);
                setTab(value);
                setQuery({ ...query, page: 1 });
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'contacts' && (
          <div className="grid gap-3 p-5 sm:grid-cols-[1fr_150px_180px]">
            <label className="text-xs font-medium">
              Search contacts
              <input
                className="contact-input mt-1"
                placeholder="Name, email, or company"
                value={search}
                maxLength={100}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="text-xs font-medium">
              Contact status
              <select
                className="contact-input mt-1"
                value={query.status}
                onChange={(event) => changeFilter({ status: event.target.value })}
              >
                <option value="active">Active</option>
                <option value="archived">Deleted</option>
                <option value="all">All</option>
              </select>
            </label>
            <label className="text-xs font-medium">
              Company filter
              <select
                className="contact-input mt-1"
                value={query.company}
                onChange={(event) => changeFilter({ company: event.target.value })}
              >
                <option value="">All companies</option>
                {stats?.companies.map((company) => (
                  <option key={company}>{company}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        {error && (
          <div role="alert" className="mx-5 my-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button className="ml-3 underline" onClick={reload}>
              Retry
            </button>
          </div>
        )}
        {selected.size > 0 && (
          <div className="mx-5 mb-3 flex flex-wrap gap-3 rounded-lg bg-teal-50 p-3 text-xs text-teal-900">
            <p>
              {selected.size} selected for a future campaign. Selection is kept only while this page
              is open.
            </p>
            <button className="underline" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        )}
        {loading ? (
          <p role="status" className="p-8 text-sm text-slate-500">
            Loading {tab === 'contacts' ? 'contacts' : 'import history'}…
          </p>
        ) : !items.length ? (
          <div className="p-10 text-center">
            <h2 className="font-semibold">
              {tab === 'contacts' ? 'No contacts match this view' : 'No imports yet'}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              {tab === 'contacts'
                ? 'Try a different filter or import a contact file to get started.'
                : 'Your uploaded files and results will appear here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              {tab === 'contacts' ? (
                <>
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="p-4">
                        <input
                          type="checkbox"
                          aria-label="Select all visible active contacts"
                          disabled={!visibleActive.length}
                          checked={
                            visibleActive.length > 0 &&
                            visibleActive.every((item) => selected.has(item.id))
                          }
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSelected((previous) => {
                              const next = new Set(previous);
                              for (const item of visibleActive) {
                                if (checked) next.add(item.id);
                                else next.delete(item.id);
                              }
                              return next;
                            });
                          }}
                        />
                      </th>
                      {['Contact', 'Company', 'Designation', 'Actions'].map((label) => (
                        <th className="p-4 font-medium" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((contact) => (
                      <tr key={contact.id} className="border-t border-slate-100">
                        <td className="p-4">
                          <input
                            type="checkbox"
                            aria-label={`Select ${contact.email}`}
                            disabled={Boolean(contact.archivedAt)}
                            checked={selected.has(contact.id)}
                            onChange={(event) => select(contact.id, event.target.checked)}
                          />
                        </td>
                        <td className="max-w-72 break-words p-4">
                          <p className="font-medium">{contact.hrName || 'Name not provided'}</p>
                          <p className="mt-1 text-xs text-slate-500">{contact.email}</p>
                          {contact.archivedAt && (
                            <span className="text-xs text-amber-800">Deleted</span>
                          )}
                        </td>
                        <td className="max-w-52 break-words p-4">{contact.companyName || '—'}</td>
                        <td className="max-w-44 break-words p-4 text-slate-500">
                          {contact.designation || '—'}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-3 text-xs">
                            <button
                              disabled={busy}
                              className="font-semibold text-teal-700"
                              aria-label={`Edit ${contact.email}`}
                              onClick={() => {
                                setEditing(contact);
                                setEditError('');
                              }}
                            >
                              Edit
                            </button>
                            {contact.archivedAt ? (
                              <button
                                disabled={busy}
                                onClick={() => void removeOrRestore(contact, true)}
                              >
                                Restore
                              </button>
                            ) : deleting === contact.id ? (
                              <>
                                <button
                                  disabled={busy}
                                  className="text-red-700"
                                  onClick={() => void removeOrRestore(contact)}
                                >
                                  Confirm delete
                                </button>
                                <button onClick={() => setDeleting(null)}>Cancel</button>
                              </>
                            ) : (
                              <button
                                disabled={busy}
                                className="text-red-700"
                                aria-label={`Delete ${contact.email}`}
                                onClick={() => setDeleting(contact.id)}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              ) : (
                <>
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      {['File', 'Uploaded', 'Result', 'Counts', 'Actions'].map((label) => (
                        <th className="p-4 font-medium" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="max-w-60 break-words p-4 font-medium">{item.filename}</td>
                        <td className="whitespace-nowrap p-4 text-xs">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-4 text-xs">
                          {item.status === 'completed'
                            ? `${item.counts.saved} saved`
                            : item.expired
                              ? 'Expired'
                              : 'Awaiting review'}
                        </td>
                        <td className="p-4 text-xs text-slate-500">
                          {item.counts
                            ? `${item.counts.valid} valid · ${item.counts.invalid} invalid · ${item.counts.duplicate} duplicates · ${item.counts.skipped} skipped`
                            : 'Not mapped'}
                        </td>
                        <td className="p-4">
                          <button
                            className="text-xs font-semibold text-teal-700"
                            onClick={() => setImportPanel(item.id)}
                          >
                            View import
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </table>
          </div>
        )}
        <Pagination
          meta={meta}
          disabled={loading}
          onPage={(page) => setQuery({ ...query, page })}
        />
      </section>
    </>
  );
}
