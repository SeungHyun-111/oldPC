import { ScheduleStrip } from './components/ScheduleStrip'
import { SkRevenueDashboard } from './components/SkRevenueDashboard'
import { useLocalRtdbPublisher } from './hooks/useLocalRtdbPublisher'
import { useSkInventory } from './hooks/useSkInventory'
import { useSchedules } from './hooks/useSchedules'
import { scheduleSources } from './sources/scheduleSources'
import './App.css'

function App() {
  const publisher = useLocalRtdbPublisher()
  const schedules = useSchedules()
  const skInventory = useSkInventory()

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
        <ScheduleStrip key={source.key} label={source.label} schedule={schedules[source.key]} />
      ))}
      <section className="dashboardGrid" aria-label="실시간 현황">
        <SkRevenueDashboard inventory={skInventory} />
      </section>
    </main>
  )
}

export default App
