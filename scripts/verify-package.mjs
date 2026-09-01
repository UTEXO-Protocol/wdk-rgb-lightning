import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(
  await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(rootDir, 'package.json'), 'utf8')
  )
)

function argumentValue (name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`)
  return process.argv[index + 1]
}

function walkFiles (directory, prefix) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name)
    const relativePath = path.posix.join(prefix, entry.name)
    return entry.isDirectory()
      ? walkFiles(absolutePath, relativePath)
      : [relativePath]
  })
}

function writeOutputs (report) {
  if (!process.env.GITHUB_OUTPUT) return

  const outputs = {
    tarball: report.tarball,
    filename: report.filename,
    integrity: report.integrity,
    shasum: report.shasum,
    size: report.size,
    unpacked_size: report.unpackedSize,
    file_count: report.fileCount
  }

  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n'
  )
}

const requestedOutputDir = argumentValue('--output-dir')
const temporaryOutputDir = !requestedOutputDir
const outputDir = requestedOutputDir
  ? path.resolve(requestedOutputDir)
  : mkdtempSync(path.join(tmpdir(), 'wdk-rgb-lightning-pack-'))

mkdirSync(outputDir, { recursive: true })

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const pack = spawnSync(
  npmExecutable,
  ['pack', '--json', '--pack-destination', outputDir],
  {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }
)

if (pack.status !== 0) {
  throw new Error(`npm pack failed:\n${pack.stderr || pack.stdout}`)
}

let packResult
try {
  packResult = JSON.parse(pack.stdout)
} catch (error) {
  throw new Error(`npm pack returned invalid JSON:\n${pack.stdout}`, {
    cause: error
  })
}

const packedPackages = Array.isArray(packResult)
  ? packResult
  : Object.values(packResult)

if (packedPackages.length !== 1) {
  throw new Error('npm pack must return exactly one package')
}

const packed = packedPackages[0]
const packedFiles = new Set(packed.files.map(file => file.path))
const requiredRootFiles = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'bare.js',
  'index-bare.js',
  'index-node.js',
  'index.d.ts',
  'index.js',
  'package.json'
]
const requiredRuntimeFiles = [
  ...walkFiles(path.join(rootDir, 'assets'), 'assets'),
  ...walkFiles(path.join(rootDir, 'src'), 'src')
]
const requiredFiles = [...requiredRootFiles, ...requiredRuntimeFiles]

for (const requiredFile of requiredFiles) {
  if (!packedFiles.has(requiredFile)) {
    throw new Error(`Package is missing required file: ${requiredFile}`)
  }
}

const allowedRootFiles = new Set(requiredRootFiles)
const unexpectedFiles = [...packedFiles].filter(file => {
  if (allowedRootFiles.has(file)) return false
  return !file.startsWith('assets/') && !file.startsWith('src/')
})

if (unexpectedFiles.length > 0) {
  throw new Error(
    `Package contains unexpected files:\n${unexpectedFiles.sort().join('\n')}`
  )
}

if (packed.name !== packageJson.name || packed.version !== packageJson.version) {
  throw new Error(
    `Packed identity ${packed.name}@${packed.version} does not match ` +
    `${packageJson.name}@${packageJson.version}`
  )
}

const tarball = path.resolve(outputDir, packed.filename)
if (!existsSync(tarball)) {
  throw new Error(`npm pack did not create ${tarball}`)
}

const report = {
  name: packed.name,
  version: packed.version,
  filename: packed.filename,
  tarball,
  integrity: packed.integrity,
  shasum: packed.shasum,
  size: packed.size,
  unpackedSize: packed.unpackedSize,
  fileCount: packed.entryCount
}

writeOutputs(report)
console.log(JSON.stringify(report, null, 2))

if (temporaryOutputDir) {
  rmSync(outputDir, { force: true, recursive: true })
}
