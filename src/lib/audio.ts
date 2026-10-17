function reportError(): void {
  const status = document.querySelector<HTMLElement>('[data-audio-status]');
  if (status) status.hidden = false;
}

export async function startAudio(): Promise<void> {
  const audio = document.querySelector<HTMLAudioElement>('#memorial-audio');
  if (!audio) return;
  try {
    if (audio.error) audio.load();
    await audio.play();
  } catch {
    reportError();
  }
}

export function bootAudio(): void {
  const audio = document.querySelector<HTMLAudioElement>('#memorial-audio');
  const toggles = [...document.querySelectorAll<HTMLButtonElement>('[data-audio-toggle]')];
  if (!audio || toggles.length === 0) return;

  const sync = (): void => {
    const stopped = audio.paused || audio.ended || Boolean(audio.error);
    const silent = stopped || audio.muted;
    const label = audio.error ? 'Tentar música novamente' : stopped ? 'Ouvir música' : audio.muted ? 'Ativar som' : 'Silenciar música';
    for (const toggle of toggles) {
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('aria-pressed', String(audio.muted));
      toggle.toggleAttribute('data-silent', silent);
      toggle.title = label;
    }
    if (!audio.paused && !audio.error) {
      const status = document.querySelector<HTMLElement>('[data-audio-status]');
      if (status) status.hidden = true;
    }
  };

  for (const toggle of toggles) {
    toggle.addEventListener('click', () => {
      if (audio.paused || audio.ended || audio.error) {
        audio.muted = false;
        void startAudio();
      } else {
        audio.muted = !audio.muted;
      }
      sync();
    });
    toggle.disabled = false;
  }
  for (const event of ['play', 'pause', 'ended', 'volumechange']) audio.addEventListener(event, sync);
  // Clicking into an embedded video moves focus to its frame and blurs the page. The music
  // pauses then, so the two never play over each other.
  window.addEventListener('blur', () => {
    if (document.activeElement?.tagName === 'IFRAME') audio.pause();
  });
  audio.addEventListener('error', () => { reportError(); sync(); });
  audio.controls = false;
  sync();
}
