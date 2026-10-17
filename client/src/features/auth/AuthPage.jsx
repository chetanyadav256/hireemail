import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  authUserResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
  registerResponseSchema,
} from '@hirereach/contracts';
import { useAuth } from './AuthContext.jsx';
import { api, getApiErrorMessage } from '../../lib/api.js';

function fieldErrors(issues) {
  return Object.fromEntries(
    issues.map((issue) => [issue.path[0], issue.message]),
  );
}

export function AuthPage({ mode }) {
  const registering = mode === 'register';
  const location = useLocation();
  const navigate = useNavigate();
  const { getCsrfToken, completeLogin } = useAuth();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setErrors({});
    setMessage('');
    const schema = registering ? registerRequestSchema : loginRequestSchema;
    const input = registering
      ? values
      : { email: values.email, password: values.password };
    const result = schema.safeParse(input);
    if (!result.success) {
      setErrors(fieldErrors(result.error.issues));
      return;
    }

    setBusy(true);
    try {
      const csrfToken = await getCsrfToken();
      const response = await api.post(`/auth/${mode}`, result.data, {
        headers: { 'X-CSRF-Token': csrfToken },
      });
      if (registering) {
        setMessage(registerResponseSchema.parse(response.data).data.message);
      } else {
        const authenticated = authUserResponseSchema.parse(response.data);
        completeLogin(authenticated.data.user);
        navigate('/dashboard', { replace: true });
      }
    } catch (error) {
      const serverFields = error.response?.data?.error?.fields;
      if (serverFields) {
        setErrors(Object.fromEntries(serverFields.map(({ field, message: detail }) => [field, detail])));
      } else {
        setMessage(getApiErrorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  function update(field, value) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setMessage('');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8fa] px-4 py-10">
      <section className="panel w-full max-w-md p-6 sm:p-9">
        <Link to="/login" className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="brand-mark">H</span>
          HireReach <span className="text-teal-700">AI</span>
        </Link>
        <p className="eyebrow mt-8">{registering ? 'GET STARTED' : 'WELCOME BACK'}</p>
        <h1 className="page-title">
          {registering ? 'Create your account' : 'Sign in to HireReach'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          {registering
            ? 'Create a private workspace for your thoughtful job outreach.'
            : 'Continue to your personal outreach workspace.'}
        </p>

        {location.state?.expired && (
          <p className="mt-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
            Your session expired. Please sign in again.
          </p>
        )}
        {message && (
          <p className="mt-5 rounded-lg bg-teal-50 p-3 text-sm text-teal-900" role="status">
            {message}
          </p>
        )}

        <form className="mt-7 space-y-4" onSubmit={submit} noValidate>
          {registering && (
            <label className="block text-sm font-medium text-slate-700">
              Name
              <input
                autoComplete="name"
                className="auth-input mt-2"
                value={values.name}
                onChange={(event) => update('name', event.target.value)}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'name-error' : undefined}
                required
              />
              {errors.name && <span className="auth-error" id="name-error">{errors.name}</span>}
            </label>
          )}
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              type="email"
              autoComplete="email"
              className="auth-input mt-2"
              value={values.email}
              onChange={(event) => update('email', event.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
              required
            />
            {errors.email && <span className="auth-error" id="email-error">{errors.email}</span>}
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              type="password"
              autoComplete={registering ? 'new-password' : 'current-password'}
              className="auth-input mt-2"
              value={values.password}
              onChange={(event) => update('password', event.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'password-error' : undefined}
              minLength={registering ? 12 : 1}
              maxLength={128}
              required
            />
            {errors.password && (
              <span className="auth-error" id="password-error">{errors.password}</span>
            )}
            {registering && (
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Use at least 12 characters.
              </span>
            )}
          </label>
          <button className="button-primary w-full" type="submit" disabled={busy}>
            {busy
              ? registering
                ? 'Creating account…'
                : 'Signing in…'
              : registering
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          {registering ? 'Already have an account? ' : 'New to HireReach? '}
          <Link
            className="font-semibold text-teal-800 underline-offset-4 hover:underline"
            to={registering ? '/login' : '/register'}
          >
            {registering ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </section>
    </main>
  );
}
