import assert from 'node:assert/strict'
import test from 'node:test'
import { WalletProcess } from './harness.mjs'

const fixture = () => Object.assign(Object.create(WalletProcess.prototype), { child: { pid: 4242 }, groupKilled: false })

test('process-group cleanup is idempotent after an explicit crash kill', t => {
  const kill = t.mock.method(process, 'kill', () => true)
  const wallet = fixture()
  wallet.killGroup()
  wallet.killGroup()
  assert.equal(kill.mock.callCount(), 1)
  assert.deepEqual(kill.mock.calls[0].arguments, [-4242, 'SIGKILL'])
})

test('already absent group is complete; permission failures remain visible and retryable', t => {
  const wallet = fixture()
  const kill = t.mock.method(process, 'kill', () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
  assert.throws(() => wallet.killGroup(), { code: 'EPERM' })
  assert.equal(wallet.groupKilled, false)
  kill.mock.mockImplementation(() => { throw Object.assign(new Error('absent'), { code: 'ESRCH' }) })
  wallet.killGroup()
  wallet.killGroup()
  assert.equal(wallet.groupKilled, true)
  assert.equal(kill.mock.callCount(), 2)
})

test('failed process creation cannot accidentally signal a process group', t => {
  const kill = t.mock.method(process, 'kill', () => { throw new Error('must not signal') })
  const wallet = fixture()
  wallet.child.pid = undefined
  wallet.killGroup()
  assert.equal(kill.mock.callCount(), 0)
})
