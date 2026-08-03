import { createContext, useContext } from 'react';

const SubscriptionContext = createContext({ premium: true, sub: null, loading: false, refresh: async () => null });

export function SubscriptionProvider({ children }) {
  return (
    <SubscriptionContext.Provider value={{ premium: true, sub: null, loading: false, refresh: async () => null }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
