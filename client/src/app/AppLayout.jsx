import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Icon } from '../components/Icon.jsx';
import { navigation } from './navigation.js';
import { useAuth } from '../features/auth/AuthContext.jsx';

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const currentPage =
    navigation.find((item) => item.to === location.pathname)?.label || 'Workspace';

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="flex items-center justify-between px-6 py-7">
          <Link to="/dashboard" className="flex items-center gap-3" aria-label="HireReach AI home">
            <span className="brand-mark">
              <Icon name="campaigns" className="h-5 w-5" />
            </span>
            <span className="text-lg font-bold tracking-tight">
              HireReach<span className="ml-1 text-teal-300">AI</span>
            </span>
          </Link>
          <button
            className="rounded-lg p-2 hover:bg-white/10 lg:hidden"
            aria-label="Toggle navigation"
            aria-controls="workspace-navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name="menu" />
          </button>
        </div>
        <nav
          id="workspace-navigation"
          aria-label="Main navigation"
          className={`${menuOpen ? 'block' : 'hidden'} px-4 pb-5 lg:block`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMenuOpen(false);
          }}
        >
          <p className="mb-3 px-3 text-[10px] font-semibold tracking-[0.2em] text-slate-400">
            WORKSPACE
          </p>
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
            >
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mx-5 mt-auto hidden border-t border-white/10 py-6 lg:block">
          <div className="flex items-center gap-2 text-xs font-medium text-teal-200">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />
            Thoughtful outreach starts here
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Your experience. Your voice.
            <br />
            Every message, your decision.
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex h-20 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 sm:px-9">
          <p className="hidden text-sm text-slate-500 sm:block">
            Workspace <span className="mx-2 text-slate-300">/</span>{' '}
            <span className="font-medium text-slate-800">{currentPage}</span>
          </p>
          <div className="flex items-center gap-4">
            <span className="max-w-28 truncate text-xs font-medium text-slate-700 sm:max-w-none sm:text-sm">
              {user.name}
            </span>
            <button
              className="button-secondary"
              disabled={loggingOut}
              onClick={async () => {
                setLogoutError('');
                setLoggingOut(true);
                try {
                  await logout();
                } catch {
                  setLogoutError('Unable to sign out. Check your connection and try again.');
                } finally {
                  setLoggingOut(false);
                }
              }}
            >
              {loggingOut ? 'Signing out…' : 'Log out'}
            </button>
          </div>
        </header>
        {logoutError && (
          <p className="bg-rose-50 px-5 py-3 text-sm text-rose-800 sm:px-9" role="alert">
            {logoutError}
          </p>
        )}
        <main
          id="main-content"
          className="mx-auto max-w-[1440px] px-5 py-8 sm:px-9 sm:py-10"
          tabIndex={-1}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
