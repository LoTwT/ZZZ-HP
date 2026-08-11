import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

/**
 * 对照 DB 引用与 guestbook_image 磁盘文件。
 * 默认只报告；加 --orphans 列出孤儿；再加 --apply 删除孤儿（需同时带 --orphans）。
 *
 * 用法：
 *   node scripts/check-guestbook-images.mjs
 *   node scripts/check-guestbook-images.mjs --orphans
 *   node scripts/check-guestbook-images.mjs --orphans --apply
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const imageDir = path.join(root, 'guestbook_image')
const wantOrphans = process.argv.includes('--orphans')
const wantApply = process.argv.includes('--apply')

function extractName(value) {
  if (!value) return null
  const m = String(value).match(/\/guestbook_image\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

function collect(set, value) {
  if (!value) return
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      JSON.parse(value).forEach((v) => collect(set, v))
    } catch {
      /* ignore malformed json */
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v) => collect(set, v))
    return
  }
  const name = extractName(value)
  if (name) set.add(name)
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'zzz',
  charset: 'utf8mb4',
})

const referenced = new Set()

const [posts] = await conn.query('SELECT cover, images_json FROM guestbook')
for (const row of posts) {
  collect(referenced, row.cover)
  collect(referenced, row.images_json)
}

const [comments] = await conn.query(
  "SELECT images_json FROM guestbook_comment WHERE images_json IS NOT NULL AND images_json <> ''",
)
for (const row of comments) collect(referenced, row.images_json)

const [users] = await conn.query('SELECT avatar, banner FROM guestbook_user')
for (const row of users) {
  collect(referenced, row.avatar)
  collect(referenced, row.banner)
}

await conn.end()

const onDisk = fs.existsSync(imageDir)
  ? fs.readdirSync(imageDir).filter((name) => {
      const full = path.join(imageDir, name)
      return fs.statSync(full).isFile()
    })
  : []
const onDiskSet = new Set(onDisk)
const missing = [...referenced].filter((name) => !onDiskSet.has(name)).sort()
const present = [...referenced].filter((name) => onDiskSet.has(name))
const orphans = onDisk.filter((name) => !referenced.has(name)).sort()

console.log(`referenced: ${referenced.size}`)
console.log(`present:    ${present.length}`)
console.log(`missing:    ${missing.length}`)
console.log(`orphans:    ${orphans.length}`)

if (missing.length) {
  console.log('missing files (DB refs without disk file):')
  for (const name of missing) console.log(`  - ${name}`)
  process.exitCode = 1
}

if (wantOrphans) {
  if (!orphans.length) {
    console.log('no orphan files')
  } else {
    console.log(
      wantApply
        ? 'deleting orphan files (disk without DB ref):'
        : 'orphan files (disk without DB ref; pass --apply to delete):',
    )
    for (const name of orphans) {
      const full = path.join(imageDir, name)
      if (wantApply) {
        try {
          fs.unlinkSync(full)
          console.log(`  deleted ${name}`)
        } catch (err) {
          console.log(`  FAIL ${name}: ${err?.message || err}`)
          process.exitCode = 1
        }
      } else {
        console.log(`  - ${name}`)
      }
    }
  }
} else if (orphans.length) {
  console.log(`(hint: ${orphans.length} orphan(s) on disk; re-run with --orphans [--apply])`)
}

if (wantApply && !wantOrphans) {
  console.error('refusing --apply without --orphans')
  process.exitCode = 1
}
