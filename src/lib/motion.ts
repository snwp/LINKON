/**
 * Movimento do Linkon. Tempos, distâncias e curvas vêm das transições gratuitas do Transitions.dev
 * (Menu dropdown, Toast open/close, Panel reveal, Text states swap, Tabs sliding, Error state shake),
 * reescritas como transições e ações do Svelte. Todas respeitam prefers-reduced-motion.
 */
import type { TransitionConfig } from 'svelte/transition';

/** cubic-bezier(0.22, 1, 0.36, 1), a curva de saída usada em todo o Transitions.dev. */
export function easeOut(t: number): number {
  // Aproximação de quinta ordem da mesma curva (rápida no começo, assenta devagar).
  return 1 - Math.pow(1 - t, 4.2);
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Escala + opacidade a partir da origem do gatilho. Transitions.dev — Menu dropdown. */
export function dropdown(_node: Element, { closing = false }: { closing?: boolean } = {}): TransitionConfig {
  if (reduced()) return { duration: 0 };
  const from = closing ? 0.99 : 0.97;
  return {
    duration: closing ? 150 : 250,
    easing: easeOut,
    css: (t) => `opacity:${t};transform:scale(${from + (1 - from) * t})`,
  };
}

/** Sobe 16 px com desfoque e escala leve; fecha mais rápido do que abre. Transitions.dev — Toast open/close. */
export function toast(_node: Element, { closing = false }: { closing?: boolean } = {}): TransitionConfig {
  if (reduced()) return { duration: 0 };
  return {
    duration: closing ? 250 : 350,
    easing: easeOut,
    css: (t, u) => `opacity:${t};transform:translateY(${16 * u}px) scale(${0.97 + 0.03 * t});filter:blur(${2 * u}px)`,
  };
}

/** Desliza no eixo Y com desfoque. Transitions.dev — Panel reveal. */
export function panelReveal(_node: Element, { distance = 48, closing = false } = {}): TransitionConfig {
  if (reduced()) return { duration: 0 };
  return {
    duration: closing ? 350 : 400,
    easing: easeOut,
    css: (t, u) => `opacity:${t};transform:translateY(${distance * u}px);filter:blur(${2 * u}px)`,
  };
}

/** O texto novo entra de baixo, desfocado. Transitions.dev — Text states swap (só a entrada). */
export function textSwap(_node: Element): TransitionConfig {
  if (reduced()) return { duration: 0 };
  return {
    duration: 150,
    css: (t, u) => `opacity:${t};transform:translateY(${4 * u}px);filter:blur(${2 * u}px)`,
  };
}

/** A página do canvas (ou da visualização) aparece ao trocar Desktop ↔ Mobile: só a que entra, sem animar largura. */
export function frameIn(_node: Element): TransitionConfig {
  if (reduced()) return { duration: 0 };
  return { duration: 200, easing: easeOut, css: (t) => `opacity:${t};transform:scale(${0.98 + 0.02 * t})` };
}

/** Item novo na conversa do Claude: sobe 6 px e aparece. */
export function logIn(_node: Element): TransitionConfig {
  if (reduced()) return { duration: 0 };
  return { duration: 200, easing: easeOut, css: (t, u) => `opacity:${t};transform:translateY(${6 * u}px)` };
}

/**
 * Cartão novo numa grade (ex.: Duplicar). `skip` evita animar os cartões que já estavam lá quando a tela abriu:
 * navegar é frequente demais para tudo entrar de novo a cada visita.
 */
export function cardIn(_node: Element, { skip = false }: { skip?: boolean } = {}): TransitionConfig {
  if (skip || reduced()) return { duration: 0 };
  return { duration: 220, easing: easeOut, css: (t) => `opacity:${t};transform:scale(${0.97 + 0.03 * t})` };
}

/** Deslize de reordenação (camadas, grades) com a curva da casa. Use com animate:flip. */
export const FLIP = {
  get duration() {
    return reduced() ? 0 : 180;
  },
  easing: easeOut,
};

/**
 * Pílula que desliza até o item ativo ([aria-pressed=true] ou [aria-selected=true]).
 * Transitions.dev — Tabs sliding. Na primeira medida e ao redimensionar, a pílula pula sem animar.
 */
export function slidingPill(node: HTMLElement) {
  const pill = document.createElement('span');
  pill.className = 't-pill';
  pill.setAttribute('aria-hidden', 'true');
  node.prepend(pill);
  node.classList.add('has-pill');

  const place = (animate: boolean) => {
    const active = node.querySelector<HTMLElement>('[aria-pressed="true"], [aria-selected="true"]');
    pill.style.opacity = active ? '1' : '0';
    if (!active) return;
    if (!animate) pill.style.transition = 'none';
    pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.height = `${active.offsetHeight}px`;
    if (!animate) {
      void pill.offsetWidth;
      pill.style.transition = '';
    }
  };

  const mo = new MutationObserver(() => place(true));
  mo.observe(node, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-selected'], childList: true });
  const ro = new ResizeObserver(() => place(false));
  ro.observe(node);
  requestAnimationFrame(() => place(false));

  return {
    destroy() {
      mo.disconnect();
      ro.disconnect();
      pill.remove();
    },
  };
}

/** Treme o elemento uma vez (6 px, 280 ms). Transitions.dev — Error state shake. */
export function shake(node: HTMLElement | null | undefined) {
  if (!node || reduced()) return;
  node.classList.remove('t-shaking');
  void node.offsetWidth;
  node.classList.add('t-shaking');
}

/** Treme sempre que `value` muda para algo não vazio (ex.: a mensagem de erro de um formulário). */
export function shakeOn(node: HTMLElement, value: unknown) {
  return {
    update(v: unknown) {
      if (v && v !== value) shake(node);
      value = v;
    },
  };
}
