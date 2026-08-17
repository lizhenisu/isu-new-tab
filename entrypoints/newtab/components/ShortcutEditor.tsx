import { useState, type FormEvent } from 'react';
import { t } from '../../../core/browser/i18n';
import type { Shortcut, ShortcutGroup } from '../../../core/domain/types';
import { Modal } from './Modal';

type Props = {
  shortcut?: Shortcut;
  groups: ShortcutGroup[];
  defaultGroupId: string;
  onSave(input: Pick<Shortcut, 'name' | 'url' | 'groupId'>): Promise<void>;
  onClose(): void;
};

export function ShortcutEditor({ shortcut, groups, defaultGroupId, onSave, onClose }: Props) {
  const [name, setName] = useState(shortcut?.name ?? '');
  const [url, setUrl] = useState(shortcut?.url ?? '');
  const [groupId, setGroupId] = useState(shortcut?.groupId ?? defaultGroupId);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await onSave({ name, url, groupId });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <Modal title={shortcut ? t('edit') : t('addShortcut')} onClose={onClose} variant="editor">
      <form className="form shortcutEditorForm" onSubmit={submit}>
        <label>{t('name')}<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
        <label>{t('url')}<input required inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" /></label>
        <label>{t('group')}<select value={groupId} onChange={(event) => setGroupId(event.target.value)}>{groups.map((group) => <option key={group.id} value={group.id}>{group.id === 'default' && ['Default', '默认分组'].includes(group.name) ? t('defaultGroup') : group.name}</option>)}</select></label>
        {error && <p className="errorText" role="alert">{error}</p>}
        <footer className="formActions"><button type="button" className="secondary" onClick={onClose}>{t('cancel')}</button><button type="submit">{t('save')}</button></footer>
      </form>
    </Modal>
  );
}
