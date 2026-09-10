import { CloudSun } from 'lucide-react'
import PageShell from '../components/PageShell'
import Weather from '../components/Weather'

export default function WeatherPage() {
  return (
    <PageShell icon={<CloudSun size={18} />} title="天气">
      <div className="page-card">
        <Weather />
      </div>
    </PageShell>
  )
}
