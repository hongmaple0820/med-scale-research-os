export function isDirectArtifactUrl(path) {
  const value = String(path || "").trim()
  return /^(?:https?:|data:|blob:|mailto:|tel:|#)/i.test(value)
    || value.startsWith("/api/")
    || value.startsWith("/medical-artifact")
}

export function normalizeArtifactPath(path) {
  return String(path || "").replace(/\\/g, "/")
}

export function decodeArtifactPath(path) {
  const value = String(path || "").trim()
  if (!value.includes("%")) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function resolveArtifactRelativePath(basePath, relativePath) {
  const raw = String(relativePath || "").trim()
  if (!raw || isDirectArtifactUrl(raw)) return raw

  const normalized = normalizeArtifactPath(decodeArtifactPath(raw))
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) {
    return normalized
  }

  const parts = normalizeArtifactPath(basePath).split("/")
  parts.pop()
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (parts.length > 1) parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join("/")
}

export function buildInlineArtifactUrl(path) {
  return "/api/download?inline=1&path=" + encodeURIComponent(path)
}

export function rewriteArtifactRelativeUrls(root, artifactPath) {
  if (!root || typeof root.querySelectorAll !== "function") return

  for (const node of root.querySelectorAll("img[src], a[href]")) {
    const tag = String(node.tagName || "").toLowerCase()
    const attribute = tag === "img" ? "src" : "href"
    const raw = node.getAttribute(attribute)
    if (!raw) continue

    if (isDirectArtifactUrl(raw)) {
      if (tag === "a" && /^https?:/i.test(raw)) {
        node.setAttribute("target", "_blank")
        node.setAttribute("rel", "noopener noreferrer")
      }
      continue
    }

    const resolvedPath = resolveArtifactRelativePath(artifactPath, raw)
    if (!resolvedPath) continue

    if (tag === "img") {
      node.setAttribute("src", buildInlineArtifactUrl(resolvedPath))
      node.setAttribute("loading", "eager")
      node.style.maxWidth = "100%"
      node.style.height = "auto"
      node.style.borderRadius = "12px"
      node.style.margin = "16px 0"
    } else {
      node.setAttribute("href", buildInlineArtifactUrl(resolvedPath))
      node.setAttribute("target", "_blank")
      node.setAttribute("rel", "noopener noreferrer")
    }
  }
}

const artifactPreviewUtils = {
  isDirectArtifactUrl,
  normalizeArtifactPath,
  decodeArtifactPath,
  resolveArtifactRelativePath,
  buildInlineArtifactUrl,
  rewriteArtifactRelativeUrls,
}

if (typeof window !== "undefined") {
  window.ArtifactPreviewUtils = artifactPreviewUtils
}

export default artifactPreviewUtils
