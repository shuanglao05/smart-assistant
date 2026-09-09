import PageShell from '../components/PageShell'
import Weather from '../components/Weather'

export default function WeatherPage() {
  return (
    <PageShell icon="🌤" title="天气">
      <div className="page-card">
        <Weather />
      </div>
    </PageShell>
  )
}
