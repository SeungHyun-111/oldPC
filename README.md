# oldPC

홈쇼핑 편성/재고 데이터를 수집해서 Firebase Realtime Database에 저장하고, React 화면은 RTDB를 구독해서 보여주는 대시보드입니다.

## 로컬 수집 워커

수집 PC에는 Node.js와 이 프로젝트 폴더가 필요합니다.

1. Firebase 콘솔에서 서비스 계정 키 JSON을 내려받아 프로젝트 루트에 `firebase-service-account.json`으로 둡니다.
2. `.env.example`을 `.env`로 복사합니다.
3. 아래 명령을 실행합니다.

```bash
npm install
npm run collector
```

기본값은 60초마다 수집하고 `oldpc` 경로 아래에 저장합니다.

```text
oldpc/channels/skstoa/schedule
oldpc/channels/skstoa/inventory
oldpc/channels/shinsegae/schedule
oldpc/channels/ktalpha/schedule
oldpc/collector
```

브라우저 화면은 같은 RTDB 경로를 실시간 구독합니다.

## 개발 서버

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

기존 로컬 API 서버가 필요하면 아래 명령으로 켤 수 있습니다.

```bash
npm run api
```
