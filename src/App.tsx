import React, { useState, useEffect, useRef } from 'react';
import { Clipboard, Check, AlertCircle, Stethoscope, FileText, Loader2, Key, Lock, Brain, Plus, ChevronDown, Settings, X, Trash2, FilePlus, Cloud, LogIn, Globe, Share2, DownloadCloud, RefreshCw, Users, Cpu, Sparkles, BookOpen, Layers } from 'lucide-react';

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
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (高推理 / 多範本融合推薦)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (量大管飽的笨蛋)' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (品質穩定)' },
  { id: 'custom', label: '✨ 自訂模型名稱 (手動輸入)...' }
];

interface ExampleTemplate {
  id: string;
  title: string;
  input: string;
  output: string;
  isPublic?: boolean;
  isEnabled?: boolean; // 私人範本啟用狀態
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

  // 預設範例
  const defaultExamples: ExampleTemplate[] = [
    {
      id: 'default-1',
      title: '範例 1 (內科胸痛 - 嚴格全稱段落版)',
      input: '50yo man, HTN, heavy smoker. Chest pain since 2am, retrosternal, radiating to left jaw, cold sweating. BP 160/95, HR 102. EKG: ST elevation V2-V4.',
      output: `[Chief Complaint]
Retrosternal chest pain since 2:00 AM today.

[Present Illness]
This 50-year-old male has a past medical history of hypertension under irregular medical control and is a heavy smoker. According to the patient, he was in his usual state of health until 2:00 AM today, when he experienced sudden onset of severe retrosternal chest pain. The pain was characterized as squeezing, radiating to his left jaw, and was accompanied by profuse diaphoresis (cold sweating). There was no relieving factor by rest. He was therefore brought to our Emergency Department for evaluation.
At the Emergency Department, vital signs revealed a blood pressure of 160/95 millimeters of mercury and a heart rate of 102 beats per minute. Twelve-lead electrocardiogram demonstrated ST-segment elevation over leads V2 to V4. Under the impression of ST-elevation myocardial infarction, he was admitted for emergent cardiac catheterization and further management.`,
      isEnabled: true
    }
  ];

  const [privateExamples, setPrivateExamples] = useState<ExampleTemplate[]>(defaultExamples);
  const [publicExamples, setPublicExamples] = useState<ExampleTemplate[]>([]);
  // ★ 新增：紀錄使用者勾選啟用的「公用範本 ID 清單」，支援私人與公用同時無限多選
  const [enabledPublicIds, setEnabledPublicIds] = useState<string[]>([]);
  const [hasInitPublicSelection, setHasInitPublicSelection] = useState<boolean>(false);

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
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [isCloudLoading, setIsCloudLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const specialties = [
    "General Medicine (一般內科)",
    "General Surgery (一般外科)",
    "OB-GYN (婦產科)",
    "Pediatrics (小兒科)",
    "Emergency (急診)"
  ];

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

      // 若使用者從未手動設定過公用範本勾選狀態，預設自動將現有公用範本全部勾選啟用
      const savedPubIds = localStorage.getItem('my_enabled_public_ids');
      if (savedPubIds === null && !hasInitPublicSelection && pubs.length > 0) {
        const allIds = pubs.map(p => p.id);
        setEnabledPublicIds(allIds);
        localStorage.setItem('my_enabled_public_ids', JSON.stringify(allIds));
        setHasInitPublicSelection(true);
      }

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
          const normalized = data.examples.map((ex: ExampleTemplate) => ({
            ...ex,
            isEnabled: ex.isEnabled !== undefined ? ex.isEnabled : true
          }));
          setPrivateExamples(normalized);
        }
        if (data.apiKey) setUserApiKey(data.apiKey);
        if (data.selectedModel) setSelectedModel(data.selectedModel);
        if (data.customModelName) setCustomModelName(data.customModelName);
        if (Array.isArray(data.enabledPublicIds)) {
          setEnabledPublicIds(data.enabledPublicIds);
          setHasInitPublicSelection(true);
          localStorage.setItem('my_enabled_public_ids', JSON.stringify(data.enabledPublicIds));
        } else {
          loadLocalPublicSelection();
        }
      } else {
        loadLocalData();
      }
    } catch (e) { console.error(e); }
  };

  const loadLocalPublicSelection = () => {
    const pubIds = localStorage.getItem('my_enabled_public_ids');
    if (pubIds !== null) {
      try {
        setEnabledPublicIds(JSON.parse(pubIds));
        setHasInitPublicSelection(true);
      } catch {}
    }
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
    loadLocalPublicSelection();
  };

  const savePrivateSettings = async (
    ex: ExampleTemplate[],
    k: string,
    model: string = selectedModel,
    customModel: string = customModelName,
    pubIds: string[] = enabledPublicIds
  ) => {
    localStorage.setItem('my_custom_examples_v2', JSON.stringify(ex));
    localStorage.setItem('my_gemini_api_key', k);
    localStorage.setItem('my_gemini_selected_model', model);
    localStorage.setItem('my_gemini_custom_model', customModel);
    localStorage.setItem('my_enabled_public_ids', JSON.stringify(pubIds));
    if (user && db) {
      await setDoc(doc(db, "users", user.uid), {
        examples: ex,
        apiKey: k,
        selectedModel: model,
        customModelName: customModel,
        enabledPublicIds: pubIds,
        updatedAt: new Date().toISOString()
      }, { merge: true }).catch(console.error);
    }
  };

  // Auth Actions
  const handleLogin = async () => { if (auth) try { await signInWithPopup(auth, googleProvider); } catch (e) { alert("登入失敗"); } };
  const handleLogout = async () => { if (auth) { await signOut(auth); setPrivateExamples(defaultExamples); setUserApiKey(''); setPublicExamples([]); } };

  // Private Template Actions
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
  };

  // Public Template Toggle Action (支援同時勾選多份公用範本)
  const togglePublicExample = (id: string) => {
    const nextIds = enabledPublicIds.includes(id)
      ? enabledPublicIds.filter(item => item !== id)
      : [...enabledPublicIds, id];
    setEnabledPublicIds(nextIds);
    setHasInitPublicSelection(true);
    savePrivateSettings(privateExamples, userApiKey, selectedModel, customModelName, nextIds);
  };

  // 批次快速勾選操作
  const selectAllTemplates = () => {
    const nextPrivate = privateExamples.map(e => ({ ...e, isEnabled: true }));
    const nextPubIds = publicExamples.map(e => e.id);
    setPrivateExamples(nextPrivate);
    setEnabledPublicIds(nextPubIds);
    setHasInitPublicSelection(true);
    savePrivateSettings(nextPrivate, userApiKey, selectedModel, customModelName, nextPubIds);
  };

  const selectOnlyPrivate = () => {
    const nextPrivate = privateExamples.map(e => ({ ...e, isEnabled: true }));
    setPrivateExamples(nextPrivate);
    setEnabledPublicIds([]);
    setHasInitPublicSelection(true);
    savePrivateSettings(nextPrivate, userApiKey, selectedModel, customModelName, []);
  };

  const selectOnlyPublic = () => {
    const nextPrivate = privateExamples.map(e => ({ ...e, isEnabled: false }));
    const nextPubIds = publicExamples.map(e => e.id);
    setPrivateExamples(nextPrivate);
    setEnabledPublicIds(nextPubIds);
    setHasInitPublicSelection(true);
    savePrivateSettings(nextPrivate, userApiKey, selectedModel, customModelName, nextPubIds);
  };

  const clearAllTemplates = () => {
    const nextPrivate = privateExamples.map(e => ({ ...e, isEnabled: false }));
    setPrivateExamples(nextPrivate);
    setEnabledPublicIds([]);
    setHasInitPublicSelection(true);
    savePrivateSettings(nextPrivate, userApiKey, selectedModel, customModelName, []);
  };

  const shareToPublic = async (ex: ExampleTemplate) => {
    if (!user || !db) return alert("請先登入");
    if (!ex.output.trim()) return alert("範本 Output 不能為空！");
    if (window.confirm("確定發布到公用區？")) {
      try {
        const docRef = await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'templates'), {
          title: ex.title,
          input: ex.input,
          output: ex.output,
          author: user.email?.split('@')[0] || 'Anon',
          isPublic: true,
          createdAt: new Date().toISOString()
        });
        // 發布後自動幫自己勾選該公用範本
        const nextPubIds = [...enabledPublicIds, docRef.id];
        setEnabledPublicIds(nextPubIds);
        savePrivateSettings(privateExamples, userApiKey, selectedModel, customModelName, nextPubIds);
        alert("發布成功！並已自動勾選啟用。");
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
        const nextPubIds = enabledPublicIds.filter(item => item !== id);
        setEnabledPublicIds(nextPubIds);
        savePrivateSettings(privateExamples, userApiKey, selectedModel, customModelName, nextPubIds);
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
    alert("已複製到私人區並勾選啟用！");
  };

  // ★ 核心修正：同時取得所有已勾選的「私人範本」與「公用範本」，無數量上限
  const getActiveTemplates = () => {
    const activePrivate = privateExamples
      .filter(e => e.isEnabled !== false && e.output && e.output.trim().length > 0)
      .map(e => ({ ...e, sourceType: '私人範本' }));

    const activePublic = publicExamples
      .filter(e => enabledPublicIds.includes(e.id) && e.output && e.output.trim().length > 0)
      .map(e => ({ ...e, sourceType: `公用範本 (by ${e.author || 'Anon'})` }));

    return {
      activePrivate,
      activePublic,
      allActive: [...activePrivate, ...activePublic]
    };
  };

  // --- GENERATE (支援無限份數之私人+公用範本雙重注入引擎) ---
  const handleGenerate = async () => {
    if (!inputText.trim()) return;
    if (!userApiKey) { setError("請先點擊右上角「設定」填入 Gemini API Key"); return; }
    if (!effectiveModel) { setError("請選擇或輸入有效的模型名稱"); return; }

    setLoading(true);
    setError(null);

    try {
      const { allActive } = getActiveTemplates();

      // 1. 建立全局 System 範本對照表，確保無論勾選幾份範本，AI 都能綜合所有範本的風格與結構
      const globalExamplesBlock = allActive.length > 0
        ? `\n=== SELECTED REFERENCE TEMPLATES (TOTAL: ${allActive.length} TEMPLATES FROM PRIVATE & PUBLIC LIBRARIES) ===\n` +
          allActive.map((ex, i) => (
            `[Template #${i + 1} | Source: ${ex.sourceType} | Title: "${ex.title}"]\n` +
            `Sample Input:\n${ex.input || '(N/A)'}\n` +
            `Target Output Style:\n${ex.output}\n`
          )).join('\n----------------------------------------\n') +
          `\n=== END OF REFERENCE TEMPLATES ===\n`
        : '';

      const styleInstruction = allActive.length > 0
        ? `CRITICAL MULTI-TEMPLATE STYLE SYNTHESIS & CLONING RULES:
1. You have been provided with ${allActive.length} Reference Template(s) selected by the physician (combining Private and Public templates).
2. You MUST synthesize and strictly mirror the section headers, paragraph structure, phrasing habits, indentation, and formatting patterns demonstrated across all ${allActive.length} Reference Templates.
3. Observe the terminology & abbreviation habits in the Reference Templates: if the templates spell out full medical terms (e.g., "blood pressure", "electrocardiogram", "hypertension"), you MUST write full terms. If they use specific clinical shorthand or section brackets, mirror that exact style.
4. Do NOT hallucinate patient data from the templates; only clone their structural layout, tone, and clinical writing style.`
        : `Write a standard, well-structured clinical Admission Note appropriate for ${specialty}.`;

      const systemPrompt = `You are a senior attending physician in ${specialty}.
Your task is to generate a clinical Admission Note, identify missing clinical history/workup questions, and provide differential diagnoses based on the user's raw input notes.

${styleInstruction}
${globalExamplesBlock}

You MUST always respond with a valid JSON object matching this exact schema:
{
  "admission_note": "The complete formatted admission note strictly following the reference templates' layout and tone...",
  "missing_information": ["Specific clinical question 1 to ask the patient or check...", "Question 2..."],
  "differential_diagnosis": [
    { "name": "Diagnosis 1", "reasoning": "Brief clinical reasoning based on positive/negative findings..." }
  ]
}`;

      // 2. 同時建立 Multi-turn 對話歷史 (將所有勾選的私人與公用範本逐一轉為 User -> Model JSON 示範)
      const contents: any[] = [];

      allActive.forEach((ex, idx) => {
        contents.push({
          role: "user",
          parts: [{
            text: `[Reference Example #${idx + 1} (${ex.sourceType}): ${ex.title}]\nSpecialty: ${specialty}\nRaw Patient Data:\n${ex.input || '(Format demonstration)'}\n\nPlease generate the JSON response strictly following this target Admission Note format.`
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
          text: `[Current Patient Task]\nSpecialty: ${specialty}\nRaw Patient Data:\n${inputText}\n\nGenerate the JSON response now. Synthesize and strictly follow the formatting, headers, and wording style demonstrated across all ${allActive.length} Reference Examples above.`
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
            temperature: 0.2
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

  const { activePrivate, activePublic, allActive } = getActiveTemplates();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-10">
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col">
            <div className="p-5 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
              <h3 className="font-bold text-lg flex items-center"><Settings className="w-5 h-5 mr-2 text-blue-600"/> 設定、模型 & 範本庫管理</h3>
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
                      savePrivateSettings(privateExamples, e.target.value, selectedModel, customModelName, enabledPublicIds);
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
                      savePrivateSettings(privateExamples, userApiKey, e.target.value, customModelName, enabledPublicIds);
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
                        savePrivateSettings(privateExamples, userApiKey, selectedModel, e.target.value, enabledPublicIds);
                      }}
                      placeholder="輸入模型 ID，例如: gemini-2.5-pro-preview"
                      className="mt-2 w-full p-2 text-xs border border-blue-300 bg-blue-50/30 rounded outline-none focus:border-blue-600 font-mono"
                    />
                  )}
                </div>
              </div>

              {/* 跨庫範本啟用狀態總覽列 */}
              <div className="bg-slate-100 p-3.5 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-blue-600"/>
                  目前同時參考：<span className="text-blue-600">{allActive.length} 份範本</span>
                  <span className="text-slate-500 font-normal">（私人 {activePrivate.length} 份 + 公用 {activePublic.length} 份，無數量限制）</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={selectAllTemplates} className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">全選 (私人+公用)</button>
                  <button onClick={selectOnlyPrivate} className="px-2.5 py-1 text-xs bg-white border rounded hover:bg-slate-50 text-slate-700">僅選私人</button>
                  <button onClick={selectOnlyPublic} className="px-2.5 py-1 text-xs bg-white border rounded hover:bg-slate-50 text-slate-700">僅選公用</button>
                  <button onClick={clearAllTemplates} className="px-2.5 py-1 text-xs bg-white border rounded hover:bg-red-50 text-red-600">全部取消</button>
                </div>
              </div>

              {/* Public Lib (支援直接勾選啟用) */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="flex items-center text-sm font-bold text-indigo-700">
                    <Globe className="w-4 h-4 mr-2"/> 公用範本庫 (打勾即可與私人範本同時納入 AI 參考)
                  </h4>
                  <button onClick={manualRefresh} className="p-1 text-slate-400 hover:text-blue-500 flex items-center text-xs" title="強制重新整理">
                    <RefreshCw className={`w-3.5 h-3.5 mr-1 ${publicLoading ? 'animate-spin' : ''}`} /> 重新整理
                  </button>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  {publicLoading && <div className="col-span-2 text-center py-4 text-xs text-indigo-400"><Loader2 className="w-4 h-4 inline animate-spin mr-2"/>讀取中...</div>}

                  {!publicLoading && publicExamples.length === 0 && (
                    <div className="text-center text-slate-400 text-xs py-4 col-span-2 border-2 border-dashed rounded bg-slate-50/50">
                      {publicError ? <span className="text-red-400">{publicError}</span> : "目前沒有公用範本"}
                    </div>
                  )}

                  {publicExamples.map(ex => {
                    const isChecked = enabledPublicIds.includes(ex.id);
                    return (
                      <div key={ex.id} className={`border rounded-xl p-3 relative group transition-all ${isChecked ? 'bg-indigo-50/80 border-indigo-300 ring-1 ring-indigo-200' : 'bg-slate-50 border-slate-200 opacity-65'}`}>
                        <div className="flex justify-between items-center mb-2">
                          <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-indigo-950 truncate pr-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => togglePublicExample(ex.id)}
                              className="w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                            />
                            <span className="truncate">{ex.title}</span>
                            <span className="text-xs font-normal text-indigo-500 shrink-0">by {ex.author}</span>
                          </label>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => copyPublicToPrivate(ex)} className="p-1 bg-white rounded border text-indigo-600 hover:bg-indigo-50 text-xs flex items-center px-2" title="複製到私人範本編輯"><DownloadCloud className="w-3.5 h-3.5 mr-1"/>複製</button>
                            {user && (
                              <button
                                onClick={() => deletePublicExample(ex.id)}
                                disabled={deletingId === ex.id}
                                className={`p-1 bg-white rounded border transition-colors ${deletingId === ex.id ? 'text-red-200 cursor-wait' : 'text-slate-400 hover:text-red-500 hover:border-red-200'}`}
                                title="從公用庫刪除"
                              >
                                {deletingId === ex.id ? <Loader2 className="w-4 h-4 animate-spin text-red-500" /> : <Trash2 className="w-4 h-4" />}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 bg-white p-2 rounded line-clamp-3 font-mono whitespace-pre-wrap border border-indigo-100/60">{ex.output}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <hr/>

              {/* Private Lib */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="flex items-center text-sm font-bold text-slate-700">
                    <Lock className="w-4 h-4 mr-2 text-emerald-600"/> 私人範本庫 (打勾即可與公用範本同時納入 AI 參考)
                  </h4>
                  <span className="text-xs text-emerald-700 font-medium">已勾選 {activePrivate.length} / {privateExamples.length} 份</span>
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
                            title="勾選以啟用此私人範本"
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
                          <div className="text-[11px] font-semibold text-slate-400 mb-1">原始簡記 (Input 範例 - 選填)</div>
                          <textarea className="w-full h-32 p-2 text-xs border rounded bg-slate-50 resize-none font-mono outline-none focus:border-blue-400" value={ex.input} onChange={(e) => updatePrivateExample(ex.id, 'input', e.target.value)} placeholder="例如: 50yo M HTN chest pain since 2am..."/>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold text-emerald-700 mb-1">目標病歷格式 (Output 範例 - 必填，AI 會模仿此排版與用字)</div>
                          <textarea className="w-full h-32 p-2 text-xs border border-emerald-200 rounded bg-emerald-50/20 resize-none font-mono outline-none focus:border-emerald-500" value={ex.output} onChange={(e) => updatePrivateExample(ex.id, 'output', e.target.value)} placeholder="貼上妳希望 AI 模仿的完整 Admission Note 範例..."/>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button onClick={addPrivateExample} className="w-full py-2.5 border-2 border-dashed rounded-xl text-slate-500 text-sm hover:bg-slate-50 flex justify-center items-center font-medium"><FilePlus className="w-4 h-4 mr-2"/>新增私人範本</button>
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
                savePrivateSettings(privateExamples, userApiKey, e.target.value, customModelName, enabledPublicIds);
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
                  savePrivateSettings(privateExamples, userApiKey, selectedModel, e.target.value, enabledPublicIds);
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
            <span className="hidden sm:inline">設定 & 範本庫</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 grid lg:grid-cols-2 gap-6">
        {/* Left: Input Panel */}
        <div className="flex flex-col bg-white rounded-xl shadow-sm border overflow-visible h-[calc(100vh-6rem)] relative">
          {/* 控制列：科別 + 跨庫範本多選彈出選單 */}
          <div className="p-3 border-b bg-slate-50 flex flex-wrap gap-2 justify-between items-center rounded-t-xl">
            <h2 className="font-semibold text-sm flex items-center shrink-0">
              <FileText className="w-4 h-4 mr-1.5 text-blue-600"/> 臨床簡記輸入
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              {/* ★ 跨庫範本自由多選器 (Popover) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTemplatePicker(prev => !prev)}
                  className="flex items-center bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 rounded-lg px-2.5 py-1 text-xs font-medium text-emerald-900 transition-colors"
                >
                  <BookOpen className="w-3.5 h-3.5 text-emerald-600 mr-1.5 shrink-0"/>
                  <span>
                    已選範本：{allActive.length} 份 (私人 {activePrivate.length} / 公用 {activePublic.length})
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 ml-1.5 text-emerald-600"/>
                </button>

                {showTemplatePicker && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setShowTemplatePicker(false)} />
                    <div className="absolute right-0 mt-1.5 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-slate-200 z-30 p-3 space-y-3 max-h-[70vh] flex flex-col">
                      <div className="flex items-center justify-between border-b pb-2">
                        <span className="text-xs font-bold text-slate-700">勾選要同時參考的範本 (無上限)</span>
                        <button onClick={() => setShowTemplatePicker(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4"/></button>
                      </div>

                      {/* 快速全選按鈕列 */}
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={selectAllTemplates} className="px-2 py-1 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">全選全部</button>
                        <button onClick={selectOnlyPrivate} className="px-2 py-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded">全選私人</button>
                        <button onClick={selectOnlyPublic} className="px-2 py-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded">全選公用</button>
                        <button onClick={clearAllTemplates} className="px-2 py-1 text-[11px] bg-red-50 hover:bg-red-100 text-red-600 rounded">全部取消</button>
                      </div>

                      <div className="overflow-y-auto space-y-3 pr-1 flex-1">
                        {/* 私人範本區 */}
                        <div>
                          <div className="text-[11px] font-bold text-emerald-700 mb-1.5 flex items-center">
                            <Lock className="w-3 h-3 mr-1"/> 私人範本 ({activePrivate.length}/{privateExamples.length})
                          </div>
                          <div className="space-y-1">
                            {privateExamples.map(ex => {
                              const isValid = Boolean(ex.output && ex.output.trim());
                              return (
                                <label key={ex.id} className={`flex items-center gap-2 p-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${ex.isEnabled !== false ? 'bg-emerald-50/70 border-emerald-200 font-medium text-slate-800' : 'bg-white border-slate-100 text-slate-500'}`}>
                                  <input
                                    type="checkbox"
                                    checked={ex.isEnabled !== false}
                                    onChange={(e) => updatePrivateExample(ex.id, 'isEnabled', e.target.checked)}
                                    className="w-3.5 h-3.5 accent-emerald-600 rounded cursor-pointer shrink-0"
                                  />
                                  <span className="truncate flex-1">{ex.title}</span>
                                  {!isValid && <span className="text-[10px] text-amber-600 bg-amber-50 px-1 rounded shrink-0">無內容</span>}
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* 公用範本區 */}
                        <div>
                          <div className="text-[11px] font-bold text-indigo-700 mb-1.5 flex items-center">
                            <Globe className="w-3 h-3 mr-1"/> 公用範本 ({activePublic.length}/{publicExamples.length})
                          </div>
                          {publicExamples.length === 0 ? (
                            <div className="text-xs text-slate-400 py-2 text-center border border-dashed rounded">
                              {user ? "目前無公用範本" : "請先於設定中登入 Google 以載入公用範本"}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {publicExamples.map(ex => {
                                const isChecked = enabledPublicIds.includes(ex.id);
                                return (
                                  <label key={ex.id} className={`flex items-center gap-2 p-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${isChecked ? 'bg-indigo-50/70 border-indigo-200 font-medium text-slate-800' : 'bg-white border-slate-100 text-slate-500'}`}>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => togglePublicExample(ex.id)}
                                      className="w-3.5 h-3.5 accent-indigo-600 rounded cursor-pointer shrink-0"
                                    />
                                    <span className="truncate flex-1">{ex.title}</span>
                                    <span className="text-[10px] text-indigo-400 shrink-0">by {ex.author}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 border-t flex justify-between items-center">
                        <button onClick={() => { setShowTemplatePicker(false); setShowSettings(true); }} className="text-xs text-blue-600 hover:underline">
                          管理 / 新增範本內容...
                        </button>
                        <button onClick={() => setShowTemplatePicker(false)} className="px-3 py-1 bg-slate-800 text-white text-xs rounded-lg">
                          確定
                        </button>
                      </div>
                    </div>
                  </>
                )}
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

          <div className="p-3 bg-slate-50 border-t flex items-center justify-between gap-3 rounded-b-xl">
            <div className="text-xs text-slate-500 truncate">
              模型：<span className="font-mono font-semibold text-slate-700">{effectiveModel}</span> ｜ 同時參考：<span className="font-semibold text-emerald-700">私人 {activePrivate.length} + 公用 {activePublic.length} (共 {allActive.length} 份)</span>
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