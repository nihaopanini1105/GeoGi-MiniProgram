const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');
const counterFile = path.join(dataDir, 'counters.json');

async function nextMonthlyId(prefix, isoTime) {
  const date = new Date(isoTime);
  const monthKey = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const key = `${prefix}-${monthKey}`;
  const counters = await readCounters();
  const next = Number(counters[key] || 0) + 1;
  counters[key] = next;
  await fs.promises.mkdir(dataDir, { recursive: true });
  await fs.promises.writeFile(counterFile, JSON.stringify(counters, null, 2));
  return `${prefix}-${monthKey}-${String(next).padStart(4, '0')}`;
}

async function readCounters() {
  try {
    const raw = await fs.promises.readFile(counterFile, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

module.exports = {
  nextMonthlyId
};
