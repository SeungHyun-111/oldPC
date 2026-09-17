export const scheduleSources = [
  { key: 'skstoa', label: 'SK스토아', endpoint: '/api/skstoa/schedule' },
  { key: 'shinsegae', label: '신세계쇼핑', endpoint: '/api/shinsegae/schedule', displayFilter: (item) => item.hasVod },
  { key: 'ktalpha', label: 'KT알파쇼핑', endpoint: '/api/ktalpha/schedule' },
]
