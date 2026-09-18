import { useEffect, useMemo, useRef, useState } from 'react'
import { getItemStatus, getMinuteValue, groupByTime } from '../utils/scheduleTime'

const seoulClockFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const channelTheme = {
  SK스토아: { accent: '#ff2855', shortLabel: 'SK' },
  신세계쇼핑: { accent: '#ffc928', shortLabel: 'SSG' },
  KT알파쇼핑: { accent: '#1497ff', shortLabel: 'KT' },
}

function getCurrentClock() {
  const parts = Object.fromEntries(seoulClockFormatter.formatToParts(new Date()).map((part) => [part.type, part.value]))
  const hour = String(Number(parts.hour) % 24).padStart(2, '0')
  return `${hour}:${parts.minute}`
}

function formatMoneyMillion(value) {
  return `${((value || 0) / 1_000_000).toFixed(1)}`
}

function formatKRW(value) {
  return `${Math.round(value || 0).toLocaleString('ko-KR')}원`
}

function formatNumber(value) {
  return Math.round(value || 0).toLocaleString('ko-KR')
}

function getDisplayName(product) {
  return (product.productName || product.productId || '').replace(/^\[[^\]]+\]/, '').trim()
}

function CurrentProductTable({ inventory, nowAt, theme }) {
  const currentAt = inventory.collectedAt || nowAt
  const products = [...(inventory.products || [])]
    .filter((product) => product.broadcastStartAt <= currentAt && product.broadcastEndAt >= currentAt)
    .sort((a, b) => (b.estimatedRevenue || 0) - (a.estimatedRevenue || 0))
    .slice(0, 5)
  const pgmTotal = products.reduce(
    (sum, product) => ({
      revenue: sum.revenue + (product.estimatedRevenue || 0),
      sold: sum.sold + (product.estimatedSold || 0),
    }),
    { revenue: 0, sold: 0 },
  )

  return (
    <aside className="liveProductPanel" aria-label="현재 방송 상품별 주문금액">
      <header className="livePgmTotal">
        <span className="liveDot" />
        <span>현PGM누계</span>
        <strong>{formatKRW(pgmTotal.revenue)}</strong>
        <em>{formatNumber(pgmTotal.sold)}건</em>
      </header>
      <div className="liveProductHead">
        <span>코드</span>
        <span>상품명</span>
        <span>주문금액(백만원)</span>
        <span>주문건수</span>
      </div>
      <div className="liveProductRows">
        {products.map((product) => (
          <a className="liveProductRow" href={product.url || undefined} key={product.productId} target="_blank">
            <span>{product.productId}</span>
            <strong>{getDisplayName(product)}</strong>
            <b>{formatMoneyMillion(product.estimatedRevenue)}</b>
            <em>{formatNumber(product.estimatedSold)}</em>
          </a>
        ))}
        {!products.length ? <div className="liveProductEmpty">현재 방송 상품 수집 대기 중</div> : null}
      </div>
      <span className="panelGlow" style={{ background: theme.accent }} />
    </aside>
  )
}

export function ScheduleStrip({ label, schedule, displayFilter, inventory }) {
  const railRef = useRef(null)
  const dragRef = useRef({ active: false, moved: false, left: 0, x: 0 })
  const [now, setNow] = useState(getCurrentClock)
  const [nowAt, setNowAt] = useState(() => Date.now())
  const debugSchedule = label === '신세계쇼핑'
  const theme = channelTheme[label] || { accent: '#38bdf8', shortLabel: label }
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
      setNowAt(Date.now())
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
        mainCount: schedule.items.filter((item) => item.isMainProduct).length,
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

  function handleRailPointerDown(event) {
    if (event.button !== 0) return

    const rail = railRef.current
    if (!rail) return

    dragRef.current = {
      active: true,
      moved: false,
      left: rail.scrollLeft,
      x: event.clientX,
    }
    rail.classList.add('isDragging')
    rail.setPointerCapture(event.pointerId)
  }

  function handleRailPointerMove(event) {
    const rail = railRef.current
    const drag = dragRef.current
    if (!rail || !drag.active) return

    const distance = event.clientX - drag.x
    if (Math.abs(distance) > 4) drag.moved = true
    rail.scrollLeft = drag.left - distance
  }

  function handleRailPointerUp(event) {
    const rail = railRef.current
    if (!rail) return

    dragRef.current.active = false
    window.setTimeout(() => {
      dragRef.current.moved = false
    }, 0)
    rail.classList.remove('isDragging')
    if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId)
  }

  function handleProductClick(event) {
    if (dragRef.current.moved) event.preventDefault()
  }

  return (
    <section className="scheduleStrip" aria-label={`${label} 편성표`} style={{ '--channel-accent': theme.accent }}>
      <div className="stripMeta">
        <span className="channel">{theme.shortLabel}</span>
      </div>

      <div
        className="scheduleRail"
        ref={railRef}
        onPointerDown={handleRailPointerDown}
        onPointerMove={handleRailPointerMove}
        onPointerUp={handleRailPointerUp}
        onPointerCancel={handleRailPointerUp}
      >
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
                    <a className="productRow" href={item.url || undefined} key={item.id} onClick={handleProductClick} target="_blank">
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
      <CurrentProductTable inventory={inventory} nowAt={nowAt} theme={theme} />
    </section>
  )
}
