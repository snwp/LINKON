<script lang="ts">
  /**
   * Linke, o mascote do Editor. Base geométrica: um círculo com dois olhos vazados. O viewBox recorta o círculo rente, para ele ocupar todo o `size`.
   * Os olhos são furos (regra evenodd), então Linke mostra o fundo em qualquer tema e herda a cor do texto.
   */
  let { size = 16 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="8 8 32 32" aria-hidden="true" class="linke">
  <path
    fill="currentColor"
    fill-rule="evenodd"
    d="M24 10a16 16 0 1 0 0 32a16 16 0 1 0 0-32Z M17 23a2 2 0 0 1 4 0v3a2 2 0 0 1-4 0Z M27 23a2 2 0 0 1 4 0v3a2 2 0 0 1-4 0Z"
  />
</svg>

<style>
  .linke {
    display: block;
    flex: none;
  }
</style>
