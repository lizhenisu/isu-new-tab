import { useCallback, useEffect, useState } from 'react';
import { documentLanguage, setAppLanguage, t } from '../../../core/browser/i18n';
import { getAppLanguagePreference, setAppLanguagePreference } from '../../../core/browser/language-preference';
import type { AppLanguage } from '../../../core/domain/types';
import { browser } from 'wxt/browser';

export function useAppLanguage() {
  const [language, setLanguage] = useState<AppLanguage>();

  const apply = useCallback((value: AppLanguage) => {
    setAppLanguage(value);
    document.documentElement.lang = documentLanguage(value);
    document.title = t('newTabTitle');
    setLanguage(value);
  }, []);

  useEffect(() => {
    let disposed = false;
    void getAppLanguagePreference().then((value) => { if (!disposed) apply(value); });
    return () => { disposed = true; };
  }, [apply]);

  const selectLanguage = useCallback(async (value: AppLanguage) => {
    apply(value);
    await setAppLanguagePreference(value);
    await browser.runtime.sendMessage({ type: 'language:set', language: value }).catch(() => undefined);
  }, [apply]);

  return { language, selectLanguage };
}
