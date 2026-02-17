const counters = {};

export function generateBoothId(floorLabel = 'A') {
  const prefix = floorLabel.charAt(0).toUpperCase();
  if (!counters[prefix]) counters[prefix] = 0;
  counters[prefix]++;
  return `${prefix}${String(counters[prefix]).padStart(3, '0')}`;
}

export function resetCounters() {
  Object.keys(counters).forEach(k => delete counters[k]);
}

export function setCounter(prefix, value) {
  counters[prefix] = value;
}
