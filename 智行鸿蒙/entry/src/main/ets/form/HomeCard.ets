/**
 * 智行鸿蒙 - 元服务卡片
 * 提供快捷出行入口和通勤路况预览
 */

import formBindingData from '@ohos.app.form.formBindingData'

@Entry
@Component
export default struct HomeCard {
  @LocalStorageProp('formId') formId: number = 0
  @LocalStorageProp('commuteStatus') commuteStatus: string = '加载中...'
  @LocalStorageProp('commuteTime') commuteTime: string = '--'
  @LocalStorageProp('weather') weather: string = '☀️'
  @LocalStorageProp('trafficColor') trafficColor: string = '#4CAF50'

  build() {
    Column() {
      // 顶部标题栏
      Row() {
        Text('智行出行')
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor('#333')
        
        Blank()
        
        Text(this.weather)
          .fontSize(14)
      }
      .width('100%')
      .margin({ bottom: 8 })

      // 通勤路况卡片
      Row() {
        Column() {
          Text('通勤路况')
            .fontSize(12)
            .fontColor('#999')
          
          Row() {
            Circle({ width: 8, height: 8 })
              .fill(this.trafficColor)
              .margin({ right: 4 })
            
            Text(this.commuteStatus)
              .fontSize(14)
              .fontColor('#333')
          }
          .margin({ top: 4 })
        }
        .alignItems(HorizontalAlign.Start)
        
        Blank()
        
        Column() {
          Text('预计用时')
            .fontSize(12)
            .fontColor('#999')
          
          Text(this.commuteTime)
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor('#333')
            .margin({ top: 4 })
        }
        .alignItems(HorizontalAlign.End)
      }
      .width('100%')
      .padding(12)
      .backgroundColor('#f5f5f5')
      .borderRadius(8)
      .margin({ bottom: 12 })

      // 快捷按钮
      Row() {
        Button() {
          Column() {
            Text('🏠')
              .fontSize(20)
            Text('一键回家')
              .fontSize(10)
              .margin({ top: 4 })
          }
        }
        .type(ButtonType.Normal)
        .backgroundColor('#e3f2fd')
        .borderRadius(8)
        .width('30%')
        .height(60)
        .onClick(() => {
          postCardAction(this, {
            action: 'message',
            params: { action: 'go_home' }
          })
        })

        Button() {
          Column() {
            Text('🏢')
              .fontSize(20)
            Text('去公司')
              .fontSize(10)
              .margin({ top: 4 })
          }
        }
        .type(ButtonType.Normal)
        .backgroundColor('#e8f5e9')
        .borderRadius(8)
        .width('30%')
        .height(60)
        .margin({ left: 8 })
        .onClick(() => {
          postCardAction(this, {
            action: 'message',
            params: { action: 'go_work' }
          })
        })

        Button() {
          Column() {
            Text('📍')
              .fontSize(20)
            Text('附近搜索')
              .fontSize(10)
              .margin({ top: 4 })
          }
        }
        .type(ButtonType.Normal)
        .backgroundColor('#fff3e0')
        .borderRadius(8)
        .width('30%')
        .height(60)
        .margin({ left: 8 })
        .onClick(() => {
          postCardAction(this, {
            action: 'message',
            params: { action: 'search_nearby' }
          })
        })
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
    }
    .padding(12)
    .width('100%')
    .height('100%')
    .backgroundColor('#ffffff')
    .onClick(() => {
      postCardAction(this, {
        action: 'router',
        abilityName: 'EntryAbility'
      })
    })
  }
}
