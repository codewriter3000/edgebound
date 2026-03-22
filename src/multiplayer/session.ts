const ROOM_CODE_KEY = 'edgebound.roomCode'
const RECONNECT_TOKEN_KEY = 'edgebound.reconnectToken'
const PLAYER_NAME_KEY = 'edgebound.playerName'

export function saveSession(roomCode: string, reconnectToken: string, playerName: string): void {
  localStorage.setItem(ROOM_CODE_KEY, roomCode)
  localStorage.setItem(RECONNECT_TOKEN_KEY, reconnectToken)
  localStorage.setItem(PLAYER_NAME_KEY, playerName)
}

export function loadSession(): {
  roomCode: string | null
  reconnectToken: string | null
  playerName: string | null
} {
  return {
    roomCode: localStorage.getItem(ROOM_CODE_KEY),
    reconnectToken: localStorage.getItem(RECONNECT_TOKEN_KEY),
    playerName: localStorage.getItem(PLAYER_NAME_KEY),
  }
}

export function clearSession(): void {
  localStorage.removeItem(ROOM_CODE_KEY)
  localStorage.removeItem(RECONNECT_TOKEN_KEY)
}
