import type { SubscriptionGroup, SubscriptionSource } from '../../shared/api/types'
import { sourceLabel } from './sourcePresentation'

export type SourceSection = {
  /** Group id, '' for ungrouped and '__unresolved' for memberships whose group has not been read yet. */
  id: string
  name: string
  kind: 'group' | 'ungrouped' | 'unresolved'
  group?: SubscriptionGroup
  /** Every source in the section, regardless of the current keyword. */
  members: SubscriptionSource[]
  /** Members that match the keyword and the extra predicate. */
  visible: SubscriptionSource[]
}

export const unresolvedSectionID = '__unresolved'

export function sourceMatches(source: SubscriptionSource, keyword: string, groupName = '') {
  const value = keyword.trim().toLocaleLowerCase()
  return !value || `${source.name} ${sourceLabel(source)} ${groupName}`.toLocaleLowerCase().includes(value)
}

/**
 * Arrange sources the way both the reading navigator and the source manager
 * show them: named groups in their saved order, then ungrouped sources, then
 * sources whose group is not known yet. Empty ungrouped/unresolved sections are
 * dropped; empty named groups stay so they can still be managed.
 */
export function sourceSections(sources: SubscriptionSource[], groups: SubscriptionGroup[], keyword = '', include: (source: SubscriptionSource) => boolean = () => true): SourceSection[] {
  const known = new Set(groups.map(group => group.id))
  const sections: SourceSection[] = groups.map(group => {
    const members = sources.filter(source => source.groupId === group.id)
    return { id: group.id, name: group.name, kind: 'group', group, members, visible: members.filter(source => include(source) && sourceMatches(source, keyword, group.name)) }
  })
  const ungrouped = sources.filter(source => !source.groupId)
  if (ungrouped.length) sections.push({ id: '', name: '未分组', kind: 'ungrouped', members: ungrouped, visible: ungrouped.filter(source => include(source) && sourceMatches(source, keyword)) })
  const unresolved = sources.filter(source => source.groupId && !known.has(source.groupId))
  if (unresolved.length) sections.push({ id: unresolvedSectionID, name: '分组待读取', kind: 'unresolved', members: unresolved, visible: unresolved.filter(source => include(source) && sourceMatches(source, keyword)) })
  return sections
}

/** Visible source ids in display order, used for shift-click ranges and keyboard movement. */
export const visibleSourceIDs = (sections: SourceSection[]) => sections.flatMap(section => section.visible.map(source => source.id))
