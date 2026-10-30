import { Button, Checkbox, Input, Select } from '../../components/ui'
import { BookOpen, Check, ChevronDown, CirclePlay, Headphones, LoaderCircle, LogIn, MessagesSquare, Music2, Trash2, TvMinimal, Upload } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { request } from '../../shared/api/client'
import { listOrEmpty } from '../../shared/api/list'
import { openDesktopPlatformLogin, useCapabilities, type PlatformWebView } from '../../shared/api/desktop'
import './settings.css'
import './accounts-settings.css'
import { BilibiliLogin } from './BilibiliLogin'
import { XiaoyuzhouLogin } from './XiaoyuzhouLogin'
import { LinuxdoSession } from './LinuxdoSession'
import { LinuxdoLogin } from './LinuxdoLogin'
import { showsManualLogin, supportsInAppLogin, usesAdvancedManualLogin } from './platformLoginSettings'
import { SettingsStatus } from './ui/SettingsRow'

interface CookieState { platform: string; configured: boolean; source: string; updatedAt: number; username?: string; expiresAt?: number }
const platforms = [
  { id: 'youtube', label: 'YouTube', description: '推荐、字幕与下载', Icon: CirclePlay },
  { id: 'bilibili', label: '哔哩哔哩', description: '视频、字幕与下载', Icon: TvMinimal },
  { id: 'xiaohongshu', label: '小红书', description: '图文与视频', Icon: BookOpen },
  { id: 'xiaoyuzhou', label: '小宇宙', description: '播客与节目说明', Icon: Headphones },
  { id: 'linuxdo', label: 'Linux.do', description: '热门话题与原文', Icon: MessagesSquare },
  { id: 'douyin', label: '抖音', description: '视频读取与下载', Icon: Music2 },
]
export function PlatformCookies({ onChanged, active = true, initialPlatform }: { onChanged: (platform: string) => void; active?: boolean; initialPlatform?: string }) {
  const capabilities = useCapabilities()
  const [states, setStates] = useState<CookieState[] | null>(null)
  // Keep the index collapsed by default. A platform only opens when the user
  // chooses it, or when the route explicitly targets that platform.
  const [selectedPlatform, setSelectedPlatform] = useState(initialPlatform && platforms.some(platform => platform.id === initialPlatform) ? initialPlatform : '')
  const [error, setError] = useState('')
  const read = useRef<AbortController | null>(null)
  const panelId = useId()
  useEffect(() => {
    if (initialPlatform && platforms.some(platform => platform.id === initialPlatform)) setSelectedPlatform(initialPlatform)
  }, [initialPlatform])
  async function reload() {
    read.current?.abort()
    const controller = new AbortController(); read.current = controller; setError('')
    try {
      const result = await request<{ platforms: CookieState[] }>('/settings/cookies', { signal: controller.signal })
      if (!controller.signal.aborted) setStates(listOrEmpty(result.platforms))
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '登录配置暂不可用。')
    }
  }
  useEffect(() => { if (active) void reload(); return () => read.current?.abort() }, [active])
  return <div className="accounts-workspace">
    {error && <p className="settings-feedback" role="alert">{error}<Button variant="quiet" onClick={() => void reload()}>重新读取</Button></p>}
    <div className="accounts-platform-list" role="list" aria-label="内容来源">
      {platforms.map(platform => {
        const state = states?.find(value => value.platform === platform.id)
        const selected = selectedPlatform === platform.id
        const expired = Boolean(state?.configured && state.expiresAt && state.expiresAt * 1000 < Date.now())
        return <div className="accounts-platform-entry" role="listitem" key={platform.id} data-setting={`account-${platform.id}`}>
          <div className="accounts-platform-row">
            <span className={`discovery-platform-mark discovery-platform-${platform.id}`}>{platform.id === 'youtube' ? 'YT' : platform.id === 'bilibili' ? 'B' : platform.id === 'linuxdo' ? 'L' : platform.label.slice(0,1)}</span>
            <span className="accounts-platform-row-copy"><strong>{platform.label}<SettingsStatus tone={expired ? 'warning' : state?.configured ? 'positive' : 'neutral'}>{!states ? '读取中' : expired ? '需重新登录' : state?.configured ? '已连接' : '未连接'}</SettingsStatus></strong><small>{expired ? '登录已过期，请重新连接' : platform.description}</small></span>
            <Button variant="secondary" type="button" aria-label={`${state?.configured ? '管理' : '连接'}${platform.label}`} aria-expanded={selected} aria-controls={`${panelId}-${platform.id}`} onClick={() => setSelectedPlatform(selected ? '' : platform.id)}>
              {expired ? '重新登录' : state?.configured ? '管理' : '连接'}<ChevronDown className={selected ? 'chevron-open' : ''} size={14} aria-hidden="true"/>
            </Button>
          </div>
          <section id={`${panelId}-${platform.id}`} className="accounts-platform-panel" aria-label={`${platform.label}登录设置`} hidden={!selected}>
            <PlatformEditor platform={platform} states={states} capabilities={capabilities} active={active && selected} onChanged={onChanged} reload={reload} onStatesChanged={setStates}/>
          </section>
        </div>
      })}
    </div>
    <p className="field-hint">哪些平台参与推荐，在 <a href="/tools#discovery">发现与推荐</a> 中设置。</p>
    <details className="settings-details accounts-login-help"><summary>服务端登录与隐私说明</summary><p>登录信息只保存在运行 Tangentry 的服务器上，敏感值不会在页面回显。服务端没有应用内浏览器，请在浏览器登录原站后导入对应平台 Cookie。</p><p>小宇宙可导入访问令牌。Google 登录受限时，请使用浏览器 Cookie 或 OAuth。</p></details>
  </div>
}

// Keep every platform mounted so a switch preserves drafts, QR sessions and
// confirmations. Async results and manual credentials belong to this editor.
function PlatformEditor({ platform, states, capabilities, active, onChanged, reload, onStatesChanged }: {
  platform: typeof platforms[number]
  states: CookieState[] | null
  capabilities: ReturnType<typeof useCapabilities>
  active: boolean
  onChanged: (platform: string) => void
  reload: () => Promise<void>
  onStatesChanged: (states: CookieState[]) => void
}) {
  const [editing, setEditing] = useState('')
  const [format, setFormat] = useState('header')
  const [value, setValue] = useState('')
  const [fileName, setFileName] = useState('')
  const [show, setShow] = useState(false)
  const [clearing, setClearing] = useState('')
  const [pending, setPending] = useState(false)
  const [webViewPending, setWebViewPending] = useState<PlatformWebView | ''>('')
  const [webViewReady, setWebViewReady] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const write = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const loginPoll = useRef<AbortController | null>(null)
  const webViewBaseline = useRef<{ platform: PlatformWebView; configured: boolean; updatedAt: number } | null>(null)
  const webViewAttempts = useRef(0)
  const callbacks = useRef({ reload, onChanged }); callbacks.current = { reload, onChanged }
  useEffect(() => () => {
    write.current?.abort()
    loginPoll.current?.abort()
    generation.current++
  }, [])
  useEffect(() => {
    if (!active || !webViewPending || !webViewReady) return
    const controller = new AbortController()
    loginPoll.current = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    const { platform, configured, updatedAt } = webViewBaseline.current ?? { platform: webViewPending, configured: false, updatedAt: 0 }
    const refresh = async () => {
      if (controller.signal.aborted || webViewAttempts.current >= 120) {
        if (!controller.signal.aborted) { setWebViewPending(''); setWebViewReady(false) }
        return
      }
      webViewAttempts.current++
      try {
        const result = await request<{ platforms: CookieState[] }>('/settings/cookies', { signal: controller.signal })
        if (controller.signal.aborted) return
        const state = listOrEmpty(result.platforms).find(value => value.platform === platform)
        if (state?.configured && (!configured || state.updatedAt > updatedAt)) {
          setWebViewPending(''); setWebViewReady(false)
          void callbacks.current.reload()
          callbacks.current.onChanged(platform)
          return
        }
      } catch { /* The platform window may still be open. */ }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 1500)
    }
    timer = setTimeout(() => void refresh(), 1500)
    return () => {
      controller.abort()
      clearTimeout(timer)
      if (loginPoll.current === controller) loginPoll.current = null
    }
  }, [active, webViewPending, webViewReady])
  function reset() { generation.current++; setEditing(''); setClearing(''); setValue(''); setFileName(''); setShow(false) }
  async function mutate(platform: string, remove = false) {
    if (!states || write.current) return
    const controller = new AbortController(); write.current = controller; setPending(true); setError(''); setNotice('')
    try {
      const result = await request<{ platforms: CookieState[] }>('/settings/cookies/' + platform, {
        method: remove ? 'DELETE' : 'PUT', ...(remove ? {} : { body: JSON.stringify({ format, value }) }), signal: controller.signal,
      })
      if (!controller.signal.aborted) {
        onStatesChanged(listOrEmpty(result.platforms)); reset(); setNotice(remove ? '已清除，此平台将使用匿名访问。' : '已保存，下次请求生效。账号是否有效需在获取内容时确认。'); onChanged(platform)
      }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '保存失败，请重试。') }
    finally { if (write.current === controller) write.current = null; if (!controller.signal.aborted) setPending(false) }
  }
  async function openWebViewLogin(platform: PlatformWebView) {
    if (webViewPending) return
    const before = states?.find(state => state.platform === platform)
    webViewBaseline.current = { platform, configured: Boolean(before?.configured), updatedAt: before?.updatedAt ?? 0 }
    webViewAttempts.current = 0
    setWebViewReady(false)
    setWebViewPending(platform); setError(''); setNotice('')
    try {
      await openDesktopPlatformLogin(platform)
      const labels: Record<PlatformWebView, string> = { linuxdo: 'Linux.do', douyin: '抖音', bilibili: 'B站', xiaohongshu: '小红书', youtube: 'YouTube' }
      setNotice(`已打开${labels[platform]}登录窗口。完成登录后，设置状态会自动更新。`)
      setWebViewReady(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开应用内登录窗口。')
      setWebViewPending('')
      setWebViewReady(false)
    }
  }
  async function importFile(file?: File) {
    const current = ++generation.current
    if (!file) return
    if (file.size > 256 * 1024) { setError('Cookie 文件最大 256 KB。'); return }
    try {
      const text = await file.text()
      if (current !== generation.current) return
      setFormat('netscape'); setValue(text); setFileName(file.name); setShow(false); setError(''); setEditing(platform.id)
    } catch { if (current === generation.current) setError('文件无法读取，请重试。') }
  }
  const content = (() => {
      const state = states?.find(value => value.platform === platform.id), open = editing === platform.id
      const statusLabel = platform.id === 'xiaoyuzhou'
        ? state?.source === 'token' ? '已保存访问令牌' : state?.configured ? '旧 Cookie，请更换令牌' : '未配置令牌'
        : !state ? '状态未知' : state.configured ? state.source === 'environment' ? '使用启动配置' : state.username ? `已连接 · ${state.username}` : state.source === 'authorization' ? '已授权登录' : '已连接' : '未连接'
      const identity = <div className="accounts-account-meta"><span>{statusLabel}</span>{state?.configured && state.expiresAt && <span>到期时间：{new Date(state.expiresAt * 1000).toLocaleString('zh-CN')}</span>}</div>
      const browserLogin = supportsInAppLogin(platform.id)
      const showManualEditor = showsManualLogin(platform.id, capabilities.platformWebViewLogin)
      const advancedManual = usesAdvancedManualLogin(platform.id, capabilities.platformWebViewLogin)
      const clearButton = state?.configured && (browserLogin
        ? <Button type="button" variant="quiet" className="text-button cookie-clear" aria-label={`断开${platform.label}登录`} title={`断开${platform.label}登录`} disabled={pending || Boolean(webViewPending)} onClick={() => { setClearing(platform.id); setError(''); setNotice('') }}><Trash2 size={14}/><span>断开</span></Button>
        : <Button type="button" variant="quiet" iconOnly className="icon-button cookie-clear" aria-label="清除" title={`清除${platform.label}登录信息`} disabled={pending} onClick={() => { setClearing(platform.id); setError(''); setNotice('') }}><Trash2 size={15}/></Button>)
      if (platform.id === 'xiaoyuzhou') return <div className="cookie-platform" key={platform.id} data-platform={platform.id}>
        <div className="cookie-account-row">{identity}<div className="cookie-summary"><XiaoyuzhouLogin active={active} onSuccess={() => { void reload(); onChanged('xiaoyuzhou') }}/>{clearButton}</div></div>
        {!capabilities.platformWebViewLogin && <details className="settings-details cookie-platform-help"><summary>高级：配置小宇宙 Cookie 或访问令牌</summary><p>服务端没有小宇宙网页端登录入口，请使用 App 扫码；如需手动配置，可粘贴 App 访问令牌或含 x-jike-access-token 的 Cookie。</p><Button type="button" variant="quiet" className="text-button" disabled={!states || pending} aria-expanded={open} onClick={() => { reset(); setError(''); if (!open) { setEditing(platform.id); setFormat('token') } }}>{open ? '收起手动配置' : '配置令牌'}<ChevronDown size={14} aria-hidden="true" className={open ? 'chevron-open' : ''}/></Button></details>}
        {open && !capabilities.platformWebViewLogin && <form className="cookie-editor" onSubmit={event => { event.preventDefault(); void mutate(platform.id) }}><label className="cookie-value-label">小宇宙 Cookie 或 App 访问令牌<Input className="settings-input" type="password" autoComplete="off" spellCheck={false} maxLength={256 * 1024} value={value} disabled={pending} placeholder="x-jike-access-token=…; x-jike-refresh-token=…" onChange={event => setValue(event.target.value)}/></label><div className="cookie-editor-actions"><Button type="button" variant="secondary" onClick={reset} disabled={pending}>取消</Button><Button variant="primary" disabled={pending || !value.trim()}>保存登录信息</Button></div><p className="field-hint">自动提取 access 和 refresh token，忽略其他 Cookie。refresh token 私密保存，暂不自动续期；访问令牌过期后请重新导入。</p></form>}
        {clearing === platform.id && <div className="cookie-confirm"><p>清除小宇宙登录信息？</p><p>已保存内容不会删除。</p><div><Button type="button" variant="secondary" disabled={pending} onClick={() => setClearing('')}>保留</Button><Button type="button" variant="primary" disabled={pending} onClick={() => void mutate(platform.id, true)}>确认清除</Button></div></div>}
      </div>
      return <div className="cookie-platform" key={platform.id} data-platform={platform.id}>
        <div className="cookie-account-row">{identity}<div className="cookie-summary">{platform.id === 'bilibili' && <BilibiliLogin active={active} onSuccess={() => { void reload(); onChanged('bilibili') }}/>} {showManualEditor && !advancedManual && <Button variant="quiet" className="text-button" disabled={!states || pending} aria-expanded={open} aria-controls={open ? 'cookie-editor-' + platform.id : undefined} onClick={() => { reset(); setError(''); setNotice(''); if (!open) { setEditing(platform.id); setFormat('header') } }}>{open ? '收起' : state?.configured ? '更换' : '配置'}<ChevronDown size={14} aria-hidden="true" className={open ? 'chevron-open' : ''} /></Button>}{clearButton}</div></div>
        {browserLogin && capabilities.platformWebViewLogin && <div className="platform-webview-actions">
          <Button type="button" variant="quiet" className="text-button" disabled={Boolean(webViewPending) || pending} onClick={() => void openWebViewLogin(platform.id as PlatformWebView)}>
            {webViewPending === platform.id ? <LoaderCircle size={14} className="spin" aria-hidden="true"/> : <LogIn size={14} aria-hidden="true"/>}
            {state?.configured ? '重新登录' : '在应用内登录'}
          </Button>
        </div>}
        {platform.id === 'youtube' && capabilities.platformWebViewLogin && <p className="field-hint cookie-platform-note">Google 可能拒绝嵌入式浏览器；若页面提示“此浏览器或应用可能不安全”，请改用浏览器 Cookie 或 OAuth，不会绕过该安全检查。</p>}
        {platform.id === 'xiaohongshu' && capabilities.platformWebViewLogin && <p className="field-hint cookie-platform-note">小红书网页端使用扫码登录，完成后点击登录窗口中的“完成登录”。</p>}
        {platform.id === 'xiaoyuzhou' && <p className="field-hint cookie-platform-note">小宇宙目前没有稳定可用的网页端登录入口，请使用 App 扫码或在服务端高级设置中导入令牌。</p>}
        {advancedManual && <div className="account-import-actions"><Button type="button" variant="secondary" disabled={!states || pending} aria-expanded={open} onClick={() => { reset(); setError(''); setNotice(''); if (!open) { setEditing(platform.id); setFormat('header') } }}>{open ? '收起' : '粘贴 Cookie'}</Button><label className="cookie-import"><Upload size={14}/>导入 Cookie 文件<input aria-label={`导入 ${platform.label} Cookie 文件`} type="file" accept=".txt,text/plain" disabled={pending} onChange={event => { void importFile(event.target.files?.[0]); event.target.value = '' }}/></label></div>}
        {platform.id === 'douyin' && <p className="field-hint cookie-platform-note">{capabilities.platformWebViewLogin ? '应用内登录会使用同一浏览器会话处理推荐请求。' : '网页推荐可能受限；服务端版请手动导入浏览器 Cookie。'}</p>}
        {platform.id === 'linuxdo' && <div className="linuxdo-actions"><LinuxdoLogin active={active} onSuccess={() => { void reload(); onChanged('linuxdo') }} onImportCookie={() => { reset(); setError(''); setNotice(''); setEditing('linuxdo'); setFormat('header') }}/><LinuxdoSession configured={state?.configured ?? false} updatedAt={state?.updatedAt ?? 0}/></div>}
        {platform.id === 'douyin' && !capabilities.platformWebViewLogin && <details className="settings-details cookie-platform-help">
          <summary>从浏览器复制抖音 Cookie</summary>
          <ol>
            <li>在电脑浏览器打开 douyin.com 并登录。</li>
            <li>打开开发者工具的「网络」，刷新页面。</li>
            <li>选中 douyin.com 页面请求，在「请求标头」中复制 Cookie 的完整值。</li>
            <li>回到这里选择「配置」，粘贴到「Cookie 请求头」并保存。</li>
          </ol>
          <p>Cookie 等同登录凭证，只复制 douyin.com 域的值并保存在运行 Tangentry 的服务器上。抖音可能要求页面验证或动态签名，手动 Cookie 不保证推荐接口可用。</p>
        </details>}
        {open && showManualEditor && <form id={'cookie-editor-' + platform.id} className="cookie-editor" onInput={event => {
          const target = event.target
          if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'password')) {
            generation.current++
            setFileName('')
          }
        }} onSubmit={event => { event.preventDefault(); void mutate(platform.id) }}>
          <div className="cookie-format"><label>输入格式<Select value={format} disabled={pending} onChange={event => { generation.current++; setFormat(event.target.value); setValue(''); setFileName(''); setShow(false) }}><option value="header">Cookie 请求头</option><option value="netscape">Netscape cookies.txt</option></Select></label>{!advancedManual && <label className="cookie-import"><Upload size={14} aria-hidden="true" />导入文件<input aria-label={'导入 ' + platform.label + ' Cookie 文件'} type="file" accept=".txt,text/plain" disabled={pending} onChange={event => { void importFile(event.target.files?.[0]); event.target.value = '' }} /></label>}</div>
          {format === 'header' ? <label className="cookie-value-label">{platform.label} Cookie<Input className="settings-input" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={value} maxLength={256 * 1024} disabled={pending} placeholder="name=value; name2=value2" onChange={event => setValue(event.target.value)} /></label> : <label className="cookie-value-label">{platform.label} cookies.txt{show || !fileName ? <textarea aria-label={platform.label + ' cookies.txt'} className="settings-input" rows={5} autoComplete="off" spellCheck={false} value={value} disabled={pending} maxLength={256 * 1024} placeholder="粘贴 Netscape 格式内容，或导入 cookies.txt 文件" onChange={event => setValue(event.target.value)} /> : <span className="cookie-file-name">{fileName} · 已读取，等待保存</span>}</label>}
          <div className="cookie-editor-actions"><label className="cookie-visibility"><Checkbox checked={show} disabled={pending} onChange={event => setShow(event.target.checked)} />显示输入内容</label><Button variant="secondary" type="button" disabled={pending} onClick={reset}>取消</Button><Button variant="primary" disabled={pending || !value.trim()}>{pending && <LoaderCircle className="spin" size={14} />}{pending ? '正在保存' : '保存 Cookie'}</Button></div>
          <p className="field-hint">仅接受 {platform.id === 'linuxdo' ? 'linux.do' : platform.id === 'bilibili' ? 'bilibili.com' : platform.id === 'youtube' ? 'youtube.com 与 Google 登录域' : platform.id === 'douyin' ? 'douyin.com' : platform.id === 'xiaohongshu' ? 'xiaohongshu.com' : 'xiaoyuzhoufm.com'} 域的 Cookie。保存到服务机器的私有文件，不回显已保存的值。</p>
          {platform.id === 'linuxdo' && <details className="settings-details" open><summary>获取 Cookie</summary><ol><li>在电脑浏览器登录 linux.do。</li><li>打开开发者工具的「网络」，刷新页面。</li><li>选中 linux.do 请求，展开「请求标头」。</li><li>复制 Cookie 的值，粘贴后保存。</li></ol><p>不需要填写密码或 discourse:// 地址。</p><p>Cookie 等同登录凭证，请勿分享。保存后可检查登录。</p></details>}
        </form>}
        {clearing === platform.id && <div className="cookie-confirm"><p>清除 {platform.label} 登录信息，改为匿名访问？已保存内容不会删除。</p><div><Button variant="secondary" disabled={pending} onClick={() => setClearing('')}>保留</Button><Button variant="primary" disabled={pending} onClick={() => void mutate(platform.id, true)}>确认清除</Button></div></div>}
      </div>
    })()
  return <>
    {error && <p className="settings-feedback" role="alert">{error}</p>}
    {notice && <p className="settings-feedback" role="status"><Check size={15} aria-hidden="true"/>{notice}</p>}
    {content}
  </>
}
