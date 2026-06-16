<script setup>
import { computed } from 'vue'
import VChart from 'vue-echarts'

const props = defineProps({ cells: Array })

const option = computed(() => {
  const cs = (props.cells || []).filter(c => c.r != null).sort((a, b) => a.r - b.r)
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => { const c = cs[p[0].dataIndex]; return `${c.cell}<br/>r=${c.r?.toFixed(3)}<br/>P=${c.pvalue?.toExponential(2)}<br/>${c.significant?'✓ 显著':'不显著'}` } },
    grid: { left: 140, right: 40, top: 20, bottom: 30 },
    xAxis: { type: 'value', name: 'r', axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#334155' } } },
    yAxis: { type: 'category', data: cs.map(c => c.cell), axisLabel: { color: '#e2e8f0', fontSize: 11 } },
    series: [{ type: 'bar', data: cs.map(c => c.r), itemStyle: { color: p => cs[p.dataIndex].r > 0 ? '#22c55e' : '#ef4444' }, barMaxWidth: 16 }]
  }
})
</script>

<template><v-chart :option="option" style="height:400px" autoresize /></template>
