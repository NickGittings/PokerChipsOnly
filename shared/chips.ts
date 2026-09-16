import type { Denomination } from './types';
export const CHIP_COLORS = ['#F2EDE3', '#C0392B', '#2C6E6E', '#3E8E5A', '#2B2B2B', '#7B4FA8', '#D2622A', '#D4AF6A'];
export const money = (n: number) => '$' + n.toLocaleString('en-US');
export function chipUnit(ds: Denomination[]) { return Math.min(...ds.map(d => d.value)); }
const cache = new Map<string, { counts: Int32Array; choices: Int32Array }>();
export function breakdown(amount: number, ds: Denomination[]): (Denomination & { count: number })[] {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000 || !ds.length) return [];
  const sorted = [...ds].sort((a, b) => b.value - a.value);
  if (sorted.some(d => !Number.isSafeInteger(d.value) || d.value <= 0)) return [];
  const unit = chipUnit(ds);
  if (amount % unit || sorted.some(d => d.value % unit)) return [];
  const canonical = sorted.every((d, i) => i === sorted.length - 1 || d.value % sorted[i + 1].value === 0);
  let remaining = amount;
  if (canonical) return sorted.map(d => { const count = Math.floor(remaining / d.value); remaining %= d.value; return { ...d, count }; }).filter(d => d.count);
  const values = sorted.map(d => d.value / unit), target = amount / unit, key = values.join(',');
  let memo = cache.get(key);
  if (!memo || memo.counts.length <= target) {
    const counts = new Int32Array(target + 1).fill(1_000_001), choices = new Int32Array(target + 1).fill(-1); counts[0] = 0;
    for (let a = 1; a <= target; a++) for (let i = 0; i < values.length; i++) if (a >= values[i] && counts[a - values[i]] + 1 < counts[a]) { counts[a] = counts[a - values[i]] + 1; choices[a] = i; }
    memo = { counts, choices }; if (cache.size > 16) cache.clear(); cache.set(key, memo);
  }
  const result = sorted.map(d => ({ ...d, count: 0 }));
  for (let a = target; a > 0;) { const i = memo.choices[a]; if (i < 0) return []; result[i].count++; a -= values[i]; }
  return result.filter(d => d.count);
}
export function isMakeable(amount: number, ds: Denomination[]) { return Number.isSafeInteger(amount) && amount >= 0 && amount % chipUnit(ds) === 0; }
