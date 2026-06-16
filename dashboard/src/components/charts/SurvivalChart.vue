<script setup>
import { computed } from 'vue'
import VChart from 'vue-echarts'

const props = defineProps({ survival: Object })

const option = computed(() => {
  const s = props.survival
  if (!s?.km_high) return {}
  const hd = [], ld = []
  const toCurve = (km) => {
    const out = []
    const sf = km?.survival_function
    if (km?.timeline && Array.isArray(sf)) {
      for (let i = 0; i < km.timeline.length; i++) {
        if (sf[i] == null) continue
        out.push([Math.round(km.timeline[i] * 10) / 10, Math.round(sf[i] * 1000) / 10])
      }
    }
    return out
  }
  hd.push(...toCurve(s.km_high))
  ld.push(...toCurve(s.km_low))
  return {
    backgroundColor: 'transparent', tooltip: { trigger: 'axis' },
    legend: { data: [`高表达 (n=${s.n_high})`, `低表达 (n=${s.n_low})`], textStyle: { color: '#94a3b8' }, top: 0 },
    grid: { left: 60, right: 30, top: 40, bottom: 40 },
    xAxis: { type: 'value', name: '月', axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#334155' } } },
    yAxis: { type: 'value', name: '生存率 %', min: 0, max: 100, axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#334155' } } },
    series: [
      { name: `高表达 (n=${s.n_high})`, type: 'line', step: 'end', data: hd, lineStyle: { width: 2 }, itemStyle: { color: '#ef4444' }, symbol: 'none' },
      { name: `低表达 (n=${s.n_low})`, type: 'line', step: 'end', data: ld, lineStyle: { width: 2 }, itemStyle: { color: '#22c55e' }, symbol: 'none' }
    ]
  }
})
</script>

<template>
  <v-chart v-if="survival?.km_high" :option="option" style="height:400px" autoresize />
  <p v-else style="color:var(--fg-2);text-align:center;padding:40px">生存曲线数据不可用</p>
</template>
