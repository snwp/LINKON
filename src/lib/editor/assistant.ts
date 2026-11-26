/**
 * Assistente do editor. Quem responde é o Claude Code instalado e logado nesta máquina (assinatura do usuário),
 * chamado pelo backend em modo `--print` sem ferramentas. A resposta é texto em JSON Lines: cada linha é uma
 * operação sobre a página, aplicada assim que a linha termina, para a página ir se montando na tela.
 */
import { t } from '$lib/i18n.svelte';
import { createElement, emptyImagesUnder, newId, TYPE_LABELS, type Doc, type El, type ElementType } from './doc';

/** Uma linha do registro do painel do assistente. */
export type LogEntry = { kind: 'user' | 'ai' | 'action' | 'error'; text: string; scope?: string };

export type Op =
  | { op: 'say'; text: string }
  | { op: 'add'; type: ElementType; id?: string; props: Partial<El> }
  | { op: 'update'; id: string; props: Partial<El> }
  | { op: 'delete'; id: string }
  | { op: 'page'; props: Partial<Pick<Doc, 'width' | 'height' | 'background'>> };

export const SYSTEM_PROMPT = `Você é o assistente de layout do Linkon, um editor visual de páginas. Você monta e ajusta a página pedida emitindo operações, uma por linha, em JSON Lines. Não use blocos de código, não use markdown, não escreva nada além das linhas JSON.

Coordenadas em pixels, origem no canto superior esquerdo da página. Elementos são retângulos absolutos; o último da lista fica por cima.

Tipos de elemento: texto, bloco (cartão com texto opcional), secao (faixa de largura total), link (botão com endereço), imagem (arquivo importado).

Propriedades aceitas em "props": name, x, y, w, h, text, href, fill (cor hex ou "" para transparente), color (cor hex do texto), font ("ui" = Geist, "text" = Inter, "mono" = Geist Mono), fontSize, fontWeight (400, 500, 600, 700), align ("left", "center", "right"), lineHeight, padding, radius, borderWidth, borderColor, opacity (0 a 1), fileId (número, só para imagem), fit ("cover" ou "contain"), hidden.

Operações (uma por linha):
{"op":"say","text":"..."}  mensagem curta para o usuário, em português do Brasil
{"op":"add","type":"texto","id":"titulo","props":{...}}  cria; "id" é opcional e serve para alterar depois na mesma resposta
{"op":"update","id":"...","props":{...}}  muda só as propriedades informadas
{"op":"delete","id":"..."}
{"op":"page","props":{"width":1280,"height":1600,"background":"#ffffff"}}

Regras:
- Comece com uma linha "say" dizendo em poucas palavras o que vai fazer; termine com uma linha "say" curta dizendo o que fez.
- Use apenas ids que existem na página ou que você criou nesta resposta. Use apenas fileId listados no contexto.
- Quando houver um elemento marcado, mude só esse elemento (e, se o pedido exigir, o que estiver dentro da área dele). Não mexa no resto.
- Quando houver um ponto marcado, crie o que for pedido a partir desse ponto.
- Mantenha os elementos dentro da página, alinhados entre si, com espaçamentos consistentes e texto que caiba na caixa (altura suficiente para as linhas).
- Prefira poucas operações bem pensadas a muitas pequenas.`;

/** O que vai junto com cada pedido: a página atual e o que existe para usar. */
export function buildPrompt(input: {
  request: string;
  doc: Doc;
  title: string;
  marked?: El | null;
  point?: { x: number; y: number } | null;
  images: { id: number; name: string }[];
  recent: string[];
}): string {
  const elements = input.doc.elements.map((e) => ({
    id: e.id,
    type: e.type,
    name: e.name,
    x: e.x,
    y: e.y,
    w: e.w,
    h: e.h,
    ...(e.text ? { text: e.text } : {}),
    ...(e.href ? { href: e.href } : {}),
    fill: e.fill,
    color: e.color,
    font: e.font,
    fontSize: e.fontSize,
    fontWeight: e.fontWeight,
    align: e.align,
    radius: e.radius,
    padding: e.padding,
    ...(e.borderWidth ? { borderWidth: e.borderWidth, borderColor: e.borderColor } : {}),
    ...(e.opacity !== 1 ? { opacity: e.opacity } : {}),
    ...(e.fileId ? { fileId: e.fileId } : {}),
    ...(e.ref ? { ref: e.ref } : {}),
    ...(e.hidden ? { hidden: true } : {}),
  }));
  const parts = [
    `Página "${input.title}": ${input.doc.width} x ${input.doc.height}, fundo ${input.doc.background}.`,
    `Elementos atuais (JSON):\n${JSON.stringify(elements)}`,
    input.images.length ? `Imagens disponíveis (fileId e nome):\n${JSON.stringify(input.images)}` : 'Nenhuma imagem importada.',
    input.recent.length ? `Pedidos anteriores nesta página, do mais antigo ao mais recente:\n- ${input.recent.join('\n- ')}` : '',
    input.marked
      ? `Elemento marcado: id "${input.marked.id}" (${TYPE_LABELS[input.marked.type]} "${input.marked.name}", x ${input.marked.x}, y ${input.marked.y}, ${input.marked.w} x ${input.marked.h}). O pedido vale só para ele.`
      : '',
    input.point ? `Ponto marcado na página: x ${Math.round(input.point.x)}, y ${Math.round(input.point.y)}.` : '',
    `Pedido: ${input.request}`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

const TYPES: ElementType[] = ['texto', 'imagem', 'bloco', 'secao', 'link'];
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/** Valida as propriedades vindas da IA: só campos conhecidos, números finitos e dentro de limites. */
export function cleanProps(raw: unknown, ctx: { fileIds: Set<number>; ideaIds: Set<number>; refFileIds: Set<number> }): Partial<El> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<El> = {};
  const num = (k: keyof El, min: number, max: number) => {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) (out as Record<string, unknown>)[k] = Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  };
  num('x', -5000, 20000);
  num('y', -5000, 20000);
  num('w', 8, 20000);
  num('h', 8, 20000);
  num('fontSize', 6, 400);
  num('lineHeight', 0.8, 3);
  num('padding', 0, 400);
  num('radius', 0, 999);
  num('borderWidth', 0, 40);
  num('opacity', 0, 1);
  if (typeof r.name === 'string') out.name = r.name.slice(0, 120);
  if (typeof r.text === 'string') out.text = r.text.slice(0, 20000);
  if (typeof r.href === 'string') out.href = r.href.slice(0, 2000);
  if (typeof r.fill === 'string' && (r.fill === '' || HEX.test(r.fill))) out.fill = r.fill;
  if (typeof r.color === 'string' && HEX.test(r.color)) out.color = r.color;
  if (typeof r.borderColor === 'string' && HEX.test(r.borderColor)) out.borderColor = r.borderColor;
  if (r.font === 'ui' || r.font === 'text' || r.font === 'mono') out.font = r.font;
  if ([400, 500, 600, 700].includes(r.fontWeight as number)) out.fontWeight = r.fontWeight as number;
  if (r.align === 'left' || r.align === 'center' || r.align === 'right') out.align = r.align;
  if (r.fit === 'cover' || r.fit === 'contain') out.fit = r.fit;
  if (typeof r.hidden === 'boolean') out.hidden = r.hidden;
  if (typeof r.fileId === 'number' && ctx.fileIds.has(r.fileId)) out.fileId = r.fileId;
  const ref = r.ref as { kind?: unknown; id?: unknown } | undefined;
  if (ref && typeof ref.id === 'number') {
    if (ref.kind === 'idea' && ctx.ideaIds.has(ref.id)) out.ref = { kind: 'idea', id: ref.id };
    if (ref.kind === 'file' && ctx.refFileIds.has(ref.id)) out.ref = { kind: 'file', id: ref.id };
  }
  return out;
}

/** Uma linha de texto vira uma operação, ou null se não for uma operação válida. */
export function parseOp(line: string, ctx: Parameters<typeof cleanProps>[1]): Op | null {
  const t = line.trim().replace(/^```\w*$/, '');
  if (!t.startsWith('{')) return null;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(t);
  } catch {
    return null;
  }
  switch (v.op) {
    case 'say':
      return typeof v.text === 'string' ? { op: 'say', text: v.text.slice(0, 2000) } : null;
    case 'add':
      if (!TYPES.includes(v.type as ElementType)) return null;
      return { op: 'add', type: v.type as ElementType, id: typeof v.id === 'string' ? v.id.slice(0, 60) : undefined, props: cleanProps(v.props, ctx) };
    case 'update':
      return typeof v.id === 'string' ? { op: 'update', id: v.id, props: cleanProps(v.props, ctx) } : null;
    case 'delete':
      return typeof v.id === 'string' ? { op: 'delete', id: v.id } : null;
    case 'page': {
      const p = (v.props ?? {}) as Record<string, unknown>;
      const props: Partial<Doc> = {};
      if (typeof p.width === 'number' && Number.isFinite(p.width)) props.width = Math.min(4000, Math.max(200, Math.round(p.width)));
      if (typeof p.height === 'number' && Number.isFinite(p.height)) props.height = Math.min(20000, Math.max(200, Math.round(p.height)));
      if (typeof p.background === 'string' && HEX.test(p.background)) props.background = p.background;
      return { op: 'page', props };
    }
    default:
      return null;
  }
}

/**
 * Aplica uma operação no documento vivo do editor. Devolve um rótulo curto para o registro do assistente,
 * ou null quando a operação não pôde ser aplicada (id inexistente, fora do escopo marcado).
 */
export function applyOp(doc: Doc, op: Op, scope: { markedId: string | null }): string | null {
  switch (op.op) {
    case 'say':
      return null;
    case 'add': {
      const id = op.id && !doc.elements.some((e) => e.id === op.id) ? op.id : newId();
      const el = createElement(op.type, doc, op.props.x ?? 96, op.props.y ?? 96, { ...op.props, id });
      if (op.type === 'imagem' && !el.fileId) return null;
      if (op.type === 'referencia' && !el.ref) return null;
      // Imagem sobre um espaço de imagem vazio: preenche o espaço em vez de empilhar outra por cima.
      const slot = op.type === 'imagem' ? emptyImagesUnder(doc, el)[0] : undefined;
      if (slot) {
        slot.fileId = el.fileId;
        return t('Colocou a imagem em “{name}”', { name: slot.name });
      }
      doc.elements.push(el);
      return t('Criou {type} “{name}”', { type: t(TYPE_LABELS[el.type]).toLowerCase(), name: el.name });
    }
    case 'update': {
      if (scope.markedId && op.id !== scope.markedId) return null;
      const el = doc.elements.find((e) => e.id === op.id);
      if (!el) return null;
      Object.assign(el, op.props);
      return t('Ajustou “{name}”', { name: el.name });
    }
    case 'delete': {
      if (scope.markedId && op.id !== scope.markedId) return null;
      const i = doc.elements.findIndex((e) => e.id === op.id);
      if (i < 0) return null;
      const [el] = doc.elements.splice(i, 1);
      return t('Removeu “{name}”', { name: el.name });
    }
    case 'page':
      if (scope.markedId) return null;
      Object.assign(doc, op.props);
      return t('Ajustou a página');
  }
}

const MODEL_KEY = 'linkon.ai.model';

/**
 * Modelos do Claude que o seletor mostra, na ordem do app do Claude.
 * `locked` = não dá para usar com a assinatura; aparece com cadeado e o motivo.
 * shortcut: a disponibilidade é fixa aqui (o Claude Code não informa o plano por modelo); ajustar quando mudar.
 */
export type AiModel = { id: string; name: string; isDefault?: boolean; locked?: string };
export const AI_MODELS: AiModel[] = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', isDefault: true },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
  { id: 'claude-fable-5-2', name: 'Fable 5.2', locked: 'Requer créditos de uso' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5' },
];
const DEFAULT_MODEL = AI_MODELS.find((m) => m.isDefault)!.id;
// Escolhas guardadas antes da lista completa.
const LEGACY: Record<string, string> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };

/** Modelo escolhido (sempre um da lista que dá para usar; senão, o padrão). */
export function getAiModel(): string {
  let id = '';
  try {
    id = localStorage.getItem(MODEL_KEY) ?? '';
  } catch {
    // Sem armazenamento local, fica o padrão.
  }
  id = LEGACY[id] ?? id;
  const m = AI_MODELS.find((x) => x.id === id);
  return m && !m.locked ? m.id : DEFAULT_MODEL;
}

export function setAiModel(model: string) {
  try {
    localStorage.setItem(MODEL_KEY, model);
  } catch {
    // Sem armazenamento local, fica o padrão do Claude Code.
  }
}

/** Traduz os erros mais comuns do Claude Code para algo que a pessoa consiga resolver. */
export function friendlyAiError(raw: string): string {
  const low = raw.toLowerCase();
  if (low.includes('não foi encontrado') || low.includes('not found') || low.includes('program not found')) {
    return t('Não encontrei o Claude Code neste computador. Instale o Claude Code e entre com sua conta; depois tente de novo.');
  }
  if (low.includes('login') || low.includes('log in') || low.includes('authenticat') || low.includes('api key')) {
    return t('O Claude Code não está conectado à sua conta. Em Configurações, na seção Assistente de IA, está o comando para entrar.');
  }
  if (low.includes('usage limit') || low.includes('rate limit') || low.includes('limit reached')) {
    return t('O limite de uso da sua assinatura foi atingido por enquanto. Tente de novo mais tarde.');
  }
  if (low.includes('cancel')) return t('Pedido interrompido.');
  return `${t('O assistente não conseguiu responder.')} ${raw}`.trim();
}

/**
 * Lê o stream-json do Claude Code (`--output-format stream-json --include-partial-messages`).
 * Devolve o texto novo de cada linha, ou o resultado final.
 */
export type AiUsage = { input: number; output: number; ms: number };

export function readStreamLine(line: string): { text?: string; result?: { ok: boolean; text: string; usage?: AiUsage } } {
  let v: Record<string, any>;
  try {
    v = JSON.parse(line);
  } catch {
    return {};
  }
  if (v.type === 'stream_event' && v.event?.type === 'content_block_delta' && v.event.delta?.type === 'text_delta') {
    return { text: String(v.event.delta.text ?? '') };
  }
  if (v.type === 'result') {
    const u = v.usage ?? {};
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    return {
      result: {
        ok: !v.is_error && v.subtype === 'success',
        text: String(v.result ?? ''),
        // Entrada conta também o que veio do cache (é texto que o modelo leu).
        usage: {
          input: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens),
          output: n(u.output_tokens),
          ms: n(v.duration_ms),
        },
      },
    };
  }
  return {};
}
