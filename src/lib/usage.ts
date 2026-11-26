/**
 * Uso da IA pelo Linkon: um registro por pedido feito ao Claude Code (tokens, tempo, modelo).
 * Fica neste computador, nos últimos 90 dias.
 * shortcut: guardado no armazenamento local do app, não no banco (não entra no backup); mover para o SQLite se precisar.
 */
export type UsageRec = { at: number; model: string; input: number; output: number; ms: number; ok: boolean };

const KEY = 'linkon.ai.usage';
const KEEP_MS = 90 * 24 * 60 * 60 * 1000;

export function loadUsage(): UsageRec[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(all) ? all.filter((r) => r && typeof r.at === 'number') : [];
  } catch {
    return [];
  }
}

export function recordUsage(r: UsageRec) {
  try {
    const keep = loadUsage().filter((x) => x.at > Date.now() - KEEP_MS);
    keep.push(r);
    localStorage.setItem(KEY, JSON.stringify(keep));
  } catch {
    // Sem armazenamento local, o pedido só não entra na conta.
  }
}

export type UsageSum = { requests: number; failed: number; input: number; output: number; ms: number };

export function sum(recs: UsageRec[]): UsageSum {
  return recs.reduce<UsageSum>(
    (s, r) => ({
      requests: s.requests + 1,
      failed: s.failed + (r.ok ? 0 : 1),
      input: s.input + r.input,
      output: s.output + r.output,
      ms: s.ms + r.ms,
    }),
    { requests: 0, failed: 0, input: 0, output: 0, ms: 0 },
  );
}

/** Meia-noite (hora local) do dia de `t`. */
export const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** Segunda-feira 00:00 da semana de `t` (semana começa na segunda, como no Brasil). */
export function weekStart(t: number): number {
  const d = new Date(dayStart(t));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
