<script lang="ts">
  /**
   * Barra que flutua sobre o elemento selecionado (no lugar do antigo painel de propriedades).
   * Mostra só o que o tipo precisa. Cada mudança é confirmada com `commit` (um passo de desfazer).
   */
  import { AlignLeft, AlignCenter, AlignRight, Bold, Copy, Trash2, Link2 } from '@lucide/svelte';
  import { FRAME_LINK, type El } from './doc';
  import { t } from '$lib/i18n.svelte';

  type Props = {
    el: El;
    zoom: number;
    commit: () => void;
    duplicate: () => void;
    remove: () => void;
    /** Quadros do site, para um link levar a outra tela. Vazio no mobile e quando só há a página inicial. */
    frames?: { id: string; name: string }[];
  };
  let { el, zoom, commit, duplicate, remove, frames = [] }: Props = $props();

  // Destino do link: um quadro (`quadro:<id>`) ou um endereço externo ('').
  let target = $derived(el.href?.startsWith(FRAME_LINK) ? el.href.slice(FRAME_LINK.length) : '');

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
  aria-label={t('Ajustes de {name}', { name: el.name })}
  tabindex="-1"
  onpointerdown={(e) => e.stopPropagation()}
>
  {#if hasText}
    <label class="num" data-tip={t('Tamanho do texto')}>
      <span class="visually-hidden">{t('Tamanho do texto')}</span>
      <input type="number" min="8" max="400" value={el.fontSize} onchange={(e) => num('fontSize', e, 8, 400)} />
    </label>
    <button
      class="ico"
      aria-pressed={el.fontWeight >= 600}
      aria-label={t('Negrito')}
      data-tip={t('Negrito')}
      onclick={() => {
        el.fontWeight = el.fontWeight >= 600 ? 400 : 700;
        commit();
      }}><Bold size={14} aria-hidden="true" /></button
    >
    {#each ALIGNS as [a, Icon, label] (a)}
      <button
        class="ico"
        aria-pressed={el.align === a}
        aria-label={t(label)}
        data-tip={t(label)}
        onclick={() => {
          el.align = a;
          commit();
        }}><Icon size={14} aria-hidden="true" /></button
      >
    {/each}
    <label class="swatch" data-tip={t('Cor do texto')}>
      <span class="visually-hidden">{t('Cor do texto')}</span>
      <span class="chip text" style={`--c:${el.color}`}>A</span>
      <input type="color" value={el.color} oninput={(e) => (el.color = e.currentTarget.value)} onchange={commit} />
    </label>
  {/if}

  {#if hasFill}
    <span class="sep"></span>
    <label class="swatch" data-tip={t('Cor de fundo')}>
      <span class="visually-hidden">{t('Cor de fundo')}</span>
      <span class="chip" style={`--c:${el.fill || 'transparent'}`}></span>
      <input type="color" value={el.fill || '#ffffff'} oninput={(e) => (el.fill = e.currentTarget.value)} onchange={commit} />
    </label>
  {/if}

  {#if hasRadius}
    <label class="num" data-tip={t('Cantos arredondados')}>
      <span class="visually-hidden">{t('Cantos arredondados')}</span>
      <span class="unit" aria-hidden="true">◜</span>
      <input type="number" min="0" max="999" value={el.radius} onchange={(e) => num('radius', e, 0, 999)} />
    </label>
  {/if}

  {#if el.type === 'link'}
    <span class="sep"></span>
    {#if frames.length > 1}
      <label class="url" data-tip={t('Para onde o link leva')}>
        <span class="visually-hidden">{t('Para onde o link leva')}</span>
        <select
          value={target}
          onchange={(e) => {
            const v = e.currentTarget.value;
            el.href = v ? FRAME_LINK + v : 'https://';
            commit();
          }}
        >
          <option value="">{t('Endereço externo')}</option>
          {#each frames as f (f.id)}
            <option value={f.id}>{f.name}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if !target}
    <label class="url" data-tip={t('Endereço do link')}>
      <Link2 size={13} aria-hidden="true" />
      <span class="visually-hidden">{t('Endereço do link')}</span>
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
  {/if}

  {#if el.type === 'imagem'}
    <span class="sep"></span>
    <div class="seg-mini" role="group" aria-label={t('Ajuste da imagem')}>
      <button aria-pressed={(el.fit ?? 'cover') === 'cover'} onclick={() => ((el.fit = 'cover'), commit())}>{t('Preencher')}</button>
      <button aria-pressed={el.fit === 'contain'} onclick={() => ((el.fit = 'contain'), commit())}>{t('Caber')}</button>
    </div>
  {/if}

  <span class="sep"></span>
  <button class="ico" aria-label={t('Duplicar (Ctrl D)')} data-tip={t('Duplicar (Ctrl D)')} onclick={duplicate}><Copy size={14} aria-hidden="true" /></button>
  <button class="ico" aria-label={t('Excluir (Delete)')} data-tip={t('Excluir (Delete)')} onclick={remove}><Trash2 size={14} aria-hidden="true" /></button>
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
    background: color-mix(in srgb, var(--fg) 7.8%, var(--bg));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--fg) 4%, transparent),
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
    background: color-mix(in srgb, var(--fg) 14.9%, var(--bg));
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
    background: color-mix(in srgb, var(--fg) 12.2%, var(--bg));
  }

  .num input {
    width: 40px;
    border: 0;
    background: transparent;
    color: var(--fg);
    font: 500 12px var(--font-mono);
    outline: none;
  }

  .url select {
    max-width: 160px;
    border: 0;
    background: transparent;
    color: var(--fg);
    font: 500 12px var(--font-ui);
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
    background: color-mix(in srgb, var(--fg) 14.9%, var(--bg));
  }

  .chip {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background: var(--c);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 25%, transparent);
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
    background: color-mix(in srgb, var(--fg) 14.9%, var(--bg));
    color: var(--fg);
  }
</style>
