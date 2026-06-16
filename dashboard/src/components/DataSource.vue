<script setup>
import { computed } from 'vue'
import { NTag, NTooltip } from 'naive-ui'

const props = defineProps({
  provenance: { type: Object, default: null },
  label: { type: String, default: '数据来源' },
})

const confColors = { HIGH: '#22c55e', MEDIUM: '#f59e0b', LOW: '#ef4444', SPECULATIVE: '#64748b' }
const sources = computed(() => props.provenance?.sources || [])

function fmtTime(t) {
  if (!t) return ''
  try { return new Date(t).toLocaleDateString('zh-CN') } catch { return '' }
}
</script>

<template>
  <div v-if="sources.length" style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--fg-2)">
    <span>{{ label }}:</span>
    <n-tooltip v-for="(s, i) in sources" :key="i" trigger="hover">
      <template #trigger>
        <span style="display:inline-flex;align-items:center;gap:4px">
          <a v-if="s.url" :href="s.url" target="_blank" rel="noopener" style="color:var(--accent-hover);text-decoration:none">{{ s.name }}</a>
          <span v-else>{{ s.name }}</span>
          <n-tag v-if="s.confidence" size="tiny" round :bordered="true"
            :color="{ color: 'transparent', textColor: confColors[s.confidence] || '#94a3b8', borderColor: confColors[s.confidence] || '#94a3b8' }">
            {{ s.confidence }}
          </n-tag>
        </span>
      </template>
      <div style="font-size:12px;line-height:1.6">
        <div>来源: {{ s.name }}</div>
        <div v-if="s.url" style="max-width:360px;word-break:break-all">URL: {{ s.url }}</div>
        <div v-if="s.confidence">置信度: {{ s.confidence }}</div>
        <div v-if="s.timestamp">采集: {{ fmtTime(s.timestamp) }}</div>
        <div>状态: {{ s.status || 'ok' }}</div>
      </div>
    </n-tooltip>
  </div>
  <div v-else style="font-size:12px;color:var(--red)">⚠ {{ label }}: 未标注溯源（数据可信性未校验）</div>
</template>
