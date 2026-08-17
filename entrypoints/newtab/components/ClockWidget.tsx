import { currentLanguageTag } from '../../../core/browser/i18n';

export function ClockWidget({ now }: { now: Date }) {
  const language = currentLanguageTag();

  return (
    <header className="dashboardHeader">
      <time className="heroTime" dateTime={now.toISOString()}>{now.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
      <time className="heroDate" dateTime={now.toISOString()}>{now.toLocaleDateString(language, { month: 'long', day: 'numeric', weekday: 'long' })}</time>
    </header>
  );
}
