import { AISettings } from '../../ai/AISettings'
import { TranscriptionSettings } from '../TranscriptionSettings'
import { SettingsActionPage } from '../ui/SettingsActionPage'
import { SettingsTaskSwitcher } from '../ui/SettingsTaskSwitcher'

export type AIServiceTab = 'provider' | 'text' | 'asr'

export function AIServiceSettingsPage({ value, onChange, active = true }: { value: AIServiceTab; onChange: (value: AIServiceTab) => void; active?: boolean }) {
  return <SettingsActionPage className="settings-action-ai" title="AI 服务" description="翻译、摘要、对话与字幕转录共用这里配置的模型服务。">
    <SettingsTaskSwitcher id="ai-tab" tabs ariaLabel="AI 服务分区" value={value} onChange={onChange} options={[{ value: 'provider', label: '服务商' }, { value: 'text', label: '翻译与摘要' }, { value: 'asr', label: '字幕转录' }]}/>
    <AISettings active={active} section={value}/>
    <div role="tabpanel" id="ai-tab-panel-asr" aria-labelledby="ai-tab-asr" hidden={value !== 'asr'}>
      {value === 'asr' && <TranscriptionSettings active={active}/>}
    </div>
  </SettingsActionPage>
}
