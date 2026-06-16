// SCALE Engine — Output Module
// HTML document rendering, brand theming, and UI prototype generation

export { HTMLDocumentRenderer } from './HTMLDocumentRenderer.js'
export type {
  HTMLRenderOptions,
  OutputFormat,
  ThemeMode,
  DocLang,
  SpecData,
  PlanData,
  ReviewData,
  ReportData,
} from './HTMLDocumentRenderer.js'

export { BrandThemeLoader } from './BrandThemeLoader.js'
export type {
  BrandTheme,
  BrandColors,
  BrandTypography,
  BrandSpacing,
  BrandShadows,
} from './BrandThemeLoader.js'

export { UIPrototypeRenderer } from './UIPrototypeRenderer.js'
export type {
  PageSpec,
  ComponentSpec,
  NavItem,
  DashboardLayout,
  DashboardWidget,
  UIPrototypeOptions,
} from './UIPrototypeRenderer.js'

export {
  renderGovernanceDashboard,
} from './GovernanceDashboard.js'
export type {
  GovernanceDashboardOptions,
  GovernanceDashboardResult,
  GovernanceDashboardSummary,
} from './GovernanceDashboard.js'

export {
  HTML_ARTIFACT_TYPES,
  defaultHtmlArtifactPolicy,
  doctorHtmlArtifacts,
  listExistingHtmlArtifacts,
  loadHtmlArtifactPolicy,
  normalizeHtmlArtifactType,
  outputPolicyPath,
  outputPolicyTemplate,
  renderHtmlArtifact,
  resolveHtmlArtifactForOpen,
  settleHtmlArtifacts,
} from './HTMLArtifactLayer.js'
export type {
  HtmlArtifactDoctorReport,
  HtmlArtifactFinding,
  HtmlArtifactManifest,
  HtmlArtifactManifestEntry,
  HtmlArtifactPolicy,
  HtmlArtifactPolicyTemplate,
  HtmlArtifactType,
  RenderHtmlArtifactOptions,
  RenderHtmlArtifactResult,
  SettleHtmlArtifactsOptions,
  SettleHtmlArtifactsReport,
} from './HTMLArtifactLayer.js'
