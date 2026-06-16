import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export async function fetchModules() {
  const { data } = await api.get('/modules')
  return data
}

export async function fetchReport(module) {
  const { data } = await api.get(`/overview/${encodeURIComponent(module)}`)
  return data
}

export async function fetchFiles(module) {
  const { data } = await api.get(`/files/${encodeURIComponent(module)}`)
  return data
}

export async function fetchFile(path) {
  const { data } = await api.get(`/file/${encodeURIComponent(path)}`)
  return data
}

export function getFileUrl(path) {
  return `/api/file/${encodeURIComponent(path)}`
}
