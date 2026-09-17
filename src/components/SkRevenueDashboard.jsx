const chartMinutes = 60

function formatWon(value) {
  return `${Math.round(value || 0).toLocaleString()}원`
}

function formatNumber(value) {
  return Math.round(value || 0).toLocaleString()
}

function formatTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
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

function getPointPosition(point, chartStart, chartEnd, width, height, maxValue) {
  const x = ((point.collectedAt - chartStart) / (chartEnd - chartStart)) * width
  const y = height - ((point.estimatedRevenue || 0) / Math.max(maxValue, 1)) * height
  return { x, y }
}

function getLineSegments(product, chartStart, chartEnd, width, height, maxValue) {
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

    current.push(getPointPosition(point, chartStart, chartEnd, width, height, maxValue))
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

function RevenueChart({ products, collectedAt }) {
  const plotWidth = 860
  const labelWidth = 110
  const width = plotWidth + labelWidth
  const height = 260
  const latestPointAt = Math.max(0, ...products.flatMap((product) => (product.history || []).map((point) => point.collectedAt || 0)))
  const now = collectedAt || latestPointAt
  const chartEnd = now
  const chartStart = chartEnd - chartMinutes * 60 * 1000
  const visiblePoints = products.flatMap((product) =>
    (product.history || []).filter(
      (point) => chartStart <= point.collectedAt && point.collectedAt <= chartEnd && isInsideBroadcast(product, point.collectedAt),
    ),
  )
  const maxValue = Math.max(1, ...visiblePoints.map((point) => point.estimatedRevenue || 0))
  const timeTicks = Array.from({ length: 7 }, (_, index) => chartStart + index * 10 * 60 * 1000)

  return (
    <div className="chartWrap">
      <svg className="revenueChart" viewBox={`0 0 ${width} ${height + 30}`} role="img" aria-label="SK 추정매출 60분 그래프">
        {[0, 1, 2, 3, 4].map((line) => {
          const y = (height / 4) * line
          return <line className="gridLine" x1="0" x2={plotWidth} y1={y} y2={y} key={line} />
        })}
        {timeTicks.map((tick) => {
          const x = ((tick - chartStart) / (chartEnd - chartStart)) * plotWidth
          return (
            <g key={tick}>
              <line className="gridLine vertical" x1={x} x2={x} y1="0" y2={height} />
              <text className="tickText" x={x} y={height + 22} textAnchor="middle">
                {formatTime(tick)}
              </text>
            </g>
          )
        })}
        {products.map((product, index) => {
          const color = getProductColor(index)
          const segments = getLineSegments(product, chartStart, chartEnd, plotWidth, height, maxValue)
          const labelPoint = getLastSegmentPoint(segments)
          const labelX = labelPoint ? Math.min(width - 98, Math.max(labelPoint.x + 10, plotWidth + 6)) : 0
          const labelY = labelPoint ? Math.max(18, Math.min(height - 12, labelPoint.y - 10)) : 0

          return (
            <g key={product.productId}>
              {segments.map((segment, segmentIndex) => (
                <path className="revenueLine" d={makePath(segment)} stroke={color} key={segmentIndex} />
              ))}
              {segments.flat().map((point, pointIndex) => (
                <circle className="revenueDot" cx={point.x} cy={point.y} r="3.2" fill={color} key={pointIndex} />
              ))}
              {labelPoint ? (
                <g>
                  <line className="labelGuide" x1={labelPoint.x} x2={labelX} y1={labelPoint.y} y2={labelY} />
                  <rect className="lineLabelBox" x={labelX} y={labelY - 14} width="94" height="22" rx="5" />
                  <circle cx={labelX + 9} cy={labelY - 3} r="3" fill={color} />
                  <text className="lineLabelText" x={labelX + 17} y={labelY + 1}>
                    {getDisplayName(product).slice(0, 7)}
                  </text>
                </g>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function SkRevenueDashboard({ inventory }) {
  const products = inventory.products || []
  const collectedAt = inventory.collectedAt ? new Date(inventory.collectedAt).toLocaleTimeString('ko-KR') : '-'

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
