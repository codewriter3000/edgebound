import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { startMultiplayerServer, type MultiplayerServerInstance } from '../index'
import type { ServerMessage } from '../../multiplayer/protocol'

const TEST_TIMEOUT_MS = 4000

function nextPort(): number {
  return 20000 + Math.floor(Math.random() * 10000)
}

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url)

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out opening websocket'))
    }, TEST_TIMEOUT_MS)

    socket.once('open', () => {
      clearTimeout(timeout)
      resolve()
    })

    socket.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })

  return socket
}

function sendJson(socket: WebSocket, payload: unknown): void {
  socket.send(JSON.stringify(payload))
}

async function waitForMessage(
  socket: WebSocket,
  predicate: (message: ServerMessage) => boolean,
  timeoutMs = TEST_TIMEOUT_MS,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error('Timed out waiting for message'))
    }, timeoutMs)

    const onMessage = (buffer: WebSocket.RawData) => {
      const parsed = JSON.parse(String(buffer)) as ServerMessage
      if (predicate(parsed)) {
        clearTimeout(timeout)
        socket.off('message', onMessage)
        resolve(parsed)
      }
    }

    socket.on('message', onMessage)
  })
}

async function waitForClose(socket: WebSocket, timeoutMs = TEST_TIMEOUT_MS): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for socket close'))
    }, timeoutMs)

    socket.once('close', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
    return
  }

  await new Promise<void>((resolve) => {
    socket.once('close', () => resolve())
    socket.close()
  })
}

describe('multiplayer server integration', () => {
  let server: MultiplayerServerInstance | null = null
  const sockets: WebSocket[] = []

  afterEach(async () => {
    while (sockets.length > 0) {
      const socket = sockets.pop()
      if (socket != null) {
        await closeSocket(socket)
      }
    }

    if (server != null) {
      await server.close()
      server = null
    }
  })

  it('syncs state across two joined players', async () => {
    const port = nextPort()
    server = startMultiplayerServer(port)

    const p1 = await openSocket(`ws://127.0.0.1:${port}`)
    sockets.push(p1)

    sendJson(p1, { type: 'room:create', displayName: 'Alpha' })
    const created = await waitForMessage(p1, (msg) => msg.type === 'room:created')
    if (created.type !== 'room:created') {
      throw new Error('Expected room:created message')
    }

    expect(created.spectatorsEnabled).toBe(true)
    expect(created.abandoned).toBe(false)

    const p2 = await openSocket(`ws://127.0.0.1:${port}`)
    sockets.push(p2)

    sendJson(p2, {
      type: 'room:join',
      roomCode: created.roomCode,
      displayName: 'Beta',
    })

    const joined = await waitForMessage(p2, (msg) => msg.type === 'room:joined')
    expect(joined.type).toBe('room:joined')
    if (joined.type !== 'room:joined') {
      throw new Error('Expected room:joined message')
    }

    expect(joined.playerSlot).toBe('P2')

    sendJson(p2, {
      type: 'game:action',
      roomCode: created.roomCode,
      action: {
        type: 'PLACE_PIECE',
        pieceType: 'triangle',
        spotId: '3-9',
      },
      actionId: 'a-1',
      clientVersion: 0,
    })

    const [stateFromP1, stateFromP2] = await Promise.all([
      waitForMessage(p1, (msg) => msg.type === 'game:state' && msg.lastActionId === 'a-1'),
      waitForMessage(p2, (msg) => msg.type === 'game:state' && msg.lastActionId === 'a-1'),
    ])

    if (stateFromP1.type !== 'game:state' || stateFromP2.type !== 'game:state') {
      throw new Error('Expected game:state messages')
    }

    expect(stateFromP1.version).toBe(1)
    expect(stateFromP2.version).toBe(1)
    expect(stateFromP1.state).toEqual(stateFromP2.state)
    expect(stateFromP1.state.pieces).toHaveLength(1)
  })

  it('rejects out-of-turn action and handles duplicate action idempotently', async () => {
    const port = nextPort()
    server = startMultiplayerServer(port)

    const p1 = await openSocket(`ws://127.0.0.1:${port}`)
    sockets.push(p1)

    sendJson(p1, { type: 'room:create', displayName: 'Alpha' })
    const created = await waitForMessage(p1, (msg) => msg.type === 'room:created')
    if (created.type !== 'room:created') {
      throw new Error('Expected room:created message')
    }

    const p2 = await openSocket(`ws://127.0.0.1:${port}`)
    sockets.push(p2)

    sendJson(p2, {
      type: 'room:join',
      roomCode: created.roomCode,
      displayName: 'Beta',
    })
    await waitForMessage(p2, (msg) => msg.type === 'room:joined')

    sendJson(p1, {
      type: 'game:action',
      roomCode: created.roomCode,
      action: {
        type: 'PLACE_PIECE',
        pieceType: 'triangle',
        spotId: '3-11',
      },
      actionId: 'bad-turn',
      clientVersion: 0,
    })

    const rejected = await waitForMessage(
      p1,
      (msg) => msg.type === 'game:error' && msg.code === 'ACTION_REJECTED',
    )
    expect(rejected.type).toBe('game:error')

    sendJson(p2, {
      type: 'game:action',
      roomCode: created.roomCode,
      action: {
        type: 'PLACE_PIECE',
        pieceType: 'triangle',
        spotId: '3-9',
      },
      actionId: 'dup-1',
      clientVersion: 0,
    })

    const firstState = await waitForMessage(
      p2,
      (msg) => msg.type === 'game:state' && msg.lastActionId === 'dup-1',
    )

    sendJson(p2, {
      type: 'game:action',
      roomCode: created.roomCode,
      action: {
        type: 'PLACE_PIECE',
        pieceType: 'triangle',
        spotId: '3-9',
      },
      actionId: 'dup-1',
      clientVersion: 1,
    })

    const duplicateState = await waitForMessage(
      p2,
      (msg) => msg.type === 'game:state' && msg.lastActionId === 'dup-1',
    )

    if (firstState.type !== 'game:state' || duplicateState.type !== 'game:state') {
      throw new Error('Expected game:state messages')
    }

    expect(duplicateState.version).toBe(firstState.version)
    expect(duplicateState.state).toEqual(firstState.state)
  })

  it('restores player slot and state on reconnect token join', async () => {
    const port = nextPort()
    server = startMultiplayerServer(port)

    const p1 = await openSocket(`ws://127.0.0.1:${port}`)
    sockets.push(p1)

    sendJson(p1, { type: 'room:create', displayName: 'Alpha' })
    const created = await waitForMessage(p1, (msg) => msg.type === 'room:created')
    if (created.type !== 'room:created') {
      throw new Error('Expected room:created message')
    }

    const p2 = await openSocket(`ws://127.0.0.1:${port}`)
    sockets.push(p2)

    sendJson(p2, {
      type: 'room:join',
      roomCode: created.roomCode,
      displayName: 'Beta',
    })
    await waitForMessage(p2, (msg) => msg.type === 'room:joined')

    sendJson(p2, {
      type: 'game:action',
      roomCode: created.roomCode,
      action: {
        type: 'PLACE_PIECE',
        pieceType: 'triangle',
        spotId: '3-9',
      },
      actionId: 'before-reconnect',
      clientVersion: 0,
    })

    await waitForMessage(
      p1,
      (msg) => msg.type === 'game:state' && msg.lastActionId === 'before-reconnect',
    )

    await closeSocket(p1)

    const rejoin = await openSocket(`ws://127.0.0.1:${port}`)
    sockets.push(rejoin)

    sendJson(rejoin, {
      type: 'room:join',
      roomCode: created.roomCode,
      displayName: 'Alpha',
      reconnectToken: created.reconnectToken,
    })

    const joined = await waitForMessage(rejoin, (msg) => msg.type === 'room:joined')
    if (joined.type !== 'room:joined') {
      throw new Error('Expected room:joined message')
    }

    expect(joined.playerSlot).toBe('P1')
    expect(joined.version).toBe(1)
    expect(joined.state.pieces).toHaveLength(1)
  })

  it('supports spectator details in presence and kicks spectators when disabled', async () => {
    const port = nextPort()
    server = startMultiplayerServer(port)

    const p1 = await openSocket(`ws://127.0.0.1:${port}`)
    const p2 = await openSocket(`ws://127.0.0.1:${port}`)
    const spectator = await openSocket(`ws://127.0.0.1:${port}`)
    sockets.push(p1, p2, spectator)

    sendJson(p1, { type: 'room:create', displayName: 'A' })
    const created = await waitForMessage(p1, (msg) => msg.type === 'room:created')
    if (created.type !== 'room:created') {
      throw new Error('Expected room:created message')
    }

    sendJson(p2, {
      type: 'room:join',
      roomCode: created.roomCode,
      displayName: 'B',
    })
    await waitForMessage(p2, (msg) => msg.type === 'room:joined')

    const presenceWithSpectatorPromise = waitForMessage(
      p1,
      (msg) => msg.type === 'presence:update' && msg.spectators.length === 1,
    )

    sendJson(spectator, {
      type: 'room:join',
      roomCode: created.roomCode,
      displayName: 'Watcher',
    })

    const spectatorJoined = await waitForMessage(spectator, (msg) => msg.type === 'room:joined')
    if (spectatorJoined.type !== 'room:joined') {
      throw new Error('Expected room:joined message')
    }

    expect(spectatorJoined.playerSlot).toBe('spectator')
    expect(spectatorJoined.reconnectToken).toBeUndefined()

    const presenceWithSpectator = await presenceWithSpectatorPromise
    if (presenceWithSpectator.type !== 'presence:update') {
      throw new Error('Expected presence:update message')
    }

    expect(presenceWithSpectator.spectators[0]?.displayName).toBe('Watcher')
    expect(presenceWithSpectator.spectatorsEnabled).toBe(true)

    const disabledPresencePromise = waitForMessage(
      p1,
      (msg) => msg.type === 'presence:update' && msg.spectatorsEnabled === false,
    )

    sendJson(p2, {
      type: 'room:set-spectators',
      roomCode: created.roomCode,
      enabled: false,
    })

    await waitForClose(spectator)

    const disabledPresence = await disabledPresencePromise
    if (disabledPresence.type !== 'presence:update') {
      throw new Error('Expected presence:update message')
    }

    expect(disabledPresence.spectators).toHaveLength(0)

    const deniedSpectator = await openSocket(`ws://127.0.0.1:${port}`)
    sockets.push(deniedSpectator)
    sendJson(deniedSpectator, {
      type: 'room:join',
      roomCode: created.roomCode,
      displayName: 'Denied',
    })

    const deniedMessage = await waitForMessage(
      deniedSpectator,
      (msg) => msg.type === 'game:error' && msg.code === 'SPECTATORS_DISABLED',
    )
    expect(deniedMessage.type).toBe('game:error')
  })

  it('locks room as abandoned after reconnect timeout and rejects new joins', async () => {
    const port = nextPort()
    server = startMultiplayerServer(port, {
      playerReconnectTimeoutMs: 60,
      emptyRoomTtlMs: 1000,
    })

    const p1 = await openSocket(`ws://127.0.0.1:${port}`)
    const p2 = await openSocket(`ws://127.0.0.1:${port}`)
    sockets.push(p1, p2)

    sendJson(p1, { type: 'room:create', displayName: 'A' })
    const created = await waitForMessage(p1, (msg) => msg.type === 'room:created')
    if (created.type !== 'room:created') {
      throw new Error('Expected room:created message')
    }

    sendJson(p2, {
      type: 'room:join',
      roomCode: created.roomCode,
      displayName: 'B',
    })
    await waitForMessage(p2, (msg) => msg.type === 'room:joined')

    const p1ClosedPromise = waitForClose(p1, 3000)
    await closeSocket(p2)
    await p1ClosedPromise

    const newJoin = await openSocket(`ws://127.0.0.1:${port}`)
    sockets.push(newJoin)

    sendJson(newJoin, {
      type: 'room:join',
      roomCode: created.roomCode,
      displayName: 'C',
    })

    const joinRejected = await waitForMessage(
      newJoin,
      (msg) => msg.type === 'game:error' && msg.code === 'ROOM_ABANDONED',
    )
    expect(joinRejected.type).toBe('game:error')
  })
})
