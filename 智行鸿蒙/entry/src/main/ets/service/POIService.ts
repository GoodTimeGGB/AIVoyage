/**
 * POI搜索服务
 * 调用高德POI搜索API进行地点搜索
 */
import http from '@ohos.net.http'
import { getAmapKey } from '../config/AppConfig'

export interface POIInfo {
  id: string
  name: string
  type: string
  typecode: string
  address: string
  location: { lng: number; lat: number }
  distance?: number       // 距离（米）
  tel?: string            // 电话
  rating?: number         // 评分
  cost?: number           // 人均消费
  photos?: string[]       // 图片URL
  businessArea?: string   // 商圈
  openTime?: string       // 营业时间
}

export interface POISearchResult {
  success: boolean
  pois: POIInfo[]
  count: number
  suggestion?: {
    keywords?: string[]
    cities?: string[]
  }
  error?: string
}

// 常见POI类型编码
export const POI_TYPES = {
  餐饮: '050000',
  咖啡: '050500',
  加油站: '010100',
  充电站: '011100',
  停车场: '150900',
  超市: '060400',
  银行: '160100',
  医院: '090100',
  药店: '090600',
  酒店: '100000',
  景点: '110000',
  购物: '060000'
} as const

export default class POIService {
  private readonly SEARCH_URL = 'https://restapi.amap.com/v3/place/text'
  private readonly AROUND_URL = 'https://restapi.amap.com/v3/place/around'
  private readonly POLYGON_URL = 'https://restapi.amap.com/v3/place/polygon'

  /**
   * 关键词搜索POI
   */
  async searchByKeyword(
    keyword: string,
    city?: string,
    options?: { page?: number; pageSize?: number; type?: string }
  ): Promise<POISearchResult> {
    const key = getAmapKey()
    if (!key) {
      return { success: false, pois: [], count: 0, error: '高德API Key未配置' }
    }

    const httpClient = http.createHttp()
    try {
      let url = `${this.SEARCH_URL}?keywords=${encodeURIComponent(keyword)}&key=${key}`
      if (city) {
        url += `&city=${encodeURIComponent(city)}`
      }
      if (options?.type) {
        url += `&types=${options.type}`
      }
      url += `&offset=${options?.pageSize || 20}&page=${options?.page || 1}`
      url += `&extensions=all`

      const response = await httpClient.request({
        url,
        method: http.RequestMethod.GET
      })

      const data = JSON.parse(response.result as string)
      if (data.status !== '1') {
        return { success: false, pois: [], count: 0, error: data.info || '搜索失败' }
      }

      const pois = this.parsePOIList(data.pois || [])

      return {
        success: true,
        pois,
        count: parseInt(data.count) || 0,
        suggestion: data.suggestion
      }
    } catch (e) {
      return { success: false, pois: [], count: 0, error: `POI搜索失败: ${e}` }
    } finally {
      httpClient.destroy()
    }
  }

  /**
   * 周边搜索POI
   */
  async searchAround(
    lng: number,
    lat: number,
    options?: {
      keyword?: string
      type?: string
      radius?: number
      page?: number
      pageSize?: number
      sortRule?: 'distance' | 'weight'
    }
  ): Promise<POISearchResult> {
    const key = getAmapKey()
    if (!key) {
      return { success: false, pois: [], count: 0, error: '高德API Key未配置' }
    }

    const httpClient = http.createHttp()
    try {
      let url = `${this.AROUND_URL}?location=${lng},${lat}&key=${key}`
      
      if (options?.keyword) {
        url += `&keywords=${encodeURIComponent(options.keyword)}`
      }
      if (options?.type) {
        url += `&types=${options.type}`
      }
      url += `&radius=${options?.radius || 3000}`
      url += `&offset=${options?.pageSize || 20}&page=${options?.page || 1}`
      url += `&sortrule=${options?.sortRule || 'distance'}`
      url += `&extensions=all`

      const response = await httpClient.request({
        url,
        method: http.RequestMethod.GET
      })

      const data = JSON.parse(response.result as string)
      if (data.status !== '1') {
        return { success: false, pois: [], count: 0, error: data.info || '周边搜索失败' }
      }

      const pois = this.parsePOIList(data.pois || [])

      return {
        success: true,
        pois,
        count: parseInt(data.count) || 0
      }
    } catch (e) {
      return { success: false, pois: [], count: 0, error: `周边搜索失败: ${e}` }
    } finally {
      httpClient.destroy()
    }
  }

  /**
   * 沿途搜索POI（在路径附近搜索）
   */
  async searchAlongRoute(
    routePoints: Array<{ lng: number; lat: number }>,
    options?: {
      keyword?: string
      type?: string
      maxDistance?: number  // 距离路径的最大距离（米）
    }
  ): Promise<POISearchResult> {
    if (routePoints.length < 2) {
      return { success: false, pois: [], count: 0, error: '路径点不足' }
    }

    // 沿途采样搜索
    const samplePoints: Array<{ lng: number; lat: number }> = []
    const step = Math.max(1, Math.floor(routePoints.length / 5)) // 最多采样5个点
    
    for (let i = 0; i < routePoints.length; i += step) {
      samplePoints.push(routePoints[i])
    }

    // 确保包含终点
    if (samplePoints[samplePoints.length - 1] !== routePoints[routePoints.length - 1]) {
      samplePoints.push(routePoints[routePoints.length - 1])
    }

    const allPois: POIInfo[] = []
    const seenIds = new Set<string>()

    for (const point of samplePoints) {
      const result = await this.searchAround(point.lng, point.lat, {
        keyword: options?.keyword,
        type: options?.type,
        radius: options?.maxDistance || 500,
        pageSize: 10
      })

      if (result.success) {
        for (const poi of result.pois) {
          if (!seenIds.has(poi.id)) {
            seenIds.add(poi.id)
            allPois.push(poi)
          }
        }
      }
    }

    // 按评分排序
    allPois.sort((a, b) => (b.rating || 0) - (a.rating || 0))

    return {
      success: true,
      pois: allPois.slice(0, 20),
      count: allPois.length
    }
  }

  /**
   * 获取POI类型编码
   */
  getTypeCode(typeName: string): string | undefined {
    return POI_TYPES[typeName as keyof typeof POI_TYPES]
  }

  /**
   * 根据POI类型名称搜索
   */
  async searchByTypeName(
    typeName: string,
    location: { lng: number; lat: number },
    radius?: number
  ): Promise<POISearchResult> {
    const typeCode = this.getTypeCode(typeName)
    return this.searchAround(location.lng, location.lat, {
      type: typeCode,
      keyword: typeCode ? undefined : typeName,
      radius: radius || 3000
    })
  }

  /**
   * 推荐顺路POI
   * 根据用户偏好和路径推荐合适的POI
   */
  async recommendAlongRoute(
    routePoints: Array<{ lng: number; lat: number }>,
    preferences: string[]
  ): Promise<{ category: string; pois: POIInfo[] }[]> {
    const recommendations: { category: string; pois: POIInfo[] }[] = []

    // 根据偏好确定搜索类型
    const typeMap: Record<string, string> = {
      coffee_shop: '咖啡',
      restaurant: '餐饮',
      gas_station: '加油站',
      charging_station: '充电站',
      parking: '停车场'
    }

    for (const pref of preferences) {
      const typeName = typeMap[pref]
      if (typeName) {
        const result = await this.searchAlongRoute(routePoints, {
          keyword: typeName,
          type: this.getTypeCode(typeName),
          maxDistance: 500
        })

        if (result.success && result.pois.length > 0) {
          recommendations.push({
            category: typeName,
            pois: result.pois.slice(0, 5)
          })
        }
      }
    }

    return recommendations
  }

  /**
   * 解析POI列表
   */
  private parsePOIList(rawPois: any[]): POIInfo[] {
    return rawPois.map(poi => {
      const [lng, lat] = (poi.location || '0,0').split(',').map(parseFloat)
      
      return {
        id: poi.id || '',
        name: poi.name || '',
        type: poi.type || '',
        typecode: poi.typecode || '',
        address: poi.address || '',
        location: { lng, lat },
        distance: poi.distance ? parseInt(poi.distance) : undefined,
        tel: poi.tel || undefined,
        rating: poi.biz_ext?.rating ? parseFloat(poi.biz_ext.rating) : undefined,
        cost: poi.biz_ext?.cost ? parseFloat(poi.biz_ext.cost) : undefined,
        photos: poi.photos?.map((p: any) => p.url) || [],
        businessArea: poi.business_area || undefined,
        openTime: poi.biz_ext?.opentime || undefined
      }
    })
  }

  /**
   * 计算两点间距离（米）
   */
  calculateDistance(
    point1: { lng: number; lat: number },
    point2: { lng: number; lat: number }
  ): number {
    const R = 6371000 // 地球半径（米）
    const dLat = this.toRad(point2.lat - point1.lat)
    const dLng = this.toRad(point2.lng - point1.lng)
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(point1.lat)) * Math.cos(this.toRad(point2.lat)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  private toRad(deg: number): number {
    return deg * Math.PI / 180
  }
}
