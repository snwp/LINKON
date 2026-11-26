import { cleanAnim, type El } from '../editor/doc';

/**
 * CSS das animações, gerado aqui e em nenhum outro lugar (editor, visualização e site usam este texto).
 * Cada efeito mexe numa propriedade própria para não brigar com os outros: entrada em opacity/translate/scale/
 * filter (só durante a animação), hover em transição de translate/scale/rotate/opacity, loop em `transform`.
 * A entrada só esconde o elemento quando o script marcou a página (`html.lk-m`): sem script, nada fica invisível.
 * Com movimento reduzido, nada disto vale.
 */
export const ANIM_CSS = `@media (prefers-reduced-motion:no-preference){
html.lk-m .a-in:not(.on){opacity:0!important}
.a-in,.a-lp{animation-name:var(--n-in,none),var(--n-lp,none);animation-duration:var(--a-dur,.6s),var(--a-lp,4s);animation-delay:var(--a-delay,0s),0s;animation-timing-function:cubic-bezier(.22,1,.36,1),var(--t-lp,ease-in-out);animation-iteration-count:1,infinite;animation-fill-mode:backwards,none;animation-direction:normal,var(--d-lp,normal)}
.on.a-in-fade{--n-in:lk-fade}.on.a-in-up{--n-in:lk-up}.on.a-in-down{--n-in:lk-down}.on.a-in-left{--n-in:lk-left}.on.a-in-right{--n-in:lk-right}.on.a-in-zoom{--n-in:lk-zoom}.on.a-in-blur{--n-in:lk-blur}
.a-lp-float{--n-lp:lk-float}.a-lp-pulse{--n-lp:lk-pulse}.a-lp-spin{--n-lp:lk-spin;--t-lp:linear}.a-lp-sway{--n-lp:lk-sway;--d-lp:alternate}
@keyframes lk-fade{from{opacity:0}}
@keyframes lk-up{from{opacity:0;translate:0 32px}}
@keyframes lk-down{from{opacity:0;translate:0 -32px}}
@keyframes lk-left{from{opacity:0;translate:-32px 0}}
@keyframes lk-right{from{opacity:0;translate:32px 0}}
@keyframes lk-zoom{from{opacity:0;scale:.85}}
@keyframes lk-blur{from{opacity:0;filter:blur(14px)}}
@keyframes lk-float{50%{transform:translateY(-12px)}}
@keyframes lk-pulse{50%{transform:scale(1.06)}}
@keyframes lk-spin{to{transform:rotate(360deg)}}
@keyframes lk-sway{from{transform:rotate(-3deg)}to{transform:rotate(3deg)}}
@media (hover:hover){
.a-hv{transition:translate .3s cubic-bezier(.22,1,.36,1),scale .3s cubic-bezier(.22,1,.36,1),rotate .3s cubic-bezier(.22,1,.36,1),opacity .3s}
.a-hv-lift:hover{translate:0 -8px}.a-hv-grow:hover{scale:1.05}.a-hv-tilt:hover{rotate:-3deg}.a-hv-dim:hover{opacity:.6!important}
}
}`;

const LOOP_SECONDS = { float: 4, pulse: 2.4, spin: 12, sway: 5 };

/**
 * Classes e variáveis CSS de um elemento. `cls` começa com espaço e `style` com ponto e vírgula (ou são vazios),
 * para colar direto em `class="el${cls}"` e depois do estilo do elemento. `play` já marca a entrada como disparada
 * (editor, onde não há script de rolagem). Parallax e loop não convivem: o parallax (script, em `transform`) vence.
 */
export function animAttrs(e: Pick<El, 'anim'>, play = false): { cls: string; style: string } {
  const a = cleanAnim(e.anim);
  if (!a) return { cls: '', style: '' };
  let cls = '';
  let style = '';
  if (a.in) {
    cls += ` a-in a-in-${a.in}${play ? ' on' : ''}`;
    style += `;--a-delay:${a.delay ?? 0}s;--a-dur:${a.duration ?? 0.6}s`;
  }
  if (a.hover) cls += ` a-hv a-hv-${a.hover}`;
  if (a.parallax) {
    cls += ' a-px';
    style += `;--a-px:${a.parallax}`;
  } else if (a.loop) {
    cls += ` a-lp a-lp-${a.loop}`;
    style += `;--a-lp:${a.loopDuration ?? LOOP_SECONDS[a.loop]}s`;
  }
  return { cls, style };
}
