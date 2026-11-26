<script lang="ts">
  /**
   * Bolinha, o mascote do Editor. Base geométrica: um círculo com dois olhos vazados.
   * Os olhos são furos (regra evenodd), então a Bolinha mostra o fundo em qualquer tema e herda a cor do texto.
   */
  let { size = 16 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" class="bolinha">
  <path
    fill="currentColor"
    fill-rule="evenodd"
    d="M24 10a16 16 0 1 0 0 32a16 16 0 1 0 0-32Z M17 23a2 2 0 0 1 4 0v3a2 2 0 0 1-4 0Z M27 23a2 2 0 0 1 4 0v3a2 2 0 0 1-4 0Z"
  />
</svg>

<style>
  .bolinha {
    display: block;
    flex: none;
  }
</style>
