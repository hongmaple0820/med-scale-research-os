<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({ sections: Array })
const activeSection = ref(props.sections?.[0] || 'hero')

const labels = {
  hero: '总览', expression: '表达谱', survival: '生存分析',
  immune: '免疫微环境', druggability: '成药性', timeline: '时间线', conclusions: '结论'
}

let observer = null

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) activeSection.value = e.target.id
    }
  }, { rootMargin: '-20% 0px -60% 0px' })
  props.sections?.forEach(id => {
    const el = document.getElementById(id)
    if (el) observer.observe(el)
  })
})

onUnmounted(() => observer?.disconnect())

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}
</script>

<template>
  <nav style="position:fixed;right:24px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:12px;z-index:100">
    <div
      v-for="id in sections" :key="id"
      @click="scrollTo(id)"
      :style="{
        width:'10px',height:'10px',borderRadius:'50%',
        background:activeSection===id?'var(--accent)':'var(--bg-3)',
        cursor:'pointer',transition:'all 0.2s',
        border:activeSection===id?'2px solid var(--accent-hover)':'2px solid transparent'
      }"
      :title="labels[id]||id"
    />
  </nav>
</template>
