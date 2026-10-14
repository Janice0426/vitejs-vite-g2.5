import React, { useState, useEffect, useRef } from 'react';
import { Clipboard, Check, Activity, AlertCircle, Stethoscope, Eraser, FileText, Send, Loader2, Key, Lock, Brain, Plus, ChevronDown, Settings, X, Save, Trash2, FilePlus, Cloud, LogIn, LogOut, Globe, Share2, DownloadCloud, RefreshCw, Users, Cpu, Sparkles, BookOpen } from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, deleteDoc, onSnapshot, query } from "firebase/firestore";

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
let app: any, auth: any, db: any, googleProvider: any;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
} catch (e) {
  console.error("Firebase init failed:", e);
}

const APP_ID = 'ai-admission-note';

// 預設可選模型清單
const PRESET_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (速度快 / 預設)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (高推理 / 複雜病歷推薦)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (量大管飽)' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (穩定版)' },
  { id: 'custom', label: '✨ 自訂模型名稱 (手動輸入)...' }
];

interface ExampleTemplate {
  id: string;
  title: string;
  input: string;
  output: string;
  isPublic?: boolean;
  isEnabled?: boolean; // 控制是否納入 Few-shot 參考
  author?: string;
  createdAt?: string;
}

// Error Boundary
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) return (
      <div className="p-8 text-center text-red-600 bg-red-50 h-screen flex items-center justify-center flex-col">
        <AlertCircle className="w-12 h-12 mb-4"/>
        <h2 className="text-xl font-bold">程式發生錯誤</h2>
        <pre className="mt-4 text-xs text-left bg-white p-4 border rounded max-w-2xl overflow-auto">{this.state.error?.toString()}</pre>
      </div>
    );
    return this.props.children;
  }
}

const AdmissionNoteApp = () => {
  // State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [inputText, setInputText] = useState('');
  const [specialty, setSpecialty] = useState('General Medicine (一般內科)');

  // Model Selection State
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');
  const [customModelName, setCustomModelName] = useState('');

  // 預設提供一份完整結構的範本，避免半成品干擾 Few-shot 學習
  const defaultExamples: ExampleTemplate[] = [
    {
      id: 'default-1',
      title: '範例 1 (內科胸痛 - 嚴格全稱段落版)',
      input: '50yo man, HTN, heavy smoker. Chest pain since 2am, retrosternal, radiating to left jaw, cold sweating. BP 160/95, HR 102. EKG: ST elevation V2-V4.',
      output: `[Chief Complaint]
Retrosternal chest pain since 2:00 AM today.

[Present Illness]
This 50-year-old male has a past medical history of hypertension under irregular medical control and is a heavy smoker. According to the patient, he was in his usual state of health until 2:00 AM today, when he experienced sudden onset of severe retrosternal chest pain. The pain was characterized as壓迫感 (squeezing), radiating to his left jaw, and was accompanied by profuse diaphoresis (cold sweating). There was no relieving factor by rest. He was therefore brought to our Emergency Department for evaluation.
At the Emergency Department, vital signs revealed a blood pressure of 160/95 millimeters of mercury and a heart rate of 102 beats per minute. Twelve-lead electrocardiogram demonstrated ST-segment elevation over leads V2 to V4. Under the impression of ST-elevation myocardial infarction, he was admitted for emergent cardiac catheterization and further management.`,
      isEnabled: true
    }
  ];

  const [privateExamples, setPrivateExamples] = useState<ExampleTemplate[]>(defaultExamples);
  const [publicExamples, setPublicExamples] = useState<ExampleTemplate[]>([]);
  // 控制當前要套用的範本模式：'all_enabled' (所有啟用的範本) 或 特定範本的 ID
  const [selectedTemplateTarget, setSelectedTemplateTarget] = useState<string>('all_enabled');
  const [userApiKey, setUserApiKey] = useState('');

  // UI Status
  const [generatedNote, setGeneratedNote] = useState('');
  const [missingInfo, setMissingInfo] = useState<string[]>([]);
  const [ddx, setDdx] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [publicLoading, setPublicLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [publicError, setPublicError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('note');
  const [showSettings, setShowSettings] = useState(false);
  const [isCloudLoading, setIsCloudLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const specialties = [
    "General Medicine (一般內科)",
    "General Surgery (一般外科)",
    "OB-GYN (婦產科)",
    "Pediatrics (小兒科)",
    "Emergency (急診)"
  ];

  // 取得實際呼叫 API 的模型名稱
  const effectiveModel = selectedModel === 'custom' ? (customModelName.trim() || 'gemini-2.5-flash') : selectedModel;

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

  const publicUnsubscribeRef = useRef<(() => void) | null>(null);

  const startPublicListener = () => {
    if (publicUnsubscribeRef.current) publicUnsubscribeRef.current();

    setPublicLoading(true);
    setPublicError(null);

    const collectionRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'templates');
    const q = query(collectionRef);

    const unsub = onSnapshot(q, (snapshot) => {
      const pubs: ExampleTemplate[] = [];
      snapshot.forEach((docSnap) => {
        pubs.push({ id: docSnap.id, ...docSnap.data() } as ExampleTemplate);
      });
      pubs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
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
        if (data.examples) {
          // 確保舊資料預設開啟 isEnabled
          const normalized = data.examples.map((ex: ExampleTemplate) => ({
            ...ex,
            isEnabled: ex.isEnabled !== undefined ? ex.isEnabled : true
          }));
          setPrivateExamples(normalized);
        }
        if (data.apiKey) setUserApiKey(data.apiKey);
        if (data.selectedModel) setSelectedModel(data.selectedModel);
        if (data.customModelName) setCustomModelName(data.customModelName);
      } else {
        loadLocalData();
      }
    } catch (e) { console.error(e); }
  };

  const loadLocalData = () => {
    const k = localStorage.getItem('my_gemini_api_key');
    const e = localStorage.getItem('my_custom_examples_v2');
    const m = localStorage.getItem('my_gemini_selected_model');
    const cm = localStorage.getItem('my_gemini_custom_model');
    if (k) setUserApiKey(k);
    if (m) setSelectedModel(m);
    if (cm) setCustomModelName(cm);
    if (e) {
      try {
        const parsed = JSON.parse(e);
        setPrivateExamples(parsed.map((ex: ExampleTemplate) => ({
          ...ex,
          isEnabled: ex.isEnabled !== undefined ? ex.isEnabled : true
        })));
      } catch {}
    }
  };

  const savePrivateSettings = async (
    ex: ExampleTemplate[],
    k: string,
    model: string = selectedModel,
    customModel: string = customModelName
  ) => {
    localStorage.setItem('my_custom_examples_v2', JSON.stringify(ex));
    localStorage.setItem('my_gemini_api_key', k);
    localStorage.setItem('my_gemini_selected_model', model);
    localStorage.setItem('my_gemini_custom_model', customModel);
    if (user && db) {
      await setDoc(doc(db, "users", user.uid), {
        examples: ex,
        apiKey: k,
        selectedModel: model,
        customModelName: customModel,
        updatedAt: new Date().toISOString()
      }, { merge: true }).catch(console.error);
    }
  };

  // Auth Actions
  const handleLogin = async () => { if (auth) try { await signInWithPopup(auth, googleProvider); } catch (e) { alert("登入失敗"); } };
  const handleLogout = async () => { if (auth) { await signOut(auth); setPrivateExamples(defaultExamples); setUserApiKey(''); setPublicExamples([]); } };

  // Template Actions
  const addPrivateExample = () => {
    const ex = [...privateExamples, { id: Date.now().toString(), title: '新範本', input: '', output: '', isEnabled: true }];
    setPrivateExamples(ex); savePrivateSettings(ex, userApiKey);
  };
  const updatePrivateExample = (id: string, field: keyof ExampleTemplate, val: any) => {
    const ex = privateExamples.map(e => e.id === id ? { ...e, [field]: val } : e);
    setPrivateExamples(ex); savePrivateSettings(ex, userApiKey);
  };
  const deletePrivateExample = (id: string) => {
    if (!window.confirm("確定刪除？")) return;
    const ex = privateExamples.filter(e => e.id !== id);
    setPrivateExamples(ex); savePrivateSettings(ex, userApiKey);
    if (selectedTemplateTarget === id) setSelectedTemplateTarget('all_enabled');
  };

  const shareToPublic = async (ex: ExampleTemplate) => {
    if (!user || !db) return alert("請先登入");
    if (!ex.output.trim()) return alert("範本 Output 不能為空！");
    if (window.confirm("確定發布到公用區？")) {
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
      } catch (e: any) {
        alert("發布失敗: " + e.message);
      }
    }
  };

  const deletePublicExample = async (id: string) => {
    if (!user || !db) return alert("請先登入");
    if (!id) return alert("錯誤：找不到 ID");

    if (window.confirm("【確定刪除？】此操作無法復原。")) {
      setDeletingId(id);
      try {
        const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'templates', id);
        await deleteDoc(docRef);
        setPublicExamples(prev => prev.filter(item => item.id !== id));
        if (selectedTemplateTarget === id) setSelectedTemplateTarget('all_enabled');
        alert("刪除成功！");
      } catch (e: any) {
        console.error(e);
        alert("刪除失敗:\n" + e.message);
      } finally {
        setDeletingId(null);
      }
    }
  };

  const copyPublicToPrivate = (ex: ExampleTemplate) => {
    const newEx = [...privateExamples, { ...ex, id: Date.now().toString(), title: `${ex.title} (Copy)`, isPublic: false, isEnabled: true }];
    setPrivateExamples(newEx); savePrivateSettings(newEx, userApiKey);
    alert("已複製到私人區並啟用！");
  };

  // 計算目前實際生效的範本清單（過濾空白範本，避免干擾 AI）
  const getActiveTemplates = (): ExampleTemplate[] => {
    const validPrivate = privateExamples.filter(e => e.output && e.output.trim().length > 0);
    const validPublic = publicExamples.filter(e => e.output && e.output.trim().length > 0);
    const allValid = [...validPrivate, ...validPublic];

    if (selectedTemplateTarget !== 'all_enabled') {
      const target = allValid.find(e => e.id === selectedTemplateTarget);
      return target ? [target] : [];
    }
    // 預設只拿「私人區有勾選啟用 (isEnabled !== false)」的有效範本，避免公用區雜亂範本污染風格
    return validPrivate.filter(e => e.isEnabled !== false);
  };

  // --- GENERATE (強化版 Multi-turn Few-Shot 引擎) ---
  const handleGenerate = async () => {
    if (!inputText.trim()) return;
    if (!userApiKey) { setError("請先點擊右上角「設定」填入 Gemini API Key"); return; }
    if (!effectiveModel) { setError("請選擇或輸入有效的模型名稱"); return; }

    setLoading(true);
    setError(null);

    try {
      const activeTemplates = getActiveTemplates();

      const styleInstruction = activeTemplates.length > 0
        ? `CRITICAL STYLE & FORMAT CLONING RULES:
1. You MUST strictly clone the structure, section headers (e.g., [Chief Complaint], <PI>, SOAP, bullet points, or paragraph style), indentation, line breaks, and phrasing habits of the provided Reference Examples.
2. Observe the abbreviation density in the Reference Examples: if the examples spell out full medical terms (e.g., "blood pressure", "electrocardiogram", "hypertension"), you MUST write full terms and NEVER abbreviate. Conversely, if the examples use compact clinical shorthand, mirror that exact density.
3. Do NOT invent extra sections that do not exist in the reference template's output style.`
        : `Write a standard, well-structured clinical Admission Note appropriate for ${specialty}.`;

      const systemPrompt = `You are a senior attending physician in ${specialty}.
Your task is to generate a clinical Admission Note, identify missing clinical history/workup questions, and provide differential diagnoses based on the user's raw input notes.

${styleInstruction}

You MUST always respond with a valid JSON object matching this exact schema:
{
  "admission_note": "The complete formatted admission note strictly following the reference template's layout and tone...",
  "missing_information": ["Specific clinical question 1 to ask the patient or check...", "Question 2..."],
  "differential_diagnosis": [
    { "name": "Diagnosis 1", "reasoning": "Brief clinical reasoning based on positive/negative findings..." }
  ]
}`;

      // ★ 關鍵升級：將範本轉換為真實的 Multi-turn 對話歷史 (User -> Model JSON)
      // 這能讓 Gemini 在強制 JSON 模式下依然 100% 鎖定範本裡 admission_note 的排版細節
      const contents: any[] = [];

      activeTemplates.forEach((ex, idx) => {
        contents.push({
          role: "user",
          parts: [{
            text: `[Reference Template #${idx + 1}: ${ex.title}]\nSpecialty: ${specialty}\nRaw Patient Data:\n${ex.input || '(See target format in output)'}\n\nPlease generate the JSON response strictly following the target Admission Note format.`
          }]
        });
        contents.push({
          role: "model",
          parts: [{
            text: JSON.stringify({
              admission_note: ex.output,
              missing_information: [
                "Any relevant associated symptoms, past surgical history, or medication allergy history?"
              ],
              differential_diagnosis: [
                {
                  name: "Primary working diagnosis based on clinical presentation",
                  reasoning: "Demonstrated strictly following the template style above."
                }
              ]
            })
          }]
        });
      });

      // 加入本次真正要生成的病人資料
      contents.push({
        role: "user",
        parts: [{
          text: `[Current Patient Task]\nSpecialty: ${specialty}\nRaw Patient Data:\n${inputText}\n\nGenerate the JSON response now. Ensure the "admission_note" field strictly mirrors the exact formatting, headers, and wording style demonstrated in the previous model responses.`
        }]
      });

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(effectiveModel)}:generateContent?key=${userApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2 // 降低隨機性，讓格式模仿更嚴謹穩定
          }
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `HTTP ${res.status} (${effectiveModel})`);
      }

      const json = await res.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("模型未回傳有效內容");

      const content = JSON.parse(rawText);
      setGeneratedNote(content.admission_note || '');
      setMissingInfo(content.missing_information || []);
      setDdx(content.differential_diagnosis || []);
    } catch (e: any) {
      console.error(e);
      setError(`生成失敗 (${effectiveModel})：${e.message || "請檢查模型名稱、API Key 或網路連線"}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedNote);
    } catch {
      const el = document.createElement("textarea");
      el.value = generatedNote;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const appendText = (t: string) => setInputText(p => p + (p ? '\n\n' : '') + t);
  const activeCount = getActiveTemplates().length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-10">
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col">
            <div className="p-5 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
              <h3 className="font-bold text-lg flex items-center"><Settings className="w-5 h-5 mr-2 text-blue-600"/> 設定、模型 & 範本庫</h3>
              <button onClick={() => setShowSettings(false)}><X className="w-6 h-6 text-slate-400 hover:text-slate-600"/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Cloud Auth */}
              <div className={`p-4 rounded-lg border flex justify-between items-center ${user ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}`}>
                <div className="flex items-center">
                  <Cloud className={`w-5 h-5 mr-3 ${user ? 'text-green-600' : 'text-orange-400'}`}/>
                  <div className="text-sm font-bold">{user ? `已登入: ${user.email}` : "登入以啟用雲端同步與公用範本庫"}</div>
                </div>
                {user ? (
                  <button onClick={handleLogout} className="px-3 py-1 bg-white border rounded text-xs hover:bg-slate-50">登出</button>
                ) : (
                  <button onClick={handleLogin} className="px-3 py-1 bg-blue-600 text-white rounded text-xs flex items-center hover:bg-blue-700"><LogIn className="w-3 h-3 mr-1"/> Google 登入</button>
                )}
              </div>

              {/* API Key & Model Config */}
              <div className="grid md:grid-cols-2 gap-4 bg-white p-4 rounded-xl border">
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-2 flex items-center"><Key className="w-3.5 h-3.5 mr-1"/> Gemini API Key (私人儲存)</label>
                  <input
                    type="password"
                    value={userApiKey}
                    onChange={(e) => {
                      setUserApiKey(e.target.value);
                      savePrivateSettings(privateExamples, e.target.value, selectedModel, customModelName);
                    }}
                    placeholder="AIza..."
                    className="w-full p-2 text-sm border rounded outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-2 flex items-center"><Cpu className="w-3.5 h-3.5 mr-1"/> 選擇 AI 模型 (Model)</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => {
                      setSelectedModel(e.target.value);
                      savePrivateSettings(privateExamples, userApiKey, e.target.value, customModelName);
                    }}
                    className="w-full p-2 text-sm border rounded outline-none focus:border-blue-500 bg-white"
                  >
                    {PRESET_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  {selectedModel === 'custom' && (
                    <input
                      type="text"
                      value={customModelName}
                      onChange={(e) => {
                        setCustomModelName(e.target.value);
                        savePrivateSettings(privateExamples, userApiKey, selectedModel, e.target.value);
                      }}
                      placeholder="輸入模型 ID，例如: gemini-2.5-pro-preview"
                      className="mt-2 w-full p-2 text-xs border border-blue-300 bg-blue-50/30 rounded outline-none focus:border-blue-600 font-mono"
                    />
                  )}
                </div>
              </div>

              {/* Private Lib */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="flex items-center text-sm font-bold text-slate-700">
                    <Lock className="w-4 h-4 mr-2 text-emerald-600"/> 私人範本 (勾選「啟用」即會納入 AI 模仿對象)
                  </h4>
                  <span className="text-xs text-slate-400">建議同時啟用 1~2 份同風格範本效果最佳</span>
                </div>
                <div className="space-y-4">
                  {privateExamples.map(ex => (
                    <div key={ex.id} className={`bg-white border rounded-xl overflow-hidden shadow-sm transition-all ${ex.isEnabled !== false ? 'border-emerald-300 ring-1 ring-emerald-100' : 'opacity-60 border-slate-200'}`}>
                      <div className="bg-slate-50 px-4 py-2 border-b flex justify-between items-center">
                        <div className="flex items-center gap-2 w-2/3">
                          <input
                            type="checkbox"
                            checked={ex.isEnabled !== false}
                            onChange={(e) => updatePrivateExample(ex.id, 'isEnabled', e.target.checked)}
                            className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                            title="勾選以啟用此範本"
                          />
                          <input
                            className="bg-transparent font-bold text-sm w-full outline-none focus:bg-white focus:px-2 py-0.5 rounded"
                            value={ex.title}
                            onChange={(e) => updatePrivateExample(ex.id, 'title', e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2 items-center">
                          <button onClick={() => shareToPublic(ex)} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded flex items-center hover:bg-indigo-100"><Share2 className="w-3 h-3 mr-1"/>分享至公用</button>
                          <button onClick={() => deletePrivateExample(ex.id)} className="text-slate-400 hover:text-red-500 p-1"><Trash2 className="w-4 h-4"/></button>
                        </div>
                      </div>
                      <div className="p-3 grid md:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] font-semibold text-slate-400 mb-1">原始簡記 (Input 範例 - 選填，有助於 AI 理解轉換邏輯)</div>
                          <textarea className="w-full h-32 p-2 text-xs border rounded bg-slate-50 resize-none font-mono outline-none focus:border-blue-400" value={ex.input} onChange={(e) => updatePrivateExample(ex.id, 'input', e.target.value)} placeholder="例如: 50yo M HTN chest pain since 2am..."/>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold text-emerald-700 mb-1">目標病歷格式 (Output 範例 - 必填，AI 會嚴格模仿此排版與用字)</div>
                          <textarea className="w-full h-32 p-2 text-xs border border-emerald-200 rounded bg-emerald-50/20 resize-none font-mono outline-none focus:border-emerald-500" value={ex.output} onChange={(e) => updatePrivateExample(ex.id, 'output', e.target.value)} placeholder="貼上妳希望 AI 模仿的完整 Admission Note 範例..."/>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button onClick={addPrivateExample} className="w-full py-2.5 border-2 border-dashed rounded-xl text-slate-500 text-sm hover:bg-slate-50 flex justify-center items-center font-medium"><FilePlus className="w-4 h-4 mr-2"/>新增私人範本</button>
                </div>
              </div>

              <hr/>

              {/* Public Lib */}
              <div>
                <h4 className="flex items-center text-sm font-bold text-indigo-700 mb-3">
                  <Globe className="w-4 h-4 mr-2"/> 公用範本庫 (可下載至私人區或於主畫面直接指定套用)
                  <button onClick={manualRefresh} className="ml-auto p-1 text-slate-400 hover:text-blue-500" title="強制重新整理">
                    <RefreshCw className={`w-3.5 h-3.5 ${publicLoading ? 'animate-spin' : ''}`} />
                  </button>
                </h4>
                <div className="grid md:grid-cols-2 gap-4">
                  {publicLoading && <div className="col-span-2 text-center py-4 text-xs text-indigo-400"><Loader2 className="w-4 h-4 inline animate-spin mr-2"/>讀取中...</div>}

                  {!publicLoading && publicExamples.length === 0 && (
                    <div className="text-center text-slate-400 text-xs py-4 col-span-2 border-2 border-dashed rounded bg-slate-50/50">
                      {publicError ? <span className="text-red-400">{publicError}</span> : "目前沒有公用範本"}
                    </div>
                  )}

                  {publicExamples.map(ex => (
                    <div key={ex.id} className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-3 relative group">
                      <div className="flex justify-between mb-2">
                        <div className="font-bold text-sm text-indigo-900">{ex.title} <span className="text-xs font-normal text-indigo-400">by {ex.author}</span></div>
                        <div className="flex gap-1">
                          <button onClick={() => copyPublicToPrivate(ex)} className="p-1 bg-white rounded border text-indigo-600 hover:bg-indigo-50 text-xs flex items-center px-2" title="複製到私人範本"><DownloadCloud className="w-3.5 h-3.5 mr-1"/>收藏</button>
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
                      <div className="text-xs text-slate-600 bg-white p-2 rounded line-clamp-3 font-mono whitespace-pre-wrap">{ex.output}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-4 border-t bg-white rounded-b-xl flex justify-end">
              <button onClick={() => setShowSettings(false)} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">完成並返回</button>
            </div>
          </div>
        </div>
      )}

      {/* Main Header */}
      <header className="bg-white border-b sticky top-0 z-20 shadow-sm px-4 py-2.5 flex justify-between items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-lg"><Stethoscope className="text-white w-5 h-5"/></div>
          <h1 className="font-bold text-lg hidden sm:block">AI Note Team</h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* 快速模型切換器 */}
          <div className="flex items-center bg-slate-100 rounded-lg px-2 py-1 border border-slate-200">
            <Cpu className="w-3.5 h-3.5 text-blue-600 mr-1.5 shrink-0"/>
            <select
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value);
                savePrivateSettings(privateExamples, userApiKey, e.target.value, customModelName);
              }}
              className="text-xs bg-transparent font-medium text-slate-700 outline-none cursor-pointer"
              title="切換 Gemini 模型"
            >
              {PRESET_MODELS.map(m => <option key={m.id} value={m.id}>{m.id === 'custom' ? '自訂模型...' : m.id}</option>)}
            </select>
            {selectedModel === 'custom' && (
              <input
                type="text"
                value={customModelName}
                onChange={(e) => {
                  setCustomModelName(e.target.value);
                  savePrivateSettings(privateExamples, userApiKey, selectedModel, e.target.value);
                }}
                placeholder="輸入模型 ID..."
                className="ml-2 px-1.5 py-0.5 text-xs bg-white border rounded w-32 font-mono outline-none focus:border-blue-500"
              />
            )}
          </div>

          {isCloudLoading ? (
            <Loader2 className="animate-spin text-slate-400 w-4 h-4"/>
          ) : (
            <div className="hidden md:flex items-center text-xs text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200">
              <Users className="w-3.5 h-3.5 mr-1"/> {user ? '雲端已同步' : '本機模式'}
            </div>
          )}

          <button onClick={() => setShowSettings(true)} className="flex items-center px-3 py-1.5 text-xs sm:text-sm bg-slate-100 rounded-lg hover:bg-slate-200 font-medium">
            <Settings className="w-4 h-4 sm:mr-1"/>
            <span className="hidden sm:inline">設定 & 範本 ({activeCount})</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 grid lg:grid-cols-2 gap-6">
        {/* Left: Input Panel */}
        <div className="flex flex-col bg-white rounded-xl shadow-sm border overflow-hidden h-[calc(100vh-6rem)]">
          {/* 控制列：科別 + 範本指定選擇器 */}
          <div className="p-3 border-b bg-slate-50 flex flex-wrap gap-2 justify-between items-center">
            <h2 className="font-semibold text-sm flex items-center shrink-0">
              <FileText className="w-4 h-4 mr-1.5 text-blue-600"/> 臨床簡記輸入
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              {/* 範本鎖定選擇器 */}
              <div className="relative flex items-center bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1" title="選擇要讓 AI 模仿的範本">
                <BookOpen className="w-3.5 h-3.5 text-emerald-600 mr-1.5 shrink-0"/>
                <select
                  value={selectedTemplateTarget}
                  onChange={(e) => setSelectedTemplateTarget(e.target.value)}
                  className="text-xs bg-transparent text-emerald-900 font-medium outline-none cursor-pointer pr-4 max-w-[190px] truncate appearance-none"
                >
                  <option value="all_enabled">套用所有已勾選私人範本 ({privateExamples.filter(e => e.isEnabled !== false && e.output.trim()).length} 份)</option>
                  <optgroup label="── 單獨鎖定私人範本 ──">
                    {privateExamples.filter(e => e.output.trim()).map(ex => (
                      <option key={ex.id} value={ex.id}>🔒 {ex.title}</option>
                    ))}
                  </optgroup>
                  {publicExamples.length > 0 && (
                    <optgroup label="── 單獨鎖定公用範本 ──">
                      {publicExamples.filter(e => e.output.trim()).map(ex => (
                        <option key={ex.id} value={ex.id}>🌐 {ex.title} (by {ex.author})</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <ChevronDown className="absolute right-1.5 w-3 h-3 text-emerald-600 pointer-events-none"/>
              </div>

              {/* 科別選擇 */}
              <div className="relative">
                <select
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  className="pl-2.5 pr-6 py-1 text-xs border rounded-lg appearance-none bg-white cursor-pointer outline-none max-w-[160px] truncate font-medium"
                >
                  {specialties.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown className="absolute right-1.5 top-2 w-3 h-3 text-slate-400 pointer-events-none"/>
              </div>
            </div>
          </div>

          <textarea
            className="flex-1 p-4 resize-none outline-none text-base overflow-y-auto leading-relaxed"
            placeholder="輸入病人資訊、Vital signs、Lab 或急診處置簡記..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />

          <div className="p-3 bg-slate-50 border-t flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500 truncate">
              模型：<span className="font-mono font-semibold text-slate-700">{effectiveModel}</span> ｜ 參考範本：<span className="font-semibold text-emerald-700">{activeCount} 份</span>
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || !inputText.trim()}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2 shrink-0 transition-colors"
            >
              {loading ? <><Loader2 className="animate-spin w-4 h-4"/> 生成中...</> : <><Sparkles className="w-4 h-4"/> 生成病歷</>}
            </button>
          </div>
        </div>

        {/* Right: Output Panel */}
        <div className="flex flex-col h-[calc(100vh-6rem)]">
          <div className="flex bg-slate-200 p-1 rounded-lg self-start mb-2">
            <button onClick={() => setActiveTab('note')} className={`px-4 py-1.5 rounded text-sm font-medium ${activeTab === 'note' ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}>Note</button>
            <button onClick={() => setActiveTab('analysis')} className={`px-4 py-1.5 rounded text-sm font-medium ${activeTab === 'analysis' ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>Analysis ({ddx.length})</button>
          </div>

          <div className="flex-1 bg-white rounded-xl shadow-sm border overflow-hidden relative flex flex-col">
            {error && (
              <div className="absolute inset-0 bg-white/95 z-10 flex flex-col items-center justify-center text-red-500 p-6 text-center">
                <AlertCircle className="w-8 h-8 mb-2"/>
                <p className="text-sm font-medium max-w-md">{error}</p>
                <button onClick={() => setError(null)} className="mt-4 px-4 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100">關閉提示</button>
              </div>
            )}

            {activeTab === 'note' ? (
              <>
                <div className="p-3 border-b bg-slate-50 flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-500">ADMISSION NOTE</span>
                  {generatedNote && (
                    <button onClick={copyToClipboard} className="text-xs border bg-white hover:bg-slate-50 px-2.5 py-1 rounded flex items-center gap-1 font-medium text-slate-700">
                      {copied ? <><Check className="w-3.5 h-3.5 text-emerald-600"/> 已複製</> : <><Clipboard className="w-3.5 h-3.5"/> 複製全文</>}
                    </button>
                  )}
                </div>
                <textarea
                  className="flex-1 p-6 resize-none outline-none font-mono text-sm leading-relaxed overflow-y-auto"
                  value={generatedNote}
                  onChange={(e) => setGeneratedNote(e.target.value)}
                  placeholder="生成的病歷將顯示於此，可直接手動微調..."
                />
              </>
            ) : (
              <div className="p-4 overflow-y-auto space-y-4">
                <div>
                  <h3 className="font-bold text-indigo-900 text-sm mb-2 flex items-center"><Brain className="w-4 h-4 mr-1"/> 鑑別診斷 (DDx)</h3>
                  {ddx.length > 0 ? ddx.map((i, x) => (
                    <div key={x} className="bg-slate-50 p-3 mb-2 rounded border border-slate-100">
                      <div className="font-bold text-sm text-slate-800">{i.name || i.diagnosis || i.title || "Diagnosis"}</div>
                      <div className="text-xs text-slate-500 mt-1">{i.reasoning || i.description || i.reason || "No reasoning provided."}</div>
                    </div>
                  )) : <div className="text-center text-slate-400 text-xs py-4 border-2 border-dashed rounded">等待生成... (AI 將分析鑑別診斷)</div>}
                </div>
                <div>
                  <h3 className="font-bold text-amber-900 text-sm mb-2 flex items-center"><AlertCircle className="w-4 h-4 mr-1"/> 建議詢問 (Missing Info - 點擊可插入左側輸入框)</h3>
                  {missingInfo.length > 0 ? missingInfo.map((i, x) => (
                    <div key={x} className="text-sm bg-amber-50 p-2 mb-1 rounded text-amber-800 cursor-pointer hover:bg-amber-100" onClick={() => appendText(`[補充: ${i}] `)}>
                      <Plus className="w-3 h-3 inline mr-1"/>{i}
                    </div>
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
  componentDidCatch(e: any, i: any) { console.error(e, i); }
  render() { return <ErrorBoundary><AdmissionNoteApp/></ErrorBoundary>; }
}