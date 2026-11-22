export interface AppSettings {
  showHeardCaption: boolean;
  voiceRate: number;
  voiceVolume: number;
  handsFree: boolean;
  wakeWord: boolean;
  mediaControl: boolean;
  screenContext: boolean;
}

const SETTINGS_KEY = 'nexus.settings';

export const defaultSettings: AppSettings = {
  showHeardCaption: false,
  voiceRate: 1,
  voiceVolume: 1,
  handsFree: false,
  wakeWord: false,
  mediaControl: true,
  screenContext: false,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
