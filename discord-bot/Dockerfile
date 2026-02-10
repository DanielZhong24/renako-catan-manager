FROM node:22-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm install

# Copy the rest of the code
COPY . .

RUN npm run build \
    && npm prune --omit=dev

ENV NODE_ENV=production

EXPOSE 3001

CMD ["npm", "start"]
# CMD ["npm", "run","dev"]