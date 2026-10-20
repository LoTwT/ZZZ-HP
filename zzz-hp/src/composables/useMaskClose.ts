/**
 * 弹窗遮罩点击关闭 —— 只关「按下和松开都在遮罩上」的那次点击。
 *
 * ## 为什么不能再用 `@click.self`
 *
 * 按 DOM 规范，`click` 事件派发给 **mousedown 与 mouseup 两个目标的最近公共祖先**。
 * 于是「按下在弹窗内部、拖到遮罩上松开」（拖选文字、拖滑块出界松手、拖滚动条出界松手）
 * 时，`click` 的 target 是遮罩 —— `@click.self` 成立 → 弹窗被误关。
 *
 * 换成「记下 `pointerdown` 落在哪、`click` 时再看松开落在哪」：两次都在遮罩上才算
 * 「真的点了一下遮罩」，从弹窗里拖出去松手不再误关。
 *
 * ## 状态为什么不用 `ref`
 *
 * 这两个标记只参与事件回调里的判断，不参与渲染，用普通变量即可（`ref` 反而多一层解包
 * 与依赖收集）。同一个遮罩**必须**独占一个 `useMaskClose()` 实例；一个组件里有多个遮罩时
 * 各调一次，否则两处的按下态会互相串。
 */

/** 「这次点击该不该关」的判定输入 */
export interface MaskClickEnds {
  /** 按下（pointerdown）时 target 是不是遮罩本身 */
  pressedOnMask: boolean
  /** 松开（click）时 target 是不是遮罩本身 */
  releasedOnMask: boolean
}

/**
 * 纯函数：按下与松开**都在遮罩上**才关。
 *
 * 抽出来是为了能脱离 DOM 单测（`scripts/test-mask-close.mjs`）。
 */
export function shouldCloseOnMaskClick({ pressedOnMask, releasedOnMask }: MaskClickEnds): boolean {
  return pressedOnMask && releasedOnMask
}

/**
 * 遮罩关窗手势。
 *
 * @param onClose 确认是真的点了遮罩之后要做的事（即原来写在 `@click.self` 里的那句）
 */
export function useMaskClose(onClose: () => void) {
  /** 本次手势按下的位置是不是遮罩（一次手势的生命周期：pointerdown → click） */
  let pressedOnMask = false

  function onMaskPointerDown(e: PointerEvent) {
    pressedOnMask = e.target === e.currentTarget
  }

  function onMaskClick(e: MouseEvent) {
    const shouldClose = shouldCloseOnMaskClick({
      pressedOnMask,
      releasedOnMask: e.target === e.currentTarget,
    })
    // 先复位再关：即使 onClose 抛错，也不会把「已按下」的记忆留到下一次点击（那样会误关）
    pressedOnMask = false
    if (shouldClose) onClose()
  }

  return { onMaskPointerDown, onMaskClick }
}
