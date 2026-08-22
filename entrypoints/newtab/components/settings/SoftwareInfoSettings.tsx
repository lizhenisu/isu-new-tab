import { browser } from 'wxt/browser';
import { t } from '../../../../core/browser/i18n';

const GITHUB_URL = 'https://github.com/lizhenisu/isu-newtab';

export function SoftwareInfoSettings() {
  let version = '0.4.0';
  try {
    version = browser.runtime.getManifest().version ?? version;
  } catch {
    // Unit-test shims may not expose the extension manifest API.
  }

  return (
    <section className="softwareInfoSettings">
      <h3>{t('softwareInfo')}</h3>
      <dl className="softwareInfoList">
        <div>
          <dt>{t('version')}</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>{t('github')}</dt>
          <dd><a href={GITHUB_URL} target="_blank" rel="noreferrer">{GITHUB_URL}</a></dd>
        </div>
      </dl>
    </section>
  );
}
