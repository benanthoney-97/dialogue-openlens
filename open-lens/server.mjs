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

// Connect to Databases
const supabase = createClient(
  process.env.PLASMO_PUBLIC_SUPABASE_URL, // 👈 MUST MATCH YOUR .ENV EXACTLY
  process.env.SUPABASE_SERVICE_ROLE_KEY     // Keep this as is
)

// OpenAI for EMBEDDINGS (Math/Search only)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Gemini for GENERATION (Writing)
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
// Note: 'gemini-2.0-flash' is fast; switch to 'gemini-1.5-pro' for complex reasoning
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }) 

app.post('/api/analyze', async (req, res) => {
  try {
    // 1. RECEIVE REQUEST
    const { text, scanType, providerId } = req.body 
    
    console.log(`\n---------------------------------------------------`)
    console.log(`🔍 NEW REQUEST: Analyzing for Provider ID: ${providerId}`)
    console.log(`📝 Text Snippet: "${text.slice(0, 40)}..."`)

    // 2. FETCH PROVIDER + INHERIT TYPE PERSONA
    // We fetch the provider's name AND the linked system_prompt from provider_types
    const { data: provider } = await supabase
      .from('providers') 
      .select(`
        name,
        provider_types (
          system_prompt
        )
      `)
      .eq('id', providerId)
      .single()

    if (!provider) {
        console.error("❌ Provider not found")
        return res.status(404).json({ error: "Provider not found" })
    }

    // Safely extract the nested prompt
    // @ts-ignore
    const systemPrompt = provider.provider_types?.system_prompt

    if (!systemPrompt) {
        console.error("❌ Configuration Error: Provider has no linked Type/Prompt")
        return res.status(500).json({ error: "Provider misconfigured" })
    }

    console.log(`🎭 Acting as: ${provider.name}`)

    // 3. EMBED (OpenAI)
    console.log(`🧮 Generating Vectors...`)
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    })
    const vector = embeddingResponse.data[0].embedding

    // 4. SEARCH (Supabase - Scoped to Provider)
    console.log(`🗄️ Querying Provider Knowledge...`)
    const { data: documents } = await supabase.rpc('match_provider_knowledge', {
      query_embedding: vector,
      match_threshold: 0.5,
      match_count: 3,
      filter_provider_id: providerId // 🔒 SECURITY: Only search this provider's brain
    })

    if (!documents || documents.length === 0) {
      console.log(`❌ No matches found.`)
      return res.json({ match: false })
    }
    console.log(`✅ Found Match: "${documents[0].title}"`)

    // 5. PREPARE PROMPT
    const context = documents.map(doc => 
      `SOURCE: ${doc.title}\nCONTENT: ${doc.content}`
    ).join("\n\n")

    const dynamicPrompt = `
      ${systemPrompt} 

      INPUT CONTEXT:
      The user is reading this text: "${text}".
      
      INTERNAL KNOWLEDGE:
      ${context}

      FORMATTING RULES:
      1. Use clear Markdown headers.
      2. Do not use code blocks.
      3. Avoid robotic transitions.
    `

    // 6. GENERATE (Gemini)
    console.log(`🤖 CALLING GEMINI...`)
    
    const result = await geminiModel.generateContent({
      contents: [{ role: "user", parts: [{ text: dynamicPrompt }] }],
      generationConfig: {
        temperature: 0.0,      // Robot mode (Strict adherence to prompt)
        maxOutputTokens: 8192, // 🚀 High limit to prevent "thinking" truncation
      }
    })
    
    const response = result.response
    const advice = response.text()

    // 🔍 DEBUG: Log usage
    if (response.usageMetadata) {
        console.log(`📊 Token Usage:`, JSON.stringify(response.usageMetadata))
    }

    // 7. SEND RESPONSE
    res.json({ 
      match: true, 
      report: documents[0], 
      advice: advice 
    })

  } catch (err) {
    console.error("Server Error:", err)
    res.status(500).json({ error: "Analysis failed" })
  }
})

const PORT = 3000
app.listen(PORT, () => console.log(`🧠 Platform Brain running on http://localhost:${PORT}`))