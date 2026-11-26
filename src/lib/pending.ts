/** Editores com alterações ainda não gravadas se registram aqui para o fechamento da janela esperar por eles. */
type Flush = () => Promise<boolean>;

const flushers = new Set<Flush>();

export function registerFlush(f: Flush): () => void {
  flushers.add(f);
  return () => flushers.delete(f);
}

/** Grava tudo o que estiver pendente. Devolve false se alguma gravação falhou. */
export async function flushAll(): Promise<boolean> {
  const results = await Promise.all([...flushers].map((f) => f().catch(() => false)));
  return results.every(Boolean);
}
