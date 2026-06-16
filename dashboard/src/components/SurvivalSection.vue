<script setup>
import { NCard, NGrid, NGi, NStatistic, NAlert } from 'naive-ui'
import { computed } from 'vue'
import { useReportStore } from '../stores/report'
import SurvivalChart from './charts/SurvivalChart.vue'
import DataSource from './DataSource.vue'

const store = useReportStore()
const surv = computed(() => store.sections.survival)

const confidence = computed(() => {
  if (!surv.value) return null
  const p = surv.value.cox_pvalue
  if (p != null && p < 0.01) return {level:'HIGH',color:'var(--green)'}
  if (p != null && p < 0.05) return {level:'MEDIUM',color:'var(--amber)'}
  return {level:'LOW',color:'var(--red)'}
})

const interpretation = computed(() => {
  if (!surv.value) return ''
  const hr = surv.value.hazard_ratio, p = surv.value.cox_pvalue
  if (p == null) return '生存数据不可用'
  const sig = p < 0.05, dir = hr > 1 ? '高表达与不良预后相关' : '高表达与较好预后相关'
  return sig ? `${store.gene} ${dir} (P=${p.toExponential(2)})。` : `${store.gene} 表达与预后无显著相关性 (P=${p.toFixed(3)})。`
})
</script>

<template>
  <section v-if="surv" style="margin-bottom:48px">
    <h2 style="font-size:22px;color:var(--accent-hover);margin-bottom:16px;padding-left:12px;border-left:3px solid var(--accent)">
      生存分析 <small style="font-size:13px;color:var(--fg-2);margin-left:8px">Survival Analysis</small>
    </h2>
    <p style="font-size:14px;color:var(--fg-2);margin-bottom:16px">{{ store.gene }} 表达水平与患者预后的关系？</p>
    <n-grid :cols="4" :x-gap="16" style="margin-bottom:16px">
      <n-gi><n-card><n-statistic label="HR"><span :style="{color:surv.hazard_ratio>1?'var(--red)':'var(--green)'}">{{ surv.hazard_ratio?.toFixed(3)||'—' }}</span><template #suffix><span style="font-size:11px;color:var(--fg-2)">[{{ surv.hr_ci_lower?.toFixed(2)||'?' }}-{{ surv.hr_ci_upper?.toFixed(2)||'?' }}]</span></template></n-statistic></n-card></n-gi>
      <n-gi><n-card><n-statistic label="Cox P" :value="surv.cox_pvalue?.toExponential(2)||'—'"/></n-card></n-gi>
      <n-gi><n-card><n-statistic label="高表达中位生存" :value="surv.median_high?.toFixed(1)||'—'"><template #suffix>月</template></n-statistic><p style="font-size:11px;color:var(--fg-2)">{{ surv.n_high }} 例</p></n-card></n-gi>
      <n-gi><n-card><n-statistic label="低表达中位生存" :value="surv.median_low?.toFixed(1)||'—'"><template #suffix>月</template></n-statistic><p style="font-size:11px;color:var(--fg-2)">{{ surv.n_low }} 例</p></n-card></n-gi>
    </n-grid>
    <n-card title="Kaplan-Meier 生存曲线" style="margin-bottom:16px"><SurvivalChart :survival="surv"/></n-card>
    <n-alert v-if="interpretation" :type="confidence?.level==='HIGH'?'success':confidence?.level==='MEDIUM'?'warning':'info'" style="margin-bottom:12px">{{ interpretation }}</n-alert>
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <DataSource :provenance="surv.provenance" />
      <span v-if="confidence" :style="{color:confidence.color,fontSize:'12px'}">统计置信度 ● {{ confidence.level }}</span>
    </div>
  </section>
</template>
