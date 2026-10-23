// Inline icons (no icon font, no network). 24x24, stroke-based unless noted.
const s = (d: string, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;

export const icons = {
  logo: `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="var(--accent)"/><rect x="19" y="9" width="26" height="46" rx="6" fill="none" stroke="var(--accent-ink)" stroke-width="4"/><path d="M36.5 25.5a8 8 0 1 0 4 10.4 6.4 6.4 0 0 1-4-10.4z" fill="var(--accent-ink)"/></svg>`,
  usb: s('<path d="M12 3v14"/><path d="m9 6 3-3 3 3"/><circle cx="12" cy="19" r="2"/><path d="M7 9v3l5 3"/><path d="M17 8v4l-5 3"/><rect x="15.5" y="6" width="3" height="2" rx=".5"/><circle cx="7" cy="8" r="1.2"/>'),
  phone: s('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  check: s('<path d="m5 12.5 4.5 4.5L19 7.5"/>', ' stroke-width="3"'),
  shield: s('<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  undo: s('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  lock: s('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  eye: s('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  code: s('<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/>'),
  down: s('<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>'),
  up: s('<path d="M12 20V8"/><path d="m7 13 5-5 5 5"/><path d="M5 4h14"/>'),
  warn: s('<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17h.01"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  x: s('<path d="M6 6l12 12M18 6 6 18"/>', ' stroke-width="2.6"'),
  okCircle: s('<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path d="m7.5 12.2 3 3 6-6.2" stroke="var(--surface)" stroke-width="2.4"/>'),
  badCircle: s('<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path d="M9 9l6 6M15 9l-6 6" stroke="var(--surface)" stroke-width="2.4"/>'),
  phoneAllow: `<svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><rect x="20" y="4" width="40" height="72" rx="8" stroke="currentColor" stroke-width="4"/><rect x="25" y="26" width="30" height="24" rx="4" fill="currentColor" opacity=".16"/><path d="m33 38 5 5 9-9" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};
