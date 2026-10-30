import { useId, type ReactNode } from 'react'

export function SettingsTaskSwitcher<T extends string>({
  value,
  options,
  onChange,
  ariaLabel = '设置分区',
  tabs = false,
  id: externalId,
}: {
  value: T
  options: readonly { value: T; label: string; icon?: ReactNode }[]
  onChange: (value: T) => void
  ariaLabel?: string
  tabs?: boolean
  id?: string
}) {
  const generatedId = useId()
  const id = externalId ?? generatedId
  return <div className="settings-task-switcher" role={tabs ? 'tablist' : 'group'} aria-label={ariaLabel}>
    {options.map((option, index) => <button key={option.value} id={`${id}-${option.value}`} type="button" role={tabs ? 'tab' : undefined} aria-controls={tabs ? `${id}-panel-${option.value}` : undefined} aria-selected={tabs ? value === option.value : undefined} aria-pressed={tabs ? undefined : value === option.value} tabIndex={tabs && value !== option.value ? -1 : 0} className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)} onKeyDown={event => {
      if (!tabs) return
      const next = event.key === 'ArrowRight' ? (index + 1) % options.length : event.key === 'ArrowLeft' ? (index - 1 + options.length) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1
      if (next < 0) return
      event.preventDefault()
      onChange(options[next].value)
      document.getElementById(`${id}-${options[next].value}`)?.focus()
    }}>
      {option.icon}<span>{option.label}</span>
    </button>)}
  </div>
}
