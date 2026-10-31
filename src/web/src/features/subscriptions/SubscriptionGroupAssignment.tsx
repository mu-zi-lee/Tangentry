import { Button, Select } from '../../components/ui'
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import type { SubscriptionSource } from '../../shared/api/types'
import type { useSubscriptionGroups } from './useSubscriptionGroups'

export function SubscriptionGroupAssignment({source, groups: state, busy}: {source: SubscriptionSource; groups: ReturnType<typeof useSubscriptionGroups>; busy: boolean}) {
  const [draft, setDraft] = useState(source.groupId)
  const [baseline, setBaseline] = useState(source.groupId)
  const dirty = draft !== baseline
  const changed = baseline !== source.groupId
  useEffect(() => { if (!dirty) { setDraft(source.groupId); setBaseline(source.groupId) } }, [source.groupId, dirty])
  const unavailable = draft !== '' && !state.groups.some(group => group.id === draft)
  const error = state.error?.kind === 'assign' && state.error.id === source.id ? state.error.message : ''
  return <div className="subscription-group-assignment">
    <form className="subscription-setting-row" onSubmit={event => { event.preventDefault(); void state.assign(source.id, draft, baseline).then(ok => { if (ok) setBaseline(draft) }) }}>
      <label className="subscription-field"><span>所属分组</span><Select aria-label="来源所属分组" value={draft} disabled={busy || state.loading || Boolean(state.listError) || Boolean(state.pending)} onChange={event => setDraft(event.target.value)}><option value="">未分组</option>{unavailable && <option value={draft}>分组暂不可用</option>}{state.groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</Select></label>
      <Button className="button button-secondary" variant="secondary" aria-label="保存分组" title="保存分组" disabled={busy || state.loading || Boolean(state.listError) || Boolean(state.pending) || !dirty || unavailable || changed}><Check size={14} aria-hidden="true"/>保存</Button>
    </form>
    {changed && <p className="subscription-group-feedback" role="status">来源分组已在其他页面改变，草稿已保留。<Button variant="quiet" className="text-button" onClick={() => { setDraft(source.groupId); setBaseline(source.groupId) }}>采用当前分组</Button></p>}
    {error && <p className="subscription-group-feedback" role="alert">{error}</p>}
  </div>
}
