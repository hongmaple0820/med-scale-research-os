<script setup>
import { computed } from 'vue'
import VChart from 'vue-echarts'

const props = defineProps({ phases: Array, totalMonths: Number })

const phaseColors = { Discovery:'#3b82f6','Hit To Lead':'#6366f1','Lead Optimization':'#8b5cf6',Preclinical:'#a855f7',Phase1:'#22c55e',Phase2:'#16a34a',Phase3:'#15803d',Approval:'#f59e0b' }

const option = computed(() => {
  const ps = props.phases || []
  if (!ps.length) return {}
  return {
    backgroundColor: 'transparent',
    tooltip: { formatter: p => `${ps[p.value[0]]?.name}<br/>${ps[p.value[0]]?.start} → ${ps[p.value[0]]?.end}<br/>${ps[p.value[0]]?.duration_months} 个月` },
    grid: { left: 120, right: 40, top: 20, bottom: 30 },
    xAxis: { type: 'value', axisLabel: { color: '#94a3b8', formatter: v => `M${v}` }, splitLine: { lineStyle: { color: '#334155' } } },
    yAxis: { type: 'category', data: ps.map(p => p.name), axisLabel: { color: '#e2e8f0' } },
    series: [{
      type: 'custom',
      renderItem: (params, api) => {
        const cat = api.value(0), start = api.value(1), end = api.value(2)
        const s = api.coord([start, cat]), e = api.coord([end, cat])
        return { type: 'rect', shape: { x: s[0], y: s[1]-12, width: e[0]-s[0], height: 24, r: 4 }, style: { fill: phaseColors[ps[cat]?.name] || '#3b82f6' } }
      },
      data: ps.map((p, i) => {
        const sm = monthsSince(p.start), em = monthsSince(p.end)
        return [i, sm, em]
      }),
      encode: { x: [1,2], y: 0 }
    }]
  }
})

function monthsSince(dateStr) {
  if (!dateStr) return 0
  const [y, m] = dateStr.split('-').map(Number)
  return (y - 2026) * 12 + (m || 1)
}
</script>

<template>
  <v-chart v-if="phases?.length" :option="option" style="height:300px" autoresize />
  <p v-else style="color:var(--fg-2);text-align:center;padding:40px">时间线数据不可用</p>
</template>
