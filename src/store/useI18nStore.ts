import { create } from 'zustand';
import type { Lang } from '../i18n/translations';

const STORAGE_KEY = 'ssh-manager-lang';

function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {}
  return 'zh';
}

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  lang: loadLang(),
  setLang: (lang: Lang) => {
    localStorage.setItem(STORAGE_KEY, lang);
    set({ lang });
  },
}));