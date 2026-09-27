import React, { useEffect, useState } from 'react'
import { AppState, Platform, Text, View } from 'react-native'
import { registerRootComponent } from 'expo'
import { Paths } from 'expo-file-system'
import { Worklet } from 'react-native-bare-kit'
import bundle from './wallet.bundle.js'

const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1'
const endpoint = `http://${host}:29888`
const post = (route, body) => fetch(endpoint + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function App () {
  const [status, setStatus] = useState('Starting qualification')
  useEffect(() => {
    const worklet = new Worklet()
    let partial = ''
    let closed = false
    worklet.IPC.on('error', error => post('/event', { type: 'ipc-error', message: error.message }))
    worklet.IPC.on('data', data => {
      partial += String.fromCharCode(...data)
      let newline
      while ((newline = partial.indexOf('\n')) !== -1) {
        const message = JSON.parse(partial.slice(0, newline))
        partial = partial.slice(newline + 1)
        setStatus(message.error || message.method || 'Worklet ready')
        post('/result', message)
      }
    })
    worklet.start('/wallet.bundle', bundle, [Paths.document.uri.replace(/^file:\/\//, ''), host])
    const subscription = AppState.addEventListener('change', state => post('/event', { type: 'app-state', state }))
    post('/event', { type: 'launch', platform: Platform.OS, reactNative: Platform.constants.reactNativeVersion })
    const timer = setInterval(async () => {
      if (closed) return
      try {
        const response = await fetch(endpoint + '/next')
        if (response.status === 204) return
        const command = await response.json()
        if (command.method === 'terminateWorklet') {
          worklet.terminate()
          await post('/result', { id: command.id, ok: true, method: command.method })
        } else {
          worklet.IPC.write(new TextEncoder().encode(JSON.stringify(command) + '\n'))
        }
      } catch (error) { setStatus(error.message) }
    }, 500)
    return () => { closed = true; clearInterval(timer); subscription.remove(); worklet.terminate() }
  }, [])
  return React.createElement(View, { style: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' } },
    React.createElement(Text, { style: { fontSize: 20, color: '#111' } }, 'WDK Runtime Qualification'),
    React.createElement(Text, { style: { marginTop: 16, color: '#333' } }, status))
}
registerRootComponent(App)
