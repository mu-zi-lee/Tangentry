import { useEffect } from 'react'
import type { useDownloads } from '../../downloads/useDownloads'
import { BackupSettings } from '../BackupSettings'
import { StorageSettings } from '../StorageSettings'
import { SamplesSettings } from '../../samples/SamplesSettings'

export type DataTab = 'storage' | 'backup' | 'samples'

export function DataSettingsPage({ value, downloads, active = true }: { value: DataTab; downloads: ReturnType<typeof useDownloads>; active?: boolean }) {
  useEffect(() => {
    if (value === 'samples') {
      window.requestAnimationFrame(() => document.getElementById('settings-samples')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
      return
    }
    if (value !== 'backup') return
    window.requestAnimationFrame(() => document.getElementById('settings-backup')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [value])
  return <BackupSettings active={active}><div id="settings-storage"><StorageSettings active={active} downloads={downloads}/></div><div id="settings-samples-section"><SamplesSettings active={active}/></div></BackupSettings>
}
