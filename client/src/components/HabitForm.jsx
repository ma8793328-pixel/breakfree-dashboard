import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useHabits } from '../habits.jsx';

const TRIGGER_BUCKETS = ['Morning', 'Midday', 'Afternoon', 'Evening', 'Late night'];

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
  const [unitsPerDay, setUnitsPerDay] = useState(habit?.unitsPerDay != null ? String(habit.unitsPerDay) : '');
  const [triggerTimes, setTriggerTimes] = useState(habit?.triggerTimes || []);
  const [reason, setReason] = useState(habit?.reason || '');
  const [relapsePlan, setRelapsePlan] = useState(habit?.relapsePlan || '');
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
      unitsPerDay: unitsPerDay ? parseFloat(unitsPerDay) : null,
      triggerTimes,
      reason: reason.trim() || null,
      relapsePlan: relapsePlan.trim() || null,
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

  function toggleTrigger(t) {
    setTriggerTimes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
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
        <label htmlFor="h-units">How much a day? (optional)</label>
        <div className="row">
          <input
            id="h-units"
            type="number"
            min="0"
            step="1"
            placeholder="e.g. 10"
            value={unitsPerDay}
            onChange={(e) => setUnitsPerDay(e.target.value)}
            style={{ flex: 1 }}
          />
          <span className="muted" style={{ alignSelf: 'center' }}>
            per day
          </span>
        </div>
        <p className="hint">How many do you typically use in a day? We'll count every one you avoid.</p>
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
            £ / day
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
      <div className="field">
        <label>When do urges usually hit? (optional)</label>
        <div className="chip-row">
          {TRIGGER_BUCKETS.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${triggerTimes.includes(t) ? ' active' : ''}`}
              onClick={() => toggleTrigger(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="hint">Your coach uses this to warn you ahead of your peak moments.</p>
      </div>
      <div className="field">
        <label htmlFor="h-reason">Why are you doing this? (optional)</label>
        <textarea
          id="h-reason"
          placeholder="The life you're building — money, health, energy, the people you love..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          style={{ width: '100%', minHeight: 84, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 14, color: 'var(--cream)', padding: 12, fontFamily: 'var(--font-body)', fontSize: 14, resize: 'vertical' }}
        />
        <p className="hint">Your "why" is your anchor on the hard days. Your coach reads it too.</p>
      </div>
      <div className="field">
        <label htmlFor="h-relapse">What's your plan if you slip? (optional)</label>
        <textarea
          id="h-relapse"
          placeholder="e.g. I won't spiral — I'll delete the app, go for a walk, and log an honest check-in. One slip doesn't erase my streak."
          value={relapsePlan}
          onChange={(e) => setRelapsePlan(e.target.value)}
          maxLength={400}
          style={{ width: '100%', minHeight: 84, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 14, color: 'var(--cream)', padding: 12, fontFamily: 'var(--font-body)', fontSize: 14, resize: 'vertical' }}
        />
        <p className="hint">Written now (when you're strong), it'll be there for you in the hard moment.</p>
      </div>
      {error && (
        <p className="error-text">
          {error.message}
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
