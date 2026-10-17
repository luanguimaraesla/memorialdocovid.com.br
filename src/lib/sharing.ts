export interface SharedLink {
  title: string;
  text: string;
  url: string;
}

export function shareDescription(title: string): string {
  return `Nunca esqueceremos nossas perdas, nem os responsáveis! Você se lembra? ${title}`;
}

export function statementAnchor(id: string): string {
  return `declaracao-${id}`;
}

export function statementUrl(id: string, base: URL): string {
  const url = new URL(`marcos/${encodeURIComponent(id)}/`, base);
  url.hash = encodeURIComponent(statementAnchor(id));
  return url.href;
}

// Phones and tablets, whose main input is touch, open the system share sheet. Computers copy
// the message and link instead, even when their browser offers a share sheet.
function opensShareSheet(): boolean {
  return typeof navigator.share === 'function'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export async function shareLink(link: SharedLink): Promise<'shared' | 'copied' | 'cancelled' | 'manual'> {
  if (opensShareSheet()) {
    try {
      await navigator.share(link);
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    if (!navigator.clipboard?.writeText) return 'manual';
    await navigator.clipboard.writeText(`${link.text}\n${link.url}`);
    return 'copied';
  } catch {
    return 'manual';
  }
}
