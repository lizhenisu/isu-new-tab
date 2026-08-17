import { browser } from 'wxt/browser';
import type { AppLanguage } from '../domain/types';
import english from '../../public/_locales/en/messages.json';
import chinese from '../../public/_locales/zh_CN/messages.json';

type Messages = Record<string, { message: string }>;
type ResolvedLanguage = Exclude<AppLanguage, 'system'>;

const dictionaries: Record<ResolvedLanguage, Messages> = { en: english, zh_CN: chinese };
let language: AppLanguage = 'system';

export function t(key: string): string {
  if (typeof browser.i18n.getUILanguage !== 'function') {
    return browser.i18n.getMessage(key as Parameters<typeof browser.i18n.getMessage>[0]) || key;
  }

  const dictionary = dictionaries[resolveLanguage(language)];
  return dictionary[key]?.message ?? (browser.i18n.getMessage(key as Parameters<typeof browser.i18n.getMessage>[0]) || key);
}

export function setAppLanguage(value: AppLanguage): void {
  language = value;
}

export function resolveLanguage(value: AppLanguage): ResolvedLanguage {
  if (value === 'zh_CN' || value === 'en') return value;
  const browserLanguage = browser.i18n.getUILanguage?.().toLocaleLowerCase();
  return browserLanguage?.startsWith('zh') ? 'zh_CN' : 'en';
}

export function documentLanguage(value: AppLanguage): string {
  return resolveLanguage(value) === 'zh_CN' ? 'zh-CN' : 'en';
}

export function currentLanguageTag(): string {
  return documentLanguage(language);
}
