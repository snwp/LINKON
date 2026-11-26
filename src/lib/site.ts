// HTML do site de uma interface (pasta em Documentos/Linkon): imagens como `linkon-file://<id>`, que o Rust
// troca pelos arquivos copiados para assets/, e o ajuste a telas estreitas em fit.js.
import type { Doc } from './editor/doc';
import { renderHtml } from './editor/render';
import { refInfo } from './editor/refs';
import { fontCss } from './editor/fonts';

export async function siteHtml(title: string, doc: Doc): Promise<string> {
  return renderHtml(doc, {
    title,
    src: (id) => `linkon-file://${id}`,
    ref: refInfo,
    fitScript: 'file',
    fontCss: await fontCss(doc),
  });
}
