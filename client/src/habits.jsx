import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { api } from './api.js';

const HabitContext = createContext(null);

export function HabitProvider({ children }) {
  const { token } = useAuth();
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(() => localStorage.getItem('bf_active_habit') || null);

  async function refresh() {
    const data = await api('/habits', { token });
    setHabits(data.habits);
    return data.habits;
  }

  useEffect(() => {
    let active = true;
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    refresh()
      .then((list) => {
        if (!active) return;
        if (list.length > 0 && !list.some((h) => h.id === activeId)) {
          setActiveId(list[0].id);
          localStorage.setItem('bf_active_habit', String(list[0].id));
        }
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const active = habits.find((h) => h.id === activeId) || habits[0] || null;

  function select(id) {
    setActiveId(id);
    localStorage.setItem('bf_active_habit', String(id));
  }

  function upsertHabit(habit) {
    setHabits((prev) => {
      const exists = prev.some((h) => h.id === habit.id);
      const next = exists ? prev.map((h) => (h.id === habit.id ? habit : h)) : [...prev, habit];
      return next;
    });
  }

  function removeHabit(id) {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    if (activeId === id) {
      setActiveId(null);
      localStorage.removeItem('bf_active_habit');
    }
  }

  return (
    <HabitContext.Provider
      value={{ habits, active, loading, error, refresh, select, activeId, upsertHabit, removeHabit }}
    >
      {children}
    </HabitContext.Provider>
  );
}

export function useHabits() {
  return useContext(HabitContext);
}
