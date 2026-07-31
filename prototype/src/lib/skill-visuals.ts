/** Helpers visuais compartilhados entre a lista e o detalhe (DRY). */

/** Avatar não aceita cor arbitrária (DESIGN.md: zero hex inline) — os 3 tones do DS. */
const TONES = ['primary', 'accent', 'muted'] as const;

export type AvatarTone = (typeof TONES)[number];

/** Estável por skillId: a mesma skill tem sempre a mesma cor, em qualquer tela. */
export function toneFor(skillId: string): AvatarTone {
  const sum = [...skillId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return TONES[sum % TONES.length]!;
}

export function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
