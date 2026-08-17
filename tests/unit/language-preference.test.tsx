import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { setAppLanguage, t } from '../../core/browser/i18n';
import { getAppLanguagePreference, setAppLanguagePreference } from '../../core/browser/language-preference';
import { getDatabase } from '../../core/storage/database';
import { LanguageSettings } from '../../entrypoints/newtab/components/settings/LanguageSettings';

beforeEach(async () => {
  await (await getDatabase()).delete('settings', 'appLanguage');
  setAppLanguage('system');
});

afterEach(() => {
  cleanup();
  setAppLanguage('system');
  vi.clearAllMocks();
});

describe('app language preference', () => {
  it('defaults to the browser language and persists only on this device', async () => {
    await expect(getAppLanguagePreference()).resolves.toBe('system');

    await setAppLanguagePreference('en');

    await expect(getAppLanguagePreference()).resolves.toBe('en');
  });

  it('uses the selected dictionary when the browser exposes its UI language', () => {
    const original = browser.i18n.getUILanguage;
    Object.assign(browser.i18n, { getUILanguage: () => 'en-US' });

    setAppLanguage('en');
    expect(t('settings')).toBe('Settings');
    setAppLanguage('zh_CN');
    expect(t('settings')).toBe('设置');

    Object.assign(browser.i18n, { getUILanguage: original });
  });

  it('renders and changes the three language choices', () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<LanguageSettings language="system" onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh_CN' } });

    expect(onChange).toHaveBeenCalledWith('zh_CN');
    expect(screen.getByRole('option', { name: '简体中文' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'English' })).toBeVisible();
  });
});
