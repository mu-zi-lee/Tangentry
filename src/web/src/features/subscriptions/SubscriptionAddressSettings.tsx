import { Button, Input } from '../../components/ui'
import { Check, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SubscriptionSource } from '../../shared/api/types'

export function SubscriptionAddressSettings({ source, busy, onSave }: {
  source: SubscriptionSource; busy: boolean; onSave: (url: string, expectedURL: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(source.url)
  const [expected, setExpected] = useState(source.url)
  const dirty = draft !== expected
  const changed = expected !== source.url
  useEffect(() => { if (!dirty) { setDraft(source.url); setExpected(source.url) } }, [source.url, dirty])
  return <div className="subscription-address">
    <form className="subscription-setting-row" onSubmit={event => { event.preventDefault(); if (!busy && !changed && dirty) void onSave(draft, expected).then(ok => { if (ok) { setExpected(draft.trim()); setDraft(draft.trim()) } }) }}>
      <label className="subscription-field subscription-field-wide"><span>RSS / Atom 地址</span><div className="subscription-input"><Input type="url" aria-label="RSS 订阅地址" value={draft} onChange={event => setDraft(event.target.value)} autoComplete="off" spellCheck={false} maxLength={2048} required disabled={busy}/></div></label>
      <div className="subscription-address-actions"><Button className="button button-secondary" variant="secondary" aria-label="保存地址" title="保存地址" disabled={busy || changed || !draft.trim() || !dirty}><Check size={14} aria-hidden="true"/>保存</Button>{dirty && <Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="取消修改订阅地址" title="取消修改" disabled={busy} onClick={() => { setDraft(source.url); setExpected(source.url) }}><X size={15}/></Button>}</div>
      {changed && <p className="field-hint" role="status">地址已在其他页面修改。<Button variant="quiet" type="button" className="text-button" disabled={busy} onClick={() => { setExpected(source.url); setDraft(source.url) }}><RefreshCw size={13}/>读取当前地址</Button></p>}
    </form>
  </div>
}
