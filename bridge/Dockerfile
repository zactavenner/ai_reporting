FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
ENV AUTH_DIR=/data/auth
RUN mkdir -p /data/auth
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server.js"]