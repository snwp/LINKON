<script lang="ts">
  import { flip } from 'svelte/animate';
  import { slidingPill, FLIP } from '$lib/motion';
  import { Eye, EyeOff, Type, Square, PanelTop, Link2, Image, StickyNote, Upload, PanelLeftClose, ImagePlus, Box } from '@lucide/svelte';
  import { store, addFiles, reload, notify } from '$lib/store.svelte';
  import { api, message, type ImageRequest } from '$lib/api';
  import { SHAPES, getImagePrefs } from '$lib/imagegen';
  import { TYPE_LABELS, ANIM_IN, ANIM_HOVER, ANIM_LOOP, SHAPES_3D, MATERIALS_3D, LIGHTS_3D, DEFAULT_SCENE, cleanAnim, cleanScene, type Doc, type ElementType, type El, type Anim, type Scene3D } from './doc';
  import { t } from '$lib/i18n.svelte';

  type Props = {
    doc: Doc;
    selectedId: string | null;
    pageId: number;
    projectId: number | null;
    select: (id: string | null) => void;
    commit: () => void;
    insert: (type: ElementType, extra?: Partial<El>) => void;
    /** Solta no canvas o que foi arrastado do painel (posição na tela). */
    dropAt: (type: ElementType, extra: Partial<El>, cx: number, cy: number) => void;
    onminimize: () => void;
  };
  let { doc = $bindable(), selectedId, pageId, projectId, select, commit, insert, dropAt, onminimize }: Props = $props();

  /**
   * Arrastar do painel para o canvas com eventos de ponteiro (o arrastar nativo do HTML fica desligado
   * no app do Windows, porque o Tauri usa o arrastar do sistema para receber arquivos).
   * Clicar sem mover insere como antes; mover mais de 5 px mostra uma prévia que segue o mouse.
   */
  type Grab = { type: ElementType; extra: Partial<El>; label: string; src?: string };
  let ghost = $state<(Grab & { x: number; y: number }) | null>(null);

  function grab(e: PointerEvent, g: Grab) {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      moved = true;
      ghost = { ...g, x: ev.clientX, y: ev.clientY };
    };
    const end = (ev: PointerEvent, drop: boolean) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      ghost = null;
      if (!drop) return;
      if (moved) dropAt(g.type, g.extra, ev.clientX, ev.clientY);
      else insert(g.type, g.extra);
    };
    const up = (ev: PointerEvent) => end(ev, true);
    const cancel = (ev: PointerEvent) => end(ev, false);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
  }

  let tab = $state<'camadas' | 'inserir' | 'paginas'>('camadas');

  const ICON: Record<ElementType, typeof Type> = { texto: Type, bloco: Square, secao: PanelTop, link: Link2, imagem: Image, referencia: StickyNote, objeto3d: Box };
  const BASIC: ElementType[] = ['texto', 'bloco', 'secao', 'link', 'objeto3d'];

  // Nomes em português de cada valor aceito (passam por t() ao mostrar).
  const L_IN: Record<(typeof ANIM_IN)[number], string> = { fade: 'Surgir', up: 'Subir', down: 'Descer', left: 'Da esquerda', right: 'Da direita', zoom: 'Aproximar', blur: 'Desfocar' };
  const L_HOVER: Record<(typeof ANIM_HOVER)[number], string> = { lift: 'Elevar', grow: 'Crescer', tilt: 'Inclinar', dim: 'Escurecer' };
  const L_LOOP: Record<(typeof ANIM_LOOP)[number], string> = { float: 'Flutuar', pulse: 'Pulsar', spin: 'Girar', sway: 'Balançar' };
  const L_SHAPE: Record<(typeof SHAPES_3D)[number], string> = { cubo: 'Cubo', esfera: 'Esfera', toro: 'Toro', no: 'Nó', cone: 'Cone', icosaedro: 'Icosaedro', capsula: 'Cápsula', cartoes: 'Cartões' };
  const L_MATERIAL: Record<(typeof MATERIALS_3D)[number], string> = { fosco: 'Fosco', metal: 'Metal', vidro: 'Vidro', brilho: 'Brilho', arame: 'Arame' };
  const L_LIGHT: Record<(typeof LIGHTS_3D)[number], string> = { suave: 'Suave', estudio: 'Estúdio', contraste: 'Contraste' };

  let sel = $derived(doc.elements.find((e) => e.id === selectedId && !e.hidden) ?? null);
  let anim = $derived<Anim>(sel?.anim ?? {});
  let scene = $derived<Scene3D>(sel?.scene ?? DEFAULT_SCENE);

  /** Mescla o que mudou e passa por cleanAnim; vazio remove a animação. */
  function setAnim(patch: Partial<Record<keyof Anim, unknown>>) {
    if (!sel) return;
    const next = cleanAnim({ ...sel.anim, ...patch });
    if (next) sel.anim = next;
    else delete sel.anim;
    commit();
  }

  function setScene(patch: Partial<Record<keyof Scene3D, unknown>>) {
    if (!sel || sel.type !== 'objeto3d') return;
    sel.scene = cleanScene(patch, sel.scene ?? DEFAULT_SCENE);
    commit();
  }

  const val = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  /** Campo numérico vazio não muda nada (cleanAnim/cleanScene ignoram o que não é número). */
  const numOf = (e: Event) => (val(e) === '' ? undefined : Number(val(e)));

  // Camadas: o elemento de cima aparece primeiro.
  let layers = $derived(doc.elements.map((e, i) => ({ e, i })).reverse());
  // Com pasta, mostra só as imagens dela; sem pasta, todas.
  let images = $derived(store.files.filter((f) => f.kind === 'imagem' && (!projectId || f.project_ids.includes(projectId))));

  /** Teclado: Alt + seta move a camada um passo (seta para cima = mais para a frente). */
  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= doc.elements.length) return;
    const [e] = doc.elements.splice(i, 1);
    doc.elements.splice(j, 0, e);
    commit();
  }

  /**
   * Reordenar arrastando a linha da camada. `from` e `slot` contam na ordem da lista (de cima para baixo);
   * `slot` é o vão onde a camada vai cair (0 = antes da primeira, n = depois da última).
   */
  let layerDrag = $state<{ from: number; slot: number } | null>(null);

  function grabLayer(e: PointerEvent, from: number) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.icon')) return;
    const list = (e.currentTarget as HTMLElement).closest('ul')!;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - sy) < 4) return;
      moved = true;
      const rows = [...list.querySelectorAll<HTMLElement>(':scope > li')];
      let slot = rows.length;
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          slot = k;
          break;
        }
      }
      layerDrag = { from, slot };
    };
    const end = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      const d = layerDrag;
      layerDrag = null;
      if (!moved || !d || ev.type === 'pointercancel') return;
      const shown = [...doc.elements].reverse();
      const [item] = shown.splice(d.from, 1);
      const to = d.slot > d.from ? d.slot - 1 : d.slot;
      if (to === d.from) return;
      shown.splice(to, 0, item);
      doc.elements = shown.reverse();
      commit();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }

  // ---------- gerar imagem ----------
  let genPrompt = $state('');
  let genShape = $state<ImageRequest['shape']>('wide');
  let genStarted = $state(0);
  let genNow = $state(0);
  let genError = $state('');
  let alive = true;
  $effect(() => () => (alive = false));

  $effect(() => {
    if (!genStarted) return;
    const timer = setInterval(() => (genNow = Date.now()), 500);
    return () => clearInterval(timer);
  });

  async function generate() {
    const prompt = genPrompt.trim();
    if (!prompt || genStarted) return;
    const shape = SHAPES.find((s) => s.id === genShape)!;
    const prefs = getImagePrefs();
    genError = '';
    genStarted = genNow = Date.now();
    try {
      const file = await api.generateImage({ prompt, shape: shape.id, provider: prefs.provider, model: prefs.model, projectId });
      await reload();
      // A imagem já está guardada na pasta; só entra na página se o editor ainda estiver aberto.
      if (alive) insert('imagem', { fileId: file.id, name: file.name, w: shape.w, h: shape.h });
      genPrompt = '';
      notify(t('Imagem gerada.'));
    } catch (e) {
      const m = message(e);
      if (m !== 'cancelado') genError = m;
    } finally {
      genStarted = 0;
    }
  }

  function toggle(e: El) {
    e.hidden = !e.hidden;
    if (e.hidden && e.id === selectedId) select(null);
    commit();
  }
</script>

<aside class="panel" aria-label={t('Painel do editor')}>
  <div class="head">
    <div class="tabs" use:slidingPill role="tablist">
      <button role="tab" aria-selected={tab === 'camadas'} onclick={() => (tab = 'camadas')}>{t('Camadas')}</button>
      <button role="tab" aria-selected={tab === 'inserir'} onclick={() => (tab = 'inserir')}>{t('Inserir')}</button>
      <button role="tab" aria-selected={tab === 'paginas'} onclick={() => (tab = 'paginas')}>{t('Páginas')}</button>
    </div>
    <button class="min" onclick={onminimize} aria-label={t('Minimizar o painel')} data-tip={t('Minimizar')}><PanelLeftClose size={15} aria-hidden="true" /></button>
  </div>

  {#if tab === 'camadas'}
    {#if layers.length === 0}
      <p class="hint">{t('Página vazia.')}</p>
    {:else}
      <ul class="layers">
        {#each layers as { e, i }, row (e.id)}
          {@const Icon = ICON[e.type]}
          <li
            class="layer"
            class:sel={e.id === selectedId}
            class:hidden={e.hidden}
            class:dragging={layerDrag?.from === row}
            class:drop-before={layerDrag !== null && layerDrag.slot === row}
            class:drop-after={layerDrag !== null && row === layers.length - 1 && layerDrag.slot === layers.length}
            onpointerdown={(ev) => grabLayer(ev, row)}
            animate:flip={FLIP}
          >
            <button
              class="pick"
              onclick={() => select(e.id)}
              onkeydown={(ev) => {
                if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
                ev.preventDefault();
                move(i, ev.key === 'ArrowUp' ? 1 : -1);
              }}
            >
              <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
              <span>{e.name}</span>
            </button>
            <button class="icon" aria-label={e.hidden ? t('Mostrar {name}', { name: e.name }) : t('Esconder {name}', { name: e.name })} onclick={() => toggle(e)}>
              {#if e.hidden}<EyeOff size={13} aria-hidden="true" />{:else}<Eye size={13} aria-hidden="true" />{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if sel}
      <section aria-labelledby="anim-titulo">
        <h3 id="anim-titulo">{t('Animação')}</h3>
        <label class="row">
          <span>{t('Ao aparecer')}</span>
          <select class="field" value={anim.in ?? ''} onchange={(e) => setAnim({ in: val(e) })}>
            <option value="">{t('Nenhuma')}</option>
            {#each ANIM_IN as v (v)}<option value={v}>{t(L_IN[v])}</option>{/each}
          </select>
        </label>
        {#if anim.in}
          <label class="row">
            <span>{t('Atraso (s)')}</span>
            <input class="field" type="number" min="0" max="3" step="0.1" value={anim.delay ?? 0} onchange={(e) => setAnim({ delay: numOf(e) })} />
          </label>
          <label class="row">
            <span>{t('Duração (s)')}</span>
            <input class="field" type="number" min="0.2" max="3" step="0.1" value={anim.duration ?? 0.6} onchange={(e) => setAnim({ duration: numOf(e) })} />
          </label>
        {/if}
        <label class="row">
          <span>{t('Ao passar o mouse')}</span>
          <select class="field" value={anim.hover ?? ''} onchange={(e) => setAnim({ hover: val(e) })}>
            <option value="">{t('Nenhuma')}</option>
            {#each ANIM_HOVER as v (v)}<option value={v}>{t(L_HOVER[v])}</option>{/each}
          </select>
        </label>
        <label class="row">
          <span>{t('Repetir')}</span>
          <select class="field" value={anim.loop ?? ''} onchange={(e) => setAnim({ loop: val(e) })}>
            <option value="">{t('Nenhuma')}</option>
            {#each ANIM_LOOP as v (v)}<option value={v}>{t(L_LOOP[v])}</option>{/each}
          </select>
        </label>
        {#if anim.loop}
          <label class="row">
            <span>{t('Volta (s)')}</span>
            <input class="field" type="number" min="1" max="30" step="0.5" value={anim.loopDuration ?? 4} onchange={(e) => setAnim({ loopDuration: numOf(e) })} />
          </label>
        {/if}
        <label class="row">
          <span>{t('Profundidade na rolagem')}</span>
          <input class="field" type="number" min="-1" max="1" step="0.1" value={anim.parallax ?? 0} onchange={(e) => setAnim({ parallax: numOf(e) ?? 0 })} />
        </label>
      </section>

      {#if sel.type === 'objeto3d'}
        <section aria-labelledby="cena-titulo">
          <h3 id="cena-titulo">{t('Objeto 3D')}</h3>
          <label class="row">
            <span>{t('Forma')}</span>
            <select class="field" value={scene.shape} onchange={(e) => setScene({ shape: val(e) })}>
              {#each SHAPES_3D as v (v)}<option value={v}>{t(L_SHAPE[v])}</option>{/each}
            </select>
          </label>
          <label class="row">
            <span>{t('Material')}</span>
            <select class="field" value={scene.material} onchange={(e) => setScene({ material: val(e) })}>
              {#each MATERIALS_3D as v (v)}<option value={v}>{t(L_MATERIAL[v])}</option>{/each}
            </select>
          </label>
          <label class="row">
            <span>{t('Cor')}</span>
            <input class="color" type="color" value={scene.color} onchange={(e) => setScene({ color: val(e) })} />
          </label>
          <label class="row">
            <span>{t('Segunda cor')}</span>
            <input class="color" type="color" value={scene.color2} onchange={(e) => setScene({ color2: val(e) })} />
          </label>
          <label class="row">
            <span>{t('Luz')}</span>
            <select class="field" value={scene.light} onchange={(e) => setScene({ light: val(e) })}>
              {#each LIGHTS_3D as v (v)}<option value={v}>{t(L_LIGHT[v])}</option>{/each}
            </select>
          </label>
          <div class="row stack">
            <span>{t('Rotação')}</span>
            <div class="trio">
              <input class="field" type="number" min="-360" max="360" aria-label={t('Rotação X')} value={scene.rotX} onchange={(e) => setScene({ rotX: numOf(e) })} />
              <input class="field" type="number" min="-360" max="360" aria-label={t('Rotação Y')} value={scene.rotY} onchange={(e) => setScene({ rotY: numOf(e) })} />
              <input class="field" type="number" min="-360" max="360" aria-label={t('Rotação Z')} value={scene.rotZ} onchange={(e) => setScene({ rotZ: numOf(e) })} />
            </div>
          </div>
          <label class="row">
            <span>{t('Giro (graus por segundo)')}</span>
            <input class="field" type="number" min="-180" max="180" step="5" value={scene.spin} onchange={(e) => setScene({ spin: numOf(e) })} />
          </label>
          <label class="row">
            <span>{t('Aproximação')}</span>
            <input class="field" type="number" min="0.5" max="2" step="0.1" value={scene.zoom} onchange={(e) => setScene({ zoom: numOf(e) })} />
          </label>
          <label class="check">
            <input type="checkbox" checked={scene.float} onchange={(e) => setScene({ float: e.currentTarget.checked })} />
            <span>{t('Flutuar')}</span>
          </label>
          <label class="check">
            <input type="checkbox" checked={scene.pointer} onchange={(e) => setScene({ pointer: e.currentTarget.checked })} />
            <span>{t('Seguir o ponteiro')}</span>
          </label>
        </section>
      {/if}
    {/if}
  {:else if tab === 'inserir'}
    <section>
      <h3>{t('Elementos')}</h3>
      <div class="basic">
        {#each BASIC as ty (ty)}
          {@const Icon = ICON[ty]}
          <button
            class="add"
            onpointerdown={(e) => grab(e, { type: ty, extra: {}, label: t(TYPE_LABELS[ty]) })}
            onclick={(e) => e.detail === 0 && insert(ty)}
          >
            <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
            {t(TYPE_LABELS[ty])}
          </button>
        {/each}
      </div>
    </section>

    <section aria-labelledby="gerar-titulo">
      <h3 id="gerar-titulo">{t('Gerar imagem')}</h3>
      <label class="visually-hidden" for="gerar-descricao">{t('Descrição da imagem')}</label>
      <textarea
        id="gerar-descricao"
        class="field gen-text"
        rows="3"
        maxlength="4000"
        placeholder={t('Descreva a imagem')}
        bind:value={genPrompt}
        disabled={!!genStarted}
        onkeydown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            generate();
          }
        }}
      ></textarea>
      <div class="seg gen-shape" use:slidingPill role="group" aria-label={t('Formato')}>
        {#each SHAPES as s (s.id)}
          <button aria-pressed={genShape === s.id} onclick={() => (genShape = s.id)} disabled={!!genStarted}>{t(s.label)}</button>
        {/each}
      </div>
      {#if genStarted}
        <div class="gen-run" role="status">
          <span class="breathe">{t('Gerando')}</span>
          <span class="mono gen-time">{Math.max(0, Math.round((genNow - genStarted) / 1000))}s</span>
          <button class="btn small-btn" onclick={() => api.cancelImage()}>{t('Parar')}</button>
        </div>
      {:else}
        <button class="btn primary small-btn" onclick={generate} disabled={!genPrompt.trim()}>
          <ImagePlus size={13} aria-hidden="true" />{t('Gerar')}
        </button>
      {/if}
      {#if genError}<p class="error-text gen-error">{genError}</p>{/if}
    </section>

    <section>
      <div class="sec-head">
        <h3>{projectId ? t('Imagens da pasta') : t('Imagens')}</h3>
        <button class="btn small-btn" onclick={() => addFiles({ projectId })}><Upload size={13} aria-hidden="true" />{t('Importar')}</button>
      </div>
      {#if images.length === 0}
        <p class="hint">{t('Nenhuma imagem ainda.')}</p>
      {:else}
        <div class="thumbs">
          {#each images as f (f.id)}
            <button
              class="thumb"
              data-tip={f.name}
              onpointerdown={(e) => grab(e, { type: 'imagem', extra: { fileId: f.id, name: f.name }, label: f.name, src: api.fileUrl(f) })}
              onclick={(e) => e.detail === 0 && insert('imagem', { fileId: f.id, name: f.name })}
            >
              <img src={api.fileUrl(f)} alt="" loading="lazy" />
            </button>
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    <ul class="pages">
      {#each store.pages as p (p.id)}
        <li><a href={`/editor?id=${p.id}`} aria-current={p.id === pageId ? 'page' : undefined}>{p.title}</a></li>
      {/each}
    </ul>
    <a class="all" href="/editor?novo=1">{t('Nova página')}</a>
  {/if}
</aside>

{#if ghost}
  <!-- Prévia do que está sendo arrastado; não recebe o ponteiro para não atrapalhar o soltar. -->
  <div class="ghost" style={`translate:${ghost.x + 12}px ${ghost.y + 12}px`} aria-hidden="true">
    {#if ghost.src}<img src={ghost.src} alt="" />{:else}{ghost.label}{/if}
  </div>
{/if}

<style>
  .ghost {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 200;
    padding: 6px 10px;
    border: 1px solid color-mix(in srgb, var(--fg) 29%, var(--bg));
    border-radius: 8px;
    background: color-mix(in srgb, var(--fg) 11%, var(--bg));
    color: var(--fg);
    font: 500 12px var(--font-ui);
    box-shadow: 0 10px 28px rgb(0 0 0 / 0.55);
    pointer-events: none;
    opacity: 0.92;
  }

  .ghost img {
    display: block;
    width: 72px;
    height: 72px;
    object-fit: cover;
    border-radius: 4px;
  }

  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
    background: var(--panel);
    border-right: 1px solid var(--line);
    font-size: 12px;
  }

  /* Mesmo trilho do controle segmentado, com a pílula deslizante (Transitions.dev — Tabs sliding). */
  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: var(--s2);
    background: var(--panel);
  }

  .min {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .min:hover {
    background: color-mix(in srgb, var(--fg) 12.2%, var(--bg));
    color: var(--fg);
  }

  .tabs {
    flex: 1;
    display: flex;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: color-mix(in srgb, var(--fg) 3.9%, var(--bg));
  }

  .tabs button {
    position: relative;
    z-index: 1;
    flex: 1;
    height: 26px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    font: 500 12px var(--font-ui);
    cursor: pointer;
    transition: color 250ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .tabs button[aria-selected='true'] {
    color: var(--fg);
  }

  .hint {
    margin: 0;
    padding: var(--s3);
    color: var(--muted);
  }

  .layers,
  .pages {
    list-style: none;
    margin: 0;
    padding: var(--s1);
  }

  .layer {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: var(--r-sm);
    touch-action: none;
  }

  .layer.dragging {
    opacity: 0.4;
  }

  /* Linha guia de onde a camada vai cair. */
  .layer.drop-before::before,
  .layer.drop-after::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    border-radius: 1px;
    background: var(--fg);
    pointer-events: none;
  }

  .layer.drop-before::before {
    top: -1px;
  }

  .layer.drop-after::after {
    bottom: -1px;
  }

  .layer:hover {
    background: var(--card);
  }

  .layer.sel {
    background: var(--card);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .layer.hidden .pick {
    opacity: 0.5;
  }

  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s2);
    height: 28px;
    padding: 0 var(--s2);
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .pick span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .icon:hover:not(:disabled) {
    color: var(--fg);
  }

  .icon:disabled {
    opacity: 0.3;
    cursor: default;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3);
    border-bottom: 1px solid var(--line);
  }

  h3 {
    margin: 0;
    font: 600 12px var(--font-ui);
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 96px;
    align-items: center;
    gap: var(--s2);
  }

  .row .field {
    height: 28px;
    padding: 0 var(--s2);
    font: 500 12px var(--font-ui);
  }

  .row input[type='number'] {
    font-family: var(--font-mono);
  }

  .row.stack {
    grid-template-columns: 1fr;
    gap: var(--s1);
  }

  .trio {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
  }

  .trio .field {
    padding: 0 4px;
  }

  .color {
    width: 100%;
    height: 28px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--s2);
    cursor: pointer;
  }

  .basic {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .add {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: var(--s3) var(--s2);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--card);
    font-size: 12px;
    cursor: pointer;
  }

  .add:hover {
    border-color: var(--muted);
  }

  .thumbs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .thumb {
    aspect-ratio: 1;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--bg);
    cursor: pointer;
  }

  .thumb:hover {
    border-color: var(--accent);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .small-btn {
    height: 26px;
    padding: 0 var(--s2);
    font-size: 12px;
  }

  .gen-text {
    height: auto;
    min-height: 64px;
    padding: var(--s2);
    resize: vertical;
    font: 400 12px/1.5 var(--font-text);
  }

  .gen-shape button {
    flex: 1;
  }

  .gen-run {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-height: 26px;
  }

  .gen-time {
    flex: 1;
    color: var(--muted);
    font-size: 11px;
  }

  .breathe {
    font-weight: 500;
    animation: breathe 1.4s ease-in-out infinite;
  }

  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }

  .gen-error {
    margin: 0;
    font-size: 12px;
  }

  .pages a {
    display: block;
    padding: 6px var(--s2);
    border-radius: var(--r-sm);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pages a:hover,
  .pages a[aria-current='page'] {
    background: var(--card);
  }

  .all {
    padding: var(--s2) var(--s3);
    color: var(--muted);
  }
</style>
