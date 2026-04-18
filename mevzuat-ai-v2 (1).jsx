import { useState, useRef, useEffect } from "react";

const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `Sen Türk vergi ve muhasebe mevzuatında uzman bir yapay zeka asistanısın. Adın MEVZUAT AI.

Her soruya yanıt verirken:
1. Önce ilgili mevzuatı web aramasıyla gib.gov.tr veya mevzuat.gov.tr'den kontrol et
2. Yanıtını kanun/tebliğ/sirküler madde numaralarıyla destekle (ör: GVK md. 40/1, VUK md. 229)
3. Güncel tarihler, oranlar ve had tutarları belirt
4. Hesaplama gereken yerlerde adım adım göster
5. Her zaman Türkçe yanıt ver
6. Yanıtlarını profesyonel ama anlaşılır bir dille yaz

Başvurman gereken başlıca mevzuat:
- 213 Sayılı VUK (Vergi Usul Kanunu)
- 193 Sayılı GVK (Gelir Vergisi Kanunu)
- 5520 Sayılı KVK (Kurumlar Vergisi Kanunu)
- 3065 Sayılı KDVK (KDV Kanunu)
- 488 Sayılı DVK (Damga Vergisi Kanunu)
- GİB Genel Tebliğleri ve Sirkülerleri
- TFRS / MSUGT / Tek Düzen Hesap Planı`;

const MUHASEBE_PROMPT = `Sen Türk muhasebe standartları ve tek düzen hesap planı uzmanısın.

Kullanıcının anlattığı işleme göre:
1. Yevmiye kaydını oluştur (borç/alacak, hesap kodu ve adı)
2. Kullandığın hesap kodlarını açıkla (Tek Düzen Hesap Planı)
3. Hangi mevzuat veya standarda dayandığını belirt (VUK, TFRS, MSUGT)
4. Dikkat edilmesi gereken özel durumları belirt

YEVMIYE KAYDINI MUTLAKA şu JSON formatında ver, sonra açıklama yaz:
{"entries":[{"hesapKodu":"100","hesapAdi":"Kasa","tip":"B","tutar":1000},{"hesapKodu":"600","hesapAdi":"Yurt İçi Satışlar","tip":"A","tutar":1000}],"aciklama":"Nakit satış kaydı"}

B=Borç, A=Alacak. Tüm response Türkçe olsun.`;

const TASDIK_PROMPT = `Sen Türk vergi mevzuatında uzman bir YMM (Yeminli Mali Müşavir) asistanısın. Tam Tasdik Raporu incelemeleri konusunda uzmansın.

Kullanıcının sorduğu konu veya verdiği veri için:
1. İlgili tam tasdik kontrol noktalarını listele
2. Risk alanlarını belirt
3. Mevzuat referanslarını ver (tebliğ, madde numarası)
4. Varsa gerekli düzeltme önerilerini sun

Başvurman gereken:
- SM, SMMM ve YMM Kanunu (3568)
- YMM Tam Tasdik Tebliğleri
- Kurumlar Vergisi Beyannamesi kontrol noktaları
- KDV iade tasdik kriterleri
- Transfer fiyatlandırması dokümantasyon gereklilikleri

Her zaman Türkçe yanıt ver, profesyonel YMM dili kullan.`;

// ─── UTILS ───────────────────────────────────────────────────────────────────
function fmt(n) {
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}
function parseNum(s) {
  const clean = String(s).replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

// ─── HESAPLAMA ARAÇLARI ───────────────────────────────────────────────────────

function KDVHesaplama() {
  const [tutar, setTutar] = useState("");
  const [oran, setOran] = useState("20");
  const [mode, setMode] = useState("haric");
  const [result, setResult] = useState(null);
  const hesapla = () => {
    const t = parseNum(tutar); if (!t) return;
    const r = parseInt(oran) / 100;
    if (mode === "haric") setResult({ matrah: t, kdv: t * r, toplam: t + t * r });
    else { const m = t / (1 + r); setResult({ matrah: m, kdv: t - m, toplam: t }); }
  };
  return (
    <CalcCard title="KDV Hesaplama" note="KDVK md. 28 — Oranlar: %1, %10, %20">
      <Field label="Tutar (₺)"><input style={S.input} value={tutar} onChange={e => setTutar(e.target.value)} placeholder="0,00" /></Field>
      <Field label="KDV Oranı">
        <select style={S.select} value={oran} onChange={e => setOran(e.target.value)}>
          {["1","10","20"].map(v => <option key={v} value={v}>%{v}</option>)}
        </select>
      </Field>
      <Field label="Tutar türü">
        <div style={S.radioGroup}>
          {[["haric","KDV Hariç"],["dahil","KDV Dahil"]].map(([v,l]) => (
            <label key={v} style={S.radio}><input type="radio" checked={mode===v} onChange={()=>setMode(v)} style={{accentColor:"#c9a227"}} />{l}</label>
          ))}
        </div>
      </Field>
      <button style={S.btn} onClick={hesapla}>Hesapla</button>
      {result && <ResultBox rows={[["Matrah", `₺${fmt(result.matrah)}`],[`KDV (%${oran})`, `₺${fmt(result.kdv)}`],["Toplam", `₺${fmt(result.toplam)}`, true]]} />}
    </CalcCard>
  );
}

const GV_BRACKETS = [
  {from:0,to:110000,rate:15},{from:110000,to:230000,rate:20},
  {from:230000,to:870000,rate:27},{from:870000,to:3000000,rate:35},{from:3000000,to:Infinity,rate:40}
];
function GelirVergisi() {
  const [gelir, setGelir] = useState("");
  const [result, setResult] = useState(null);
  const hesapla = () => {
    const g = parseNum(gelir); if (!g) return;
    let vergi = 0; let breakdown = [];
    for (const b of GV_BRACKETS) {
      if (g <= b.from) break;
      const taxable = Math.min(g, b.to === Infinity ? g : b.to) - b.from;
      const tax = taxable * b.rate / 100;
      vergi += tax;
      breakdown.push({ ...b, taxable, tax });
    }
    setResult({ g, vergi, net: g - vergi, eff: (vergi / g * 100).toFixed(2), breakdown });
  };
  return (
    <CalcCard title="Gelir Vergisi" note="GVK md. 103 — 2024 tarifeleri (gösterge)">
      <Field label="Yıllık Vergi Matrahı (₺)"><input style={S.input} value={gelir} onChange={e=>setGelir(e.target.value)} placeholder="0" /></Field>
      <button style={S.btn} onClick={hesapla}>Hesapla</button>
      {result && (
        <div style={S.resultBox}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",marginBottom:12,fontSize:12}}>
              <thead><tr style={{borderBottom:"1px solid #e8e0d0"}}>
                {["Dilim","Oran","Matrah","Vergi"].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>{result.breakdown.map((b,i)=>(
                <tr key={i} style={{borderBottom:"1px solid #f5efe5"}}>
                  <td style={S.td}>₺{fmt(b.from)}–{b.to===Infinity?"∞":"₺"+fmt(b.to)}</td>
                  <td style={S.td}>%{b.rate}</td>
                  <td style={S.td}>₺{fmt(b.taxable)}</td>
                  <td style={S.td}>₺{fmt(b.tax)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <ResultBox rows={[["Toplam Vergi",`₺${fmt(result.vergi)}`,true],["Efektif Oran",`%${result.eff}`],["Net Gelir",`₺${fmt(result.net)}`]]} />
        </div>
      )}
    </CalcCard>
  );
}

function KurumlarVergisi() {
  const [kazanc, setKazanc] = useState("");
  const [tip, setTip] = useState("normal");
  const [result, setResult] = useState(null);
  const ORANLAR = {
    normal:{label:"Normal Oran",oran:25,kanun:"KVK md. 32"},
    ihracat:{label:"İhracat Kazancı (3 puan indirim)",oran:22,kanun:"KVK md. 32/7"},
    gkkb:{label:"Girişim Sermayesi (GKKB)",oran:20,kanun:"KVK md. 32/A"},
  };
  const hesapla = () => {
    const k = parseNum(kazanc); if (!k) return;
    const bilgi = ORANLAR[tip];
    const vergi = k * bilgi.oran / 100;
    setResult({ kazanc:k, vergi, net:k-vergi, ...bilgi });
  };
  return (
    <CalcCard title="Kurumlar Vergisi" note="5520 Sayılı KVK — Genel oran %25 (2023+)">
      <Field label="Kurum Kazancı (₺)"><input style={S.input} value={kazanc} onChange={e=>setKazanc(e.target.value)} placeholder="0" /></Field>
      <Field label="Vergilendirme Türü">
        <select style={S.select} value={tip} onChange={e=>setTip(e.target.value)}>
          {Object.entries(ORANLAR).map(([k,v])=><option key={k} value={k}>{v.label} (%{v.oran})</option>)}
        </select>
      </Field>
      <button style={S.btn} onClick={hesapla}>Hesapla</button>
      {result && <ResultBox kanun={result.kanun} rows={[["Kurum Kazancı",`₺${fmt(result.kazanc)}`],[`Kurumlar Vergisi (%${result.oran})`,`₺${fmt(result.vergi)}`],["Vergiden Sonraki Kazanç",`₺${fmt(result.net)}`,true]]} />}
    </CalcCard>
  );
}

const STOPAJ_TYPES = {
  kira:{label:"Kira Ödemesi",oran:20,kanun:"GVK md. 94/5-a"},
  sm:{label:"Serbest Meslek Makbuzu",oran:20,kanun:"GVK md. 94/2"},
  temettu:{label:"Temettü / Kâr Payı",oran:10,kanun:"GVK md. 94/6-b"},
  insaat:{label:"İnşaat ve Onarım",oran:3,kanun:"GVK md. 94/3"},
  zirai:{label:"Zirai Ürün Bedeli",oran:4,kanun:"GVK md. 94/11"},
  reklam:{label:"Reklam Gideri",oran:15,kanun:"GVK md. 94/13"},
};
function Stopaj() {
  const [tutar, setTutar] = useState("");
  const [tip, setTip] = useState("kira");
  const [result, setResult] = useState(null);
  const hesapla = () => {
    const t = parseNum(tutar); if (!t) return;
    const b = STOPAJ_TYPES[tip];
    const stopaj = t * b.oran / 100;
    setResult({ tutar:t, stopaj, net:t-stopaj, ...b });
  };
  return (
    <CalcCard title="Stopaj Hesaplama" note="GVK md. 94 — Tevkifat oranları ödeme türüne göre">
      <Field label="Ödeme Türü">
        <select style={S.select} value={tip} onChange={e=>setTip(e.target.value)}>
          {Object.entries(STOPAJ_TYPES).map(([k,v])=><option key={k} value={k}>{v.label} (%{v.oran})</option>)}
        </select>
      </Field>
      <Field label="Brüt Tutar (₺)"><input style={S.input} value={tutar} onChange={e=>setTutar(e.target.value)} placeholder="0,00" /></Field>
      <button style={S.btn} onClick={hesapla}>Hesapla</button>
      {result && <ResultBox kanun={result.kanun} rows={[["Brüt Tutar",`₺${fmt(result.tutar)}`],[`Stopaj (%${result.oran})`,`₺${fmt(result.stopaj)}`],["Net Ödeme",`₺${fmt(result.net)}`,true]]} />}
    </CalcCard>
  );
}

function GecikmeHesaplama() {
  const [vergi, setVergi] = useState("");
  const [gun, setGun] = useState("");
  const [result, setResult] = useState(null);
  const AYLIK = 4.5;
  const hesapla = () => {
    const v = parseNum(vergi); const g = parseInt(gun);
    if (!v || !g) return;
    const faiz = v * (AYLIK / 100 / 30) * g;
    setResult({ vergi:v, gun:g, faiz, toplam:v+faiz });
  };
  return (
    <CalcCard title="Gecikme Faizi" note={`VUK md. 112 — Aylık %${AYLIK} (güncel oran için Cumhurbaşkanı kararını kontrol edin)`}>
      <Field label="Vergi Aslı (₺)"><input style={S.input} value={vergi} onChange={e=>setVergi(e.target.value)} placeholder="0,00" /></Field>
      <Field label="Gecikme Süresi (Gün)"><input style={S.input} type="number" value={gun} onChange={e=>setGun(e.target.value)} placeholder="0" /></Field>
      <button style={S.btn} onClick={hesapla}>Hesapla</button>
      {result && <ResultBox rows={[["Vergi Aslı",`₺${fmt(result.vergi)}`],[`Gecikme Faizi (%${AYLIK}/ay × ${result.gun}g)`,`₺${fmt(result.faiz)}`],["Toplam Borç",`₺${fmt(result.toplam)}`,true]]} />}
    </CalcCard>
  );
}

const DV_TYPES = {
  sozlesme: { label: "Belli Para İçeren Sözleşme", oran: 0.00948, kanun: "DVK (1) Sayılı Tablo" },
  kira: { label: "Kira Sözleşmesi (Toplam Kira)", oran: 0.00189, kanun: "DVK (1) Sayılı Tablo" },
  ihale: { label: "İhale Kararı", oran: 0.00569, kanun: "DVK (2) Sayılı Tablo" },
  teminat: { label: "Teminat Mektubu", oran: 0.00948, kanun: "DVK (1) Sayılı Tablo" },
};
function DamgaVergisi() {
  const [tutar, setTutar] = useState("");
  const [tip, setTip] = useState("sozlesme");
  const [result, setResult] = useState(null);
  const hesapla = () => {
    const t = parseNum(tutar); if (!t) return;
    const b = DV_TYPES[tip];
    const vergi = t * b.oran;
    setResult({ tutar:t, vergi, ...b, oranPct: (b.oran*100).toFixed(4) });
  };
  return (
    <CalcCard title="Damga Vergisi" note="488 Sayılı Damga Vergisi Kanunu">
      <Field label="İşlem Türü">
        <select style={S.select} value={tip} onChange={e=>setTip(e.target.value)}>
          {Object.entries(DV_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
      </Field>
      <Field label="İşlem Tutarı (₺)"><input style={S.input} value={tutar} onChange={e=>setTutar(e.target.value)} placeholder="0,00" /></Field>
      <button style={S.btn} onClick={hesapla}>Hesapla</button>
      {result && <ResultBox kanun={result.kanun} rows={[["İşlem Tutarı",`₺${fmt(result.tutar)}`],[`Oran (‰${(result.oran*1000).toFixed(3)})`,""],[`Damga Vergisi`,`₺${fmt(result.vergi)}`,true]]} />}
    </CalcCard>
  );
}

function Amortisman() {
  const [deger, setDeger] = useState("");
  const [omur, setOmur] = useState("");
  const [yontem, setYontem] = useState("normal");
  const [oran, setOran] = useState("");
  const [result, setResult] = useState(null);

  const hesapla = () => {
    const d = parseNum(deger);
    const y = parseInt(omur) || 5;
    if (!d) return;
    const normalOran = 1 / y;
    const azalır = parseNum(oran) / 100 || normalOran * 2;
    let rows = [];
    if (yontem === "normal") {
      const yillikAm = d * normalOran;
      for (let i = 1; i <= y; i++) rows.push({ yil: i, amort: yillikAm, birikim: yillikAm * i, netDeger: d - yillikAm * i });
    } else {
      let kalan = d;
      for (let i = 1; i <= y; i++) {
        const am = Math.min(kalan, kalan * azalır);
        kalan -= am;
        rows.push({ yil: i, amort: am, birikim: d - kalan, netDeger: kalan });
        if (kalan <= 0) break;
      }
    }
    setResult({ d, rows, yontem, y, normalOran: (normalOran * 100).toFixed(2) });
  };

  return (
    <CalcCard title="Amortisman Hesaplama" note="VUK md. 313-321 — Normal ve Azalan Bakiyeler Yöntemi">
      <Field label="Varlık Değeri (₺)"><input style={S.input} value={deger} onChange={e=>setDeger(e.target.value)} placeholder="0,00" /></Field>
      <Field label="Faydalı Ömür (Yıl)"><input style={S.input} type="number" value={omur} onChange={e=>setOmur(e.target.value)} placeholder="5" /></Field>
      <Field label="Amortisman Yöntemi">
        <select style={S.select} value={yontem} onChange={e=>setYontem(e.target.value)}>
          <option value="normal">Normal Amortisman (Doğrusal)</option>
          <option value="azalan">Azalan Bakiyeler</option>
        </select>
      </Field>
      {yontem === "azalan" && (
        <Field label="Azalan Bakiyeler Oranı (%)">
          <input style={S.input} value={oran} onChange={e=>setOran(e.target.value)} placeholder={omur ? `${((2/parseInt(omur||5))*100).toFixed(0)} (2× normal)` : "40"} />
        </Field>
      )}
      <button style={S.btn} onClick={hesapla}>Hesapla</button>
      {result && (
        <div style={S.resultBox}>
          <div style={{fontSize:12,color:"#8a7e6b",marginBottom:10}}>
            Normal oran: %{result.normalOran} — VUK md. 315
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{borderBottom:"1px solid #e8e0d0"}}>
                {["Yıl","Yıllık Amortisman","Birikmiş","Net Defter Değeri"].map(h=><th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>{result.rows.map((r,i)=>(
                <tr key={i} style={{borderBottom:"1px solid #f5efe5"}}>
                  <td style={S.td}>{r.yil}</td>
                  <td style={S.td}>₺{fmt(r.amort)}</td>
                  <td style={S.td}>₺{fmt(r.birikim)}</td>
                  <td style={S.td}>₺{fmt(r.netDeger)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </CalcCard>
  );
}

// ─── MUHASEBE KAYITLARI ───────────────────────────────────────────────────────
function MuhasebeKayitlari() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const taRef = useRef(null);

  const adjustHeight = () => {
    const ta = taRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; }
  };

  const kayitOlustur = async () => {
    if (!input.trim() || loading) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1000,
          system: MUHASEBE_PROMPT,
          messages: [{ role: "user", content: input }],
        }),
      });
      const data = await res.json();
      const text = (data.content || []).map(b => b.type === "text" ? b.text : "").join("\n");
      let entries = null, aciklama = "", rest = text;
      try {
        const match = text.match(/\{[\s\S]*?"entries"[\s\S]*?\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          entries = parsed.entries;
          aciklama = parsed.aciklama || "";
          rest = text.replace(match[0], "").trim();
        }
      } catch {}
      setResult({ entries, aciklama, text: rest });
    } catch { setResult({ text: "Bir hata oluştu. Lütfen tekrar deneyin." }); }
    setLoading(false);
  };

  const EXAMPLES = [
    "100.000 ₺ bedelinde bir araç peşin satın aldık",
    "Kira geliri tahsil ettik, 20.000 ₺ + KDV",
    "500.000 ₺ tutarında mal aldık, 3 ay vadeli",
    "Çalışana 15.000 ₺ brüt maaş ödedik",
    "5 yıl kullanım hakkı karşılığı 60.000 ₺ ön ödeme yapıldı (UFRS 16)",
  ];

  return (
    <div style={{ padding: 20, maxWidth: 700 }}>
      <h2 style={S.pageTitle}>Muhasebe Kaydı Oluştur</h2>
      <p style={S.pageDesc}>İşleminizi açıklayın — Tek Düzen Hesap Planı'na göre yevmiye kaydını oluşturayım.</p>

      <div style={{marginBottom:16}}>
        <div style={{fontSize:12,color:"#8a7e6b",marginBottom:8,fontWeight:500}}>ÖRNEK İŞLEMLER</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
          {EXAMPLES.map(e => (
            <button key={e} onClick={() => setInput(e)} style={S.exBtn}>{e}</button>
          ))}
        </div>
      </div>

      <div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 5px rgba(0,0,0,0.06)",border:"1px solid #e8e0d0"}}>
        <textarea ref={taRef} style={{...S.input,width:"100%",minHeight:80,resize:"none",border:"none",padding:0,fontSize:14,background:"transparent"}}
          value={input} onChange={e=>{setInput(e.target.value);adjustHeight();}}
          placeholder="İşlemi açıklayın... (ör: 50.000 ₺ + %20 KDV tutarında mal sattık, müşteri çek verdi)" />
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}>
          <button style={{...S.btn,opacity:loading||!input.trim()?0.4:1}} onClick={kayitOlustur} disabled={loading||!input.trim()}>
            {loading ? "⏳ Oluşturuluyor..." : "Kayıt Oluştur →"}
          </button>
        </div>
      </div>

      {result && (
        <div style={{marginTop:20}}>
          {result.entries && (
            <div style={{background:"#fff",borderRadius:12,padding:20,border:"1px solid #e8e0d0",marginBottom:14}}>
              <div style={{fontSize:12,fontWeight:600,color:"#8a7e6b",letterSpacing:0.8,textTransform:"uppercase",marginBottom:12}}>
                📒 Yevmiye Kaydı — {result.aciklama}
              </div>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr style={{borderBottom:"2px solid #e8e0d0"}}>
                  {["Hesap Kodu","Hesap Adı","Borç","Alacak"].map(h=><th key={h} style={{...S.th,padding:"6px 10px"}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {result.entries.map((e,i) => (
                    <tr key={i} style={{borderBottom:"1px solid #f5efe5"}}>
                      <td style={{...S.td,fontFamily:"monospace",color:"#b8860b"}}>{e.hesapKodu}</td>
                      <td style={{...S.td,paddingLeft: e.tip==="A"?24:8}}>{e.hesapAdi}</td>
                      <td style={{...S.td,color: e.tip==="B"?"#1a3a2a":"#9ca3af",fontWeight:e.tip==="B"?600:400}}>
                        {e.tip === "B" ? `₺${fmt(e.tutar)}` : "—"}
                      </td>
                      <td style={{...S.td,color: e.tip==="A"?"#7c1d1d":"#9ca3af",fontWeight:e.tip==="A"?600:400}}>
                        {e.tip === "A" ? `₺${fmt(e.tutar)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.text && (
            <div style={{background:"#fff",borderRadius:12,padding:20,border:"1px solid #e8e0d0",fontSize:13.5,lineHeight:1.8,color:"#374151",whiteSpace:"pre-wrap"}}>
              {result.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TAM TASDİK ───────────────────────────────────────────────────────────────
function TamTasdik() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    const history = [...messages, { role: "user", content: msg }];
    setMessages(history); setInput(""); setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1000,
          system: TASDIK_PROMPT,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: history,
        }),
      });
      const data = await res.json();
      const resp = (data.content || []).map(b => b.type === "text" ? b.text : "").filter(Boolean).join("\n");
      setMessages(prev => [...prev, { role: "assistant", content: resp || "Yanıt alınamadı." }]);
    } catch { setMessages(prev => [...prev, { role: "assistant", content: "Hata oluştu." }]); }
    setLoading(false);
  };

  const TOPICS = [
    "KDV iade tasdik raporunda hangi belgeler gerekli?",
    "Transfer fiyatlandırması dokümantasyon yükümlülükleri",
    "Kurumlar vergisi beyannamesi tam tasdik kontrol listesi",
    "Örtülü sermaye hesabında dikkat edilecek noktalar",
    "YMM bağımsızlık ilkeleri ve sorumluluk sınırları",
    "İhracat istisnası tasdik kriterleri",
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
      <div style={{flex:1,overflowY:"auto",padding:"20px 22px",display:"flex",flexDirection:"column",gap:12}}>
        {messages.length === 0 && (
          <div style={S.empty}>
            <div style={{fontSize:40,marginBottom:12}}>📋</div>
            <h2 style={S.emptyTitle}>Tam Tasdik Danışmanı</h2>
            <p style={S.emptyText}>YMM tam tasdik raporu süreçleri, KDV iade tasdiki, kontrol noktaları ve risk analizi için sorularınızı yanıtlarım.</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center",maxWidth:580}}>
              {TOPICS.map(t => <button key={t} style={S.suggestion} onClick={() => send(t)}>{t}</button>)}
            </div>
          </div>
        )}
        {messages.map((m,i) => (
          <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
            {m.role==="assistant" && <div style={S.avatar}>YMM</div>}
            <div style={m.role==="user" ? S.userBubble : S.aiBubble}>
              <div style={{whiteSpace:"pre-wrap",lineHeight:1.75}}>{m.content}</div>
            </div>
          </div>
        ))}
        {loading && <div style={{display:"flex",gap:8}}><div style={{...S.avatar,fontSize:9}}>YMM</div><div style={S.aiBubble}><div style={S.typing}>{[0,.18,.36].map((d,i)=><span key={i} style={{...S.dot,animationDelay:`${d}s`}} />)}</div></div></div>}
        <div ref={bottomRef} />
      </div>
      <div style={S.inputWrap}>
        <textarea style={S.textarea} value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder="Tam tasdik, KDV iade veya YMM konularında soru sorun..." rows={1} />
        <button style={{...S.sendBtn,opacity:loading||!input.trim()?0.4:1}} onClick={()=>send()} disabled={loading||!input.trim()}>↑</button>
      </div>
    </div>
  );
}

// ─── CHAT DANIŞMAN ────────────────────────────────────────────────────────────
function ChatPanel() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const adjustHeight = () => {
    const ta = taRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 130) + "px"; }
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input.trim() };
    const history = [...messages, userMsg];
    setMessages(history); setInput("");
    setTimeout(() => { if (taRef.current) taRef.current.style.height = "44px"; }, 0);
    setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1000,
          system: SYSTEM_PROMPT,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: history.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const text = (data.content || []).map(b => b.type === "text" ? b.text : "").filter(Boolean).join("\n");
      const searched = (data.content || []).some(b => b.type === "tool_use");
      setMessages(prev => [...prev, { role: "assistant", content: text || "Yanıt alınamadı.", searched }]);
    } catch { setMessages(prev => [...prev, { role: "assistant", content: "Bir hata oluştu.", searched: false }]); }
    setLoading(false);
  };

  const SUGGESTIONS = [
    "KDV indiriminin koşulları nelerdir?", "Örtülü sermaye nasıl hesaplanır?",
    "E-fatura zorunluluğu kimleri kapsar?", "Kıdem tazminatı muhasebe kaydı",
    "Transfer fiyatlandırması belgesi ne zaman gerekli?", "KV istisnaları nelerdir?",
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
      <div style={{flex:1,overflowY:"auto",padding:"20px 22px",display:"flex",flexDirection:"column",gap:12}}>
        {messages.length === 0 && (
          <div style={S.empty}>
            <div style={{fontSize:40,marginBottom:12}}>⚖️</div>
            <h2 style={S.emptyTitle}>Vergi & Muhasebe Danışmanı</h2>
            <p style={S.emptyText}>Vergi mevzuatı, muhasebe standartları veya mali hesaplama konularında soru sorun. GİB'den güncel mevzuatı referans alarak yanıt vereceğim.</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center",maxWidth:560}}>
              {SUGGESTIONS.map(sug=><button key={sug} style={S.suggestion} onClick={()=>setInput(sug)}>{sug}</button>)}
            </div>
          </div>
        )}
        {messages.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
            {m.role==="assistant" && <div style={S.avatar}>M</div>}
            <div style={m.role==="user"?S.userBubble:S.aiBubble}>
              {m.searched && <div style={S.searchBadge}>🔍 GİB mevzuatı araştırıldı</div>}
              <div style={{whiteSpace:"pre-wrap",lineHeight:1.75}}>{m.content}</div>
            </div>
          </div>
        ))}
        {loading && (
          <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
            <div style={S.avatar}>M</div>
            <div style={S.aiBubble}><div style={S.typing}>{[0,.18,.36].map((d,i)=><span key={i} style={{...S.dot,animationDelay:`${d}s`}} />)}</div></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={S.inputWrap}>
        <textarea ref={taRef} style={S.textarea} value={input}
          onChange={e=>{setInput(e.target.value);adjustHeight();}}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder="Vergi veya muhasebe sorunuzu yazın..." rows={1} />
        <button style={{...S.sendBtn,opacity:loading||!input.trim()?0.4:1}} onClick={send} disabled={loading||!input.trim()}>↑</button>
      </div>
    </div>
  );
}

// ─── HESAPLAMA ARAÇLARI SEKME ─────────────────────────────────────────────────
const CALCS = [
  {id:"kdv",label:"KDV",comp:KDVHesaplama},
  {id:"gv",label:"Gelir V.",comp:GelirVergisi},
  {id:"kv",label:"Kurumlar V.",comp:KurumlarVergisi},
  {id:"stopaj",label:"Stopaj",comp:Stopaj},
  {id:"gecikme",label:"Gecikme F.",comp:GecikmeHesaplama},
  {id:"damga",label:"Damga V.",comp:DamgaVergisi},
  {id:"amortisman",label:"Amortisman",comp:Amortisman},
];

function HesaplamaPanel() {
  const [calc, setCalc] = useState("kdv");
  const Comp = CALCS.find(c=>c.id===calc)?.comp || KDVHesaplama;
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid #e8e0d0",background:"#fff",display:"flex",gap:6,flexWrap:"wrap",flexShrink:0}}>
        {CALCS.map(c=>(
          <button key={c.id} onClick={()=>setCalc(c.id)}
            style={{padding:"5px 12px",borderRadius:6,background:calc===c.id?"#0f1623":"#f4efe5",
              color:calc===c.id?"#c9a227":"#6b6b6b",fontSize:12.5,fontWeight:500,border:"none",cursor:"pointer",transition:"all 0.13s"}}>
            {c.label}
          </button>
        ))}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:20}}>
        <Comp />
      </div>
    </div>
  );
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
function CalcCard({title,note,children}) {
  return (
    <div style={{background:"#fff",borderRadius:12,padding:"24px 22px",maxWidth:560,boxShadow:"0 1px 5px rgba(0,0,0,0.06)",border:"1px solid #ece4d6"}}>
      <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:21,fontWeight:600,color:"#1a1a2e",marginBottom:14}}>{title}</h3>
      <div style={{fontSize:12,color:"#8a7e6b",background:"#fffcf2",padding:"6px 10px",borderRadius:6,borderLeft:"3px solid #c9a227",marginBottom:16,lineHeight:1.5}}>{note}</div>
      {children}
    </div>
  );
}
function Field({label,children}) {
  return <div style={{marginBottom:13,display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:12.5,fontWeight:500,color:"#4b5563"}}>{label}</label>{children}</div>;
}
function ResultBox({rows,kanun}) {
  return (
    <div style={{marginTop:16,...S.resultBox}}>
      {rows.map(([l,v,total],i)=>v !== "" && (
        <div key={i} style={{...S.resultRow,...(total?S.resultRowTotal:{})}}><span>{l}</span><span>{v}</span></div>
      ))}
      {kanun && <div style={{fontSize:11,color:"#a09070",marginTop:6,textAlign:"right"}}>{kanun}</div>}
    </div>
  );
}

// ─── ANA UYGULAMA ─────────────────────────────────────────────────────────────
const NAV = [
  {id:"chat",icon:"💬",label:"Danışman"},
  {id:"hesap",icon:"🧮",label:"Hesaplama"},
  {id:"muhasebe",icon:"📒",label:"Muhasebe"},
  {id:"tasdik",icon:"📋",label:"Tam Tasdik"},
];

export default function App() {
  const [tab, setTab] = useState("chat");

  const renderContent = () => {
    if (tab === "chat") return <ChatPanel />;
    if (tab === "hesap") return <HesaplamaPanel />;
    if (tab === "muhasebe") return <MuhasebeKayitlari />;
    if (tab === "tasdik") return <TamTasdik />;
  };

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600&family=Cormorant+Garamond:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        textarea{resize:none;font-family:inherit;}
        button{cursor:pointer;border:none;background:none;font-family:inherit;}
        select,input{outline:none;font-family:inherit;}
        @keyframes pulse{0%,80%,100%{transform:scale(0.6);opacity:.4}40%{transform:scale(1);opacity:1}}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#d8d0c2;border-radius:4px}
        /* Desktop sidebar nav */
        @media(min-width:640px){
          .bottom-nav{display:none!important;}
          .sidebar{display:flex!important;}
        }
        /* Mobile bottom nav */
        @media(max-width:639px){
          .sidebar{display:none!important;}
          .bottom-nav{display:flex!important;}
          .main-content{padding-bottom:64px!important;}
        }
        .nav-item:hover{background:rgba(201,162,39,0.08)!important;color:#c9a227!important;}
        .sug:hover{background:#fffdf5!important;border-color:#d4b84e!important;}
        .ex-btn:hover{background:#fffdf5!important;border-color:#d4b84e!important;}
      `}</style>

      {/* Desktop Sidebar */}
      <aside className="sidebar" style={S.sidebar}>
        <div style={S.brand}>
          <span style={{fontSize:26,color:"#c9a227",lineHeight:1}}>⚖</span>
          <div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:17,fontWeight:600,color:"#fff",letterSpacing:2.5}}>MEVZUAT</div>
            <div style={{fontSize:9.5,color:"#4b5563",letterSpacing:1.2,textTransform:"uppercase",marginTop:1}}>AI Asistan</div>
          </div>
        </div>
        <nav style={{flex:1,display:"flex",flexDirection:"column",gap:3}}>
          {NAV.map(n=>(
            <button key={n.id} className="nav-item"
              style={{...S.navBtn,...(tab===n.id?S.navBtnActive:{})}}
              onClick={()=>setTab(n.id)}>
              <span style={{fontSize:16}}>{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div style={{paddingTop:14,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{fontSize:10,color:"#4b5563",letterSpacing:0.5,textTransform:"uppercase"}}>Kaynak</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>gib.gov.tr</div>
          <div style={{fontSize:11,color:"#6b7280"}}>mevzuat.gov.tr</div>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content" style={S.main}>
        {/* Header */}
        <header style={S.header}>
          <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,fontWeight:600,color:"#1a1a2e"}}>
            {NAV.find(n=>n.id===tab)?.icon} {NAV.find(n=>n.id===tab)?.label}
          </span>
        </header>
        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
          {renderContent()}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="bottom-nav" style={S.bottomNav}>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>setTab(n.id)}
            style={{...S.bottomNavItem,...(tab===n.id?S.bottomNavActive:{})}}>
            <span style={{fontSize:20}}>{n.icon}</span>
            <span style={{fontSize:10,marginTop:2}}>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  app:{display:"flex",height:"100vh",fontFamily:"'DM Sans',sans-serif",background:"#f4efe5",position:"relative"},
  sidebar:{width:200,background:"#0f1623",display:"flex",flexDirection:"column",padding:"20px 14px",flexShrink:0},
  brand:{display:"flex",alignItems:"center",gap:10,marginBottom:28,paddingBottom:20,borderBottom:"1px solid rgba(255,255,255,0.07)"},
  navBtn:{display:"flex",alignItems:"center",gap:9,padding:"9px 12px",borderRadius:7,color:"#6b7280",fontSize:13.5,fontWeight:500,width:"100%",textAlign:"left",transition:"all 0.13s"},
  navBtnActive:{background:"rgba(201,162,39,0.13)",color:"#c9a227"},
  main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0},
  header:{padding:"12px 20px",background:"#fff",borderBottom:"1px solid #e8e0d0",display:"flex",alignItems:"center",gap:10,flexShrink:0},
  bottomNav:{position:"fixed",bottom:0,left:0,right:0,background:"#0f1623",borderTop:"1px solid rgba(255,255,255,0.08)",zIndex:100,height:64,justifyContent:"space-around",alignItems:"center"},
  bottomNavItem:{display:"flex",flexDirection:"column",alignItems:"center",padding:"6px 12px",color:"#6b7280",fontSize:12,fontWeight:500,flex:1,transition:"color 0.13s"},
  bottomNavActive:{color:"#c9a227"},
  input:{padding:"9px 12px",borderRadius:7,border:"1px solid #e5e7eb",fontSize:14,color:"#1a1a2e",background:"#fafaf8"},
  select:{padding:"9px 12px",borderRadius:7,border:"1px solid #e5e7eb",fontSize:13.5,color:"#1a1a2e",background:"#fafaf8",cursor:"pointer",width:"100%"},
  radioGroup:{display:"flex",gap:18},
  radio:{fontSize:13,color:"#4b5563",display:"flex",alignItems:"center",gap:5,cursor:"pointer"},
  btn:{padding:"10px 20px",borderRadius:7,background:"#0f1623",color:"#c9a227",fontSize:13.5,fontWeight:600,letterSpacing:0.3,transition:"opacity 0.15s"},
  resultBox:{background:"#faf8f4",borderRadius:8,padding:"12px 16px",border:"1px solid #e8e0d0"},
  resultRow:{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:13.5,color:"#4b5563",borderBottom:"1px solid #f0e8d8"},
  resultRowTotal:{fontWeight:600,color:"#1a1a2e",fontSize:15,borderBottom:"none",paddingTop:10},
  th:{textAlign:"left",padding:"4px 6px",fontSize:11,fontWeight:600,color:"#8a7e6b",textTransform:"uppercase",letterSpacing:0.4,whiteSpace:"nowrap"},
  td:{padding:"6px 6px",fontSize:12.5,color:"#374151"},
  empty:{display:"flex",flexDirection:"column",alignItems:"center",padding:"40px 20px 20px",textAlign:"center"},
  emptyTitle:{fontFamily:"'Cormorant Garamond',serif",fontSize:23,fontWeight:600,color:"#1a1a2e",marginBottom:8},
  emptyText:{fontSize:13.5,color:"#6b7280",maxWidth:440,lineHeight:1.75,marginBottom:24},
  suggestion:{padding:"9px 13px",borderRadius:8,background:"#fff",border:"1px solid #e5e7eb",fontSize:12,color:"#374151",textAlign:"left",lineHeight:1.5,transition:"all 0.13s",cursor:"pointer"},
  avatar:{width:32,height:32,borderRadius:"50%",background:"#0f1623",color:"#c9a227",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,flexShrink:0,marginRight:8,marginTop:2},
  userBubble:{maxWidth:"75%",background:"#0f1623",color:"#f5f0e8",padding:"10px 15px",borderRadius:"16px 16px 4px 16px",fontSize:13.5,lineHeight:1.7},
  aiBubble:{maxWidth:"80%",background:"#fff",color:"#1a1a2e",padding:"12px 15px",borderRadius:"4px 16px 16px 16px",fontSize:13.5,border:"1px solid #ece4d6",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"},
  searchBadge:{fontSize:11,color:"#a07820",background:"#fffbee",padding:"2px 8px",borderRadius:4,marginBottom:8,display:"inline-block",border:"1px solid #e8d48a"},
  typing:{display:"flex",gap:5,alignItems:"center",padding:"4px 2px"},
  dot:{width:7,height:7,borderRadius:"50%",background:"#c9a227",display:"inline-block",animation:"pulse 1.4s ease-in-out infinite"},
  inputWrap:{padding:"12px 18px",borderTop:"1px solid #e8e0d0",background:"#fff",display:"flex",gap:9,alignItems:"flex-end",flexShrink:0},
  textarea:{flex:1,padding:"10px 14px",borderRadius:10,border:"1px solid #e0d8cc",fontSize:13.5,color:"#1a1a2e",background:"#fafaf8",lineHeight:1.6,minHeight:44,maxHeight:120,overflowY:"auto"},
  sendBtn:{width:40,height:40,borderRadius:"50%",background:"#0f1623",color:"#c9a227",fontSize:19,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"bold",flexShrink:0,transition:"opacity 0.15s",border:"none"},
  pageTitle:{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:600,color:"#1a1a2e",marginBottom:8},
  pageDesc:{fontSize:13.5,color:"#6b7280",marginBottom:18,lineHeight:1.6},
  exBtn:{padding:"7px 12px",borderRadius:7,background:"#fff",border:"1px solid #e5e7eb",fontSize:12,color:"#374151",lineHeight:1.4,transition:"all 0.13s",cursor:"pointer",textAlign:"left"},
};
