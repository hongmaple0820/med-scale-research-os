<script setup>
import { NCard, NGrid, NGi, NStatistic, NAlert } from 'naive-ui'
import { computed } from 'vue'
import { useReportStore } from '../stores/report'
import TimelineGantt from './charts/TimelineGantt.vue'

const store = useReportStore()
const ms = computed(() => store.sections.milestones)
</script>

<template>
  <section v-if="ms" style="margin-bottom:48px">
    <h2 style="font-size:22px;color:var(--accent-hover);margin-bottom:16px;padding-left:12px;border-left:3px solid var(--accent)">
      开发时间线 <small style="font-size:13px;color:var(--fg-2);margin-left:8px">Development Timeline</small>
    </h2>
    <p style="font-size:14px;color:var(--fg-2);margin-bottom:16px">从靶点到上市需要多长时间？</p>
    <n-grid :cols="3" :x-gap="16" style="margin-bottom:16px">
      <n-gi><n-card><n-statistic label="总周期"><span style="color:var(--accent)">{{ (ms.total_months/12).toFixed(1) }}</span><template #suffix>年</template></n-statistic></n-card></n-gi>
      <n-gi><n-card><n-statistic label="药物模态" :value="ms.modality||'—'"/></n-card></n-gi>
      <n-gi><n-card><n-statistic label="阶段数" :value="ms.phases?.length||0"/></n-card></n-gi>
    </n-grid>
    <n-card title="开发里程碑甘特图" style="margin-bottom:16px"><TimelineGantt :phases="ms.phases" :total-months="ms.total_months"/></n-card>
    <n-alert v-if="ms.risks?.length" type="warning" style="margin-bottom:16px"><p><strong>风险因素:</strong></p><ul style="padding-left:20px;margin-top:8px"><li v-for="r in ms.risks" :key="r">{{ r }}</li></ul></n-alert>
    <n-alert v-if="ms.adjustments?.length" type="info" style="margin-bottom:16px"><p><strong>数据驱动调整:</strong></p><ul style="padding-left:20px;margin-top:8px"><li v-for="a in ms.adjustments" :key="a.factor">{{ a.factor }}: {{ a.description }} ({{ a.delta_months>0?'+':'' }}{{ a.delta_months }}月)</li></ul></n-alert>
    <p style="font-size:13px;color:var(--fg-2)">数据来源: 内部分析 · OpenAlex</p>
  </section>
</template>
