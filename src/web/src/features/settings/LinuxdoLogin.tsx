import { Button, Input } from '../../components/ui'
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle, LogIn, Upload } from 'lucide-react'
import { request } from '../../shared/api/client'

type Session = { id: string; url?: string; code?: string; status: string; expiresAt: number; interval: number }
export function LinuxdoLogin({ onSuccess, onImportCookie, active = true }: { onSuccess: () => void; onImportCookie: () => void; active?: boolean }) {
  const [session, setSession] = useState<Session | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [callback, setCallback] = useState('')
  const [mode, setMode] = useState<'device' | 'browser'>('device')
  const startRequest = useRef<AbortController | null>(null)
  const sessionID = useRef('')
  const success = useRef(onSuccess); success.current = onSuccess
  function discard() {
    const id = sessionID.current; sessionID.current = ''
    if (id) void request('/settings/linuxdo/login/' + id, { method: 'DELETE' }).catch(() => {})
  }
  useEffect(() => () => { startRequest.current?.abort(); discard() }, [])
  useEffect(() => {
    if (!active || !open || !session || session.status !== 'waiting') return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      if (controller.signal.aborted) return
      if (Date.now() / 1000 >= session!.expiresAt) { setSession({ ...session!, status: 'expired' }); discard(); return }
      if (!document.hidden) {
        try {
          const result = await request<Session>('/settings/linuxdo/login/' + session!.id, { method: 'POST', signal: controller.signal })
          if (controller.signal.aborted) return
          setSession(result)
          if (result.status === 'success') { success.current(); discard(); return }
          if (result.status !== 'waiting') { discard(); return }
        } catch (cause) {
          if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '登录暂时未能完成。'); setSession({ ...session!, status: 'blocked' }); discard() }
          return
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, Math.max(session!.interval, 5) * 1000)
    }
    timer = setTimeout(poll, Math.max(session.interval, 5) * 1000)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [active, open, session?.id, session?.status, session?.interval])
  async function start(selected: 'device' | 'browser' = 'device') {
    if (startRequest.current) return
    discard(); setSession(null); setCallback(''); setMode(selected); setOpen(true); setError(''); setPending(true)
    const controller = new AbortController(); startRequest.current = controller
    try {
      const result = await request<Session>('/settings/linuxdo/login' + (selected === 'browser' ? '?mode=browser' : ''), { method: 'POST', signal: controller.signal })
      if (!controller.signal.aborted) { sessionID.current = result.id; setSession(result) }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '暂时无法发起授权。') }
    finally { if (startRequest.current === controller) startRequest.current = null; if (!controller.signal.aborted) setPending(false) }
  }
  async function complete() {
    if (!session || pending || startRequest.current) return
    const controller = new AbortController(); startRequest.current = controller
    setPending(true); setError('')
    try {
      const result = await request<Session>('/settings/linuxdo/login/' + session.id + '/complete', { method: 'POST', body: JSON.stringify({ callback: callback.trim() }), signal: controller.signal })
      if (!controller.signal.aborted) { setSession(result); setCallback(''); success.current(); discard() }
    } catch (cause) {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '暂时无法完成登录。'); setSession({ ...session, status: 'blocked' }); setCallback(''); discard() }
    } finally {
      if (startRequest.current === controller) startRequest.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }
  function close() { startRequest.current?.abort(); startRequest.current = null; discard(); setPending(false); setOpen(false); setSession(null); setCallback('') }
  function importCookie() { close(); onImportCookie() }
  const messages: Record<string, string> = { waiting: '在原站登录并确认这次授权。', callback: '粘贴本次授权请求的返回结果。', success: '登录成功，已保存。', expired: '授权已过期，请重新发起。', denied: '授权已取消。', changed: '登录信息已更换，请重新发起。' }
  return <div className="linuxdo-login">
    <div className="linuxdo-login-methods">
    <Button variant="quiet" type="button" className="text-button" onClick={importCookie} disabled={pending}><Upload size={14} aria-hidden="true"/>导入 Cookie</Button>
    <Button variant="quiet" type="button" className="text-button" onClick={() => void start()} disabled={pending}><LogIn size={14} aria-hidden="true"/>授权登录</Button>
    </div>
    <details className="settings-details linuxdo-login-alternative">
      <summary>其他方式</summary>
      <p>浏览器回调适合能读取原站请求的用户。</p>
      <Button variant="quiet" type="button" className="text-button" onClick={() => void start('browser')} disabled={pending}><ExternalLink size={14} aria-hidden="true"/>浏览器回调</Button>
    </details>
    {open && <div className="cookie-editor">
      <p role="status">{pending ? '正在准备授权…' : session ? messages[session.status] ?? '' : ''}</p>
      {session?.status === 'waiting' && <><p>确认码：<strong>{session.code}</strong></p><a className="button button-primary" href={session.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true"/>前往原站</a></>}
      {session?.status === 'callback' && <form onSubmit={event => { event.preventDefault(); void complete() }}>
        <p className="field-hint">discourse:// 是授权回调，不会显示在地址栏。</p>
        <details className="settings-details linuxdo-callback-help" open>
          <summary>获取结果</summary>
          <ol>
            <li>在电脑浏览器打开原站授权页。</li>
            <li>打开开发者工具的「网络」，再确认授权。</li>
            <li>选中 POST /user-api-key.json 请求。</li>
            <li>从「响应」复制 redirect_url，或完整 JSON。</li>
          </ol>
          <p>你发来的 linux.do/user-api-key/new 链接只是发起授权，不能直接完成登录。若请求被拒绝或没有返回结果，请改用 Cookie。</p>
        </details>
        <a className="button button-secondary" href={session.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true"/>前往原站</a>
        <label className="cookie-value-label">Linux.do 授权结果<Input className="settings-input" type="password" autoComplete="off" spellCheck={false} value={callback} maxLength={8192} disabled={pending} placeholder="redirect_url 或完整 JSON" onChange={event => setCallback(event.target.value)}/></label>
        <p className="field-hint">仅用于本次登录，请勿分享给他人。</p>
        <Button variant="primary" className="button button-primary" disabled={pending || !callback.trim()}>完成登录</Button>
      </form>}
      {pending && <LoaderCircle size={16} className="spin" aria-hidden="true"/>}
      {error && <p role="alert">{error}</p>}
      {session?.status !== 'success' && <Button variant="quiet" type="button" className="text-button" onClick={importCookie} disabled={pending}><Upload size={14} aria-hidden="true"/>改用 Cookie</Button>}
      {session && ['expired', 'denied', 'blocked', 'changed'].includes(session.status) && <Button variant="quiet" type="button" className="text-button" onClick={() => void start(mode)}>重新授权</Button>}
      <Button variant="quiet" type="button" className="text-button" onClick={close}>关闭</Button>
    </div>}
  </div>
}
