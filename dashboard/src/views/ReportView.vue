<script setup>
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NLayout, NLayoutContent, NSpin, NResult } from 'naive-ui'
import { useReportStore } from '../stores/report'
import AppHeader from '../components/AppHeader.vue'
import SectionNav from '../components/SectionNav.vue'
import HeroSection from '../components/HeroSection.vue'
import ExpressionSection from '../components/ExpressionSection.vue'
import SurvivalSection from '../components/SurvivalSection.vue'
import ImmuneSection from '../components/ImmuneSection.vue'
import DruggabilitySection from '../components/DruggabilitySection.vue'
import TimelineSection from '../components/TimelineSection.vue'
import ConclusionsSection from '../components/ConclusionsSection.vue'

const route = useRoute()
const router = useRouter()
const store = useReportStore()

const sectionIds = ['hero', 'expression', 'survival', 'immune', 'druggability', 'timeline', 'conclusions']

onMounted(async () => {
  await store.loadModules()
  const mod = route.params.module || store.modules[0]
  if (mod) {
    store.selectModule(mod)
    router.replace({ name: 'report', params: { module: mod } })
  }
})

watch(() => route.params.module, (mod) => {
  if (mod && mod !== store.currentModule) store.selectModule(mod)
})

function onModuleChange(mod) {
  router.push({ name: 'report', params: { module: mod } })
}
</script>

<template>
  <n-layout style="min-height: 100vh">
    <AppHeader @module-change="onModuleChange" />
    <n-layout-content style="padding: 0 48px 80px; max-width: 1200px; margin: 0 auto">
      <div v-if="store.loading" style="display:flex;justify-content:center;padding:120px 0">
        <n-spin size="large" description="加载中..." />
      </div>
      <n-result v-else-if="store.error" status="error" title="加载失败" :description="store.error" />
      <template v-else-if="store.reportData">
        <HeroSection id="hero" />
        <ExpressionSection id="expression" />
        <SurvivalSection id="survival" />
        <ImmuneSection id="immune" />
        <DruggabilitySection id="druggability" />
        <TimelineSection id="timeline" />
        <ConclusionsSection id="conclusions" />
      </template>
      <n-result v-else status="info" title="请选择分析模块" description="从顶部下拉菜单选择一个靶点分析" />
    </n-layout-content>
    <SectionNav :sections="sectionIds" />
  </n-layout>
</template>
