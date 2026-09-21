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

function getProductRuntimeStats(product) {
  return (product.history || []).reduce(
    (sum, point) => {
      const soldDelta = Math.max(point.soldDelta || 0, 0)
      return {
        revenue: sum.revenue + Math.max(point.revenueDelta ?? soldDelta * (point.price || product.price || 0), 0),
        sold: sum.sold + soldDelta,
      }
    },
    { revenue: 0, sold: 0 },
  )
}

function getProductGroupKey(product) {
  return `${product.broadcastStartAt || 0}-${product.broadcastEndAt || 0}`
}

function getProductGroups(products, nowAt) {
  const byGroup = new Map()

  for (const product of products || []) {
    const startAt = product.broadcastStartAt || 0
    const endAt = product.broadcastEndAt || 0
    if (!startAt || !endAt) continue

    const groupKey = getProductGroupKey(product)
    const group = byGroup.get(groupKey) || {
      startAt,
      endAt,
      products: [],
    }
    group.products.push({
      ...product,
      runtimeStats: getProductRuntimeStats(product),
    })
    byGroup.set(groupKey, group)
  }

  const groups = [...byGroup.values()].sort((a, b) => a.startAt - b.startAt)
  const currentGroup = groups.find((group) => group.startAt <= nowAt && group.endAt >= nowAt)
  const previousGroup = [...groups]
    .reverse()
    .find((group) => {
      if (currentGroup) return group.startAt < currentGroup.startAt
      return group.endAt < nowAt
    })

  return { currentGroup, previousGroup }
}

function CurrentProductTable({ inventory, nowAt, theme }) {
  const [summaryMode, setSummaryMode] = useState('current')
  const { currentGroup, previousGroup } = useMemo(() => getProductGroups(inventory.products, nowAt), [inventory.products, nowAt])
  const selectedGroup = summaryMode === 'previous' ? previousGroup : currentGroup
  const currentProducts = [...(selectedGroup?.products || [])]
    .sort((a, b) => b.runtimeStats.revenue - a.runtimeStats.revenue)
  const products = currentProducts.slice(0, 5)
  const pgmTotal = currentProducts.reduce(
    (sum, product) => ({
      revenue: sum.revenue + product.runtimeStats.revenue,
      sold: sum.sold + product.runtimeStats.sold,
    }),
    { revenue: 0, sold: 0 },
  )
  const isPreviousMode = summaryMode === 'previous'
  const title = isPreviousMode ? '직전PGM누계' : '현PGM누계'

  return (
    <aside className="liveProductPanel" aria-label={`${title} 상품별 주문금액`}>
      <header className="livePgmTotal">
        <span className="liveDot" />
        <span>{title}</span>
        <span className="pgmSwitch" aria-label="PGM 누계 전환">
          <button
            aria-label="직전 PGM 누계 보기"
            disabled={!previousGroup || isPreviousMode}
            onClick={() => setSummaryMode('previous')}
            type="button"
          >
            ▲
          </button>
          <button
            aria-label="현재 PGM 누계 보기"
            disabled={!currentGroup || !isPreviousMode}
            onClick={() => setSummaryMode('current')}
            type="button"
          >
            ▼
          </button>
        </span>
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
            <b>{formatMoneyMillion(product.runtimeStats.revenue)}</b>
            <em>{formatNumber(product.runtimeStats.sold)}</em>
          </a>
        ))}
        {!products.length ? <div className="liveProductEmpty">{isPreviousMode ? '직전 방송 상품 수집 대기 중' : '현재 방송 상품 수집 대기 중'}</div> : null}
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
