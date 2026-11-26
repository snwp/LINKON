<script lang="ts">
  import { elementStyle, type Doc } from './doc';

  /** Miniatura estática de um quadro (só desenho, sem interação). Corta embaixo em `maxHeight`. */
  let { doc, width, maxHeight }: { doc: Doc; width: number; maxHeight: number } = $props();
  let scale = $derived(width / doc.width);
</script>

<div class="thumb" style={`width:${width}px;height:${Math.min(maxHeight, doc.height * scale)}px`} aria-hidden="true">
  <div class="page" style={`width:${doc.width}px;height:${doc.height}px;background:${doc.background};transform:scale(${scale})`}>
    {#each doc.elements as el (el.id)}
      {#if !el.hidden}<div class="el" style={elementStyle(el)}>{el.type === 'imagem' ? '' : (el.text ?? '')}</div>{/if}
    {/each}
  </div>
</div>

<style>
  .thumb {
    position: relative;
    overflow: hidden;
    flex: none;
    border-radius: var(--r-sm);
    background: #fff;
    pointer-events: none;
  }

  .page {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
  }

  .el {
    position: absolute;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
