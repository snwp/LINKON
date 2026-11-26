<script lang="ts">
  import { Image, FileText, FileType, FileCode, File } from '@lucide/svelte';
  import type { FileKind } from '$lib/api';

  let { kind, size = 16 }: { kind: FileKind; size?: number } = $props();

  const icons = { imagem: Image, pdf: FileText, documento: FileType, texto: FileCode, outro: File };
  let Icon = $derived(icons[kind]);
</script>

<Icon {size} strokeWidth={1.5} aria-hidden="true" />
