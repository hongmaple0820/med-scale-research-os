<script setup>
import { computed } from 'vue'
import VChart from 'vue-echarts'

const props = defineProps({ phases: Object })

const option = computed(() => ({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  series: [{ type: 'pie', radius: ['40%', '70%'], data: Object.entries(props.phases || {}).map(([name, value]) => ({ name, value })), label: { color: '#94a3b8' } }]
}))
</script>

<template><v-chart :option="option" style="height:300px" autoresize /></template>
