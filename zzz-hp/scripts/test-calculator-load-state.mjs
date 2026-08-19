/**
 * 运行时验证：计算器初始加载、失败与重试状态
 *
 * 运行：npm run test:calculator-loading
 */

import { createRenderer, defineComponent, h, nextTick, shallowRef } from 'vue'
import CalculatorLoadStatus from '../src/components/calculator/CalculatorLoadStatus.vue'
import { resolveCalculatorLoadState } from '../src/utils/calculatorLoadState.ts'

let failed = 0
const check = (name, actual, expected) => {
  const ok = actual === expected
  if (!ok) failed++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      期望 ${expected}\n      实际 ${actual}`}`,
  )
}

check(
  '首次请求显示加载态',
  resolveCalculatorLoadState({ loading: true, loaded: false, error: '' }),
  'loading',
)
check(
  '请求失败显示错误态',
  resolveCalculatorLoadState({ loading: false, loaded: false, error: '网络错误' }),
  'error',
)
check(
  '请求成功显示内容',
  resolveCalculatorLoadState({ loading: false, loaded: true, error: '' }),
  'ready',
)
check(
  '已有数据刷新失败仍显示错误态',
  resolveCalculatorLoadState({ loading: false, loaded: true, error: '刷新失败' }),
  'error',
)

// 内存 host 只记录 focus() 调用；真实浏览器焦点由页面 smoke test 验证。
let focusedNode = null
let hostNodeId = 0

function createHostNode(type, text = '') {
  return {
    id: ++hostNodeId,
    type,
    text,
    props: {},
    children: [],
    parent: null,
    scopeIds: [],
    focus() {
      focusedNode = this
    },
    closest(selector) {
      let node = this
      while (node) {
        if (
          selector.startsWith('.') &&
          String(node.props.class ?? '')
            .split(/\s+/)
            .includes(selector.slice(1))
        ) {
          return node
        }
        node = node.parent
      }
      return null
    },
  }
}

function insert(child, parent, anchor = null) {
  if (child.parent) remove(child)
  child.parent = parent
  const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1
  if (anchorIndex >= 0) parent.children.splice(anchorIndex, 0, child)
  else parent.children.push(child)
}

function remove(child) {
  if (!child.parent) return
  const index = child.parent.children.indexOf(child)
  if (index >= 0) child.parent.children.splice(index, 1)
  child.parent = null
}

const renderer = createRenderer({
  patchProp(element, key, _previousValue, nextValue) {
    if (nextValue == null) delete element.props[key]
    else element.props[key] = nextValue
  },
  insert,
  remove,
  createElement(type) {
    return createHostNode(type)
  },
  createText(text) {
    return createHostNode('#text', text)
  },
  createComment(text) {
    return createHostNode('#comment', text)
  },
  setText(node, text) {
    node.text = text
  },
  setElementText(element, text) {
    for (const child of element.children) child.parent = null
    element.children = []
    element.text = text
  },
  parentNode(node) {
    return node.parent
  },
  nextSibling(node) {
    if (!node.parent) return null
    const index = node.parent.children.indexOf(node)
    return node.parent.children[index + 1] ?? null
  },
  setScopeId(element, id) {
    element.scopeIds.push(id)
  },
})

function walk(node, visit) {
  if (visit(node)) return node
  for (const child of node.children) {
    const match = walk(child, visit)
    if (match) return match
  }
  return null
}

function findElement(root, type) {
  return walk(root, (node) => node.type === type)
}

function findByRole(root, role) {
  return walk(root, (node) => node.props.role === role)
}

function renderedText(node) {
  return [node.text, ...node.children.map(renderedText)]
    .filter(Boolean)
    .join(' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const loadState = shallowRef('error')
const loadError = shallowRef('首次加载失败')
let retryAttempts = 0
let lastForce = null
let settleRetry = null

const loader = {
  loadAll(force) {
    retryAttempts++
    lastForce = force
    loadState.value = 'loading'
    loadError.value = ''

    return new Promise((resolve, reject) => {
      settleRetry = (outcome) => {
        settleRetry = null
        if (outcome === 'success') {
          loadState.value = 'ready'
          resolve()
          return
        }
        loadState.value = 'error'
        loadError.value = '重试仍然失败'
        reject(new Error(loadError.value))
      }
    })
  },
}

const Harness = defineComponent({
  setup() {
    return () =>
      h('section', { class: 'content', tabindex: -1, 'aria-label': '计算器内容' }, [
        h(CalculatorLoadStatus, {
          state: loadState.value,
          error: loadError.value,
          loader,
        }),
      ])
  },
})

const root = createHostNode('#root')
const app = renderer.createApp(Harness)
app.mount(root)
await nextTick()

let contentRegion = findElement(root, 'section')
let statusRegion = findElement(root, 'div')
let statusMessage = findByRole(root, 'status')
let alertMessage = findByRole(root, 'alert')
let retryButton = findElement(root, 'button')
check('错误态渲染可操作重试按钮', renderedText(retryButton), '重新加载')
check('错误态通过独立 alert 文本播报', renderedText(alertMessage), '首次加载失败')

const firstRetry = retryButton.props.onClick()
void retryButton.props.onClick()
await nextTick()

statusRegion = findElement(root, 'div')
statusMessage = findByRole(root, 'status')
check('点击按钮发起一次重试请求', retryAttempts, 1)
check('重试强制刷新已有状态', lastForce, true)
check('重试期间显示明确加载文案', renderedText(statusMessage).includes('正在重新加载'), true)
check('重试期间焦点移动到状态区', focusedNode?.id, statusRegion.id)

settleRetry('error')
await firstRetry
await nextTick()

statusRegion = findElement(root, 'div')
alertMessage = findByRole(root, 'alert')
retryButton = findElement(root, 'button')
check('重试失败重新播报后端错误', renderedText(alertMessage), '重试仍然失败')
check('重试失败恢复按钮焦点', focusedNode?.id, retryButton.id)

const secondRetry = retryButton.props.onClick()
await nextTick()
settleRetry('success')
await secondRetry
await nextTick()

statusRegion = findElement(root, 'div')
contentRegion = findElement(root, 'section')
statusMessage = findByRole(root, 'status')
check('再次重试会发起第二次请求', retryAttempts, 2)
check('重试成功进入就绪态', loadState.value, 'ready')
check('重试成功播报完成消息', renderedText(statusMessage), '计算器数据加载完成')
check('重试成功后焦点进入计算器内容', focusedNode?.id, contentRegion.id)

app.unmount()

console.log('')
console.log(failed === 0 ? '全部通过' : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
