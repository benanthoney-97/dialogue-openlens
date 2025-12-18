import { useState, useEffect } from "react"
import "./style.css"
import { 
  Send, ArrowLeft, Building2, FlaskConical, MousePointer2, 
  ShieldCheck, Sparkles, ChevronDown, AlertTriangle, FileSearch
} from "lucide-react"
import { Conversation, ConversationContent, ConversationScrollButton } from "./components/ui/conversation"
import { Response } from "./components/ui/response"
import { createClient } from '@supabase/supabase-js'

// --- CONFIGURATION ---
const supabase = createClient(
  process.env.PLASMO_PUBLIC_SUPABASE_URL!,
  process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY!
)

function SidePanel() {
  // --- STATE ---
  const [currentView, setCurrentView] = useState<'dashboard' | 'chat'>('dashboard')
  const [providers, setProviders] = useState<any[]>([])
  const [activeProvider, setActiveProvider] = useState<any>(null)

// Chat State
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([])
  const [input, setInput] = useState("")
  const [isScanning, setIsScanning] = useState(false)

  // NEW: State to hold the "Retry" details if a scan fails validation
  const [pendingFallback, setPendingFallback] = useState<{text: string, type: string} | null>(null)

// Load Providers
  useEffect(() => {
    // MOCK USER: Change this to 'jane@gmail.com' to test being locked out!
    const SIMULATED_USER_EMAIL = "ben@dialogue-ai.co" 
    const userDomain = SIMULATED_USER_EMAIL.split('@')[1]

    const fetchProviders = async () => {
      // 1. Fetch Public Providers
      const { data: publicProviders } = await supabase
        .from('providers')
        .select('*')
        .eq('is_public', true)

      // 2. Fetch Private Access
      const { data: accessList } = await supabase
        .from('provider_access')
        .select('provider_id')
        .eq('domain_pattern', userDomain)
      
      const allowedIds = accessList?.map(a => a.provider_id) || []
      
      let privateProviders: any[] = []
      if (allowedIds.length > 0) {
        const { data } = await supabase
            .from('providers')
            .select('*')
            .in('id', allowedIds)
        if(data) privateProviders = data
      }

      // Merge & De-duplicate
      const allProviders = [...(publicProviders || []), ...privateProviders]
      const unique = allProviders.filter((v,i,a)=>a.findIndex(v2=>(v2.id===v.id))===i)

      if (unique.length > 0) {
        setProviders(unique)
        setActiveProvider(unique[0]) 
      }
    }
    fetchProviders()
  }, [])

  // --- ACTIONS ---

const handleReset = () => {
    setCurrentView('dashboard')
    setMessages([])
    setIsScanning(false)
    setInput("")
    setPendingFallback(null)
  }

// 1. Run Analysis (THE FIXED FUNCTION)
  const runAnalysis = async (text: string, scanType: string, force = false) => {
    if (!activeProvider) return
    
    // UI SETUP
    if (!force) {
        // Normal Start: Switch view and show "Analyzing..."
        setCurrentView('chat')
        setMessages([{ role: "assistant", content: `**${activeProvider.name}** is analyzing...` }])
    } else {
        // Forced Retry: Show "Thinking..."
        setMessages(prev => [...prev, { role: "assistant", content: "Generating general opinion..." }])
    }
    
    setIsScanning(true)
    setPendingFallback(null) // Reset any previous errors

    try {
        const response = await fetch('http://localhost:3000/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                text, 
                scanType,
                providerId: activeProvider.id,
                forceFallback: force // Tell server if we are forcing it
            })
        })
        const result = await response.json()

        console.log("🔍 FRONTEND RECEIVED:", result) 

        // 🛑 CRITICAL CHECK: STOP HERE IF CONFIRMATION IS NEEDED
        if (result.requiresConfirmation === true) {
            console.log("⚠️ Triggering Confirmation UI")
            setMessages(prev => prev.slice(0, -1)) // Remove "Analyzing..." text
            setPendingFallback({ text, type: scanType }) // Enable the CTA Card
            setIsScanning(false)
            return // 👈 THIS MUST BE HERE TO STOP THE FUNCTION
        }

        // ✅ SUCCESS PATH (Only runs if requiresConfirmation is false)
        const cleanAdvice = result.advice
            ? result.advice.replace(/^```markdown\s*/i, "").replace(/```$/, "").trim()
            : "No output generated."

        setMessages(prev => {
            // Remove the loading message and add the real advice
            const history = prev.slice(0, -1) 
            return [...history, { role: "assistant", content: cleanAdvice }]
        })

    } catch (e) {
        console.error(e)
        setMessages(prev => prev.slice(0, -1))
        setMessages(prev => [...prev, { role: "assistant", content: "Error: Could not connect to Platform Brain." }])
    } finally {
        setIsScanning(false)
    }
  }

  // 2. Handle Text Scanning (Buttons)
  const performScan = async (type: 'full' | 'selection' | 'summary') => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return

    let scriptFunc = () => window.getSelection()?.toString()
    if (type === 'full' || type === 'summary') {
        scriptFunc = () => document.body.innerText.replace(/\s+/g, " ").slice(0, 15000)
    }

    const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, 
        func: scriptFunc
    })
    
    const text = res[0]?.result
    if (text && text.trim().length > 0) {
        runAnalysis(text, type)
    } else {
        setCurrentView('chat')
        setMessages([{ role: "assistant", content: "No text found to analyze." }])
    }
  }
// 3. Handle Manual Chat Input
  const handleSend = async () => {
    if (!input.trim() || !activeProvider) return
    const textToSend = input
    setInput("") // Clear immediately
    await runAnalysis(textToSend, 'chat')
  }

  return (
    <div className="flex h-screen w-full flex-col bg-slate-50 font-sans text-slate-900">
       
       {/* --- HEADER (Navy Background) --- */}
       <div className="bg-slate-900 border-b border-slate-800 p-3 shadow-md z-10 flex items-center justify-between h-14 shrink-0">
          
          {currentView === 'chat' ? (
             <button onClick={handleReset} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition">
                <ArrowLeft size={18} />
             </button>
          ) : (
             <div className="flex items-center gap-2 pl-1">
                <div className={`p-1.5 rounded-md ${activeProvider?.name.includes("Law") ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                   {activeProvider?.name.includes("Law") ? <Building2 size={16}/> : <FlaskConical size={16}/>}
                </div>
                <span className="font-bold text-xs tracking-wide text-white">OPENLENS</span>
             </div>
          )}

          {/* PROVIDER SWITCHER (Dark Mode Style) */}
          <div className="relative group">
              <select 
                value={activeProvider?.id || ""}
                onChange={(e) => {
                    const selected = providers.find(p => p.id == e.target.value)
                    setActiveProvider(selected)
                    handleReset()
                }}
                className="appearance-none bg-slate-800 border border-slate-700 text-white text-xs font-bold py-1.5 pl-3 pr-8 rounded-lg cursor-pointer focus:outline-none focus:ring-1 focus:ring-slate-500 hover:border-slate-600 transition-all max-w-[160px] truncate"
              >
                  {providers.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
          </div>
       </div>

       {/* --- SCROLLABLE CONTENT --- */}
       <div className="flex-1 overflow-y-auto relative">
          
          {/* DASHBOARD VIEW */}
          {currentView === 'dashboard' && (
             <div className="flex flex-col h-full p-6 space-y-4 justify-center pb-20">
                <div className="text-center mb-4">
                    <h2 className="text-lg font-bold text-slate-800">Ready to Analyze?</h2>
                    <p className="text-xs text-slate-500">Using intelligence from <span className="font-semibold">{activeProvider?.name || "..."}</span></p>
                </div>

                <button onClick={() => performScan('full')} className="w-full group bg-white border border-slate-200 hover:border-amber-400 hover:shadow-md p-4 rounded-xl transition-all active:scale-[0.98] flex items-center gap-4 text-left">
                    <div className="bg-amber-50 p-3 rounded-lg group-hover:bg-amber-100 transition"><ShieldCheck className="w-6 h-6 text-amber-600" /></div>
                    <div><span className="block font-bold text-sm text-slate-800">Scan Full Page</span><span className="block text-[10px] text-slate-500">Check for risks</span></div>
                </button>

                <button onClick={() => performScan('selection')} className="w-full group bg-slate-900 text-white shadow-lg shadow-slate-200 hover:bg-slate-800 p-4 rounded-xl transition-all active:scale-[0.98] flex items-center gap-4 text-left">
                    <div className="bg-slate-700 p-3 rounded-lg group-hover:bg-slate-600 transition"><MousePointer2 className="w-6 h-6 text-white" /></div>
                    <div><span className="block font-bold text-sm">Analyze Selection</span><span className="block text-[10px] text-slate-300">Highlight text first</span></div>
                </button>

                <button onClick={() => performScan('summary')} className="w-full group bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md p-4 rounded-xl transition-all active:scale-[0.98] flex items-center gap-4 text-left">
                     <div className="bg-blue-50 p-3 rounded-lg group-hover:bg-blue-100 transition"><Sparkles className="w-6 h-6 text-blue-600" /></div>
                    <div><span className="block font-bold text-sm text-slate-800">Summarize Page</span><span className="block text-[10px] text-slate-500">Quick overview</span></div>
                </button>
             </div>
          )}

          {/* CHAT VIEW (FIXED: Independent Rendering for Fallback) */}
          {currentView === 'chat' && (
             <div className="p-4 h-full flex flex-col relative">
                
                {/* 1. MESSAGES LIST (Only render if there are messages) */}
                {messages.length > 0 && (
                    <Conversation>
                        <ConversationContent>
                            {messages.map((m, i) => (
                                <div key={i} className={`mb-4 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                                    <div className={`inline-block text-sm p-3 rounded-xl shadow-sm ${
                                        m.role === 'user' 
                                        ? 'bg-slate-800 text-white' 
                                        : 'bg-white border border-slate-200 text-slate-800'
                                    }`}>
                                        {m.role === 'assistant' ? <Response>{m.content}</Response> : m.content}
                                    </div>
                                </div>
                            ))}
                            {isScanning && (
                               <div className="flex items-center gap-2 text-xs text-slate-400 pl-2 animate-pulse mt-2">
                                  <div className="w-2 h-2 bg-slate-400 rounded-full" />
                                  <span>Consulting {activeProvider?.name}...</span>
                               </div>
                            )}
                        </ConversationContent>
                        <ConversationScrollButton />
                    </Conversation>
                )}

                {/* 2. FALLBACK CTA (Render INDEPENDENTLY so it never gets hidden) */}
                {pendingFallback && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-50/80 backdrop-blur-[2px] p-6 animate-in fade-in zoom-in duration-200">
                        <div className="w-full max-w-xs p-5 bg-white border border-amber-200 rounded-2xl shadow-lg text-center">
                            
                            <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4 text-amber-600 ring-4 ring-amber-50">
                                <AlertTriangle size={24} />
                            </div>

                            <h3 className="font-bold text-slate-900 text-base mb-2">No Internal Records</h3>
                            
                            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                                <strong>{activeProvider?.name}</strong> has no verified precedents matching this content.
                            </p>

                            <button 
                                onClick={() => runAnalysis(pendingFallback.text, pendingFallback.type, true)}
                                className="w-full py-3 px-4 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 hover:scale-[1.02] transition shadow-md flex items-center justify-center gap-2"
                            >
                                <FileSearch size={16} />
                                Generate General Opinion
                            </button>

                            <button 
                                onClick={handleReset}
                                className="mt-3 text-[10px] text-slate-400 hover:text-slate-600 font-semibold uppercase tracking-wide"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
             </div>
          )}
       </div>

       {/* --- FOOTER (INPUT AREA) --- */}
       <div className="p-4 bg-white border-t border-slate-200 shrink-0">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={activeProvider ? `Ask ${activeProvider.name}...` : "Select a provider..."}
              disabled={isScanning || !activeProvider}
              className="w-full rounded-full border border-slate-300 bg-slate-50 py-3 pl-4 pr-10 text-sm focus:border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-800 transition shadow-sm disabled:opacity-50"
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isScanning} 
              className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 transition"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
       </div>

    </div>
  )
}

export default SidePanel