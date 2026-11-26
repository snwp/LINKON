<script lang="ts">
  /**
   * Escolha do modelo do Claude. Abre a lista para cima do botão (no estilo do app do Claude):
   * o escolhido tem a marca, o padrão tem a etiqueta, e os que a assinatura não cobre vêm com cadeado.
   */
  import { ChevronDown, Lock } from '@lucide/svelte';
  import { AI_MODELS, getAiModel, setAiModel } from '$lib/editor/assistant';
  import { t } from '$lib/i18n.svelte';
  import { openMenuAbove, type MenuItem } from '$lib/menu.svelte';

  let { id: domId }: { id?: string } = $props();
  let current = $state(getAiModel());
  let name = $derived(AI_MODELS.find((m) => m.id === current)?.name ?? t('Modelo'));
  let button: HTMLButtonElement | undefined = $state();

  function open() {
    if (!button) return;
    const items: MenuItem[] = AI_MODELS.map((m) =>
      m.locked
        ? { label: m.name, icon: Lock, disabled: true, note: t(m.locked), run: () => {} }
        : {
            label: m.name,
            badge: m.isDefault ? t('Padrão') : undefined,
            checked: m.id === current,
            run: () => {
              current = m.id;
              setAiModel(m.id);
            },
          },
    );
    openMenuAbove(button, items);
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
