import {
  api,
  message,
  type FileItem,
  type Idea,
  type ImportTarget,
  type Page,
  type Picked,
  type Project,
} from './api';

/** Tudo o que as telas mostram. Recarregado depois de cada alteração. */
export const store = $state({
  ideas: [] as Idea[],
  projects: [] as Project[],
  files: [] as FileItem[],
  pages: [] as Page[],
  /** Pares de ideias conectadas, com a < b. */
  ideaLinks: [] as [number, number][],
  loaded: false,
  error: '',
  /** Aviso neutro (importação, exportação, cópia de segurança). */
  notice: '',
  noticeHref: '',
});

export async function reload() {
  try {
    const [ideas, projects, files, pages, ideaLinks] = await Promise.all([
      api.listIdeas(),
      api.listProjects(),
      api.listFiles(),
      api.listPages(),
      api.listIdeaLinks(),
    ]);
    Object.assign(store, { ideas, projects, files, pages, ideaLinks, loaded: true });
  } catch (e) {
    store.error = `Não foi possível carregar seus dados. ${message(e)}`;
  }
}

export function projectName(id: number | null): string | undefined {
  return store.projects.find((p) => p.id === id)?.name;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Mostra um aviso neutro; some sozinho depois de alguns segundos, a menos que `sticky`. `href` vira um link "Abrir". */
export function notify(text: string, sticky = false, href = '') {
  clearTimeout(noticeTimer);
  store.notice = text;
  store.noticeHref = href;
  if (!sticky) noticeTimer = setTimeout(() => (store.notice = ''), 5000);
}

/**
 * Importa arquivos (cópia na pasta de dados do app), já associados à pasta indicada.
 * Sem `picked`, abre o seletor do sistema. Devolve os arquivos importados.
 */
export async function addFiles(target: ImportTarget = {}, picked?: Picked): Promise<FileItem[]> {
  try {
    const chosen = picked ?? (await api.pickFiles());
    if (!chosen || chosen.length === 0) return [];
    notify(chosen.length === 1 ? 'Importando 1 arquivo…' : `Importando ${chosen.length} arquivos…`, true);
    const report = await api.importFiles(chosen, target);
    await reload();
    const n = report.imported.length;
    if (n === 0) store.notice = '';
    else notify(n === 1 ? '1 arquivo importado.' : `${n} arquivos importados.`);
    if (report.failed.length) {
      store.error = `Não foi possível adicionar: ${report.failed.map((f) => `${f.name} (${f.reason})`).join('; ')}`;
    }
    return report.imported;
  } catch (e) {
    store.notice = '';
    store.error = `A importação falhou. ${message(e)}`;
    return [];
  }
}

export async function setFileLink(file: FileItem, target: 'project' | 'idea', targetId: number, linked: boolean) {
  try {
    await api.setFileLink(file.id, target, targetId, linked);
    await reload();
  } catch (e) {
    store.error = message(e);
  }
}

export async function linkIdeas(a: number, b: number, linked: boolean) {
  try {
    await api.linkIdeas(a, b, linked);
    await reload();
  } catch (e) {
    store.error = message(e);
  }
}

/** Data local legível para nomes de pasta: "2026-11-24 14h05". */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h${p(d.getMinutes())}`;
}
