/**
 * 「侧栏导航跳到某个区块」该怎么滚 —— 纯函数，抽出来便于测试。
 *
 * 背景（2026-10-22）：计算器页的滚动不在 window 上，而在 `.content` 这个容器里
 * （外层 `.calculator-page` 是 `100vh + overflow:hidden`），顶栏又是 `position: sticky`，
 * 所以落地位置必须
 *   1. 用容器的 `scrollTop / clientHeight` 算，不能用 window 的滚动量；
 *   2. 让出顶栏实际高度 `offset`（顶栏会收起/展开、窄屏会换行，高度是变量）；
 *   3. 远距离直接瞬移（`behavior: 'auto'`），短距离才平滑 —— 长页面平滑滚动要好几秒。
 *
 * 这个模块只负责"算"，DOM 读取与真正的 `scrollTo` 留在组件里。
 */

export interface NavScrollPlanInput {
  /** 滚动容器当前的 scrollTop */
  scrollTop: number
  /** 滚动容器可视高度 */
  containerHeight: number
  /** 滚动容器顶边（视口坐标） */
  containerTop: number
  /** 目标区块上下边（视口坐标） */
  targetTop: number
  targetBottom: number
  /** 目标区块自身高度 */
  targetHeight: number
  /** 顶栏高度 + 额外间隙（px） */
  offset: number
  /** 超过多少屏算"远距离"（默认 1.6） */
  instantScreenRatio?: number
  /** 系统开了「减少动态效果」 */
  reduceMotion?: boolean
}

export interface NavScrollPlan {
  /** skip = 目标已经整块露在可视区，不要动它 */
  action: 'skip' | 'scroll'
  /** 目标 scrollTop（已夹到 >= 0） */
  top: number
  behavior: 'auto' | 'smooth'
  /** 是否走了瞬移（组件据此决定要不要给目标闪一下） */
  instant: boolean
}

/** 整块已经露在可视区（顶边没被顶栏压住、底边没出界、且比可视区矮） */
function fullyVisible(input: NavScrollPlanInput): boolean {
  const viewportTop = input.containerTop + input.offset
  const viewportBottom = input.containerTop + input.containerHeight
  return (
    input.targetTop >= viewportTop - 2 &&
    input.targetBottom <= viewportBottom + 2 &&
    input.targetHeight <= input.containerHeight - input.offset
  )
}

export function planNavScroll(input: NavScrollPlanInput): NavScrollPlan {
  const ratio = input.instantScreenRatio ?? 1.6
  const top = Math.max(0, input.scrollTop + (input.targetTop - input.containerTop) - input.offset)

  if (fullyVisible(input)) {
    return { action: 'skip', top, behavior: 'auto', instant: false }
  }

  const delta = Math.abs(top - input.scrollTop)
  const instant = input.reduceMotion === true || delta > input.containerHeight * ratio
  return { action: 'scroll', top, behavior: instant ? 'auto' : 'smooth', instant }
}
