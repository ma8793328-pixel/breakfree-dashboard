import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export function useHabitDetail(habitId, token) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!habitId) return;
    try {
      const d = await api(`/habits/${habitId}`, { token });
      setDetail(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [habitId, token]);

  useEffect(() => {
    setDetail(null);
    setLoading(true);
    load();
  }, [load]);

  return { detail, loading, error, reload: load };
}
