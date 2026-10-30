import { Button } from '../../components/ui'
import { useEffect, useState } from 'react'
import { QrCode } from 'lucide-react'
import { request } from '../../shared/api/client'

type Session = { id: string; image?: string; status: string; expiresAt: number }
export function BilibiliLogin({ onSuccess, active = true }: { onSuccess: () => void; active?: boolean }) {
  const [session, setSession] = useState<Session | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!active || !open || !session || session.status === 'success' || session.status === 'expired') return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (document.hidden) { timer = setTimeout(poll, 2500); return }
      try {
        const value = await request<Session>('/settings/bilibili/login/' + session.id, { method: 'POST', signal: controller.signal })
        if (controller.signal.aborted) return
        setSession(value)
        if (value.status === 'success') { onSuccess(); return }
        if (value.status === 'expired') return
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '扫码状态读取失败。') }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500)
    }
    timer = setTimeout(poll, 2500)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [active, open, session?.id, session?.status, onSuccess])
  async function start() {
    setOpen(true); setPending(true); setError(''); setSession(null)
    try { setSession(await request<Session>('/settings/bilibili/login', { method: 'POST' })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '二维码生成失败。') }
    finally { setPending(false) }
  }
  return <div className="bilibili-login">
    <Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="扫码登录 B站" title="扫码登录 B站" disabled={pending} onClick={() => void start()}><QrCode size={17}/></Button>
    {open && <div className="cookie-editor">
      {session?.image && <img src={session.image} width={224} height={224} alt="B站登录二维码" style={{ display: 'block', maxWidth: '100%', objectFit: 'contain' }}/ >}
      <p role="status">{pending ? '正在生成二维码…' : session?.status === 'success' ? '登录成功，已保存 Cookie。' : session?.status === 'scanned' ? '已扫描，请在B站 App 中确认。' : session?.status === 'expired' ? '二维码已过期，请重新生成。' : '使用B站 App 扫码确认登录。'}</p>
      {error && <p role="alert">{error}</p>}
      <Button variant="quiet" type="button" className="text-button" onClick={() => { setOpen(false); setSession(null) }}>关闭</Button>
    </div>}
  </div>
}
