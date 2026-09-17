import { useEffect, useMemo, useRef, useState } from 'react'
import { formatLoadedAt, getItemStatus, getMinuteValue, groupByTime } from '../utils/scheduleTime'

function getCurrentClock() {
  const current = new Date()
  return `${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`
}

export function ScheduleStrip({ label, schedule, displayFilter }) {
  const railRef = useRef(null)
  const [now, setNow] = useState(getCurrentClock)
  const currentMinutes = getMinuteValue(now)
  const displayItems = useMemo(
    () => (displayFilter ? schedule.items.filter(displayFilter) : schedule.items),
    [displayFilter, schedule.items],
  )
  const groups = useMemo(() => groupByTime(displayItems), [displayItems])

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(getCurrentClock())
    }, 30 * 1000)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return

    const blocks = [...rail.querySelectorAll('.timeBlock')]
    const targetBlock =
      blocks.find((block) => block.classList.contains('isLive')) ||
      blocks.find((block) => !block.classList.contains('isPast')) ||
      blocks.at(-1)

    if (!targetBlock) return

    const target = targetBlock.offsetLeft - rail.clientWidth / 2 + targetBlock.clientWidth / 2
    rail.scrollTo({
      left: Math.max(0, target),
      behavior: 'smooth',
    })
  }, [groups, currentMinutes])

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
        {groups.map((group) => {
          const status = getItemStatus(group, currentMinutes)

          return (
            <section
              className={`timeBlock ${status === 'live' ? 'isLive' : ''} ${status === 'past' ? 'isPast' : ''}`}
              key={group.timeRange}
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
