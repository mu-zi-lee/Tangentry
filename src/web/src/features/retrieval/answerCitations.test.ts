import { describe, expect, it } from 'vitest'
import { attributeAnswer, hasCitations, parseCitationTags, rankPassagesForParagraph, splitAnswerBlocks } from './answerCitations'
import type { WorkbenchPassage } from './workbench'

function passage(over: Partial<WorkbenchPassage> = {}): WorkbenchPassage {
  return {
    passageId: 'pdf:abc#pdf:abc:61:s0-s3:0-109',
    contentId: 'pdf:abc', source: 'pdf', locator: 'pdf:abc:61:s0-s3',
    sentenceStart: 0, sentenceEnd: 3, startRune: 0, endRune: 109,
    textSha256: 'h', sourceVersion: 'v', cueIds: [],
    text: '第二十五條香港居民在法律面前一律平等。',
    score: 0.9, lexicalScore: 0.8, cosineScore: 0.85,
    ...over,
  }
}

const second = passage({
  passageId: 'pdf:abc#pdf:abc:62:s1-s2:200-260',
  locator: 'pdf:abc:62:s1-s2',
  text: '香港特別行政區永久性居民依法享有選舉權和被選舉權。',
  startRune: 200, endRune: 260,
})

describe('splitAnswerBlocks', () => {
  it('splits on blank lines and drops empty blocks', () => {
    expect(splitAnswerBlocks('第一段。\n\n第二段。\n\n\n\n第三段。')).toEqual(['第一段。', '第二段。', '第三段。'])
  })

  it('keeps a list together when its lines are not blank-separated', () => {
    expect(splitAnswerBlocks('包括：\n1. 甲\n2. 乙')).toEqual(['包括：\n1. 甲\n2. 乙'])
  })

  it('handles an answer with no blank lines', () => {
    expect(splitAnswerBlocks('只有一段')).toEqual(['只有一段'])
  })
})

describe('rankPassagesForParagraph', () => {
  it('puts the passage whose wording the paragraph reuses first', () => {
    const ranked = rankPassagesForParagraph('居民的權利在法律面前一律平等', [second, passage()])
    expect(ranked[0].passage.locator).toBe('pdf:abc:61:s0-s3')
  })

  it('gives an exact passage-id mention the top score', () => {
    const ranked = rankPassagesForParagraph(`見 passage id: "${second.passageId}"`, [passage(), second])
    expect(ranked[0].passage.locator).toBe('pdf:abc:62:s1-s2')
    expect(ranked[0].score).toBe(1)
  })

  it('scores an unrelated paragraph low for every passage', () => {
    const ranked = rankPassagesForParagraph('火星大氣的甲烷季節性波動週期', [passage(), second])
    expect(ranked.every(entry => entry.score < 0.16)).toBe(true)
  })
})

describe('parseCitationTags', () => {
  it('removes the tags and returns their ids in order', () => {
    expect(parseCitationTags('Right to vote. [p:a][p:b]')).toEqual({ text: 'Right to vote.', ids: ['a', 'b'] })
  })

  it('keeps a block without tags untouched', () => {
    expect(parseCitationTags('No tags here.')).toEqual({ text: 'No tags here.', ids: [] })
  })

  it('does not leave a space before the punctuation that followed the tag', () => {
    expect(parseCitationTags('Article 26 of the Basic Law . [p:a]').text).toBe('Article 26 of the Basic Law.')
  })

  it('keeps a [p:none] marker as a declared empty source', () => {
    expect(parseCitationTags('General remark. [p:none]')).toEqual({ text: 'General remark.', ids: ['none'] })
  })
})

describe('attributeAnswer with model tags', () => {
  it('uses the declared id even when the wording does not overlap (cross-language)', () => {
    const blocks = attributeAnswer('The right to vote and stand for election. [p:' + passage().passageId + ']', [passage()])
    expect(blocks[0].citations).toHaveLength(1)
    expect(blocks[0].citations[0].locator).toBe('pdf:abc:61:s0-s3')
    expect(blocks[0].text).toBe('The right to vote and stand for election.')
  })

  it('drops an id that was not among the passages it received', () => {
    const blocks = attributeAnswer('Invented source. [p:pdf:zzz#pdf:zzz:999:s0-s1:0-10]', [passage()])
    expect(blocks[0].citations).toEqual([])
    expect(blocks[0].text).toBe('Invented source.')
  })

  it('treats [p:none] as no source and does not fall back to the wording', () => {
    const blocks = attributeAnswer('居民在法律面前一律平等。[p:none]', [passage()])
    expect(blocks[0].citations).toEqual([])
  })

  it('keeps one citation per passage even when the model repeats it', () => {
    const id = passage().passageId
    const blocks = attributeAnswer(`Right. [p:${id}][p:${id}]`, [passage()])
    expect(blocks[0].citations).toHaveLength(1)
  })
})

describe('attributeAnswer', () => {
  it('attaches citations per block, not to the whole answer', () => {
    const answer = '第二十五條規定居民在法律面前一律平等。\n\n永久性居民依法享有選舉權。'
    const blocks = attributeAnswer(answer, [passage(), second])
    expect(blocks).toHaveLength(2)
    expect(blocks[0].citations[0]?.locator).toBe('pdf:abc:61:s0-s3')
    expect(blocks[1].citations[0]?.locator).toBe('pdf:abc:62:s1-s2')
  })

  it('leaves a paragraph uncited when nothing overlaps', () => {
    const blocks = attributeAnswer('這一段與原文無關。\n\n居民在法律面前一律平等。', [passage()])
    expect(blocks[0].citations).toEqual([])
    expect(blocks[1].citations).toHaveLength(1)
  })

  it('never invents a passage that was not retrieved', () => {
    const blocks = attributeAnswer('第 99 頁寫著居民平等。', [passage()])
    for (const block of blocks) {
      for (const citation of block.citations) {
        expect([passage(), second].some(p => p.passageId === citation.passageId)).toBe(true)
      }
    }
  })

  it('caps the number of citations per paragraph', () => {
    const blocks = attributeAnswer('居民在法律面前一律平等，永久性居民享有選舉權。', [passage(), second], { max: 1 })
    expect(blocks[0].citations).toHaveLength(1)
  })

  it('reports whether anything was cited at all', () => {
    expect(hasCitations(attributeAnswer('居民在法律面前一律平等。', [passage()]))).toBe(true)
    expect(hasCitations(attributeAnswer('完全無關的內容。', [passage()]))).toBe(false)
  })

  it('handles an empty answer', () => {
    expect(attributeAnswer('', [passage()])).toEqual([])
  })
})