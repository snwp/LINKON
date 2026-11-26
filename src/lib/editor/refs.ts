import { store } from '$lib/store.svelte';
import { bytes, KIND_LABELS } from '$lib/format';
import type { El } from './doc';

/** Título e subtítulo do cartão de uma referência, a partir dos dados atuais. */
export function refInfo(ref: NonNullable<El['ref']>): { title: string; subtitle: string } {
  if (ref.kind === 'idea') {
    const idea = store.ideas.find((i) => i.id === ref.id);
    if (!idea) return { title: 'Ideia removida', subtitle: '' };
    const body = idea.body.trim().replace(/\s+/g, ' ');
    return { title: idea.title, subtitle: body.length > 140 ? `${body.slice(0, 140)}…` : body };
  }
  const f = store.files.find((x) => x.id === ref.id);
  if (!f) return { title: 'Arquivo removido', subtitle: '' };
  return { title: f.name, subtitle: `${KIND_LABELS[f.kind].one} · ${bytes(f.size)}` };
}
