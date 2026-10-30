import type { ReactNode } from 'react'

export function SettingsRow({ title, description, children, setting, className = '' }: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  setting?: string
  className?: string
}) {
  return <div className={`settings-row ${className}`.trim()} data-setting={setting}>
    <div className="settings-row-label"><strong>{title}</strong>{description && <span>{description}</span>}</div>
    {children && <div className="settings-row-control">{children}</div>}
  </div>
}

export function SettingsStatus({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'positive' | 'warning' | 'danger' | 'neutral' }) {
  return <span className="settings-status-chip" data-tone={tone}>{children}</span>
}
