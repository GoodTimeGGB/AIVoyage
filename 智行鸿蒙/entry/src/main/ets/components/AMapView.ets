import AMapBridge from '../common/AMapBridge'

@Component
export default struct AMapView {
  private controller: XComponentController = new XComponentController()
  private loaded: boolean = false

  aboutToAppear() {
    this.controller.onLoad(() => {
      const id = this.controller.getXComponentSurfaceId()
      AMapBridge.init(id)
      this.loaded = true
    })
  }

  build() {
    Stack() {
      XComponent({ type: XComponentType.SURFACE, controller: this.controller })
        .width('100%')
        .height('100%')
      if (!this.loaded) {
        Text('地图加载中').fontSize(16)
      }
    }
    .width('100%')
    .height('100%')
  }
}
