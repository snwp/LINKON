// HTML do site de uma interface (pasta em Documentos/Linkon): imagens como `linkon-file://<id>`, que o Rust
// troca pelos arquivos copiados para assets/, e o ajuste a telas estreitas em fit.js.
import { frameFiles, type Doc } from './editor/doc';
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
    frames: frameFiles(doc),
  });
}

/** Uma página por quadro extra: [arquivo, html]. Os links entre quadros usam os mesmos nomes de arquivo. */
export async function sitePages(title: string, doc: Doc): Promise<[string, string][]> {
  const files = frameFiles(doc);
  return Promise.all(
    (doc.frames ?? []).map(async (f): Promise<[string, string]> => [
      files.get(f.id)!,
      renderHtml(f, { title: `${f.name} · ${title}`, src: (id) => `linkon-file://${id}`, ref: refInfo, fitScript: 'file', fontCss: await fontCss(f), frames: files }),
    ]),
  );
}
