import { breakdown, money } from '../../shared/chips';
import type { Denomination } from '../../shared/types';
export function Chip({ value, color, size = 48 }: { value: number; color: string; size?: number }) {
  const ink = color === '#F2EDE3' || color === '#D4AF6A' ? '#193b29' : '#fff';
  return <svg className="chip" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${money(value)} chip`}><circle cx="32" cy="32" r="30" fill={color}/><circle cx="32" cy="32" r="26" fill="none" stroke={ink} strokeWidth="6" strokeDasharray="6 10.33" opacity=".8"/><circle cx="32" cy="32" r="20" fill="none" stroke={ink} strokeWidth="1" opacity=".5"/><text x="32" y="36" textAnchor="middle" fill={ink} fontFamily="inherit" fontSize={value >= 10000 ? 10 : value >= 1000 ? 12 : 15} fontWeight="750">{value >= 1000 && value % 1000 === 0 ? `${value / 1000}k` : value}</text></svg>;
}
export function ChipBreakdown({ amount, denominations }: { amount: number; denominations: Denomination[] }) {
  const chips = breakdown(amount, denominations);
  return <span className="chip-breakdown" aria-label={`Chip breakdown for ${money(amount)}`}>{chips.length ? chips.map(d => <span key={d.value}><i style={{ background: d.color }}/>{d.count} × {money(d.value)}</span>) : <span>{amount === 0 ? 'No chips' : 'Amount needs change'}</span>}</span>;
}
export function ChipStack({ amount, denominations }: { amount: number; denominations: Denomination[] }) {
  return <div className="chip-stacks">{breakdown(amount, denominations).map(d => <div className="chip-column" key={d.value}><div className="chip-pile" style={{ height: 46 + Math.min(d.count - 1, 4) * 5 }}>{Array.from({ length: Math.min(d.count, 5) }, (_, i) => <span key={i} style={{ bottom: i * 5 }}><Chip {...d} size={46}/></span>)}</div><small>{d.count} × {money(d.value)}</small></div>)}</div>;
}
