<script lang="ts">
  import { elementStyle, type Doc, type Scene3D } from './doc';

  /** Miniatura estática de um quadro (só desenho, sem interação). Corta embaixo em `maxHeight`. */
  let { doc, width, maxHeight }: { doc: Doc; width: number; maxHeight: number } = $props();
  let scale = $derived(width / doc.width);

  // O 3D vira imagem parada (nada de WebGL por miniatura); o runtime só carrega se a página tiver um objeto.
  let shots = $state<Record<string, string>>({});
  $effect(() => {
    for (const el of doc.elements) {
      if (el.type !== 'objeto3d' || !el.scene || el.hidden) continue;
      const w = Math.max(48, Math.round(el.w * scale * 2));
      const h = Math.max(48, Math.round(el.h * scale * 2));
      const id = el.id;
      const scene = $state.snapshot(el.scene) as Scene3D;
      import('$lib/runtime/scene3d').then((r) => r.snapshot3d(scene, w, h)).then((url) => (shots[id] = url));
    }
  });
</script>

<div class="thumb" style={`width:${width}px;height:${Math.min(maxHeight, doc.height * scale)}px`} aria-hidden="true">
  <div class="page" style={`width:${doc.width}px;height:${doc.height}px;background:${doc.background};transform:scale(${scale})`}>
    {#each doc.elements as el (el.id)}
      {#if !el.hidden}<div class="el" style={elementStyle(el)}>
        {#if el.type === 'objeto3d'}{#if shots[el.id]}<img src={shots[el.id]} alt="" />{/if}{:else}{el.type === 'imagem' ? '' : (el.text ?? '')}{/if}
      </div>{/if}
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

  .el img {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
