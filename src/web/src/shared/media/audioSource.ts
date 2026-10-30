export function podcastAudioSource(platform: string, url: string | undefined): string | undefined {
  return url && (platform === 'rss' || platform === 'xiaoyuzhou')
    ? `/api/media/audio?url=${encodeURIComponent(url)}`
    : url
}
