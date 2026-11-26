<script lang="ts">
  import { api, type FileItem } from '$lib/api';
  import { bytes } from '$lib/format';
  import KindIcon from '$lib/KindIcon.svelte';

  type Props = { file: FileItem; selected?: boolean; href?: string; onselect?: () => void };
  let { file, selected = false, href, onselect }: Props = $props();

  let broken = $state(false);
</script>

{#snippet body()}
  <span class="thumb">
    {#if file.kind === 'imagem' && !broken}
      <!-- shortcut: usa a imagem original reduzida pelo navegador; gerar miniaturas no Rust quando a biblioteca ficar grande. -->
      <img src={api.fileUrl(file)} alt="" loading="lazy" decoding="async" onerror={() => (broken = true)} />
    {:else}
      <span class="icon"><KindIcon kind={file.kind} size={28} /></span>
      <span class="ext mono">{file.ext ? file.ext.toUpperCase() : 'ARQUIVO'}</span>
    {/if}
  </span>
  <span class="name" title={file.name}>{file.name}</span>
  <span class="meta mono">{file.ext ? file.ext.toUpperCase() : '—'} · {bytes(file.size)}</span>
{/snippet}

{#if href}
  <a class="tile" {href}>{@render body()}</a>
{:else}
  <button class="tile" class:selected aria-pressed={selected} onclick={onselect}>{@render body()}</button>
{/if}

<style>
  .tile {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: var(--s2);
    border: 1px solid transparent;
    border-radius: var(--r-md);
    background: transparent;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    content-visibility: auto;
    contain-intrinsic-size: auto 190px;
  }

  .tile:hover {
    background: var(--card);
  }

  .tile.selected {
    background: var(--card);
    border-color: var(--accent);
  }

  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 4 / 3;
    margin-bottom: 4px;
    border-radius: var(--r-sm);
    background: var(--panel);
    overflow: hidden;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .icon {
    color: var(--muted);
  }

  .ext {
    position: absolute;
    left: 8px;
    bottom: 6px;
    color: var(--muted);
    font-size: 11px;
  }

  .name {
    font-weight: 500;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    color: var(--muted);
    font-size: 11px;
  }
</style>
