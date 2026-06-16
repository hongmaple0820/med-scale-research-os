<script setup>
import { NCard, NGrid, NGi, NStatistic, NDataTable, NCollapse, NCollapseItem } from 'naive-ui'
import { computed } from 'vue'
import { useReportStore } from '../stores/report'
import ExpressionChart from './charts/ExpressionChart.vue'
import DataSource from './DataSource.vue'

const store = useReportStore()
const expr = computed(() => store.sections.expression)
const protein = computed(() => store.sections.protein)

const columns = [
  { title: '组织', key: 'tissue', ellipsis: {tooltip:true} },
  { title: 'TPM', key: 'tpm', sorter: (a,b) => a.tpm - b.tpm, render: row => row.tpm?.toFixed(2) }
]
const tableData = computed(() => (expr.value?.tissues || []).map(t => ({tissue:t.tissue,tpm:t.tpm})))
</script>

<template>
  <section v-if="expr" style="margin-bottom:48px">
    <h2 style="font-size:22px;color:var(--accent-hover);margin-bottom:16px;padding-left:12px;border-left:3px solid var(--accent)">
      表达谱分析 <small style="font-size:13px;color:var(--fg-2);margin-left:8px">Expression Profile</small>
    </h2>
    <p style="font-size:14px;color:var(--fg-2);margin-bottom:16px">{{ store.gene }} 在哪些组织中表达？</p>
    <n-grid :cols="3" :x-gap="16" style="margin-bottom:16px">
      <n-gi><n-card><n-statistic label="检测组织" :value="expr.total_tissues"><template #suffix>个</template></n-statistic></n-card></n-gi>
      <n-gi><n-card><n-statistic label="Tau 指数" :value="expr.tau_index?.toFixed(3)"/><p style="font-size:12px;color:var(--fg-2);margin-top:4px">{{ expr.specificity }}</p></n-card></n-gi>
      <n-gi v-if="expr.tissues?.length"><n-card><n-statistic label="最高表达" :value="expr.tissues[0]?.tpm?.toFixed(1)"><template #suffix>TPM</template></n-statistic><p style="font-size:12px;color:var(--fg-2);margin-top:4px">{{ expr.tissues[0]?.tissue }}</p></n-card></n-gi>
    </n-grid>
    <n-card title="组织表达谱" style="margin-bottom:16px"><ExpressionChart :tissues="expr.tissues" /></n-card>
    <n-card title="组织表达数据"><n-data-table :columns="columns" :data="tableData" :max-height="400" :bordered="false"/></n-card>
    <n-collapse v-if="protein" style="margin-top:16px">
      <n-collapse-item title="蛋白信息 (UniProt)" name="protein">
        <p><strong>{{ protein.name }}</strong> — {{ protein.accession }}</p>
        <p v-if="protein.subcellular_location" style="color:var(--fg-2);margin-top:4px">亚细胞定位: {{ protein.subcellular_location }}</p>
        <div v-if="protein.interactions?.length" style="margin-top:12px">
          <p style="font-size:12px;color:var(--fg-2);margin-bottom:8px">STRING 互作蛋白:</p>
          <n-grid :cols="5" :x-gap="8"><n-gi v-for="i in protein.interactions" :key="i.partner"><n-card size="small" style="text-align:center"><strong>{{ i.partner }}</strong><p style="font-size:11px;color:var(--fg-2)">{{ i.score?.toFixed(3) }}</p></n-card></n-gi></n-grid>
        </div>
      </n-collapse-item>
    </n-collapse>
    <div style="margin-top:16px"><DataSource :provenance="expr.provenance" /></div>
  </section>
</template>
