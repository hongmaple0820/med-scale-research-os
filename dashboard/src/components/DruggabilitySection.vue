<script setup>
import { NCard, NGrid, NGi, NStatistic, NDataTable, NCollapse, NCollapseItem } from 'naive-ui'
import { computed } from 'vue'
import { useReportStore } from '../stores/report'
import PhaseChart from './charts/PhaseChart.vue'
import DataSource from './DataSource.vue'

const store = useReportStore()
const comp = computed(() => store.sections.competitive)
const patents = computed(() => store.sections.patents)

const trialColumns = [
  {title:'药物',key:'name',ellipsis:{tooltip:true}},
  {title:'机制',key:'mechanism',ellipsis:{tooltip:true}}
]
const trialData = computed(() => (comp.value?.approved_drugs||[]).map(d=>({name:d.name,mechanism:d.mechanism})))
</script>

<template>
  <section v-if="comp" style="margin-bottom:48px">
    <h2 style="font-size:22px;color:var(--accent-hover);margin-bottom:16px;padding-left:12px;border-left:3px solid var(--accent)">
      成药性与竞争格局 <small style="font-size:13px;color:var(--fg-2);margin-left:8px">Druggability & Competition</small>
    </h2>
    <p style="font-size:14px;color:var(--fg-2);margin-bottom:16px">{{ store.gene }} 的成药性和竞争格局如何？</p>
    <n-grid :cols="4" :x-gap="16" style="margin-bottom:16px">
      <n-gi><n-card><n-statistic label="临床试验" :value="comp.total_trials||0"/></n-card></n-gi>
      <n-gi><n-card><n-statistic label="上市药物" :value="comp.approved_drugs?.length||0"/></n-card></n-gi>
      <n-gi v-if="patents"><n-card><n-statistic label="相关专利" :value="patents.total||0"/></n-card></n-gi>
      <n-gi><n-card><n-statistic label="Phase 3" :value="comp.phase_distribution?.PHASE3||0"/></n-card></n-gi>
    </n-grid>
    <n-grid :cols="2" :x-gap="16" style="margin-bottom:16px">
      <n-gi><n-card title="临床试验分期分布"><PhaseChart :phases="comp.phase_distribution"/></n-card></n-gi>
      <n-gi><n-card title="上市药物"><n-data-table v-if="trialData.length" :columns="trialColumns" :data="trialData" :max-height="300" :bordered="false"/><p v-else style="color:var(--fg-2)">暂无上市药物数据</p></n-card></n-gi>
    </n-grid>
    <n-collapse v-if="patents?.top_assignees">
      <n-collapse-item title="专利权人分布" name="patents">
        <n-grid :cols="3" :x-gap="8" :y-gap="8">
          <n-gi v-for="(count, name) in patents.top_assignees" :key="name"><n-card size="small"><strong style="font-size:13px">{{ name }}</strong><p style="font-size:12px;color:var(--fg-2)">{{ count }} 项</p></n-card></n-gi>
        </n-grid>
      </n-collapse-item>
    </n-collapse>
    <div style="margin-top:16px"><DataSource :provenance="comp.provenance" /></div>
  </section>
</template>
