/**
 * 「侧栏导航跳到区块」的滚动决策（纯函数）。
 * 运行：npx vite-node scripts/test-nav-scroll.mjs
 *
 * 背景（2026-10-22 用户需求）：
 * 1. 远距离导航做成瞬移，短距离仍平滑；
 * 2. 落地要避开顶部 sticky 条（它还会收起/展开，高度是变量）。
 */
import { planNavScroll } from '../src/utils/navScrollPlan.ts'

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 容器：视口高 800，顶边在屏幕 y=0；目标默认在容器内容坐标 1000 处 */
function base(over = {}) {
  return {
    scrollTop: 0,
    containerHeight: 800,
    containerTop: 0,
    targetTop: 1000,
    targetBottom: 1200,
    targetHeight: 200,
    offset: 120,
    ...over,
  }
}

console.log('\n[1] 落点 = 当前滚动量 + (目标顶 - 容器顶) - 让位高度')
{
  const plan = planNavScroll(base())
  check('top = 1000 - 120 = 880', plan.top === 880, String(plan.top))
  check('需要滚动', plan.action === 'scroll')
  const scrolled = planNavScroll(base({ scrollTop: 400, targetTop: 500, targetBottom: 700 }))
  check('已滚 400 时：400 + 500 - 120 = 780', scrolled.top === 780, String(scrolled.top))
}

console.log('\n[2] 目标在上方 / 顶部边界：不出现负值')
{
  const up = planNavScroll(base({ scrollTop: 2000, targetTop: 300, targetBottom: 500 }))
  check('往上跳按同一公式算（2000+300-120）', up.top === 2180, String(up.top))
  const top = planNavScroll(base({ scrollTop: 40, targetTop: 10, targetBottom: 210 }))
  check('贴顶时夹到 0', top.top === 0, String(top.top))
}

console.log('\n[3] 目标已经整块露在可视区 → 不动（连点同一项不跳）')
{
  const plan = planNavScroll(
    base({ scrollTop: 900, targetTop: 220, targetBottom: 420, targetHeight: 200 }),
  )
  check('skip', plan.action === 'skip', plan.action)
  check('skip 时不带 instant', plan.instant === false)
}

console.log('\n[4] 近距离 → 平滑；远距离 → 瞬移')
{
  const near = planNavScroll(base({ scrollTop: 700, targetTop: 900, targetBottom: 1100 }))
  check('差 80px 用平滑', near.behavior === 'smooth' && near.instant === false, near.behavior)
  const far = planNavScroll(base({ scrollTop: 0 }))
  check('差 880px（>1.6 屏 1280? 否）用平滑', far.behavior === 'smooth', far.behavior)
  const veryFar = planNavScroll(base({ targetTop: 5000, targetBottom: 5200, scrollTop: 0 }))
  check('差 4880px → 瞬移', veryFar.behavior === 'auto' && veryFar.instant === true, veryFar.behavior)
}

console.log('\n[5] 阈值按容器可视高度算（1.6 屏 = 1280px）')
{
  const exactly = planNavScroll(base({ targetTop: 1400, targetBottom: 1600, offset: 120, scrollTop: 0 }))
  check('刚好 1280 仍算近', exactly.behavior === 'smooth', `${exactly.top}`)
  const over = planNavScroll(base({ targetTop: 1401, targetBottom: 1601, offset: 120, scrollTop: 0 }))
  check('1281 就瞬移', over.behavior === 'auto')
  const custom = planNavScroll(
    base({ targetTop: 5000, targetBottom: 5200, instantScreenRatio: 10 }),
  )
  check('阈值可调（10 屏 → 这次算近）', custom.behavior === 'smooth')
}

console.log('\n[6] 系统「减少动态效果」一律瞬移')
{
  const plan = planNavScroll(base({ scrollTop: 700, targetTop: 900, targetBottom: 1100, reduceMotion: true }))
  check('短距离也 instant', plan.behavior === 'auto' && plan.instant === true)
}

console.log('\n[7] 目标比可视区还高 → 不算"已经可见"，仍滚到顶对齐')
{
  const tall = planNavScroll(
    base({ scrollTop: 900, targetTop: 220, targetBottom: 1400, targetHeight: 1180 }),
  )
  check('照常滚动', tall.action === 'scroll', tall.action)
  check('滚到让位后的位置（900+220-120）', tall.top === 1000, String(tall.top))
}

console.log('\n[8] 顶栏高度（收起 vs 展开）直接影响落点')
{
  const expanded = planNavScroll(base({ offset: 120 }))
  const folded = planNavScroll(base({ offset: 46 }))
  check('展开 120 → 880', expanded.top === 880, String(expanded.top))
  check('收起 46 → 954', folded.top === 954, String(folded.top))
  check('差 74px（就是顶栏高差）', folded.top - expanded.top === 74)
}

console.log(`\n结果：${passed} passed / ${failed} failed`)
if (failed) process.exitCode = 1
