import { Link, Navigate, Route, Routes } from 'react-router';
import { AuthPage } from '../features/auth/AuthPage.jsx';
import { GuestOnly, RequireAuth } from '../features/auth/AuthContext.jsx';
import { AppLayout } from './AppLayout.jsx';
import { DashboardPage } from '../features/dashboard/DashboardPage.jsx';
import { ContactsPage } from '../features/contacts/ContactsPage.jsx';
import { ResumePage } from '../features/resumes/ResumePage.jsx';
import { CampaignsPage } from '../features/campaigns/CampaignsPage.jsx';
import { SettingsPage } from '../features/settings/SettingsPage.jsx';

export function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="login" element={<AuthPage mode="login" />} />
        <Route path="register" element={<AuthPage mode="register" />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="resumes" element={<ResumePage />} />
        <Route path="resume" element={<Navigate to="/resumes" replace />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="*"
          element={
            <section className="panel p-8">
              <p className="eyebrow">404</p>
              <h1 className="page-title">Page not found</h1>
              <Link to="/dashboard" className="button-secondary mt-6">
                Back to dashboard
              </Link>
            </section>
          }
        />
        </Route>
      </Route>
    </Routes>
  );
}
