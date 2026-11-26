<script lang="ts">
  /**
   * Barra que flutua sobre o elemento selecionado (no lugar do antigo painel de propriedades).
   * Mostra só o que o tipo precisa. Cada mudança é confirmada com `commit` (um passo de desfazer).
   */
  import { AlignLeft, AlignCenter, AlignRight, Bold, Copy, Trash2, Link2 } from '@lucide/svelte';
  import type { El } from './doc';

  type Props = {
    el: El;
    zoom: number;
    commit: () => void;
    duplicate: () => void;
    remove: () => void;
  };
  let { el, zoom, commit, duplicate, remove }: Props = $props();

  const ALIGNS = [
    ['left', AlignLeft, 'Alinhar à esquerda'],
    ['center', AlignCenter, 'Centralizar'],
    ['right', AlignRight, 'Alinhar à direita'],
  ] as const;

  const hasText = $derived(['texto', 'bloco', 'secao', 'link'].includes(el.type));
  const hasFill = $derived(['bloco', 'secao', 'link'].includes(el.type));
  const hasRadius = $derived(['bloco', 'link', 'imagem'].includes(el.type));

  // Acima do elemento; se não couber (topo da página), logo abaixo dele.
  let top = $derived(el.y * zoom - 46 < 0 ? (el.y + el.h) * zoom + 8 : el.y * zoom - 46);
  let left = $derived(Math.max(0, el.x * zoom));

  function num(key: 'fontSize' | 'radius', e: Event, min: number, max: number) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(v)) el[key] = Math.min(max, Math.max(min, Math.round(v)));
    commit();
  }
</script>

<!-- Clicar na barra não tira a seleção (o canvas embaixo tira). -->
<div
  class="bar"
  style={`left:${left}px;top:${top}px`}
  role="toolbar"
  aria-label={`Ajustes de ${el.name}`}
  tabindex="-1"
  onpointerdown={(e) => e.stopPropagation()}
>
  {#if hasText}
    <label class="num" data-tip="Tamanho do texto">
      <span class="visually-hidden">Tamanho do texto</span>
      <input type="number" min="8" max="400" value={el.fontSize} onchange={(e) => num('fontSize', e, 8, 400)} />
    </label>
    <button
      class="ico"
      aria-pressed={el.fontWeight >= 600}
      aria-label="Negrito"
      data-tip="Negrito"
      onclick={() => {
        el.fontWeight = el.fontWeight >= 600 ? 400 : 700;
        commit();
      }}><Bold size={14} aria-hidden="true" /></button
    >
    {#each ALIGNS as [a, Icon, label] (a)}
      <button
        class="ico"
        aria-pressed={el.align === a}
        aria-label={label}
        data-tip={label}
        onclick={() => {
          el.align = a;
          commit();
        }}><Icon size={14} aria-hidden="true" /></button
      >
    {/each}
    <label class="swatch" data-tip="Cor do texto">
      <span class="visually-hidden">Cor do texto</span>
      <span class="chip text" style={`--c:${el.color}`}>A</span>
      <input type="color" value={el.color} oninput={(e) => (el.color = e.currentTarget.value)} onchange={commit} />
    </label>
  {/if}

  {#if hasFill}
    <span class="sep"></span>
    <label class="swatch" data-tip="Cor de fundo">
      <span class="visually-hidden">Cor de fundo</span>
      <span class="chip" style={`--c:${el.fill || 'transparent'}`}></span>
      <input type="color" value={el.fill || '#ffffff'} oninput={(e) => (el.fill = e.currentTarget.value)} onchange={commit} />
    </label>
  {/if}

  {#if hasRadius}
    <label class="num" data-tip="Cantos arredondados">
      <span class="visually-hidden">Cantos arredondados</span>
      <span class="unit" aria-hidden="true">◜</span>
      <input type="number" min="0" max="999" value={el.radius} onchange={(e) => num('radius', e, 0, 999)} />
    </label>
  {/if}

  {#if el.type === 'link'}
    <span class="sep"></span>
    <label class="url" data-tip="Endereço do link">
      <Link2 size={13} aria-hidden="true" />
      <span class="visually-hidden">Endereço do link</span>
      <input
        type="url"
        placeholder="https://"
        value={el.href ?? ''}
        onchange={(e) => {
          el.href = e.currentTarget.value.trim();
          commit();
        }}
      />
    </label>
  {/if}

  {#if el.type === 'imagem'}
    <span class="sep"></span>
    <div class="seg-mini" role="group" aria-label="Ajuste da imagem">
      <button aria-pressed={(el.fit ?? 'cover') === 'cover'} onclick={() => ((el.fit = 'cover'), commit())}>Preencher</button>
      <button aria-pressed={el.fit === 'contain'} onclick={() => ((el.fit = 'contain'), commit())}>Caber</button>
    </div>
  {/if}

  <span class="sep"></span>
  <button class="ico" aria-label="Duplicar (Ctrl D)" data-tip="Duplicar (Ctrl D)" onclick={duplicate}><Copy size={14} aria-hidden="true" /></button>
  <button class="ico" aria-label="Excluir (Delete)" data-tip="Excluir (Delete)" onclick={remove}><Trash2 size={14} aria-hidden="true" /></button>
</div>

<style>
  .bar {
    position: absolute;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: #141414;
    box-shadow:
      0 0 0 1px rgb(255 255 255 / 0.04),
      0 8px 24px rgb(0 0 0 / 0.5);
    white-space: nowrap;
    color: var(--fg);
  }

  .ico {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .ico:hover,
  .ico[aria-pressed='true'] {
    background: #262626;
    color: var(--fg);
  }

  .num,
  .url {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 6px;
    border-radius: 7px;
    color: var(--muted);
  }

  .num:hover,
  .url:hover,
  .num:focus-within,
  .url:focus-within {
    background: #1f1f1f;
  }

  .num input {
    width: 40px;
    border: 0;
    background: transparent;
    color: var(--fg);
    font: 500 12px var(--font-mono);
    outline: none;
  }

  .url input {
    width: 170px;
    border: 0;
    background: transparent;
    color: var(--fg);
    font: 400 12px var(--font-text);
    outline: none;
  }

  .unit {
    font-size: 12px;
  }

  .swatch {
    position: relative;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    cursor: pointer;
  }

  .swatch:hover {
    background: #262626;
  }

  .chip {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.25);
  }

  /* Cor do texto: um "A" com uma faixa da cor embaixo. */
  .chip.text {
    display: grid;
    place-items: center;
    background: transparent;
    box-shadow: inset 0 -3px 0 var(--c);
    border-radius: 0;
    color: var(--fg);
    font: 600 12px var(--font-ui);
  }

  .swatch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .sep {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--line);
  }

  .seg-mini {
    display: flex;
    gap: 2px;
  }

  .seg-mini button {
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    font: 500 12px var(--font-ui);
    cursor: pointer;
  }

  .seg-mini button[aria-pressed='true'],
  .seg-mini button:hover {
    background: #262626;
    color: var(--fg);
  }
</style>
