import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import {cors} from 'hono/cors';
const app = new Hono()

// Middleware to see requests in the terminal
app.use('*', logger())

app.use('/api/*', cors({
  origin:"*",
  allowMethods:["POST","GET","OPTIONS"],
  allowHeaders:["Content-Type","Authorization"]

}));

// Define the schema for a Catan Game
const gameSchema = z.object({
  lobbyId: z.string(),
  winnerName: z.string(),
  players: z.array(z.object({
    name: z.string(),
    vp: z.number()
  }))
})

app.get('/', (c) => c.text('Catan Tracker API is Online!'))

// This is where your Chrome Extension will send data
app.post('/api/ingest', zValidator('json', gameSchema), (c) => {
  const data = c.req.valid('json')
  
  console.log("🚀 Data received from Scraper:", data)
  
  // Later: This is where we will trigger the Discord Bot
  return c.json({ 
    message: 'Game logged in pending state',
    lobby: data.lobbyId 
  })
})

const port = 3000
console.log(`Server is running on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port
})