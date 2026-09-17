import { ScheduleStrip } from './components/ScheduleStrip'
import { CombinedRevenueDashboard } from './components/SkRevenueDashboard'
import { useLocalRtdbPublisher } from './hooks/useLocalRtdbPublisher'
import { useChannelInventory } from './hooks/useSkInventory'
import { useSchedules } from './hooks/useSchedules'
import { scheduleSources } from './sources/scheduleSources'
import './App.css'

function App() {
  const publisher = useLocalRtdbPublisher()
  const schedules = useSchedules()
  const skInventory = useChannelInventory('skstoa', 'SK')
  const shinsegaeInventory = useChannelInventory('shinsegae', '신세계')
  const ktInventory = useChannelInventory('ktalpha', 'K쇼핑')

  return (
    <main className="page">
      {publisher.enabled ? (
        <div className={`publisherStatus ${publisher.error ? 'isError' : ''}`}>
          <span>{publisher.running ? 'RTDB 전송 중' : 'RTDB 전송 대기'}</span>
          {publisher.lastSuccessAt ? <time>{new Date(publisher.lastSuccessAt).toLocaleTimeString('ko-KR')}</time> : null}
          {publisher.error ? <strong>{publisher.error}</strong> : null}
        </div>
      ) : null}
      {scheduleSources.map((source) => (
        <ScheduleStrip
          key={source.key}
          label={source.label}
          schedule={schedules[source.key]}
          displayFilter={source.displayFilter}
        />
      ))}
      <CombinedRevenueDashboard
        inventories={[
          { label: 'SK', inventory: skInventory },
          { label: '신세계', inventory: shinsegaeInventory },
          { label: 'K쇼핑', inventory: ktInventory },
        ]}
      />
    </main>
  )
}

export default App
