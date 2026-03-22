const ROOM_CODE_KEY = 'edgebound.roomCode';
const RECONNECT_TOKEN_KEY = 'edgebound.reconnectToken';
const PLAYER_NAME_KEY = 'edgebound.playerName';
export function saveSession(roomCode, reconnectToken, playerName) {
    localStorage.setItem(ROOM_CODE_KEY, roomCode);
    localStorage.setItem(RECONNECT_TOKEN_KEY, reconnectToken);
    localStorage.setItem(PLAYER_NAME_KEY, playerName);
}
export function loadSession() {
    return {
        roomCode: localStorage.getItem(ROOM_CODE_KEY),
        reconnectToken: localStorage.getItem(RECONNECT_TOKEN_KEY),
        playerName: localStorage.getItem(PLAYER_NAME_KEY),
    };
}
export function clearSession() {
    localStorage.removeItem(ROOM_CODE_KEY);
    localStorage.removeItem(RECONNECT_TOKEN_KEY);
}
