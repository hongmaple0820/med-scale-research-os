<script setup>
import { NCard, NButton, NGrid, NGi, NTag, NSpace } from 'naive-ui'
import { computed } from 'vue'
import { useReportStore } from '../stores/report'
import { getFileUrl } from '../api'

const store = useReportStore()
const rp = computed(() => store.sections.research_profile)
const gradeColors = {A:'#22c55e',B:'#3b82f6',C:'#f59e0b',D:'#ef4444',F:'#64748b'}
const pptxFile = computed(() => store.filesData?.files?.find(f => f.ext === '.pptx'))
const docxFile = computed(() => store.filesData?.files?.find(f => f.ext === '.docx'))

const fileUrl = (f) => getFileUrl(`${store.currentModule}/${f.relPath}`)

function copyJson() {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(JSON.stringify(store.reportData, null, 2))
  }
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(store.reportData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${store.currentModule || 'report'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const takeaways = computed(() => {
  const s = store.sections, items = []
  if (s.expression) items.push(`${store.gene} 在 ${s.expression.total_tissues} 个组织中检测到表达，Tau 指数 ${s.expression.tau_index?.toFixed(3)}`)
  if (s.survival) { const p = s.survival.cox_pvalue; items.push(p < 0.05 ? `生存分析显示显著预后价值 (HR=${s.survival.hazard_ratio?.toFixed(3)}, P=${p.toExponential(2)})` : `生存分析未达统计显著 (P=${p?.toFixed(3)})`) }
  if (s.tme) items.push(`TME 表型: ${s.tme.phenotype_info?.name || s.tme.phenotype}，免疫评分 ${s.tme.immune_score}/100`)
  if (s.competitive) items.push(`竞争格局: ${s.competitive.total_trials} 个临床试验，${s.competitive.approved_drugs?.length||0} 个上市药物`)
  if (s.milestones) items.push(`预计开发周期 ${(s.milestones.total_months/12).toFixed(1)} 年 (${s.milestones.modality||'未指定'})`)
  return items
})
</script>

<template>
  <section style="margin-bottom:48px">
    <h2 style="font-size:22px;color:var(--accent-hover);margin-bottom:16px;padding-left:12px;border-left:3px solid var(--accent)">
      结论与建议 <small style="font-size:13px;color:var(--fg-2);margin-left:8px">Conclusions</small>
    </h2>
    <n-card v-if="rp" style="margin-bottom:16px;background:linear-gradient(135deg,#1a2744,#1e293b)">
      <div style="display:flex;align-items:center;gap:24px;margin-bottom:16px">
        <div style="font-size:48px;font-weight:800" :style="{color:gradeColors[rp.overall_grade_info?.symbol]||'#3b82f6'}">{{ rp.overall_grade_info?.symbol||'—' }}</div>
        <div><h3 style="margin:0;font-size:20px">{{ rp.overall_grade_info?.label }}</h3><p style="color:var(--fg-2);margin:4px 0 0">{{ rp.overall_grade_info?.description }}</p><p style="color:var(--accent);margin:8px 0 0">置信度: {{ rp.confidence_score }}%</p></div>
      </div>
    </n-card>
    <n-card title="关键发现" style="margin-bottom:16px"><ul style="padding-left:20px;line-height:2.2"><li v-for="(item,i) in takeaways" :key="i" style="color:var(--fg-1)">{{ item }}</li></ul></n-card>
    <n-card v-if="rp?.paths?.length" title="研究路径评估" style="margin-bottom:16px">
      <n-grid :cols="rp.paths.length" :x-gap="12"><n-gi v-for="p in rp.paths" :key="p.id"><n-card size="small" style="text-align:center"><n-tag :color="{color:gradeColors[p.best_grade?.symbol]||'#3b82f6'}" size="small">{{ p.best_grade?.symbol }} {{ p.best_grade?.label }}</n-tag><p style="font-size:13px;margin-top:8px;color:var(--fg-1)">{{ p.name }}</p><p style="font-size:11px;color:var(--fg-2)">{{ p.evidence_count }} 条证据</p></n-card></n-gi></n-grid>
    </n-card>
    <n-card title="导出报告"><n-space><n-button v-if="pptxFile" type="primary" tag="a" :href="fileUrl(pptxFile)" download>下载 PPTX</n-button><n-button v-if="docxFile" type="info" tag="a" :href="fileUrl(docxFile)" download>下载 DOCX</n-button><n-button type="default" @click="downloadJson">下载 JSON</n-button><n-button quaternary @click="copyJson">复制 JSON</n-button></n-space></n-card>
    <p style="margin-top:16px;font-size:12px;color:var(--fg-3)">报告生成时间: {{ new Date().toLocaleDateString('zh-CN') }} · target-intelligence v2.0</p>
  </section>
</template>
