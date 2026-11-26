<script lang="ts">
  import { ArrowUp, Crosshair } from '@lucide/svelte';
  import { dropdown } from '$lib/motion';
  import { t } from '$lib/i18n.svelte';

  type Props = {
    /** Posição na tela (clientX/clientY do clique). */
    x: number;
    y: number;
    /** O que foi marcado: nome do elemento ou "Ponto na página". */
    label: string;
    onsend: (text: string) => void;
    onclose: () => void;
  };
  let { x, y, label, onsend, onclose }: Props = $props();

  let text = $state('');
  const W = 360;
  const H = 150;
  let left = $derived(Math.max(8, Math.min(x, window.innerWidth - W - 8)));
  let top = $derived(Math.max(8, Math.min(y + 8, window.innerHeight - H - 8)));

  function send() {
    const ask = text.trim();
    if (ask) onsend(ask);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
    else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function autofocus(node: HTMLTextAreaElement) {
    node.focus();
  }
</script>

<!--
  Liquid glass: o fundo atrás do balão passa por este filtro (backdrop-filter: url(#…)), que desloca os pixels
  com um ruído bem suave, como luz atravessando vidro curvo. Funciona no motor do Chromium (o do app no Windows).
-->
<svg class="defs" aria-hidden="true" width="0" height="0">
  <filter id="linkon-liquid-glass" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="2" seed="11" result="noise" />
    <feGaussianBlur in="noise" stdDeviation="3" result="smooth" />
    <feDisplacementMap in="SourceGraphic" in2="smooth" scale="46" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>

<!-- Clicar fora fecha o balão. -->
<div class="backdrop" role="presentation" onpointerdown={onclose} oncontextmenu={(e) => { e.preventDefault(); onclose(); }}></div>
<div class="bubble" in:dropdown role="dialog" aria-label={t('Pedir à IA: {label}', { label })} style={`left:${left}px;top:${top}px;width:${W}px`}>
  <p class="target mono"><Crosshair size={12} aria-hidden="true" />{label}</p>
  <label class="visually-hidden" for="balao-pedido">{t('O que mudar aqui')}</label>
  <textarea id="balao-pedido" rows="3" placeholder={t('O que mudar aqui?')} bind:value={text} {onkeydown} use:autofocus></textarea>
  <button class="go" aria-label={t('Enviar')} data-tip={t('Enviar (Enter)')} onclick={send} disabled={!text.trim()}>
    <ArrowUp size={16} aria-hidden="true" />
  </button>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }

  .defs {
    position: absolute;
    width: 0;
    height: 0;
  }

  /*
   * Liquid glass: refração (filtro SVG) + leve desfoque e saturação, um tom escuro só para o texto branco
   * ler sobre página clara, e o brilho da luz na borda e no topo do vidro.
   */
  .bubble {
    position: fixed;
    z-index: 41;
    padding: var(--s3) var(--s3) var(--s2);
    border-radius: 18px;
    background: rgb(14 14 14 / 0.52);
    backdrop-filter: url(#linkon-liquid-glass) blur(5px) saturate(185%) brightness(0.85);
    border: 0;
    box-shadow:
      inset 1px 1px 0 color-mix(in srgb, var(--fg) 55%, transparent),
      inset -1px -1px 0 color-mix(in srgb, var(--fg) 16%, transparent),
      inset 0 0 22px color-mix(in srgb, var(--fg) 10%, transparent),
      0 2px 6px rgb(0 0 0 / 0.18),
      0 18px 44px rgb(0 0 0 / 0.38);
    overflow: hidden;
    /* Nasce do ponto clicado, como um balão que sai do cursor. */
    transform-origin: top left;
  }

  /* Reflexo de cima: a luz batendo na curva do vidro. */
  .bubble::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(180deg, color-mix(in srgb, var(--fg) 16%, transparent) 0%, color-mix(in srgb, var(--fg) 4%, transparent) 38%, transparent 60%);
    pointer-events: none;
  }

  /* Conteúdo acima do reflexo. */
  .target,
  textarea {
    position: relative;
  }

  @media (prefers-reduced-transparency: reduce) {
    .bubble {
      background: var(--card);
      backdrop-filter: none;
    }
  }

  .target {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 var(--s2);
    color: color-mix(in srgb, var(--fg) 72%, transparent);
    font-size: 11px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  textarea {
    display: block;
    width: 100%;
    resize: none;
    padding: 0 40px 0 0;
    border: 0;
    background: transparent;
    font: 400 15px/1.45 var(--font-text);
    outline: none;
  }

  textarea::placeholder {
    color: color-mix(in srgb, var(--fg) 70%, transparent);
  }

  .go {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 8px;
    background: var(--fg);
    color: var(--accent-ink);
    cursor: pointer;
  }

  .go:not(:disabled):hover {
    background: var(--accent);
  }

  .go:not(:disabled):active {
    transform: scale(0.94);
  }

  .go:disabled {
    background: color-mix(in srgb, var(--fg) 16.5%, var(--bg));
    color: var(--muted);
    opacity: 1;
    cursor: default;
  }
</style>
