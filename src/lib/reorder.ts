/**
 * Arrastar para reordenar itens de uma grade (cartões de interface, pastas).
 * Ação usada em cada <li data-sort-key="id">. Com o ponteiro (funciona no app do Windows, onde o arrastar
 * nativo do HTML fica desligado). Clicar sem mover segue o link normalmente; depois de arrastar, o clique é ignorado.
 */
type Opts = { key: number; onDrop: (from: number, to: number, after: boolean) => void };

export function sortable(node: HTMLElement, opts: Opts) {
  let current = opts;
  node.dataset.sortKey = String(opts.key);

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return;
    // Sem isso o navegador começa o arrastar nativo do link/imagem.
    e.preventDefault();
    const list = node.parentElement!;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let target: HTMLElement | null = null;
    let after = false;

    const clearMarks = () => {
      list.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    };

    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      moved = true;
      node.classList.add('sorting');
      const hit = document
        .elementsFromPoint(ev.clientX, ev.clientY)
        .map((n) => (n as HTMLElement).closest?.<HTMLElement>('[data-sort-key]'))
        .find((n) => n && n !== node && n.parentElement === list);
      clearMarks();
      target = hit ?? null;
      if (!target) return;
      const r = target.getBoundingClientRect();
      after = ev.clientX > r.left + r.width / 2;
      target.classList.add(after ? 'drop-after' : 'drop-before');
    };

    const end = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      node.classList.remove('sorting');
      clearMarks();
      if (!moved) return;
      // O clique que vem logo depois de soltar não deve abrir o item.
      node.addEventListener('click', (c) => (c.preventDefault(), c.stopPropagation()), { capture: true, once: true });
      if (target && ev.type === 'pointerup') current.onDrop(current.key, Number(target.dataset.sortKey), after);
    };

    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }

  node.addEventListener('pointerdown', onpointerdown);
  return {
    update(next: Opts) {
      current = next;
      node.dataset.sortKey = String(next.key);
    },
    destroy() {
      node.removeEventListener('pointerdown', onpointerdown);
    },
  };
}
