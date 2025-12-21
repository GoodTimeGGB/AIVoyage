import { describe, it, expect } from '@ohos/hypium'
import { getAmapKey } from '../main/ets/config/AppConfig'

export default function tests() {
  describe('AppConfig getAmapKey', () => {
    it('reads from global', () => {
      ;(globalThis as any).__amap_key = 'TEST_KEY'
      expect(getAmapKey()).assertEqual('TEST_KEY')
    })
  })
}
