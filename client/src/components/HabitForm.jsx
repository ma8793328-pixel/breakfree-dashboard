import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function HabitForm({ habit, onSaved, onCancel, submitLabel }) {
  const { token } = useAuth();
  const { upsertHabit, refresh } = useHabits();
  const navigate = useNavigate();
  const [name, setName] = useState(habit?.name || '');
  const [startDate, setStartDate] = useState(habit?.startDate || todayStr());
  const [dailyCost, setDailyCost] = useState(habit?.dailyCost != null ? String(habit.dailyCost) : '');
  const [dailyTime, setDailyTime] = useState(habit?.dailyTime != null ? String(habit.dailyTime) : '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const body = {
      name,
      startDate,
      dailyCost: dailyCost ? parseFloat(dailyCost) : null,
      dailyTime: dailyTime ? parseFloat(dailyTime) : null,
    };
    try {
      let result;
      if (habit) {
        result = await api(`/habits/${habit.id}`, { method: 'PATCH', token, body });
      } else {
        result = await api('/habits', { method: 'POST', token, body });
      }
      upsertHabit(result.habit);
      await refresh();
      onSaved?.(result.habit);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="h-name">What are you breaking free from?</label>
        <input
          id="h-name"
          placeholder="e.g. Smoking, scrolling, late-night snacking..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="h-start">Start date</label>
        <input
          id="h-start"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="h-cost">Daily cost (optional)</label>
        <div className="row">
          <input
            id="h-cost"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 10"
            value={dailyCost}
            onChange={(e) => setDailyCost(e.target.value)}
            style={{ flex: 1 }}
          />
          <span className="muted" style={{ alignSelf: 'center' }}>
            $ / day
          </span>
        </div>
        <p className="hint">What does the habit cost you each day? Seeing it add up is powerful.</p>
      </div>
      <div className="field">
        <label htmlFor="h-time">Daily time spent (optional)</label>
        <div className="row">
          <input
            id="h-time"
            type="number"
            min="0"
            step="0.5"
            placeholder="e.g. 2"
            value={dailyTime}
            onChange={(e) => setDailyTime(e.target.value)}
            style={{ flex: 1 }}
          />
          <span className="muted" style={{ alignSelf: 'center' }}>
            hrs / day
          </span>
        </div>
        <p className="hint">Roughly how much time does it eat each day?</p>
      </div>
      {error && (
        <p className="error-text">
          {error.message}
          {error.code === 'PLAN_LIMIT' && (
            <button
              type="button"
              className="chip"
              style={{ display: 'block', marginTop: 8 }}
              onClick={() => navigate('/app/premium')}
            >
              👑 Upgrade to add more
            </button>
          )}
        </p>
      )}
      <button className="btn btn-primary btn-block mt" type="submit" disabled={busy || !name.trim()}>
        {busy ? 'Saving...' : submitLabel || 'Save habit'}
      </button>
      {onCancel && (
        <button type="button" className="btn btn-ghost btn-block mt" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}
