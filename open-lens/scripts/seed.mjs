import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // ⚠️ NEED THIS KEY for writing data
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// --- OUR RAW DATA (The "Brain") ---
const DATA = [
  {
    title: "Global Logistics Outlook 2025",
    category: "Operations",
    content: "We advise clients to forward-buy inventory now due to predicted port congestion. Our firm predicts a 40% cost increase in trans-pacific shipping."
  },
  {
    title: "EU AI Act Compliance Guide",
    category: "Legal",
    content: "The new act classifies 'General Purpose AI' as high risk. Start categorizing your AI models immediately. Do not wait for enforcement."
  }
]

async function seed() {
  console.log("🌱 Starting seed...")

  for (const item of DATA) {
    // 1. Generate Vector
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: item.content,
    })
    const vector = embeddingResponse.data[0].embedding

    // 2. Insert into Supabase
    const { error } = await supabase.from('client_knowledge').insert({
      title: item.title,
      category: item.category,
      content: item.content,
      embedding: vector
    })

    if (error) console.error("❌ Error inserting:", item.title, error)
    else console.log("✅ Added:", item.title)
  }
  
  console.log("🎉 Database populated!")
}

seed()