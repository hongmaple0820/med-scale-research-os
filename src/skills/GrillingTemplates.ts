// SCALE Engine - Grilling Templates (mattpocock/skills style)
// 预定义决策树模板

import type { GrillingQuestion, GrillingOption } from "./GrillingSessionSkill.js"

// ========== Requirement Clarity 决策树 ==========
export const REQUIREMENT_CLARITY_TREE: GrillingQuestion[] = [
  { id: "Q1", question: "Target users?", options: [ { id: "internal", label: "Internal users", explanation: "Team/company internal" }, { id: "external", label: "External users", explanation: "Public users" }, { id: "both", label: "Mixed", explanation: "Both types" } ], branchMap: { internal: "Q2", external: "Q3", both: "Q4" } },
  { id: "Q2", question: "Internal complexity level?", options: [ { id: "simple", label: "Simple", explanation: "Basic workflow" }, { id: "moderate", label: "Moderate", explanation: "Multiple steps" }, { id: "complex", label: "Complex", explanation: "Enterprise-grade" } ], branchMap: { simple: "CONCLUSION", moderate: "CONCLUSION", complex: "Q5" } },
  { id: "Q3", question: "External user scale?", options: [ { id: "small", label: "Small (<100)", explanation: "Limited user base" }, { id: "medium", label: "Medium (100-10k)", explanation: "Growing user base" }, { id: "large", label: "Large (>10k)", explanation: "High scale, need optimization" } ], branchMap: { small: "CONCLUSION", medium: "Q6", large: "Q7" } },
  { id: "Q4", question: "Primary user focus?", options: [ { id: "internal", label: "Internal priority", explanation: "Internal needs first" }, { id: "external", label: "External priority", explanation: "Public users first" }, { id: "balanced", label: "Balanced", explanation: "Equal consideration" } ], branchMap: { internal: "Q2", external: "Q3", balanced: "Q8" } },
  { id: "Q5", question: "Security requirements?", options: [ { id: "basic", label: "Basic auth", explanation: "Simple authentication" }, { id: "advanced", label: "Role-based", explanation: "RBAC permissions" }, { id: "enterprise", label: "Enterprise SSO", explanation: "SSO integration required" } ], branchMap: { basic: "CONCLUSION", advanced: "CONCLUSION", enterprise: "CONCLUSION" } },
  { id: "Q6", question: "User registration needed?", options: [ { id: "optional", label: "Optional", explanation: "Guest access available" }, { id: "required", label: "Required", explanation: "Must register to use" }, { id: "social", label: "Social login", explanation: "OAuth/Social auth" } ], branchMap: { optional: "CONCLUSION", required: "CONCLUSION", social: "CONCLUSION" } },
  { id: "Q7", question: "Performance critical?", options: [ { id: "yes", label: "Yes - high traffic", explanation: "Need high performance" }, { id: "no", label: "No - normal traffic", explanation: "Standard performance OK" } ], branchMap: { yes: "CONCLUSION", no: "CONCLUSION" } },
  { id: "Q8", question: "UX consistency priority?", options: [ { id: "high", label: "High - unified UX", explanation: "Consistent across all" }, { id: "medium", label: "Medium", explanation: "Some variation OK" }, { id: "low", label: "Low - separate UX", explanation: "Different UX per segment" } ], branchMap: { high: "CONCLUSION", medium: "CONCLUSION", low: "CONCLUSION" } },
]

// ========== Design Depth 决策树 ==========
export const DESIGN_DEPTH_TREE: GrillingQuestion[] = [
  { id: "Q1", question: "Interface depth preference?", options: [ { id: "shallow", label: "Shallow (single responsibility)", explanation: "Simple interfaces, compose multiple calls" }, { id: "deep", label: "Deep (rich functionality)", explanation: "Rich interfaces, one call does more" } ], branchMap: { shallow: "Q2", deep: "Q3" }, contextHint: "Deep Modules: interface depth = caller leverage + maintainer locality" },
  { id: "Q2", question: "Composition approach?", options: [ { id: "chain", label: "Chain pattern", explanation: "Sequential composition" }, { id: "pipeline", label: "Pipeline", explanation: "Data flow pipeline" }, { id: "orchestrator", label: "Orchestrator", explanation: "Central coordinator" } ], branchMap: { chain: "CONCLUSION", pipeline: "CONCLUSION", orchestrator: "CONCLUSION" } },
  { id: "Q3", question: "Parameter count tolerance?", options: [ { id: "low", label: "Low (<=3 params)", explanation: "Minimal parameters" }, { id: "medium", label: "Medium (3-7)", explanation: "Moderate parameters" }, { id: "high", label: "High (>=7)", explanation: "Many parameters acceptable" } ], branchMap: { low: "Q4", medium: "CONCLUSION", high: "Q5" } },
  { id: "Q4", question: "Object pattern acceptable?", options: [ { id: "yes", label: "Yes - options object", explanation: "Use options object pattern" }, { id: "no", label: "No - explicit params", explanation: "Prefer explicit parameters" } ], branchMap: { yes: "CONCLUSION", no: "CONCLUSION" } },
  { id: "Q5", question: "Builder pattern needed?", options: [ { id: "yes", label: "Yes - fluent API", explanation: "Builder pattern for complex construction" }, { id: "no", label: "No - direct call", explanation: "Direct constructor call" } ], branchMap: { yes: "CONCLUSION", no: "CONCLUSION" } },
]

// ========== Tech Selection 决策树 ==========
export const TECH_SELECTION_TREE: GrillingQuestion[] = [
  { id: "Q1", question: "Technology domain?", options: [ { id: "frontend", label: "Frontend", explanation: "UI/UX, client-side" }, { id: "backend", label: "Backend", explanation: "Server-side, APIs" }, { id: "testing", label: "Testing", explanation: "Test frameworks" }, { id: "infra", label: "Infrastructure", explanation: "Deployment, DevOps" } ], branchMap: { frontend: "Q2", backend: "Q3", testing: "Q4", infra: "Q5" } },
  { id: "Q2", question: "Framework preference?", options: [ { id: "react", label: "React", explanation: "Component-based, Facebook" }, { id: "vue", label: "Vue", explanation: "Progressive, easy learning" }, { id: "svelte", label: "Svelte", explanation: "Compile-time, no runtime" }, { id: "vanilla", label: "Vanilla JS", explanation: "No framework, pure JS" } ], branchMap: { react: "CONCLUSION", vue: "CONCLUSION", svelte: "CONCLUSION", vanilla: "CONCLUSION" } },
  { id: "Q3", question: "Runtime preference?", options: [ { id: "nodejs", label: "Node.js", explanation: "Established, large ecosystem" }, { id: "deno", label: "Deno", explanation: "Modern, TypeScript-first" }, { id: "bun", label: "Bun", explanation: "Fast, native bundler" } ], branchMap: { nodejs: "CONCLUSION", deno: "CONCLUSION", bun: "CONCLUSION" } },
  { id: "Q4", question: "Test framework?", options: [ { id: "vitest", label: "Vitest", explanation: "Fast, Vite-native" }, { id: "jest", label: "Jest", explanation: "Established, feature-rich" }, { id: "playwright", label: "Playwright", explanation: "E2E, cross-browser" } ], branchMap: { vitest: "CONCLUSION", jest: "CONCLUSION", playwright: "CONCLUSION" } },
  { id: "Q5", question: "Deployment target?", options: [ { id: "vercel", label: "Vercel", explanation: "Edge, serverless" }, { id: "docker", label: "Docker", explanation: "Containerized" }, { id: "k8s", label: "Kubernetes", explanation: "Orchestrated containers" }, { id: "bare", label: "Bare metal", explanation: "Direct server deploy" } ], branchMap: { vercel: "CONCLUSION", docker: "CONCLUSION", k8s: "CONCLUSION", bare: "CONCLUSION" } },
]

// ========== Template Registry ==========
export type GrillingTopic = "requirement-clarity" | "design-depth" | "tech-selection"

export const GRILLING_TEMPLATES: Record<GrillingTopic, GrillingQuestion[]> = {
  "requirement-clarity": REQUIREMENT_CLARITY_TREE,
  "design-depth": DESIGN_DEPTH_TREE,
  "tech-selection": TECH_SELECTION_TREE,
}

export function getGrillingTemplate(topic: GrillingTopic): GrillingQuestion[] {
  return GRILLING_TEMPLATES[topic] ?? REQUIREMENT_CLARITY_TREE
}
