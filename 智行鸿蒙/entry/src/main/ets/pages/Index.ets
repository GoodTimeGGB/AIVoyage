/**
 * 智行鸿蒙 - 主页面
 * AI驱动的全链路智能出行助手
 */
import common from '@ohos.app.ability.common'
import emitter from '@ohos.events.emitter'
import AMapView from '../components/AMapView'
import AMapBridge from '../common/AMapBridge'
import RoutePlanEngine, { RoutePlanResult } from '../engine/RoutePlanEngine'
import DialogEngine, { TravelIntent, ChatMessage } from '../engine/DialogEngine'
import WeatherService from '../service/WeatherService'
import POIService, { POIInfo } from '../service/POIService'
import { REROUTE_EVENT_ID, WEATHER_CHANGE_EVENT_ID } from '../service/RouteServiceAbility'

@Entry
@Component
struct Index {
  @State private query: string = ''
  @State private isLoading: boolean = false
  @State private serviceRunning: boolean = false
  @State private routeResult: RoutePlanResult | null = null
  @State private selectedRouteId: string = ''
  @State private chatMessages: ChatMessage[] = []
  @State private showPOIList: boolean = false
  @State private pois: POIInfo[] = []
  @State private weatherText: string = ''
  @State private trafficEnabled: boolean = false
  @State private showRouteOptions: boolean = false
  @State private alertMessage: string = ''
  @State private showAlert: boolean = false

  private engine: RoutePlanEngine = new RoutePlanEngine()
  private dialogEngine: DialogEngine = new DialogEngine()
  private weatherService: WeatherService = new WeatherService()
  private poiService: POIService = new POIService()

  aboutToAppear() {
    // 监听重规划事件
    emitter.on({ eventId: REROUTE_EVENT_ID }, (eventData) => {
      this.handleRerouteEvent(eventData)
    })

    // 监听天气变化事件
    emitter.on({ eventId: WEATHER_CHANGE_EVENT_ID }, (eventData) => {
      this.handleWeatherEvent(eventData)
    })

    // 初始化天气
    this.loadWeather()
  }

  aboutToDisappear() {
    emitter.off(REROUTE_EVENT_ID)
    emitter.off(WEATHER_CHANGE_EVENT_ID)
  }

  /**
   * 加载天气信息
   */
  async loadWeather() {
    const result = await this.weatherService.getLiveWeather('110105')
    if (result.success && result.live) {
      this.weatherText = `${result.live.weather} ${result.live.temperature}℃`
    }
  }

  /**
   * 处理用户输入
   */
  async handleSendMessage() {
    if (!this.query.trim() || this.isLoading) return

    this.isLoading = true
    const userInput = this.query
    this.query = ''

    try {
      // 解析用户意图
      const intent = await this.dialogEngine.parseIntent(userInput)
      
      // 根据意图执行操作
      await this.executeIntent(intent)
    } catch (e) {
      console.error(`处理输入失败: ${e}`)
      this.addAssistantMessage('抱歉，处理您的请求时出错了，请重试。')
    } finally {
      this.isLoading = false
    }
  }

  /**
   * 执行用户意图
   */
  async executeIntent(intent: TravelIntent) {
    switch (intent.action) {
      case 'plan_route':
        await this.planRoute(intent)
        break
      case 'search_poi':
        await this.searchPOI(intent)
        break
      case 'query_traffic':
        await this.queryTraffic()
        break
      case 'query_weather':
        await this.queryWeather()
        break
      default:
        const response = await this.dialogEngine.generateResponse(intent)
        this.addAssistantMessage(response)
    }
  }

  /**
   * 规划路线
   */
  async planRoute(intent: TravelIntent) {
    if (!intent.destination) {
      this.addAssistantMessage('请告诉我您想去哪里？')
      return
    }

    this.isLoading = true
    this.addAssistantMessage('正在为您规划路线...')

    try {
      const result = await this.engine.planRoute({
        origin: intent.origin || '当前位置',
        destination: intent.destination,
        time: intent.time,
        preferences: intent.preferences,
        mode: intent.mode || 'drive',
        considerTraffic: true,
        considerWeather: true,
        searchPOI: intent.preferences?.some(p => ['coffee_shop', 'gas_station', 'restaurant'].includes(p))
      })

      this.routeResult = result
      this.selectedRouteId = result.recommendedRouteId
      this.showRouteOptions = result.routes.length > 1

      // 在地图上显示路线
      AMapBridge.clearAll()
      
      if (result.routes.length > 1) {
        AMapBridge.drawMultipleRoutes(result.routes.map(r => ({
          id: r.id,
          points: r.points || [],
          isRecommended: r.id === result.recommendedRouteId
        })))
      } else if (result.routes[0]?.points) {
        AMapBridge.drawRoute(result.routes[0].points, {
          id: result.routes[0].id,
          isSelected: true
        })
      }

      // 显示POI
      if (result.pois && result.pois.length > 0) {
        this.pois = result.pois
        AMapBridge.addPOIMarkers(result.pois)
      }

      // 生成回复
      const response = await this.dialogEngine.generateResponse(intent, result)
      this.updateLastAssistantMessage(response)

      // 调整视野
      if (result.routes[0]?.points) {
        AMapBridge.fitBounds(result.routes[0].points)
      }
    } catch (e) {
      this.updateLastAssistantMessage('抱歉，路线规划失败，请重试。')
    }
  }

  /**
   * 搜索POI
   */
  async searchPOI(intent: TravelIntent) {
    this.isLoading = true
    this.addAssistantMessage(`正在搜索附近的${intent.poiKeyword || 'POI'}...`)

    try {
      const location = await AMapBridge.getCurrentLocation()
      if (!location) {
        this.updateLastAssistantMessage('无法获取当前位置')
        return
      }

      const result = await this.poiService.searchByTypeName(
        intent.poiKeyword || '',
        location,
        3000
      )

      if (result.success && result.pois.length > 0) {
        this.pois = result.pois
        this.showPOIList = true
        AMapBridge.addPOIMarkers(result.pois.slice(0, 10))

        const response = await this.dialogEngine.generateResponse(intent, result)
        this.updateLastAssistantMessage(response)
      } else {
        this.updateLastAssistantMessage(`附近未找到${intent.poiKeyword || '相关'}地点`)
      }
    } catch (e) {
      this.updateLastAssistantMessage('POI搜索失败，请重试')
    }
  }

  /**
   * 查询路况
   */
  async queryTraffic() {
    this.trafficEnabled = !this.trafficEnabled
    AMapBridge.setTrafficLayer(this.trafficEnabled)
    
    if (this.trafficEnabled) {
      this.addAssistantMessage('已开启路况图层，绿色表示畅通，黄色表示缓行，红色表示拥堵。')
    } else {
      this.addAssistantMessage('已关闭路况图层。')
    }
  }

  /**
   * 查询天气
   */
  async queryWeather() {
    const result = await this.weatherService.getLiveWeather('110105')
    if (result.success && result.live) {
      const weather = result.live
      this.weatherText = `${weather.weather} ${weather.temperature}℃`
      this.addAssistantMessage(
        `当前天气：${weather.weather}，气温${weather.temperature}℃，` +
        `${weather.windDirection}风${weather.windPower}级，湿度${weather.humidity}%。` +
        (result.tips ? `出行提示：${result.tips}` : '')
      )
    } else {
      this.addAssistantMessage('无法获取天气信息')
    }
  }

  /**
   * 选择路线
   */
  selectRoute(routeId: string) {
    if (!this.routeResult) return

    this.selectedRouteId = routeId
    const route = this.routeResult.routes.find(r => r.id === routeId)
    
    if (route?.points) {
      AMapBridge.clearRoute()
      AMapBridge.drawRoute(route.points, {
        id: route.id,
        isSelected: true
      })

      const distKm = (route.distanceMeters / 1000).toFixed(1)
      const durMin = Math.round(route.durationSeconds / 60)
      this.addAssistantMessage(`已切换到路线${routeId}，全程${distKm}公里，预计${durMin}分钟。`)
    }
  }

  /**
   * 开始导航
   */
  startNavigation() {
    if (!this.routeResult) return

    const route = this.routeResult.routes.find(r => r.id === this.selectedRouteId)
    if (route?.points) {
      // 启动后台服务
      const ctx = (globalThis as any).abilityContext as common.UIAbilityContext
      ctx.startServiceAbility({
        bundleName: 'com.personalproject.zhixinghongmeng',
        abilityName: 'RouteServiceAbility',
        parameters: {
          action: 'start_navigation',
          destination: this.routeResult.routes[0]?.steps?.[0]?.instruction || '目的地',
          routePoints: route.points
        }
      })

      this.serviceRunning = true
      AMapBridge.startNavigation(route.points)
      this.addAssistantMessage('导航已启动，祁您一路平安！')
    }
  }

  /**
   * 停止导航
   */
  stopNavigation() {
    const ctx = (globalThis as any).abilityContext as common.UIAbilityContext
    ctx.stopServiceAbility({
      bundleName: 'com.personalproject.zhixinghongmeng',
      abilityName: 'RouteServiceAbility'
    })

    this.serviceRunning = false
    AMapBridge.stopNavigation()
    this.addAssistantMessage('导航已结束。')
  }

  /**
   * 处理重规划事件
   */
  handleRerouteEvent(eventData: any) {
    try {
      const reason = eventData?.data?.reason || '发现更优路线'
      const timeSaved = eventData?.data?.timeSaved || 0
      
      this.alertMessage = `${reason}，可节省${timeSaved}分钟，是否切换？`
      this.showAlert = true
    } catch (e) {
      console.error(`处理重规划事件失败: ${e}`)
    }
  }

  /**
   * 处理天气变化事件
   */
  handleWeatherEvent(eventData: any) {
    try {
      const weather = JSON.parse(eventData?.data?.weather || '{}')
      if (weather.weather) {
        this.weatherText = `${weather.weather} ${weather.temperature}℃`
        this.addAssistantMessage(`天气变化：${weather.weather}，请注意安全。`)
      }
    } catch (e) {
      console.error(`处理天气事件失败: ${e}`)
    }
  }

  /**
   * 添加助手消息
   */
  addAssistantMessage(content: string) {
    this.chatMessages = [...this.chatMessages, {
      role: 'assistant',
      content,
      timestamp: Date.now()
    }]
  }

  /**
   * 更新最后一条助手消息
   */
  updateLastAssistantMessage(content: string) {
    if (this.chatMessages.length > 0) {
      const lastIdx = this.chatMessages.length - 1
      if (this.chatMessages[lastIdx].role === 'assistant') {
        this.chatMessages[lastIdx] = {
          ...this.chatMessages[lastIdx],
          content
        }
        this.chatMessages = [...this.chatMessages]
      } else {
        this.addAssistantMessage(content)
      }
    } else {
      this.addAssistantMessage(content)
    }
  }

  build() {
    Stack() {
      // 地图层
      AMapView()

      // 主界面层
      Column() {
        // 顶部天气栏
        if (this.weatherText) {
          Row() {
            Text('☀️ ' + this.weatherText)
              .fontSize(14)
              .fontColor('#666')
          }
          .width('100%')
          .justifyContent(FlexAlign.End)
          .padding({ right: 16, top: 8 })
        }

        // 输入区域
        Row() {
          TextInput({ placeholder: '说出您的出行需求...' })
            .onChange((v: string) => {
              this.query = v
            })
            .onSubmit(() => {
              this.handleSendMessage()
            })
            .width('60%')
            .height(40)
          
          Button('🎤')
            .onClick(() => {
              // TODO: 语音识别
              console.info('启动语音识别')
            })
            .width(40)
            .height(40)
            .margin({ left: 8 })
          
          Button(this.isLoading ? '•••' : '发送')
            .onClick(() => {
              this.handleSendMessage()
            })
            .width(60)
            .height(40)
            .margin({ left: 8 })
            .enabled(!this.isLoading)
        }
        .width('100%')
        .backgroundColor('#ffffff')
        .opacity(0.95)
        .padding(12)
        .borderRadius(8)
        .margin({ top: 8 })

        // 对话历史
        if (this.chatMessages.length > 0) {
          Scroll() {
            Column() {
              ForEach(this.chatMessages.slice(-5), (msg: ChatMessage, index: number) => {
                Row() {
                  Text(msg.content)
                    .fontSize(14)
                    .fontColor(msg.role === 'assistant' ? '#333' : '#666')
                    .maxLines(3)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                .width('100%')
                .padding(8)
                .backgroundColor(msg.role === 'assistant' ? '#e8f4fd' : '#f5f5f5')
                .borderRadius(8)
                .margin({ bottom: 4 })
              })
            }
          }
          .height(150)
          .width('100%')
          .backgroundColor('rgba(255,255,255,0.9)')
          .borderRadius(8)
          .margin({ top: 8 })
          .padding(8)
        }

        // 路线选项
        if (this.showRouteOptions && this.routeResult) {
          Row() {
            ForEach(this.routeResult.routes, (route, index: number) => {
              Button({
                type: this.selectedRouteId === route.id ? ButtonType.Normal : ButtonType.Normal
              }) {
                Column() {
                  Text(`路线${index + 1}`).fontSize(12)
                  Text(`${Math.round(route.durationSeconds / 60)}分钟`).fontSize(10)
                }
              }
              .backgroundColor(this.selectedRouteId === route.id ? '#3366FF' : '#e0e0e0')
              .fontColor(this.selectedRouteId === route.id ? '#fff' : '#333')
              .onClick(() => this.selectRoute(route.id))
              .margin({ right: 8 })
              .padding(8)
              .borderRadius(8)
            })
          }
          .width('100%')
          .justifyContent(FlexAlign.Center)
          .padding(8)
          .backgroundColor('rgba(255,255,255,0.9)')
          .borderRadius(8)
          .margin({ top: 8 })
        }

        // 底部操作栏
        Blank()

        Row() {
          if (this.routeResult && !this.serviceRunning) {
            Button('开始导航')
              .onClick(() => this.startNavigation())
              .backgroundColor('#3366FF')
              .fontColor('#fff')
              .width('45%')
          }

          if (this.serviceRunning) {
            Button('结束导航')
              .onClick(() => this.stopNavigation())
              .backgroundColor('#ff4444')
              .fontColor('#fff')
              .width('45%')
          }

          Button(this.trafficEnabled ? '关闭路况' : '显示路况')
            .onClick(() => this.queryTraffic())
            .backgroundColor('#f0f0f0')
            .fontColor('#333')
            .width('45%')
            .margin({ left: 8 })
        }
        .width('100%')
        .justifyContent(FlexAlign.Center)
        .padding(12)
        .backgroundColor('#ffffff')
      }
      .width('100%')
      .height('100%')
      .padding({ left: 16, right: 16 })
      .justifyContent(FlexAlign.Start)

      // 提示弹窗
      if (this.showAlert) {
        Column() {
          Text(this.alertMessage)
            .fontSize(14)
            .margin({ bottom: 16 })
          
          Row() {
            Button('忽略')
              .onClick(() => {
                this.showAlert = false
              })
              .backgroundColor('#e0e0e0')
              .margin({ right: 16 })
            
            Button('切换路线')
              .onClick(() => {
                this.showAlert = false
                // TODO: 切换到新路线
              })
              .backgroundColor('#3366FF')
              .fontColor('#fff')
          }
        }
        .width('80%')
        .padding(20)
        .backgroundColor('#fff')
        .borderRadius(12)
        .shadow({ radius: 10, color: 'rgba(0,0,0,0.2)' })
      }
    }
    .width('100%')
    .height('100%')
  }
}
