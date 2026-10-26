import { nextTick, onBeforeUnmount, ref } from 'vue'

/**
 * 说明浮层（问号 / 悬停数值）的统一交互口径。
 *
 * 用法：组件自己决定触发元素与浮层内容，只把 `triggerRef` / `tipRef` 和各 handler 挂上去。
 * 规则集中在这里，避免两处各写一套：
 * - 悬停、键盘聚焦显示；离开触发元素与浮层后延时 220ms 关闭
 * - 指针可移进浮层，框选复制文字
 * - 触屏点一下切换，点浮层外关闭；有精细指针的设备点击不额外触发
 * - 滚动 / 缩放重新定位，上方空间不足时翻到下方
 */
const HIDE_DELAY = 220
const EDGE = 12
const GAP = 10

export function useInfoTipPopover() {
  const triggerRef = ref<HTMLElement | null>(null)
  const tipRef = ref<HTMLElement | null>(null)
  const visible = ref(false)
  const tipStyle = ref<Record<string, string>>({})
  const below = ref(false)

  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let pointerOverTip = false

  async function updatePosition() {
    // 先等一帧让浮层真正渲染出来，再取元素；顺序反了会一直量不到
    await nextTick()
    const trigger = triggerRef.value
    const tip = tipRef.value
    if (!trigger || !tip) return

    const rect = trigger.getBoundingClientRect()
    const box = tip.getBoundingClientRect()
    const width = box.width
    const height = box.height

    let left = rect.left + rect.width / 2 - width / 2
    left = Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE))

    let top = rect.top - height - GAP
    const nextBelow = top < EDGE
    if (nextBelow) top = rect.bottom + GAP

    below.value = nextBelow
    tipStyle.value = {
      left: `${left}px`,
      top: `${top}px`,
      '--arrow-x': `${Math.max(12, Math.min(width - 12, rect.left + rect.width / 2 - left))}px`,
    }
  }

  function clearHideTimer() {
    if (hideTimer == null) return
    clearTimeout(hideTimer)
    hideTimer = null
  }

  function show() {
    clearHideTimer()
    visible.value = true
    void updatePosition()
  }

  function hide() {
    clearHideTimer()
    pointerOverTip = false
    visible.value = false
  }

  function scheduleHide() {
    clearHideTimer()
    hideTimer = setTimeout(() => {
      hideTimer = null
      if (!pointerOverTip) hide()
    }, HIDE_DELAY)
  }

  /** 指针进入浮层：取消关闭，允许选中复制 */
  function onTipEnter() {
    pointerOverTip = true
    clearHideTimer()
  }

  function onTipLeave() {
    pointerOverTip = false
    scheduleHide()
  }

  /** 触屏点击切换；有精细指针的设备交给悬停 */
  function onTriggerClick() {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (visible.value) hide()
    else show()
  }

  function onScrollOrResize() {
    if (!visible.value) return
    void updatePosition()
  }

  function onDocumentPointerDown(event: Event) {
    if (!visible.value) return
    const target = event.target
    if (!(target instanceof Node)) return
    if (triggerRef.value?.contains(target)) return
    if (tipRef.value?.contains(target)) return
    hide()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
  }

  onBeforeUnmount(() => {
    clearHideTimer()
    if (typeof window === 'undefined') return
    window.removeEventListener('scroll', onScrollOrResize, true)
    window.removeEventListener('resize', onScrollOrResize)
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  })

  return {
    triggerRef,
    tipRef,
    visible,
    tipStyle,
    below,
    show,
    hide,
    scheduleHide,
    onTipEnter,
    onTipLeave,
    onTriggerClick,
  }
}
