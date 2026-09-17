import { useEffect, useMemo, useRef } from 'react'
import { formatLoadedAt, getItemStatus, getMinuteValue, groupByTime } from '../utils/scheduleTime'

export function ScheduleStrip({ label, schedule }) {
  const railRef = useRef(null)
  const now = useMemo(() => {
    const current = new Date()
    return `${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`
  }, [])
  const currentMinutes = getMinuteValue(now)
  const groups = useMemo(() => groupByTime(schedule.items), [schedule.items])

  useEffect(() => {
    const rail = railRef.current
    const liveBlock = rail?.querySelector('.timeBlock.isLive')
    if (!rail || !liveBlock) return

    const target = liveBlock.offsetLeft - rail.clientWidth / 2 + liveBlock.clientWidth / 2
    rail.scrollTo({
      left: Math.max(0, target),
      behavior: 'smooth',
    })
  }, [groups])

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
