/**
 * 多模态路径规划引擎
 * 整合高德路径规划、实时交通、天气、POI等多数据源
 * 综合评分算法推荐最优路线
 */
import http from '@ohos.net.http'
import { getAmapKey, getUserPreferences } from '../config/AppConfig'
import WeatherService, { WeatherInfo } from '../service/WeatherService'
import TrafficService from '../service/TrafficService'
import POIService, { POIInfo } from '../service/POIService'

export interface RoutePlanParams {
  origin: { lat: number; lng: number } | string
  destination: { lat: number; lng: number } | string
  time?: string | number | Date
  preferences?: string[]  // fastest, shortest, avoid_highway, avoid_toll, coffee_shop等
  mode?: 'drive' | 'walk' | 'ride' | 'transit'
  waypoints?: Array<{ lat: number; lng: number } | string>  // 途经点
  considerTraffic?: boolean   // 是否考虑实时路况
  considerWeather?: boolean   // 是否考虑天气
  searchPOI?: boolean         // 是否搜索途中POI
}

export interface RoutePlanResult {
  recommendedRouteId: string
  routes: Array<{
    id: string
    distanceMeters: number
    durationSeconds: number
    score: number
    scoreDetails: {
      timeScore: number
      distanceScore: number
      trafficScore: number
      weatherScore: number
      preferenceScore: number
    }
    trafficStatus?: string
    weatherImpact?: string
    steps: Array<{ instruction: string; distanceMeters: number; durationSeconds: number }>
    points?: Array<{ lng: number; lat: number }>
    tolls?: number        // 过路费
    trafficLights?: number // 红绿灯数量
  }>
  pois?: POIInfo[]         // 途中推荐POI
  weather?: WeatherInfo    // 当前天气
  generatedAt: number
  aiSummary?: string       // AI生成的路线总结
}

export default class RoutePlanEngine {
  private weatherService: WeatherService
  private trafficService: TrafficService
  private poiService: POIService

  constructor() {
    this.weatherService = new WeatherService()
    this.trafficService = new TrafficService()
    this.poiService = new POIService()
  }

  async planRoute(params: RoutePlanParams): Promise<RoutePlanResult> {
    const key = getAmapKey()
    const userPrefs = getUserPreferences()

    // 合并用户偏好和参数偏好
    const preferences = [...(params.preferences || [])]
    if (userPrefs.avoidHighway && !preferences.includes('avoid_highway')) {
      preferences.push('avoid_highway')
    }
    if (userPrefs.avoidToll && !preferences.includes('avoid_toll')) {
      preferences.push('avoid_toll')
    }

    if (key) {
      let httpClient: http.HttpClient | null = null
      try {
        httpClient = http.createHttp()

        // 地址转坐标
        const toCoord = async (p: any): Promise<{ lng: number; lat: number }> => {
          if (typeof p === 'string') {
            // 处理特殊地址
            let address = p
            if (p === '家庭地址' && userPrefs.homeAddress) {
              address = userPrefs.homeAddress
            } else if (p === '工作地址' && userPrefs.workAddress) {
              address = userPrefs.workAddress
            } else if (p === '当前位置') {
              // TODO: 获取实际定位
              return { lng: 116.397, lat: 39.908 }
            }

            const geo = await httpClient!.request({
              url: `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(address)}&key=${key}`,
              method: http.RequestMethod.GET
            })
            const g = JSON.parse(geo.result as string)
            const loc = g?.geocodes?.[0]?.location || ''
            const [lngStr, latStr] = loc.split(',')
            const lng = parseFloat(lngStr)
            const lat = parseFloat(latStr)
            if (!isNaN(lng) && !isNaN(lat)) {
              return { lng, lat }
            }
            return { lng: 116.397, lat: 39.908 }
          }
          return { lng: p.lng, lat: p.lat }
        }

        const origin = await toCoord(params.origin)
        const destination = await toCoord(params.destination)

        // 根据偏好确定策略
        const strategy = this.getRouteStrategy(preferences)

        // 调用高德路径规划API
        const dirUrl = this.buildDirectionUrl(params.mode || 'drive', origin, destination, strategy, key)
        const dir = await httpClient!.request({
          url: dirUrl,
          method: http.RequestMethod.GET
        })

        const data = JSON.parse(dir.result as string)
        const paths = data?.route?.paths || []

        // 解析路线
        const routes = paths.slice(0, 3).map((p: any, idx: number) => {
          const pts = this.parseRoutePoints(p)
          return {
            id: `r${idx + 1}`,
            distanceMeters: parseInt(p.distance || '0'),
            durationSeconds: parseInt(p.duration || '0'),
            score: 0,
            scoreDetails: {
              timeScore: 0,
              distanceScore: 0,
              trafficScore: 0,
              weatherScore: 0,
              preferenceScore: 0
            },
            steps: (p.steps || []).slice(0, 10).map((s: any) => ({
              instruction: s?.instruction || '',
              distanceMeters: parseInt(s?.distance || '0'),
              durationSeconds: parseInt(s?.duration || '0')
            })),
            points: pts,
            tolls: parseInt(p.tolls || '0'),
            trafficLights: parseInt(p.traffic_lights || '0')
          }
        })

        if (routes.length === 0) {
          return this.getMockResult()
        }

        // 获取天气信息
        let weather: WeatherInfo | undefined
        if (params.considerWeather !== false) {
          const weatherResult = await this.weatherService.getWeatherByLocation(origin.lng, origin.lat)
          if (weatherResult.success && weatherResult.live) {
            weather = weatherResult.live
          }
        }

        // 评估路况并计算综合评分
        for (const route of routes) {
          // 评估路况
          if (params.considerTraffic !== false && route.points && route.points.length > 0) {
            const trafficEval = await this.trafficService.evaluateRouteTraffic(route.points)
            route.trafficStatus = trafficEval.avgStatus
            route.scoreDetails.trafficScore = 1 - (trafficEval.congestionRate / 100)
          } else {
            route.scoreDetails.trafficScore = 0.8
          }

          // 评估天气影响
          if (weather) {
            const weatherEval = this.weatherService.evaluateWeatherImpact(weather)
            route.weatherImpact = weatherEval.level
            route.scoreDetails.weatherScore = 1 - weatherEval.impact
          } else {
            route.scoreDetails.weatherScore = 1
          }

          // 计算时间分
          route.scoreDetails.timeScore = this.normalizeScore(routes, 'durationSeconds', route.durationSeconds, true)
          // 计算距离分
          route.scoreDetails.distanceScore = this.normalizeScore(routes, 'distanceMeters', route.distanceMeters, true)
          // 计算偏好分
          route.scoreDetails.preferenceScore = this.calculatePreferenceScore(route, preferences)

          // 综合评分
          route.score = this.calculateFinalScore(route.scoreDetails, preferences)
        }

        // 按评分排序
        routes.sort((a, b) => b.score - a.score)
        const recommendedRouteId = routes[0]?.id || 'r1'

        // 搜索途中POI
        let pois: POIInfo[] = []
        if (params.searchPOI !== false && routes[0]?.points) {
          const poiTypes = preferences.filter(p => ['coffee_shop', 'gas_station', 'charging_station', 'restaurant'].includes(p))
          if (poiTypes.length > 0) {
            const recommendations = await this.poiService.recommendAlongRoute(routes[0].points, poiTypes)
            pois = recommendations.flatMap(r => r.pois).slice(0, 10)
          }
        }

        return {
          recommendedRouteId,
          routes,
          pois: pois.length > 0 ? pois : undefined,
          weather,
          generatedAt: Date.now(),
          aiSummary: this.generateRouteSummary(routes[0], weather, pois)
        }
      } catch (e) {
        console.error(`路径规划失败: ${e}`)
      } finally {
        try {
          httpClient?.destroy()
        } catch {}
      }
    }

    return this.getMockResult()
  }

  /**
   * 根据偏好获取路线策略
   */
  private getRouteStrategy(preferences: string[]): string {
    // 高德驾车策略: 0-推荐, 1-费用优先, 2-距离优先, 4-速度优先, 5-不走高速, 6-不走收费
    if (preferences.includes('avoid_highway') && preferences.includes('avoid_toll')) {
      return '6'
    }
    if (preferences.includes('avoid_highway')) {
      return '5'
    }
    if (preferences.includes('avoid_toll')) {
      return '6'
    }
    if (preferences.includes('shortest')) {
      return '2'
    }
    if (preferences.includes('fastest')) {
      return '4'
    }
    if (preferences.includes('economical')) {
      return '1'
    }
    return '0'
  }

  /**
   * 构建路径规划URL
   */
  private buildDirectionUrl(
    mode: string,
    origin: { lng: number; lat: number },
    destination: { lng: number; lat: number },
    strategy: string,
    key: string
  ): string {
    const originStr = `${origin.lng},${origin.lat}`
    const destStr = `${destination.lng},${destination.lat}`

    switch (mode) {
      case 'walk':
        return `https://restapi.amap.com/v3/direction/walking?origin=${originStr}&destination=${destStr}&key=${key}`
      case 'ride':
        return `https://restapi.amap.com/v4/direction/bicycling?origin=${originStr}&destination=${destStr}&key=${key}`
      case 'transit':
        return `https://restapi.amap.com/v3/direction/transit/integrated?origin=${originStr}&destination=${destStr}&city=010&key=${key}`
      default:
        return `https://restapi.amap.com/v3/direction/driving?origin=${originStr}&destination=${destStr}&strategy=${strategy}&key=${key}&extensions=all`
    }
  }

  /**
   * 解析路线点
   */
  private parseRoutePoints(path: any): Array<{ lng: number; lat: number }> {
    const pts: Array<{ lng: number; lat: number }> = []
    ;(path.steps || []).forEach((s: any) => {
      const pl = s?.polyline || ''
      if (typeof pl === 'string') {
        pl.split(';').forEach((pair: string) => {
          const [lngStr, latStr] = pair.split(',')
          const lng = parseFloat(lngStr)
          const lat = parseFloat(latStr)
          if (!isNaN(lng) && !isNaN(lat)) {
            pts.push({ lng, lat })
          }
        })
      }
    })
    return pts
  }

  /**
   * 归一化评分
   */
  private normalizeScore(routes: any[], field: string, value: number, lowerIsBetter: boolean): number {
    const values = routes.map(r => r[field])
    const min = Math.min(...values)
    const max = Math.max(...values)
    if (max === min) return 1
    const normalized = (value - min) / (max - min)
    return lowerIsBetter ? (1 - normalized) : normalized
  }

  /**
   * 计算偏好分
   */
  private calculatePreferenceScore(route: any, preferences: string[]): number {
    let score = 1

    // 如果要避开高速但路线有过路费，降低分数
    if (preferences.includes('avoid_toll') && route.tolls > 0) {
      score -= 0.2
    }

    // 如果要求最快，根据时间调整
    if (preferences.includes('fastest')) {
      score += route.scoreDetails.timeScore * 0.1
    }

    return Math.max(0, Math.min(1, score))
  }

  /**
   * 计算综合评分
   */
  private calculateFinalScore(
    details: { timeScore: number; distanceScore: number; trafficScore: number; weatherScore: number; preferenceScore: number },
    preferences: string[]
  ): number {
    // 根据偏好调整权重
    let weights = { time: 0.3, distance: 0.2, traffic: 0.25, weather: 0.1, preference: 0.15 }

    if (preferences.includes('fastest')) {
      weights = { time: 0.4, distance: 0.15, traffic: 0.25, weather: 0.1, preference: 0.1 }
    } else if (preferences.includes('shortest')) {
      weights = { time: 0.2, distance: 0.4, traffic: 0.2, weather: 0.1, preference: 0.1 }
    }

    return (
      details.timeScore * weights.time +
      details.distanceScore * weights.distance +
      details.trafficScore * weights.traffic +
      details.weatherScore * weights.weather +
      details.preferenceScore * weights.preference
    )
  }

  /**
   * 生成路线摘要
   */
  private generateRouteSummary(route: any, weather?: WeatherInfo, pois?: POIInfo[]): string {
    if (!route) return ''

    const distKm = (route.distanceMeters / 1000).toFixed(1)
    const durMin = Math.round(route.durationSeconds / 60)

    let summary = `推荐路线全程${distKm}公里，预计${durMin}分钟到达。`

    if (route.trafficStatus) {
      summary += `当前路况${route.trafficStatus}。`
    }

    if (weather) {
      summary += `天气${weather.weather}，气温${weather.temperature}℃。`
    }

    if (route.weatherImpact && route.weatherImpact !== '无影响') {
      summary += `天气${route.weatherImpact}，请注意安全。`
    }

    if (pois && pois.length > 0) {
      summary += `途中有${pois.length}个推荐地点。`
    }

    if (route.tolls && route.tolls > 0) {
      summary += `预计过路费${route.tolls}元。`
    }

    return summary
  }

  /**
   * 获取Mock结果
   */
  private getMockResult(): RoutePlanResult {
    return {
      recommendedRouteId: 'r1',
      routes: [
        {
          id: 'r1',
          distanceMeters: 12500,
          durationSeconds: 1500,
          score: 0.92,
          scoreDetails: { timeScore: 0.9, distanceScore: 0.85, trafficScore: 0.8, weatherScore: 1, preferenceScore: 0.9 },
          trafficStatus: '畅通',
          weatherImpact: '无影响',
          steps: [
            { instruction: '从起点出发', distanceMeters: 800, durationSeconds: 120 },
            { instruction: '上主干道行驶', distanceMeters: 9000, durationSeconds: 1020 },
            { instruction: '驶入目的地区域', distanceMeters: 2700, durationSeconds: 360 }
          ],
          points: [
            { lng: 116.397, lat: 39.908 },
            { lng: 116.41, lat: 39.91 },
            { lng: 116.43, lat: 39.92 },
            { lng: 116.45, lat: 39.93 }
          ]
        },
        {
          id: 'r2',
          distanceMeters: 11000,
          durationSeconds: 1620,
          score: 0.88,
          scoreDetails: { timeScore: 0.8, distanceScore: 0.9, trafficScore: 0.85, weatherScore: 1, preferenceScore: 0.85 },
          trafficStatus: '畅通',
          weatherImpact: '无影响',
          steps: [
            { instruction: '从起点出发', distanceMeters: 600, durationSeconds: 90 },
            { instruction: '途经次干道', distanceMeters: 9400, durationSeconds: 1200 },
            { instruction: '驶入目的地区域', distanceMeters: 1000, durationSeconds: 330 }
          ],
          points: [
            { lng: 116.397, lat: 39.908 },
            { lng: 116.40, lat: 39.905 },
            { lng: 116.42, lat: 39.907 },
            { lng: 116.44, lat: 39.909 }
          ]
        }
      ],
      generatedAt: Date.now(),
      aiSummary: '推荐路线全程12.5公里，预计25分钟到达。当前路况良好。'
    }
  }
}
