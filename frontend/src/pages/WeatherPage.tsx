/**
 * WeatherPage.tsx —— 天气（独立页面）
 *
 * 职责：
 *   用 PageShell 包一层页头，内部复用 Weather 组件展示实况与未来几天预报。
 *
 * 数据来源（重要）：
 *   页头右上角挂了 EngineChip，明确标注数据来自「高德地图」而非大模型。
 *   本页是纯接口数据展示，完全不经过 AI——标注来源可避免使用者误以为
 *   这些数字是模型「编」出来的。
 */
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
