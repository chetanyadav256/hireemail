import { Link } from 'react-router';
import { Icon } from './Icon.jsx';

export function PlaceholderPage({ title, description, icon, detail }) {
  return (
    <>
      <p className="eyebrow">YOUR WORKSPACE</p>
      <h1 className="page-title">{title}</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">{description}</p>
      <section className="panel mt-8 flex min-h-80 flex-col items-center justify-center px-6 py-14 text-center">
        <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
          <Icon name={icon} className="h-7 w-7" />
        </span>
        <span className="badge mb-4">Coming in a later milestone</span>
        <h2 className="text-lg font-semibold">A little groundwork, then your next step.</h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">{detail}</p>
        <Link className="button-secondary mt-7" to="/dashboard">
          Back to dashboard <Icon name="arrow" className="h-4 w-4" />
        </Link>
      </section>
    </>
  );
}
