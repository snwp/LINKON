// Preferências da geração de imagem: qual gerador e qual modelo da API. A chave fica no cofre do Windows (Rust).
import type { ImageRequest } from './api';

export const IMAGE_PROVIDERS = [
  { id: 'codex', name: 'Codex (assinatura do ChatGPT)' },
  { id: 'openai', name: 'API da OpenAI (chave)' },
] as const;

export const IMAGE_MODELS = [
  { id: 'gpt-image-2.6-flare', name: 'GPT Image 2.6 Flare', note: 'Mais rápido' },
  { id: 'gpt-image-2.6-sunburst', name: 'GPT Image 2.6 Sunburst', note: 'Mais detalhado' },
] as const;

export const SHAPES: { id: ImageRequest['shape']; label: string; w: number; h: number }[] = [
  { id: 'wide', label: 'Larga', w: 600, h: 400 },
  { id: 'square', label: 'Quadrada', w: 400, h: 400 },
  { id: 'tall', label: 'Alta', w: 400, h: 600 },
];

type Prefs = { provider: ImageRequest['provider']; model: string };
const KEY = 'linkon.image';
const DEFAULT: Prefs = { provider: 'codex', model: IMAGE_MODELS[0].id };

export function getImagePrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      provider: IMAGE_PROVIDERS.some((x) => x.id === p.provider) ? p.provider : DEFAULT.provider,
      model: IMAGE_MODELS.some((m) => m.id === p.model) ? p.model : DEFAULT.model,
    };
  } catch {
    return DEFAULT;
  }
}

export function setImagePrefs(p: Partial<Prefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getImagePrefs(), ...p }));
  } catch {
    // Sem armazenamento, vale o padrão.
  }
}
