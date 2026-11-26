/**
 * Ponte entre a caixa do agente (AgentBar, nas telas fora do Editor) e o Claude do Editor.
 * A caixa cria uma página e deixa o pedido aqui; o Editor pega o pedido ao abrir e roda.
 */
let pending: string | null = null;

export function setPending(text: string) {
  pending = text;
}

/** O Editor pega o pedido deixado pela caixa (uma vez só). */
export function takePending(): string | null {
  const t = pending;
  pending = null;
  return t;
}
