import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

// --- CONFIGURATION ---

// 1. Supabase (Backend/Admin Access)
const supabase = createClient(
  process.env.PLASMO_PUBLIC_SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY     
)

// 2. OpenAI (Used for Embeddings/Search)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// 3. Google Gemini (Used for Generating Advice)
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }) 


// --- API ROUTES ---

app.post('/api/analyze', async (req, res) => {
  try {
    const { text, scanType, providerId, forceFallback } = req.body // 👈 Added forceFallback flag
    
    console.log(`\n---------------------------------------------------`)
    console.log(`🔍 NEW REQUEST: Analyzing for Provider ID: ${providerId}`)
    console.log(`📝 Text Snippet: "${text.slice(0, 40)}..."`)

    // 1. FETCH PROVIDER & PERSONA (SYSTEM PROMPT)
    const { data: provider, error: dbError } = await supabase
      .from('providers') 
      .select(`
        name,
        provider_types (
          system_prompt
        )
      `)
      .eq('id', providerId)
      .single()

    if (dbError || !provider) {
        console.error("❌ Provider Lookup Error:", dbError)
        return res.status(404).json({ error: "Provider not found" })
    }

    // @ts-ignore
    const systemPrompt = provider.provider_types?.system_prompt || "You are a helpful assistant."
    console.log(`🎭 Acting as: ${provider.name}`)

    // 2. EMBED INPUT TEXT (OpenAI)
    console.log(`🧮 Generating Vectors...`)
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.substring(0, 8000), 
    })
    const vector = embeddingResponse.data[0].embedding

    // 3. SEARCH INTERNAL KNOWLEDGE (RAG)
    console.log(`🗄️ Querying Provider Knowledge...`)
    const { data: documents } = await supabase.rpc('match_provider_knowledge', {
      query_embedding: vector,
      match_threshold: 0.5,
      match_count: 3,
      filter_provider_id: providerId 
    })

    const hasKnowledge = documents && documents.length > 0

    // 🛑 STOP LOGIC: If no knowledge & user hasn't forced it, stop here.
    if (!hasKnowledge && !forceFallback) {
        console.log("⚠️ No internal matches. Stopping for user confirmation.")
        return res.json({ 
            match: false, 
            advice: null, 
            requiresConfirmation: true // 👈 Triggers the CTA on frontend
        })
    }

    // 4. PREPARE CONTEXT
    let internalKnowledge = ""
    let matchType = false

    if (hasKnowledge) {
        console.log(`✅ Found ${documents.length} Internal Precedents`)
        internalKnowledge = documents.map(doc => 
            `SOURCE: ${doc.title}\nCONTENT: ${doc.content}`
        ).join("\n\n")
        matchType = true
    } else {
        console.log(`⚠️ Force Fallback Active. Using General Expertise.`)
        internalKnowledge = "No specific internal documents matched. Rely on general professional expertise."
        matchType = false 
    }

    // 5. CONSTRUCT DYNAMIC PROMPT
    const fullPrompt = `
      ${systemPrompt} 

      TASK CONTEXT:
      The user is performing a "${scanType}" scan on a webpage.
      
      INPUT TEXT TO ANALYZE:
      "${text.substring(0, 15000)}"
      
      INTERNAL KNOWLEDGE REFERENCE:
      ${internalKnowledge}

      INSTRUCTIONS:
      1. Analyze the INPUT TEXT based *strictly* on your persona.
      2. If "Internal Knowledge" is present, cite it to reinforce your points.
      3. If no internal knowledge is present, explicitly state: "Based on general principles (no specific internal precedent found)..."
      4. Output using clear Markdown (Headers, Bullet points).
      5. Be concise and high-impact.
    `

    // 6. GENERATE ADVICE (Gemini)
    console.log(`🤖 CALLING GEMINI...`)
    
    const result = await geminiModel.generateContent({
      contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: 0.1,      
        maxOutputTokens: 8192, 
      }
    })
    
    const response = result.response
    const advice = response.text()

    // 7. SEND RESULT
    res.json({ 
      match: matchType, 
      advice: advice,
      requiresConfirmation: false
    })

  } catch (err) {
    console.error("Server Error:", err)
    res.status(500).json({ error: "Analysis failed" })
  }
})

const PORT = 3000
app.listen(PORT, () => console.log(`🧠 Platform Brain running on http://localhost:${PORT}`))