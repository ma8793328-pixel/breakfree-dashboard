import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { api } from './api.js';

const SubscriptionContext = createContext(null);

export function SubscriptionProvider({ children }) {
  const { token } = useAuth();
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!token) {
      setSub(null);
      return null;
    }
    setLoading(true);
    try {
      const data = await api('/subscription', { token });
      setSub(data.subscription);
      return data.subscription;
    } catch {
      setSub(null);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const premium = Boolean(sub?.active);

  return (
    <SubscriptionContext.Provider value={{ sub, loading, premium, refresh }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
