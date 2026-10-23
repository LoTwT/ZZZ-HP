/**
 * 共用方案 → 本机方案包：只带这条方案与它引用的依赖。
 * 运行：npx vite-node scripts/test-shared-scheme-pack.mjs
 */
import { buildSharedSchemePack } from '../src/utils/sharedSchemePack.ts'

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

const payload = {
  id: '/测试/方案A',
  name: '方案A',
  folder: '/测试',
  savedAt: 1,
  teamSlots: [],
  panelState: {},
}
const deps = {
  customSkills: [{ id: 'custom-a', name: '自建招式' }],
  skillGroups: [{ id: 'grp-a', name: '组' }],
}

const pack = buildSharedSchemePack({
  id: 'schv1-abc',
  name: '方案A',
  folder: '/测试',
  payload,
  dependencies: deps,
})

check('type 为 zzz-hp-schemes', pack.type === 'zzz-hp-schemes')
check('version 为当前方案库版本', pack.version === 4, String(pack.version))
check('只含一条方案', Object.keys(pack.schemes).length === 1)
check('方案 key 沿用 payload.id', Object.keys(pack.schemes)[0] === '/测试/方案A')
check(
  '名称/目录正确',
  pack.schemes['/测试/方案A'].name === '方案A' && pack.schemes['/测试/方案A'].folder === '/测试',
)
check('依赖原样带入', pack.customSkills?.length === 1 && pack.skillGroups?.length === 1)
check(
  '不把整库其它内容带进来',
  Object.keys(pack).sort().join(',') ===
    'customSkills,dirs,exportedAt,schemes,skillGroups,type,version',
)

const rootPack = buildSharedSchemePack({
  id: 'x',
  name: '根方案',
  folder: '',
  payload: { ...payload, id: '', name: '根方案', folder: '' },
})
check('根目录 key 为 /名称', Object.keys(rootPack.schemes)[0] === '/根方案')

let threw = false
try {
  buildSharedSchemePack({ id: 'x', name: '空', folder: '', payload: undefined })
} catch {
  threw = true
}
check('缺少 payload 时拒绝', threw)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
