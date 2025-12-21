const g: any = globalThis as any
const runtime: { surfaceId?: string; key?: string } = {}

g.__amap_init = (surfaceId: string, key: string) => {
  runtime.surfaceId = surfaceId
  runtime.key = key
  const fn = g.__amap_plugin_init
  if (typeof fn === 'function') {
    try {
      fn(surfaceId, key)
    } catch {}
  }
}

g.__amap_drawPolyline = (points: Array<{ lng: number; lat: number }>) => {
  const fn = g.__amap_plugin_drawPolyline
  if (typeof fn === 'function') {
    try {
      fn(points)
    } catch {}
  }
}

export {}
