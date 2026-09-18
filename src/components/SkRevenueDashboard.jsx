import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const channelDefs = [
  { inventoryLabel: 'K쇼핑', sourceKey: 'ktalpha', key: 'kt', chartLabel: 'KT 알파 쇼핑', shortLabel: 'KT', color: '#1497ff' },
  { inventoryLabel: '신세계', sourceKey: 'shinsegae', key: 'ssg', chartLabel: 'SSG', shortLabel: 'SSG', color: '#ffc928' },
  { inventoryLabel: 'SK', sourceKey: 'skstoa', key: 'sk', chartLabel: 'SK 스토아', shortLabel: 'SK', color: '#ff2855' },
]

const channelColors = {
  SK: '#ff2855',
  신세계: '#ffc928',
  K쇼핑: '#1497ff',
}

function formatNumber(value) {
  return Math.round(value || 0).toLocaleString()
}

function formatKRW(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}원`
}

function formatTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatHourMinute(value) {
  if (!value) return '-'
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function getTimeLabel(value) {
  return formatHourMinute(value)
}

function getChannelDef(label) {
  return channelDefs.find((channel) => channel.inventoryLabel === label)
}

function getChannelDefBySource(sourceKey) {
  return channelDefs.find((channel) => channel.sourceKey === sourceKey)
}

function getDeltaPoint(product, point, previous) {
  const hasSoldDelta = point.soldDelta != null
  const soldDelta = hasSoldDelta ? point.soldDelta || 0 : Math.max((point.estimatedSold || 0) - (previous?.estimatedSold || 0), 0)
  const revenueDelta = point.revenueDelta ?? (hasSoldDelta
    ? soldDelta * (product.price || 0)
    : Math.max((point.estimatedRevenue || 0) - (previous?.estimatedRevenue || 0), 0))

  return {
    soldDelta,
    revenueDelta,
  }
}

function normalizeProducts(inventories) {
  return inventories.flatMap(({ label, inventory }) =>
    (inventory.products || []).map((product) => ({
      ...product,
      channel: label,
      channelColor: channelColors[label] || '#a78bfa',
      rowId: `${label}-${product.productId}`,
    })),
  )
}

function getProgramAtFromSchedule(item, latestAt) {
  const [hour, minute] = String(item.startTime || '').split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !latestAt) return null

  const date = new Date(latestAt)
  date.setHours(hour, minute, 0, 0)

  const diff = date.getTime() - latestAt
  if (diff > 12 * 60 * 60 * 1000) date.setDate(date.getDate() - 1)
  if (diff < -12 * 60 * 60 * 1000) date.setDate(date.getDate() + 1)

  return date.getTime()
}

function buildProgramEvents(products, programItems, latestAt, windowStart, ensureRow) {
  const seen = new Set()

  return programItems
    .map((item) => {
      const channel = getChannelDefBySource(item.sourceKey)
      if (!channel) return null

      const programAt = getProgramAtFromSchedule(item, latestAt)
      if (!programAt || programAt < windowStart || programAt > latestAt) return null

      const bucketAt = Math.floor(programAt / 60_000) * 60_000
      const key = `${channel.key}-${bucketAt}`
      if (seen.has(key)) return null
      seen.add(key)
      ensureRow(bucketAt)
      const matchedProduct = products.find(
        (product) =>
          String(product.productId) === String(item.id) &&
          Math.abs((product.broadcastStartAt || 0) - programAt) < 60_000,
      )

      return {
        bucketAt,
        time: getTimeLabel(bucketAt),
        channel: channel.key,
        channelName: channel.shortLabel,
        name: item.title || matchedProduct?.productName || '',
      }
    })
    .filter(Boolean)
}

function buildMinuteChart(products, collectedAt, programItems = [], nowAt = Date.now()) {
  const rows = new Map()
  const latestAt = nowAt || collectedAt || Math.max(0, ...products.flatMap((product) => (product.history || []).map((point) => point.bucketAt || point.collectedAt || 0)))
  const windowEnd = latestAt ? Math.floor(latestAt / 60_000) * 60_000 : 0
  const windowStart = windowEnd ? windowEnd - 119 * 60 * 1000 : 0

  function ensureRow(bucketAt) {
    if (!rows.has(bucketAt)) {
      rows.set(bucketAt, {
        bucketAt,
        time: getTimeLabel(bucketAt),
        kt: null,
        ssg: null,
        sk: null,
        ktCount: 0,
        ssgCount: 0,
        skCount: 0,
      })
    }
    return rows.get(bucketAt)
  }

  if (windowEnd) {
    for (let bucketAt = windowStart; bucketAt <= windowEnd; bucketAt += 60_000) {
      ensureRow(bucketAt)
    }
  }

  for (const product of products) {
    const channel = getChannelDef(product.channel)
    if (!channel) continue

    const history = [...(product.history || [])].sort(
      (a, b) => (a.bucketAt || a.collectedAt || 0) - (b.bucketAt || b.collectedAt || 0),
    )
    for (const [index, point] of history.entries()) {
      const pointBucketAt = point.bucketAt || (point.collectedAt ? Math.floor(point.collectedAt / 60_000) * 60_000 : 0)
      if (!pointBucketAt || pointBucketAt < windowStart) continue

      const row = ensureRow(pointBucketAt)
      const { soldDelta, revenueDelta } = getDeltaPoint(product, point, history[index - 1])
      row[channel.key] = (row[channel.key] || 0) + revenueDelta
      row[`${channel.key}Count`] += soldDelta
    }

  }

  const programs = buildProgramEvents(products, programItems, latestAt, windowStart, ensureRow)
  const data = [...rows.values()].sort((a, b) => a.bucketAt - b.bucketAt)
  if (data.length) data.at(-1).time = '지금'

  return {
    data,
    programs,
  }
}

function NeonDot({ cx, cy, stroke }) {
  if (cx == null || cy == null) return null

  return (
    <g className="neon-dot">
      <circle cx={cx} cy={cy} r={8} fill={stroke} opacity={0.16} />
      <circle cx={cx} cy={cy} r={4} fill={stroke} style={{ filter: `drop-shadow(0 0 5px ${stroke})` }} />
    </g>
  )
}

function ActiveNeonDot({ cx, cy, stroke }) {
  if (cx == null || cy == null) return null

  return (
    <g>
      <circle cx={cx} cy={cy} r={12} fill={stroke} opacity={0.2} />
      <circle cx={cx} cy={cy} r={6.5} fill={stroke} stroke="#fff" strokeWidth={1.5} />
    </g>
  )
}

function getProgramLabelLines(name) {
  const trimmedName = name.length > 36 ? `${name.slice(0, 35)}…` : name
  return trimmedName.length > 18 ? [trimmedName.slice(0, 18), trimmedName.slice(18)] : [trimmedName]
}

function ProgramLabelOverlay({ program }) {
  const channelDef = channelDefs.find((entry) => entry.key === program.channel)
  if (!channelDef) return null

  const lines = program.lines || getProgramLabelLines(program.name)

  return (
    <div
      className="programLabel"
      style={{
        '--program-color': channelDef.color,
        left: `${program.x}px`,
        top: `${program.y}px`,
      }}
    >
      <strong>
        {channelDef.shortLabel}
      </strong>
      <span>{program.time}</span>
      {lines.map((line, index) => (
        <em key={`${line}-${index}`}>{line}</em>
      ))}
    </div>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null

  const values = payload.filter((item) => channelDefs.some((channel) => channel.key === item.dataKey))
  const timeLabel = payload[0]?.payload?.time === '지금' ? '지금' : formatTime(label)

  return (
    <div className="live-tooltip">
      <div className="tooltip-time">{timeLabel}</div>
      {values.map((item) => {
        const channel = channelDefs.find((entry) => entry.key === item.dataKey)
        const count = item.payload?.[`${item.dataKey}Count`] || 0
        if (!channel) return null

        return (
          <div className="tooltip-item" key={item.dataKey}>
            <span className="tooltip-color" style={{ background: channel.color }} />
            <span>{channel.shortLabel}</span>
            <strong>{formatKRW(item.value)}</strong>
            <em>{formatNumber(count)}건</em>
          </div>
        )
      })}
    </div>
  )
}

function Highlight({ point }) {
  if (!point) return null

  return (
    <div className="highlight" style={{ left: `${point.x}px`, top: `${point.y}px`, '--highlight-color': point.color }}>
      <span>{point.time}</span>
      <strong>{point.shortLabel}</strong>
      <b>{formatKRW(point.value)}</b>
      <small>{formatNumber(point.count)}건</small>
    </div>
  )
}

function CurrentBadge({ point }) {
  if (!point) return null

  return (
    <div
      className="current-badge"
      style={{
        '--badge': point.color,
        bottom: `${point.badgeBottom}%`,
      }}
    >
      {formatKRW(point.value)}
      {point.isStale ? <span>지연</span> : null}
    </div>
  )
}

function getTickStep(value) {
  if (value <= 1_000_000) return 200_000
  if (value <= 5_000_000) return 1_000_000
  if (value <= 10_000_000) return 2_000_000
  if (value <= 30_000_000) return 5_000_000
  if (value <= 100_000_000) return 10_000_000
  if (value <= 300_000_000) return 50_000_000
  return 100_000_000
}

function getChartScaleInfo(data) {
  const values = data.flatMap((row) => channelDefs.map((channel) => row[channel.key] || 0))
  const rawMaxValue = Math.max(1, ...values)
  const channelPeaks = channelDefs
    .map((channel) => ({
      ...channel,
      value: Math.max(0, ...data.map((row) => row[channel.key] || 0)),
    }))
    .sort((a, b) => b.value - a.value)
  const [topPeak, ...otherPeaks] = channelPeaks
  const otherMax = Math.max(0, ...otherPeaks.map((peak) => peak.value))
  const hasSingleChannelSpike = topPeak && otherPeaks.length === 2 && otherPeaks.every((peak) => topPeak.value > peak.value * 3)
  const scaleValues =
    hasSingleChannelSpike
      ? values.filter((value) => value <= otherMax * 3)
      : values
  const scaleMaxValue = Math.max(1, ...scaleValues)
  const tickStep = getTickStep(scaleMaxValue)
  const axisMax = Math.max(tickStep, Math.ceil((scaleMaxValue * 1.08) / tickStep) * tickStep)

  return {
    axisMax,
    rawMaxValue,
    tickStep,
    outlierChannelKey: hasSingleChannelSpike ? topPeak.key : null,
  }
}

const yAxisWidth = 96
const xAxisHeight = 28
const overlayGap = 10
const programLabelWidth = 216
const highlightCard = { width: 206, height: 94 }
const chartMargin = { top: 54, right: 112, bottom: 12, left: 12 }

function getProgramLabelSize(program) {
  const lines = getProgramLabelLines(program.name)
  return {
    width: programLabelWidth,
    height: 34 + lines.length * 13,
    lines,
  }
}

function intersects(a, b, gap = overlayGap) {
  return !(
    a.x + a.width + gap < b.x ||
    b.x + b.width + gap < a.x ||
    a.y + a.height + gap < b.y ||
    b.y + b.height + gap < a.y
  )
}

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return x * y
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getPlotBox(chartSize, chartMargin) {
  return {
    left: chartMargin.left + yAxisWidth,
    right: Math.max(chartMargin.left + yAxisWidth + 1, chartSize.width - chartMargin.right),
    top: chartMargin.top,
    bottom: Math.max(chartMargin.top + 1, chartSize.height - chartMargin.bottom - xAxisHeight),
  }
}

function getScales(data, axisMax, chartSize, chartMargin) {
  const firstAt = data[0]?.bucketAt || 0
  const lastAt = data.at(-1)?.bucketAt || firstAt + 1
  const plot = getPlotBox(chartSize, chartMargin)

  return {
    plot,
    x: (bucketAt) => plot.left + ((bucketAt - firstAt) / Math.max(lastAt - firstAt, 1)) * (plot.right - plot.left),
    y: (value) => {
      if (value > axisMax) return plot.top - 24
      return plot.bottom - (value / Math.max(axisMax, 1)) * (plot.bottom - plot.top)
    },
  }
}

function getTenMinuteTicks(data) {
  if (!data.length) return []

  const start = Math.ceil(data[0].bucketAt / 600_000) * 600_000
  const end = data.at(-1).bucketAt
  const ticks = []

  for (let tick = start; tick <= end; tick += 600_000) {
    ticks.push(tick)
  }

  if (!ticks.includes(data[0].bucketAt)) ticks.unshift(data[0].bucketAt)
  if (!ticks.includes(end)) ticks.push(end)

  return ticks
}

function getLatestChannelPoint(data, channel, nowAt) {
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const row = data[index]
    if (row[channel.key] != null) {
      return {
        ...channel,
        value: row[channel.key],
        bucketAt: row.bucketAt,
        isStale: nowAt && nowAt - row.bucketAt > 2 * 60 * 1000,
      }
    }
  }

  return {
    ...channel,
    value: 0,
    bucketAt: null,
    isStale: true,
  }
}

function getNearestCardEdge(anchor, rect) {
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const dx = anchor.x - centerX
  const dy = anchor.y - centerY

  if (Math.abs(dx / rect.width) > Math.abs(dy / rect.height)) {
    return {
      x: dx < 0 ? rect.x : rect.x + rect.width,
      y: clamp(anchor.y, rect.y + 10, rect.y + rect.height - 10),
    }
  }

  return {
    x: clamp(anchor.x, rect.x + 10, rect.x + rect.width - 10),
    y: dy < 0 ? rect.y : rect.y + rect.height,
  }
}

function placeRect(candidates, occupied, bounds, avoid = []) {
  let best = null

  for (const candidate of candidates) {
    const rect = {
      ...candidate,
      x: clamp(candidate.x, bounds.left, bounds.right - candidate.width),
      y: clamp(candidate.y, bounds.top, bounds.bottom - candidate.height),
    }
    const hardScore = occupied.reduce((sum, entry) => sum + overlapArea(rect, entry), 0)
    const avoidScore = avoid.reduce((sum, entry) => sum + overlapArea(rect, entry), 0)
    const hardBlocked = occupied.some((entry) => intersects(rect, entry))
    const avoidBlocked = avoid.some((entry) => intersects(rect, entry, 4))
    const distanceScore = candidate.distanceScore || 0
    const score = (hardBlocked ? 1_000_000_000 : 0) + (avoidBlocked ? 10_000_000 : 0) + hardScore * 100 + avoidScore * 20 + distanceScore
    if (!hardBlocked && !avoidBlocked && !avoidScore) return rect
    if (!best || score < best.score) best = { ...rect, score }
  }

  return best
}

function getLineAvoidRects(data, scales) {
  const rects = []
  const pointPad = 22
  const segmentPad = 18

  for (const channel of channelDefs) {
    let previous = null

    for (const row of data) {
      const value = row[channel.key]
      if (value == null) {
        previous = null
        continue
      }

      const point = {
        x: scales.x(row.bucketAt),
        y: scales.y(value),
      }

      rects.push({
        x: point.x - pointPad,
        y: point.y - pointPad,
        width: pointPad * 2,
        height: pointPad * 2,
      })

      if (previous) {
        const x = Math.min(previous.x, point.x)
        const y = Math.min(previous.y, point.y)
        rects.push({
          x: x - segmentPad,
          y: y - segmentPad,
          width: Math.abs(previous.x - point.x) + segmentPad * 2,
          height: Math.abs(previous.y - point.y) + segmentPad * 2,
        })
      }

      previous = point
    }
  }

  return rects
}

function getHighlightCandidates(anchor, bounds) {
  const positions = []
  const xOffsets = [34, 72, 112]
  const yOffsets = [28, 58, 90]

  for (const xOffset of xOffsets) {
    for (const yOffset of yOffsets) {
      positions.push(
        { x: anchor.x + xOffset, y: anchor.y - highlightCard.height - yOffset },
        { x: anchor.x - highlightCard.width - xOffset, y: anchor.y - highlightCard.height - yOffset },
        { x: anchor.x + xOffset, y: anchor.y + yOffset },
        { x: anchor.x - highlightCard.width - xOffset, y: anchor.y + yOffset },
      )
    }
  }

  positions.push(
    { x: anchor.x - highlightCard.width / 2, y: anchor.y - highlightCard.height - 110 },
    { x: anchor.x - highlightCard.width / 2, y: anchor.y + 96 },
    { x: anchor.x + 132, y: anchor.y - highlightCard.height / 2 },
    { x: anchor.x - highlightCard.width - 132, y: anchor.y - highlightCard.height / 2 },
  )

  const gridStepX = 42
  const gridStepY = 26
  for (let y = bounds.top; y <= bounds.bottom - highlightCard.height; y += gridStepY) {
    for (let x = bounds.left; x <= bounds.right - highlightCard.width; x += gridStepX) {
      positions.push({ x, y })
    }
  }

  return positions
    .map((candidate) => ({
      ...candidate,
      ...highlightCard,
      distanceScore: Math.hypot(candidate.x + highlightCard.width / 2 - anchor.x, candidate.y + highlightCard.height / 2 - anchor.y) * 0.7,
    }))
    .sort((a, b) => a.distanceScore - b.distanceScore)
}

function layoutGraphOverlays({ programs, highlights, currentPoints, data, axisMax, chartSize, chartMargin }) {
  if (!chartSize.width || !chartSize.height || !data.length) {
    return { programs: [], highlights: [], connectors: [], programConnectors: [], currentPoints }
  }

  const scales = getScales(data, axisMax, chartSize, chartMargin)
  const lineAvoidRects = getLineAvoidRects(data, scales)
  const occupied = []
  const bounds = {
    left: 4,
    top: 4,
    right: chartSize.width - 4,
    bottom: chartSize.height - 4,
  }
  const highlightBounds = {
    left: scales.plot.left + 6,
    top: scales.plot.top + 6,
    right: scales.plot.right - 6,
    bottom: scales.plot.bottom - 6,
  }

  for (const point of currentPoints) {
    occupied.push({
      x: chartSize.width - 116,
      y: chartSize.height - ((point.badgeBottom / 100) * chartSize.height) - 14,
      width: 108,
      height: 28,
    })
  }

  const placedPrograms = [...programs]
    .sort((a, b) => a.bucketAt - b.bucketAt)
    .map((program) => {
      const anchorX = scales.x(program.bucketAt)
      const size = getProgramLabelSize(program)
      const candidates = []
      const maxY = Math.min(scales.plot.top + 150, scales.plot.bottom - size.height)

      for (const xOffset of [8, -size.width - 8, 18, -Math.round(size.width / 2), -size.width - 22, 32]) {
        for (let y = 6; y <= maxY; y += 12) {
          candidates.push({
            x: anchorX + xOffset,
            y,
            width: size.width,
            height: size.height,
          })
        }
      }
      if (!candidates.length) {
        candidates.push({
          x: anchorX + 8,
          y: 6,
          width: size.width,
          height: size.height,
        })
      }

      const rect = placeRect(candidates, occupied, bounds)
      occupied.push(rect)
      return {
        ...program,
        ...rect,
        anchorX,
        lines: size.lines,
      }
    })

  const placedHighlights = highlights.map((point) => {
    const row = data[point.index]
    const anchor = {
      x: scales.x(row?.bucketAt || 0),
      y: scales.y(point.value),
    }
    const candidates = getHighlightCandidates(anchor, highlightBounds)
    const rect = placeRect(candidates, occupied, highlightBounds, lineAvoidRects)
    const edge = getNearestCardEdge(anchor, rect)
    occupied.push(rect)

    return {
      ...point,
      ...rect,
      anchor,
      edge,
    }
  })

  return {
    programs: placedPrograms,
    highlights: placedHighlights,
    programConnectors: placedPrograms.map((program) => ({
      key: `${program.channel}-${program.bucketAt}-${program.name}`,
      color: channelDefs.find((channel) => channel.key === program.channel)?.color || '#fff',
      start: { x: program.anchorX, y: program.y + 8 },
      end: getNearestCardEdge({ x: program.anchorX, y: program.y + 8 }, program),
    })),
    connectors: placedHighlights.map((point) => ({
      key: point.key,
      color: point.color,
      start: point.anchor,
      end: point.edge,
    })),
    currentPoints,
  }
}

function avoidBadgeCollisions(points, axisMax) {
  const sorted = points
    .filter(Boolean)
    .map((point) => ({
      ...point,
      badgeBottom: 8 + (point.value / Math.max(axisMax, 1)) * 78,
    }))
    .sort((a, b) => a.badgeBottom - b.badgeBottom)

  const gap = 8
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].badgeBottom - sorted[index - 1].badgeBottom < gap) {
      sorted[index].badgeBottom = sorted[index - 1].badgeBottom + gap
    }
  }

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    sorted[index].badgeBottom = Math.min(92, sorted[index].badgeBottom)
    if (index > 0 && sorted[index].badgeBottom - sorted[index - 1].badgeBottom < gap) {
      sorted[index - 1].badgeBottom = sorted[index].badgeBottom - gap
    }
  }

  return sorted.map((point) => ({
    ...point,
    badgeBottom: Math.max(8, Math.min(92, point.badgeBottom)),
  }))
}

function CombinedRevenueChart({ products, collectedAt, programs, nowAt }) {
  const chartRef = useRef(null)
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 })
  const { data, programs: chartPrograms } = useMemo(
    () => buildMinuteChart(products, collectedAt, programs, nowAt),
    [collectedAt, nowAt, products, programs],
  )
  const scaleInfo = useMemo(() => getChartScaleInfo(data), [data])
  const { axisMax, tickStep } = scaleInfo
  const ticks = Array.from({ length: Math.floor(axisMax / tickStep) + 1 }, (_, index) => index * tickStep)
  const timeTicks = useMemo(() => getTenMinuteTicks(data), [data])
  const lastRow = data.at(-1)
  const currentPoints = avoidBadgeCollisions(
    channelDefs.map((channel) => (lastRow ? getLatestChannelPoint(data, channel, nowAt) : null)),
    axisMax,
  )
  const highlights = channelDefs
    .map((channel) => {
      const peak = data.reduce(
        (best, row, index) => {
          const value = row[channel.key] || 0
          return value > best.value
            ? {
                ...channel,
                time: row.time,
                value,
                count: row[`${channel.key}Count`] || 0,
                index,
              }
            : best
        },
        { value: 0 },
      )
      return peak.value > 0 ? peak : null
    })
    .filter(Boolean)
  const overlayLayout = useMemo(
    () =>
      layoutGraphOverlays({
        programs: chartPrograms,
        highlights,
        currentPoints,
        data,
        axisMax,
        chartSize,
        chartMargin,
      }),
    [axisMax, chartPrograms, chartSize, currentPoints, data, highlights],
  )

  useEffect(() => {
    if (!chartRef.current) return undefined

    const observer = new ResizeObserver(([entry]) => {
      setChartSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(chartRef.current)

    return () => observer.disconnect()
  }, [])

  return (
    <section className="live-order-chart" aria-label="분당 주문금액 그래프">
      <div className="chart-top">
        <h2>분당 주문금액</h2>
        <div className="legend">
          {channelDefs.map((channel) => (
            <span key={channel.key}>
              <i style={{ background: channel.color }} />
              {channel.chartLabel}
            </span>
          ))}
        </div>
      </div>

      <div className="chart-wrapper" ref={chartRef}>
        <svg className="overlayConnectors" width="100%" height="100%">
          {overlayLayout.programConnectors.map((connector) => (
            <path
              d={`M ${connector.start.x} ${connector.start.y} L ${(connector.start.x + connector.end.x) / 2} ${connector.start.y} L ${connector.end.x} ${connector.end.y}`}
              key={connector.key}
              stroke={connector.color}
              opacity="0.58"
            />
          ))}
          {overlayLayout.connectors.map((connector) => (
            <g key={connector.key}>
              <path
                d={`M ${connector.start.x} ${connector.start.y} L ${(connector.start.x + connector.end.x) / 2} ${connector.start.y} L ${connector.end.x} ${connector.end.y}`}
                stroke={connector.color}
              />
              <circle cx={connector.start.x} cy={connector.start.y} r="12" fill={connector.color} opacity="0.16" />
              <circle cx={connector.start.x} cy={connector.start.y} r="6" fill={connector.color} stroke="#fff" strokeWidth="1.5" />
              <circle cx={connector.end.x} cy={connector.end.y} r="3" fill={connector.color} />
            </g>
          ))}
        </svg>
        <div className="programLabelLayer">
          {overlayLayout.programs.map((program, index) => (
            <ProgramLabelOverlay key={`${program.channel}-${program.bucketAt}-${index}`} program={program} />
          ))}
        </div>
        {overlayLayout.highlights.map((point) => (
          <Highlight key={point.key} point={point} />
        ))}

        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={chartMargin}>
            <defs>
              {channelDefs.map((channel) => (
                <linearGradient id={`${channel.key}Area`} x1="0" x2="0" y1="0" y2="1" key={channel.key}>
                  <stop offset="0%" stopColor={channel.color} stopOpacity={0.48} />
                  <stop offset="52%" stopColor={channel.color} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={channel.color} stopOpacity={0} />
                </linearGradient>
              ))}
              {channelDefs.map((channel) => (
                <filter id={`${channel.key}Glow`} x="-50%" y="-50%" width="200%" height="200%" key={`${channel.key}Glow`}>
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              ))}
            </defs>

            <CartesianGrid stroke="rgba(50,105,145,.12)" strokeWidth={1} vertical horizontal />
            <XAxis
              dataKey="bucketAt"
              type="number"
              domain={['dataMin', 'dataMax']}
              ticks={timeTicks}
              tickFormatter={formatHourMinute}
              tick={{ fill: '#91a5bd', fontSize: 11 }}
              axisLine={{ stroke: '#35526d' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, axisMax]}
              ticks={ticks}
              width={96}
              tickFormatter={formatKRW}
              tick={{ fill: '#91a5bd', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDataOverflow
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: 'rgba(255,255,255,.3)', strokeWidth: 1, strokeDasharray: '4 5' }}
            />

            {channelDefs.map((channel) => (
              <Area
                type="monotone"
                dataKey={channel.key}
                stroke="none"
                fill={`url(#${channel.key}Area)`}
                connectNulls
                isAnimationActive={false}
                key={`${channel.key}AreaLayer`}
              />
            ))}

            {chartPrograms.map((program, index) => (
              <ReferenceLine
                key={`${program.channel}-${program.time}-${index}`}
                x={program.bucketAt}
                stroke={channelDefs.find((channel) => channel.key === program.channel)?.color}
                strokeWidth={1}
                strokeDasharray="5 5"
                strokeOpacity={0.78}
              />
            ))}

            {data.length ? (
              <ReferenceLine x={lastRow.bucketAt} stroke="#e5e7eb" strokeWidth={1.3} strokeDasharray="5 5" strokeOpacity={0.82} />
            ) : null}

            {channelDefs.map((channel) => (
              <Line
                type="monotone"
                dataKey={channel.key}
                stroke={channel.color}
                strokeWidth={2.8}
                dot={<NeonDot />}
                activeDot={<ActiveNeonDot />}
                filter={`url(#${channel.key}Glow)`}
                connectNulls
                isAnimationActive
                animationDuration={700}
                key={`${channel.key}Line`}
              />
            ))}

          </ComposedChart>
        </ResponsiveContainer>

        <div className="current-values">
          {currentPoints
            .sort((a, b) => b.value - a.value)
            .map((point) => (
              <CurrentBadge key={point.key} point={point} />
            ))}
        </div>

        {!data.length ? <div className="emptyPanel">매출 수집 데이터 대기 중</div> : null}
      </div>
    </section>
  )
}

export function CombinedRevenueDashboard({ inventories, programs }) {
  const [nowAt, setNowAt] = useState(() => Date.now())
  const products = useMemo(() => normalizeProducts(inventories), [inventories])
  const latestCollectedAt = Math.max(0, ...inventories.map(({ inventory }) => inventory.collectedAt || 0))

  useEffect(() => {
    const timer = window.setInterval(() => setNowAt(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section className="dashboardGrid combinedDashboard" aria-label="3사 통합 실시간 현황">
      <section className="revenuePanel" aria-label="3사 수집주기별 주문금액">
        <CombinedRevenueChart products={products} collectedAt={latestCollectedAt} programs={programs} nowAt={nowAt} />
      </section>
    </section>
  )
}
