import { useEffect } from 'react'
import type { useDownloads } from '../../downloads/useDownloads'
import { BackupSettings } from '../BackupSettings'
import { StorageSettings } from '../StorageSettings'

export type DataTab = 'storage' | 'backup'

export function DataSettingsPage({ value, downloads, active = true }: { value: DataTab; downloads: ReturnType<typeof useDownloads>; active?: boolean }) {
  useEffect(() => {
    if (value !== 'backup') return
    window.requestAnimationFrame(() => document.getElementById('settings-backup')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [value])
  return <BackupSettings active={active}><div id="settings-storage"><StorageSettings active={active} downloads={downloads}/></div></BackupSettings>
}
