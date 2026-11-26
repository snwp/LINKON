<script lang="ts">
  /** Menu do botão direito. Os itens vêm de openMenu (menu.svelte.ts). Abre como o "Menu dropdown" do Transitions.dev. */
  import { tick } from 'svelte';
  import { Check } from '@lucide/svelte';
  import { dropdown } from '$lib/motion';
  import { menu, closeMenu, type MenuItem } from '$lib/menu.svelte';

  let box: HTMLDivElement | undefined = $state();
  let left = $state(0);
  let top = $state(0);
  let confirming = $state<number | null>(null);

  const isAction = (it: MenuItem): it is Extract<MenuItem, { run: () => void }> => 'run' in it;

  // Ao abrir: posiciona sem sair da janela e põe o foco no primeiro item, para o teclado funcionar.
  $effect(() => {
    if (!menu.open) return;
    void menu.items;
    confirming = null;
    left = menu.x;
    top = menu.y;
    tick().then(() => {
      if (!box) return;
      const r = box.getBoundingClientRect();
      const x = menu.alignRight ? menu.x - r.width : menu.x;
      const y = menu.above ? menu.y - r.height : menu.y;
      left = Math.max(8, Math.min(x, innerWidth - r.width - 8));
      top = Math.max(8, Math.min(y, innerHeight - r.height - 8));
      box.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    });
  });

  function activate(i: number) {
    const it = menu.items[i];
    if (!isAction(it) || it.disabled) return;
    if (it.confirm && confirming !== i) {
      confirming = i;
      return;
    }
    closeMenu();
    it.run();
  }

  function onkeydown(e: KeyboardEvent) {
    if (!box) return;
    const buttons = [...box.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
      buttons[next]?.focus();
    } else if (e.key === 'Tab') {
      closeMenu();
    }
  }
</script>

<svelte:window onblur={closeMenu} onresize={closeMenu} />

{#if menu.open}
  <!-- Clicar fora (com qualquer botão) fecha. -->
  <div
    class="backdrop"
    role="presentation"
    onpointerdown={closeMenu}
    oncontextmenu={(e) => {
      e.preventDefault();
      closeMenu();
    }}
  ></div>
  <div
    class="menu"
    bind:this={box}
    role="menu"
    tabindex="-1"
    style={`left:${left}px;top:${top}px`}
    {onkeydown}
    in:dropdown
    out:dropdown={{ closing: true }}
  >
    {#each menu.items as it, i (i)}
      {#if 'separator' in it}
        <div class="sep" role="separator"></div>
      {:else if 'heading' in it}
        <div class="heading" role="presentation">{it.heading}</div>
      {:else}
        <button
          role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
          aria-checked={it.checked === undefined ? undefined : it.checked}
          class:danger={it.danger}
          class:confirm={confirming === i}
          disabled={it.disabled}
          onclick={() => activate(i)}
        >
          <span class="lead" aria-hidden="true">
            {#if it.checked}<Check size={14} />{:else if it.icon}<it.icon size={14} strokeWidth={1.75} />{/if}
          </span>
          <span class="label">{confirming === i ? it.confirm : it.label}</span>
          {#if it.badge}<span class="badge">{it.badge}</span>{/if}
          {#if it.note}<span class="note">{it.note}</span>{/if}
          {#if it.kbd && confirming !== i}<kbd>{it.kbd}</kbd>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
  }

  .menu {
    position: fixed;
    z-index: 91;
    min-width: 220px;
    max-width: 300px;
    padding: 5px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--glass);
    backdrop-filter: var(--glass-blur);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--fg) 4%, transparent),
      0 16px 40px rgb(0 0 0 / 0.55);
    transform-origin: top left;
    outline: none;
  }

  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 10px 0 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--fg);
    font: 500 13px var(--font-ui);
    text-align: left;
    cursor: pointer;
  }

  button:hover,
  button:focus-visible {
    background: color-mix(in srgb, var(--fg) 14.9%, var(--bg));
    outline: none;
  }

  button:disabled {
    color: color-mix(in srgb, var(--fg) 35.3%, var(--bg));
    cursor: default;
  }

  button:disabled:hover {
    background: transparent;
  }

  /* Excluir: sem vermelho; no segundo passo o item se inverte para não deixar dúvida. */
  .danger.confirm {
    background: var(--fg);
    color: var(--bg);
  }

  .lead {
    display: grid;
    place-items: center;
    width: 16px;
    flex: none;
    color: var(--muted);
  }

  .confirm .lead,
  button[aria-checked='true'] .lead {
    color: inherit;
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    flex: none;
    padding: 1px 6px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--fg) 16.5%, var(--bg));
    color: var(--muted);
    font: 500 10.5px var(--font-ui);
  }

  .note {
    flex: none;
    color: color-mix(in srgb, var(--fg) 42%, var(--bg));
    font: 400 11.5px var(--font-ui);
  }

  /* Com etiqueta ou nota, o nome não estica: o resto vai logo depois dele. */
  button:has(.badge) .label,
  button:has(.note) .label {
    flex: 0 1 auto;
  }

  kbd {
    flex: none;
    border: 0;
    padding: 0;
    color: var(--muted);
  }

  .sep {
    height: 1px;
    margin: 5px 6px;
    background: var(--line);
  }

  .heading {
    padding: 8px 8px 4px 34px;
    color: var(--muted);
    font: 500 11px var(--font-ui);
  }
</style>
