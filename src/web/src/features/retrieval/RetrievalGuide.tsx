import { BookOpen, ChevronDown, Lightbulb } from 'lucide-react'
import { Button } from '../../components/ui'

/**
 * RetrievalGuide is the collapsible onboarding card. It explains what the page
 * does and the two things a first-time user gets wrong: which mode works without
 * an embedding server, and that a locator is a position rather than proof.
 */
export function RetrievalGuide({ open, onToggle, onOpenSettings }: {
  open: boolean
  onToggle: () => void
  onOpenSettings: () => void
}) {
  return (
    <section className={`retrieval-guide${open ? ' is-open' : ''}`} aria-label="新手引导">
      <button type="button" className="retrieval-guide-toggle" onClick={onToggle} aria-expanded={open} aria-controls="retrieval-guide-body">
        <span className="retrieval-guide-icon" aria-hidden="true"><BookOpen size={16} strokeWidth={1.8}/></span>
        <span className="retrieval-guide-title">新手引导</span>
        <span className="retrieval-guide-teaser">{open ? '三步上手，可随时收起' : '第一次使用？点这里了解怎么用'}</span>
        <ChevronDown size={16} strokeWidth={2} className="retrieval-guide-chevron" aria-hidden="true"/>
      </button>

      {open && (
        <div className="retrieval-guide-body" id="retrieval-guide-body">
          <ol className="retrieval-steps">
            <li>
              <span className="retrieval-step-num" aria-hidden="true">1</span>
              <div>
                <strong>选一份内容</strong>
                <p>从资料库里选已保存的文章、字幕或 PDF。检索只在你本机保存的内容里进行。</p>
              </div>
            </li>
            <li>
              <span className="retrieval-step-num" aria-hidden="true">2</span>
              <div>
                <strong>问一个具体问题</strong>
                <p>问题越具体，命中的原文片段越准。答案在长文中段也能被找到，不会被头尾截断丢掉。</p>
              </div>
            </li>
            <li>
              <span className="retrieval-step-num" aria-hidden="true">3</span>
              <div>
                <strong>核对原文</strong>
                <p>每条结果都带定位符、原文与得分。高亮显示的是与问题重合的词，方便你判断为什么命中。</p>
              </div>
            </li>
          </ol>

          <div className="retrieval-guide-notes">
            <p className="retrieval-guide-note">
              <Lightbulb size={14} strokeWidth={1.8} aria-hidden="true"/>
              <span><strong>没有嵌入服务？</strong>把「检索方式」改成<strong>仅词汇</strong>，它完全在本机运行，不需要任何模型服务。混合与仅语义需要在设置里配置嵌入服务。</span>
            </p>
            <p className="retrieval-guide-note">
              <Lightbulb size={14} strokeWidth={1.8} aria-hidden="true"/>
              <span><strong>定位符不等于正确性。</strong>它只说明片段在原文的位置；结论是否成立仍需你自己核对原文。</span>
            </p>
          </div>

          <div className="retrieval-guide-actions">
            <Button variant="quiet" type="button" onClick={onOpenSettings}>配置嵌入服务与权重</Button>
            <Button variant="quiet" type="button" onClick={onToggle}>收起引导</Button>
          </div>
        </div>
      )}
    </section>
  )
}
