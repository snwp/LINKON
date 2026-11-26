<script lang="ts">
  // Uso da IA pelo Linkon: hoje, esta semana (segunda a hoje) e os últimos 7 dias. Dados em lib/usage.ts.
  import { loadUsage, sum, dayStart, weekStart, type UsageRec } from '$lib/usage';
  import { AI_MODELS } from '$lib/editor/assistant';

  const recs: UsageRec[] = loadUsage();
  const now = Date.now();
  const today = dayStart(now);

  const todaySum = sum(recs.filter((r) => r.at >= today));
  const weekSum = sum(recs.filter((r) => r.at >= weekStart(now)));
  const KPIS = [
    ['Hoje', todaySum],
    ['Esta semana', weekSum],
  ] as const;

  const fmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const tokens = (n: number) => fmt.format(n);
  function time(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  // Últimos 7 dias, do mais antigo ao de hoje. Barra = tokens (entrada embaixo, saída em cima), na mesma escala.
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    const start = d.getTime();
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    const s = sum(recs.filter((r) => r.at >= start && r.at < next.getTime()));
    return {
      label: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
      date: d.getDate(),
      isToday: start === today,
      ...s,
    };
  });
  const max = Math.max(1, ...days.map((d) => d.input + d.output));

  const modelName = (id: string) => AI_MODELS.find((m) => m.id === id)?.name ?? (id || 'Padrão');
  const byModel = Object.entries(
    recs
      .filter((r) => r.at >= weekStart(now))
      .reduce<Record<string, number>>((acc, r) => ((acc[r.model] = (acc[r.model] ?? 0) + r.input + r.output), acc), {}),
  ).sort((a, b) => b[1] - a[1]);
  const modelMax = Math.max(1, ...byModel.map(([, n]) => n));
</script>

<div class="usage">
  <h1>Uso</h1>

  <div class="kpis">
    {#each KPIS as [label, s] (label)}
      <section class="kpi" aria-label={label}>
        <h2>{label}</h2>
        <p class="big mono">{tokens(s.input + s.output)} <span>tokens</span></p>
        <dl>
          <div><dt>Pedidos</dt><dd class="mono">{s.requests}</dd></div>
          <div><dt>Entrada</dt><dd class="mono">{tokens(s.input)}</dd></div>
          <div><dt>Saída</dt><dd class="mono">{tokens(s.output)}</dd></div>
          <div><dt>Tempo</dt><dd class="mono">{time(s.ms)}</dd></div>
          {#if s.failed}<div><dt>Sem resposta</dt><dd class="mono">{s.failed}</dd></div>{/if}
        </dl>
      </section>
    {/each}
  </div>

  <section class="chart-box" aria-labelledby="u-dias">
    <div class="chart-head">
      <h2 id="u-dias">Últimos 7 dias</h2>
      <span class="legend"><i class="sw out"></i>Saída <i class="sw in"></i>Entrada</span>
    </div>
    <ol class="chart">
      {#each days as d (d.label + d.date)}
        <li class:today={d.isToday}>
          <span class="val mono">{d.input + d.output ? tokens(d.input + d.output) : ''}</span>
          <span class="bar" style={`height:${((d.input + d.output) / max) * 100}%`} title={`${d.requests} pedidos · ${tokens(d.input)} entrada · ${tokens(d.output)} saída`}>
            <span class="out" style={`height:${d.input + d.output ? (d.output / (d.input + d.output)) * 100 : 0}%`}></span>
          </span>
          <span class="day">{d.label} {d.date}</span>
        </li>
      {/each}
    </ol>
  </section>

  {#if byModel.length}
    <section class="models" aria-labelledby="u-modelos">
      <h2 id="u-modelos">Por modelo nesta semana</h2>
      <ul>
        {#each byModel as [id, n] (id)}
          <li>
            <span class="mname">{modelName(id)}</span>
            <span class="track"><span style={`width:${(n / modelMax) * 100}%`}></span></span>
            <span class="mono">{tokens(n)}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

</div>

<style>
  .usage {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
    max-width: 960px;
    padding: var(--s6) var(--s7) calc(var(--s6) + var(--dock-space, 0px));
  }

  h2 {
    font-size: 13px;
    color: var(--muted);
    font-weight: 500;
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s3);
  }

  .kpi {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s4) var(--s5);
    border: 1px solid var(--line);
    border-radius: 12px;
    background: #0c0c0c;
  }

  .big {
    margin: 0;
    font-size: 34px;
    letter-spacing: -0.02em;
    color: var(--fg);
  }

  .big span {
    font-size: 13px;
    color: var(--muted);
  }

  dl {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2) var(--s5);
    margin: 0;
  }

  dl div {
    display: flex;
    flex-direction: column-reverse;
  }

  dt {
    color: var(--muted);
    font-size: 11px;
  }

  dd {
    margin: 0;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }

  .chart-box {
    padding: var(--s4) var(--s5);
    border: 1px solid var(--line);
    border-radius: 12px;
    background: #0c0c0c;
  }

  .chart-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s3);
  }

  .legend {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 11px;
  }

  .sw {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }

  .sw.out,
  .bar .out {
    background: var(--fg);
  }

  .sw.in {
    margin-left: 8px;
    background: #4a4a4a;
  }

  .chart {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: var(--s3);
    height: 200px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chart li {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    align-items: end;
    justify-items: center;
    gap: 6px;
    min-width: 0;
  }

  .bar {
    display: flex;
    flex-direction: column;
    width: min(44px, 100%);
    min-height: 2px;
    align-self: end;
    border-radius: 4px 4px 0 0;
    background: #4a4a4a;
    overflow: hidden;
  }

  .val,
  .day {
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .today .day {
    color: var(--fg);
    font-weight: 600;
  }

  .models ul {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    margin: var(--s3) 0 0;
    padding: 0;
    list-style: none;
  }

  .models li {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr) 70px;
    align-items: center;
    gap: var(--s3);
    font-size: 13px;
  }

  .models .mono {
    text-align: right;
  }

  .track {
    height: 6px;
    border-radius: 3px;
    background: #1c1c1c;
    overflow: hidden;
  }

  .track span {
    display: block;
    height: 100%;
    background: var(--fg);
  }

</style>
