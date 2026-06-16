<script setup>
import { computed } from 'vue'
import VChart from 'vue-echarts'

const props = defineProps({ tissues: Array })

const option = computed(() => {
  const ts = (props.tissues || []).slice(0, 20).reverse()
  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 180, right: 40, top: 20, bottom: 30 },
    xAxis: { type: 'value', name: 'TPM', axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#334155' } } },
    yAxis: { type: 'category', data: ts.map(t => t.tissue), axisLabel: { color: '#e2e8f0', fontSize: 11 } },
    series: [{ type: 'bar', data: ts.map(t => t.tpm), itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#3b82f6' }, { offset: 1, color: '#60a5fa' }] } }, barMaxWidth: 20 }]
  }
})
</script>

<template><v-chart :option="option" style="height:500px" autoresize /></template>
