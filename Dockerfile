# =============================================================================
# Stage 1: compila el renderer nativo (Raylib + Emscripten + ffmpeg.wasm)
# Reutiliza native/Makefile tal cual (bootstrap propio de raylib/emsdk/ffmpeg)
# =============================================================================
FROM emscripten/emsdk:3.1.51 AS wasm-builder

WORKDIR /build/native
COPY native/ .

# El Makefile de native/ instala su propio emsdk si no encuentra emcc en
# EMSDK_DIR=emsdk; como esta imagen ya trae el SDK activado, lo enlazamos
# para que el check de instalación pase y no reinstale nada.
RUN ln -s "${EMSDK}" emsdk

# `copy` arrastra todo el grafo de dependencias (copy -> all -> check ->
# raylib, ffmpeg). Ojo: el Makefile tiene .DEFAULT_GOAL := help, por eso
# nunca se invoca `make` a secas, siempre un target explícito.
RUN make copy DEST=/build/public/wasm

# index.data es el paquete generado por --preload-file assets (contiene
# assets/shaders/crt.fs). Es el único de los archivos copiados que un efecto
# (CRT) necesita en runtime pero que ASCII/Partículas nunca tocan — así que
# si falta, el build sigue "funcionando" a medias sin que nada lo delate
# hasta que alguien abre el efecto CRT y ve un error de shader que en
# realidad es un 404 disfrazado. Falla aquí, no en el navegador.
RUN test -s /build/public/wasm/index.data || \
    (echo "ERROR: index.data missing after 'make copy' — check native/Makefile's" \
          "LDFLAGS still has --preload-file assets, and that the assets/ dir" \
          "was actually present when emcc ran." >&2 && exit 1)
RUN test -s /build/public/wasm/index.wasm || (echo "ERROR: index.wasm missing" >&2 && exit 1)
RUN test -s /build/public/wasm/index.js   || (echo "ERROR: index.js missing" >&2 && exit 1)

RUN mkdir -p /build/public/ffmpeg && \
    cp ffmpeg/ffmpeg-core.js ffmpeg/ffmpeg-core.wasm /build/public/ffmpeg/

# =============================================================================
# Stage 2: build de React/Vite (tsc -b && vite build)
# =============================================================================
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
COPY --from=wasm-builder /build/public/wasm ./public/wasm
COPY --from=wasm-builder /build/public/ffmpeg ./public/ffmpeg

RUN npm run build

# Vite copia public/* al output tal cual — confirma aquí, antes de perder el
# contexto de build, que index.data efectivamente llegó a dist/wasm/. Es el
# mismo chequeo que en el stage anterior, pero después de que vite build
# procese la carpeta — por si algún día alguien le agrega un .gitignore o un
# publicDir distinto que se lo coma en el camino.
RUN test -s /app/dist/wasm/index.data || \
    (echo "ERROR: index.data didn't make it into dist/wasm — check vite.config.ts's publicDir" >&2 && exit 1)

# =============================================================================
# Stage 3: sirve el build estático (este contenedor no expone puertos al
# host; el servicio nginx del docker-compose hace TLS + proxy hacia :80)
# =============================================================================
FROM nginx:1.27-alpine

RUN cat <<'EOF' > /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/javascript application/wasm application/json;

    location ~* \.wasm$ {
        default_type application/wasm;
        add_header Cross-Origin-Resource-Policy cross-origin;
    }

    # /wasm/ and /ffmpeg/ are the Emscripten build output (index.js/.wasm/.data)
    # and the ffmpeg.wasm core files. These are never client-side routes, so
    # a missing file must return a real 404 — NOT the SPA's index.html.
    # Without this, try_files in the catch-all `location /` below silently
    # serves index.html (200 OK) for any missing asset here, and Emscripten's
    # runtime happily tries to parse that HTML as its data/wasm payload,
    # producing confusing runtime errors (e.g. a shader "failing to compile"
    # because it's actually compiling '<!doctype html>...').
    location /wasm/ {
        try_files $uri =404;
    }

    location /ffmpeg/ {
        add_header Cross-Origin-Resource-Policy cross-origin;
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
