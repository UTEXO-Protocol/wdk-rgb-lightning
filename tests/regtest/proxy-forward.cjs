'use strict'
const net = require('node:net')

// Give host wallets and the isolated RLN peer the same advertised proxy URI.
// This listener exists only inside RLN's network namespace, on loopback.
net.createServer(client => {
  const upstream = net.connect(3000, 'proxy')
  client.on('error', () => upstream.destroy())
  upstream.on('error', () => client.destroy())
  client.on('close', () => upstream.destroy())
  upstream.on('close', () => client.destroy())
  client.pipe(upstream).pipe(client)
}).listen(29300, '127.0.0.1')
