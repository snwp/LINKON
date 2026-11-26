<script lang="ts">
  /**
   * Coluna do Claude no Editor (no lugar do antigo painel de propriedades).
   * Histórico com as ações em chips e caixa de pedido no desenho do "Prompt Bar"; carregador em grade do
   * "Loading State". Os dois vêm do Beautiful UI (beautifului.dev, licença MIT), em preto e branco.
   * Quem responde é o Claude Code logado neste computador (ver assistant.ts).
   */
  import { ArrowUp, Square, Plus, Crosshair, Check, PanelRightClose } from '@lucide/svelte';
  import { addFiles } from '$lib/store.svelte';
  import { logIn } from '$lib/motion';
  import type { LogEntry } from './assistant';
  import ModelPicker from '$lib/ModelPicker.svelte';
  import Linke from '$lib/Linke.svelte';
  import { t } from '$lib/i18n.svelte';

  type Props = {
    log: LogEntry[];
    running: boolean;
    startedAt: number;
    /** Pasta da página, para onde vão as imagens importadas. */
    projectId: number | null;
    onsend: (text: string) => void;
    oncancel: () => void;
    onminimize: () => void;
  };
  let { log, running, startedAt, projectId, onsend, oncancel, onminimize }: Props = $props();

  const SUGGESTIONS = [
    'Monte uma landing page para uma cafeteria',
    'Deixe os títulos maiores e mais fortes',
    'Organize os cartões em três colunas',
  ];

  let text = $state('');
  let now = $state(Date.now());
  let list: HTMLOListElement | undefined = $state();
  let input: HTMLTextAreaElement | undefined = $state();

  let elapsed = $derived(Math.max(0, (now - startedAt) / 1000).toFixed(1));

  /** Ações seguidas viram uma única linha de chips. */
  type Row = { kind: 'chips'; items: string[] } | LogEntry;
  let rows = $derived(
    log.reduce<Row[]>((acc, e) => {
      const last = acc[acc.length - 1];
      if (e.kind === 'action') {
        if (last && last.kind === 'chips') last.items.push(e.text);
        else acc.push({ kind: 'chips', items: [e.text] });
      } else acc.push(e);
      return acc;
    }, []),
  );

  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(timer);
  });

  // Acompanha o fim da conversa enquanto a página é montada.
  $effect(() => {
    void log.length;
    void running;
    list?.scrollTo({ top: list.scrollHeight });
  });

  // A caixa cresce com o texto até 8 linhas.
  $effect(() => {
    void text;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 8 * 20 + 10)}px`;
  });

  function send(msg = text) {
    const v = msg.trim();
    if (!v || running) return;
    onsend(v);
    text = '';
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<aside class="claude" aria-label="Linke" onpointerdown={(e) => e.stopPropagation()}>
  <header>
    <h2><Linke size={18} />Linke</h2>
    <button class="min" onclick={onminimize} aria-label={t('Minimizar Linke')} data-tip={t('Minimizar')}><PanelRightClose size={15} aria-hidden="true" /></button>
  </header>

  <ol class="log" bind:this={list} aria-live="polite">
    {#if log.length === 0}
      <li class="intro">
        <div class="suggest">
          {#each SUGGESTIONS as s (s)}
            <button onclick={() => send(t(s))} disabled={running}>{t(s)}</button>
          {/each}
        </div>
      </li>
    {/if}
    {#each rows as row, i (i)}
      <!-- Cada item novo (e cada chip novo) sobe 6 px e aparece; o que já estava não se mexe. -->
      {#if row.kind === 'chips'}
        <li class="chips-row" in:logIn|global>
          {#each row.items as item, j (j)}<span class="tool" in:logIn|global><Check size={11} aria-hidden="true" />{item}</span>{/each}
        </li>
      {:else}
        <li class={row.kind} in:logIn|global>
          {#if row.scope}<span class="scope mono"><Crosshair size={11} aria-hidden="true" />{row.scope}</span>{/if}
          {row.text}
        </li>
      {/if}
    {/each}
    {#if running}
      <li class="status" role="status">
        <span class="pixels" aria-hidden="true">
          {#each [90, 180, 270, 0, 90, 180, 90, 180, 270] as d, i (i)}<span style={`animation-delay:${d}ms`}></span>{/each}
        </span>
        <span class="breathe">{t('Montando')}</span>
        <span class="time mono">{elapsed}s</span>
      </li>
    {/if}
  </ol>

  <div class="compose">
    <div class="box">
      <label class="visually-hidden" for="claude-pedido">{t('Pedido para Linke')}</label>
      <textarea
        id="claude-pedido"
        bind:this={input}
        rows="2"
        placeholder={t('O que você quer criar ou mudar?')}
        bind:value={text}
        {onkeydown}
      ></textarea>
      <div class="row">
        <button class="ico" onclick={() => addFiles({ projectId })} aria-label={t('Importar imagens')} data-tip={t('Importar imagens')}>
          <Plus size={16} aria-hidden="true" />
        </button>
        <span class="spacer"></span>
        <ModelPicker id="claude-modelo" />
        {#if running}
          <button class="send stop" onclick={oncancel} aria-label={t('Parar')} data-tip={t('Parar')}><Square size={12} aria-hidden="true" /></button>
        {:else}
          <button class="send" onclick={() => send()} disabled={!text.trim()} aria-label={t('Enviar')} data-tip={t('Enviar (Enter)')}>
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        {/if}
      </div>
    </div>
  </div>
</aside>

<style>
  .claude {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--panel);
    border-left: 1px solid var(--line);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s2);
    padding: var(--s2) var(--s2) var(--s2) var(--s4);
    border-bottom: 1px solid var(--line);
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  .min {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .min:hover {
    background: color-mix(in srgb, var(--fg) 12.2%, var(--bg));
    color: var(--fg);
  }

  .log {
    flex: 1;
    min-height: 0;
    overflow: auto;
    list-style: none;
    margin: 0;
    padding: var(--s4);
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    font-size: 13px;
  }

  .log li {
    overflow-wrap: anywhere;
  }


  .suggest {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .suggest button {
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: transparent;
    color: var(--fg);
    font: 400 13px var(--font-text);
    text-align: left;
    cursor: pointer;
    transition:
      background-color 150ms,
      border-color 150ms,
      transform 100ms ease-out;
  }

  .suggest button:hover {
    background: color-mix(in srgb, var(--fg) 8.6%, var(--bg));
    border-color: color-mix(in srgb, var(--fg) 23.9%, var(--bg));
  }

  .suggest button:active {
    transform: scale(0.98);
  }

  .user {
    align-self: flex-end;
    max-width: 88%;
    padding: 7px 12px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--fg) 13.3%, var(--bg));
  }

  .scope {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
    color: var(--muted);
    font-size: 11px;
  }

  .ai {
    line-height: 1.55;
  }

  .chips-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tool {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    max-width: 100%;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--muted);
    font: 500 11.5px var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error {
    font-weight: 500;
    padding-left: var(--s2);
    border-left: 2px solid var(--fg);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .pixels {
    display: grid;
    grid-template-columns: repeat(3, 4px);
    gap: 1.5px;
  }

  .pixels span {
    width: 4px;
    height: 4px;
    border-radius: 1px;
    background: var(--fg);
    opacity: 0.15;
    animation: pixel-on 650ms ease-in-out infinite;
  }

  @keyframes pixel-on {
    50% {
      opacity: 1;
    }
  }

  .breathe {
    font-weight: 500;
    animation: breathe 1.4s ease-in-out infinite;
  }

  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }

  .time {
    color: var(--muted);
    font-size: 11px;
  }

  .compose {
    padding: var(--s3);
    border-top: 1px solid var(--line);
  }

  .box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: color-mix(in srgb, var(--fg) 7.8%, var(--bg));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--fg) 3%, transparent),
      0 1px 2px rgb(0 0 0 / 0.4);
    transition: border-color 150ms;
  }

  .box:focus-within {
    border-color: color-mix(in srgb, var(--fg) 29%, var(--bg));
  }

  textarea {
    display: block;
    width: 100%;
    min-height: 50px;
    padding: 5px 8px;
    border: 0;
    resize: none;
    background: transparent;
    font: 400 14px/20px var(--font-text);
    outline: none;
  }

  textarea::placeholder {
    color: var(--muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .spacer {
    flex: 1;
  }

  .ico,
  .send {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition:
      background-color 150ms,
      color 150ms,
      transform 150ms ease-out;
  }

  .ico:hover {
    background: color-mix(in srgb, var(--fg) 14.9%, var(--bg));
    color: var(--fg);
  }

  .send {
    background: var(--fg);
    color: var(--bg);
  }

  .send:disabled {
    background: color-mix(in srgb, var(--fg) 16.5%, var(--bg));
    color: var(--muted);
    cursor: default;
  }

  .ico:active,
  .send:not(:disabled):active {
    transform: scale(0.94);
  }




  @media (prefers-reduced-motion: reduce) {
    .pixels span,
    .breathe {
      animation: none;
    }
    .pixels span {
      opacity: 0.6;
    }
  }
</style>
