import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import path from 'path'

// Load .env from the root directory
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

// CONFIGURATION
const supabase = createClient(
  process.env.PLASMO_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// --- DATA TO INJECT ---
const KNOWLEDGE_BASE = [
  {
    providerName: "Orion Legal",
    docs: [
      {
        title: "Internal Memo: SaaS Indemnity Standards",
        content: "Warning: Never accept standard 'AS-IS' indemnification from SaaS vendors. We strictly require uncapped liability for IP infringement and GDPR breaches. If a vendor refuses, flag as HIGH RISK."
      },
      {
        title: "Precedent: Data Ownership Clauses",
        content: "Client data must remain the property of the Client. Any clause granting the vendor 'derivative rights' to train their AI models on Client Data must be struck out immediately."
      },
      {
        title: "Risk Protocol: Auto-Renewal Terms",
        content: "Any contract with 'Automatic Renewal' without a 30-day notice period is a red flag. We require affirmative consent for renewal or a simplified cancellation mechanism."
      }
    ]
  },
  {
    providerName: "GreenField Research",
    docs: [
      {
        title: "Investment Thesis: The PLG Multiplier",
        content: "We value Product-Led Growth (PLG) motions 3x higher than Sales-Led motions. Look for transparent pricing, self-serve trials, and 'land-and-expand' usage metrics. Hidden pricing is a negative signal."
      },
      {
        title: "Benchmark: Net Revenue Retention (NRR)",
        content: "Top-quartile SaaS companies maintain >120% NRR. If a company does not display their retention metrics or customer expansion stories, assume their churn is high (bad investment)."
      },
      {
        title: "Market Signal: Founder-Led Sales",
        content: "In Seed to Series A stages, we look for Founder-Led sales. If a startup has hired a VP of Sales too early (before $1M ARR), it often indicates a lack of product-market fit."
      }
    ]
  }
]

async function seed() {
  console.log("\n🌱 SEEDING KNOWLEDGE BASE...\n")

  // Verify connection
  const { data: test, error } = await supabase.from('providers').select('count').single()
  if (error) {
    console.error("❌ Database Connection Failed:", error.message)
    process.exit(1)
  }

  for (const group of KNOWLEDGE_BASE) {
    console.log(`Processing Provider: ${group.providerName}...`)

    // 1. Get Provider ID
    const { data: provider } = await supabase
      .from('providers')
      .select('id')
      .eq('name', group.providerName)
      .single()

    if (!provider) {
      console.log(`   ⚠️  Provider '${group.providerName}' not found. Skipping.`)
      continue
    }

    // 2. Clear old knowledge (Optional: keeps it clean for testing)
    await supabase.from('provider_knowledge').delete().eq('provider_id', provider.id)

    // 3. Vectorize and Insert
    for (const doc of group.docs) {
      process.stdout.write(`   - Embedding "${doc.title.substring(0, 30)}..." `)

      try {
        const embeddingResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: doc.content,
        })
        const vector = embeddingResponse.data[0].embedding

        const { error: insertError } = await supabase.from('provider_knowledge').insert({
          provider_id: provider.id,
          title: doc.title,
          content: doc.content,
          embedding: vector
        })

        if (insertError) {
          console.log("❌ DB Error")
          console.error(insertError)
        } else {
          console.log("✅ Done")
        }
      } catch (err) {
        console.log("❌ API Error")
        console.error(err.message)
      }
    }
  }

  console.log("\n✨ Seeding Complete! You can now test the RAG pipeline.\n")
}

seed()