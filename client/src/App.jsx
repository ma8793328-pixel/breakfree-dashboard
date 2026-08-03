import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { HabitProvider } from './habits.jsx';
import { installErrorLogging, setErrorLogToken } from './errorLog.js';
import AuthPage from './pages/AuthPage.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CoachPage from './pages/CoachPage.jsx';
import UrgesPage from './pages/UrgesPage.jsx';
import JournalPage from './pages/JournalPage.jsx';
import StatsPage from './pages/StatsPage.jsx';
import HabitsPage from './pages/HabitsPage.jsx';
import DaysOutPage from './pages/DaysOutPage.jsx';
import HelpPage from './pages/HelpPage.jsx';
import CommunityPage from './pages/CommunityPage.jsx';
import ReportPage from './pages/ReportPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import HealthPage from './pages/HealthPage.jsx';
import LegalPage from './pages/LegalPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import UrgeToolsPage from './pages/UrgeToolsPage.jsx';

function RequireAuth() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true });
  }, [loading, user, navigate]);
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Warming things up...</p>
      </div>
    );
  }
  if (!user) return null;
  return <Outlet />;
}

function RequireGuest() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && user) navigate('/app', { replace: true });
  }, [loading, user, navigate]);
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Warming things up...</p>
      </div>
    );
  }
  if (user) return null;
  return <Outlet />;
}

function ErrorReporter() {
  const { token } = useAuth();
  useEffect(() => {
    setErrorLogToken(token);
    installErrorLogging();
  }, [token]);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <ErrorReporter />
      <HabitProvider>
        <BrowserRouter>
            <Routes>
              <Route element={<RequireGuest />}>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<AuthPage mode="login" />} />
                <Route path="/signup" element={<AuthPage mode="signup" />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/terms" element={<LegalPage kind="terms" />} />
                <Route path="/privacy" element={<LegalPage kind="privacy" />} />
              </Route>
              <Route element={<RequireAuth />}>
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/app" element={<Dashboard />} />
                <Route path="/app/coach" element={<CoachPage />} />
                <Route path="/app/urges" element={<UrgesPage />} />
                <Route path="/app/journal" element={<JournalPage />} />
                <Route path="/app/stats" element={<StatsPage />} />
                <Route path="/app/health" element={<HealthPage />} />
                <Route path="/app/habits" element={<HabitsPage />} />
                <Route path="/app/days-out" element={<DaysOutPage />} />
                <Route path="/app/help" element={<HelpPage />} />
                <Route path="/app/community" element={<CommunityPage />} />
                <Route path="/app/report" element={<ReportPage />} />
                <Route path="/app/settings" element={<SettingsPage />} />
                <Route path="/app/admin" element={<AdminPage />} />
                <Route path="/app/urge-tools" element={<UrgeToolsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/app" replace />} />
            </Routes>
          </BrowserRouter>
        </HabitProvider>
    </AuthProvider>
  );
}
