import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { request } from '../../shared/api/client'
import { useCapabilities } from '../../shared/api/desktop'
import type { useDownloads } from '../downloads/useDownloads'
import { SettingsTask } from './ui/SettingsActionPage'
import { SettingsRow } from './ui/SettingsRow'

export function StorageSettings({ downloads, active = true }: {
  downloads: ReturnType<typeof useDownloads>
  active?: boolean
}) {
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const [directory, setDirectory] = useState<string | null>(null)
  const { pathPicker } = useCapabilities()
  useEffect(() => { if (!active || !pathPicker) return; const controller = new AbortController(); void request<{ directory: string }>('/desktop/download-directory', { signal: controller.signal }).then(result => setDirectory(result.directory || null)).catch(() => {}); return () => controller.abort() }, [active, pathPicker])
  async function chooseDirectory() { setPending(true); setError(''); try { const result = await request<{ directory: string; cancelled: boolean }>('/desktop/download-directory', { method: 'POST' }); if (result.cancelled) return; setDirectory(result.directory); await downloads.reload() } catch (cause) { setError(cause instanceof Error ? cause.message : '无法选择下载目录。') } finally { setPending(false) } }
  return <>
    <SettingsTask title="存储位置">
      <div className="settings-list-card"><SettingsRow setting="download-directory" title="下载目录" description={<span className="settings-mono">{pathPicker ? (directory || '正在读取…') : (downloads.tools?.downloadDir ?? '正在读取…')}</span>}>
        {pathPicker && <button type="button" className="button button-secondary" aria-label="选择下载目录" disabled={pending} onClick={() => void chooseDirectory()}><FolderOpen size={15}/>{pending ? '正在处理…' : '更改'}</button>}
      </SettingsRow></div>
      {error && <p className="subtitle-error" role="alert">{error}</p>}
    </SettingsTask>
  </>
}
