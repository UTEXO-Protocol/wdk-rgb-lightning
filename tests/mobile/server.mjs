import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-mobile-results-'))
fs.chmodSync(root, 0o700)
const commands = []
const events = []
const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/next') {
      const command = commands.shift()
      response.writeHead(command ? 200 : 204, { 'Content-Type': 'application/json' })
      return response.end(command ? JSON.stringify(command) : '')
    }
    if (request.method === 'GET' && request.url === '/results') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      return response.end(JSON.stringify(events))
    }
    if (request.method !== 'POST' || !['/command', '/event', '/result'].includes(request.url)) { response.writeHead(404); return response.end() }
    let body = ''
    for await (const chunk of request) { body += chunk; if (body.length > 1048576) throw new Error('body too large') }
    const value = JSON.parse(body)
    if (request.url === '/command') commands.push(value)
    else { events.push({ time: new Date().toISOString(), route: request.url, ...value }); fs.writeFileSync(path.join(root, 'events.json'), JSON.stringify(events, null, 2), { mode: 0o600 }); console.log(JSON.stringify(value)) }
    response.writeHead(200); response.end('{}')
  } catch (error) { response.writeHead(400); response.end(error.message) }
})
server.listen(29888, '127.0.0.1', () => console.log(`Mobile evidence: ${root}`))
