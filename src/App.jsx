import { useMemo } from 'react'
import { ScheduleStrip } from './components/ScheduleStrip'
import { CombinedRevenueDashboard } from './components/SkRevenueDashboard'
import { useLocalRtdbPublisher } from './hooks/useLocalRtdbPublisher'
import { useChannelInventory } from './hooks/useSkInventory'
import { useSchedules } from './hooks/useSchedules'
import { scheduleSources } from './sources/scheduleSources'
import './App.css'

function App() {
  useLocalRtdbPublisher()
  const schedules = useSchedules()
  const skInventory = useChannelInventory('skstoa', 'SK')
  const shinsegaeInventory = useChannelInventory('shinsegae', '신세계')
  const ktInventory = useChannelInventory('ktalpha', 'K쇼핑')
  const chartPrograms = useMemo(
    () =>
      scheduleSources.flatMap((source) => {
        const items = source.displayFilter ? schedules[source.key].items.filter(source.displayFilter) : schedules[source.key].items
        return items.map((item) => ({
          ...item,
          sourceKey: source.key,
        })).filter((item) => item.isMainProduct !== false)
      }),
    [schedules],
  )

  return (
    <main className="page">
      {scheduleSources.map((source) => (
        <ScheduleStrip
          key={source.key}
          label={source.label}
          schedule={schedules[source.key]}
          displayFilter={source.displayFilter}
          inventory={
            {
              skstoa: skInventory,
              shinsegae: shinsegaeInventory,
              ktalpha: ktInventory,
            }[source.key]
          }
        />
      ))}
      <CombinedRevenueDashboard
        inventories={[
          { label: 'SK', inventory: skInventory },
          { label: '신세계', inventory: shinsegaeInventory },
          { label: 'K쇼핑', inventory: ktInventory },
        ]}
        programs={chartPrograms}
      />
    </main>
  )
}

export default App
