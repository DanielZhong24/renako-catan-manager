FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build \
    && npm prune --omit=dev

ENV NODE_ENV=production

EXPOSE 3000

CMD [ "npm", "start" ]

# CMD [ "npm", "run","dev" ]