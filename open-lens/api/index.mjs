import express from 'express'
import cors from 'cors'
// ⚠️ Update the path since we moved this file into /api/
import { analyzeController } from '../src/controllers/analyze.mjs' 

const app = express()

// Allow all origins for now to fix CORS issues
app.use(cors({ origin: "*" })) 
app.use(express.json())

// --- ROUTES ---
app.post('/api/analyze', analyzeController)

// --- VERCEL HANDLER ---
// Vercel requires us to export the app, not just listen
export default app

// --- LOCAL DEV ---
// Only listen on port 3000 if we are running locally (not on Vercel)
if (process.env.NODE_ENV !== 'production') {
  const PORT = 3000
  app.listen(PORT, () => console.log(`🧠 Platform Brain running on http://localhost:${PORT}`))
}