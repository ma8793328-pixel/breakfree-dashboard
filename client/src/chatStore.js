const stores = {};
const MAX_MESSAGES = 10;

export function getMessages(habitId) {
  return stores[habitId] || [];
}

export function setMessages(habitId, messages) {
  stores[habitId] = Array.isArray(messages) ? messages.slice(-MAX_MESSAGES) : [];
}

export function clearAll() {
  Object.keys(stores).forEach((k) => delete stores[k]);
}
