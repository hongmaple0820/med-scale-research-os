<script setup>
import { NCard, NGrid, NGi, NStatistic, NTag } from 'naive-ui'
import { useReportStore } from '../stores/report'
import DataSource from './DataSource.vue'

const store = useReportStore()
const s = store.sections
const gradeColors = { A: '#22c55e', B: '#3b82f6', C: '#f59e0b', D: '#ef4444', F: '#64748b' }
</script>

<template>
  <section style="margin-bottom:48px">
    <n-card :bordered="false" style="background:linear-gradient(135deg,#1a2744,#1e293b);border:2px solid var(--accent)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px">
        <div>
          <h1 style="font-size:36px;color:var(--accent-hover);margin:0">{{ store.gene }}</h1>
          <p style="font-size:16px;color:var(--fg-2);margin:4px 0 0">
            {{ s.protein?.name || '' }}
            <span v-if="store.disease" style="margin-left:12px;color:var(--fg-1)">· {{ store.disease }}</span>
          </p>
        </div>
        <n-tag v-if="s.research_profile?.overall_grade_info" :color="{color:gradeColors[s.research_profile.overall_grade_info.symbol]||'#3b82f6'}" size="large">
          {{ s.research_profile.overall_grade_info.symbol }} {{ s.research_profile.overall_grade_info.label }}
        </n-tag>
      </div>
      <n-grid :cols="4" :x-gap="16">
        <n-gi v-if="s.expression"><n-statistic label="检测组织" :value="s.expression.total_tissues"><template #suffix>个</template></n-statistic></n-gi>
        <n-gi v-if="s.survival"><n-statistic label="风险比 (HR)"><span :style="{color:s.survival.hazard_ratio>1?'var(--red)':'var(--green)'}">{{ s.survival.hazard_ratio?.toFixed(3)||'—' }}</span></n-statistic></n-gi>
        <n-gi v-if="s.competitive"><n-statistic label="临床试验" :value="s.competitive.total_trials||0" /></n-gi>
        <n-gi v-if="s.tme"><n-statistic label="TME 表型"><span :style="{color:s.tme.phenotype==='hot'?'var(--green)':'var(--amber)'}">{{ s.tme.phenotype_info?.name||s.tme.phenotype }}</span></n-statistic></n-gi>
      </n-grid>
      <p v-if="s.research_profile?.confidence_score" style="margin-top:20px;font-size:14px;color:var(--fg-1)">
        置信度: <strong style="color:var(--accent)">{{ s.research_profile.confidence_score }}%</strong>
      </p>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--bg-3)">
        <DataSource :provenance="{ sources: store.reportData?.dataSources || [] }" label="本报告数据源" />
      </div>
    </n-card>
  </section>
</template>
