# WASM Acceleration Guide

This project ships `openIM.wasm` (~35 MB). The first load can be very slow if the server does not serve compressed wasm.

## What is already enabled in this repo

- `npm run build` now generates:
  - `dist/openIM.wasm.gz`
  - `dist/openIM.wasm.br`
  - `dist/sql-wasm.wasm.gz`
  - `dist/sql-wasm.wasm.br`
- `index.html` preloads wasm files to start download earlier.
- WASM paths are configurable:
  - `process.env.WASM_URL`
  - `process.env.SQL_WASM_URL`

## Nginx example (static precompressed wasm)

Put this in your nginx `server` block (and keep `root` pointing to your `dist` directory):

```nginx
# Optional: remove this line if nginx does not include brotli module.
brotli_static on;
gzip_static on;

types {
    application/wasm wasm;
}

location ~* \.wasm$ {
    default_type application/wasm;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header Vary "Accept-Encoding" always;
    try_files $uri =404;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

## Fallback if `gzip_static`/`brotli_static` are unavailable

Use dynamic compression (less efficient than static files, but still much better than no compression):

```nginx
gzip on;
gzip_comp_level 6;
gzip_min_length 1024;
gzip_types application/wasm application/javascript text/css application/json text/plain;
```

## CDN recommendation

Point `WASM_URL` and `SQL_WASM_URL` to your CDN domain in `config/prod.env.ts`, for example:

```ts
const WASM_URL = 'https://cdn.example.com/openIM.wasm'
const SQL_WASM_URL = 'https://cdn.example.com/sql-wasm.wasm'
```
