import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fetchModules, fetchReport, fetchFiles } from '../api'

export const useReportStore = defineStore('report', () => {
  const modules = ref([])
  const currentModule = ref(null)
  const reportData = ref(null)
  const filesData = ref(null)
  const loading = ref(false)
  const error = ref(null)

  const sections = computed(() => reportData.value?.sections || {})
  const gene = computed(() => {
    const name = currentModule.value || ''
    return name.split('_')[0] || name
  })
  const disease = computed(() => {
    const name = currentModule.value || ''
    const parts = name.split('_')
    return parts.length > 1 ? parts.slice(1).join(' ') : ''
  })

  async function loadModules() {
    try {
      modules.value = await fetchModules()
    } catch (e) {
      error.value = e.message
    }
  }

  async function selectModule(mod) {
    if (!mod) return
    loading.value = true
    error.value = null
    currentModule.value = mod
    try {
      const [report, files] = await Promise.all([
        fetchReport(mod),
        fetchFiles(mod)
      ])
      reportData.value = report
      filesData.value = files
    } catch (e) {
      error.value = e.message
      reportData.value = null
      filesData.value = null
    } finally {
      loading.value = false
    }
  }

  return {
    modules, currentModule, reportData, filesData, loading, error,
    sections, gene, disease,
    loadModules, selectModule
  }
})
