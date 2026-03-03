import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'

const distDir = resolve(process.cwd(), process.argv[2] ?? 'dist')
const targetFiles = ['openIM.wasm', 'sql-wasm.wasm']
const brotliQuality = Number.parseInt(process.env.WASM_BR_QUALITY || '6', 10)
const gzipLevel = Number.parseInt(process.env.WASM_GZIP_LEVEL || '9', 10)

const formatSize = (size) => `${(size / 1024 / 1024).toFixed(2)} MB`
const formatRate = (next, original) => `${((1 - next / original) * 100).toFixed(2)}%`

let foundAnyFile = false

for (const fileName of targetFiles) {
  const inputPath = resolve(distDir, fileName)

  if (!existsSync(inputPath)) {
    console.warn(`[compress-wasm] skip missing file: ${inputPath}`)
    continue
  }

  foundAnyFile = true
  const source = readFileSync(inputPath)

  const gzipBuffer = gzipSync(source, {
    level: Math.min(Math.max(gzipLevel, 1), 9),
  })
  const brBuffer = brotliCompressSync(source, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: Math.min(Math.max(brotliQuality, 0), 11),
    },
  })

  writeFileSync(`${inputPath}.gz`, gzipBuffer)
  writeFileSync(`${inputPath}.br`, brBuffer)

  console.log(
    [
      `[compress-wasm] ${fileName}`,
      `raw=${formatSize(source.length)}`,
      `gzip=${formatSize(gzipBuffer.length)}(${formatRate(gzipBuffer.length, source.length)})`,
      `br=${formatSize(brBuffer.length)}(${formatRate(brBuffer.length, source.length)})`,
    ].join(' '),
  )
}

if (!foundAnyFile) {
  process.exitCode = 1
  console.error(`[compress-wasm] no wasm files found in ${distDir}`)
}
