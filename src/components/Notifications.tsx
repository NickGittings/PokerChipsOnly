import type { Notice } from '../net/useNotifications';

export function Notifications({ notices, dismiss }: { notices: Notice[]; dismiss: (id: number) => void }) {
  return <div className="notice-stack" role="status" aria-live="polite" aria-relevant="additions"><div>{notices.map(notice => <div className={`notice-toast notice-${notice.tone}${notice.urgent ? ' notice-urgent' : ''}`} key={notice.id}><span>{notice.text}</span><button aria-label={`Dismiss ${notice.text}`} onClick={() => dismiss(notice.id)}>×</button></div>)}</div></div>;
}
