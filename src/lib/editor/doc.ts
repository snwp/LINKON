/**
 * Documento do editor visual. É o que vai em `pages.doc` (JSON).
 * Os elementos ficam em `elements` na ordem de pintura: o último fica por cima.
 */

export type ElementType = 'texto' | 'imagem' | 'bloco' | 'secao' | 'link' | 'referencia';
export type FontRole = 'ui' | 'text' | 'mono';

export type El = {
  id: string;
  type: ElementType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
  /** '' = transparente. */
  fill: string;
  color: string;
  font: FontRole;
  fontSize: number;
  fontWeight: number;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  padding: number;
  radius: number;
  borderWidth: number;
  borderColor: string;
  opacity: number;
  /** texto, bloco, seção e link. */
  text?: string;
  /** link. */
  href?: string;
  /** imagem: arquivo da Biblioteca. */
  fileId?: number;
  fit?: 'cover' | 'contain';
  /** referência: ideia ou arquivo mostrado como cartão. */
  ref?: { kind: 'idea' | 'file'; id: number };
};

export type Doc = {
  version: 1;
  width: number;
  height: number;
  background: string;
  elements: El[];
  /** Versão mobile da página (390 px). Só existe no documento principal. */
  mobile?: Doc;
  /** Quadros extras: outras telas do mesmo site (Sobre, Pesquisar...). Só existem no documento principal. */
  frames?: Frame[];
  /** Posição do quadro principal no canvas, em px de página. Sem valor, 0,0. */
  x?: number;
  y?: number;
};

/**
 * Um quadro é uma tela do site. O nome define o arquivo (Sobre → sobre.html); x e y são a posição no canvas,
 * em px de página, com o quadro principal em 0,0. Links apontam para um quadro com `quadro:<id>`.
 */
export type Frame = Doc & { id: string; name: string; x: number; y: number };

export const FRAME_LINK = 'quadro:';
/** Id que um link usa para voltar ao quadro principal. */
export const MAIN_FRAME = 'principal';

function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'quadro'
  );
}

/** Arquivo de cada quadro extra no site: nome do quadro sem acento, único, nunca index. */
export function frameFiles(root: Doc): Map<string, string> {
  const files = new Map<string, string>();
  const taken = new Set(['index']);
  for (const f of root.frames ?? []) {
    const base = slug(f.name);
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
    taken.add(name);
    files.set(f.id, `${name}.html`);
  }
  return files;
}

/** O documento de um quadro pelo id (`principal` = a página inicial). Null se não existe. */
export function frameDoc(root: Doc, id: string): Doc | null {
  return id === MAIN_FRAME ? root : (root.frames?.find((f) => f.id === id) ?? null);
}

/** Empurra o quadro para a direita até não encostar em nenhum outro (folga de `gap`). */
export function placeFrame(root: Doc, f: Frame, gap = 160) {
  const all = [{ x: root.x ?? 0, y: root.y ?? 0, width: root.width, height: root.height }, ...(root.frames ?? []).filter((o) => o !== f)];
  for (let hit = true; hit; ) {
    hit = false;
    for (const o of all) {
      if (f.x < o.x + o.width + gap && f.x + f.width + gap > o.x && f.y < o.y + o.height + gap && f.y + f.height + gap > o.y) {
        f.x = o.x + o.width + gap;
        hit = true;
      }
    }
  }
}

export function newFrame(root: Doc, x: number, y: number, name: string): Frame {
  return { version: 1, id: newId(), name, x: Math.round(x), y: Math.round(y), width: root.width, height: 900, background: '#ffffff', elements: [] };
}

export const TYPE_LABELS: Record<ElementType, string> = {
  texto: 'Texto',
  imagem: 'Imagem',
  bloco: 'Bloco',
  secao: 'Seção',
  link: 'Link',
  referencia: 'Referência',
};

/** Pilhas de fonte usadas no editor e no HTML exportado. */
export const FONT_STACK: Record<FontRole, string> = {
  ui: "'Geist Variable', 'Geist', 'Segoe UI', system-ui, sans-serif",
  text: "'Inter Variable', 'Inter', 'Segoe UI', system-ui, sans-serif",
  mono: "'Geist Mono Variable', 'Geist Mono', Consolas, ui-monospace, monospace",
};

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Espaços de imagem vazios (imagem sem arquivo, como os dos modelos) que `el` cobre quase inteiros:
 * a área em comum é ao menos 80% da maior das duas (mesmo lugar e quase o mesmo tamanho; um ícone pequeno
 * por cima não conta). Serve para preencher o espaço em vez de empilhar
 * uma imagem por cima, e para apagar o espaço junto com a imagem que estava sobre ele.
 */
export function emptyImagesUnder(doc: Doc, el: Pick<El, 'id' | 'x' | 'y' | 'w' | 'h'>): El[] {
  return doc.elements.filter((p) => {
    if (p.id === el.id || p.type !== 'imagem' || p.fileId) return false;
    const w = Math.min(p.x + p.w, el.x + el.w) - Math.max(p.x, el.x);
    const h = Math.min(p.y + p.h, el.y + el.h) - Math.max(p.y, el.y);
    return w > 0 && h > 0 && w * h >= 0.8 * Math.max(p.w * p.h, el.w * el.h);
  });
}

const BASE: Omit<El, 'id' | 'type' | 'name' | 'x' | 'y' | 'w' | 'h'> = {
  fill: '',
  color: '#000000',
  font: 'text',
  fontSize: 18,
  fontWeight: 400,
  align: 'left',
  lineHeight: 1.5,
  padding: 0,
  radius: 0,
  borderWidth: 0,
  borderColor: '#2e2e2e',
  opacity: 1,
};

/** Elemento novo com os valores padrão do tipo, posicionado em (x, y). */
export function createElement(type: ElementType, doc: Doc, x: number, y: number, extra: Partial<El> = {}): El {
  const count = doc.elements.filter((e) => e.type === type).length + 1;
  const name = `${TYPE_LABELS[type]} ${count}`;
  const base = { ...BASE, id: newId(), type, name, x, y };
  switch (type) {
    case 'texto':
      return { ...base, w: 480, h: 80, font: 'ui', fontSize: 40, fontWeight: 600, lineHeight: 1.15, text: 'Escreva aqui', ...extra };
    case 'bloco':
      return { ...base, w: 360, h: 220, fill: '#f2f2f2', radius: 8, padding: 24, text: '', ...extra };
    case 'secao':
      return { ...base, x: 0, w: doc.width, h: 480, fill: '#000000', color: '#ffffff', padding: 64, text: '', ...extra };
    case 'link':
      return { ...base, w: 220, h: 48, fill: '#000000', color: '#ffffff', radius: 6, padding: 12, align: 'center', font: 'ui', fontSize: 16, fontWeight: 600, text: 'Saiba mais', href: 'https://', ...extra };
    case 'imagem':
      return { ...base, w: 480, h: 320, fit: 'cover', radius: 0, ...extra };
    case 'referencia':
      return { ...base, w: 360, h: 140, fill: '#ffffff', borderWidth: 1, borderColor: '#d4d4d4', radius: 8, padding: 20, fontSize: 15, ...extra };
  }
}

export function emptyDoc(): Doc {
  return { version: 1, width: 1440, height: 1600, background: '#ffffff', elements: [] };
}

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const NUMERIC = ['x', 'y', 'w', 'h', 'fontSize', 'fontWeight', 'lineHeight', 'padding', 'radius', 'borderWidth', 'opacity'] as const;

/**
 * O documento salvo pode ter vindo de um backup de outra pessoa. Tudo que vai para o estilo é conferido aqui:
 * números finitos, cores hex e valores conhecidos. Assim nada fora disso chega ao HTML do app ou da exportação.
 */
function cleanEl(raw: El): El {
  const e = { ...BASE, ...raw } as El;
  for (const k of NUMERIC) e[k] = finite(e[k], (BASE as Partial<El>)[k] ?? 0);
  if (!(e.fill === '' || HEX.test(e.fill))) e.fill = '';
  if (!HEX.test(e.color)) e.color = BASE.color;
  if (!HEX.test(e.borderColor)) e.borderColor = BASE.borderColor;
  if (!Object.hasOwn(FONT_STACK, e.font)) e.font = BASE.font;
  if (e.align !== 'left' && e.align !== 'center' && e.align !== 'right') e.align = BASE.align;
  if (e.fit !== undefined && e.fit !== 'cover' && e.fit !== 'contain') e.fit = 'cover';
  return e;
}

function readFrame(d: Partial<Doc>, defaults: Doc): Doc {
  return {
    ...defaults,
    ...d,
    width: finite(d.width, defaults.width),
    height: finite(d.height, defaults.height),
    background: typeof d.background === 'string' && HEX.test(d.background) ? d.background : defaults.background,
    mobile: undefined,
    frames: undefined,
    x: finite(d.x, 0),
    y: finite(d.y, 0),
    elements: (d.elements as El[]).filter((e) => e && typeof e === 'object').map(cleanEl),
  };
}

/** Lê o JSON salvo; documento inválido vira página vazia em vez de quebrar a tela. */
export function parseDoc(json: string): Doc {
  try {
    const d = JSON.parse(json);
    if (!Array.isArray(d.elements)) return emptyDoc();
    const doc = readFrame(d, emptyDoc());
    if (d.mobile && Array.isArray(d.mobile.elements)) doc.mobile = readFrame(d.mobile, { ...emptyDoc(), width: 390, height: 844 });
    if (Array.isArray(d.frames)) {
      const frames = d.frames
        .filter((f: Partial<Frame>) => f && typeof f === 'object' && Array.isArray(f.elements) && typeof f.id === 'string')
        .map((f: Partial<Frame>) => ({
          ...readFrame(f, { ...emptyDoc(), height: 900 }),
          id: String(f.id).slice(0, 40),
          name: typeof f.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 60) : 'Quadro',
          x: finite(f.x, 0),
          y: finite(f.y, 0),
        }));
      if (frames.length) doc.frames = frames;
    }
    return doc;
  } catch {
    return emptyDoc();
  }
}

/** Estilo absoluto do elemento, igual no editor e no HTML exportado. */
export function elementStyle(e: El): string {
  return [
    `left:${e.x}px`,
    `top:${e.y}px`,
    `width:${e.w}px`,
    `height:${e.h}px`,
    `background:${e.fill || 'transparent'}`,
    `color:${e.color}`,
    `font-family:${FONT_STACK[e.font]}`,
    `font-size:${e.fontSize}px`,
    `font-weight:${e.fontWeight}`,
    `text-align:${e.align}`,
    `line-height:${e.lineHeight}`,
    `padding:${e.padding}px`,
    `border-radius:${e.radius}px`,
    e.borderWidth ? `border:${e.borderWidth}px solid ${e.borderColor}` : 'border:0',
    `opacity:${e.opacity}`,
  ].join(';');
}

/**
 * Encaixe ao mover: alinha bordas e centro do elemento às da página e dos outros elementos,
 * quando estão a menos de `threshold` px. Devolve a posição final e as guias a desenhar.
 */
export function snapMove(
  doc: Doc,
  el: El,
  nx: number,
  ny: number,
  threshold: number,
): { x: number; y: number; gx: number | null; gy: number | null } {
  const xs = [0, doc.width / 2, doc.width];
  const ys = [0, doc.height / 2, doc.height];
  for (const o of doc.elements) {
    if (o.id === el.id || o.hidden) continue;
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const best = (own: number[], targets: number[]) => {
    let dist = Infinity;
    let off = 0;
    let line: number | null = null;
    for (const p of own)
      for (const q of targets) {
        const d = Math.abs(q - p);
        if (d < dist) {
          dist = d;
          off = q - p;
          line = q;
        }
      }
    return dist <= threshold ? { off, line } : { off: 0, line: null };
  };
  const sx = best([nx, nx + el.w / 2, nx + el.w], xs);
  const sy = best([ny, ny + el.h / 2, ny + el.h], ys);
  return { x: Math.round(nx + sx.off), y: Math.round(ny + sy.off), gx: sx.line, gy: sy.line };
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_SIZE = 8;

/** Novo retângulo ao arrastar uma alça por (dx, dy). A borda oposta fica parada. */
export function resizeRect(
  r: { x: number; y: number; w: number; h: number },
  dir: Handle,
  dx: number,
  dy: number,
): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = r;
  if (dir.includes('e')) w = Math.max(MIN_SIZE, r.w + dx);
  if (dir.includes('w')) {
    w = Math.max(MIN_SIZE, r.w - dx);
    x = r.x + r.w - w;
  }
  if (dir.includes('s')) h = Math.max(MIN_SIZE, r.h + dy);
  if (dir.includes('n')) {
    h = Math.max(MIN_SIZE, r.h - dy);
    y = r.y + r.h - h;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Só http(s) e mailto viram links clicáveis; o resto é neutralizado. */
export function safeHref(href: string | undefined): string {
  const h = (href ?? '').trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : '#';
}

/** Elementos que pertencem a uma página: arquivos e ideias referenciados. Usado pelas Conexões. */
export function docReferences(doc: Doc): { ideas: number[]; files: number[] } {
  const ideas = new Set<number>();
  const files = new Set<number>();
  for (const e of [...doc.elements, ...(doc.mobile?.elements ?? [])]) {
    if (e.type === 'imagem' && e.fileId) files.add(e.fileId);
    if (e.type === 'referencia' && e.ref) (e.ref.kind === 'idea' ? ideas : files).add(e.ref.id);
  }
  return { ideas: [...ideas], files: [...files] };
}
