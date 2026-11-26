import { elementStyle, safeHref, FRAME_LINK, MAIN_FRAME, type Doc, type El } from './doc';
import { BREAKPOINT } from './layouts';

export type RenderOptions = {
  title: string;
  /** URL de uma imagem da Biblioteca. Na exportação, `linkon-file://<id>`; na visualização, a URL do app. */
  src: (fileId: number) => string;
  /** Título e subtítulo do cartão de uma referência. */
  ref: (ref: NonNullable<El['ref']>) => { title: string; subtitle: string };
  /**
   * Script que reduz a página em telas estreitas: embutido (`true`, arquivo único), como `fit.js` ao lado
   * (`'file'`, site em Documentos/Linkon, ver site.rs) ou nenhum (visualização no app).
   */
  fitScript: boolean | 'file';
  /** @font-face das fontes usadas (ver fonts.ts). */
  fontCss?: string;
  /** Arquivo de cada quadro (id → `sobre.html`), para links `quadro:<id>`. Sem isso, viram `#`. */
  frames?: Map<string, string>;
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0}body{background:#e6e6e6}
.page{position:relative;margin:0 auto;overflow:hidden;transform-origin:top left}
.el{position:absolute;display:block;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;text-decoration:none}
img.el{padding:0}
.ref{display:flex;flex-direction:column;gap:6px}.ref strong{font-weight:600}.ref span{opacity:.7;font-size:.85em}`;

// Reduz a versão visível (desktop ou mobile) quando a tela é mais estreita que ela.
const FIT = `<script>(function(){var ps=document.querySelectorAll('.page');function f(){for(var i=0;i<ps.length;i++){var p=ps[i];if(!p.offsetWidth)continue;var s=Math.min(1,document.documentElement.clientWidth/p.offsetWidth);p.style.transform='scale('+s+')';p.style.marginLeft=s<1?'0':'auto';document.body.style.height=(p.offsetHeight*s)+'px'}}addEventListener('resize',f);f()})()</script>`;

function renderElement(e: El, o: RenderOptions): string {
  // Escapado mesmo vindo de parseDoc: um valor com aspas nunca pode fechar o atributo.
  const style = esc(elementStyle(e));
  switch (e.type) {
    case 'imagem':
      if (!e.fileId) return `<div class="el" style="${style}"></div>`;
      return `<img class="el" src="${esc(o.src(e.fileId))}" alt="${esc(e.name)}" style="${style};object-fit:${e.fit === 'contain' ? 'contain' : 'cover'}">`;
    case 'link':
      if (e.href?.startsWith(FRAME_LINK)) {
        const id = e.href.slice(FRAME_LINK.length);
        const file = id === MAIN_FRAME ? 'index.html' : o.frames?.get(id) ?? '#';
        return `<a class="el" href="${esc(file)}" style="${style}">${esc(e.text ?? '')}</a>`;
      }
      return `<a class="el" href="${esc(safeHref(e.href))}" target="_blank" rel="noopener" style="${style}">${esc(e.text ?? '')}</a>`;
    case 'referencia': {
      if (!e.ref) return `<div class="el" style="${style}"></div>`;
      const r = o.ref(e.ref);
      return `<div class="el ref" style="${style}"><strong>${esc(r.title)}</strong><span>${esc(r.subtitle)}</span></div>`;
    }
    default:
      return `<div class="el" style="${style}">${esc(e.text ?? '')}</div>`;
  }
}

function renderFrame(d: Doc, o: RenderOptions, cls: string): string {
  const body = d.elements
    .filter((e) => !e.hidden)
    .map((e) => renderElement(e, o))
    .join('\n');
  return `<main class="page${cls}" style="width:${Number(d.width) || 0}px;height:${Number(d.height) || 0}px;background:${esc(d.background)}">\n${body}\n</main>`;
}

/**
 * HTML completo e independente da página. Mesma geometria e estilo do editor.
 * Com versão mobile, as duas vão no arquivo e a largura da tela escolhe qual aparece.
 */
export function renderHtml(doc: Doc, o: RenderOptions): string {
  const pages = doc.mobile
    ? `${renderFrame(doc, o, ' desktop')}\n${renderFrame(doc.mobile, o, ' mobile')}\n<style>.page.mobile{display:none}@media (max-width:${BREAKPOINT}px){.page.desktop{display:none}.page.mobile{display:block}}</style>`
    : renderFrame(doc, o, '');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Linkon">
<title>${esc(o.title)}</title>
<style>${o.fontCss ?? ''}${BASE_CSS}</style>
</head>
<body>
${pages}
${o.fitScript === 'file' ? '<script src="fit.js"></script>' : o.fitScript ? FIT : ''}
</body>
</html>`;
}
