<script lang="ts">
  import { slidingPill, textSwap, frameIn } from '$lib/motion';
  import { onMount, tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { goto } from '$app/navigation';
  import { page as route } from '$app/state';
  import { ArrowLeft, Undo2, Redo2, Minus, Plus, Eye, Monitor, Smartphone, Trash2, PanelLeftOpen, PanelRightOpen } from '@lucide/svelte';
  import { toMobile } from './layouts';
  import { api, message, type Page } from '$lib/api';
  import { store, reload, notify } from '$lib/store.svelte';
  import { background, aiLogs, getAiNotify } from './background.svelte';
  import { registerFlush } from '$lib/pending';
  import { siteHtml } from '$lib/site';
  import {
    createElement,
    elementStyle,
    parseDoc,
    emptyImagesUnder,
    resizeRect,
    snapMove,
    HANDLES,
    type Doc,
    type El,
    type ElementType,
    type Handle,
  } from './doc';
  import { refInfo } from './refs';
  import Panel from './Panel.svelte';
  import ClaudePanel from './ClaudePanel.svelte';
  import Linke from '$lib/Linke.svelte';
  import SelectionBar from './SelectionBar.svelte';
  import { takePending } from '$lib/agent.svelte';
  import PromptBubble from './PromptBubble.svelte';
  import {
    SYSTEM_PROMPT,
    applyOp,
    buildPrompt,
    friendlyAiError,
    getAiModel,
    parseOp,
    readStreamLine,
    type AiUsage,
    type LogEntry,
  } from './assistant';
  import { recordUsage } from '$lib/usage';

  /** O pai remonta o editor com {#key page.id}. */
  let { page }: { page: Page } = $props();

  const SAVE_DELAY = 800;
  const HISTORY_LIMIT = 100;
  const SNAP_PX = 6;

  // svelte-ignore state_referenced_locally
  let title = $state(page.title);
  // svelte-ignore state_referenced_locally
  let projectId = $state<number | null>(page.project_id);
  // svelte-ignore state_referenced_locally
  const adopted = background.get(page.id);
  // svelte-ignore state_referenced_locally
  let root = $state<Doc>(adopted?.root ?? parseDoc(page.doc));
  /** Versão em edição. A mobile fica em `root.mobile`; tudo no canvas trabalha sobre `doc`. */
  let view = $state<'desktop' | 'mobile'>(
    // svelte-ignore state_referenced_locally
    route.url.searchParams.get('v') === 'mobile' && root.mobile ? 'mobile' : 'desktop',
  );
  let doc = $derived(view === 'mobile' && root.mobile ? root.mobile : root);
  let selectedId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let zoom = $state(0.75);
  let guides = $state<{ x: number | null; y: number | null }>({ x: null, y: null });
  let stage: HTMLDivElement | undefined = $state();

  // ---------- histórico (desfazer/refazer) ----------
  // O documento salvo e o histórico guardam o JSON; o estado vivo do canvas é `doc`.
  // svelte-ignore state_referenced_locally
  let snapshot = JSON.stringify($state.snapshot(root));
  let past: string[] = [];
  let future: string[] = [];
  let canUndo = $state(false);
  let canRedo = $state(false);

  function syncHistoryFlags() {
    canUndo = past.length > 0;
    canRedo = future.length > 0;
  }

  /** Fecha uma alteração: entra no histórico e é salva. Chamado ao soltar o mouse ou confirmar um campo. */
  function commit() {
    const now = JSON.stringify($state.snapshot(root));
    if (now === snapshot) return;
    past.push(snapshot);
    if (past.length > HISTORY_LIMIT) past.shift();
    future = [];
    snapshot = now;
    syncHistoryFlags();
    scheduleSave();
  }

  function restore(json: string) {
    snapshot = json;
    root = parseDoc(json);
    if (!root.mobile) view = 'desktop';
    if (!doc.elements.some((e) => e.id === selectedId)) selectedId = null;
    editingId = null;
    syncHistoryFlags();
    scheduleSave();
  }

  function undo() {
    commit();
    const prev = past.pop();
    if (prev === undefined) return;
    future.push(snapshot);
    restore(prev);
  }

  function redo() {
    const next = future.pop();
    if (next === undefined) return;
    past.push(snapshot);
    restore(next);
  }

  // ---------- salvamento automático ----------
  let status = $state<'saved' | 'pending' | 'saving' | 'error'>('saved');
  let errorText = $state('');
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  function scheduleSave() {
    dirty = true;
    status = 'pending';
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY);
  }

  function flush(): Promise<void> {
    clearTimeout(timer);
    chain = chain.then(save);
    return chain;
  }

  async function save() {
    if (!dirty) return;
    dirty = false;
    status = 'saving';
    try {
      const savedTitle = title.trim() || 'Sem título';
      const savedDoc = snapshot;
      await api.updatePage(page.id, savedTitle, projectId, savedDoc);
      status = dirty ? 'pending' : 'saved';
      reload();
      // O site em Documentos/Linkon acompanha cada salvamento; falhar aqui não desfaz o salvamento.
      siteHtml(savedTitle, parseDoc(savedDoc))
        .then((html) => api.syncSite(page.id, html))
        .catch((e) => (store.error = `A pasta do site não foi atualizada. ${message(e)}`));
    } catch (e) {
      dirty = true;
      status = 'error';
      errorText = message(e);
    }
  }

  onMount(() => {
    fit();
    const unregister = registerFlush(async () => {
      commit();
      await flush();
      return !dirty;
    });
    // Pedido escrito na caixa do agente de outra tela: a página nasceu para ele.
    const waiting = takePending();
    if (waiting) askAi(waiting);
    return () => {
      // O pedido em andamento continua sem a tela: termina, salva e avisa (ver askAi).
      if (aiRun && aiDone) {
        detached = true;
        background.set(page.id, { runId: aiRun.runId, markedId: aiRun.markedId, startedAt: aiStartedAt, root, done: aiDone });
      }
      unregister();
      commit();
      if (dirty) flush();
    };
  });

  // ---------- elementos ----------
  let selected = $derived(doc.elements.find((e) => e.id === selectedId) ?? null);

  function fileSrc(id: number | undefined): string | null {
    const f = id ? store.files.find((x) => x.id === id) : undefined;
    return f ? api.fileUrl(f) : null;
  }

  /** Seção é faixa de fundo: entra atrás de tudo. O resto entra na frente. */
  function addElement(el: El) {
    if (el.type === 'secao') doc.elements.unshift(el);
    else doc.elements.push(el);
  }

  function insert(type: ElementType, extra: Partial<El> = {}) {
    // Imagem escolhida com um espaço de imagem selecionado: vai para dentro dele.
    if (type === 'imagem' && extra.fileId && selected?.type === 'imagem') {
      selected.fileId = extra.fileId;
      commit();
      return;
    }
    const top = stage ? stage.scrollTop / zoom : 0;
    const probe = createElement(type, doc, 0, 0, extra);
    const x = type === 'secao' ? 0 : Math.max(0, Math.round((doc.width - probe.w) / 2));
    const y = Math.max(0, Math.round(top + 80));
    const el = { ...probe, x, y };
    addElement(el);
    selectedId = el.id;
    commit();
  }

  /**
   * Soltar algo arrastado do painel (cx, cy na tela). Fora da página, não faz nada.
   * Imagem solta sobre outra imagem troca o arquivo dela; o resto nasce centrado no ponto.
   */
  function dropAt(type: ElementType, extra: Partial<El>, cx: number, cy: number) {
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return;
    if (type === 'imagem' && extra.fileId) {
      // A imagem mais de cima sob o ponteiro, mesmo que um texto esteja por cima dela.
      const target = document
        .elementsFromPoint(cx, cy)
        .map((n) => (n as HTMLElement).closest?.<HTMLElement>('[data-id]'))
        .filter((n): n is HTMLElement => !!n && pageEl!.contains(n))
        .map((n) => doc.elements.find((e) => e.id === n.dataset.id && e.type === 'imagem'))
        .find((e) => e);
      if (target) {
        target.fileId = extra.fileId;
        selectedId = target.id;
        commit();
        return;
      }
    }
    const px = (cx - r.left) / zoom;
    const py = (cy - r.top) / zoom;
    const el = createElement(type, doc, 0, 0, extra);
    el.x = type === 'secao' ? 0 : Math.round(Math.min(doc.width - el.w, Math.max(0, px - el.w / 2)));
    el.y = Math.round(Math.max(0, py - el.h / 2));
    addElement(el);
    selectedId = el.id;
    commit();
  }

  function removeSelected() {
    if (!selectedId) return;
    // Imagem que estava sobre um espaço de imagem vazio: o espaço sai junto.
    const gone = new Set([selectedId]);
    if (selected?.type === 'imagem' && selected.fileId) for (const p of emptyImagesUnder(doc, selected)) gone.add(p.id);
    doc.elements = doc.elements.filter((e) => !gone.has(e.id));
    selectedId = null;
    commit();
  }

  function duplicate() {
    if (!selected) return;
    const copy = { ...$state.snapshot(selected), id: Math.random().toString(36).slice(2, 10), x: selected.x + 24, y: selected.y + 24, name: `${selected.name} (cópia)` };
    const i = doc.elements.findIndex((e) => e.id === selected!.id);
    doc.elements.splice(i + 1, 0, copy);
    selectedId = copy.id;
    commit();
  }

  // ---------- arrastar e redimensionar ----------
  // Estado temporário da interface, separado do documento (briefing 9.4).
  type Drag = {
    id: string;
    handle: Handle | null;
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
    moved: boolean;
    /** Já estava selecionado ao clicar: um segundo clique sem arrastar entra na edição do texto. */
    wasSelected: boolean;
  };
  let drag: Drag | null = null;
  /** Arrastando ou redimensionando: a barra de ajustes some para não atrapalhar. */
  let moving = $state(false);

  // Painéis minimizados para o canto (escolha guardada neste computador).
  const PANELS_KEY = 'linkon.editor.panels';
  let panels = $state<{ left: boolean; right: boolean }>(loadPanels());

  function loadPanels() {
    try {
      const p = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}');
      return { left: p.left === true, right: p.right === true };
    } catch {
      return { left: false, right: false };
    }
  }

  function setPanel(side: 'left' | 'right', minimized: boolean) {
    panels[side] = minimized;
    try {
      localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
    } catch {
      // Sem armazenamento local, vale até fechar o app.
    }
    // O canvas ganhou ou perdeu largura: reajusta o zoom.
    tick().then(fit);
  }
  const TEXT_TYPES = ['texto', 'bloco', 'secao', 'link'];

  function startDrag(e: PointerEvent, el: El, handle: Handle | null) {
    if (e.button !== 0 || editingId === el.id) return;
    e.stopPropagation();
    e.preventDefault();
    // Captura o ponteiro: o arraste continua (e termina) mesmo se o mouse sair do canvas ou da janela.
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // Sem um ponteiro ativo (evento sintético), segue sem captura.
    }
    const wasSelected = selectedId === el.id;
    selectedId = el.id;
    drag = { id: el.id, handle, startX: e.clientX, startY: e.clientY, orig: { x: el.x, y: el.y, w: el.w, h: el.h }, moved: false, wasSelected };
  }

  function onpointermove(e: PointerEvent) {
    if (!drag) return;
    const el = doc.elements.find((x) => x.id === drag!.id);
    if (!el) return;
    const dx = (e.clientX - drag.startX) / zoom;
    const dy = (e.clientY - drag.startY) / zoom;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    drag.moved = true;
    moving = true;
    if (drag.handle) {
      Object.assign(el, resizeRect(drag.orig, drag.handle, dx, dy));
    } else if (e.altKey) {
      // Alt desliga o encaixe.
      el.x = Math.round(drag.orig.x + dx);
      el.y = Math.round(drag.orig.y + dy);
      guides = { x: null, y: null };
    } else {
      const s = snapMove(doc, el, drag.orig.x + dx, drag.orig.y + dy, SNAP_PX / zoom);
      el.x = s.x;
      el.y = s.y;
      guides = { x: s.gx, y: s.gy };
    }
  }

  function onpointerup() {
    if (drag?.moved) commit();
    // Segundo clique num texto já selecionado, sem arrastar: entra na edição.
    else if (drag && drag.wasSelected && !drag.handle) {
      const el = doc.elements.find((x) => x.id === drag!.id);
      if (el) startEdit(el);
    }
    drag = null;
    moving = false;
    guides = { x: null, y: null };
  }

  // ---------- edição de texto no canvas ----------
  /** Começar a digitar com o elemento selecionado troca o texto: o cursor vai para o fim, não seleciona tudo. */
  let caretAtEnd = false;

  function startEdit(el: El, typed?: string) {
    if (!TEXT_TYPES.includes(el.type)) return;
    if (typed !== undefined) el.text = typed;
    caretAtEnd = typed !== undefined;
    selectedId = el.id;
    editingId = el.id;
  }

  function focusEdit(node: HTMLElement) {
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    if (caretAtEnd) range.collapse(false);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function endEdit(el: El, node: HTMLElement) {
    el.text = node.innerText.replace(/\n$/, '');
    editingId = null;
    commit();
  }

  // ---------- desktop e mobile ----------
  async function switchView(v: 'desktop' | 'mobile') {
    if (v === view) return;
    commit();
    if (v === 'mobile' && !root.mobile) {
      // Primeira vez: a versão mobile nasce da desktop e entra no histórico como um passo.
      root.mobile = toMobile($state.snapshot(root) as Doc);
      commit();
    }
    selectedId = null;
    editingId = null;
    view = v;
    await tick();
    fit();
  }

  function removeMobile() {
    commit();
    root.mobile = undefined;
    view = 'desktop';
    selectedId = null;
    commit();
    tick().then(fit);
  }

  // ---------- zoom ----------
  function setZoom(z: number) {
    zoom = Math.min(2, Math.max(0.25, Math.round(z * 100) / 100));
  }

  function fit() {
    if (stage) setZoom(Math.min(1, (stage.clientWidth - 96) / doc.width));
  }

  function wheel(node: HTMLElement) {
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    node.addEventListener('wheel', handler, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', handler) };
  }

  // ---------- teclado ----------
  function onkeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if (mod && k === 'd') {
      e.preventDefault();
      duplicate();
    } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault();
      removeSelected();
    } else if (e.key === 'Escape') {
      selectedId = null;
    } else if (selected && !mod && !e.altKey && TEXT_TYPES.includes(selected.type) && (e.key === 'Enter' || e.key === 'F2')) {
      // Enter (ou F2) edita o texto do elemento selecionado.
      e.preventDefault();
      startEdit(selected);
    } else if (selected && !mod && !e.altKey && TEXT_TYPES.includes(selected.type) && e.key.length === 1) {
      // Digitar com um texto selecionado já substitui o texto.
      e.preventDefault();
      startEdit(selected, e.key);
    } else if (selected && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') selected.x -= step;
      if (e.key === 'ArrowRight') selected.x += step;
      if (e.key === 'ArrowUp') selected.y -= step;
      if (e.key === 'ArrowDown') selected.y += step;
      commit();
    }
  }

  // ---------- assistente de IA ----------
  let aiStartedAt = $state(0);
  /** Ids criados pela IA neste pedido. A classe só importa quando o elemento nasce (a animação roda uma vez). */
  const aiEntering = new SvelteSet<string>();
  // svelte-ignore state_referenced_locally
  let aiLog = $state<LogEntry[]>(aiLogs.get(page.id) ?? []);
  // svelte-ignore state_referenced_locally
  aiLogs.set(page.id, aiLog);
  let aiRun = $state<{ runId: string; markedId: string | null } | null>(null);
  let aiDone: Promise<void> | null = null;
  /** O editor fechou com o pedido rodando. */
  let detached = false;
  // Reaberto no meio de um pedido: mostra-o rodando e, quando acabar, vira um passo de desfazer aqui também.
  if (adopted) {
    aiRun = { runId: adopted.runId, markedId: adopted.markedId };
    aiStartedAt = adopted.startedAt;
    aiDone = adopted.done;
    adopted.done.then(() => {
      aiRun = null;
      commit();
    });
  }
  let bubble = $state<{ x: number; y: number; markedId: string | null; point: { x: number; y: number } | null; label: string } | null>(null);
  let recentRequests: string[] = [];
  let pageEl: HTMLDivElement | undefined = $state();

  /** Botão direito: num elemento, marca só ele; numa área vazia da página, marca o ponto. */
  function openBubble(e: MouseEvent, el: El | null) {
    e.preventDefault();
    e.stopPropagation();
    if (aiRun) return;
    if (el) {
      selectedId = el.id;
      bubble = { x: e.clientX, y: e.clientY, markedId: el.id, point: null, label: el.name };
    } else if (pageEl) {
      const r = pageEl.getBoundingClientRect();
      const point = { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
      bubble = { x: e.clientX, y: e.clientY, markedId: null, point, label: `Ponto na página · x ${Math.round(point.x)}, y ${Math.round(point.y)}` };
    }
  }

  async function askAi(request: string, markedId: string | null = null, point: { x: number; y: number } | null = null) {
    if (aiRun) return;
    bubble = null;
    commit();
    const marked = markedId ? doc.elements.find((e) => e.id === markedId) ?? null : null;
    aiLog.push({ kind: 'user', text: request, scope: marked ? marked.name : point ? `x ${Math.round(point.x)}, y ${Math.round(point.y)}` : undefined });

    const images = store.files.filter((f) => f.kind === 'imagem');
    const others = store.files.filter((f) => f.kind !== 'imagem');
    const ideas = store.ideas.slice(0, 60);
    const ctx = {
      fileIds: new Set(images.map((f) => f.id)),
      ideaIds: new Set(ideas.map((i) => i.id)),
      refFileIds: new Set(others.map((f) => f.id)),
    };
    const prompt = buildPrompt({
      request,
      doc: $state.snapshot(doc) as Doc,
      title,
      marked: marked ? ($state.snapshot(marked) as El) : null,
      point,
      images: images.slice(0, 60).map((f) => ({ id: f.id, name: f.name })),
      recent: recentRequests,
    });

    const runId = Math.random().toString(36).slice(2, 10);
    aiRun = { runId, markedId };
    let finished!: () => void;
    aiDone = new Promise((r) => (finished = r));
    // Fixa a versão (desktop ou mobile) do pedido: o resultado não muda de versão no meio.
    const target = doc;
    aiStartedAt = Date.now();
    const model = getAiModel();
    let usage: AiUsage | null = null;
    let buffer = '';
    let sawText = false;
    let applied = 0;
    let said = 0;
    let failure = '';

    const handleLine = (line: string) => {
      const op = parseOp(line, ctx);
      if (!op) return;
      if (op.op === 'say') {
        said++;
        aiLog.push({ kind: 'ai', text: op.text });
        return;
      }
      const count = target.elements.length;
      const label = applyOp(target, op, { markedId });
      if (label) {
        // Criado pela IA: entra com animação, para dar para ver a página se montando (preencher um espaço não cria nada).
        if (op.op === 'add' && target.elements.length > count) aiEntering.add(target.elements[target.elements.length - 1].id);
        applied++;
        aiLog.push({ kind: 'action', text: label });
      }
    };
    const consume = (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    };

    try {
      await api.aiRun({ runId, prompt, systemPrompt: SYSTEM_PROMPT, model }, (raw) => {
        const r = readStreamLine(raw);
        if (r.text) {
          sawText = true;
          consume(r.text);
        }
        if (r.result) {
          usage = r.result.usage ?? null;
          if (!r.result.ok) failure = r.result.text || 'erro sem detalhes';
          else if (!sawText) consume(`${r.result.text}\n`);
        }
      });
    } catch (e) {
      // O evento "result" explica melhor (conta, limite) do que o código de saída do processo.
      if (!failure) failure = message(e);
    }
    if (buffer.trim()) handleLine(buffer);
    if (failure) aiLog.push({ kind: 'error', text: friendlyAiError(failure) });
    else if (applied === 0 && said === 0) aiLog.push({ kind: 'ai', text: 'Nada foi alterado.' });
    // Entra na tela "Uso da IA" (pedidos sem resposta contam como pedido, sem tokens).
    // (o TypeScript não vê que o callback acima preenche `usage`)
    const u = usage as AiUsage | null;
    recordUsage({
      at: Date.now(),
      model,
      input: u?.input ?? 0,
      output: u?.output ?? 0,
      ms: u?.ms || Date.now() - aiStartedAt,
      ok: !failure,
    });
    aiRun = null;
    // Depois do pedido, os elementos já assentaram; desfazer/refazer não deve reanimar nada.
    setTimeout(() => aiEntering.clear(), 400);
    recentRequests = [...recentRequests, request].slice(-5);
    // Tudo o que o assistente fez num pedido vira um único passo de desfazer.
    if (applied) commit();
    if (detached) {
      // Salva já (sem esperar o atraso) e só então libera a página para o editor reabrir com o resultado.
      await flush();
      await reload();
      background.delete(page.id);
      const here = route.url.pathname === '/editor' && Number(route.url.searchParams.get('id')) === page.id;
      if (!here && getAiNotify()) {
        const name = title.trim() || 'Sem título';
        notify(failure ? `Linke parou com erro em “${name}”.` : `Linke terminou “${name}”.`, true, `/editor?id=${page.id}`);
      }
    }
    finished();
  }

  function cancelAi() {
    if (aiRun) api.aiCancel(aiRun.runId);
  }

  async function preview() {
    commit();
    await flush();
    goto(`/visualizar?id=${page.id}${view === 'mobile' ? '&v=mobile' : ''}`);
  }

  // Só o erro aparece: salvar normalmente não precisa de texto ocupando a barra.
  let statusText = $derived(status === 'error' ? `Não foi salvo. ${errorText}` : '');
</script>

<svelte:window {onkeydown} {onpointermove} {onpointerup} />

<div class="editor">
  <header class="bar">
    <a class="btn icon-btn" href="/" aria-label="Voltar ao Início" data-tip="Voltar ao Início"><ArrowLeft size={16} aria-hidden="true" /></a>
    <label class="visually-hidden" for="pagina-titulo">Título da página</label>
    <input id="pagina-titulo" class="title" bind:value={title} oninput={scheduleSave} maxlength="200" />
    <span class="status mono" class:error={status === 'error'} aria-live="polite">{#if statusText}<span class="swap" in:textSwap>{statusText}</span>{/if}</span>
    {#if status === 'error'}<button class="btn" onclick={() => flush()}>Tentar de novo</button>{/if}
    <div class="spacer"></div>
    <div class="seg" use:slidingPill role="group" aria-label="Versão da página">
      <button aria-pressed={view === 'desktop'} onclick={() => switchView('desktop')} data-tip={`Desktop · ${root.width} px`}><Monitor size={14} aria-hidden="true" />Desktop</button>
      <button aria-pressed={view === 'mobile'} onclick={() => switchView('mobile')} data-tip={root.mobile ? `Mobile · ${root.mobile.width} px` : 'Cria a versão mobile a partir da desktop'}><Smartphone size={14} aria-hidden="true" />Mobile</button>
    </div>
    {#if view === 'mobile'}
      <button class="btn icon-btn" onclick={removeMobile} aria-label="Remover a versão mobile" data-tip="Remover a versão mobile (Ctrl Z desfaz)"><Trash2 size={14} aria-hidden="true" /></button>
    {/if}
    <button class="btn icon-btn" onclick={undo} disabled={!canUndo} aria-label="Desfazer (Ctrl Z)" data-tip="Desfazer (Ctrl Z)"><Undo2 size={16} aria-hidden="true" /></button>
    <button class="btn icon-btn" onclick={redo} disabled={!canRedo} aria-label="Refazer (Ctrl Y)" data-tip="Refazer (Ctrl Y)"><Redo2 size={16} aria-hidden="true" /></button>
    <div class="zoom">
      <button class="btn icon-btn" onclick={() => setZoom(zoom / 1.2)} aria-label="Diminuir zoom"><Minus size={14} aria-hidden="true" /></button>
      <button class="btn pct mono" onclick={fit} data-tip="Ajustar à janela">{Math.round(zoom * 100)}%</button>
      <button class="btn icon-btn" onclick={() => setZoom(zoom * 1.2)} aria-label="Aumentar zoom"><Plus size={14} aria-hidden="true" /></button>
    </div>
    <button class="btn" onclick={preview}><Eye size={15} aria-hidden="true" />Visualizar</button>
  </header>

  <div class="body" style={`grid-template-columns:${panels.left ? '0' : '240px'} minmax(0, 1fr) ${panels.right ? '0' : '340px'}`}>
    <!-- Os painéis continuam montados quando minimizados (guardam aba, rascunho e conversa); só somem da grade. -->
    <div class="slot left" class:gone={panels.left}>
      <Panel bind:doc={() => doc, () => {}} {selectedId} pageId={page.id} {projectId} select={(id) => (selectedId = id)} {commit} {insert} {dropAt} onminimize={() => setPanel('left', true)} />
    </div>

    <div class="stage-wrap">
    <div class="stage" bind:this={stage} use:wheel onpointerdown={() => { selectedId = null; editingId = null; }} role="presentation">
      <!-- Trocar Desktop ↔ Mobile recria a página, e a nova entra suavemente (a que sai some na hora). -->
      {#key view}
      <div class="sizer" in:frameIn style={`width:${doc.width * zoom}px;height:${doc.height * zoom}px`}>
        <div
          class="page"
          bind:this={pageEl}
          style={`width:${doc.width}px;height:${doc.height}px;background:${doc.background};transform:scale(${zoom});--z:${zoom}`}
          oncontextmenu={(e) => openBubble(e, null)}
          role="presentation"
        >
          {#each doc.elements as el (el.id)}
            {#if !el.hidden}
              <div
                class="el"
                data-id={el.id}
                class:editing={el.id === editingId}
                class:ai-target={aiRun?.markedId === el.id}
                class:ai-enter={aiEntering.has(el.id)}
                style={elementStyle(el)}
                onpointerdown={(e) => startDrag(e, el, null)}
                ondblclick={() => startEdit(el)}
                oncontextmenu={(e) => openBubble(e, el)}
                role="button"
                tabindex="-1"
                aria-label={el.name}
              >
                {#if el.type === 'imagem'}
                  {@const src = fileSrc(el.fileId)}
                  {#if src}
                    <img {src} alt="" draggable="false" style={`object-fit:${el.fit ?? 'cover'}`} />
                  {:else}
                    <span class="placeholder">Arraste uma imagem do painel Inserir para cá</span>
                  {/if}
                {:else if el.type === 'referencia' && el.ref}
                  {@const r = refInfo(el.ref)}
                  <strong>{r.title}</strong>
                  <span class="sub">{r.subtitle}</span>
                {:else if el.id === editingId}
                  <div
                    class="edit"
                    contenteditable="plaintext-only"
                    use:focusEdit
                    onblur={(e) => endEdit(el, e.currentTarget)}
                    onkeydown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
                    role="textbox"
                    tabindex="0"
                    aria-multiline="true"
                  >{el.text ?? ''}</div>
                {:else}
                  {el.text ?? ''}
                {/if}
              </div>
            {/if}
          {/each}

          {#if selected && !selected.hidden && selected.id !== editingId}
            <div
              class="selbox"
              style={`left:${selected.x}px;top:${selected.y}px;width:${selected.w}px;height:${selected.h}px;--z:${zoom}`}
            >
              {#each HANDLES as h (h)}
                <span
                  class={`handle ${h}`}
                  onpointerdown={(e) => startDrag(e, selected!, h)}
                  role="presentation"
                ></span>
              {/each}
              <span class="size mono">{selected.w} × {selected.h}</span>
            </div>
          {/if}

          {#if guides.x !== null}<div class="guide v" style={`left:${guides.x}px;--z:${zoom}`}></div>{/if}
          {#if guides.y !== null}<div class="guide h" style={`top:${guides.y}px;--z:${zoom}`}></div>{/if}
        </div>
        {#if selected && !selected.hidden && !moving}
          <SelectionBar el={selected} {zoom} {commit} {duplicate} remove={removeSelected} />
        {/if}
      </div>
      {/key}
    </div>
    {#if panels.left}
      <button class="restore left" onclick={() => setPanel('left', false)} data-tip="Mostrar o painel">
        <PanelLeftOpen size={15} aria-hidden="true" />Camadas
      </button>
    {/if}
    {#if panels.right}
      <button class="restore right" onclick={() => setPanel('right', false)} data-tip="Mostrar Linke">
        {#if aiRun}<span class="mini-pixels" aria-hidden="true">{#each [0, 1, 2, 3] as i (i)}<span style={`animation-delay:${i * 120}ms`}></span>{/each}</span>{/if}
        <Linke size={15} />Linke
        <PanelRightOpen size={15} aria-hidden="true" />
      </button>
    {/if}
    </div>

    {#if bubble}
      <PromptBubble
        x={bubble.x}
        y={bubble.y}
        label={bubble.label}
        onsend={(t) => askAi(t, bubble!.markedId, bubble!.point)}
        onclose={() => (bubble = null)}
      />
    {/if}

    <div class="slot right" class:gone={panels.right}>
      <ClaudePanel log={aiLog} running={aiRun !== null} startedAt={aiStartedAt} {projectId} onsend={(t) => askAi(t)} oncancel={cancelAi} onminimize={() => setPanel('right', true)} />
    </div>
  </div>

</div>

<style>
  .editor {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s2) var(--s3);
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }

  .icon-btn {
    width: 32px;
    padding: 0;
    justify-content: center;
  }

  .title {
    min-width: 0;
    width: 280px;
    height: 32px;
    padding: 0 var(--s2);
    border: 1px solid transparent;
    border-radius: var(--r-md);
    background: transparent;
    font: 600 15px var(--font-ui);
  }

  .title:hover {
    border-color: var(--line);
  }

  .title:focus {
    outline: none;
    border-color: var(--accent);
  }

  .status {
    color: var(--muted);
    white-space: nowrap;
  }

  .swap {
    display: inline-block;
  }

  .status.error {
    color: var(--fg);
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  .zoom {
    display: flex;
    gap: 2px;
  }

  .pct {
    min-width: 56px;
    justify-content: center;
    font-size: 12px;
  }

  .body {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) 340px;
    min-height: 0;
  }

  /* Painéis em "display: contents": o painel é a célula da grade; minimizado, sai dela. */
  .slot {
    display: contents;
  }

  .slot.gone {
    display: none;
  }

  .slot.left > :global(*) {
    grid-column: 1;
  }

  .slot.right > :global(*) {
    grid-column: 3;
  }

  /* Painel minimizado: um botão pequeno no canto do canvas devolve o painel. */
  .restore {
    position: absolute;
    bottom: 16px;
    z-index: 8;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: #141414;
    color: var(--fg);
    font: 500 13px var(--font-ui);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
    cursor: pointer;
    transition:
      border-color 150ms,
      transform 100ms ease-out;
  }

  .restore:hover {
    border-color: #4a4a4a;
  }

  .restore:active {
    transform: scale(0.97);
  }

  .restore.left {
    left: 16px;
  }

  .restore.right {
    right: 16px;
  }

  /* Claude trabalhando com o painel fechado: a mesma grade de pixels, em linha. */
  .mini-pixels {
    display: inline-flex;
    gap: 2px;
  }

  .mini-pixels span {
    width: 4px;
    height: 4px;
    border-radius: 1px;
    background: var(--fg);
    opacity: 0.2;
    animation: mini-pixel 650ms ease-in-out infinite;
  }

  @keyframes mini-pixel {
    50% {
      opacity: 1;
    }
  }

  .stage-wrap {
    grid-column: 2;
    position: relative;
    min-width: 0;
    min-height: 0;
    display: grid;
  }

  /*
   * A página do usuário pode ter qualquer fundo. Seleção e marcações usam um anel duplo
   * (branco por dentro, preto por fora) para aparecer tanto no branco quanto no preto.
   */
  .el.ai-target {
    outline: calc(2px / var(--z, 1)) solid #fff;
    box-shadow: 0 0 0 calc(4px / var(--z, 1)) #000;
    animation: ai-pulse 1.2s ease-in-out infinite;
  }

  @keyframes ai-pulse {
    50% {
      outline-color: transparent;
      box-shadow: 0 0 0 calc(4px / var(--z, 1)) transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .el.ai-target {
      animation: none;
    }
  }

  .stage {
    overflow: auto;
    padding: 48px;
    background: var(--bg);
    background-image: radial-gradient(var(--card) 1px, transparent 1px);
    background-size: 20px 20px;
  }

  .sizer {
    position: relative;
    margin: 0 auto;
  }

  .page {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    box-shadow: 0 8px 40px rgb(0 0 0 / 0.35);
    overflow: hidden;
  }

  /* Elemento criado pela IA: aparece crescendo de 97% (200 ms), só quando nasce. */
  .el.ai-enter {
    animation: ai-enter 200ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes ai-enter {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }

  .el {
    position: absolute;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    cursor: default;
    user-select: none;
  }

  .el:hover {
    outline: calc(1px / var(--z, 1)) solid rgb(255 255 255 / 0.7);
    box-shadow: 0 0 0 calc(2px / var(--z, 1)) rgb(0 0 0 / 0.5);
  }

  .el.editing {
    user-select: text;
    cursor: text;
    outline: calc(1.5px / var(--z, 1)) dashed #fff;
    box-shadow: 0 0 0 calc(3px / var(--z, 1)) #000;
  }

  .el img {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .el strong {
    display: block;
    font-weight: 600;
    margin-bottom: 6px;
  }

  .sub {
    opacity: 0.7;
    font-size: 0.85em;
  }

  .placeholder {
    display: grid;
    place-items: center;
    height: 100%;
    background: var(--sheet);
    color: var(--muted);
    font: 500 14px var(--font-ui);
    text-align: center;
    padding: 12px;
  }

  .edit {
    outline: none;
    min-height: 100%;
  }

  .selbox {
    position: absolute;
    pointer-events: none;
    outline: calc(1.5px / var(--z)) solid #fff;
    box-shadow: 0 0 0 calc(3px / var(--z)) #000;
  }

  .handle {
    position: absolute;
    width: calc(10px / var(--z));
    height: calc(10px / var(--z));
    background: #fff;
    border: calc(1.5px / var(--z)) solid #000;
    pointer-events: auto;
    transform: translate(-50%, -50%);
  }

  /* Área de toque maior que o quadradinho visível, para pegar a alça sem precisão de pixel. */
  .handle::after {
    content: '';
    position: absolute;
    inset: calc(-6px / var(--z));
  }

  .handle.nw { left: 0; top: 0; cursor: nwse-resize; }
  .handle.n { left: 50%; top: 0; cursor: ns-resize; }
  .handle.ne { left: 100%; top: 0; cursor: nesw-resize; }
  .handle.e { left: 100%; top: 50%; cursor: ew-resize; }
  .handle.se { left: 100%; top: 100%; cursor: nwse-resize; }
  .handle.s { left: 50%; top: 100%; cursor: ns-resize; }
  .handle.sw { left: 0; top: 100%; cursor: nesw-resize; }
  .handle.w { left: 0; top: 50%; cursor: ew-resize; }

  .size {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translate(-50%, calc(8px / var(--z))) scale(calc(1 / var(--z)));
    transform-origin: top center;
    padding: 1px 6px;
    border-radius: 4px;
    background: #000;
    color: #fff;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.6);
    font-size: 11px;
    white-space: nowrap;
  }

  /* Diferença: a guia inverte o que está atrás e aparece sobre qualquer cor. */
  .guide {
    position: absolute;
    pointer-events: none;
    background: var(--guide);
    mix-blend-mode: difference;
  }

  .guide.v {
    top: 0;
    bottom: 0;
    width: calc(1px / var(--z));
  }

  .guide.h {
    left: 0;
    right: 0;
    height: calc(1px / var(--z));
  }


</style>
