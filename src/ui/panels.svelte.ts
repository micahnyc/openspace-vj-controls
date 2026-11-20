/**
 * Which system panels (04-09) are shown and expanded. Hidden panels are
 * remembered per browser (a viewer convenience, not part of the show file).
 */
import { tick } from 'svelte';
import { saveSettings, settings } from '../settings.svelte';

export const PANELS = [
  { id: 'openspace', index: '04', title: 'OPENSPACE' },
  { id: 'sending', index: '05', title: 'SENDING & DEBUG' },
  { id: 'palette', index: '06', title: 'PALETTE' },
  { id: 'log', index: '07', title: 'LOG' },
  { id: 'monitor', index: '08', title: 'MIDI MONITOR' },
  { id: 'browser', index: '09', title: 'SCENE BROWSER' },
] as const;

export type PanelId = (typeof PANELS)[number]['id'];

class Panels {
  /** Expanded (open) state of each shown panel. */
  expanded: Record<PanelId, boolean> = $state({
    openspace: true,
    sending: false,
    palette: false,
    log: false,
    monitor: false,
    browser: false,
  });

  isHidden(id: PanelId): boolean {
    return settings.hiddenPanels.includes(id);
  }

  hide(id: PanelId): void {
    if (!this.isHidden(id)) settings.hiddenPanels = [...settings.hiddenPanels, id];
    saveSettings();
  }

  /** Show, expand and scroll to a panel (from the PANELS menu). */
  async show(id: PanelId): Promise<void> {
    settings.hiddenPanels = settings.hiddenPanels.filter((p) => p !== id);
    this.expanded[id] = true;
    saveSettings();
    await tick();
    document.getElementById(`panel-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  toggle(id: PanelId): void {
    if (this.isHidden(id)) void this.show(id);
    else this.hide(id);
  }

  showAll(): void {
    settings.hiddenPanels = [];
    saveSettings();
  }
}

export const panels = new Panels();
