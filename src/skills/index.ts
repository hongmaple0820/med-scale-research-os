// SCALE Engine — Skills Module Index (v0.7.0)

export { SkillRegistry, type ISkillRegistry, type SkillDefinition, type SkillTrigger, type SkillExecution, type SkillRecommendation, type SkillTriggerCondition, type SkillDomain, type SkillExecutionType } from "./SkillRegistry.js"
export { TriggerEngine, type ITriggerEngine, type TriggerEvent } from "./TriggerEngine.js"
export { SkillExecutor, type ISkillExecutor, type SkillExecutionResult } from "./SkillExecutor.js"
export { CORE_SKILLS, getCoreSkill, registerCoreSkills } from "./coreSkills.js"
export { registerExternalSkills } from "./ExternalSkills.js"
export * from './SkillCatalog.js'
export { SkillInstaller, type ISkillInstaller, type SkillInstallConfig, type InstallResult, type InstallMethod } from "./SkillInstaller.js"
export { SkillDiscovery, type ISkillDiscovery, type DiscoveryContext, type DiscoveryResult } from "./SkillDiscovery.js"
export * from "./routing/index.js"
export * from "./RoleSkills.js"
