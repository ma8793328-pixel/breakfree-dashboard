import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHabits } from '../habits.jsx';
import HabitForm from '../components/HabitForm.jsx';

export default function Onboarding() {
  const navigate = useNavigate();
  const { habits, loading, refresh } = useHabits();

  useEffect(() => {
    if (!loading && habits.length > 0) navigate('/app', { replace: true });
  }, [loading, habits, navigate]);

  async function onSaved() {
    await refresh();
    navigate('/app', { replace: true });
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="logo-row">
          <div className="logo-badge">🔥</div>
          <span className="logo-text">BreakFree</span>
        </div>
        <p className="tagline">Let's set up your first habit. You've already taken the hardest step.</p>
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Your habit</h3>
          <HabitForm onSaved={onSaved} submitLabel="Start my journey" />
        </div>
      </div>
    </div>
  );
}
