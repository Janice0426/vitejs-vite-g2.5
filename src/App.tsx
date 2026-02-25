import React, { useState, useEffect, useRef } from 'react';
import { Clipboard, Activity, AlertCircle, Stethoscope, Eraser, FileText, Send, Loader2, Key, Lock, Brain, Plus, ChevronDown, Settings, X, Save, Trash2, FilePlus, Cloud, LogIn, LogOut, Globe, Share2, DownloadCloud, RefreshCw, Users, Database } from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, deleteDoc, onSnapshot, query, orderBy } from "firebase/firestore";

// ★★★ Config 已預填 ★★★
const firebaseConfig = {
  apiKey: "AIzaSyDbuMY4utvAx2Q1GTIED0Z6Y9WMArWDBh4",
  authDomain: "hate-admission-nooote.firebaseapp.com",
  projectId: "hate-admission-nooote",
  storageBucket: "hate-admission-nooote.firebasestorage.app",
  messagingSenderId: "294474697668",
  appId: "1:294474697668:web:4eb3250621b24b521d3291"
};

// Initialize
let app, auth, db, googleProvider;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
} catch (e) {
  console.error("Firebase init failed:", e);
}

const APP_ID = 'ai-admission-note'; 

interface ExampleTemplate {
  id: string;
  title: string;
  input: string;
  output: string;
  isPublic?: boolean;
  author?: string;
  createdAt?: string;
}

// Error Boundary
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) return <div className="p-8 text-center text-red-600 bg-red-50 h-screen flex items-center justify-center flex-col"><AlertCircle className="w-12 h-12 mb-4"/><h2 className="text-xl font-bold">程式發生錯誤</h2><pre className="mt-4 text-xs text-left bg-white p-4 border rounded">{this.state.error?.toString()}</pre></div>;
    return this.props.children;
  }
}

const AdmissionNoteApp = () => {
  // State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [inputText, setInputText] = useState('');
  const [specialty, setSpecialty] = useState('General Medicine (一般內科)');
  
  // Data
  const defaultExamples: ExampleTemplate[] = [
    {
      id: 'default-1',
      title: '範例 1 (胸痛 - 嚴格全稱版)',
      input: '50yo man chest pain since 2am...',
      output: '50 year old male with a past medical history of hypertension...' 
    }
  ];
  const [privateExamples, setPrivateExamples] = useState<ExampleTemplate[]>(defaultExamples);
  const [publicExamples, setPublicExamples] = useState<ExampleTemplate[]>([]);
  const [userApiKey, setUserApiKey] = useState('');
  
  // UI Status
  const [generatedNote, setGeneratedNote] = useState('');
  const [missingInfo, setMissingInfo] = useState([]);
  const [ddx, setDdx] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [publicLoading, setPublicLoading] = useState(false); 
  const [deletingId, setDeletingId] = useState<string | null>(null); 
  const [publicError, setPublicError] = useState<string | null>(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('note');
  const [showSettings, setShowSettings] = useState(false);
  const [isCloudLoading, setIsCloudLoading] = useState(true);

  const specialties = [
    "General Medicine (一般內科)",
    "General Surgery (一般外科)",
    "OB-GYN (婦產科)",
    "Pediatrics (小兒科)",
    "Emergency (急診)"
  ];

  // --- 1. AUTH LISTENER ---
  useEffect(() => {
    if (!auth) { setIsCloudLoading(false); loadLocalData(); return; }
    
    const unsubscribe = onAuthStateChanged(auth, async (curr) => {
      setUser(curr);
      if (curr) {
        await loadPrivateData(curr.uid);
      } else {
        loadLocalData();
        setPublicExamples([]);
        setPublicError("請先登入以查看");
      }
      setIsCloudLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- 2. PUBLIC DATA LISTENER ---
  useEffect(() => {
    if (!db || !user) return; 
    startPublicListener();
  }, [user]);

  const publicUnsubscribeRef = useRef<() => void | null>(null);

  const startPublicListener = () => {
    if (publicUnsubscribeRef.current) publicUnsubscribeRef.current(); // Clear old
    
    setPublicLoading(true);
    setPublicError(null);

    // V9.0: 增加路徑確認
    const collectionRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'templates');
    const q = query(collectionRef);
    
    const unsub = onSnapshot(q, (snapshot) => {
      const pubs: ExampleTemplate[] = [];
      snapshot.forEach((doc) => {
        pubs.push({ id: doc.id, ...doc.data() } as ExampleTemplate);
      });
      pubs.sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setPublicExamples(pubs);
      setPublicLoading(false);
      if (pubs.length === 0) setPublicError("目前沒有公用範本");
      else setPublicError(null);
    }, (err) => {
      console.error("Public sync error:", err);
      setPublicLoading(false);
      setPublicError("讀取錯誤: " + err.message);
    });

    publicUnsubscribeRef.current = unsub;
  };

  const manualRefresh = () => {
      setPublicExamples([]); 
      startPublicListener();
  };

  // --- DATA HELPERS ---
  const loadPrivateData = async (uid: string) => {
    if (!db) return;
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
          const data = snap.data();
          if (data.examples) setPrivateExamples(data.examples);
          if (data.apiKey) setUserApiKey(data.apiKey);
        }
    } catch (e) { console.error(e) }
  };

  const loadLocalData = () => {
    const k = localStorage.getItem('my_gemini_api_key');
    const e = localStorage.getItem('my_custom_examples_v2');
    if (k) setUserApiKey(k);
    if (e) try { setPrivateExamples(JSON.parse(e)); } catch {}
  };

  const savePrivateSettings = async (ex: ExampleTemplate[], k: string) => {
    localStorage.setItem('my_custom_examples_v2', JSON.stringify(ex));
    localStorage.setItem('my_gemini_api_key', k);
    if (user && db) {
      await setDoc(doc(db, "users", user.uid), { examples: ex, apiKey: k, updatedAt: new Date().toISOString() }, { merge: true }).catch(console.error);
    }
  };

  // Auth Actions
  const handleLogin = async () => { if(auth) try { await signInWithPopup(auth, googleProvider); } catch(e) { alert("登入失敗"); } };
  const handleLogout = async () => { if(auth) { await signOut(auth); setPrivateExamples(defaultExamples); setUserApiKey(''); setPublicExamples([]); } };

  // Actions
  const addPrivateExample = () => {
    const ex = [...privateExamples, { id: Date.now().toString(), title: '新範本', input: '', output: '' }];
    setPrivateExamples(ex); savePrivateSettings(ex, userApiKey);
  };
  const updatePrivateExample = (id, field, val) => {
    const ex = privateExamples.map(e => e.id === id ? { ...e, [field]: val } : e);
    setPrivateExamples(ex); savePrivateSettings(ex, userApiKey);
  };
  const deletePrivateExample = (id) => {
    if(!window.confirm("確定刪除？")) return;
    const ex = privateExamples.filter(e => e.id !== id);
    setPrivateExamples(ex); savePrivateSettings(ex, userApiKey);
  };
  
  const shareToPublic = async (ex) => {
    if(!user || !db) return alert("請先登入");
    if(window.confirm("確定發布到公用區？")) {
      try {
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'templates'), {
            title: ex.title,
            input: ex.input,
            output: ex.output,
            author: user.email?.split('@')[0] || 'Anon',
            isPublic: true,
            createdAt: new Date().toISOString()
        });
        alert("發布成功！請查看上方列表。");
      } catch(e: any) {
        alert("發布失敗: " + e.message);
      }
    }
  };

  // ★★★ V9.0 強制刪除邏輯 (無檢查) ★★★
  const deletePublicExample = async (id: string) => {
    if(!user || !db) return alert("請先登入");
    if(!id) return alert("錯誤：找不到 ID");

    if(window.confirm("【確定刪除？】此操作無法復原。")) {
        setDeletingId(id);
        
        try {
            // 直接指定路徑，不囉嗦直接刪
            const docPath = `artifacts/${APP_ID}/public/data/templates/${id}`;
            console.log("Force deleting:", docPath);
            
            const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'templates', id);
            await deleteDoc(docRef);
            
            // 成功後，手動更新一下 UI (雙重保險)
            setPublicExamples(prev => prev.filter(item => item.id !== id));
            alert("刪除成功！");

        } catch(e: any) {
            console.error(e);
            alert("刪除失敗:\n" + e.message + "\n\n(這通常是 Firebase 規則權限不足導致，請確認 Console 後台設定)");
        } finally {
            setDeletingId(null);
        }
    }
  };

  const copyPublicToPrivate = (ex) => {
    const newEx = [...privateExamples, { ...ex, id: Date.now().toString(), title: `${ex.title} (Copy)`, isPublic: false }];
    setPrivateExamples(newEx); savePrivateSettings(newEx, userApiKey);
    alert("已複製到私人區");
  };

  // --- GENERATE ---
  const handleGenerate = async () => {
    if (!inputText.trim()) return;
    if (!userApiKey) { setError("請先設定 API Key"); return; }
    setLoading(true); setError(null);
    
    try {
      const allEx = [...privateExamples, ...publicExamples];
      const fewShot = allEx.map((ex, i) => `=== Example ${i+1} ===\nInput:\n"${ex.input}"\nOutput Style:\n"${ex.output}"`).join('\n\n');
      
      const systemPrompt = `
        You are an experienced ${specialty} physician.
        Task: Create a professional Admission Note based on the input.
        
        STYLE RULES:
        - STRICTLY mimic the output format/style of the examples below.
        - If examples use full terms (e.g. "blood pressure"), you MUST use full terms.
        
        --- EXAMPLES ---
        ${fewShot}
        --- END EXAMPLES ---

        MANDATORY JSON RESPONSE:
        { 
          "admission_note": "Full text...", 
          "missing_information": ["Question 1..."], 
          "differential_diagnosis": [
            { "name": "Diagnosis A", "reasoning": "Reasoning..." }
          ] 
        }
      `;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${userApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Input Data: ${inputText}` }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      if (!res.ok) throw new Error("API Error");
      const json = await res.json();
      const content = JSON.parse(json.candidates?.[0]?.content?.parts?.[0]?.text);
      setGeneratedNote(content.admission_note);
      setMissingInfo(content.missing_information || []);
      setDdx(content.differential_diagnosis || []);
    } catch (e) {
      console.error(e);
      setError("生成失敗，請檢查 API Key 或網路");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    const el = document.createElement("textarea");
    el.value = generatedNote;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  };

  const textareaRef = useRef(null);
  useEffect(() => { if (textareaRef.current) textareaRef.current.style.height = 'auto'; textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'; }, [inputText]);
  const appendText = (t) => setInputText(p => p + (p ? '\n\n' : '') + t);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-10">
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col">
            <div className="p-5 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
              <h3 className="font-bold text-lg flex items-center"><Settings className="w-5 h-5 mr-2 text-blue-600"/> 設定 & 範本</h3>
              <button onClick={() => setShowSettings(false)}><X className="w-6 h-6 text-slate-400"/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className={`p-4 rounded-lg border flex justify-between items-center ${user?'bg-green-50 border-green-200':'bg-orange-50 border-orange-200'}`}>
                <div className="flex items-center"><Cloud className={`w-5 h-5 mr-3 ${user?'text-green-600':'text-orange-400'}`}/>
                  <div className="text-sm font-bold">{user ? `已登入: ${user.email}` : "登入以啟用同步"}</div>
                </div>
                {user ? <button onClick={handleLogout} className="px-3 py-1 bg-white border rounded text-xs">登出</button> : <button onClick={handleLogin} className="px-3 py-1 bg-blue-600 text-white rounded text-xs flex items-center"><LogIn className="w-3 h-3 mr-1"/> Google 登入</button>}
              </div>
              <div className="bg-white p-4 rounded-xl border">
                 <label className="text-xs font-bold text-slate-500 mb-2 block">Gemini API Key (私人)</label>
                 <input type="password" value={userApiKey} onChange={(e)=>{setUserApiKey(e.target.value); savePrivateSettings(privateExamples, e.target.value)}} placeholder="AIza..." className="w-full p-2 text-sm border rounded outline-none focus:border-blue-500"/>
              </div>
              
              {/* Public Lib */}
              <div>
                <h4 className="flex items-center text-sm font-bold text-indigo-700 mb-3">
                    <Globe className="w-4 h-4 mr-2"/> 公用範本庫 (Shared)
                    <button onClick={manualRefresh} className="ml-auto p-1 text-slate-400 hover:text-blue-500" title="強制重新整理 (清除快取)">
                        <RefreshCw className={`w-3 h-3 ${publicLoading ? 'animate-spin' : ''}`} />
                    </button>
                </h4>
                <div className="grid md:grid-cols-2 gap-4">
                  {publicLoading && <div className="col-span-2 text-center py-4 text-xs text-indigo-400"><Loader2 className="w-4 h-4 inline animate-spin mr-2"/>讀取中...</div>}
                  
                  {!publicLoading && publicExamples.length===0 && (
                    <div className="text-center text-slate-400 text-xs py-4 col-span-2 border-2 border-dashed rounded bg-slate-50/50">
                        {publicError ? <span className="text-red-400">{publicError}</span> : "目前沒有公用範本"}
                    </div>
                  )}

                  {publicExamples.map(ex=>(
                    <div key={ex.id} className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 relative group">
                      <div className="flex justify-between mb-2">
                        <div className="font-bold text-sm text-indigo-900">{ex.title} <span className="text-xs font-normal text-indigo-400">by {ex.author}</span></div>
                        <div className="flex gap-1">
                          <button onClick={()=>copyPublicToPrivate(ex)} className="p-1 bg-white rounded border text-indigo-600" title="複製"><DownloadCloud className="w-4 h-4"/></button>
                          {user && (
                             <button 
                               onClick={() => deletePublicExample(ex.id)} 
                               disabled={deletingId === ex.id}
                               className={`p-1 bg-white rounded border transition-colors ${deletingId === ex.id ? 'text-red-200 cursor-wait' : 'text-slate-400 hover:text-red-500 hover:border-red-200'}`}
                               title="刪除"
                             >
                               {deletingId === ex.id ? <Loader2 className="w-4 h-4 animate-spin text-red-500" /> : <Trash2 className="w-4 h-4" />}
                             </button>
                           )}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 bg-white p-2 rounded line-clamp-3 font-mono">{ex.output}</div>
                      <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 text-[9px] text-slate-300 font-mono pointer-events-none select-all bg-white/80 px-1 rounded">{ex.id}</div>
                    </div>
                  ))}
                </div>
              </div>
              <hr/>
              {/* Private Lib */}
              <div>
                <h4 className="flex items-center text-sm font-bold text-slate-700 mb-3"><Lock className="w-4 h-4 mr-2"/> 私人範本</h4>
                <div className="space-y-4">
                  {privateExamples.map(ex=>(
                    <div key={ex.id} className="bg-white border rounded-xl overflow-hidden shadow-sm">
                      <div className="bg-slate-50 px-4 py-2 border-b flex justify-between items-center">
                        <input className="bg-transparent font-bold text-sm w-1/2 outline-none" value={ex.title} onChange={(e)=>updatePrivateExample(ex.id,'title',e.target.value)}/>
                        <div className="flex gap-2">
                          <button onClick={()=>shareToPublic(ex)} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded flex items-center hover:bg-indigo-100"><Share2 className="w-3 h-3 mr-1"/>分享</button>
                          <button onClick={()=>deletePrivateExample(ex.id)} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4"/></button>
                        </div>
                      </div>
                      <div className="p-3 grid grid-cols-2 gap-3">
                        <textarea className="h-24 p-2 text-xs border rounded bg-slate-50 resize-none font-mono" value={ex.input} onChange={(e)=>updatePrivateExample(ex.id,'input',e.target.value)} placeholder="Input..."/>
                        <textarea className="h-24 p-2 text-xs border rounded bg-emerald-50/30 resize-none font-mono" value={ex.output} onChange={(e)=>updatePrivateExample(ex.id,'output',e.target.value)} placeholder="Output..."/>
                      </div>
                    </div>
                  ))}
                  <button onClick={addPrivateExample} className="w-full py-2 border-2 border-dashed rounded text-slate-500 text-sm hover:bg-slate-50 flex justify-center items-center"><FilePlus className="w-4 h-4 mr-2"/>新增私人範本</button>
                </div>
              </div>
            </div>
            <div className="p-4 border-t bg-white rounded-b-xl flex justify-end"><button onClick={()=>setShowSettings(false)} className="px-6 py-2 bg-blue-600 text-white rounded text-sm">完成</button></div>
          </div>
        </div>
      )}

      {/* Main UI */}
      <header className="bg-white border-b sticky top-0 z-20 shadow-sm p-3 flex justify-between items-center">
        <div className="flex items-center gap-2"><div className="bg-blue-600 p-2 rounded"><Stethoscope className="text-white w-5 h-5"/></div><h1 className="font-bold text-lg">AI Note Team</h1></div>
        <div className="flex items-center gap-2">
          {isCloudLoading ? <Loader2 className="animate-spin text-slate-400 w-5 h-5"/> : <div className="hidden sm:flex items-center text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded border border-indigo-200"><Users className="w-3 h-3 mr-1"/> Sync Active</div>}
          <button onClick={()=>setShowSettings(true)} className="flex items-center px-3 py-1.5 text-sm bg-slate-100 rounded hover:bg-slate-200"><Settings className="w-4 h-4 sm:mr-1"/><span className="hidden sm:inline">設定</span></button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 grid lg:grid-cols-2 gap-6">
        <div className="flex flex-col bg-white rounded-xl shadow-sm border overflow-hidden h-[calc(100vh-6rem)]">
          <div className="p-3 border-b bg-slate-50 flex justify-between items-center">
            <h2 className="font-semibold text-sm flex items-center"><FileText className="w-4 h-4 mr-2 text-blue-600"/> 輸入</h2>
            <div className="relative">
              <select value={specialty} onChange={(e)=>setSpecialty(e.target.value)} className="pl-2 pr-6 py-1 text-xs border rounded appearance-none bg-white cursor-pointer outline-none w-auto max-w-[180px] sm:max-w-xs truncate">
                {specialties.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown className="absolute right-1 top-1.5 w-3 h-3 text-slate-400 pointer-events-none"/>
            </div>
          </div>
          <textarea ref={textareaRef} className="flex-1 p-4 resize-none outline-none text-base" placeholder="輸入病人資訊..." value={inputText} onChange={(e)=>setInputText(e.target.value)}/>
          <div className="p-4 border-t"><button onClick={handleGenerate} disabled={loading||!inputText.trim()} className="w-full py-3 bg-blue-600 text-white rounded font-medium disabled:opacity-50">{loading?<Loader2 className="animate-spin w-5 h-5 mx-auto"/>:"生成病歷"}</button></div>
        </div>

        <div className="flex flex-col h-[calc(100vh-6rem)]">
          <div className="flex bg-slate-200 p-1 rounded-lg self-start mb-2">
            <button onClick={()=>setActiveTab('note')} className={`px-4 py-1.5 rounded text-sm font-medium ${activeTab==='note'?'bg-white shadow text-blue-600':'text-slate-500'}`}>Note</button>
            <button onClick={()=>setActiveTab('analysis')} className={`px-4 py-1.5 rounded text-sm font-medium ${activeTab==='analysis'?'bg-white shadow text-indigo-600':'text-slate-500'}`}>Analysis</button>
          </div>
          <div className="flex-1 bg-white rounded-xl shadow-sm border overflow-hidden relative flex flex-col">
            {error && <div className="absolute inset-0 bg-white/90 z-10 flex flex-col items-center justify-center text-red-500"><AlertCircle className="w-8 h-8 mb-2"/><p>{error}</p><button onClick={()=>setError(null)} className="underline text-sm mt-2">關閉</button></div>}
            
            {activeTab==='note' ? (
              <>
                <div className="p-3 border-b bg-slate-50 flex justify-between items-center"><span className="text-xs font-bold text-slate-500">ADMISSION NOTE</span> {generatedNote && <button onClick={copyToClipboard} className="text-xs border bg-white px-2 py-1 rounded"><Clipboard className="w-3 h-3"/></button>}</div>
                <textarea className="flex-1 p-6 resize-none outline-none font-mono text-sm leading-relaxed" value={generatedNote} onChange={(e)=>setGeneratedNote(e.target.value)}/>
              </>
            ) : (
              <div className="p-4 overflow-y-auto space-y-4">
                <div>
                  <h3 className="font-bold text-indigo-900 text-sm mb-2 flex items-center"><Brain className="w-4 h-4 mr-1"/> 鑑別診斷 (DDx)</h3>
                  {ddx.length > 0 ? ddx.map((i,x)=>(
                    <div key={x} className="bg-slate-50 p-3 mb-2 rounded border border-slate-100">
                      <div className="font-bold text-sm text-slate-800">{i.name || i.diagnosis || i.title || "Diagnosis"}</div>
                      <div className="text-xs text-slate-500 mt-1">{i.reasoning || i.description || i.reason || "No reasoning provided."}</div>
                    </div>
                  )) : <div className="text-center text-slate-400 text-xs py-4 border-2 border-dashed rounded">等待生成... (AI 將分析鑑別診斷)</div>}
                </div>
                <div>
                  <h3 className="font-bold text-amber-900 text-sm mb-2 flex items-center"><AlertCircle className="w-4 h-4 mr-1"/> 建議詢問 (Missing Info)</h3>
                  {missingInfo.length > 0 ? missingInfo.map((i,x)=>(
                    <div key={x} className="text-sm bg-amber-50 p-2 mb-1 rounded text-amber-800 cursor-pointer hover:bg-amber-100" onClick={()=>appendText(`[${i}] `)}><Plus className="w-3 h-3 inline mr-1"/>{i}</div>
                  )) : <div className="text-center text-slate-400 text-xs py-4 border-2 border-dashed rounded">資料完整</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default class AppErrorBoundary extends React.Component {
  componentDidCatch(e, i) { console.error(e, i); }
  render() { return <ErrorBoundary><AdmissionNoteApp/></ErrorBoundary>; }
}