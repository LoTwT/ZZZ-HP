/** 在内存渲染器中执行真实 SFC setup；只替换与被测取值无关的视图依赖。 */
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'

export function mountVueSetup(url, { props = {}, imports = {}, expose = [] } = {}) {
  const original = readFileSync(url, 'utf8')
  const source = expose.length
    ? original.replace('</script>', `\ndefineExpose({ ${expose.join(', ')} });\n</script>`)
    : original
  const { descriptor } = parse(source, { filename: url.pathname })
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
