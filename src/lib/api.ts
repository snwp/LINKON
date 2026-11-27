import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { t as tr } from './i18n.svelte';

/** Extensões que o Windows executa ao abrir. */
export const BLOCKED_TO_OPEN =
  /\.(exe|com|bat|cmd|scr|pif|msi|msp|msc|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|url|cpl|reg|jar|appref-ms|application|gadget|inf|scf|dll|sys|ocx|chm|iso|img|vhd|vhdx)$/i;

export type Page = {
  id: number;
  title: string;
  project_id: number | null;
  /** Documento do editor em JSON (ver src/lib/editor/doc.ts). */
  doc: string;
  created_at: number;
  updated_at: number;
};

export type Idea = {
  id: number;
  title: string;
  body: string;
  project_id: number | null;
  created_at: number;
  updated_at: number;
};

export type Project = {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
  idea_count: number;
};

export type FileKind = 'imagem' | 'pdf' | 'documento' | 'texto' | 'outro';

export type FileItem = {
  id: number;
  name: string;
  ext: string;
  kind: FileKind;
  size: number;
  /** Cópia dentro da biblioteca. */
  path: string;
  source_path: string;
  imported_at: number;
  project_ids: number[];
  idea_ids: number[];
};

export type ImportReport = {
  imported: FileItem[];
  failed: { name: string; reason: string }[];
};

/** Onde associar os arquivos importados. */
export type ImportTarget = { projectId?: number | null; ideaId?: number | null };

/** Arquivos escolhidos: caminhos no app desktop, objetos File na prévia do navegador. */
export type Picked = string[] | File[];

type Api = {
  listIdeas(query?: string): Promise<Idea[]>;
  getIdea(id: number): Promise<Idea>;
  createIdea(title: string, body: string, projectId: number | null): Promise<Idea>;
  updateIdea(id: number, title: string, body: string, projectId: number | null): Promise<Idea>;
  deleteIdea(id: number): Promise<void>;
  listProjects(): Promise<Project[]>;
  createProject(name: string): Promise<number>;
  renameProject(id: number, name: string): Promise<void>;
  deleteProject(id: number): Promise<void>;
  dataDir(): Promise<string>;
  openDataDir(): Promise<void>;

  listFiles(): Promise<FileItem[]>;
  /** Abre o seletor do sistema. null quando o usuário cancela. */
  pickFiles(): Promise<Picked | null>;
  importFiles(picked: Picked, target: ImportTarget): Promise<ImportReport>;
  deleteFile(id: number): Promise<void>;
  setFileLink(fileId: number, target: 'project' | 'idea', targetId: number, linked: boolean): Promise<void>;
  textPreview(id: number): Promise<string>;
  fileUrl(f: FileItem): string;
  openFile(f: FileItem): Promise<void>;

  linkIdeas(a: number, b: number, linked: boolean): Promise<void>;
  listIdeaLinks(): Promise<[number, number][]>;

  listPages(): Promise<Page[]>;
  createPage(title: string, projectId: number | null, doc?: string): Promise<Page>;
  updatePage(id: number, title: string, projectId: number | null, doc: string): Promise<Page>;
  deletePage(id: number): Promise<void>;

  /** Pergunta onde salvar. null quando o usuário cancela. */
  pickSavePath(defaultName: string): Promise<string | null>;
  /** Grava o HTML; `linkon-file://<id>` vira a imagem embutida. */
  exportHtml(path: string, html: string): Promise<void>;
  pickFolder(title: string): Promise<string | null>;
  createBackup(parent: string, name: string): Promise<string>;
  restoreBackup(source: string, safetyName: string): Promise<string>;

  /** Claude Code instalado e se há conta conectada; erro quando não é encontrado. */
  aiCheck(): Promise<{ version: string; loggedIn: boolean; authMethod: string }>;
  /**
   * Roda um pedido no Claude Code local. `onLine` recebe cada linha do stream-json.
   * Resolve quando o processo termina; rejeita com a mensagem de erro do processo.
   */
  aiRun(req: AiRequest, onLine: (line: string) => void): Promise<void>;
  aiCancel(runId: string): Promise<void>;

  /** Grava o site da interface em Documentos/Linkon. Devolve a pasta relativa ("pasta/interface"). */
  syncSite(pageId: number, html: string, pages?: [string, string][]): Promise<string>;
  /** Grava o site, sobe o servidor local e abre no navegador. Devolve o endereço. */
  openInBrowser(pageId: number, html: string, pages?: [string, string][]): Promise<string>;
  sitesFolder(): Promise<string>;
  openSitesFolder(): Promise<string>;
  /** Grava o site e faz a revisão de segurança, para a confirmação antes de publicar. */
  preparePublish(pageId: number, html: string, pages?: [string, string][]): Promise<PublishCheck>;
  /** Publica na Vercel (produção). Devolve o endereço do site. */
  publishSite(pageId: number): Promise<string>;
  openPublished(url: string): Promise<void>;
  /** Link de um site na visualização: abre no navegador do sistema (só http, https, mailto e tel; ver capabilities). */
  openLink(url: string): Promise<void>;
  vercelStatus(): Promise<VercelStatus>;

  /** Gera uma imagem e a guarda na biblioteca (já na pasta, se houver). Rejeita com "cancelado" ao parar. */
  generateImage(req: ImageRequest): Promise<FileItem>;
  cancelImage(): Promise<void>;
  /** `codex`: linha do `codex login status` (vazia sem Codex). `hasKey`: há chave da OpenAI guardada. */
  imageStatus(): Promise<{ codex: string; hasKey: boolean }>;
  /** Guarda a chave da OpenAI no cofre do Windows; vazia apaga. A chave nunca volta para a interface. */
  setImageKey(key: string): Promise<void>;

  /** Bases de componentes do Linke: sites de referência salvos pela URL, com o resumo buscado ao salvar. */
  listBases(): Promise<ComponentBase[]>;
  /** Fotos de referência para o Linke (Openverse); vazia quando não acha. Só no app desktop. */
  findReferences(query: string): Promise<RefImage[]>;
  /** Busca a página, resume e guarda (ou atualiza, se a URL já existe). */
  addBase(url: string): Promise<ComponentBase>;
  deleteBase(id: number): Promise<void>;
};

export type RefImage = { media_type: string; data: string; title: string };

export type ComponentBase = { id: number; url: string; title: string; summary: string; created_at: number };

export type VercelStatus = { installed: boolean; user: string };
export type PublishCheck = {
  name: string;
  findings: { level: 'erro' | 'aviso'; text: string }[];
  vercel: VercelStatus;
};

export type ImageRequest = {
  prompt: string;
  shape: 'square' | 'wide' | 'tall';
  provider: 'codex' | 'openai';
  model: string;
  projectId: number | null;
};

export type AiRequest = {
  runId: string;
  prompt: string;
  systemPrompt: string;
  /** Apelido aceito pelo Claude Code ("opus", "sonnet", "haiku") ou vazio para o padrão dele. */
  model: string;
  /** Fotos de referência que vão junto do pedido (até 3). */
  images?: { media_type: string; data: string }[];
};

type AiEvent = { runId: string; line?: string; done?: boolean; error?: string };

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** O backend Rust devolve erros como texto pronto para o usuário. */
export function message(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : 'Erro inesperado.';
}

const tauriApi: Api = {
  listIdeas: (query) => invoke('list_ideas', { query: query ?? null }),
  getIdea: (id) => invoke('get_idea', { id }),
  createIdea: (title, body, projectId) => invoke('create_idea', { title, body, projectId }),
  updateIdea: (id, title, body, projectId) => invoke('update_idea', { id, title, body, projectId }),
  deleteIdea: (id) => invoke('delete_idea', { id }),
  listProjects: () => invoke('list_projects'),
  createProject: (name) => invoke('create_project', { name }),
  renameProject: (id, name) => invoke('rename_project', { id, name }),
  deleteProject: (id) => invoke('delete_project', { id }),
  dataDir: () => invoke('data_dir'),
  openDataDir: () => invoke('open_data_dir'),

  listFiles: () => invoke('list_files'),
  async pickFiles() {
    const sel = await openDialog({ multiple: true, directory: false, title: tr('Adicionar arquivos') });
    if (!sel) return null;
    return Array.isArray(sel) ? sel : [sel];
  },
  importFiles: (picked, t) =>
    invoke('import_files', { paths: picked, projectId: t.projectId ?? null, ideaId: t.ideaId ?? null }),
  deleteFile: (id) => invoke('delete_file', { id }),
  setFileLink: (fileId, target, targetId, linked) =>
    invoke('set_file_link', { fileId, target, targetId, linked }),
  textPreview: (id) => invoke('text_preview', { id }),
  fileUrl: (f) => convertFileSrc(f.path),
  // Programas, scripts e atalhos não abrem pelo Linkon: um backup de terceiros pode trazer um .exe com nome de foto.
  // A extensão conferida é a do arquivo no disco, não o nome mostrado.
  openFile: (f) =>
    !f.path || BLOCKED_TO_OPEN.test(f.path)
      ? Promise.reject(tr('Por segurança, o Linkon não abre programas, scripts nem atalhos.'))
      : openPath(f.path),

  linkIdeas: (a, b, linked) => invoke('link_ideas', { a, b, linked }),
  listIdeaLinks: () => invoke('list_idea_links'),

  listPages: () => invoke('list_pages'),
  createPage: (title, projectId, doc) => invoke('create_page', { title, projectId, doc: doc ?? null }),
  updatePage: (id, title, projectId, doc) => invoke('update_page', { id, title, projectId, doc }),
  deletePage: (id) => invoke('delete_page', { id }),

  pickSavePath: (defaultPath) =>
    saveDialog({ defaultPath, filters: [{ name: tr('Página HTML'), extensions: ['html'] }], title: tr('Exportar página') }),
  exportHtml: (path, html) => invoke('export_page_html', { path, html }),
  async pickFolder(title) {
    const sel = await openDialog({ directory: true, multiple: false, title });
    return typeof sel === 'string' ? sel : null;
  },
  createBackup: (parent, name) => invoke('create_backup', { parent, name }),
  restoreBackup: (source, safetyName) => invoke('restore_backup', { source, safetyName }),

  aiCheck: () => invoke('ai_check'),
  async aiRun(req, onLine) {
    let finish!: (err?: string) => void;
    const ended = new Promise<string | undefined>((resolve) => (finish = resolve));
    // Escuta antes de iniciar, para não perder as primeiras linhas.
    const unlisten = await listen<AiEvent>('ai-event', (e) => {
      if (e.payload.runId !== req.runId) return;
      if (e.payload.line !== undefined) onLine(e.payload.line);
      if (e.payload.done) finish(e.payload.error);
    });
    try {
      await invoke('ai_run', { ...req, images: req.images ?? null });
      const err = await ended;
      if (err) throw err;
    } finally {
      unlisten();
    }
  },
  aiCancel: (runId) => invoke('ai_cancel', { runId }),

  syncSite: (pageId, html, pages) => invoke('sync_site', { pageId, html, pages }),
  openInBrowser: (pageId, html, pages) => invoke('open_in_browser', { pageId, html, pages }),
  sitesFolder: () => invoke('sites_folder'),
  openSitesFolder: () => invoke('open_sites_folder'),
  preparePublish: (pageId, html, pages) => invoke('prepare_publish', { pageId, html, pages }),
  publishSite: (pageId) => invoke('publish_site', { pageId }),
  openPublished: (url) => invoke('open_published', { url }),
  openLink: (url) => openUrl(url),
  vercelStatus: () => invoke('vercel_status'),

  generateImage: (req) => invoke('generate_image', { ...req }),
  cancelImage: () => invoke('cancel_image'),
  imageStatus: () => invoke('image_status'),
  setImageKey: (key) => invoke('set_image_key', { key }),

  listBases: () => invoke('list_bases'),
  addBase: (url) => invoke('add_base', { url }),
  deleteBase: (id) => invoke('delete_base', { id }),
  findReferences: (query) => invoke('find_references', { query }),
};

const KINDS: Record<string, FileKind> = {};
for (const e of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']) KINDS[e] = 'imagem';
KINDS.pdf = 'pdf';
for (const e of ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'pages', 'numbers', 'key', 'epub'])
  KINDS[e] = 'documento';
for (const e of ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'log', 'yaml', 'yml', 'toml', 'ini', 'srt'])
  KINDS[e] = 'texto';

/**
 * Prévia no navegador (npm run dev sem o Tauri): dados só em memória.
 * Imita as regras do backend (src-tauri/src/db.rs e library.rs) para a interface poder ser testada.
 */
function memoryApi(): Api {
  let ideas: Idea[] = [];
  let projects: Omit<Project, 'idea_count'>[] = [];
  let files: FileItem[] = [];
  let links: [number, number][] = [];
  let pages: Page[] = [];
  const blobs = new Map<number, File>();
  const pageTitle = (t: string) => {
    if (!t.trim()) throw tr('A página precisa de um título.');
    return t.trim();
  };
  const checkDoc = (doc: string) => {
    try {
      if (!Array.isArray(JSON.parse(doc).elements)) throw 0;
    } catch {
      throw tr('O conteúdo da página está corrompido.');
    }
  };
  const toDataUrl = (blob: Blob) =>
    new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve('data:,');
      r.readAsDataURL(blob);
    });
  let next = 1;
  const now = () => Date.now();
  const title = (t: string) => {
    if (!t.trim()) throw tr('O título não pode ficar vazio.');
    return t.trim();
  };
  const name = (n: string) => {
    if (!n.trim()) throw tr('O nome do projeto não pode ficar vazio.');
    return n.trim();
  };
  const checkProject = (id: number | null) => {
    if (id !== null && !projects.some((p) => p.id === id)) throw tr('O projeto escolhido não existe mais.');
    const p = projects.find((p) => p.id === id);
    if (p) p.updated_at = now();
  };
  const find = (id: number) => {
    const i = ideas.find((i) => i.id === id);
    if (!i) throw tr('Ideia não encontrada.');
    return i;
  };
  const copyFile = (f: FileItem): FileItem => ({ ...f, project_ids: [...f.project_ids], idea_ids: [...f.idea_ids] });
  return {
    async listIdeas(query) {
      const q = query?.trim().toLowerCase();
      return ideas
        .filter((i) => !q || i.title.toLowerCase().includes(q))
        .sort((a, b) => b.updated_at - a.updated_at)
        .map((i) => ({ ...i }));
    },
    async getIdea(id) {
      return { ...find(id) };
    },
    async createIdea(t, body, projectId) {
      checkProject(projectId);
      const idea = { id: next++, title: title(t), body, project_id: projectId, created_at: now(), updated_at: now() };
      ideas.push(idea);
      return { ...idea };
    },
    async updateIdea(id, t, body, projectId) {
      const idea = find(id);
      checkProject(projectId);
      Object.assign(idea, { title: title(t), body, project_id: projectId, updated_at: now() });
      return { ...idea };
    },
    async deleteIdea(id) {
      ideas = ideas.filter((i) => i.id !== id);
      links = links.filter(([a, b]) => a !== id && b !== id);
      for (const f of files) f.idea_ids = f.idea_ids.filter((x) => x !== id);
    },
    async listProjects() {
      return projects
        .map((p) => ({ ...p, idea_count: ideas.filter((i) => i.project_id === p.id).length }))
        .sort((a, b) => b.updated_at - a.updated_at);
    },
    async createProject(n) {
      const p = { id: next++, name: name(n), created_at: now(), updated_at: now() };
      projects.push(p);
      return p.id;
    },
    async renameProject(id, n) {
      const p = projects.find((p) => p.id === id);
      if (!p) throw tr('Projeto não encontrado.');
      Object.assign(p, { name: name(n), updated_at: now() });
    },
    async deleteProject(id) {
      projects = projects.filter((p) => p.id !== id);
      for (const i of ideas) if (i.project_id === id) i.project_id = null;
      for (const f of files) f.project_ids = f.project_ids.filter((x) => x !== id);
      for (const p of pages) if (p.project_id === id) p.project_id = null;
    },
    async dataDir() {
      return tr('Prévia no navegador: nada é gravado em disco.');
    },
    async openDataDir() {
      throw tr('A pasta dos dados só existe no app desktop.');
    },

    async listFiles() {
      return files.map(copyFile).sort((a, b) => b.imported_at - a.imported_at || b.id - a.id);
    },
    pickFiles() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = () => resolve([...(input.files ?? [])]);
        input.oncancel = () => resolve(null);
        input.click();
      });
    },
    async importFiles(picked, t) {
      const report: ImportReport = { imported: [], failed: [] };
      for (const file of picked) {
        if (typeof file === 'string') {
          report.failed.push({ name: file, reason: tr('Caminhos só funcionam no app desktop.') });
          continue;
        }
        const ext = /\.([a-z0-9]{1,10})$/i.exec(file.name)?.[1].toLowerCase() ?? '';
        const item: FileItem = {
          id: next++,
          name: file.name,
          ext,
          kind: KINDS[ext] ?? 'outro',
          size: file.size,
          // data URI (e não blob:) para a imagem também aparecer no iframe isolado da visualização.
          path: await toDataUrl(file),
          source_path: file.name,
          imported_at: now(),
          project_ids: t.projectId ? [t.projectId] : [],
          idea_ids: t.ideaId ? [t.ideaId] : [],
        };
        files.push(item);
        blobs.set(item.id, file);
        report.imported.push(copyFile(item));
      }
      return report;
    },
    async deleteFile(id) {
      files = files.filter((f) => f.id !== id);
      blobs.delete(id);
    },
    async setFileLink(fileId, target, targetId, linked) {
      const f = files.find((f) => f.id === fileId);
      if (!f) throw tr('Arquivo não encontrado.');
      const key = target === 'project' ? 'project_ids' : 'idea_ids';
      f[key] = f[key].filter((x) => x !== targetId);
      if (linked) f[key].push(targetId);
    },
    async textPreview(id) {
      const blob = blobs.get(id);
      if (!blob) throw tr('Arquivo não encontrado.');
      return blob.slice(0, 64 * 1024).text();
    },
    fileUrl: (f) => f.path,
    async openFile(f) {
      window.open(f.path, '_blank');
    },

    async linkIdeas(a, b, linked) {
      if (a === b) throw tr('Uma ideia não pode se conectar a ela mesma.');
      const [x, y] = a < b ? [a, b] : [b, a];
      if (!ideas.some((i) => i.id === x) || !ideas.some((i) => i.id === y)) throw tr('Uma das ideias não existe mais.');
      links = links.filter(([p, q]) => !(p === x && q === y));
      if (linked) links.push([x, y]);
    },
    async listIdeaLinks() {
      return links.map(([a, b]) => [a, b]);
    },

    async listPages() {
      return pages.map((p) => ({ ...p })).sort((a, b) => b.updated_at - a.updated_at);
    },
    async createPage(t, projectId, doc) {
      checkProject(projectId);
      const d = doc ?? '{"version":1,"width":1280,"height":1600,"background":"#ffffff","elements":[]}';
      checkDoc(d);
      const p = { id: next++, title: pageTitle(t), project_id: projectId, doc: d, created_at: now(), updated_at: now() };
      pages.push(p);
      return { ...p };
    },
    async updatePage(id, t, projectId, doc) {
      const p = pages.find((p) => p.id === id);
      if (!p) throw tr('Página não encontrada.');
      checkProject(projectId);
      checkDoc(doc);
      Object.assign(p, { title: pageTitle(t), project_id: projectId, doc, updated_at: now() });
      return { ...p };
    },
    async deletePage(id) {
      pages = pages.filter((p) => p.id !== id);
    },

    async pickSavePath(defaultName) {
      return defaultName;
    },
    async exportHtml(path, html) {
      // Na prévia, embute as imagens como data URI e baixa o arquivo pelo navegador.
      const parts = html.split(/linkon-file:\/\/(\d+)/);
      for (let i = 1; i < parts.length; i += 2) {
        const blob = blobs.get(Number(parts[i]));
        parts[i] = blob ? await toDataUrl(blob) : 'data:,';
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([parts.join('')], { type: 'text/html' }));
      a.download = path;
      a.click();
    },
    async pickFolder() {
      throw tr('Cópias de segurança só funcionam no app desktop.');
    },
    async createBackup() {
      throw tr('Cópias de segurança só funcionam no app desktop.');
    },
    async restoreBackup() {
      throw tr('Cópias de segurança só funcionam no app desktop.');
    },

    async aiCheck() {
      throw tr('O assistente só funciona no app desktop, usando o Claude Code instalado neste computador.');
    },
    async aiRun() {
      throw tr('O assistente só funciona no app desktop, usando o Claude Code instalado neste computador.');
    },
    async aiCancel() {},

    async syncSite() {
      return '';
    },
    async openInBrowser() {
      throw tr('Ver no navegador só funciona no app desktop.');
    },
    async sitesFolder() {
      return tr('Prévia no navegador: os sites não são gravados.');
    },
    async openSitesFolder() {
      throw tr('A pasta dos sites só existe no app desktop.');
    },
    async preparePublish() {
      throw tr('Publicar só funciona no app desktop.');
    },
    async publishSite() {
      throw tr('Publicar só funciona no app desktop.');
    },
    async openPublished() {},
    async openLink(url) {
      window.open(url, '_blank', 'noopener');
    },
    async vercelStatus() {
      return { installed: false, user: '' };
    },

    async generateImage() {
      throw tr('Gerar imagens só funciona no app desktop.');
    },
    async cancelImage() {},
    async imageStatus() {
      return { codex: '', hasKey: false };
    },
    async setImageKey() {
      throw tr('A chave só pode ser guardada no app desktop.');
    },

    async listBases() {
      return [];
    },
    async addBase() {
      throw tr('Buscar um site de componentes só funciona no app desktop.');
    },
    async deleteBase() {},
    async findReferences() {
      return [];
    },
  };
}

export const api: Api = isTauri ? tauriApi : memoryApi();
