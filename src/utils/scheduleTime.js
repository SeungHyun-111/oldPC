export function getMinuteValue(time) {
  const [hour, minute] = String(time || '').split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0
  return hour * 60 + minute
}

export function getItemStatus(item, currentMinutes) {
  const start = getMinuteValue(item.startTime)
  let end = getMinuteValue(item.endTime)
  let current = currentMinutes

  if (end <= start) {
    end += 24 * 60
    if (current < start) current += 24 * 60
  }

  if (current >= start && current < end) return 'live'
  if (current < start) return 'next'
  return 'past'
}

export function groupByTime(items) {
  const groups = []
  const byTime = new Map()

  for (const item of items) {
    if (!byTime.has(item.timeRange)) {
      const group = {
        timeRange: item.timeRange,
        startTime: item.startTime,
        endTime: item.endTime,
        items: [],
      }
      byTime.set(item.timeRange, group)
      groups.push(group)
    }

    byTime.get(item.timeRange).items.push(item)
  }

  return groups
}

export function formatLoadedAt(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}
