FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY tsconfig.json ./
RUN npx tsc
EXPOSE 3002
CMD ["node", "--loader", "ts-node/esm", "src/server.ts"]
