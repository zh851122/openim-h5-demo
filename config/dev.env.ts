// Dev uses Vite proxy to avoid CORS when accessing from LAN IP (e.g. http://192.168.x.x:3003).
// See `openim-h5-demo/vite.config.ts` for proxy targets.
const CHAT_URL = '/chat'
const API_URL = '/api'
const WS_URL = '/msg_gateway'
const WASM_URL = '/openIM.wasm'
const SQL_WASM_URL = '/sql-wasm.wasm'

export default {
  NODE_ENV: 'development',
  CHAT_URL,
  API_URL,
  WS_URL,
  WASM_URL,
  SQL_WASM_URL,
  LOG_LEVEL: 5,
  VERSION: 'H5-Demo',
}
