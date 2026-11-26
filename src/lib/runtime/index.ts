import { cleanScene } from '../editor/doc';
import { mount3d } from './scene3d';

export { mount3d, snapshot3d } from './scene3d';
export { ANIM_CSS, animAttrs } from './anim';

/**
 * Dá vida ao documento: monta o 3D de cada `[data-3d]` (parâmetros revalidados aqui), dispara a entrada das
 * animações quando o elemento aparece na tela e aplica o parallax. Serve ao site exportado (linkon.js) e ao app,
 * que a chama sobre o `contentDocument` do iframe da visualização. Devolve a função que desfaz tudo.
 */
export function start(root: Document = document): () => void {
  const win = root.defaultView;
  if (!win) return () => {};
  const undo: (() => void)[] = [];
  const stop = () => undo.splice(0).forEach((f) => f());

  for (const n of root.querySelectorAll<HTMLElement>('[data-3d]')) {
    let raw: unknown;
    try {
      raw = JSON.parse(n.dataset['3d'] ?? '');
    } catch {
      raw = null;
    }
    undo.push(mount3d(n, cleanScene(raw)).destroy);
  }

  // Movimento reduzido: o 3D já foi desenhado parado e o resto fica como está, sem esconder nada.
  if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) return stop;

  const html = root.documentElement;
  html.classList.add('lk-m');
  undo.push(() => html.classList.remove('lk-m'));

  const ins = root.querySelectorAll<HTMLElement>('.a-in');
  if (win.IntersectionObserver) {
    const io = new win.IntersectionObserver(
      (list) => {
        for (const e of list)
          if (e.isIntersecting) {
            e.target.classList.add('on');
            io.unobserve(e.target);
          }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    ins.forEach((e) => io.observe(e));
    undo.push(() => io.disconnect());
  } else ins.forEach((e) => e.classList.add('on'));

  const px = [...root.querySelectorAll<HTMLElement>('.a-px')].map((el) => ({ el, k: parseFloat(el.style.getPropertyValue('--a-px')) || 0, dy: 0 }));
  if (px.length) {
    let pending = 0;
    // O deslocamento é relativo ao centro da janela: no meio da tela o elemento está no lugar desenhado.
    const run = () => {
      pending = 0;
      for (const p of px) {
        const r = p.el.getBoundingClientRect();
        const s = r.height / (p.el.offsetHeight || 1) || 1; // o fit.js pode ter reduzido a página
        const base = r.top + r.height / 2 - p.dy * s;
        p.dy = ((win.innerHeight / 2 - base) * p.k) / s;
        p.el.style.transform = `translate3d(0,${p.dy.toFixed(1)}px,0)`;
      }
    };
    const queue = () => (pending ||= win.requestAnimationFrame(run));
    win.addEventListener('scroll', queue, { passive: true });
    win.addEventListener('resize', queue);
    undo.push(() => {
      win.removeEventListener('scroll', queue);
      win.removeEventListener('resize', queue);
      for (const p of px) p.el.style.transform = '';
    });
    run();
  }
  return stop;
}
