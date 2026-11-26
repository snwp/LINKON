import { createElement, DEFAULT_SCENE, type Anim, type Doc, type El, type ElementType, type Scene3D } from './doc';

/** Larguras padrão das duas versões de uma página. */
export const DESKTOP_WIDTH = 1440;
export const MOBILE_WIDTH = 390;
/** No HTML exportado, telas até esta largura mostram a versão mobile. */
export const BREAKPOINT = 767;

/**
 * Altura aproximada de um texto quebrado na largura `w`.
 * shortcut: supõe largura média de caractere de 0,58 em; se textos começarem a cortar, medir com canvas.
 */
export function textHeight(text: string, fontSize: number, lineHeight: number, w: number, padding = 0): number {
  const perLine = Math.max(1, Math.floor(Math.max(20, w - 2 * padding) / (fontSize * 0.58)));
  const lines = text.split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
  // Abaixo de 1,2 a caixa da linha fica maior que o line-height (ascendentes da fonte), daí o piso.
  return Math.ceil(lines * fontSize * Math.max(lineHeight, 1.2) + 2 * padding);
}

// ---------- adaptação automática do desktop para o mobile ----------

const CONTAINERS = new Set<ElementType>(['bloco', 'secao', 'imagem']);

/**
 * Cria a versão mobile a partir da desktop: cada elemento que fica dentro de um bloco, seção ou imagem vira
 * filho dele, e os filhos são empilhados numa coluna de 390 px. Faixas de largura total continuam de ponta a ponta.
 * É um ponto de partida: tudo continua editável.
 */
export function toMobile(src: Doc): Doc {
  const W = MOBILE_WIDTH;
  const M = 20;
  const out: Doc = { version: 1, width: W, height: 0, background: src.background, elements: [] };
  const els = src.elements.filter((e) => !e.hidden);
  const area = (e: El) => e.w * e.h;
  const cx = (e: El) => e.x + e.w / 2;
  const cy = (e: El) => e.y + e.h / 2;
  const holds = (p: El, c: El) =>
    p !== c && CONTAINERS.has(p.type) && area(p) > area(c) &&
    cx(c) >= p.x && cx(c) <= p.x + p.w && cy(c) >= p.y && cy(c) <= p.y + p.h;

  const kids = new Map<El | null, El[]>();
  for (const e of els) {
    let parent: El | null = null;
    for (const p of els) if (holds(p, e) && (!parent || area(p) < area(parent))) parent = p;
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent)!.push(e);
  }
  // Ordem de leitura por XY-cut: separa colunas lado a lado (esquerda para a direita) e, dentro delas,
  // linhas (de cima para baixo). Assim cada cartão de uma grade fica junto do seu texto.
  // Corta só no maior vão: o espaço entre um título e a grade é maior que o entre a foto e o nome do cartão.
  const split = (items: El[], axis: 'x' | 'y'): { groups: El[][]; gap: number } => {
    const size = axis === 'x' ? 'w' : 'h';
    const sorted = [...items].sort((a, b) => a[axis] - b[axis]);
    let end = -Infinity;
    let best = -1;
    let bestGap = -1;
    sorted.forEach((e, i) => {
      const gap = e[axis] - end;
      if (i > 0 && gap >= -0.5 && gap > bestGap) {
        bestGap = gap;
        best = i;
      }
      end = Math.max(end, e[axis] + e[size]);
    });
    return best < 0 ? { groups: [sorted], gap: -1 } : { groups: [sorted.slice(0, best), sorted.slice(best)], gap: bestGap };
  };
  // O eixo com o maior vão manda; no empate, linhas antes de colunas (uma grade sai linha a linha).
  const order = (items: El[]): El[] => {
    if (items.length < 2) return items;
    const sx = split(items, 'x');
    const sy = split(items, 'y');
    const { groups } = sy.gap >= sx.gap ? sy : sx;
    return groups.length > 1 ? groups.flatMap(order) : [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  };
  const isBand = (e: El) => e.w >= src.width * 0.9;
  const centeredIn = (e: El, left: number, width: number) => e.w < width * 0.9 && Math.abs(cx(e) - (left + width / 2)) < 8;

  /** Põe `e` na coluna (x, avail) a partir de y e devolve a altura que ocupou. */
  function place(e: El, x: number, y: number, avail: number, centered: boolean): number {
    const fontSize = e.fontSize > 24 ? Math.round(Math.max(24, e.fontSize * 0.6)) : e.fontSize;
    const w = Math.min(e.w, avail);
    const el: El = { ...e, x: Math.round(centered ? x + (avail - w) / 2 : x), y: Math.round(y), w: Math.round(w), fontSize };
    out.elements.push(el);
    const children = order(kids.get(e) ?? []);
    if (children.length) {
      const band = isBand(e);
      const pad = band ? 40 : Math.max(16, Math.min(e.padding, 24));
      const innerX = band ? M : el.x + pad;
      const innerW = band ? W - 2 * M : el.w - 2 * pad;
      let ny = y + pad;
      for (const c of children) ny += place(c, innerX, ny, innerW, centeredIn(c, e.x, e.w)) + 16;
      el.h = Math.round(ny - 16 + pad - y);
    } else if (e.text && (e.type === 'texto' || e.type === 'bloco' || e.type === 'secao')) {
      el.h = textHeight(e.text, fontSize, e.lineHeight, el.w, e.padding);
    } else if (e.type !== 'link' && e.type !== 'referencia') {
      el.h = Math.max(1, Math.round((e.h * el.w) / e.w));
    }
    return el.h;
  }

  let y = 0;
  let prevBand = false;
  for (const e of order(kids.get(null) ?? [])) {
    const band = isBand(e);
    if (!(band && (prevBand || y === 0))) y += 24;
    y += band ? place(e, 0, y, W, false) : place(e, M, y, W - 2 * M, centeredIn(e, 0, src.width));
    prevBand = band;
  }
  out.height = Math.max(200, y + (prevBand ? 0 : 24));
  return out;
}


// ---------- modelos prontos ----------
// Cada modelo é um projeto fictício já finalizado, com direção visual própria. Os construtores abaixo são comuns;
// cor, raio e tom de cada faixa vêm do tema do projeto, não de valores fixos.

type Tone = { bg: string; ink: string; muted: string; line: string };
type Theme = { accent: string; onAccent: string; radius: number };
/** Construtor de um quadro (desktop ou mobile). `y` é onde a próxima seção começa; `t` é o tom da faixa atual. */
type B = { d: Doc; y: number; W: number; m: number; cw: number; mob: boolean; th: Theme; t: Tone };
type Btn = { label: string; fill: string; color: string; line?: string; href?: string; anim?: Anim };

function begin(W: number, th: Theme, t: Tone): B {
  const mob = W < 600;
  const m = mob ? 20 : 120;
  return { d: { version: 1, width: W, height: 0, background: t.bg, elements: [] }, y: 0, W, m, cw: W - 2 * m, mob, th, t };
}

function put(b: B, type: ElementType, name: string, props: Partial<El>): El {
  const e = createElement(type, b.d, 0, 0, { name, ...props });
  e.x = Math.round(e.x);
  e.y = Math.round(e.y);
  e.w = Math.round(e.w);
  e.h = Math.round(e.h);
  b.d.elements.push(e);
  return e;
}

function txt(b: B, name: string, text: string, x: number, y: number, w: number, o: Partial<El> = {}): El {
  const fontSize = o.fontSize ?? 17;
  const lineHeight = o.lineHeight ?? 1.5;
  return put(b, 'texto', name, {
    text, x, y, w, h: textHeight(text, fontSize, lineHeight, w, o.padding ?? 0),
    font: 'text', fontSize, fontWeight: 400, lineHeight, color: b.t.ink, ...o,
  });
}

const title = (b: B, name: string, text: string, x: number, y: number, w: number, size: number, o: Partial<El> = {}) =>
  // Geist em negrito é mais estreita que a média suposta em textHeight (0,58 em); 1,05 evita um vão de linha sobrando.
  txt(b, name, text, x, y, w, { font: 'ui', fontSize: size, fontWeight: 700, lineHeight: 1.1, h: textHeight(text, size, o.lineHeight ?? 1.1, Math.round(w * 1.05)), ...o });

const box = (b: B, name: string, x: number, y: number, w: number, h: number, fill: string, o: Partial<El> = {}) =>
  put(b, 'bloco', name, { x, y, w, h, fill, radius: 0, padding: 0, ...o });

const obj3d = (b: B, name: string, x: number, y: number, w: number, h: number, scene: Partial<Scene3D>, o: Partial<El> = {}) =>
  put(b, 'objeto3d', name, { x, y, w, h, scene: { ...DEFAULT_SCENE, ...scene }, ...o });

const an = (a?: Anim): Partial<El> => (a ? { anim: a } : {});
const up = (delay = 0, duration = 0.7): Anim => ({ in: 'up', delay, duration });
const fade = (delay = 0, duration = 0.8): Anim => ({ in: 'fade', delay, duration });
/** Coluna de uma grade de 12 (1200 px, vão de 24) no desktop; no mobile, a coluna inteira. */
const col = (b: B, start: number, span: number) =>
  b.mob ? { x: b.m, w: b.cw } : { x: b.m + start * 102, w: span * 78 + (span - 1) * 24 };

function mix(a: string, c: string, t: number): string {
  const n = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  const h = (i: number) => Math.round(n(a, i) * (1 - t) + n(c, i) * t).toString(16).padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
}

const solid = (b: B, label: string, o: Partial<Btn> = {}): Btn => ({ label, fill: b.th.accent, color: b.th.onAccent, ...o });
const outline = (b: B, label: string, o: Partial<Btn> = {}): Btn => ({ label, fill: '', color: b.t.ink, line: b.t.ink, ...o });

const btnW = (label: string) => Math.max(140, Math.ceil(label.length * 16 * 0.62) + 48);

function button(b: B, bt: Btn, x: number, y: number, w: number, h = 48): El {
  return put(b, 'link', `Botão ${bt.label}`, {
    x, y, w, h, text: bt.label, href: bt.href ?? 'https://', radius: b.th.radius, fill: bt.fill, color: bt.color,
    font: 'ui', fontSize: 16, fontWeight: 600, padding: bt.line ? 11 : 12,
    ...(bt.line ? { borderWidth: 1, borderColor: bt.line } : {}), ...an(bt.anim),
  });
}

/** Botões lado a lado no desktop e empilhados no mobile. Devolve o y de baixo. */
function buttons(b: B, list: Btn[], x: number, y: number, avail: number, center = false): number {
  if (b.mob) {
    list.forEach((bt, i) => button(b, bt, x, y + i * 60, avail));
    return y + list.length * 60 - 12;
  }
  const ws = list.map((bt) => btnW(bt.label));
  const total = ws.reduce((a, w) => a + w, 0) + 12 * (list.length - 1);
  let bx = center ? x + (avail - total) / 2 : x;
  list.forEach((bt, i) => {
    button(b, bt, bx, y, ws[i]);
    bx += ws[i] + 12;
  });
  return y + 48;
}

/** Faixa de largura total. `body` recebe o y do conteúdo e devolve o y de baixo do conteúdo. */
function section(b: B, name: string, tone: Tone, body: (y: number) => number, pad = 96) {
  const prev = b.t;
  b.t = tone;
  const p = b.mob ? Math.round(pad / 2) : pad;
  const s = put(b, 'secao', name, { x: 0, y: b.y, w: b.W, h: 0, fill: tone.bg, padding: 0 });
  s.h = Math.round(body(b.y + p) + p - b.y);
  b.y += s.h;
  b.t = prev;
}

function nav(b: B, tone: Tone, brand: string, links: string[], cta?: Btn) {
  const prev = b.t;
  b.t = tone;
  const h = b.mob ? 64 : 80;
  const y = b.y;
  put(b, 'secao', 'Navegação', { x: 0, y, w: b.W, h, fill: tone.bg, padding: 0 });
  box(b, 'Linha da navegação', 0, y + h - 1, b.W, 1, tone.line);
  txt(b, 'Marca', brand, b.m, y + (h - 28) / 2, 260, { font: 'ui', fontSize: 22, fontWeight: 700, lineHeight: 1.25 });
  if (b.mob) {
    txt(b, 'Menu', 'Menu', b.W - b.m - 80, y + (h - 24) / 2, 80, { font: 'ui', fontSize: 16, fontWeight: 500, align: 'right' });
  } else {
    let right = b.W - b.m;
    if (cta) {
      const w = btnW(cta.label);
      button(b, cta, right - w, y + (h - 44) / 2, w, 44);
      right -= w + 40;
    }
    for (const l of [...links].reverse()) {
      const w = Math.ceil(l.length * 15 * 0.62) + 12;
      right -= w;
      txt(b, `Menu ${l}`, l, right, y + (h - 23) / 2, w, { font: 'ui', fontSize: 15, fontWeight: 500, align: 'right' });
      right -= 28;
    }
  }
  b.y += h;
  b.t = prev;
}

function heading(b: B, text: string, y: number, o: { sub?: string; center?: boolean; size?: number; w?: number; anim?: Anim } = {}): number {
  const al: Partial<El> = o.center ? { align: 'center' } : {};
  const w = o.center ? b.cw : Math.min(b.cw, o.w ?? 760);
  let cy = y + title(b, `Título: ${text}`, text, b.m, y, w, o.size ?? (b.mob ? 28 : 40), { ...al, ...an(o.anim) }).h;
  if (o.sub) cy += 12 + txt(b, `Texto: ${text}`, o.sub, b.m, cy + 12, o.center ? b.cw : Math.min(b.cw, 640), { color: b.t.muted, ...al }).h;
  return cy + (b.mob ? 28 : 48);
}

function ctaBand(b: B, tone: Tone, head: string, sub: string, action: Btn) {
  section(b, 'Chamada final', tone, (y) => {
    let cy = y + title(b, 'Título da chamada', head, b.m, y, b.cw, b.mob ? 30 : 48, { align: 'center' }).h + 16;
    cy += txt(b, 'Texto da chamada', sub, b.m + (b.mob ? 0 : 160), cy, b.cw - (b.mob ? 0 : 320), { color: tone.muted, align: 'center', fontSize: 18 }).h + 32;
    return buttons(b, [action], b.m, cy, b.cw, true);
  });
}

function footer(b: B, tone: Tone, left: string, right: string) {
  section(b, 'Rodapé', tone, (y) => {
    box(b, 'Linha do rodapé', 0, y - (b.mob ? 24 : 48), b.W, 1, tone.line);
    if (b.mob) {
      const h = txt(b, 'Rodapé: contato', left, b.m, y, b.cw, { fontSize: 14, color: tone.muted }).h;
      return y + h + 8 + txt(b, 'Rodapé: redes', right, b.m, y + h + 8, b.cw, { fontSize: 14, color: tone.muted }).h;
    }
    const half = Math.round(b.cw / 2);
    const h = txt(b, 'Rodapé: contato', left, b.m, y, half, { fontSize: 14, color: tone.muted }).h;
    txt(b, 'Rodapé: redes', right, b.m + half, y, half, { fontSize: 14, color: tone.muted, align: 'right' });
    return y + h;
  }, 48);
}

function finish(b: B): Doc {
  b.d.height = Math.round(b.y);
  return b.d;
}

// ---------- 1. Pitanga · Landing ----------
// Fintech inventada. Fundo grafite azulado com o vermelho-laranja da fruta como única cor viva, para o leque 3D de
// cartões ser o ponto mais forte da página. Texto escuro sobre a cor da fruta (contraste), nunca branco.

const PIT: Theme = { accent: '#ff4a2b', onAccent: '#10131a', radius: 8 };
const PIT_DARK: Tone = { bg: '#10131a', ink: '#f3f4f7', muted: '#9aa1b2', line: '#262b38' };
const PIT_LIGHT: Tone = { bg: '#e8ebf1', ink: '#10131a', muted: '#4f566a', line: '#c3c9d6' };
const PIT_FRUIT: Tone = { bg: '#ff4a2b', ink: '#10131a', muted: '#3d1209', line: '#10131a' };

/** Tela de fatura do app: o produto de verdade no lugar de um ícone. */
function invoice(b: B, x: number, y: number, w: number): number {
  const pad = b.mob ? 20 : 32;
  const ix = x + pad;
  const iw = w - 2 * pad;
  const card = box(b, 'Cartão da fatura', x, y, w, 0, '#1a1f2b', { radius: 16, anim: fade(0, 0.6) });
  let cy = y + pad;
  cy += txt(b, 'Fatura: mês', 'Fatura de novembro', ix, cy, iw, { font: 'ui', fontSize: 16, fontWeight: 500, color: b.t.muted, anim: fade(0.1, 0.6) }).h + 4;
  cy += title(b, 'Fatura: total', 'R$ 1.482,60', ix, cy, iw, b.mob ? 40 : 52, { anim: fade(0.15, 0.6) }).h + 4;
  cy += txt(b, 'Fatura: vencimento', 'Vence em 12 de dezembro · volta de R$ 29,65 neste mês', ix, cy, iw, { fontSize: 15, color: b.t.muted, anim: fade(0.2, 0.6) }).h + 20;
  box(b, 'Fatura: trilho', ix, cy, iw, 8, '#2f3647', { radius: 4, anim: fade(0.2, 0.6) });
  box(b, 'Fatura: usado', ix, cy, Math.round(iw * 0.64), 8, b.th.accent, { radius: 4, anim: { in: 'left', delay: 0.5, duration: 0.9 } });
  cy += 8 + 12;
  cy += txt(b, 'Fatura: limite', '64% do limite de R$ 2.300,00', ix, cy, iw, { fontSize: 14, anim: fade(0.2, 0.6) }).h + 16;
  const rows = [
    ['Mercado Bom Preço', 'sex, 14 nov · Mercado', 'R$ 218,40', 'volta R$ 4,37'],
    ['Drogaria Central', 'qui, 13 nov · Farmácia', 'R$ 64,90', 'volta R$ 1,30'],
    ['Posto Ipê', 'qua, 12 nov · Combustível', 'R$ 180,00', 'sem volta'],
    ['Padaria Estrela', 'ter, 11 nov · Mercado', 'R$ 18,50', 'volta R$ 0,37'],
  ];
  const vw = b.mob ? 110 : 140;
  rows.forEach(([name, meta, val, back], i) => {
    const a = fade(0.4 + i * 0.12, 0.5);
    box(b, 'Fatura: divisor', ix, cy, iw, 1, '#2a3040', { anim: a });
    const ry = cy + 14;
    txt(b, `Fatura: ${name}`, name, ix, ry, iw - vw, { font: 'ui', fontSize: 16, fontWeight: 500, anim: a });
    txt(b, `Fatura: ${name} data`, meta, ix, ry + 24, iw - vw, { fontSize: 13, color: b.t.muted, anim: a });
    txt(b, `Fatura: ${name} valor`, val, ix + iw - vw, ry, vw, { font: 'ui', fontSize: 16, fontWeight: 700, align: 'right', anim: a });
    txt(b, `Fatura: ${name} volta`, back, ix + iw - vw, ry + 24, vw, { fontSize: 13, color: back === 'sem volta' ? b.t.muted : b.th.accent, align: 'right', anim: a });
    cy += 72;
  });
  card.h = cy + pad - 8 - y;
  return y + card.h;
}

function landing(W: number): Doc {
  const b = begin(W, PIT, PIT_DARK);
  nav(b, PIT_DARK, 'Pitanga', ['Cartão', 'Fatura', 'Tarifas'], solid(b, 'Pedir meu cartão'));
  const sub = 'A Pitanga devolve 2% do que você gasta em mercado e farmácia, sem anuidade e sem pedir comprovante de renda.';
  const fan: Partial<Scene3D> = { shape: 'cartoes', material: 'brilho', color: '#ff4a2b', color2: '#dfe3ec', light: 'estudio', rotX: 8, rotY: -18, rotZ: 0, spin: 0, float: true, zoom: 1, pointer: true };
  section(b, 'Destaque', PIT_DARK, (y) => {
    if (b.mob) {
      let cy = y + title(b, 'Título', 'O cartão que devolve parte do mercado na fatura.', b.m, y, b.cw, 36, { anim: up(0) }).h + 16;
      cy += txt(b, 'Texto do destaque', sub, b.m, cy, b.cw, { color: b.t.muted, anim: up(0.1) }).h + 24;
      cy = buttons(b, [solid(b, 'Pedir meu cartão', { anim: up(0.2) }), outline(b, 'Ver as tarifas')], b.m, cy, b.cw) + 8;
      obj3d(b, 'Leque de cartões', 0, cy, 390, 360, fan, { anim: fade(0.3, 1) });
      return cy + 360;
    }
    const H = 600;
    const t = 'O cartão que\ndevolve parte do\nmercado na fatura.';
    const used = textHeight(t, 56, 1.1, 600) + 24 + textHeight(sub, 20, 1.5, 500) + 40 + 48;
    let cy = y + Math.round((H - used) / 2);
    cy += title(b, 'Título', t, b.m, cy, 600, 56, { anim: up(0) }).h + 24;
    cy += txt(b, 'Texto do destaque', sub, b.m, cy, 500, { fontSize: 20, color: b.t.muted, anim: up(0.1) }).h + 40;
    buttons(b, [solid(b, 'Pedir meu cartão', { anim: up(0.2) }), outline(b, 'Ver as tarifas')], b.m, cy, 600);
    obj3d(b, 'Leque de cartões', 760, y, 560, H, fan, { anim: fade(0.3, 1) });
    return y + H;
  }, 48);

  section(b, 'Números', PIT_LIGHT, (y) => {
    let cy = heading(b, 'Dinheiro de volta, sem pegadinha.', y);
    const items = [
      ['2%', 'de volta no mercado e na farmácia, creditado todo mês na fatura'],
      ['R$ 0', 'de anuidade, hoje e depois, para o cartão físico e o virtual'],
      ['2 min', 'para abrir a conta pelo celular, com o cartão virtual na hora'],
    ];
    items.forEach(([n, text], i) => {
      const c = col(b, i * 4, 4);
      box(b, `Número ${n}: linha`, c.x, cy, c.w, 2, b.t.ink);
      let iy = cy + 20;
      iy += title(b, `Número ${n}`, n, c.x, iy, c.w, b.mob ? 64 : 88, { anim: up(i * 0.12) }).h + 8;
      iy += txt(b, `Número ${n}: texto`, text, c.x, iy, b.mob ? c.w : c.w - 32, { color: b.t.muted }).h;
      if (b.mob) cy = iy + 32;
      else if (i === 2) cy = iy;
    });
    return cy;
  });

  section(b, 'Fatura', PIT_DARK, (y) => {
    const left = col(b, 0, 5);
    const right = col(b, 6, 6);
    let ly = y + title(b, 'Título da fatura', 'Cada compra aparece na hora, com o quanto voltou.', left.x, y, left.w, b.mob ? 28 : 40).h + 20;
    ly += txt(b, 'Texto da fatura', 'A notificação chega um minuto depois da compra. A fatura fecha sempre no mesmo dia e você escolhe o vencimento entre os dias 5, 12 e 20.', left.x, ly, left.w, { color: b.t.muted }).h;
    if (b.mob) return invoice(b, b.m, ly + 28, b.cw);
    return Math.max(ly, invoice(b, right.x, y, right.w));
  });

  section(b, 'Depoimento', PIT_LIGHT, (y) => {
    const qx = b.m + (b.mob ? 20 : 36);
    const qw = b.mob ? b.cw - 20 : 920;
    const q = title(b, 'Citação', '“Troquei o cartão do banco pela Pitanga em março. Só do mercado voltaram R$ 312 até agora, e a fatura nunca me surpreendeu.”', qx, y, qw, b.mob ? 22 : 34, { fontWeight: 500, lineHeight: 1.3 });
    const a = txt(b, 'Autor', 'Renata Moraes · professora em Campinas', qx, y + q.h + 20, qw, { font: 'ui', fontSize: 16, fontWeight: 500, color: b.t.muted });
    box(b, 'Barra da citação', b.m, y, 6, q.h + 20 + a.h, b.th.accent);
    return y + q.h + 20 + a.h;
  });
  ctaBand(b, PIT_FRUIT, 'Peça o seu em dois minutos.', 'Sem anuidade e sem comprovante de renda. A resposta chega em até um dia útil.', { label: 'Pedir meu cartão', fill: '#10131a', color: '#f3f4f7' });
  footer(b, PIT_DARK, '© 2026 Pitanga · ajuda@pitanga.app · 0800 000 0000', 'Instagram · LinkedIn · Central de ajuda');
  return finish(b);
}

// ---------- 2. Forno Baixo · Catálogo ----------
// Ateliê de cerâmica de mesa. Direção de catálogo editorial: fundo branco, linhas finas, códigos em mono e quinas retas.
// As cores vêm do próprio ofício: azul de cobalto, ocre e terracota são os esmaltes e pigmentos que o ateliê usa.

const FB: Theme = { accent: '#15171a', onAccent: '#ffffff', radius: 0 };
const FB_LIGHT: Tone = { bg: '#ffffff', ink: '#15171a', muted: '#5b5f66', line: '#d6d8db' };
const FB_SOFT: Tone = { bg: '#eceef1', ink: '#15171a', muted: '#555a61', line: '#c9ccd1' };
const FB_COBALT: Tone = { bg: '#2347a8', ink: '#ffffff', muted: '#c9d3f0', line: '#4a66b8' };

type Ware = 'jarra' | 'tigela' | 'prato' | 'vaso' | 'caneca' | 'bule';

/** Peça de cerâmica desenhada com blocos sobre um quadrado de cor. `s` é o lado do quadrado. */
function ware(b: B, kind: Ware, name: string, x: number, y: number, s: number, bg: string, glaze: string, a: Anim) {
  const f = (v: number) => Math.round(v * s);
  const hi = mix(glaze, '#ffffff', 0.3);
  const shade = mix(bg, '#000000', 0.22);
  const p = (n: string, dx: number, dy: number, w: number, h: number, fill: string, o: Partial<El> = {}) =>
    box(b, `${name}: ${n}`, x + f(dx), y + f(dy), f(w), f(h), fill, { anim: a, ...o });
  p('fundo', 0, 0, 1, 1, bg);
  const ring = (n: string, dx: number, dy: number, w: number, h: number) =>
    p(n, dx, dy, w, h, '', { borderWidth: Math.max(3, f(0.035)), borderColor: glaze, radius: f(w / 2) });
  switch (kind) {
    case 'jarra':
      p('sombra', 0.24, 0.82, 0.52, 0.035, shade, { radius: f(0.02) });
      ring('asa', 0.55, 0.42, 0.2, 0.26);
      p('corpo', 0.28, 0.34, 0.4, 0.5, glaze, { radius: f(0.08) });
      p('gargalo', 0.32, 0.24, 0.3, 0.14, glaze, { radius: f(0.03) });
      p('faixa', 0.28, 0.5, 0.4, 0.05, hi);
      break;
    case 'tigela':
      p('sombra', 0.18, 0.74, 0.64, 0.035, shade, { radius: f(0.02) });
      p('copo', 0.2, 0.28, 0.6, 0.6, glaze, { radius: f(0.3) });
      p('tampa do fundo', 0.15, 0.2, 0.7, 0.3, bg);
      p('borda', 0.2, 0.48, 0.6, 0.05, hi, { radius: f(0.025) });
      break;
    case 'prato':
      p('sombra', 0.2, 0.7, 0.64, 0.05, shade, { radius: f(0.025) });
      p('prato', 0.17, 0.17, 0.66, 0.66, glaze, { radius: f(0.33) });
      p('centro', 0.29, 0.29, 0.42, 0.42, hi, { radius: f(0.21) });
      break;
    case 'vaso':
      p('sombra', 0.3, 0.84, 0.4, 0.035, shade, { radius: f(0.02) });
      p('corpo', 0.32, 0.36, 0.36, 0.48, glaze, { radius: f(0.14) });
      p('gargalo', 0.4, 0.24, 0.2, 0.16, glaze, { radius: f(0.03) });
      p('boca', 0.37, 0.2, 0.26, 0.05, hi, { radius: f(0.025) });
      break;
    case 'caneca':
      p('sombra', 0.24, 0.72, 0.5, 0.035, shade, { radius: f(0.02) });
      ring('asa', 0.58, 0.42, 0.2, 0.22);
      p('corpo', 0.26, 0.28, 0.38, 0.44, glaze, { radius: f(0.03) });
      p('borda', 0.26, 0.28, 0.38, 0.05, hi);
      break;
    case 'bule':
      p('sombra', 0.22, 0.8, 0.54, 0.035, shade, { radius: f(0.02) });
      ring('asa', 0.1, 0.44, 0.2, 0.26);
      p('bico', 0.62, 0.46, 0.2, 0.06, glaze, { radius: f(0.03) });
      p('corpo', 0.26, 0.34, 0.46, 0.46, glaze, { radius: f(0.23) });
      p('tampa', 0.37, 0.28, 0.24, 0.07, hi, { radius: f(0.03) });
      p('pino', 0.46, 0.22, 0.06, 0.07, hi, { radius: f(0.03) });
      break;
  }
}

function catalog(W: number): Doc {
  const b = begin(W, FB, FB_LIGHT);
  nav(b, FB_LIGHT, 'Forno Baixo', ['Peças', 'Ateliê', 'Encomendas'], outline(b, 'Visitar o ateliê', { href: 'mailto:ola@fornobaixo.com.br' }));
  const cobalt = '#2347a8';
  const mustard = '#e0a424';
  const terracotta = '#bd4b2c';
  const items: { kind: Ware; name: string; meta: string; text: string; price: string; bg: string; glaze: string }[] = [
    { kind: 'jarra', name: 'Jarra Maré', meta: 'Nº 014 · Mesa', text: 'Jarra de 1,2 litro com bico que não pinga, em esmalte azul de cobalto.', price: 'R$ 189', bg: '#c9d6f2', glaze: cobalt },
    { kind: 'tigela', name: 'Tigela Pão', meta: 'Nº 021 · Cozinha', text: 'Tigela funda de 18 cm, boa para sopa e para sovar massa de pão.', price: 'R$ 96', bg: '#e3e0d8', glaze: terracotta },
    { kind: 'prato', name: 'Prato Raso', meta: 'Nº 009 · Mesa', text: 'Prato de 26 cm com borda levemente inclinada, esmalte ocre.', price: 'R$ 78', bg: cobalt, glaze: mustard },
    { kind: 'vaso', name: 'Vaso Torre', meta: 'Nº 032 · Plantas', text: 'Vaso de 32 cm com furo de drenagem e prato incluído.', price: 'R$ 214', bg: mustard, glaze: '#15171a' },
    { kind: 'caneca', name: 'Caneca Duna', meta: 'Nº 003 · Cozinha', text: 'Caneca de 320 ml com asa larga, cabem dois dedos.', price: 'R$ 64', bg: terracotta, glaze: '#e3e0d8' },
    { kind: 'bule', name: 'Bule Cais', meta: 'Nº 027 · Mesa', text: 'Bule de 900 ml com tampa que não escorrega e filtro de aço.', price: 'R$ 238', bg: '#15171a', glaze: mustard },
  ];
  section(b, 'Peças', FB_LIGHT, (y) => {
    const intro = 'Cada peça é torneada à mão por uma das nossas três ceramistas e leva esmalte feito no ateliê. Saem 40 peças por semana; quando acaba, só na próxima fornada.';
    const hd = 'Cerâmica de mesa queimada a 1.240 °C, feita em Cunha.';
    let cy: number;
    if (b.mob) {
      cy = y + title(b, 'Título', hd, b.m, y, b.cw, 32, { anim: up(0) }).h + 16;
      cy += txt(b, 'Texto', intro, b.m, cy, b.cw, { color: b.t.muted }).h + 28;
    } else {
      const l = col(b, 0, 7);
      const r = col(b, 8, 4);
      const th = title(b, 'Título', hd, l.x, y, l.w, 56, { anim: up(0) }).h;
      const ph = textHeight(intro, 17, 1.5, r.w);
      txt(b, 'Texto', intro, r.x, y + th - ph, r.w, { color: b.t.muted, anim: up(0.1) });
      cy = y + th + 48;
    }
    // Filtros da coleção.
    let fx = b.m;
    ['Todas (12)', 'Mesa (6)', 'Cozinha (4)', 'Plantas (2)'].forEach((l, i) => {
      const w = Math.ceil(l.length * 14 * 0.62) + 32;
      if (fx + w > b.m + b.cw) {
        fx = b.m;
        cy += 44;
      }
      put(b, 'link', `Filtro ${l}`, {
        x: fx, y: cy, w, h: 36, text: l, href: 'https://', font: 'ui', fontSize: 14, fontWeight: 500, padding: 6, radius: 0,
        ...(i === 0 ? { fill: b.t.ink, color: b.t.bg } : { fill: '', color: b.t.ink, borderWidth: 1, borderColor: b.t.line }),
      });
      fx += w + 8;
    });
    cy += 36 + (b.mob ? 28 : 48);
    const cols = b.mob ? 2 : 3;
    const gap = b.mob ? 16 : 24;
    const cw = Math.floor((b.cw - gap * (cols - 1)) / cols);
    for (let r = 0; r < items.length; r += cols) {
      let rowH = 0;
      items.slice(r, r + cols).forEach((it, i) => {
        const x = b.m + i * (cw + gap);
        const a = fade(i * 0.1, 0.7);
        ware(b, it.kind, it.name, x, cy, cw, it.bg, it.glaze, a);
        let iy = cy + cw + 16;
        if (b.mob) {
          iy += title(b, it.name, it.name, x, iy, cw, 17, { fontWeight: 600, lineHeight: 1.3, anim: a }).h;
          iy += 2 + txt(b, `${it.name}: código`, it.meta, x, iy + 2, cw, { font: 'mono', fontSize: 12, color: b.t.muted, anim: a }).h;
          iy += 8 + txt(b, `${it.name}: descrição`, it.text, x, iy + 8, cw, { fontSize: 14, color: b.t.muted, anim: a }).h;
          iy += 8 + txt(b, `${it.name}: preço`, it.price, x, iy + 8, cw, { font: 'mono', fontSize: 16, fontWeight: 600, anim: a }).h;
        } else {
          title(b, it.name, it.name, x, iy, cw - 110, 20, { fontWeight: 600, lineHeight: 1.3, anim: a });
          txt(b, `${it.name}: preço`, it.price, x + cw - 110, iy + 2, 110, { font: 'mono', fontSize: 17, fontWeight: 600, align: 'right', anim: a });
          iy += 26;
          iy += 2 + txt(b, `${it.name}: código`, it.meta, x, iy + 2, cw, { font: 'mono', fontSize: 13, color: b.t.muted, anim: a }).h;
          iy += 8 + txt(b, `${it.name}: descrição`, it.text, x, iy + 8, cw, { fontSize: 15, color: b.t.muted, anim: a }).h;
        }
        rowH = Math.max(rowH, iy - cy);
      });
      cy += rowH + (b.mob ? 32 : 56);
    }
    return cy - (b.mob ? 32 : 56);
  }, 80);

  section(b, 'Ofício', FB_SOFT, (y) => {
    const l = col(b, 0, 4);
    const r = col(b, 5, 7);
    const hd = title(b, 'Título do ofício', 'Quarenta peças por semana, nem uma a mais.', l.x, y, l.w, b.mob ? 28 : 40).h;
    let cy = b.mob ? y + hd + 28 : y;
    const steps = [
      ['01', 'Torno', 'Cada peça sai do torno em uma a três horas de trabalho, sempre pela mesma pessoa que vai esmaltar.'],
      ['02', 'Esmalte', 'Misturamos o esmalte no ateliê: azul de cobalto, ocre de ferro e branco de cinza de madeira.'],
      ['03', 'Forno', 'Queima de 14 horas a 1.240 °C. A peça esfria dois dias dentro do forno antes de abrir.'],
    ];
    const nw = b.mob ? 52 : 88;
    for (const [n, h, text] of steps) {
      box(b, `Etapa ${n}: linha`, r.x, cy, r.w, 1, b.t.ink);
      txt(b, `Etapa ${n}`, n, r.x, cy + 24, nw, { font: 'mono', fontSize: b.mob ? 20 : 28, fontWeight: 600, color: '#2347a8' });
      let iy = cy + 24 + title(b, `Etapa ${h}`, h, r.x + nw, cy + 24, r.w - nw, b.mob ? 22 : 28, { lineHeight: 1.2 }).h;
      iy += 8 + txt(b, `Etapa ${h}: texto`, text, r.x + nw, iy + 8, r.w - nw, { color: b.t.muted }).h;
      cy = iy + 24;
    }
    return Math.max(cy, y + hd);
  }, 80);
  ctaBand(b, FB_COBALT, 'Quer 12 canecas iguais para o seu café?', 'Fazemos encomendas para restaurantes e cafés a partir de 12 peças, com o esmalte que você escolher. Prazo médio de cinco semanas.', { label: 'Pedir orçamento', fill: '#ffffff', color: '#15171a', href: 'mailto:encomendas@fornobaixo.com.br' });
  footer(b, FB_LIGHT, '© 2026 Forno Baixo · Rua das Olarias, 82, Cunha, SP · ter a sáb, 10h às 17h', 'Instagram · Pinterest');
  return finish(b);
}

// ---------- 3. Aro · Loja ----------
// Loja de peças de bicicleta. Direção utilitária e densa: amarelo de sinalização e preto, linhas duras, quinas quase
// retas. O pneu 3D gira no destaque e cada produto da grade é um objeto 3D pequeno sobre um quadrado de cor.

const ARO: Theme = { accent: '#111111', onAccent: '#ffcf1a', radius: 2 };
const ARO_WHITE: Tone = { bg: '#ffffff', ink: '#111111', muted: '#515151', line: '#111111' };
const ARO_YELLOW: Tone = { bg: '#ffcf1a', ink: '#111111', muted: '#3b3300', line: '#111111' };
const ARO_BLACK: Tone = { bg: '#111111', ink: '#ffffff', muted: '#c4c4c4', line: '#3a3a3a' };

function store(W: number): Doc {
  const b = begin(W, ARO, ARO_WHITE);
  section(b, 'Aviso', ARO_BLACK, (y) =>
    y + txt(b, 'Aviso de frete', b.mob ? 'Frete grátis acima de R$ 199' : 'Frete grátis acima de R$ 199 · Retire na loja de Pinheiros em 2 horas', b.m, y, b.cw, { fontSize: b.mob ? 12 : 13, color: '#ffcf1a', align: 'center', font: 'ui', fontWeight: 500 }).h,
  12);
  nav(b, ARO_WHITE, 'Aro', ['Iluminação', 'Transporte', 'Pneus e câmaras', 'Oficina'], outline(b, 'Sacola (2)'));
  const tire: Partial<Scene3D> = { shape: 'toro', material: 'fosco', color: '#111111', color2: '#ffffff', light: 'contraste', rotX: 68, rotY: 0, rotZ: 0, spin: 40, float: false, zoom: 1.1, pointer: true };
  section(b, 'Destaque', ARO_YELLOW, (y) => {
    const t = 'Peças para pedalar\ntodo dia, chova\nou faça sol.';
    const sub = 'Faróis, bagageiros, câmaras e travas testados pelos mecânicos da nossa oficina em Pinheiros. Mais de 2 mil clientes pedalam com Aro.';
    if (b.mob) {
      let cy = y + title(b, 'Título', t.replace(/\n/g, ' '), b.m, y, b.cw, 38, { anim: up(0) }).h + 16;
      cy += txt(b, 'Texto do destaque', sub, b.m, cy, b.cw, { color: b.t.muted, anim: up(0.1) }).h + 24;
      cy = buttons(b, [solid(b, 'Ver os mais vendidos', { anim: up(0.2) }), outline(b, 'Falar com a oficina', { href: 'mailto:oficina@aro.bike' })], b.m, cy, b.cw) + 16;
      obj3d(b, 'Pneu 3D', b.m, cy, b.cw, 320, tire, { anim: fade(0.2, 0.9) });
      put(b, 'link', 'Etiqueta do pneu', { x: b.m, y: cy + 320 - 56, w: b.cw, h: 48, text: 'Pneu Urbano 700x35c · R$ 119,90', href: 'https://', fill: '#111111', color: '#ffcf1a', font: 'ui', fontSize: 15, fontWeight: 600, padding: 12, radius: 2, anim: { in: 'zoom', delay: 0.6, duration: 0.5 } });
      return cy + 320;
    }
    const H = 560;
    const used = textHeight(t, 56, 1.1, 640) + 24 + textHeight(sub, 20, 1.5, 520) + 40 + 48;
    let cy = y + Math.round((H - used) / 2);
    cy += title(b, 'Título', t, b.m, cy, 640, 56, { anim: up(0) }).h + 24;
    cy += txt(b, 'Texto do destaque', sub, b.m, cy, 520, { fontSize: 20, color: b.t.muted, anim: up(0.1) }).h + 40;
    buttons(b, [solid(b, 'Ver os mais vendidos', { anim: up(0.2) }), outline(b, 'Falar com a oficina', { href: 'mailto:oficina@aro.bike' })], b.m, cy, 640);
    obj3d(b, 'Pneu 3D', 760, y, 560, H, tire, { anim: fade(0.2, 0.9) });
    put(b, 'link', 'Etiqueta do pneu', { x: 760, y: y + H - 64, w: 340, h: 48, text: 'Pneu Urbano 700x35c · R$ 119,90', href: 'https://', fill: '#111111', color: '#ffcf1a', font: 'ui', fontSize: 15, fontWeight: 600, padding: 12, radius: 2, anim: { in: 'zoom', delay: 0.6, duration: 0.5 } });
    return y + H;
  }, 48);

  const goods: { name: string; text: string; price: string; bg: string; scene: Partial<Scene3D> }[] = [
    { name: 'Farol Raio 400', text: 'USB-C, 400 lúmens e 12 horas de bateria.', price: 'R$ 189,90', bg: '#ffcf1a', scene: { shape: 'capsula', material: 'metal', color: '#111111', color2: '#ffffff', rotX: 0, rotY: 0, rotZ: 90 } },
    { name: 'Campainha Latão', text: 'Som longo e encaixe em guidão de 22 mm.', price: 'R$ 59,90', bg: '#111111', scene: { shape: 'esfera', material: 'metal', color: '#d9a93a', color2: '#ffffff' } },
    { name: 'Pneu Urbano', text: '700x35c com faixa reflexiva e proteção contra furo.', price: 'R$ 119,90', bg: '#ffe680', scene: { shape: 'toro', material: 'fosco', color: '#111111', color2: '#ffcf1a', rotX: 62 } },
    { name: 'Trava em U Cobra', text: 'Aço de 14 mm, duas chaves e suporte para o quadro.', price: 'R$ 149,00', bg: '#ffcf1a', scene: { shape: 'cubo', material: 'metal', color: '#111111', color2: '#ffffff', rotX: 25, rotY: 35 } },
  ];
  section(b, 'Mais vendidos', ARO_WHITE, (y) => {
    let cy = heading(b, 'Mais vendidos da semana', y);
    if (!b.mob) txt(b, 'Ver tudo', 'Ver todos os 86 produtos', b.m + b.cw - 280, y + 14, 280, { font: 'ui', fontSize: 15, fontWeight: 600, align: 'right' });
    const cols = b.mob ? 2 : 4;
    const gap = b.mob ? 16 : 24;
    const cw = Math.floor((b.cw - gap * (cols - 1)) / cols);
    for (let r = 0; r < goods.length; r += cols) {
      let rowH = 0;
      goods.slice(r, r + cols).forEach((g, i) => {
        const x = b.m + i * (cw + gap);
        box(b, `Fundo ${g.name}`, x, cy, cw, cw, g.bg);
        obj3d(b, `Objeto ${g.name}`, x, cy, cw, cw, { spin: 30, float: false, pointer: false, zoom: 0.85, light: 'estudio', ...g.scene }, { anim: { hover: 'lift' } });
        let iy = cy + cw + 16;
        iy += title(b, g.name, g.name, x, iy, cw, b.mob ? 16 : 20, { fontWeight: 600, lineHeight: 1.3 }).h;
        iy += 6 + txt(b, `${g.name}: descrição`, g.text, x, iy + 6, cw, { fontSize: b.mob ? 13 : 15, color: b.t.muted }).h;
        iy += 10 + txt(b, `${g.name}: preço`, g.price, x, iy + 10, cw, { font: 'ui', fontSize: b.mob ? 17 : 20, fontWeight: 700, lineHeight: 1.3 }).h;
        button(b, solid(b, 'Comprar', { anim: { hover: 'lift' } }), x, iy + 16, cw);
        rowH = Math.max(rowH, iy + 16 + 48 - cy);
      });
      cy += rowH + gap;
    }
    return cy - gap;
  });

  section(b, 'Oficina', ARO_BLACK, (y) => {
    const l = col(b, 0, 5);
    const r = col(b, 6, 6);
    let ly = y + title(b, 'Título da oficina', 'Oficina no mesmo endereço.', l.x, y, l.w, b.mob ? 28 : 40).h + 16;
    ly += txt(b, 'Texto da oficina', 'Compre a peça e monte na hora. Os mecânicos atendem de segunda a sábado, das 9h às 18h, sem precisar marcar horário.', l.x, ly, l.w, { color: b.t.muted }).h;
    let cy = b.mob ? ly + 28 : y;
    const rows: [string, string][] = [
      ['Troca de câmara de ar', 'R$ 25'],
      ['Regulagem de freios e marchas', 'R$ 40'],
      ['Instalação de bagageiro e farol', 'R$ 30'],
      ['Revisão completa', 'R$ 180'],
    ];
    const pw = 100;
    for (const [name, price] of rows) {
      box(b, `Serviço ${name}: linha`, r.x, cy, r.w, 1, '#ffcf1a');
      const nh = txt(b, `Serviço ${name}`, name, r.x, cy + 20, r.w - pw, { font: 'ui', fontSize: b.mob ? 17 : 22, fontWeight: 500, lineHeight: 1.3 }).h;
      txt(b, `Serviço ${name}: preço`, price, r.x + r.w - pw, cy + 20, pw, { font: 'mono', fontSize: b.mob ? 17 : 20, fontWeight: 600, color: '#ffcf1a', align: 'right' });
      cy += 20 + nh + 20;
    }
    box(b, 'Serviços: fechamento', r.x, cy, r.w, 1, '#ffcf1a');
    return Math.max(cy, ly);
  });
  ctaBand(b, ARO_YELLOW, 'Não sabe qual peça serve na sua bike?', 'Mande o modelo e o ano da bicicleta. Um mecânico responde em até 2 horas, de segunda a sábado.', { label: 'Chamar a oficina', fill: '#111111', color: '#ffcf1a', href: 'mailto:oficina@aro.bike' });
  footer(b, ARO_WHITE, '© 2026 Aro Bicicletas · Rua dos Pinheiros, 410, São Paulo', 'Trocas · Atendimento · Instagram');
  return finish(b);
}

// ---------- 4. Vão · Portfólio ----------
// Diretor de motion. Direção tipográfica: título enorme que entra linha a linha, trabalhos como quadros de abertura
// de vídeo, cada um de uma cor chapada (lima, preto, azul-gelo, laranja). Um fio 3D de arame reage ao ponteiro.

const VAO: Theme = { accent: '#c6e22b', onAccent: '#0e0e0e', radius: 0 };
const VAO_LIGHT: Tone = { bg: '#f2f3f5', ink: '#0e0e0e', muted: '#55575c', line: '#cfd1d6' };
const VAO_DARK: Tone = { bg: '#0e0e0e', ink: '#f2f3f5', muted: '#a0a2a8', line: '#2c2d31' };
const VAO_LIME: Tone = { bg: '#c6e22b', ink: '#0e0e0e', muted: '#2f3509', line: '#0e0e0e' };

function portfolio(W: number): Doc {
  const b = begin(W, VAO, VAO_LIGHT);
  nav(b, VAO_LIGHT, 'Vão', ['Trabalhos', 'Serviços', 'Contato'], solid(b, 'Enviar briefing', { fill: '#0e0e0e', color: '#f2f3f5', href: 'mailto:oi@vao.studio' }));
  const para = 'Sou Teo Brandão, diretor de motion em São Paulo. Faço aberturas, animação de marca e vídeos explicativos para quem quer que a imagem em movimento pareça parte da marca.';
  section(b, 'Apresentação', VAO_LIGHT, (y) => {
    const knot: Partial<Scene3D> = { shape: 'no', material: 'arame', color: '#0e0e0e', color2: '#0e0e0e', light: 'contraste', rotX: 20, rotY: 30, spin: 24, float: true, zoom: 1, pointer: true };
    if (b.mob) {
      let cy = y + title(b, 'Título', 'Movimento para\nmarcas que não\nficam paradas.', b.m, y, b.cw, 40, { lineHeight: 1.05, anim: up(0) }).h + 20;
      cy += txt(b, 'Resumo', para, b.m, cy, b.cw, { color: b.t.muted, anim: up(0.2) }).h + 24;
      cy = buttons(b, [solid(b, 'Ver trabalhos', { fill: '#0e0e0e', color: '#f2f3f5' })], b.m, cy, b.cw) + 16;
      obj3d(b, 'Nó de arame 3D', b.m, cy, b.cw, 300, knot, { anim: fade(0.4, 0.9) });
      return cy + 300;
    }
    ['Movimento para', 'marcas que não', 'ficam paradas.'].forEach((l, i) =>
      title(b, `Título linha ${i + 1}`, l, b.m, y + i * 104, b.cw, 112, { h: 136, lineHeight: 1, anim: up(i * 0.12, 0.8) }));
    const iy = y + 2 * 104 + 112 + 48;
    const ph = txt(b, 'Resumo', para, b.m, iy, 560, { fontSize: 20, color: b.t.muted, anim: up(0.45) }).h;
    buttons(b, [solid(b, 'Ver trabalhos', { fill: '#0e0e0e', color: '#f2f3f5', anim: up(0.55) }), outline(b, 'Falar comigo', { href: 'mailto:oi@vao.studio' })], b.m, iy + ph + 32, 560);
    obj3d(b, 'Nó de arame 3D', 880, iy - 24, 440, 380, knot, { anim: fade(0.5, 0.9) });
    return Math.max(iy + ph + 32 + 48, iy - 24 + 380);
  }, 64);

  const works = [
    { name: 'Mercado Sul', text: 'Animação do logo, vinhetas e 24 peças para a rede de supermercados do Sul de Minas.', meta: '2026 · Identidade em movimento', fill: '#c6e22b', ink: '#0e0e0e', big: 'Mercado\nSul', size: 120, sizeM: 68 },
    { name: 'Cia. Maré', text: 'Abertura e teaser do espetáculo de dança que estreou no Teatro Sérgio Cardoso.', meta: '2025 · Abertura e teaser', fill: '#0e0e0e', ink: '#c6e22b', big: 'Maré', size: 200, sizeM: 110 },
    { name: 'Rádio Fresta', text: 'Título e trilha visual de uma série documental em sete episódios sobre rádios comunitárias.', meta: '2025 · Série documental', fill: '#b8cdf0', ink: '#0e0e0e', big: 'Fresta', size: 130, sizeM: 80 },
    { name: 'Banco Tuiuiú', text: 'Vídeo explicativo de 90 segundos sobre o novo Pix parcelado, com roteiro e ilustração.', meta: '2024 · Vídeo explicativo', fill: '#ff7a1a', ink: '#0e0e0e', big: '90 s', size: 200, sizeM: 110 },
  ];
  section(b, 'Trabalhos', VAO_LIGHT, (y) => {
    let cy = heading(b, 'Trabalhos recentes', y, { size: b.mob ? 28 : 56 });
    const cols = b.mob ? 1 : 2;
    const gap = b.mob ? 0 : 24;
    const cw = Math.floor((b.cw - gap) / cols);
    const th = b.mob ? 280 : 420;
    for (let r = 0; r < works.length; r += cols) {
      let rowH = 0;
      works.slice(r, r + cols).forEach((w, i) => {
        const x = b.m + i * (cw + gap);
        put(b, 'bloco', `Quadro ${w.name}`, {
          x, y: cy, w: cw, h: th, fill: w.fill, color: w.ink, text: w.big, font: 'ui', fontWeight: 700,
          fontSize: b.mob ? w.sizeM : w.size, lineHeight: 0.95, padding: b.mob ? 20 : 32, radius: 0,
          anim: { in: 'up', delay: i * 0.12, duration: 0.8, hover: 'grow' },
        });
        let iy = cy + th + 16;
        iy += title(b, w.name, w.name, x, iy, cw, 24, { lineHeight: 1.2 }).h;
        iy += 6 + txt(b, `${w.name}: tipo`, w.meta, x, iy + 6, cw, { font: 'mono', fontSize: 13, color: b.t.muted }).h;
        iy += 8 + txt(b, `${w.name}: descrição`, w.text, x, iy + 8, b.mob ? cw : cw - 40, { fontSize: 16, color: b.t.muted }).h;
        rowH = Math.max(rowH, iy - cy);
      });
      cy += rowH + (b.mob ? 40 : 64);
    }
    return cy - (b.mob ? 40 : 64);
  }, 80);

  section(b, 'Serviços', VAO_DARK, (y) => {
    const l = col(b, 0, 4);
    const r = col(b, 5, 7);
    const hd = title(b, 'Título dos serviços', 'O que eu faço.', l.x, y, l.w, b.mob ? 28 : 40).h;
    let cy = b.mob ? y + hd + 28 : y;
    const rows: [string, string, string][] = [
      ['Abertura de série e vinheta', 'Título, trilha e versões para redes e televisão.', 'a partir de R$ 6.000'],
      ['Animação de marca', 'Logo animado, kit de transições e regras de uso.', 'a partir de R$ 4.500'],
      ['Vídeo explicativo', 'Roteiro, ilustração e animação de 60 a 120 segundos.', 'a partir de R$ 9.800'],
      ['Direção de motion', 'Acompanho sua equipe por mês, 10 horas por semana.', 'R$ 7.200 por mês'],
    ];
    for (const [name, text, price] of rows) {
      box(b, `Serviço ${name}: linha`, r.x, cy, r.w, 1, b.t.line);
      cy += 24;
      const ty = cy;
      cy += title(b, `Serviço ${name}`, name, r.x, cy, b.mob ? r.w : r.w - 240, b.mob ? 22 : 28, { lineHeight: 1.2, fontWeight: 600 }).h + 6;
      cy += txt(b, `Serviço ${name}: texto`, text, r.x, cy, b.mob ? r.w : 420, { color: b.t.muted, fontSize: 16 }).h;
      if (b.mob) cy += 6 + txt(b, `Serviço ${name}: preço`, price, r.x, cy + 6, r.w, { font: 'mono', fontSize: 14, color: '#c6e22b' }).h;
      else txt(b, `Serviço ${name}: preço`, price, r.x + r.w - 220, ty + 10, 220, { font: 'mono', fontSize: 14, color: '#c6e22b', align: 'right' });
      cy += 24;
    }
    box(b, 'Serviços: fechamento', r.x, cy, r.w, 1, b.t.line);
    cy += 32;
    cy += txt(b, 'Clientes', 'Mercado Sul · Cia. Maré · Rádio Fresta · Banco Tuiuiú · Casa Lume · Festival Entrelinhas', r.x, cy, r.w, { font: 'mono', fontSize: 14, color: b.t.muted }).h;
    return Math.max(cy, y + hd);
  }, 80);
  ctaBand(b, VAO_LIME, 'Tem um projeto para este trimestre?', 'Pego no máximo três por vez. Mande o briefing e respondo em até dois dias úteis.', { label: 'Enviar briefing', fill: '#0e0e0e', color: '#f2f3f5', href: 'mailto:oi@vao.studio' });
  footer(b, VAO_DARK, '© 2026 Vão Estúdio · oi@vao.studio · São Paulo', 'Instagram · Vimeo · LinkedIn');
  return finish(b);
}

// ---------- 5. Noor · Link na bio ----------
// Artista de música eletrônica. Direção de painel de sintetizador: preto quente e âmbar de LED, quinas suaves e
// números em mono. As barras do espectro são blocos de alturas diferentes que pulsam em tempos diferentes.

const NOOR: Theme = { accent: '#ffa51f', onAccent: '#0c0c0f', radius: 10 };
const NOOR_DARK: Tone = { bg: '#0c0c0f', ink: '#f1efe9', muted: '#8f8e96', line: '#2a2a31' };
const BARS = [30, 52, 78, 64, 96, 70, 42, 88, 110, 76, 50, 84, 38, 24, 60, 92, 46, 72, 34, 58, 100, 66, 40, 28];

function bio(W: number): Doc {
  const b = begin(W, NOOR, NOOR_DARK);
  section(b, 'Perfil', NOOR_DARK, (y) => {
    const lw = b.mob ? b.cw : 640;
    const rx = b.mob ? b.m : 880;
    const rw = b.mob ? b.cw : 440;
    let cy = y;
    // Botão de sintetizador no lugar da foto: aro âmbar, miolo preto e um ponteiro.
    const ks = b.mob ? 88 : 72;
    const kx = b.mob ? Math.round((W - ks) / 2) : b.m;
    box(b, 'Botão', kx, cy, ks, ks, '#ffa51f', { radius: ks / 2, anim: { in: 'zoom', duration: 0.6 } });
    box(b, 'Botão: miolo', kx + Math.round(ks * 0.16), cy + Math.round(ks * 0.16), Math.round(ks * 0.68), Math.round(ks * 0.68), '#0c0c0f', { radius: ks / 2, anim: { in: 'zoom', duration: 0.6 } });
    box(b, 'Botão: ponteiro', kx + ks / 2 - 3, cy + Math.round(ks * 0.2), 6, Math.round(ks * 0.3), '#ffa51f', { radius: 3, anim: { in: 'zoom', duration: 0.6 } });
    cy += ks + (b.mob ? 20 : 28);
    const al: Partial<El> = b.mob ? { align: 'center' } : {};
    cy += title(b, 'Nome', b.mob ? 'Noor Valente' : 'Noor\nValente', b.m, cy, lw, b.mob ? 34 : 128, { lineHeight: b.mob ? 1.2 : 1, anim: up(0.1), ...(b.mob ? {} : { h: 280 }), ...al }).h + (b.mob ? 8 : 24);
    const bioText = 'Música eletrônica feita em sintetizadores analógicos, direto de Recife. O disco novo, Fase Lenta, está em todas as plataformas.';
    cy += txt(b, 'Bio', bioText, b.m, cy, b.mob ? lw : 480, { fontSize: b.mob ? 16 : 20, color: b.t.muted, anim: up(0.2), ...al }).h + (b.mob ? 28 : 48);

    // Painel com o espectro.
    const n = b.mob ? 14 : 24;
    const bw = b.mob ? 14 : 14;
    const gap = b.mob ? 8 : 10;
    const ph = b.mob ? 164 : 264;
    box(b, 'Painel do espectro', b.m, cy, lw, ph, '#17171c', { radius: 10, borderWidth: 1, borderColor: b.t.line });
    txt(b, 'Painel: faixa', 'Fase Lenta · faixa 03', b.m + 20, cy + 16, lw - 120, { font: 'mono', fontSize: 13, color: b.t.muted });
    txt(b, 'Painel: tempo', '03:42', b.m + lw - 100, cy + 16, 80, { font: 'mono', fontSize: 13, color: '#ffa51f', align: 'right' });
    const total = n * bw + (n - 1) * gap;
    const k = (b.mob ? 88 : 150) / 110;
    BARS.slice(0, n).forEach((v, i) => {
      const h = Math.round(v * k);
      box(b, `Barra ${i + 1}`, b.m + Math.round((lw - total) / 2) + i * (bw + gap), cy + ph - 24 - h, bw, h, v > 80 ? '#ffd27a' : '#ffa51f', {
        radius: 3, anim: { loop: 'pulse', loopDuration: 1 + ((i * 7) % 11) / 10 },
      });
    });
    const leftBottom = cy + ph;

    // Links e agenda.
    let ry = b.mob ? leftBottom + 32 : y;
    const links = [
      ['Ouvir Fase Lenta no Spotify', true],
      ['Comprar o vinil · R$ 140', false],
      ['Assistir ao show no Sesc Pompeia', false],
      ['Ver a agenda da turnê', false],
      ['Receber novidades por e-mail', false],
    ] as const;
    const lh = b.mob ? 56 : 60;
    links.forEach(([l, primary], i) => {
      put(b, 'link', `Link ${l}`, {
        x: rx, y: ry, w: rw, h: lh, text: l, href: l.includes('e-mail') ? 'mailto:booking@noorvalente.com' : 'https://', font: 'ui', fontSize: 16, fontWeight: 600,
        radius: 10, padding: b.mob ? 15 : 17, anim: up(0.3 + i * 0.07, 0.6),
        ...(primary ? { fill: '#ffa51f', color: '#0c0c0f' } : { fill: '#17171c', color: b.t.ink, borderWidth: 1, borderColor: b.t.line }),
      });
      ry += lh + 12;
    });
    ry += b.mob ? 20 : 28;
    ry += title(b, 'Agenda: título', 'Próximas datas', rx, ry, rw, 22, { lineHeight: 1.2 }).h + 8;
    const dates = [
      ['12 dez', 'Teatro do Parque', 'Recife · PE'],
      ['19 dez', 'Sesc Pompeia', 'São Paulo · SP'],
      ['17 jan', 'Circo Voador', 'Rio de Janeiro · RJ'],
    ];
    for (const [d, venue, city] of dates) {
      box(b, `Data ${d}: linha`, rx, ry, rw, 1, b.t.line);
      txt(b, `Data ${d}`, d, rx, ry + 16, 84, { font: 'mono', fontSize: 16, fontWeight: 600, color: '#ffa51f' });
      txt(b, `Data ${d}: local`, venue, rx + 96, ry + 12, rw - 96, { font: 'ui', fontSize: 16, fontWeight: 500, lineHeight: 1.3 });
      txt(b, `Data ${d}: cidade`, city, rx + 96, ry + 12 + 21, rw - 96, { fontSize: 14, color: b.t.muted, lineHeight: 1.3 });
      ry += 64;
    }
    box(b, 'Agenda: fechamento', rx, ry, rw, 1, b.t.line);
    ry += 28;
    ry += txt(b, 'Contato', 'Contato para shows: booking@noorvalente.com', rx, ry, rw, { fontSize: 14, color: b.t.muted, ...al }).h;
    return Math.max(ry, leftBottom);
  }, 64);
  b.d.height = Math.max(Math.round(b.y), b.mob ? 844 : 900);
  return b.d;
}

// ---------- 6. Pauta · App ----------
// App de agenda para quem trabalha por conta própria. Direção de produto sóbria: branco, cinza-azulado e o azul de
// tinta de caneta como cor de ação; as quatro cores dos compromissos só aparecem dentro da tela do app,
// que é montada com blocos e textos e é a peça central da página.

const PAUTA: Theme = { accent: '#1f3a5f', onAccent: '#ffffff', radius: 8 };
const PAUTA_WHITE: Tone = { bg: '#ffffff', ink: '#16181d', muted: '#5d6370', line: '#dcdfe5' };
const PAUTA_SOFT: Tone = { bg: '#f1f3f6', ink: '#16181d', muted: '#566070', line: '#d6dae1' };
const PAUTA_INK: Tone = { bg: '#1f3a5f', ink: '#ffffff', muted: '#bccadf', line: '#37557f' };
const EV = {
  blue: ['#dce8fb', '#2f6fd6'],
  orange: ['#fbe6d0', '#d9801f'],
  teal: ['#d2f0ec', '#17a398'],
  rose: ['#f8dbe3', '#d9486b'],
} as const;
type Ev = [day: number, start: number, dur: number, title: string, color: keyof typeof EV];
const WEEK: Ev[] = [
  [0, 9, 1, 'Daily do time', 'blue'], [0, 11, 2, 'Foco: proposta', 'teal'], [0, 14, 1, 'Dentista', 'rose'],
  [1, 10, 1.5, 'Café com Rui', 'orange'], [1, 13, 1, 'Almoço com Bia', 'rose'],
  [2, 9, 2, 'Entrega do layout', 'blue'], [2, 12, 1, 'Ligar contador', 'orange'], [2, 13, 1, 'Aula de inglês', 'teal'], [2, 14, 1.5, 'Reunião com Ana', 'rose'],
  [3, 11, 1, '1:1 com Caio', 'blue'], [3, 13, 2, 'Foco: relatório', 'teal'],
  [4, 9, 1, 'Pagar boletos', 'orange'], [4, 12, 1.5, 'Feira de design', 'rose'],
];

function event(b: B, x: number, y: number, w: number, h: number, ev: Ev, size: number, a: Anim): El {
  const [tint, strong] = EV[ev[4]];
  return put(b, 'bloco', `Compromisso ${ev[3]}`, {
    x, y, w, h, fill: tint, color: '#16181d', text: ev[3], font: 'ui', fontSize: size, fontWeight: 500, lineHeight: 1.3,
    padding: 7, radius: 6, borderWidth: 1, borderColor: strong, anim: a,
  });
}

/** Semana inteira, para o desktop. */
function weekView(b: B, x: number, y: number, w: number): number {
  const pad = 24;
  const gut = 44;
  const colW = Math.floor((w - 2 * pad - gut) / 5);
  const gx = x + pad + gut;
  const st = fade(0.1, 0.6);
  const card = box(b, 'Tela do app', x, y, w, 0, '#ffffff', { radius: 12, borderWidth: 1, borderColor: b.t.line, anim: st });
  let cy = y + 20;
  title(b, 'App: período', 'Semana de 17 a 21 de novembro', x + pad, cy + 2, w - 2 * pad - 90, 17, { lineHeight: 1.3, fontWeight: 600, anim: st });
  put(b, 'link', 'App: hoje', { x: x + w - pad - 72, y: cy, w: 72, h: 32, text: 'Hoje', href: 'https://', font: 'ui', fontSize: 14, fontWeight: 600, padding: 6, radius: 6, fill: '', color: '#16181d', borderWidth: 1, borderColor: b.t.line, anim: st });
  cy += 32 + 16;
  ['Seg 17', 'Ter 18', 'Qua 19', 'Qui 20', 'Sex 21'].forEach((d, i) => {
    const today = i === 2;
    put(b, 'bloco', `App: ${d}`, {
      x: gx + i * colW + (today ? Math.round((colW - 68) / 2) : 0), y: cy, w: today ? 68 : colW, h: 28, text: d, font: 'ui', fontSize: 13, fontWeight: 600, align: 'center',
      padding: 4, radius: 14, fill: today ? b.th.accent : '', color: today ? '#ffffff' : b.t.muted, anim: st,
    });
  });
  cy += 28 + 8;
  const gridTop = cy;
  const rows = 7;
  for (let h = 0; h < rows; h++) {
    box(b, `App: hora ${9 + h}`, gx, gridTop + h * 56, colW * 5, 1, b.t.line, { anim: st });
    txt(b, `App: rótulo ${9 + h}h`, `${String(9 + h).padStart(2, '0')}h`, x + pad, gridTop + h * 56 - 8, 36, { font: 'mono', fontSize: 12, color: b.t.muted, anim: st });
  }
  WEEK.forEach((ev, i) => {
    event(b, gx + ev[0] * colW + 3, gridTop + (ev[1] - 9) * 56 + 3, colW - 6, ev[2] * 56 - 6, ev, 12, { in: 'zoom', delay: 0.5 + i * 0.08, duration: 0.45 });
  });
  // Marca do momento atual, quarta às 11h20.
  const ny = gridTop + Math.round(2.33 * 56);
  box(b, 'App: agora', gx + 2 * colW, ny, colW, 2, '#d9486b', { anim: st });
  box(b, 'App: agora ponto', gx + 2 * colW - 4, ny - 3, 8, 8, '#d9486b', { radius: 4, anim: st });
  card.h = gridTop + rows * 56 + 20 - y;
  return y + card.h;
}

/** Um dia, para o mobile. */
function dayView(b: B, x: number, y: number, w: number): number {
  const pad = 16;
  const gut = 40;
  const st = fade(0.1, 0.6);
  const card = box(b, 'Tela do app', x, y, w, 0, '#ffffff', { radius: 12, borderWidth: 1, borderColor: b.t.line, anim: st });
  let cy = y + 16;
  title(b, 'App: dia', 'Quarta, 19 de novembro', x + pad, cy, w - 2 * pad, 18, { lineHeight: 1.3, fontWeight: 600, anim: st });
  cy += 26 + 12;
  const cw = Math.floor((w - 2 * pad - 4 * 6) / 5);
  ['Seg\n17', 'Ter\n18', 'Qua\n19', 'Qui\n20', 'Sex\n21'].forEach((d, i) => {
    const on = i === 2;
    put(b, 'bloco', `App: ${d.replace('\n', ' ')}`, {
      x: x + pad + i * (cw + 6), y: cy, w: cw, h: 48, text: d, font: 'ui', fontSize: 13, fontWeight: 600, lineHeight: 1.3, align: 'center',
      padding: 5, radius: 8, fill: on ? b.th.accent : '#f1f3f6', color: on ? '#ffffff' : b.t.muted, anim: st,
    });
  });
  cy += 48 + 16;
  const gridTop = cy;
  const gx = x + pad + gut;
  const ew = w - 2 * pad - gut;
  for (let h = 0; h < 7; h++) {
    box(b, `App: hora ${9 + h}`, gx, gridTop + h * 52, ew, 1, b.t.line, { anim: st });
    txt(b, `App: rótulo ${9 + h}h`, `${String(9 + h).padStart(2, '0')}h`, x + pad, gridTop + h * 52 - 8, 34, { font: 'mono', fontSize: 12, color: b.t.muted, anim: st });
  }
  WEEK.filter((e) => e[0] === 2).forEach((ev, i) => {
    event(b, gx + 2, gridTop + (ev[1] - 9) * 52 + 3, ew - 4, ev[2] * 52 - 6, ev, 14, { in: 'zoom', delay: 0.5 + i * 0.1, duration: 0.45 });
  });
  card.h = gridTop + 7 * 52 + 16 - y;
  return y + card.h;
}

/** Cartão de agendamento: o que o cliente vê ao abrir o link. */
function booking(b: B, x: number, y: number, w: number): number {
  const pad = b.mob ? 20 : 28;
  const ix = x + pad;
  const iw = w - 2 * pad;
  const st = fade(0, 0.6);
  const card = box(b, 'Cartão de agendamento', x, y, w, 0, '#ffffff', { radius: 12, borderWidth: 1, borderColor: b.t.line, anim: st });
  let cy = y + pad;
  cy += title(b, 'Agendamento: título', 'Conversa com Júlia Reis', ix, cy, iw, 20, { lineHeight: 1.3, fontWeight: 600, anim: st }).h + 4;
  cy += txt(b, 'Agendamento: data', 'Quinta, 20 de novembro · 30 minutos', ix, cy, iw, { fontSize: 14, color: b.t.muted, anim: st }).h + 20;
  const gap = 10;
  const sw = Math.floor((iw - 2 * gap) / 3);
  ['09:00', '09:30', '10:30', '14:00', '15:30', '16:00'].forEach((s, i) => {
    const on = i === 2;
    put(b, 'link', `Horário ${s}`, {
      x: ix + (i % 3) * (sw + gap), y: cy + Math.floor(i / 3) * 52, w: sw, h: 44, text: s, href: 'https://', font: 'mono', fontSize: 15, fontWeight: 600, padding: 11, radius: 8,
      ...(on ? { fill: b.th.accent, color: '#ffffff' } : { fill: '', color: '#16181d', borderWidth: 1, borderColor: b.t.line }), anim: st,
    });
  });
  cy += 52 + 44 + 20;
  button(b, solid(b, 'Confirmar às 10:30', { anim: st }), ix, cy, iw);
  cy += 48 + pad;
  card.h = cy - y;
  return cy;
}

/** Dois avisos empilhados: conflito de horários e lembrete. */
function alerts(b: B, x: number, y: number, w: number): number {
  const pad = b.mob ? 20 : 24;
  const ix = x + pad;
  const iw = w - 2 * pad;
  let cy = y;
  const one = (dot: string, head: string, text: string, acts: [string, boolean][], a: Anim) => {
    const card = box(b, `Aviso ${head}`, x, cy, w, 0, '#ffffff', { radius: 12, borderWidth: 1, borderColor: b.t.line, anim: a });
    let iy = cy + pad;
    box(b, `Aviso ${head}: marca`, ix, iy + 7, 10, 10, dot, { radius: 5, anim: a });
    iy += title(b, `Aviso ${head}: título`, head, ix + 22, iy, iw - 22, 17, { lineHeight: 1.4, fontWeight: 600, anim: a }).h + 4;
    iy += txt(b, `Aviso ${head}: texto`, text, ix + 22, iy, iw - 22, { fontSize: 14, color: b.t.muted, anim: a }).h + 14;
    if (acts.length) {
      const bw = Math.floor((iw - 22 - 10) / 2);
      acts.forEach(([l, primary], i) =>
        put(b, 'link', `Aviso ${head}: ${l}`, {
          x: ix + 22 + i * (bw + 10), y: iy, w: bw, h: 40, text: l, href: 'https://', font: 'ui', fontSize: 14, fontWeight: 600, padding: 9, radius: 8,
          ...(primary ? { fill: b.th.accent, color: '#ffffff' } : { fill: '', color: '#16181d', borderWidth: 1, borderColor: b.t.line }), anim: a,
        }));
      iy += 40 + 4;
    } else iy -= 10;
    card.h = iy + pad - cy;
    cy += card.h + 16;
  };
  one('#d9486b', 'Conflito na quarta, 14h', 'A aula de inglês e a reunião com Ana começam no mesmo horário.', [['Mover a aula', true], ['Manter os dois', false]], fade(0, 0.6));
  one('#17a398', 'Daqui a 15 minutos', 'Entrega do layout, das 9h às 11h.', [], fade(0.4, 0.6));
  return cy - 16;
}

function plan(b: B, x: number, y: number, w: number, name: string, price: string, per: string, items: string[], btn: Btn, dark: boolean): number {
  const pad = b.mob ? 24 : 32;
  const ink = dark ? '#ffffff' : '#16181d';
  const muted = dark ? '#bccadf' : '#5d6370';
  const card = box(b, `Plano ${name}`, x, y, w, 0, dark ? '#1f3a5f' : '#ffffff', { radius: 12, ...(dark ? {} : { borderWidth: 1, borderColor: '#dcdfe5' }) });
  let cy = y + pad;
  cy += title(b, `Plano ${name}: nome`, name, x + pad, cy, w - 2 * pad, 22, { color: ink, lineHeight: 1.3, fontWeight: 600 }).h + 8;
  cy += title(b, `Plano ${name}: preço`, price, x + pad, cy, w - 2 * pad, b.mob ? 44 : 56, { color: ink }).h + 2;
  cy += txt(b, `Plano ${name}: período`, per, x + pad, cy, w - 2 * pad, { fontSize: 15, color: muted }).h + 20;
  for (const it of items) {
    box(b, `Plano ${name}: marca`, x + pad, cy + 9, 7, 7, dark ? '#ffffff' : '#1f3a5f', { radius: 4 });
    cy += txt(b, `Plano ${name}: ${it}`, it, x + pad + 20, cy, w - 2 * pad - 20, { fontSize: 16, color: ink }).h + 10;
  }
  cy += 14;
  button(b, btn, x + pad, cy, w - 2 * pad);
  cy += 48 + pad;
  card.h = cy - y;
  return cy;
}

function app(W: number): Doc {
  const b = begin(W, PAUTA, PAUTA_WHITE);
  nav(b, PAUTA_WHITE, 'Pauta', ['Como funciona', 'Planos', 'Ajuda'], solid(b, 'Testar grátis'));
  section(b, 'Destaque', PAUTA_WHITE, (y) => {
    const t = 'Sua semana inteira,\nsem uma reunião em\ncima da outra.';
    const sub = 'A Pauta junta Google Agenda, Outlook e os horários que você oferece a clientes, e avisa antes de dois compromissos baterem.';
    const note = 'Para Android, iPhone e navegador. Sem cartão de crédito.';
    if (b.mob) {
      let cy = y + title(b, 'Título', t.replace(/\n/g, ' '), b.m, y, b.cw, 36, { anim: up(0) }).h + 16;
      cy += txt(b, 'Texto do destaque', sub, b.m, cy, b.cw, { color: b.t.muted, anim: up(0.1) }).h + 24;
      cy = buttons(b, [solid(b, 'Testar grátis por 30 dias', { anim: up(0.2) }), outline(b, 'Ver os planos')], b.m, cy, b.cw) + 16;
      cy += txt(b, 'Nota do destaque', note, b.m, cy, b.cw, { fontSize: 14, color: b.t.muted }).h + 32;
      return dayView(b, b.m, cy, b.cw);
    }
    const lw = 600;
    let cy = y + 16;
    cy += title(b, 'Título', t, b.m, cy, lw, 52, { anim: up(0) }).h + 24;
    cy += txt(b, 'Texto do destaque', sub, b.m, cy, 500, { fontSize: 20, color: b.t.muted, anim: up(0.1) }).h + 36;
    cy = buttons(b, [solid(b, 'Testar grátis por 30 dias', { anim: up(0.2) }), outline(b, 'Ver os planos')], b.m, cy, lw) + 20;
    txt(b, 'Nota do destaque', note, b.m, cy, lw, { fontSize: 14, color: b.t.muted });
    return weekView(b, 732, y, 588);
  }, 56);

  section(b, 'Recursos', PAUTA_SOFT, (y) => {
    const l = col(b, 0, 5);
    const r = col(b, 6, 6);
    // Primeiro recurso: texto à esquerda, tela à direita.
    let ty = y + title(b, 'Título agendamento', 'Cada cliente escolhe um horário que sobra para você.', l.x, y, l.w, b.mob ? 28 : 36, an(b.mob ? undefined : up(0))).h + 16;
    ty += txt(b, 'Texto agendamento', 'Mande um link: a pessoa vê só os horários livres da sua agenda e confirma em dois toques. Você define dias, duração e intervalo entre reuniões.', l.x, ty, l.w, { color: b.t.muted }).h;
    let cy = b.mob ? booking(b, b.m, ty + 24, b.cw) : Math.max(ty, booking(b, r.x, y, r.w));
    cy += b.mob ? 56 : 96;
    // Segundo recurso: tela à esquerda, texto à direita.
    const t2 = col(b, 7, 5);
    const a2 = col(b, 0, 6);
    let sy = cy + title(b, 'Título avisos', 'Aviso antes de duas coisas baterem.', t2.x, cy, t2.w, b.mob ? 28 : 36).h + 16;
    sy += txt(b, 'Texto avisos', 'Se um convite novo cair em cima de algo que já existe, a Pauta mostra os dois lado a lado e sugere o próximo horário livre. Também avisa 15 minutos antes de cada compromisso.', t2.x, sy, t2.w, { color: b.t.muted }).h;
    if (b.mob) return alerts(b, b.m, sy + 24, b.cw);
    return Math.max(sy, alerts(b, a2.x, cy, a2.w));
  }, 80);

  section(b, 'Planos', PAUTA_WHITE, (y) => {
    const cy = heading(b, 'Dois planos, sem fidelidade.', y);
    const a = col(b, 0, 6);
    const c = col(b, 6, 6);
    const free = ['Uma agenda conectada', 'Link de agendamento', 'Avisos de conflito'];
    const pro = ['Agendas ilimitadas', 'Equipe de até 5 pessoas', 'Relatório de horas por cliente'];
    const h1 = plan(b, a.x, cy, a.w, 'Básico', 'R$ 0', 'para sempre', free, outline(b, 'Começar no Básico'), false);
    const h2 = plan(b, c.x, b.mob ? h1 + 16 : cy, c.w, 'Pró', 'R$ 19', 'por mês, 30 dias grátis', pro, { label: 'Testar o Pró', fill: '#ffffff', color: '#1f3a5f' }, true);
    return Math.max(h1, h2);
  });
  ctaBand(b, PAUTA_INK, 'Comece a semana com a agenda em ordem.', 'Trinta dias do plano Pró de graça. Se não gostar, a conta volta ao Básico sozinha.', { label: 'Testar a Pauta', fill: '#ffffff', color: '#1f3a5f' });
  footer(b, PAUTA_SOFT, '© 2026 Pauta Agenda · ajuda@pauta.app', 'Instagram · LinkedIn · Termos');
  return finish(b);
}

export type Template = {
  id: string;
  name: string;
  /** Versão que abre primeiro no editor. */
  start: 'desktop' | 'mobile';
  /** Sem `build`, a página começa vazia. */
  build?: (width: number) => Doc;
};

export const TEMPLATES: Template[] = [
  { id: 'branco', name: 'Em branco', start: 'desktop' },
  { id: 'landing', name: 'Pitanga · Landing', start: 'desktop', build: landing },
  { id: 'catalogo', name: 'Forno Baixo · Catálogo', start: 'desktop', build: catalog },
  { id: 'loja', name: 'Aro · Loja', start: 'desktop', build: store },
  { id: 'portfolio', name: 'Vão · Portfólio', start: 'desktop', build: portfolio },
  { id: 'bio', name: 'Noor · Link na bio', start: 'mobile', build: bio },
  { id: 'app', name: 'Pauta · App', start: 'desktop', build: app },
];

/** Documento completo do modelo: desktop com a versão mobile desenhada à parte. */
export function templateDoc(t: Template): Doc | null {
  if (!t.build) return null;
  return { ...t.build(DESKTOP_WIDTH), mobile: t.build(MOBILE_WIDTH) };
}
