<script lang="ts">
  // Desenho adaptado do "Prompt Bar" e do "Loading State" do Beautiful UI (beautifului.dev, licença MIT).
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Plus, ArrowUp } from '@lucide/svelte';
  import { api, message } from '$lib/api';
  import { store, reload, addFiles, projectName } from '$lib/store.svelte';
  import { setPending } from '$lib/agent.svelte';
  import ModelPicker from '$lib/ModelPicker.svelte';
  import { emptyDoc } from '$lib/editor/doc';

  let text = $state('');
  let busy = $state(false);
  let input: HTMLTextAreaElement | undefined = $state();

  // Pasta aberta (tela de Pastas ou página do Editor que pertence a uma pasta).
  let folderId = $derived.by(() => {
    if (page.url.pathname.startsWith('/projetos')) return Number(page.url.searchParams.get('id')) || null;
    if (page.url.pathname.startsWith('/editor')) {
      const id = Number(page.url.searchParams.get('id'));
      return store.pages.find((p) => p.id === id)?.project_id ?? null;
    }
    return null;
  });
  let context = $derived(folderId ? `Nova página em ${projectName(folderId) ?? 'pasta'}` : 'Nova página');

  // Cresce com o texto até 6 linhas.
  $effect(() => {
    void text;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 6 * 20 + 10)}px`;
  });

  function titleFrom(t: string): string {
    const s = t.replace(/\s+/g, ' ').trim();
    const cut = s.length > 60 ? `${s.slice(0, 57).trimEnd()}…` : s;
    return cut.charAt(0).toUpperCase() + cut.slice(1);
  }

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    // O pedido vira uma página nova, e o Claude do Editor roda o pedido ao abrir.
    busy = true;
    try {
      const p = await api.createPage(titleFrom(t), folderId, JSON.stringify(emptyDoc()));
      await reload();
      setPending(t);
      text = '';
      goto(`/editor?id=${p.id}`);
    } catch (e) {
      store.error = `Não foi possível criar a página. ${message(e)}`;
    } finally {
      busy = false;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<div class="bar" role="group" aria-label="Agente">
  <label class="visually-hidden" for="agente-pedido">Pedido para o agente</label>
  <textarea
    id="agente-pedido"
    bind:this={input}
    rows="1"
    placeholder="O que você quer criar?"
    bind:value={text}
    {onkeydown}
    disabled={busy}
  ></textarea>

  <div class="row">
    <button class="ico" onclick={() => addFiles({ projectId: folderId })} aria-label="Importar arquivos" data-tip="Importar arquivos">
      <Plus size={16} aria-hidden="true" />
    </button>
    <span class="chip">{context}</span>
    <span class="spacer"></span>
    <ModelPicker id="agente-modelo" />
    <button class="send" onclick={send} disabled={!text.trim() || busy} aria-label="Enviar" data-tip="Enviar (Enter)">
      <ArrowUp size={16} aria-hidden="true" />
    </button>
  </div>
</div>

<style>
  .bar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: min(680px, calc(100% - 32px));
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: #141414;
    box-shadow:
      0 0 0 1px rgb(255 255 255 / 0.04),
      0 1px 2px rgb(0 0 0 / 0.4),
      0 12px 32px rgb(0 0 0 / 0.55);
    transition: border-color 150ms ease-out;
  }

  .bar:focus-within {
    border-color: #4a4a4a;
  }

  textarea {
    display: block;
    width: 100%;
    min-height: 30px;
    padding: 5px 8px;
    border: 0;
    resize: none;
    background: transparent;
    font: 400 14px/20px var(--font-text);
    outline: none;
    overflow-wrap: anywhere;
  }

  textarea::placeholder {
    color: var(--muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .spacer {
    flex: 1;
  }

  .ico,
  .send {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition:
      background-color 150ms ease-out,
      color 150ms ease-out,
      transform 150ms ease-out;
  }

  .ico:hover {
    background: #262626;
    color: var(--fg);
  }

  .ico:active,
  .send:not(:disabled):active {
    transform: scale(0.94);
  }

  .send {
    background: var(--fg);
    color: var(--bg);
  }

  .send:disabled {
    background: #2a2a2a;
    color: var(--muted);
    cursor: default;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    max-width: 260px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font: 500 12px var(--font-ui);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }





</style>
