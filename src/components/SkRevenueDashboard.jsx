import { useState } from 'react'

const chartMinutes = 60

function formatWon(value) {
  return `${Math.round(value || 0).toLocaleString()}원`
}

function formatNumber(value) {
  return Math.round(value || 0).toLocaleString()
}

function formatTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function getProductColor(index) {
  const colors = ['#38bdf8', '#fb923c', '#34d399', '#f472b6', '#facc15', '#a78bfa', '#60a5fa', '#f87171']
  return colors[index % colors.length]
}

function isInsideBroadcast(product, collectedAt) {
  return product.broadcastStartAt <= collectedAt && collectedAt <= product.broadcastEndAt
}

function getDisplayName(product) {
  return (product.productName || product.productId || '').replace(/^\[[^\]]+\]/, '').trim()
}

function getMinuteRevenue(point, product) {
  return (point.soldDelta || 0) * (product.price || 0)
}

function getPointPosition(point, product, chartStart, chartEnd, plot, maxValue) {
  const x = plot.left + ((point.collectedAt - chartStart) / (chartEnd - chartStart)) * plot.width
  const minuteRevenue = getMinuteRevenue(point, product)
  const y = plot.top + plot.height - (minuteRevenue / Math.max(maxValue, 1)) * plot.height
  return { ...point, minuteRevenue, x, y }
}

function getLineSegments(product, chartStart, chartEnd, plot, maxValue) {
  const segments = []
  let current = []

  for (const point of product.history || []) {
    const inWindow = chartStart <= point.collectedAt && point.collectedAt <= chartEnd
    const active = inWindow && isInsideBroadcast(product, point.collectedAt)

    if (!active) {
      if (current.length) segments.push(current)
      current = []
      continue
    }

    current.push(getPointPosition(point, product, chartStart, chartEnd, plot, maxValue))
  }

  if (current.length) segments.push(current)
  return segments
}

function makePath(points) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x + 1} ${points[0].y}`
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function getLastSegmentPoint(segments) {
  const lastSegment = segments.at(-1)
  return lastSegment?.at(-1) || null
}

function getTimeX(value, chartStart, chartEnd, plot) {
  return plot.left + ((value - chartStart) / (chartEnd - chartStart)) * plot.width
}

function getLabelPosition(product, labelPoint, chartStart, chartEnd, plot, labelWidth) {
  if (!labelPoint) return { x: 0, y: 0 }

  const programStartX = Math.max(plot.left + 6, getTimeX(product.broadcastStartAt, chartStart, chartEnd, plot) + 6)
  const programEndX = Math.min(plot.left + plot.width - 6, getTimeX(product.broadcastEndAt, chartStart, chartEnd, plot) - 6)
  const programWidth = Math.max(0, programEndX - programStartX)
  const fitsInsideProgram = programWidth >= labelWidth
  const preferredX = labelPoint.x + 12
  const fallbackX = labelPoint.x - labelWidth - 12

  const minX = fitsInsideProgram ? programStartX : plot.left + 6
  const maxX = fitsInsideProgram ? programEndX - labelWidth : plot.left + plot.width - labelWidth - 6
  const x = Math.min(maxX, Math.max(minX, preferredX <= maxX ? preferredX : fallbackX))
  const y = Math.max(plot.top + 10, Math.min(plot.top + plot.height - 8, labelPoint.y - 10))

  return { x, y }
}

function RevenueChart({ products, collectedAt }) {
  const [tooltip, setTooltip] = useState(null)
  const width = 970
  const height = 300
  const plot = {
    left: 30,
    top: 22,
    width: 922,
    height: 232,
  }
  const labelWidth = 224
  const labelHeight = 22
  const tooltipWidth = 178
  const tooltipHeight = 54
  const latestPointAt = Math.max(0, ...products.flatMap((product) => (product.history || []).map((point) => point.collectedAt || 0)))
  const now = collectedAt || latestPointAt
  const chartEnd = now
  const chartStart = chartEnd - chartMinutes * 60 * 1000
  const visiblePoints = products.flatMap((product) =>
    (product.history || []).filter(
      (point) => chartStart <= point.collectedAt && point.collectedAt <= chartEnd && isInsideBroadcast(product, point.collectedAt),
    ),
  )
  const visibleMinuteRevenues = products.flatMap((product) =>
    (product.history || [])
      .filter((point) => chartStart <= point.collectedAt && point.collectedAt <= chartEnd && isInsideBroadcast(product, point.collectedAt))
      .map((point) => getMinuteRevenue(point, product)),
  )
  const maxValue = Math.max(1, ...visibleMinuteRevenues) * 1.18
  const timeTicks = Array.from({ length: 7 }, (_, index) => chartStart + index * 10 * 60 * 1000)
  const broadcastEndMarkers = products
    .map((product, index) => ({
      productId: product.productId,
      color: getProductColor(index),
      endAt: product.broadcastEndAt,
    }))
    .filter((marker) => chartStart <= marker.endAt && marker.endAt <= chartEnd)

  return (
    <div className="chartWrap">
      <svg
        className="revenueChart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="SK 추정매출 60분 그래프"
      >
        {[0, 1, 2, 3, 4].map((line) => {
          const y = plot.top + (plot.height / 4) * line
          return <line className="gridLine" x1={plot.left} x2={plot.left + plot.width} y1={y} y2={y} key={line} />
        })}
        {timeTicks.map((tick) => {
          const x = plot.left + ((tick - chartStart) / (chartEnd - chartStart)) * plot.width
          return (
            <g key={tick}>
              <line className="gridLine vertical" x1={x} x2={x} y1={plot.top} y2={plot.top + plot.height} />
              <text className="tickText" x={x} y={plot.top + plot.height + 23} textAnchor="middle">
                {formatTime(tick)}
              </text>
            </g>
          )
        })}
        {broadcastEndMarkers.map((marker) => {
          const x = plot.left + ((marker.endAt - chartStart) / (chartEnd - chartStart)) * plot.width
          return (
            <line
              className="broadcastEndLine"
              x1={x}
              x2={x}
              y1={plot.top}
              y2={plot.top + plot.height}
              stroke={marker.color}
              key={`${marker.productId}-${marker.endAt}`}
            />
          )
        })}
        {products.map((product, index) => {
          const color = getProductColor(index)
          const segments = getLineSegments(product, chartStart, chartEnd, plot, maxValue)
          const labelPoint = getLastSegmentPoint(segments)
          const labelPosition = getLabelPosition(product, labelPoint, chartStart, chartEnd, plot, labelWidth)

          return (
            <g key={product.productId}>
              {segments.map((segment, segmentIndex) => (
                <path className="revenueLine" d={makePath(segment)} stroke={color} key={segmentIndex} />
              ))}
              {segments.flat().map((point, pointIndex) => (
                <circle
                  className="revenueDot"
                  cx={point.x}
                  cy={point.y}
                  r="3.8"
                  fill={color}
                  key={pointIndex}
                  onMouseEnter={() => {
                    const tooltipX = Math.min(width - tooltipWidth - 8, Math.max(8, point.x + 12))
                    const tooltipY = Math.min(height - tooltipHeight - 8, Math.max(8, point.y - tooltipHeight - 10))
                    setTooltip({
                      x: tooltipX,
                      y: tooltipY,
                      time: formatTime(point.collectedAt),
                      soldDelta: point.soldDelta || 0,
                      amount: point.minuteRevenue || 0,
                      productName: getDisplayName(product),
                    })
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}
              {labelPoint ? (
                <g>
                  <line className="labelGuide" x1={labelPoint.x} x2={labelPosition.x} y1={labelPoint.y} y2={labelPosition.y} />
                  <rect className="lineLabelBox" x={labelPosition.x} y={labelPosition.y - 14} width={labelWidth} height={labelHeight} rx="5" />
                  <circle cx={labelPosition.x + 9} cy={labelPosition.y - 3} r="3" fill={color} />
                  <text className="lineLabelText" x={labelPosition.x + 17} y={labelPosition.y + 1}>
                    {getDisplayName(product).slice(0, 21)}
                  </text>
                </g>
              ) : null}
            </g>
          )
        })}
        {tooltip ? (
          <g className="chartTooltip">
            <rect x={tooltip.x} y={tooltip.y} width={tooltipWidth} height={tooltipHeight} rx="6" />
            <text x={tooltip.x + 10} y={tooltip.y + 17}>{tooltip.productName.slice(0, 18)}</text>
            <text x={tooltip.x + 10} y={tooltip.y + 34}>
              {tooltip.time} / 분당 {formatNumber(tooltip.soldDelta)}건
            </text>
            <text x={tooltip.x + 10} y={tooltip.y + 49}>{formatWon(tooltip.amount)}</text>
          </g>
        ) : null}
      </svg>
    </div>
  )
}

export function SkRevenueDashboard({ inventory }) {
  const products = inventory.products || []
  const collectedAt = formatTime(inventory.collectedAt)

  return (
    <>
      <section className="panel largePanel revenuePanel" aria-label="SK 추정매출">
        <div className="panelHead">
          <span>SK 추정매출</span>
          <strong>{formatWon(inventory.totals?.estimatedRevenue)}</strong>
        </div>
        <div className="metricRow">
          <span>누적 추정 판매 {formatNumber(inventory.totals?.estimatedSold)}</span>
          <span>직전 수집 감소 {formatNumber(inventory.totals?.soldDelta)}</span>
          <span>수집 {collectedAt}</span>
        </div>
        <RevenueChart products={products} collectedAt={inventory.collectedAt} />
      </section>

      <section className="panel productMetrics" aria-label="SK 상품별 추정 현황">
        {products.map((product, index) => (
          <article className="metricItem" key={product.productId}>
            <span className="metricColor" style={{ background: getProductColor(index) }} />
            {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span className="metricThumb" />}
            <div>
              <strong>{product.productName}</strong>
              <span>
                {product.timeRange} / 잔여 {formatNumber(product.currentStock)} / 추정 {formatNumber(product.estimatedSold)}
              </span>
            </div>
            <em>{formatWon(product.estimatedRevenue)}</em>
          </article>
        ))}
        {!products.length ? <div className="emptyPanel">{inventory.error || 'SK 현재 방송 상품 수집 대기 중'}</div> : null}
      </section>

      <section className="panel compactPanel" aria-label="SK 수집 상태">
        <div className="panelHead">
          <span>60분 버퍼</span>
          <strong>{products.reduce((max, product) => Math.max(max, product.history?.length || 0), 0)}/60</strong>
        </div>
        <div className="metricStack">
          <span>현재 잔여 {formatNumber(inventory.totals?.currentStock)}</span>
          <span>대상 상품 {products.length}</span>
          <span>방송 구간 밖 라인 끊김</span>
        </div>
      </section>
    </>
  )
}
