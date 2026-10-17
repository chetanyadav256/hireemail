import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { healthResponseSchema } from '@hirereach/contracts';
import { Icon } from '../../components/Icon.jsx';
import { api, getApiErrorMessage } from '../../lib/api.js';

const steps = [
  {
    title: 'Bring your contacts',
    description: 'An organized starting point for your outreach.',
    icon: 'contacts',
    to: '/contacts',
  },
  {
    title: 'Tell your story',
    description: 'Keep your experience at the heart of every email.',
    icon: 'resume',
    to: '/resumes',
  },
  {
    title: 'Make a thoughtful introduction',
    description: 'Review every message before it leaves your inbox.',
    icon: 'campaigns',
    to: '/campaigns',
  },
];

function ConnectionStatus() {
  const [attempt, setAttempt] = useState(0);
  const [connection, setConnection] = useState({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      try {
        const response = await api.get('/health/ready', { signal: controller.signal });
        healthResponseSchema.parse(response.data);
        if (!controller.signal.aborted) setConnection({ status: 'ready' });
      } catch (error) {
        if (!controller.signal.aborted)
          setConnection({ status: 'offline', message: getApiErrorMessage(error) });
      }
    }
    void check();
    return () => controller.abort();
  }, [attempt]);

  return (
    <section className="panel p-6" aria-label="Workspace connection">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Workspace connection</h2>
        <span
          className={`h-2 w-2 rounded-full ${connection.status === 'ready' ? 'bg-teal-500' : 'bg-amber-400'}`}
        />
      </div>
      <div className="mt-4" role="status" aria-live="polite">
        <p className="text-sm font-medium">
          {connection.status === 'loading'
            ? 'Checking connection…'
            : connection.status === 'ready'
              ? 'API and database connected'
              : 'Connection unavailable'}
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          {connection.status === 'ready'
            ? 'The workspace is ready for the next milestone.'
            : connection.status === 'loading'
              ? 'Checking that your workspace can reach the server.'
              : connection.message}
        </p>
      </div>
      <button
        className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-teal-700 disabled:opacity-50"
        disabled={connection.status === 'loading'}
        onClick={() => {
          setConnection({ status: 'loading' });
          setAttempt((value) => value + 1);
        }}
      >
        <Icon name="refresh" className="h-4 w-4" />
        Check again
      </button>
    </section>
  );
}

export function DashboardPage() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">A MORE PERSONAL WAY FORWARD</p>
          <h1 className="page-title">Your next chapter starts here.</h1>
          <p className="mt-3 text-sm text-slate-500">
            A calmer, more intentional workspace for your job search.
          </p>
        </div>
        <span className="text-xs text-slate-400">Workspace overview</span>
      </div>

      <section className="hero-panel mt-8 overflow-hidden rounded-2xl px-7 py-8 sm:px-9">
        <div className="relative z-10 max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-teal-100">
            <span className="h-1 w-1 rounded-full bg-teal-200" />
            Built around your experience
          </span>
          <h2 className="mt-5 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            Good opportunities start
            <br />
            with a genuine introduction.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">
            Keep your contacts, experience, and outreach in one place. You stay in control of every
            message.
          </p>
          <Link
            to="/contacts"
            className="mt-6 inline-flex items-center gap-3 rounded-lg bg-teal-300 px-4 py-2.5 text-xs font-bold text-slate-900 hover:bg-teal-200"
          >
            Explore your workspace <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <Icon name="campaigns" className="h-16 w-16 text-teal-200/60" />
        </div>
      </section>

      <div className="mt-7 grid gap-4 sm:grid-cols-3">
        {[
          ['Contacts', 'contacts', 'Your future connections'],
          ['Campaigns', 'campaigns', 'Your outreach, organized'],
          ['Emails sent', 'check', 'Always with your approval'],
        ].map(([label, icon, caption]) => (
          <section className="panel p-5" key={label}>
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-slate-500">{label}</h2>
              <Icon name={icon} className="h-4 w-4 text-teal-600" />
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight">—</p>
            <p className="mt-2 text-xs text-slate-400">{caption}</p>
          </section>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-slate-400">
        Preview only. Activity totals will appear when these features are available.
      </p>

      <div className="mt-8 grid items-start gap-6 xl:grid-cols-[1fr_300px]">
        <section className="panel">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="font-semibold">A simple path to your next opportunity</h2>
            <p className="mt-1 text-xs text-slate-500">
              A look at what your workspace will help you do.
            </p>
          </div>
          <div className="divide-y divide-slate-100 px-6">
            {steps.map((step, index) => (
              <Link className="group flex items-center gap-4 py-5" key={step.to} to={step.to}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-teal-700">
                  <Icon name={step.icon} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    <span className="mr-2 text-slate-400">0{index + 1}</span>
                    {step.title}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{step.description}</p>
                </div>
                <Icon
                  name="arrow"
                  className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-teal-600"
                />
              </Link>
            ))}
          </div>
        </section>
        <div className="space-y-5">
          <ConnectionStatus />
          <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-5">
            <p className="text-xs font-semibold text-teal-900">Personal by design.</p>
            <p className="mt-2 text-xs leading-5 text-teal-800/80">
              The planned workflow puts review and approval before every send. Outreach is not
              enabled in this preview.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
