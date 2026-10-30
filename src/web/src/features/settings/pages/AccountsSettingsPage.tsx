import { PlatformCookies } from '../PlatformCookies'
import { SettingsActionPage } from '../ui/SettingsActionPage'
import '../accounts-settings.css'

export function AccountsSettingsPage({ onChanged, active = true, platform }: {
  onChanged: (platform: string) => void
  active?: boolean
  platform?: string
}) {
  return <SettingsActionPage title="平台账号" description="登录内容来源，用于读取会员内容、评论与推荐。凭据只保存在本机。">
    <PlatformCookies active={active} initialPlatform={platform} onChanged={onChanged} />
  </SettingsActionPage>
}
