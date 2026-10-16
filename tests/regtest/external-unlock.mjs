import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { here, prepareChain } from './harness.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-external-eth-unlock-'))
fs.chmodSync(root, 0o700)
const bare = process.argv.includes('--bare')
const runtime = bare ? process.env.BARE_BIN : process.execPath
assert.ok(runtime, 'BARE_BIN is required for Bare')
const requests = []
const results = []
const server = http.createServer(async (request, response) => {
  let body = ''
  for await (const part of request) body += part
  const value = JSON.parse(body)
  requests.push(value.method)
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    id: value.id,
    ...(request.url === '/reject' ? { error: { code: -32000, message: 'fixture-rejected' } } : { result: 'wdk-bfa-qualification/1.0' })
  }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${server.address().port}`
try {
  await prepareChain()
  for (const mode of ['native', 'attached']) {
    for (const scenario of ['omitted', 'null', 'valid', 'invalid', 'retry', 'mismatch']) {
      requests.length = 0
      const directory = path.join(root, `${mode}-${scenario}`)
      fs.mkdirSync(directory, { mode: 0o700 })
      const log = fs.openSync(path.join(directory, 'runtime.log'), 'w', 0o600)
      const child = spawn(runtime, [path.join(here, 'external-unlock-worker.mjs'), directory, mode, scenario, endpoint], { stdio: ['ignore', log, log], detached: true })
      fs.closeSync(log)
      const timeout = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 120000)
      try {
        await new Promise((resolve, reject) => {
          child.on('error', reject)
          child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${mode}/${scenario}: ${code}/${signal}; ${directory}/runtime.log`)))
        })
      } finally { clearTimeout(timeout) }
      const expected = scenario === 'valid' ? 1 : scenario === 'retry' ? 2 : 0
      assert.deepEqual(requests, Array(expected).fill('web3_clientVersion'))
      results.push(JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8')))
      console.log(`PASS ${mode}/${scenario}`)
    }
  }
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ runtime: bare ? 'bare' : 'node', results }, null, 2))
  console.log(`Retained evidence: ${root}`)
}
