import { describe, it, expect } from '@ohos/hypium'
import RoutePlanEngine from '../main/ets/engine/RoutePlanEngine'

export default function tests() {
  describe('RoutePlanEngine basic', () => {
    it('returns routes with or without key', async () => {
      const engine = new RoutePlanEngine()
      const res = await engine.planRoute({ origin: '北京市朝阳区', destination: '国贸', mode: 'drive' })
      expect(res.routes.length >= 1).assertTrue()
      expect(!!res.recommendedRouteId).assertTrue()
    })
  })
}
