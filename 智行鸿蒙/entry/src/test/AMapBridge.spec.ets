import { describe, it, expect } from '@ohos/hypium'
import AMapBridge from '../main/ets/common/AMapBridge'

export default function AMapBridgeSpec() {
  describe('AMapBridge drawRoute', () => {
    it('should invoke global draw polyline', () => {
      ;(globalThis as any).__amap_drawPolyline = (points: Array<{ lng: number; lat: number }>) => {
        ;(globalThis as any).__draw_count = points.length
      }
      AMapBridge.drawRoute([
        { lng: 1, lat: 2 },
        { lng: 3, lat: 4 }
      ])
      expect((globalThis as any).__draw_count).assertEqual(2)
    })
  })
}
