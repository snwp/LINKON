<script lang="ts">
  /**
   * Transitions.dev — Tooltip open/close: uma dica só para o app inteiro. Aparece sobre qualquer elemento com
   * `data-tip` depois de 80 ms e, já aberta, viaja até o próximo botão em vez de sumir e reaparecer.
   */
  let text = $state('');
  let show = $state(false);
  let x = $state(0);
  let y = $state(0);
  let tip: HTMLDivElement | undefined = $state();

  function place(target: HTMLElement) {
    const r = target.getBoundingClientRect();
    text = target.dataset.tip ?? '';
    requestAnimationFrame(() => {
      const w = tip?.offsetWidth ?? 0;
      const h = tip?.offsetHeight ?? 0;
      x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      // Em cima do botão; se não couber, embaixo.
      y = r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8;
      // Fechada, a dica pula para o lugar sem viajar; só depois aparece.
      if (show) return;
      requestAnimationFrame(() => (show = true));
    });
  }

  function over(e: PointerEvent) {
    const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
    if (t && e.pointerType !== 'touch') place(t);
    else show = false;
  }

  function hide() {
    show = false;
  }
</script>

<svelte:document onpointerover={over} onpointerdown={hide} onfocusin={(e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
  if (t && t.matches(':focus-visible')) place(t);
}} onfocusout={hide} onkeydown={(e) => e.key === 'Escape' && hide()} />

<div class="t-tt" class:snap={!show} bind:this={tip} data-show={show && !!text} role="tooltip" aria-hidden="true" style={`translate:${x}px ${y}px`}>
  {text}
</div>
