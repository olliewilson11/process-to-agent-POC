const gb = (digits) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const whole = gb(0);
const one = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const hours = (n) => `${whole.format(Math.round(n))} h`;
export const num = (n) => whole.format(Math.round(n));
export const fte = (n) => one.format(n);
export const pct = (n) => `${whole.format(Math.round(n * 100))}%`;

// Rounds money to two significant figures so estimates don't look more precise than they are.
export function money(n, symbol = '£') {
  if (!Number.isFinite(n) || n <= 0) return `${symbol}0`;
  if (n >= 1e6) return `${symbol}${(Math.round(n / 1e5) / 10).toLocaleString('en-GB')}m`;
  if (n >= 1e3) {
    const k = n / 1e3;
    const rounded = k >= 100 ? Math.round(k / 10) * 10 : k >= 10 ? Math.round(k) : Math.round(k * 10) / 10;
    return `${symbol}${rounded.toLocaleString('en-GB')}k`;
  }
  return `${symbol}${Math.round(n / 10) * 10}`;
}
