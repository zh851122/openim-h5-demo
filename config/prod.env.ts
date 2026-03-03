const BASE_DOMAIN = '47.96.65.146'
const CHAT_URL = `http://${BASE_DOMAIN}/chat`
const API_URL = `http://${BASE_DOMAIN}/api`
const WS_URL = `ws://${BASE_DOMAIN}/msg_gateway`
const WASM_URL = `http://${BASE_DOMAIN}/openIM.wasm.br`
const SQL_WASM_URL = `http://${BASE_DOMAIN}/sql-wasm.wasm.br`

export default {
  NODE_ENV: 'production',
  CHAT_URL,
  API_URL,
  WS_URL,
  WASM_URL,
  SQL_WASM_URL,
  LOG_LEVEL: 5,
  VERSION: 'H5-Demo',
}
