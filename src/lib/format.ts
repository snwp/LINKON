const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

const sizeFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** "820 B", "12 KB", "1,4 MB". */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${sizeFmt.format(v)} ${units[i]}`;
}

/** Rótulos das categorias da Biblioteca, na ordem do briefing. */
export const KIND_LABELS = {
  imagem: { one: 'Imagem', many: 'Imagens' },
  pdf: { one: 'PDF', many: 'PDFs' },
  documento: { one: 'Documento', many: 'Documentos' },
  texto: { one: 'Texto', many: 'Textos' },
  outro: { one: 'Outro', many: 'Outros' },
} as const;

/** "há 5 minutos", "ontem", "agora". */
export function ago(ms: number): string {
  const s = (ms - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
  }
  return 'agora';
}
