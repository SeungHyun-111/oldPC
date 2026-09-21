# 주문/재고 집계 정책

이 문서는 RTDB에 저장하는 상품별 주문수, 주문금액, 재고추가량 계산 기준을 정리한다.

## 재고 계산식

분 단위 수집값:

```text
previousStock = 직전 수집 재고
currentStock = 현재 수집 재고
rawStockDelta = previousStock - currentStock
```

주문/재고추가 분리:

```text
soldDelta = max(rawStockDelta, 0)
restockDelta = max(-rawStockDelta, 0)
revenueDelta = soldDelta * price
```

누계:

```text
estimatedSold += soldDelta
estimatedRevenue += revenueDelta
restockQuantity += restockDelta
```

검증식:

```text
currentStock = initialStock + restockQuantity - estimatedSold
```

재고가 증가한 분은 확정 주문을 계산할 수 없으므로 `soldDelta = 0`, `revenueDelta = 0`으로 처리하고 증가분을 `restockDelta`에 기록한다. 즉 음수 주문수와 음수 주문금액은 만들지 않는다.

## RTDB 필드

상품 단위:

```text
currentStock       현재 재고
lastStock          다음 계산의 기준이 되는 직전 재고
initialStock       방송 세션 첫 기준 재고
rawStockDelta      직전 재고 - 현재 재고
soldDelta          분당 확정 주문수
revenueDelta       분당 확정 주문금액
estimatedSold      방송 세션 누적 확정 주문수
estimatedRevenue   방송 세션 누적 확정 주문금액
restockDelta       분당 재고추가량
restockQuantity    방송 세션 누적 재고추가량
price              주문금액 계산 단가
```

채널 totals:

```text
estimatedSold      상품별 estimatedSold 합계
estimatedRevenue   상품별 estimatedRevenue 합계
soldDelta          상품별 최신 soldDelta 합계
currentStock       상품별 currentStock 합계
```

## 가격 정책

주문금액은 각 수집 시점의 `price`로 계산한다.

### SK스토아

소스: 상품 상세 HTML `https://www.skstoa.com/display/goods/{productId}`

가격 추출 순서:

```text
selectedOptions["{productId}"]["001"].goodsPrice
goodsSalePrice
```

코드:

```text
server/skstoaInventory.js
parseSkDetail()
selectedPrice = selectedOptions...goodsPrice
goodsSalePrice = var goodsSalePrice = Number("...")
price = parseNumber(selectedPrice || goodsSalePrice)
```

### 신세계쇼핑

소스: 상세 API `https://www.shinsegaetvshopping.com/display/detailInfo`

가격 추출 순서:

```text
salePrice
dcPrice
goodsPrice
```

코드:

```text
server/shinsegaeInventory.js
parseDetailInfo()
price = salePrice ?? dcPrice ?? goodsPrice
```

### K쇼핑

소스: 상품 상세 API `https://www.kshop.co.kr/display/web/emc/product/{productId}`

가격 추출 경로:

```text
productModel.promotion.targetRvo.originalPrice
productModel.promotion.targetRvo.slPc
```

계산 단가:

```text
originalPrice = parseNumber(targetRvo.originalPrice)
slPc = parseNumber(targetRvo.slPc)
price = slPc || originalPrice || 0
```

K쇼핑은 편성표 가격이나 이전 가격을 fallback으로 사용하지 않는다. `originalPrice`와 `slPc`가 없으면 가격은 `0`이다.

## 브라우저 RTDB 퍼블리셔 병합

브라우저 퍼블리셔(`src/hooks/useLocalRtdbPublisher.js`)가 로컬 API 수집값을 RTDB 기존값과 병합할 때도 같은 재고 계산식을 사용한다.

가격 병합 기준:

```text
SK스토아: 최신 nextProduct.price만 사용
K쇼핑: 최신 nextProduct.price만 사용
신세계쇼핑: nextProduct.price가 있으면 사용, 없으면 previousProduct.price 사용
```

