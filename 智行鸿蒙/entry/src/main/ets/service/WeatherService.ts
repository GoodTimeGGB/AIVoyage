/**
 * 天气服务
 * 调用高德天气API获取实时天气和预报信息
 */
import http from '@ohos.net.http'
import { getAmapKey } from '../config/AppConfig'

export interface WeatherInfo {
  city: string
  weather: string
  temperature: string
  windDirection: string
  windPower: string
  humidity: string
  reportTime: string
}

export interface WeatherForecast {
  date: string
  week: string
  dayWeather: string
  nightWeather: string
  dayTemp: string
  nightTemp: string
  dayWind: string
  nightWind: string
  dayPower: string
  nightPower: string
}

export interface WeatherResult {
  success: boolean
  live?: WeatherInfo
  forecasts?: WeatherForecast[]
  error?: string
  tips?: string
}

export default class WeatherService {
  private readonly BASE_URL = 'https://restapi.amap.com/v3/weather/weatherInfo'

  /**
   * 获取实时天气
   */
  async getLiveWeather(cityCode: string): Promise<WeatherResult> {
    const key = getAmapKey()
    if (!key) {
      return { success: false, error: '高德API Key未配置' }
    }

    const httpClient = http.createHttp()
    try {
      const response = await httpClient.request({
        url: `${this.BASE_URL}?city=${cityCode}&key=${key}&extensions=base`,
        method: http.RequestMethod.GET
      })

      const data = JSON.parse(response.result as string)
      if (data.status !== '1' || !data.lives || data.lives.length === 0) {
        return { success: false, error: data.info || '获取天气失败' }
      }

      const live = data.lives[0]
      const weatherInfo: WeatherInfo = {
        city: live.city,
        weather: live.weather,
        temperature: live.temperature,
        windDirection: live.winddirection,
        windPower: live.windpower,
        humidity: live.humidity,
        reportTime: live.reporttime
      }

      return {
        success: true,
        live: weatherInfo,
        tips: this.generateWeatherTips(weatherInfo)
      }
    } catch (e) {
      return { success: false, error: `天气请求失败: ${e}` }
    } finally {
      httpClient.destroy()
    }
  }

  /**
   * 获取天气预报
   */
  async getWeatherForecast(cityCode: string): Promise<WeatherResult> {
    const key = getAmapKey()
    if (!key) {
      return { success: false, error: '高德API Key未配置' }
    }

    const httpClient = http.createHttp()
    try {
      const response = await httpClient.request({
        url: `${this.BASE_URL}?city=${cityCode}&key=${key}&extensions=all`,
        method: http.RequestMethod.GET
      })

      const data = JSON.parse(response.result as string)
      if (data.status !== '1' || !data.forecasts || data.forecasts.length === 0) {
        return { success: false, error: data.info || '获取天气预报失败' }
      }

      const forecast = data.forecasts[0]
      const forecasts: WeatherForecast[] = (forecast.casts || []).map((cast: any) => ({
        date: cast.date,
        week: cast.week,
        dayWeather: cast.dayweather,
        nightWeather: cast.nightweather,
        dayTemp: cast.daytemp,
        nightTemp: cast.nighttemp,
        dayWind: cast.daywind,
        nightWind: cast.nightwind,
        dayPower: cast.daypower,
        nightPower: cast.nightpower
      }))

      return {
        success: true,
        forecasts
      }
    } catch (e) {
      return { success: false, error: `天气预报请求失败: ${e}` }
    } finally {
      httpClient.destroy()
    }
  }

  /**
   * 根据经纬度获取天气（先逆地理编码获取城市编码）
   */
  async getWeatherByLocation(lng: number, lat: number): Promise<WeatherResult> {
    const key = getAmapKey()
    if (!key) {
      return { success: false, error: '高德API Key未配置' }
    }

    const httpClient = http.createHttp()
    try {
      // 逆地理编码获取城市编码
      const geoResponse = await httpClient.request({
        url: `https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${key}`,
        method: http.RequestMethod.GET
      })

      const geoData = JSON.parse(geoResponse.result as string)
      const adcode = geoData?.regeocode?.addressComponent?.adcode

      if (!adcode) {
        return { success: false, error: '无法获取当前位置的城市编码' }
      }

      // 使用城市编码获取天气
      return await this.getLiveWeather(adcode)
    } catch (e) {
      return { success: false, error: `获取位置天气失败: ${e}` }
    } finally {
      httpClient.destroy()
    }
  }

  /**
   * 生成天气出行提示
   */
  private generateWeatherTips(weather: WeatherInfo): string {
    const tips: string[] = []

    // 根据天气状况生成提示
    const weatherType = weather.weather
    if (weatherType.includes('雨')) {
      tips.push('请注意携带雨具，道路湿滑请谨慎驾驶')
    }
    if (weatherType.includes('雪')) {
      tips.push('雪天路滑，请减速慢行')
    }
    if (weatherType.includes('雾') || weatherType.includes('霾')) {
      tips.push('能见度较低，请开启雾灯谨慎驾驶')
    }

    // 根据温度生成提示
    const temp = parseInt(weather.temperature)
    if (temp > 35) {
      tips.push('高温天气，请注意防暑降温')
    } else if (temp < 0) {
      tips.push('低温天气，请注意保暖防寒')
    }

    // 根据风力生成提示
    const windPower = parseInt(weather.windPower)
    if (windPower >= 6) {
      tips.push('风力较大，高速行驶请注意安全')
    }

    return tips.length > 0 ? tips.join('；') : '天气良好，祝您出行愉快'
  }

  /**
   * 评估天气对出行的影响
   * 返回影响系数 0-1，越大表示影响越严重
   */
  evaluateWeatherImpact(weather: WeatherInfo): { impact: number; level: string; reason: string } {
    let impact = 0
    const reasons: string[] = []

    const weatherType = weather.weather
    if (weatherType.includes('暴雨') || weatherType.includes('大暴雨')) {
      impact += 0.5
      reasons.push('暴雨')
    } else if (weatherType.includes('大雨') || weatherType.includes('中雨')) {
      impact += 0.3
      reasons.push('降雨')
    } else if (weatherType.includes('雨')) {
      impact += 0.1
      reasons.push('小雨')
    }

    if (weatherType.includes('暴雪') || weatherType.includes('大雪')) {
      impact += 0.6
      reasons.push('大雪')
    } else if (weatherType.includes('雪')) {
      impact += 0.3
      reasons.push('降雪')
    }

    if (weatherType.includes('大雾') || weatherType.includes('浓雾')) {
      impact += 0.5
      reasons.push('大雾')
    } else if (weatherType.includes('雾')) {
      impact += 0.2
      reasons.push('有雾')
    }

    if (weatherType.includes('霾')) {
      impact += 0.15
      reasons.push('雾霾')
    }

    const windPower = parseInt(weather.windPower) || 0
    if (windPower >= 8) {
      impact += 0.3
      reasons.push('强风')
    } else if (windPower >= 6) {
      impact += 0.15
      reasons.push('大风')
    }

    impact = Math.min(impact, 1)

    let level = '无影响'
    if (impact >= 0.5) {
      level = '严重影响'
    } else if (impact >= 0.3) {
      level = '中度影响'
    } else if (impact >= 0.1) {
      level = '轻微影响'
    }

    return {
      impact,
      level,
      reason: reasons.length > 0 ? reasons.join('、') : '天气良好'
    }
  }
}
