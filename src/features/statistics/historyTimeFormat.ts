export const formatTimeAgo = (timestamp: number) => {
  const now = Date.now();
  const diff = now - timestamp;
  const oneHour = 60 * 60 * 1000;

  if (diff < oneHour) {
    return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  }

  if (diff < 24 * oneHour) {
    return `${Math.floor(diff / oneHour)}h ago`;
  }

  return `${Math.floor(diff / (24 * oneHour))}d ago`;
};
