/**
 * 弹窗遮罩点击关闭判定测试（「按下在弹窗里、拖到遮罩上松手」不许关）。
 *
 * 回归：遮罩原来用 `@click.self` 关窗。按 DOM 规范，`click` 派发给 mousedown 与 mouseup
 * 两个目标的**最近公共祖先** —— 在弹窗里按下、拖到遮罩上松开时，click 的 target 就是遮罩，
 * `@click.self` 成立 → 弹窗被误关（拖选文字、拖滑块出界松手都会触发）。
 *
 * 现在改成记 pointerdown 落点 + click 落点，两者都在遮罩上才关。
 *
 * 运行：npx vite-node scripts/test-mask-close.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { shouldCloseOnMaskClick, useMaskClose } from '../src/composables/useMaskClose.ts'

let failed = 0
let passed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('遮罩点击关闭判定（纯函数）：')

check(
  '按下在遮罩 + 释放在遮罩 → 关',
  shouldCloseOnMaskClick({ pressedOnMask: true, releasedOnMask: true }) === true,
  '真正点了一下遮罩，要能关',
)

check(
  '按下在弹窗内 + 释放在遮罩 → 不关',
  shouldCloseOnMaskClick({ pressedOnMask: false, releasedOnMask: true }) === false,
  '本次修的 bug：拖选文字 / 拖滑块出界松手',
)

check(
  '按下在遮罩 + 释放在弹窗内 → 不关',
  shouldCloseOnMaskClick({ pressedOnMask: true, releasedOnMask: false }) === false,
  '从遮罩上按下、拖回弹窗里松手，也不该关',
)

check(
  '按下与释放都不在遮罩 → 不关',
  shouldCloseOnMaskClick({ pressedOnMask: false, releasedOnMask: false }) === false,
  '弹窗内部普通点击',
)

// ---------------------------------------------------------------------------
// useMaskClose：用最小对象模拟事件（只要 target / currentTarget，不需要 DOM 库）
// ---------------------------------------------------------------------------

const maskEl = { id: 'mask' }
const cardEl = { id: 'card' }

/** 造一个假事件：target = 事件实际落在的元素，currentTarget = 绑事件的元素（遮罩） */
function fakeEvent(target) {
  return { target, currentTarget: maskEl }
}

/** 新建一个带计数的实例 */
function makeInstance() {
  const counter = { closed: 0 }
  const handlers = useMaskClose(() => {
    counter.closed += 1
  })
  return { counter, handlers }
}

/** 模拟一次完整手势：先 pointerdown（落在 downOn），再 click（落在 upOn） */
function gesture(handlers, downOn, upOn) {
  handlers.onMaskPointerDown(fakeEvent(downOn))
  handlers.onMaskClick(fakeEvent(upOn))
}

console.log('\nuseMaskClose 手势（按下 + 松开两个落点）：')

{
  const { counter, handlers } = makeInstance()
  gesture(handlers, maskEl, maskEl)
  check('按下在遮罩 + 释放在遮罩 → 关一次', counter.closed === 1, `closed=${counter.closed}`)
}

{
  const { counter, handlers } = makeInstance()
  gesture(handlers, cardEl, maskEl)
  check(
    '按下在弹窗内 + 释放在遮罩 → 不关（本次修的 bug）',
    counter.closed === 0,
    `closed=${counter.closed}`,
  )
}

{
  const { counter, handlers } = makeInstance()
  gesture(handlers, maskEl, cardEl)
  check('按下在遮罩 + 释放在弹窗内 → 不关', counter.closed === 0, `closed=${counter.closed}`)
}

console.log('\n连续两次：不关之后状态必须复位：')

{
  // 第一次「弹窗内按下 → 遮罩上松开」不关；复位后再来一次规范的遮罩点击，仍能关
  const { counter, handlers } = makeInstance()
  gesture(handlers, cardEl, maskEl)
  const afterFirst = counter.closed
  gesture(handlers, maskEl, maskEl)
  check(
    '第一次不关 → 第二次「按下+释放都在遮罩」仍能关',
    afterFirst === 0 && counter.closed === 1,
    `第一次后 closed=${afterFirst}，第二次后 closed=${counter.closed}`,
  )
}

{
  // 更严格的复位检查：一次手势结束后（哪怕没关）按下态必须清掉。
  // 否则「遮罩上按下 → 拖回弹窗松手」留下的 true，会让**下一次没有 pointerdown 的 click**
  // 误判成「按下在遮罩」而误关。
  const { counter, handlers } = makeInstance()
  gesture(handlers, maskEl, cardEl)
  handlers.onMaskClick(fakeEvent(cardEl))
  check(
    '一次手势后按下态复位：后续只有 click（无 pointerdown）不会误关',
    counter.closed === 0,
    `closed=${counter.closed}`,
  )
}

{
  // onClose 本身抛错也不能把按下态留在那儿
  let thrown = 0
  const handlers = useMaskClose(() => {
    thrown += 1
    throw new Error('boom')
  })
  try {
    gesture(handlers, maskEl, maskEl)
  } catch {
    /* 预期抛出 */
  }
  let secondClosed = false
  try {
    handlers.onMaskClick(fakeEvent(cardEl))
  } catch {
    secondClosed = true
  }
  check(
    'onClose 抛错后按下态也已复位（不会连带第二次误关）',
    thrown === 1 && secondClosed === false,
    `onClose 调用 ${thrown} 次`,
  )
}

// ---------------------------------------------------------------------------
// 源码契约：遮罩不许再退回 @click.self，且全部改成了 pointerdown + click
// ---------------------------------------------------------------------------

console.log('\n源码契约（防止改回去）：')

function collectVueFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectVueFiles(full, out)
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

const vueFiles = collectVueFiles(path.resolve('src'))
const offenders = []
let pointerDownSites = 0
let clickSites = 0

for (const file of vueFiles) {
  const source = fs.readFileSync(file, 'utf8')
  if (source.includes('@click.self')) offenders.push(file)
  pointerDownSites += source.match(/@pointerdown="on\w*MaskPointerDown"/g)?.length ?? 0
  clickSites += source.match(/@click="on\w*MaskClick"/g)?.length ?? 0
}

check(
  '全仓库不再有 @click.self',
  offenders.length === 0,
  offenders.length ? `仍在用：${offenders.map((f) => path.relative('.', f)).join('、')}` : '',
)
check(
  '遮罩 pointerdown 与 click 成对（各 28 处）',
  pointerDownSites === 28 && clickSites === 28,
  `pointerdown=${pointerDownSites}，click=${clickSites}`,
)

console.log(`\n结果：${passed} PASS / ${failed} FAIL`)
if (failed > 0) process.exitCode = 1
