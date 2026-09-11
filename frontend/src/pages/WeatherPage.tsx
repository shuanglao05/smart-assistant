import { Cloud, CloudSun } from 'lucide-react'
import PageShell from '../components/PageShell'
import EngineChip from '../components/EngineChip'
import Weather from '../components/Weather'

export default function WeatherPage() {
  return (
    <PageShell
      icon={<CloudSun size={18} />}
      title="天气"
      model={
        <EngineChip
          icon={<Cloud size={14} />}
          label="高德地图"
          sub="天气"
          title="天气数据来自高德地图（AMAP），并非对话大模型"
        />
      }
    >
      <div className="page-card">
        <Weather />
      </div>
    </PageShell>
  )
}
