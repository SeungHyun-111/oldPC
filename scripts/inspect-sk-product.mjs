import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const productId = process.argv[2] || '61841599'
const targetUrl = `https://www.skstoa.com/display/goods/${productId}`

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--ignore-certificate-errors'],
})
const page = await browser.newPage({
  viewport: { width: 1440, height: 1200 },
})
const records = []

page.on('response', async (response) => {
  const request = response.request()
  const url = response.url()
  const resourceType = request.resourceType()
  const interesting =
    ['document', 'xhr', 'fetch'].includes(resourceType) ||
    /goods|display|order|stock|option|able|inventory|61841599|api/i.test(url)

  if (!interesting) return

  let body = ''
  try {
    const contentType = response.headers()['content-type'] || ''
    if (/json|text|html|javascript/i.test(contentType)) {
      body = (await response.text()).slice(0, 20000)
    }
  } catch {
    body = ''
  }

  records.push({
    status: response.status(),
    method: request.method(),
    type: resourceType,
    url,
    contentType: response.headers()['content-type'] || '',
    body,
  })
})

try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(10000)
} finally {
  await writeFile('sk-product-network.json', JSON.stringify(records, null, 2), 'utf8')
  console.log(`url=${targetUrl}`)
  console.log(`records=${records.length}`)
  for (const record of records) {
    const hasStockHint = /briefOrderAbleCnt|orderAble|stock|option|재고|주문가능/i.test(record.body)
    console.log(`${record.status} ${record.type} ${record.method} ${hasStockHint ? '[stock?]' : ''} ${record.url}`)
  }
  await browser.close()
}
