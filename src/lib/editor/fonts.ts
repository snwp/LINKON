import geist from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url';
import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import geistMono from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url';
import type { Doc, FontRole } from './doc';

/**
 * As páginas usam as fontes do app. A visualização (iframe isolado) e o HTML exportado não enxergam as fontes
 * carregadas na janela, então elas vão embutidas como data URI: só as que a página usa, só o subconjunto latino.
 */
const FILES: Record<FontRole, { family: string; url: string }> = {
  ui: { family: 'Geist Variable', url: geist },
  text: { family: 'Inter Variable', url: inter },
  mono: { family: 'Geist Mono Variable', url: geistMono },
};

const cache = new Map<FontRole, Promise<string>>();

function load(role: FontRole): Promise<string> {
  let p = cache.get(role);
  if (!p) {
    p = fetch(FILES[role].url)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
      )
      .then((data) => `@font-face{font-family:'${FILES[role].family}';src:url(${data}) format('woff2');font-weight:100 900;font-display:swap}`)
      // Sem a fonte, a página cai na fonte do sistema; não vale travar a visualização por isso.
      .catch(() => '');
    cache.set(role, p);
  }
  return p;
}

export async function fontCss(doc: Doc): Promise<string> {
  const all = [...doc.elements, ...(doc.mobile?.elements ?? [])];
  const roles = [...new Set(all.filter((e) => !e.hidden && e.type !== 'imagem').map((e) => e.font))];
  return (await Promise.all(roles.map(load))).join('');
}
