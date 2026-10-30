import type { useDownloads } from '../../downloads/useDownloads'
import { SettingsActionPage } from '../ui/SettingsActionPage'
import { UpdaterSettings } from '../UpdaterSettings'
import { DownloadToolsSettings } from '../DownloadToolsSettings'

export function ComponentsUpdatesSettingsPage({ downloads, active = true }: { downloads: ReturnType<typeof useDownloads>; active?: boolean }) {
  return <SettingsActionPage title="组件与更新" description="检查 Tangentry 和下载所依赖的系统组件，保持内容获取稳定。">
    <UpdaterSettings active={active}/>
    <DownloadToolsSettings downloads={downloads} active={active}/>
  </SettingsActionPage>
}
