import { t } from '../../../core/browser/i18n';

export function GreetingWidget({ now }: { now: Date }) {
  const hour = now.getHours();
  const greeting = hour < 6 ? t('goodNight') : hour < 12 ? t('goodMorning') : hour < 18 ? t('goodAfternoon') : t('goodEvening');
  return <p className={`greeting ${greeting.length > 8 ? 'greeting--compact' : ''}`}>{greeting}</p>;
}
