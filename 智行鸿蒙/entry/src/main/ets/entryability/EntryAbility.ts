/**
 * 智行鸿蒙 - 入口能力
 * 应用主入口，负责初始化配置和启动UI
 */
import UIAbility from '@ohos.app.ability.UIAbility'
import window from '@ohos.window'
import bundleManager from '@ohos.bundle.bundleManager'
import emitter from '@ohos.events.emitter'
import '../native/AMapShim'
import { ROUTE_SERVICE_EVENT_ID } from '../service/RouteServiceAbility'

export default class EntryAbility extends UIAbility {
  private launchParams: any = null

  onCreate(want, launchParam) {
    console.info('EntryAbility onCreate')
    
    // 保存全局上下文
    ;(globalThis as any).abilityContext = this.context

    // 保存启动参数
    this.launchParams = want?.parameters

    // 加载配置
    this.loadAppConfig()
  }

  /**
   * 加载应用配置
   */
  private async loadAppConfig() {
    try {
      // 从应用元数据加载
      const appInfo = await bundleManager.getApplicationInfo(
        this.context.bundleName, 
        0, 
        this.context.userId
      )
      
      const meta = appInfo?.metadata || {}
      const amapKey = meta?.AMAP_KEY || ''

      if (amapKey) {
        ;(globalThis as any).__amap_key = amapKey
        console.info('从元数据加载AMAP_KEY成功')
      }

      // 从rawfile加载配置
      await this.loadRawFileConfig()
    } catch (e) {
      console.error(`加载配置失败: ${e}`)
      await this.loadRawFileConfig()
    }
  }

  /**
   * 从rwfile加载配置
   */
  private async loadRawFileConfig() {
    try {
      const buf = await this.context.resourceManager.getRawFileContent('app-config.json')
      const txt = String.fromCharCode.apply(null, Array.from(new Uint8Array(buf)))
      const json = JSON.parse(txt)

      // 加载高德Key
      if (!((globalThis as any).__amap_key) && json?.amap_key) {
        ;(globalThis as any).__amap_key = json.amap_key
        console.info('从rawfile加载AMAP_KEY成功')
      }

      // 加载LLM配置
      if (json?.llm) {
        ;(globalThis as any).__llm_config = {
          provider: json.llm.provider || 'qianwen',
          apiKey: json.llm.api_key || '',
          baseUrl: json.llm.base_url || '',
          model: json.llm.model || 'qwen-turbo'
        }
        console.info('LLM配置加载成功')
      }

      // 加载用户偏好
      if (json?.user_preferences) {
        ;(globalThis as any).__user_preferences = {
          homeAddress: json.user_preferences.home_address || '',
          workAddress: json.user_preferences.work_address || '',
          preferredRouteType: json.user_preferences.preferred_route_type || 'fastest',
          avoidHighway: json.user_preferences.avoid_highway || false,
          avoidToll: json.user_preferences.avoid_toll || false
        }
        console.info('用户偏好加载成功')
      }
    } catch (e) {
      console.error(`加载rawfile配置失败: ${e}`)
    }
  }

  onDestroy() {
    console.info('EntryAbility onDestroy')
  }

  onWindowStageCreate(windowStage: window.WindowStage) {
    console.info('EntryAbility onWindowStageCreate')

    // 加载主页面
    windowStage.loadContent('pages/Index', (err) => {
      if (err) {
        console.error(`加载页面失败: ${err.message}`)
        return
      }

      // 处理启动参数
      if (this.launchParams) {
        this.handleLaunchParams(this.launchParams)
      }
    })
  }

  /**
   * 处理启动参数
   */
  private handleLaunchParams(params: any) {
    const action = params?.action
    
    if (!action) return

    console.info(`处理启动参数: ${action}`)

    // 延迟发送事件，确保页面已加载
    setTimeout(() => {
      switch (action) {
        case 'navigate':
          emitter.emit({ eventId: 10010 }, {
            data: {
              action: 'navigate',
              destination: params?.destination || ''
            }
          })
          break

        case 'search_poi':
          emitter.emit({ eventId: 10010 }, {
            data: {
              action: 'search_poi',
              keyword: params?.keyword || ''
            }
          })
          break

        case 'view_commute':
          emitter.emit({ eventId: 10010 }, {
            data: { action: 'view_commute' }
          })
          break

        case 'go_home':
          emitter.emit({ eventId: 10010 }, {
            data: {
              action: 'navigate',
              destination: '家庭地址'
            }
          })
          break
      }
    }, 500)
  }

  onWindowStageDestroy() {
    console.info('EntryAbility onWindowStageDestroy')
  }

  onForeground() {
    console.info('EntryAbility onForeground')
  }

  onBackground() {
    console.info('EntryAbility onBackground')
  }
}