/** Format a USD amount as Thai baht. `rate` is THB per USD (from the server's USD_THB_RATE). */
export function formatThb(usd: number, rate: number): string {
  const thb = usd * rate;
  if (thb === 0) return "฿0";
  if (thb < 0.01) return "<฿0.01";
  const digits = thb < 10 ? 2 : thb < 1000 ? 1 : 0;
  return `฿${thb.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
