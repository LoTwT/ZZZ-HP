/** 在内存渲染器中执行真实 SFC setup；只替换与被测取值无关的视图依赖。 */
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'

export function mountVueSetup(url, { props = {}, imports = {}, expose = [], plugins = [] } = {}) {
  const original = readFileSync(url, 'utf8')
  let source = original
  let { descriptor } = parse(original, { filename: url.pathname })
  /**
   * 暴露被测绑定（不去替换源码里的 `</script>`：那个字符串在有的 SFC 里还出现在别处，
   * 替换会插到错误位置造成语法错误；也不能无脑追加第二个 `defineExpose`，组件本来就可能有一个）。
   * 规则：已经露出就不动；已有 `defineExpose({` 就并进去；都没有才追加。
   *
   * 注意：`@vue/compiler-sfc` 3.5 的 `compileScript` 是从 `descriptor.source`（整份 SFC 源码）
   * 建的 MagicString，只改 `descriptor.scriptSetup.content` **不会**进编译输入。所以这里按
   * `scriptSetup.loc.start.offset` 原位插到源码里，再重新 `parse()` 一次拿到新 descriptor。
   */
  if (expose.length && descriptor.scriptSetup) {
    const block = descriptor.scriptSetup
    const content = block.content
    const declarative = content.match(/defineExpose\(\{([\s\S]*?)\}\)/)
    const alreadyExposed = declarative ? declarative[1] : ''
    // 只认「作为键出现」，否则像 `void hitCalcGlobalSignature.value` 这种方法体引用会被误判成已暴露
    const asKey = (name) => new RegExp(`[{,]\\s*${name}\\s*[,}]`).test(`{${alreadyExposed}}`)
    const missing = expose.filter((name) => !asKey(name))
    if (missing.length) {
      const insertion = declarative
        ? {
            at: block.loc.start.offset + content.indexOf('defineExpose({') + 'defineExpose({'.length,
            text: ` ${missing.join(', ')},`,
          }
        : { at: block.loc.start.offset + content.length, text: `\ndefineExpose({ ${missing.join(', ')} });\n` }
      source = original.slice(0, insertion.at) + insertion.text + original.slice(insertion.at)
      descriptor = parse(source, { filename: url.pathname }).descriptor
    }
  }
  const script = compileScript(descriptor, { id: 'regression-setup' })
  const code = ts.transpileModule(script.content, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === 'vue') return vue
      if (name in imports) return imports[name]
      // 被移除的模板仍会暴露组件绑定；不执行这些视图组件。
      if (name.endsWith('.vue')) return { default: {} }
      throw new Error(`SFC 测试未提供真实依赖：${name}`)
    },
    module,
    module.exports,
  )
  const component = module.exports.default
  component.render = () => vue.h('div')
  const renderer = vue.createRenderer({
    createElement: () => ({ children: [] }),
    createText: (text) => ({ text }),
    createComment: () => ({}),
    insert: (child, parent) => parent.children.push(child),
    remove: () => {},
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text },
    parentNode: () => null,
    nextSibling: () => null,
    patchProp: () => {},
  })
  const rootProps = vue.reactive(props)
  const child = vue.ref()
  const app = renderer.createApp({ setup: () => () => vue.h(component, { ...rootProps, ref: child }) })
  for (const plugin of plugins) app.use(plugin)
  app.mount({ children: [] })
  return { get vm() { return child.value }, props: rootProps, unmount: () => app.unmount() }
}

/** 加载方法测试执行原始函数体，配合 Vue ref 检查真实模型，不复制其判断逻辑。 */
export function bindVueFunctions(url, names, bindings) {
  const source = parse(readFileSync(url, 'utf8')).descriptor.scriptSetup.content
  const ast = ts.createSourceFile('setup.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = names.map((name) => {
    const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name)
    if (!node) throw new Error(`SFC 方法不存在：${name}`)
    return node.getText(ast)
  }).join('\n')
  const code = ts.transpileModule(declarations, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  return new Function(...Object.keys(bindings), `${code}\nreturn { ${names.join(',')} };`)(...Object.values(bindings))
}
