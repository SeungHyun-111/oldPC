import { useEffect, useMemo, useRef, useState } from 'react'
import { formatLoadedAt, getItemStatus, getMinuteValue, groupByTime } from '../utils/scheduleTime'

const seoulClockFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function getCurrentClock() {
  const parts = Object.fromEntries(seoulClockFormatter.formatToParts(new Date()).map((part) => [part.type, part.value]))
  const hour = String(Number(parts.hour) % 24).padStart(2, '0')
  return `${hour}:${parts.minute}`
}

export function ScheduleStrip({ label, schedule, displayFilter }) {
  const railRef = useRef(null)
  const [now, setNow] = useState(getCurrentClock)
  const debugSchedule = label === '신세계쇼핑'
  const currentMinutes = getMinuteValue(now)
  const displayItems = useMemo(
    () => (displayFilter ? schedule.items.filter(displayFilter) : schedule.items),
    [displayFilter, schedule.items],
  )
  const groups = useMemo(() => groupByTime(displayItems), [displayItems])
  const groupStatuses = useMemo(() => groups.map((group) => getItemStatus(group, currentMinutes)), [currentMinutes, groups])
  const targetIndex = useMemo(() => {
    const liveIndex = groupStatuses.findIndex((status) => status === 'live')
    if (liveIndex >= 0) return liveIndex

    const nextIndex = groupStatuses.findIndex((status) => status === 'next')
    if (nextIndex >= 0) return nextIndex

    return groups.length ? groups.length - 1 : -1
  }, [groupStatuses, groups.length])

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(getCurrentClock())
    }, 30 * 1000)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (debugSchedule) {
      const targetGroup = groups[targetIndex]
      console.groupCollapsed(
        `[ScheduleStrip:${label}] now=${now} minutes=${currentMinutes} items=${displayItems.length} groups=${groups.length} target=${targetIndex}`,
      )
      console.log({
        label,
        now,
        currentMinutes,
        rawItemCount: schedule.items.length,
        displayItemCount: displayItems.length,
        hasVodCount: schedule.items.filter((item) => item.hasVod).length,
        fromCache: schedule.fromCache,
        cacheType: schedule.cacheType,
        loadedAt: schedule.loadedAt,
        targetIndex,
        targetTimeRange: targetGroup?.timeRange,
        targetTitles: targetGroup?.items.map((item) => item.title),
      })
      console.table(
        groups.map((group, index) => ({
          index,
          status: groupStatuses[index],
          timeRange: group.timeRange,
          startTime: group.startTime,
          endTime: group.endTime,
          itemCount: group.items.length,
          titles: group.items.map((item) => item.title).join(' / '),
        })),
      )
      console.groupEnd()
    }

    const rail = railRef.current
    const targetBlock = targetIndex >= 0 ? rail?.querySelector(`[data-schedule-index="${targetIndex}"]`) : null
    if (debugSchedule) {
      console.log(`[ScheduleStrip:${label}] scroll target`, {
        targetIndex,
        found: Boolean(targetBlock),
        dataset: targetBlock?.dataset ? { ...targetBlock.dataset } : null,
        text: targetBlock?.querySelector('.timeHead span')?.textContent || null,
      })
    }
    if (!targetBlock) return

    const target = targetBlock.offsetLeft - rail.clientWidth / 2 + targetBlock.clientWidth / 2
    rail.scrollTo({
      left: Math.max(0, target),
      behavior: 'smooth',
    })
  }, [currentMinutes, debugSchedule, displayItems.length, groupStatuses, groups, label, now, schedule, targetIndex])

  return (
    <section className="scheduleStrip" aria-label={`${label} 편성표`}>
      <div className="stripMeta">
        <span className="channel">{label}</span>
        <span className="now">{now}</span>
        {schedule.loadedAt ? <span className="loadedAt">{formatLoadedAt(schedule.loadedAt)}</span> : null}
        <span className="cacheBadge">{schedule.fromCache ? schedule.cacheType || 'cache' : 'remote'}</span>
        <span className="loadedAt">수집 {schedule.remoteFetchCount || 0}회</span>
        {schedule.nextRefreshAt ? <span className="loadedAt">다음 {formatLoadedAt(schedule.nextRefreshAt)}</span> : null}
      </div>

      <div className="scheduleRail" ref={railRef}>
        {groups.map((group, index) => {
          const status = groupStatuses[index]

          return (
            <section
              className={`timeBlock ${status === 'live' ? 'isLive' : ''} ${status === 'past' ? 'isPast' : ''}`}
              key={group.timeRange}
              data-schedule-index={index}
              data-schedule-status={status}
            >
              <header className="timeHead">
                <span>{group.timeRange}</span>
                <strong>{status === 'live' ? 'LIVE' : ''}</strong>
              </header>
              <div className="products">
                {group.items.map((item) => {
                  const meta = [item.brand, item.price].filter(Boolean).join(' · ')
                  return (
                    <a className="productRow" href={item.url || undefined} key={item.id} target="_blank">
                      {item.imageUrl ? (
                        <img className="thumb" src={item.imageUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="thumb isEmpty" />
                      )}
                      <span className="info">
                        <strong>{item.title}</strong>
                        <span>{meta}</span>
                      </span>
                    </a>
                  )
                })}
              </div>
            </section>
          )
        })}
        {!groups.length ? <div className="emptyStrip">{schedule.error || '편성표를 불러오는 중입니다.'}</div> : null}
      </div>
    </section>
  )
}
