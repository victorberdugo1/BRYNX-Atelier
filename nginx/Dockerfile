FROM nginx:1.27-alpine

RUN apk add --no-cache openssl && \
    mkdir -p /etc/nginx/ssl && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/vfx-lab.key \
        -out /etc/nginx/ssl/vfx-lab.crt \
        -subj "/O=vfx-lab/CN=localhost"

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443
