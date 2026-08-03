const stores = {};

export function getMessages(habitId) {
  return stores[habitId] || [];
}

export function setMessages(habitId, messages) {
  stores[habitId] = messages;
}

export function clearAll() {
  Object.keys(stores).forEach((k) => delete stores[k]);
}
