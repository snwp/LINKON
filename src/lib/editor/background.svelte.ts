import { SvelteMap } from 'svelte/reactivity';
import type { LogEntry } from './assistant';

/** Pedido ao Claude que segue rodando depois de você sair do editor daquela página. */
export const background = new SvelteMap<number, { runId: string; done: Promise<void> }>();

/** Conversa com o Claude por página: volta junto quando você reabre o editor. */
export const aiLogs = new Map<number, LogEntry[]>();

const KEY = 'linkon.aiNotify';

/** Avisar quando o Claude termina e você está fora do editor. Ligado por padrão. */
export function getAiNotify(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAiNotify(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}
