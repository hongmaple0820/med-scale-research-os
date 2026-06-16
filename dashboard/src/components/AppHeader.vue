<script setup>
import { computed } from 'vue'
import { NSelect } from 'naive-ui'
import { useReportStore } from '../stores/report'

const emit = defineEmits(['module-change'])
const store = useReportStore()

const moduleOptions = computed(() =>
  store.modules.map(m => ({ label: m.replace(/_/g, ' '), value: m }))
)
</script>

<template>
  <header style="background:linear-gradient(135deg,#1e3a5f,#0f172a);border-bottom:1px solid var(--bg-3);padding:16px 48px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <h1 style="font-size:22px;color:var(--accent-hover);margin:0">靶点智能分析平台</h1>
      <p style="font-size:12px;color:var(--fg-2);margin:0">药物靶点系统性评估 · Nature-style</p>
    </div>
    <n-select
      :value="store.currentModule"
      :options="moduleOptions"
      placeholder="选择分析模块"
      style="width:240px"
      @update:value="emit('module-change', $event)"
    />
  </header>
</template>
