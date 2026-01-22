FROM node:22-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm install

# Copy the rest of the code
COPY . .

# We use tsx to run it directly in the container
CMD ["npm", "run", "dev"]