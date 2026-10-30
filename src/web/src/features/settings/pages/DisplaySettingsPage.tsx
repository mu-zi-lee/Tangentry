import type { CSSProperties } from 'react'
import { Button } from '../../../components/ui'
import type { ContentItem } from '../../../shared/api/types'
import { ModernGalleryCard } from '../../../shared/ui/ModernGalleryCard'
import { cardWidthRange, defaultCardAppearance, useCardAppearance, type CardAppearance, type CardCorners } from '../useCardAppearance'
import { readingFontStacks, readingLineHeights, readingSizes, useFontSettings, type ReadingFont, type ReadingLineHeight } from '../useFontSettings'
import { SettingsActionPage } from '../ui/SettingsActionPage'

const previewItems: ContentItem[] = [
  { id: 'preview:video', kind: 'video', platform: 'youtube', platformId: '', title: '把一小时的长视频拆成可检索的笔记', description: '从字幕开始，按话题切分段落，再用摘要串起时间线。', author: '内容研究室', authorId: '', url: '', thumbnailUrl: '', durationSeconds: 2538, publishedAt: 0 },
  { id: 'preview:audio', kind: 'audio', platform: 'xiaoyuzhou', platformId: '', title: '独立开发者的第一年：做对了什么', description: '聊定价、渠道，以及没有团队时如何保护节奏。', author: '小宇宙', authorId: '', url: '', thumbnailUrl: '', durationSeconds: 4120, publishedAt: 0 },
  { id: 'preview:attention', kind: 'video', platform: 'bilibili', platformId: '', title: '一小时读懂注意力机制', description: '用可视化把 Q、K、V 的计算过程一步步拆开。', author: '深度学习周刊', authorId: '', url: '', thumbnailUrl: '', durationSeconds: 3482, publishedAt: 0 },
  { id: 'preview:topic', kind: 'article', platform: 'linuxdo', platformId: '', title: '本地部署 Whisper 的踩坑记录', description: '显存、量化与批大小的取舍，附可复现命令。', author: 'Linux.do', authorId: '', url: '', thumbnailUrl: '', durationSeconds: 0, publishedAt: 0 },
]

const cornerOptions: readonly (readonly [CardCorners, string])[] = [['square', '小'], ['soft', '中'], ['round', '大']]
const fontOptions: readonly (readonly [ReadingFont, string])[] = [['serif', '衬线'], ['noto', '无衬线'], ['system', '系统']]
const lineHeightOptions: readonly (readonly [ReadingLineHeight, string])[] = [['compact', '紧凑'], ['comfortable', '标准'], ['relaxed', '宽松']]
const noop = () => {}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  return <div className="settings-appearance-row" data-setting={{ 圆角: 'card-corners', 正文字体: 'reading-font', 行高: 'reading-height' }[label]}><div><strong>{label}</strong></div><div className="settings-choice-row" role="group" aria-label={label}>{options.map(([option, text]) => <button key={option} type="button" className={value === option ? 'active' : ''} aria-pressed={value === option} onClick={() => onChange(option)}>{text}</button>)}</div></div>
}

export function DisplaySettingsPage() {
  const cards = useCardAppearance()
  const fonts = useFontSettings()
  const cardsAreDefault = (Object.keys(defaultCardAppearance) as (keyof CardAppearance)[]).every(key => cards.appearance[key] === defaultCardAppearance[key])
  const fontSize = fonts.settings.fontSize ?? Number.parseInt(readingSizes[fonts.settings.size], 10)
  const previewStyle = { '--settings-preview-card-width': `${Math.round(cards.appearance.width * .6)}px`, '--card-cover-height': '104px', '--font-reading': readingFontStacks[fonts.settings.reading], '--font-reading-size': `${fontSize}px`, '--font-reading-line-height': readingLineHeights[fonts.settings.lineHeight] } as CSSProperties

  return <SettingsActionPage className="settings-action-display" title="外观" description="调整内容卡片和阅读排版，右侧实时预览，改动立即生效。">
    <div className="settings-display-layout">
      <div className="settings-display-controls">
        <section className="settings-appearance-section" aria-labelledby="appearance-cards-title">
          <header><h2 id="appearance-cards-title">内容卡片</h2><Button variant="quiet" type="button" className="text-button" disabled={cardsAreDefault} onClick={cards.reset}>恢复默认</Button></header>
          <div className="settings-appearance-card">
            <label className="settings-appearance-row" data-setting="card-width"><span><strong>卡片宽度</strong><small>越窄每行显示越多</small></span><span className="settings-range-control"><input aria-label="卡片宽度" type="range" min={cardWidthRange.min} max={cardWidthRange.max} step={cardWidthRange.step} value={cards.appearance.width} onChange={event => cards.change({ width: event.currentTarget.valueAsNumber })}/><output>{cards.appearance.width} px</output></span></label>
            <Segmented label="圆角" value={cards.appearance.corners} options={cornerOptions} onChange={corners => cards.change({ corners })}/>
            <label className="settings-appearance-row" data-setting="card-excerpt"><span><strong>显示摘要</strong><small>在标题下展示两到三行简介</small></span><input type="checkbox" className="settings-switch" role="switch" checked={cards.appearance.excerpt} onChange={event => cards.change({ excerpt: event.currentTarget.checked })}/></label>
          </div>
        </section>
        <section className="settings-appearance-section" aria-labelledby="appearance-reading-title">
          <header><h2 id="appearance-reading-title">阅读</h2><p>用于字幕、笔记与文章正文</p></header>
          <div className="settings-appearance-card">
            <Segmented label="正文字体" value={fonts.settings.reading} options={fontOptions} onChange={reading => fonts.change({ reading })}/>
            <label className="settings-appearance-row" data-setting="reading-size"><span><strong>字号</strong></span><span className="settings-range-control"><input aria-label="阅读字号" type="range" min={14} max={22} step={1} value={fontSize} onChange={event => fonts.change({ fontSize: event.currentTarget.valueAsNumber })}/><output>{fontSize} px</output></span></label>
            <Segmented label="行高" value={fonts.settings.lineHeight} options={lineHeightOptions} onChange={lineHeight => fonts.change({ lineHeight })}/>
          </div>
        </section>
      </div>
      <aside className="settings-display-previews" aria-label="外观实时预览" style={previewStyle}>
        <div className="settings-preview-label"><span><i/>实时预览</span><small>按 60% 缩放</small></div>
        <div className="settings-card-preview-grid" inert>{previewItems.map(item => <div className="settings-card-preview-item" key={item.id}><ModernGalleryCard item={item} saved={false} pending={false} onRead={noop} onSave={noop}/></div>)}</div>
        <article className="settings-reading-preview"><small>阅读预览</small><h3>把长视频拆成可检索的笔记</h3><p>先从字幕开始，按话题切分段落，为每段写一句摘要，再把摘要串成时间线。这样回看时，你可以直接跳到真正需要的那几分钟。</p></article>
      </aside>
    </div>
  </SettingsActionPage>
}
