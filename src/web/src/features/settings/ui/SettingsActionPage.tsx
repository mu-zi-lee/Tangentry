import { useId, type ReactNode } from 'react'

export function SettingsActionPage({
  title,
  description,
  status,
  actions,
  children,
  className = '',
}: {
  title: string
  description: string
  status?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const titleId = useId()
  return <section className={`settings-action-page ${className}`.trim()} aria-labelledby={titleId}>
    <header className="settings-action-head">
      <div>
        <h1 id={titleId}>{title}</h1>
        <p>{description}</p>
      </div>
      {(status || actions) && <div className="settings-action-head-actions">{status && <span className="settings-inline-status">{status}</span>}{actions}</div>}
    </header>
    <div className="settings-action-body">{children}</div>
  </section>
}

export function SettingsTask({ title, description, children, actions, className = '' }: {
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return <section className={`settings-task ${className}`.trim()}>
    {(title || description || actions) && <div className="settings-task-head">{(title || description) && <div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>}{actions && <div className="settings-task-actions">{actions}</div>}</div>}
    <div className="settings-task-content">{children}</div>
  </section>
}
