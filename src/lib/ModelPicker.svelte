<script lang="ts">
  /**
   * Escolha do modelo do Claude. Abre a lista para cima do botão (no estilo do app do Claude):
   * o escolhido tem a marca, o padrão tem a etiqueta, e os que a assinatura não cobre vêm com cadeado.
   */
  import { onMount } from 'svelte';
  import { ChevronDown, Lock } from '@lucide/svelte';
  import { AI_MODELS, getAiModel, setAiModel } from '$lib/editor/assistant';
  import { api, type AiProvider } from '$lib/api';
  import { t } from '$lib/i18n.svelte';
  import { openMenuAbove, type MenuItem } from '$lib/menu.svelte';

  let { id: domId }: { id?: string } = $props();
  let current = $state(getAiModel());
  // Provedores compatíveis com a OpenAI cadastrados nas Configurações, depois dos modelos do Claude.
  let providers = $state<(AiProvider & { hasKey: boolean })[]>([]);
  const loadProviders = () =>
    api
      .aiConfig()
      .then((c) => (providers = c.providers))
      .catch(() => {});
  onMount(loadProviders);
  let name = $derived(
    AI_MODELS.find((m) => m.id === current)?.name ?? providers.find((p) => `p:${p.id}` === current)?.name ?? t('Modelo'),
  );
  let button: HTMLButtonElement | undefined = $state();

  function choose(id: string) {
    current = id;
    setAiModel(id);
  }

  async function open() {
    if (!button) return;
    await loadProviders();
    const extra: MenuItem[] = providers.map((p) =>
      p.hasKey
        ? { label: p.name, note: p.model, checked: `p:${p.id}` === current, run: () => choose(`p:${p.id}`) }
        : { label: p.name, icon: Lock, disabled: true, note: t('Sem chave guardada'), run: () => {} },
    );
    const items: MenuItem[] = AI_MODELS.map((m) =>
      m.locked
        ? { label: m.name, icon: Lock, disabled: true, note: t(m.locked), run: () => {} }
        : {
            label: m.name,
            badge: m.isDefault ? t('Padrão') : undefined,
            checked: m.id === current,
            run: () => choose(m.id),
          },
    );
    openMenuAbove(button, extra.length ? [...items, { separator: true }, ...extra] : items);
  }
</script>

<button id={domId} class="picker" bind:this={button} onclick={open} aria-haspopup="menu" aria-label={t('Modelo: {name}', { name })}>
  {name}
  <ChevronDown size={13} aria-hidden="true" />
</button>

<style>
  .picker {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    font: 500 12px var(--font-ui);
    cursor: pointer;
    transition:
      background-color 150ms,
      color 150ms;
  }

  .picker:hover {
    background: color-mix(in srgb, var(--fg) 14.9%, var(--bg));
    color: var(--fg);
  }
</style>
