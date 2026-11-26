import { createElement, type Doc, type El, type ElementType } from './doc';

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

const INK = '#000000';
const MUTED = '#5c5c5c';
const SOFT = '#f2f2f2';
const PLACEHOLDER = '#e3e3e3';
const LINE = '#d4d4d4';

/** Construtor de um quadro (desktop ou mobile). `y` é onde a próxima seção começa. */
type B = { d: Doc; y: number; W: number; m: number; cw: number; mob: boolean };
type Btn = { label: string; primary?: boolean; invert?: boolean; href?: string };
type Card = { name: string; text?: string; meta?: string; price?: string };

function begin(W: number): B {
  const mob = W < 600;
  const m = mob ? 20 : 120;
  return { d: { version: 1, width: W, height: 0, background: '#ffffff', elements: [] }, y: 0, W, m, cw: W - 2 * m, mob };
}

function put(b: B, type: ElementType, name: string, props: Partial<El>): El {
  const e = createElement(type, b.d, 0, 0, { name, ...props });
  e.x = Math.round(e.x);
  e.y = Math.round(e.y);
  e.w = Math.round(e.w);
  b.d.elements.push(e);
  return e;
}

function txt(b: B, name: string, text: string, x: number, y: number, w: number, o: Partial<El> = {}): El {
  const fontSize = o.fontSize ?? 17;
  const lineHeight = o.lineHeight ?? 1.5;
  return put(b, 'texto', name, {
    text, x, y, w, h: textHeight(text, fontSize, lineHeight, w, o.padding ?? 0),
    font: 'text', fontSize, fontWeight: 400, lineHeight, color: INK, ...o,
  });
}

const title = (b: B, name: string, text: string, x: number, y: number, w: number, size: number, o: Partial<El> = {}) =>
  txt(b, name, text, x, y, w, { font: 'ui', fontSize: size, fontWeight: 700, lineHeight: 1.1, ...o });

const img = (b: B, name: string, x: number, y: number, w: number, h: number, o: Partial<El> = {}) =>
  put(b, 'imagem', name, { x, y, w, h, fill: PLACEHOLDER, ...o });

const btnW = (label: string) => Math.max(140, Math.ceil(label.length * 16 * 0.62) + 48);

function button(b: B, bt: Btn, x: number, y: number, w: number): El {
  const style: Partial<El> = bt.invert
    ? { fill: '#ffffff', color: INK }
    : bt.primary
      ? { fill: INK, color: '#ffffff' }
      : { fill: '', color: INK, borderWidth: 1, borderColor: INK, padding: 11 };
  return put(b, 'link', `Botão ${bt.label}`, { x, y, w, h: 48, text: bt.label, href: bt.href ?? 'https://', radius: 6, ...style });
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
function section(b: B, name: string, fill: string, body: (y: number) => number, pad = 96) {
  const p = b.mob ? Math.round(pad / 2) : pad;
  const s = put(b, 'secao', name, { x: 0, y: b.y, w: b.W, h: 0, fill, padding: 0 });
  s.h = Math.round(body(b.y + p) + p - b.y);
  b.y += s.h;
}

function nav(b: B, brand: string, links: string[], cta?: Btn) {
  const h = b.mob ? 64 : 80;
  const y = b.y;
  put(b, 'secao', 'Navegação', { x: 0, y, w: b.W, h, fill: '#ffffff', padding: 0 });
  put(b, 'bloco', 'Linha da navegação', { x: 0, y: y + h - 1, w: b.W, h: 1, fill: LINE, radius: 0, padding: 0 });
  txt(b, 'Marca', brand, b.m, y + (h - 28) / 2, 260, { font: 'ui', fontSize: 22, fontWeight: 700, lineHeight: 1.25 });
  if (b.mob) {
    txt(b, 'Menu', 'Menu', b.W - b.m - 80, y + (h - 24) / 2, 80, { font: 'ui', fontSize: 16, fontWeight: 500, align: 'right' });
  } else {
    let right = b.W - b.m;
    if (cta) {
      const w = btnW(cta.label);
      button(b, cta, right - w, y + (h - 48) / 2, w);
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
}

function hero(b: B, o: { title: string; sub: string; actions: Btn[]; image: string; fill?: string; size?: number }) {
  section(b, 'Destaque', o.fill ?? '#ffffff', (y) => {
    if (b.mob) {
      let cy = y + title(b, 'Título', o.title, b.m, y, b.cw, 38).h + 16;
      cy += txt(b, 'Texto do destaque', o.sub, b.m, cy, b.cw, { color: MUTED }).h + 24;
      cy = buttons(b, o.actions, b.m, cy, b.cw) + 32;
      img(b, o.image, b.m, cy, b.cw, 280);
      return cy + 280;
    }
    const size = o.size ?? 64;
    const colW = Math.round(b.cw * 0.46);
    const imgW = Math.round(b.cw * 0.48);
    const imgH = 540;
    const th = textHeight(o.title, size, 1.1, colW);
    const sh = textHeight(o.sub, 20, 1.5, colW);
    let cy = y + Math.max(0, (imgH - (th + 20 + sh + 40 + 48)) / 2);
    cy += title(b, 'Título', o.title, b.m, cy, colW, size).h + 20;
    cy += txt(b, 'Texto do destaque', o.sub, b.m, cy, colW, { fontSize: 20, color: MUTED }).h + 40;
    buttons(b, o.actions, b.m, cy, colW);
    img(b, o.image, b.W - b.m - imgW, y, imgW, imgH);
    return y + imgH;
  });
}

function heading(b: B, text: string, y: number, sub?: string, center = false): number {
  const o: Partial<El> = center ? { align: 'center' } : {};
  let cy = y + title(b, `Título: ${text}`, text, b.m, y, center ? b.cw : Math.min(b.cw, 760), b.mob ? 28 : 40, o).h;
  if (sub) cy += 12 + txt(b, `Texto: ${text}`, sub, b.m, cy + 12, center ? b.cw : Math.min(b.cw, 640), { color: MUTED, ...o }).h;
  return cy + (b.mob ? 28 : 48);
}

/** Grade de cartões: imagem opcional no topo, nome, texto, preço e botão. Devolve o y de baixo. */
function cards(
  b: B, y0: number, items: Card[], cols: number,
  o: { ratio?: number; boxed?: string; button?: Btn } = {},
): number {
  const gap = b.mob ? 16 : 24;
  const colW = Math.floor((b.cw - gap * (cols - 1)) / cols);
  const small = colW < 200;
  let y = y0;
  for (let r = 0; r < items.length; r += cols) {
    let rowH = 0;
    const boxes: El[] = [];
    items.slice(r, r + cols).forEach((it, i) => {
      const x = b.m + i * (colW + gap);
      const pad = o.boxed ? (small ? 16 : 28) : 0;
      if (o.boxed) boxes.push(put(b, 'bloco', `Cartão ${it.name}`, { x, y, w: colW, h: 0, fill: o.boxed, radius: 8, padding: 0 }));
      const ix = x + pad;
      const iw = colW - 2 * pad;
      let cy = y + pad;
      if (o.ratio) {
        const ih = Math.round(colW * o.ratio);
        img(b, `Imagem ${it.name}`, x, y, colW, ih, { radius: o.boxed ? 8 : 0 });
        cy = y + ih + 16;
      }
      cy += title(b, it.name, it.name, ix, cy, iw, small ? 17 : 20, { fontWeight: 600, lineHeight: 1.3 }).h;
      if (it.meta) cy += 4 + txt(b, `${it.name}: categoria`, it.meta, ix, cy + 4, iw, { fontSize: 14, color: MUTED }).h;
      if (it.text) cy += 8 + txt(b, `${it.name}: descrição`, it.text, ix, cy + 8, iw, { fontSize: small ? 14 : 15, color: MUTED }).h;
      if (it.price) cy += 10 + txt(b, `${it.name}: preço`, it.price, ix, cy + 10, iw, { font: 'ui', fontSize: 18, fontWeight: 700, lineHeight: 1.3 }).h;
      if (o.button) {
        button(b, o.button, ix, cy + 16, iw);
        cy += 16 + 48;
      }
      rowH = Math.max(rowH, cy + pad - y);
    });
    for (const box of boxes) box.h = rowH;
    y += rowH + gap;
  }
  return y - gap;
}

function chips(b: B, labels: string[], y: number): number {
  let x = b.m;
  let cy = y;
  labels.forEach((l, i) => {
    const w = Math.ceil(l.length * 14 * 0.62) + 36;
    if (x + w > b.m + b.cw) {
      x = b.m;
      cy += 44;
    }
    const style: Partial<El> = i === 0 ? { fill: INK, color: '#ffffff' } : { fill: '', color: INK, borderWidth: 1, borderColor: LINE };
    put(b, 'link', `Filtro ${l}`, { x, y: cy, w, h: 36, text: l, href: 'https://', fontSize: 14, fontWeight: 500, padding: 6, radius: 18, ...style });
    x += w + 8;
  });
  return cy + 36;
}

function ctaBand(b: B, head: string, sub: string, action: Btn) {
  section(b, 'Chamada final', INK, (y) => {
    let cy = y + title(b, 'Título da chamada', head, b.m, y, b.cw, b.mob ? 30 : 48, { color: '#ffffff', align: 'center' }).h + 16;
    cy += txt(b, 'Texto da chamada', sub, b.m, cy, b.cw, { color: '#bdbdbd', align: 'center' }).h + 32;
    return buttons(b, [{ ...action, invert: true }], b.m, cy, b.cw, true);
  });
}

function footer(b: B, left: string, right: string) {
  section(b, 'Rodapé', SOFT, (y) => {
    if (b.mob) {
      const h = txt(b, 'Rodapé: contato', left, b.m, y, b.cw, { fontSize: 14, color: MUTED }).h;
      return y + h + 8 + txt(b, 'Rodapé: redes', right, b.m, y + h + 8, b.cw, { fontSize: 14, color: MUTED }).h;
    }
    const half = Math.round(b.cw / 2);
    const h = txt(b, 'Rodapé: contato', left, b.m, y, half, { fontSize: 14, color: MUTED }).h;
    txt(b, 'Rodapé: redes', right, b.m + half, y, half, { fontSize: 14, color: MUTED, align: 'right' });
    return y + h;
  }, 48);
}

function finish(b: B): Doc {
  b.d.height = Math.round(b.y);
  return b.d;
}

// ---------- os modelos ----------

function landing(W: number): Doc {
  const b = begin(W);
  nav(b, 'Sua marca', ['Produto', 'Preços', 'Contato'], { label: 'Começar', primary: true });
  hero(b, {
    title: 'Diga em uma frase o que você oferece',
    sub: 'Explique em duas linhas para quem é e qual problema resolve. Quem lê precisa entender o que ganha.',
    actions: [{ label: 'Começar agora', primary: true }, { label: 'Ver como funciona' }],
    image: 'Imagem do produto',
  });
  section(b, 'Benefícios', SOFT, (y) =>
    cards(b, heading(b, 'Por que escolher', y), [
      { name: 'Rápido de usar', text: 'Descreva o primeiro benefício com um exemplo concreto do dia a dia.' },
      { name: 'Feito para o seu caso', text: 'Mostre o que muda para quem usa, não só o que o produto tem.' },
      { name: 'Suporte de verdade', text: 'Conte como a pessoa é atendida quando precisa de ajuda.' },
    ], b.mob ? 1 : 3, { boxed: '#ffffff' }),
  );
  section(b, 'Depoimento', '#ffffff', (y) => {
    const q = title(b, 'Citação', '“Troque este texto pelo depoimento de um cliente real, com uma frase que mostre o resultado.”', b.m, y, b.mob ? b.cw : 920, b.mob ? 22 : 34, { fontWeight: 500, lineHeight: 1.3 });
    return y + q.h + 20 + txt(b, 'Autor', 'Nome do cliente · Empresa', b.m, y + q.h + 20, b.cw, { fontSize: 15, color: MUTED }).h;
  });
  ctaBand(b, 'Pronto para começar?', 'Uma linha que reforce a decisão e diga o próximo passo.', { label: 'Criar minha conta' });
  footer(b, '© 2026 Sua marca · contato@suamarca.com', 'Instagram · LinkedIn · YouTube');
  return finish(b);
}

function catalog(W: number): Doc {
  const b = begin(W);
  nav(b, 'Catálogo', ['Coleções', 'Sobre', 'Contato']);
  section(b, 'Coleção', '#ffffff', (y) => {
    let cy = heading(b, 'Coleção 2026', y, 'Uma frase sobre a coleção: materiais, ocasião ou estilo.');
    cy = chips(b, ['Todos', 'Categoria A', 'Categoria B', 'Categoria C'], cy - (b.mob ? 8 : 16)) + (b.mob ? 24 : 40);
    const items = ['Peça 01', 'Peça 02', 'Peça 03', 'Peça 04', 'Peça 05', 'Peça 06'].map((name, i) => ({
      name,
      meta: `Categoria ${'ABC'[i % 3]}`,
      text: 'Descrição curta com material, medida ou detalhe que diferencia.',
    }));
    return cards(b, cy, items, b.mob ? 2 : 3, { ratio: 1.25 });
  }, 64);
  ctaBand(b, 'Gostou de alguma peça?', 'Diga como a pessoa pede um orçamento ou encontra um revendedor.', { label: 'Falar conosco' });
  footer(b, '© 2026 Catálogo · contato@catalogo.com', 'Instagram · Pinterest');
  return finish(b);
}

function store(W: number): Doc {
  const b = begin(W);
  section(b, 'Aviso', INK, (y) =>
    y + txt(b, 'Aviso de frete', 'Frete grátis nas compras acima de R$ 199', b.m, y, b.cw, { fontSize: 13, color: '#ffffff', align: 'center', font: 'ui', fontWeight: 500 }).h,
  12);
  nav(b, 'Loja', ['Novidades', 'Mais vendidos', 'Ofertas'], { label: 'Carrinho (0)' });
  hero(b, {
    title: 'Até 30% off na nova coleção',
    sub: 'Oferta válida até domingo ou enquanto durar o estoque.',
    actions: [{ label: 'Ver ofertas', primary: true }],
    image: 'Banner da coleção',
    fill: SOFT,
    size: 56,
  });
  section(b, 'Mais vendidos', '#ffffff', (y) => {
    const items = ['Produto um', 'Produto dois', 'Produto três', 'Produto quatro'].map((name, i) => ({
      name,
      price: ['R$ 129,90', 'R$ 89,90', 'R$ 249,00', 'R$ 59,90'][i],
    }));
    return cards(b, heading(b, 'Mais vendidos', y), items, b.mob ? 2 : 4, { ratio: 1, button: { label: 'Comprar', primary: true } });
  });
  section(b, 'Vantagens', SOFT, (y) =>
    cards(b, y, [
      { name: 'Frete grátis', text: 'Acima de R$ 199 para todo o Brasil.' },
      { name: 'Troca em 30 dias', text: 'A primeira troca é por nossa conta.' },
      { name: 'Pix ou cartão', text: 'Até 6 vezes sem juros no cartão.' },
    ], b.mob ? 1 : 3),
  64);
  footer(b, '© 2026 Loja · CNPJ 00.000.000/0001-00', 'Atendimento · Trocas · Instagram');
  return finish(b);
}

function portfolio(W: number): Doc {
  const b = begin(W);
  nav(b, 'Seu nome', ['Trabalhos', 'Sobre', 'Contato']);
  section(b, 'Apresentação', '#ffffff', (y) => {
    const t = title(b, 'Apresentação', 'Seu nome, o que você faz e onde, em uma frase.', b.m, y, b.mob ? b.cw : 1000, b.mob ? 36 : 72, { lineHeight: 1.05 });
    return y + t.h + 24 + txt(b, 'Resumo', 'Duas linhas sobre o tipo de trabalho que você aceita e para quem.', b.m, y + t.h + 24, b.mob ? b.cw : 640, { fontSize: b.mob ? 17 : 20, color: MUTED }).h;
  });
  section(b, 'Trabalhos', '#ffffff', (y) =>
    cards(b, y, [
      { name: 'Projeto um', meta: '2026 · Identidade visual' },
      { name: 'Projeto dois', meta: '2026 · Site' },
      { name: 'Projeto três', meta: '2025 · Fotografia' },
      { name: 'Projeto quatro', meta: '2025 · Embalagem' },
    ], b.mob ? 1 : 2, { ratio: 0.72 }),
  0);
  b.y += b.mob ? 48 : 96;
  ctaBand(b, 'Vamos conversar?', 'voce@email.com', { label: 'Enviar e-mail', href: 'mailto:voce@email.com' });
  footer(b, '© 2026 Seu nome', 'Instagram · Behance · LinkedIn');
  return finish(b);
}

function bio(W: number): Doc {
  const b = begin(W);
  const colW = b.mob ? b.cw : 480;
  const x = Math.round((W - colW) / 2);
  section(b, 'Perfil', SOFT, (y) => {
    img(b, 'Foto de perfil', Math.round((W - 104) / 2), y, 104, 104, { radius: 52 });
    let cy = y + 104 + 20;
    cy += title(b, 'Nome', 'Seu nome', x, cy, colW, 28, { align: 'center', lineHeight: 1.2 }).h + 8;
    cy += txt(b, 'Bio', 'Uma linha sobre você e o que a pessoa encontra nos links abaixo.', x, cy, colW, { fontSize: 16, color: MUTED, align: 'center' }).h + 32;
    ['Meu site', 'Loja', 'Último vídeo', 'Agenda', 'Fale comigo'].forEach((l, i) => {
      put(b, 'link', `Link ${l}`, {
        x, y: cy, w: colW, h: 56, text: l, href: 'https://', radius: 8, padding: 15, fontSize: 16,
        ...(i === 0 ? { fill: INK, color: '#ffffff' } : { fill: '#ffffff', color: INK, borderWidth: 1, borderColor: LINE }),
      });
      cy += 56 + 12;
    });
    return cy + 8 + txt(b, 'Redes', 'Instagram · TikTok · YouTube', x, cy + 8, colW, { fontSize: 14, color: MUTED, align: 'center' }).h;
  }, 80);
  b.d.background = SOFT;
  b.d.height = Math.max(b.y, b.mob ? 844 : 900);
  return b.d;
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
  { id: 'landing', name: 'Landing page', start: 'desktop', build: landing },
  { id: 'catalogo', name: 'Catálogo', start: 'desktop', build: catalog },
  { id: 'loja', name: 'Loja', start: 'desktop', build: store },
  { id: 'portfolio', name: 'Portfólio', start: 'desktop', build: portfolio },
  { id: 'bio', name: 'Link na bio', start: 'mobile', build: bio },
];

/** Documento completo do modelo: desktop com a versão mobile desenhada à parte. */
export function templateDoc(t: Template): Doc | null {
  if (!t.build) return null;
  return { ...t.build(DESKTOP_WIDTH), mobile: t.build(MOBILE_WIDTH) };
}
