import { ScheduleStrip } from './components/ScheduleStrip'
import { SkRevenueDashboard } from './components/SkRevenueDashboard'
import { useSkInventory } from './hooks/useSkInventory'
import { useSchedules } from './hooks/useSchedules'
import { scheduleSources } from './sources/scheduleSources'
import './App.css'

function App() {
  const schedules = useSchedules()
  const skInventory = useSkInventory()

  return (
    <main className="page">
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
