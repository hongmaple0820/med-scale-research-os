<script setup>
import { NCard, NGrid, NGi, NStatistic, NDataTable, NAlert } from 'naive-ui'
import { computed } from 'vue'
import { useReportStore } from '../stores/report'
import ImmuneChart from './charts/ImmuneChart.vue'
import DataSource from './DataSource.vue'

const store = useReportStore()
const immune = computed(() => store.sections.immune)
const tme = computed(() => store.sections.tme)
const tmeColors = {hot:'#22c55e',cold:'#64748b',excluded:'#f59e0b',immunosuppressive:'#ef4444'}

const columns = [
  {title:'免疫细胞',key:'cell',ellipsis:{tooltip:true}},
  {title:'r',key:'r',sorter:(a,b)=>a.r-b.r,render:r=>r.r?.toFixed(3)},
  {title:'P',key:'pvalue',render:r=>r.pvalue?.toExponential(2)||'—'},
  {title:'校正P',key:'adj_pvalue',render:r=>r.adj_pvalue?.toExponential(2)||'—'},
  {title:'显著',key:'significant',render:r=>r.significant?'✓':''}
]
</script>

<template>
  <section v-if="immune||tme" style="margin-bottom:48px">
    <h2 style="font-size:22px;color:var(--accent-hover);margin-bottom:16px;padding-left:12px;border-left:3px solid var(--accent)">
      免疫微环境 <small style="font-size:13px;color:var(--fg-2);margin-left:8px">Tumor Microenvironment</small>
    </h2>
    <p style="font-size:14px;color:var(--fg-2);margin-bottom:16px">{{ store.gene }} 与肿瘤免疫微环境的关系？</p>
    <n-grid v-if="tme" :cols="4" :x-gap="16" style="margin-bottom:16px">
      <n-gi><n-card><n-statistic label="TME 表型"><span :style="{color:tmeColors[tme.phenotype]||'#3b82f6'}">{{ tme.phenotype_info?.name||tme.phenotype }}</span></n-statistic></n-card></n-gi>
      <n-gi><n-card><n-statistic label="免疫评分" :value="tme.immune_score"><template #suffix>/100</template></n-statistic></n-card></n-gi>
      <n-gi><n-card><n-statistic label="基质评分" :value="tme.stromal_score"><template #suffix>/100</template></n-statistic></n-card></n-gi>
      <n-gi v-if="immune"><n-card><n-statistic label="显著关联" :value="immune.cells?.filter(c=>c.significant).length||0"><template #suffix>种</template></n-statistic></n-card></n-gi>
    </n-grid>
    <n-card v-if="immune" title="免疫细胞相关性" style="margin-bottom:16px"><ImmuneChart :cells="immune.cells"/></n-card>
    <n-card v-if="immune" title="免疫细胞数据"><n-data-table :columns="columns" :data="immune.cells||[]" :max-height="400" :bordered="false"/></n-card>
    <n-alert v-if="tme?.immunotherapy_prediction" :type="tme.phenotype==='hot'?'success':'warning'" style="margin-top:16px">
      <p><strong>免疫治疗预测:</strong> {{ tme.immunotherapy_prediction.prediction }}</p>
      <ul v-if="tme.immunotherapy_prediction.recommendations?.length" style="margin-top:8px;padding-left:20px"><li v-for="r in tme.immunotherapy_prediction.recommendations" :key="r">{{ r }}</li></ul>
    </n-alert>
    <div style="margin-top:16px"><DataSource :provenance="immune?.provenance || tme?.provenance" /></div>
  </section>
</template>
