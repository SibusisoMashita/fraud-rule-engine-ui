FROM node:24.22.0-alpine3.23@sha256:e44c87c7dd212720eb00469aeac89504ca2be77b8f0d6dbffb30665d5fcc59e1 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.30.6-alpine-slim@sha256:3028fc1419f99b95c1c69f844bbaf49dc1b881750c51b497fc721ac4f02a14e6
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf.template /etc/nginx/nginx.conf.template
COPY docker/api-proxy.conf /etc/nginx/api-proxy.conf
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/ui-entrypoint
USER nginx
ENV API_UPSTREAM=app:8080
EXPOSE 8080
STOPSIGNAL SIGQUIT
HEALTHCHECK --interval=5s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -q -T 3 -O /dev/null http://127.0.0.1:8080/health/live || exit 1
ENTRYPOINT ["/usr/local/bin/ui-entrypoint"]
