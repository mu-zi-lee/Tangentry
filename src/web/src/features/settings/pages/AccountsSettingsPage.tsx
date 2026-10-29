import { PlatformCookies } from '../PlatformCookies'
import { SettingsActionPage } from '../ui/SettingsActionPage'
import '../accounts-settings.css'

export function AccountsSettingsPage({ onChanged }: {
  onChanged: (platform: string) => void
}) {
  return <SettingsActionPage className="settings-action-accounts" eyebrow="连接" title="账号" description="管理平台登录与内容来源凭据。">
    <PlatformCookies onChanged={onChanged} />
  </SettingsActionPage>
}
