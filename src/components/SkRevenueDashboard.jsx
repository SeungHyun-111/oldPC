import { useMemo, useState } from 'react'

const channelColors = {
  SK: '#38bdf8',
  신세계: '#fb923c',
  K쇼핑: '#34d399',
}

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

function getDisplayName(product) {
  return (product.productName || product.productId || '').replace(/^\[[^\]]+\]/, '').trim()
}

function makePath(points) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x + 1} ${points[0].y}`
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
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

function buildTotalSeries(products) {
  const events = products
    .flatMap((product) =>
      (product.history || []).map((point) => ({
        collectedAt: point.collectedAt,
        productKey: product.rowId,
        revenue: point.estimatedRevenue || 0,
        sold: point.estimatedSold || 0,
      })),
    )
    .filter((event) => event.collectedAt)
    .sort((a, b) => a.collectedAt - b.collectedAt)

  const latestByProduct = new Map()
  const seriesByTime = new Map()

  for (const event of events) {
    latestByProduct.set(event.productKey, { revenue: event.revenue, sold: event.sold })
    const totals = [...latestByProduct.values()].reduce(
      (sum, product) => ({
        revenue: sum.revenue + product.revenue,
        sold: sum.sold + product.sold,
      }),
      { revenue: 0, sold: 0 },
    )
    seriesByTime.set(event.collectedAt, { collectedAt: event.collectedAt, ...totals })
  }

  return [...seriesByTime.values()].sort((a, b) => a.collectedAt - b.collectedAt)
}

function CombinedRevenueChart({ products, collectedAt }) {
  const [tooltip, setTooltip] = useState(null)
  const width = 970
  const height = 320
  const plot = {
    left: 42,
    top: 24,
    width: 900,
    height: 238,
  }
  const tooltipWidth = 176
  const tooltipHeight = 52
  const series = useMemo(() => buildTotalSeries(products), [products])
  const latestAt = collectedAt || series.at(-1)?.collectedAt || 0
  const firstAt = series[0]?.collectedAt || latestAt - 10 * 60 * 1000
  const chartStart = firstAt === latestAt ? latestAt - 10 * 60 * 1000 : firstAt
  const chartEnd = latestAt
  const maxValue = Math.max(1, ...series.map((point) => point.revenue)) * 1.12
  const points = series.map((point) => ({
    ...point,
    x: plot.left + ((point.collectedAt - chartStart) / Math.max(chartEnd - chartStart, 1)) * plot.width,
    y: plot.top + plot.height - (point.revenue / maxValue) * plot.height,
  }))
  const tickCount = 6
  const timeTicks = Array.from(
    { length: tickCount },
    (_, index) => chartStart + (index / Math.max(tickCount - 1, 1)) * (chartEnd - chartStart),
  )

  return (
    <div className="chartWrap">
      <svg
        className="revenueChart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="3사 총 주문금액 그래프"
      >
        {[0, 1, 2, 3, 4].map((line) => {
          const y = plot.top + (plot.height / 4) * line
          const value = maxValue - (maxValue / 4) * line
          return (
            <g key={line}>
              <line className="gridLine" x1={plot.left} x2={plot.left + plot.width} y1={y} y2={y} />
              <text className="axisText" x={plot.left - 8} y={y + 3} textAnchor="end">
                {Math.round(value / 10000).toLocaleString()}만
              </text>
            </g>
          )
        })}
        {timeTicks.map((tick) => {
          const x = plot.left + ((tick - chartStart) / Math.max(chartEnd - chartStart, 1)) * plot.width
          return (
            <g key={tick}>
              <line className="gridLine vertical" x1={x} x2={x} y1={plot.top} y2={plot.top + plot.height} />
              <text className="tickText" x={x} y={plot.top + plot.height + 24} textAnchor="middle">
                {formatTime(tick)}
              </text>
            </g>
          )
        })}
        <path className="totalRevenueLine" d={makePath(points)} />
        {points.map((point) => (
          <circle
            className="revenueDot"
            cx={point.x}
            cy={point.y}
            r="4"
            fill="#facc15"
            key={point.collectedAt}
            onMouseEnter={() => {
              const tooltipX = Math.min(width - tooltipWidth - 8, Math.max(8, point.x + 12))
              const tooltipY = Math.min(height - tooltipHeight - 8, Math.max(8, point.y - tooltipHeight - 10))
              setTooltip({
                x: tooltipX,
                y: tooltipY,
                time: formatTime(point.collectedAt),
                amount: point.revenue,
                sold: point.sold,
              })
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
        {tooltip ? (
          <g className="chartTooltip">
            <rect x={tooltip.x} y={tooltip.y} width={tooltipWidth} height={tooltipHeight} rx="6" />
            <text x={tooltip.x + 10} y={tooltip.y + 18}>{tooltip.time}</text>
            <text x={tooltip.x + 10} y={tooltip.y + 35}>주문 {formatNumber(tooltip.sold)}건</text>
            <text x={tooltip.x + 10} y={tooltip.y + 49}>{formatWon(tooltip.amount)}</text>
          </g>
        ) : null}
      </svg>
      {!series.length ? <div className="emptyPanel">매출 수집 데이터 대기 중</div> : null}
    </div>
  )
}

export function CombinedRevenueDashboard({ inventories }) {
  const products = useMemo(() => normalizeProducts(inventories), [inventories])
  const latestCollectedAt = Math.max(0, ...inventories.map(({ inventory }) => inventory.collectedAt || 0))
  const totals = products.reduce(
    (sum, product) => ({
      estimatedSold: sum.estimatedSold + (product.estimatedSold || 0),
      estimatedRevenue: sum.estimatedRevenue + (product.estimatedRevenue || 0),
      soldDelta: sum.soldDelta + (product.soldDelta || 0),
    }),
    { estimatedSold: 0, estimatedRevenue: 0, soldDelta: 0 },
  )
  const sortedProducts = [...products].sort((a, b) => (b.estimatedRevenue || 0) - (a.estimatedRevenue || 0))

  return (
    <section className="dashboardGrid combinedDashboard" aria-label="3사 통합 실시간 현황">
      <section className="panel largePanel revenuePanel" aria-label="3사 총 주문금액">
        <div className="panelHead">
          <span>3사 총 주문금액</span>
          <strong>{formatWon(totals.estimatedRevenue)}</strong>
        </div>
        <div className="metricRow">
          <span>총 주문수량 {formatNumber(totals.estimatedSold)}</span>
          <span>직전 수집 주문 {formatNumber(totals.soldDelta)}</span>
          <span>수집 {formatTime(latestCollectedAt)}</span>
        </div>
        <CombinedRevenueChart products={products} collectedAt={latestCollectedAt} />
      </section>

      <section className="panel productMetrics combinedProducts" aria-label="3사 상품별 주문 현황">
        {sortedProducts.map((product) => (
          <article className="metricItem" key={product.rowId}>
            <span className="metricColor" style={{ background: product.channelColor }} />
            {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span className="metricThumb" />}
            <div>
              <strong>{getDisplayName(product)}</strong>
              <span>
                {product.channel} / 주문 {formatNumber(product.estimatedSold)}건 / {product.timeRange}
              </span>
            </div>
            <em>{formatWon(product.estimatedRevenue)}</em>
          </article>
        ))}
        {!sortedProducts.length ? <div className="emptyPanel">3사 현재 방송 상품 수집 대기 중</div> : null}
      </section>
    </section>
  )
}
