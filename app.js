import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const $ = id => document.getElementById(id);
const state = {
  files: [],
  pages: [],
  sort: "product",
  print: "a4-2",
  pdfjsReady: true
};

const courierNames = ["VALMO","DELHIVERY","XPRESSBEES","SHADOWFAX","EKART","E-COM EXPRESS","ECOM EXPRESS","BLUEDART","BLUE DART","DTDC","AMAZON SHIPPING"];

function message(text,type=""){
  $("message").className = "message" + (type ? " "+type : "");
  $("message").innerHTML = text;
}
function normalize(s){ return (s||"").replace(/\s+/g," ").trim(); }
function hashColor(str){
  let h=0; for(const c of (str||"Unknown")) h=(h*31+c.charCodeAt(0))>>>0;
  const palette=["#ff7f62","#efad52","#60a889","#6f90cf","#a77bc5","#df7c9f","#60a7ac","#99905c","#db7356","#7d9e65"];
  return palette[h%palette.length];
}
function countSwitches(items,key){
  let n=0,last=null;
  for(const it of items){ const v=it[key]||"Unknown"; if(last!==null && v!==last)n++; last=v; }
  return n;
}
function renderStrip(el,items,key){
  el.innerHTML="";
  for(const it of items){
    const seg=document.createElement("i");
    seg.style.background=hashColor(it[key]);
    seg.title=it[key]||"Unknown";
    el.appendChild(seg);
  }
}
function sortedPages(){
  const arr=[...state.pages];
  if(state.sort==="original") return arr;
  const key=state.sort;
  const counts={};
  if(key==="product") arr.forEach(p=>counts[p.product]=(counts[p.product]||0)+1);
  arr.sort((a,b)=>{
    if(key==="product"){
      const d=(counts[b.product]||0)-(counts[a.product]||0);
      if(d) return d;
    }
    return String(a[key]||"Unknown").localeCompare(String(b[key]||"Unknown"));
  });
  return arr;
}
function updatePacking(){
  const after=sortedPages();
  const key=state.sort==="original" ? "product" : state.sort;
  renderStrip($("beforeStrip"),state.pages,key);
  renderStrip($("afterStrip"),after,key);
  $("beforeSwitches").textContent=`${countSwitches(state.pages,key)} switches`;
  $("afterSwitches").textContent=`${countSwitches(after,key)} switches`;
}

function extractCourier(text){
  const upper=text.toUpperCase();
  for(const name of courierNames) if(upper.includes(name)) return name.replace("E-COM EXPRESS","ECOM EXPRESS");
  const m=upper.match(/(?:COURIER|LOGISTICS|PARTNER)\s*[:\-]?\s*([A-Z][A-Z ]{2,24})/);
  return m ? normalize(m[1]).slice(0,25) : "Other";
}
function extractPayment(text){
  const u=text.toUpperCase();
  if(/\b(COD|CASH ON DELIVERY|CASH-ON-DELIVERY)\b/.test(u)) return "COD";
  if(/\b(PREPAID|ONLINE PAYMENT|PAID)\b/.test(u)) return "Prepaid";
  return "Unknown";
}
function extractProduct(lines,text){
  const patterns=[
    /(?:SKU|SKU ID|PRODUCT SKU)\s*[:#\-]?\s*([A-Z0-9._\-\/]{2,40})/i,
    /(?:PRODUCT|ITEM|CATALOG)\s*(?:NAME|ID)?\s*[:#\-]\s*([A-Z0-9][A-Z0-9 ._\-\/]{2,45})/i
  ];
  for(const re of patterns){ const m=text.match(re); if(m) return normalize(m[1]).slice(0,45); }
  // Nearby line heuristic.
  for(let i=0;i<lines.length;i++){
    const t=lines[i].str||"";
    if(/\bSKU\b/i.test(t)){
      const same=t.split(/sku\s*(?:id)?\s*[:#\-]?/i)[1];
      if(same && normalize(same).length>1) return normalize(same).slice(0,45);
      if(lines[i+1]?.str) return normalize(lines[i+1].str).slice(0,45);
    }
  }
  return "Unknown product";
}
function detectBoundary(items,pageHeight,fallbackPct){
  // PDF.js text Y coordinates are measured upward from page bottom.
  // We only use the actual invoice heading, not GSTIN/HSN/etc inside the shipping label.
  const invoiceItems = items.filter(it=>{
    const t=normalize(it.str||"").toUpperCase();
    return (
      t === "TAX INVOICE" ||
      t.startsWith("TAX INVOICE ") ||
      t.includes("TAX INVOICE ORIGINAL FOR RECIPIENT") ||
      t === "SELLER INVOICE"
    ) && it.transform && Number.isFinite(it.transform[5]);
  });

  // Invoice must be in the lower/middle region, otherwise ignore it.
  const valid = invoiceItems
    .filter(it=>{
      const y=it.transform[5];
      return y < pageHeight*0.68 && y > pageHeight*0.08;
    })
    .sort((a,b)=>b.transform[5]-a.transform[5]);

  if(valid.length){
    const it=valid[0];
    const y=it.transform[5];
    const textH=Math.max(7, Number(it.height)||0);

    // Cut immediately ABOVE the TAX INVOICE text.
    // 1.5pt safety keeps the shipping-label bottom rule but removes invoice wording.
    const boundary = y + textH + 1.5;

    return Math.min(
      pageHeight*0.66,
      Math.max(pageHeight*0.30, boundary)
    );
  }

  // Fallback only when the actual invoice heading cannot be found.
  return pageHeight*(1-fallbackPct/100);
}
async function readPdfFile(file,fileIndex,totalFiles){
  const bytes=new Uint8Array(await file.arrayBuffer());
  const doc=await pdfjsLib.getDocument({data:bytes}).promise;
  for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i);
    const viewport=page.getViewport({scale:1});
    const tc=await page.getTextContent();
    const text=normalize(tc.items.map(x=>x.str).join(" "));
    const boundaryY=detectBoundary(tc.items,viewport.height,Number($("fallbackCrop").value));
    state.pages.push({
      sourceFileIndex:fileIndex,
      sourcePageIndex:i-1,
      orderIndex:state.pages.length,
      width:viewport.width,
      height:viewport.height,
      boundaryY,
      product:extractProduct(tc.items,text),
      courier:extractCourier(text),
      payment:extractPayment(text),
      text
    });
    const done=(fileIndex + (i/doc.numPages))/totalFiles;
    $("progressBar").style.width=`${Math.round(done*100)}%`;
    $("readingPct").textContent=`${Math.round(done*100)}%`;
    $("readingText").textContent=`Reading ${file.name} · page ${i}/${doc.numPages}`;
  }
}
async function loadFiles(fileList,append=false){
  const files=Array.from(fileList||[]).filter(f=>/\.pdf$/i.test(f.name));
  if(!files.length) return;
  if(!window.PDFLib){ alert("PDF engine is still loading. Please try again in a moment."); return; }

  if(!append){ state.files=[]; state.pages=[]; }
  const startIndex=state.files.length;
  state.files.push(...files);
  $("batchSection").classList.remove("hidden");
  $("settingsSection").classList.remove("hidden");
  $("readingText").textContent="Reading PDFs…";
  $("readingPct").textContent="0%";
  $("progressBar").style.width="0%";

  try{
    for(let j=0;j<files.length;j++) await readPdfFile(files[j],startIndex+j,files.length);
    refreshBatch();
    $("readingText").textContent="Ready";
    $("readingPct").textContent="100%";
    $("progressBar").style.width="100%";
    message('Print at <b>100% / Actual Size</b>. Avoid “Fit to Page” so barcode width is not rescaled.');
  }catch(err){
    console.error(err);
    message(`Could not read this PDF: <b>${err.message||"Unknown error"}</b>`,"error");
  }
}
function refreshBatch(){
  $("ordersCount").textContent=state.pages.length;
  $("filesCount").textContent=state.files.length;
  $("productsCount").textContent=new Set(state.pages.map(p=>p.product)).size;
  $("couriersCount").textContent=new Set(state.pages.map(p=>p.courier)).size;
  updatePacking();
}
async function makeOutputPdf(){
  if(!state.pages.length) throw new Error("Choose at least one Meesho label PDF first.");
  if(!window.PDFLib) throw new Error("PDF engine did not load. Open once with internet and reload.");

  const {PDFDocument}=window.PDFLib;
  const sources=[];
  for(const file of state.files) sources.push(await PDFDocument.load(await file.arrayBuffer(),{ignoreEncryption:true}));

  const out=await PDFDocument.create();
  const pages=sortedPages();
  const keepInvoice=$("keepInvoice").checked;
  const A4W=595.28,A4H=841.89;
  const THW=288,THH=432; // 4 × 6 inch at 72pt/in
  let sheet=null,slot=0,currentPer=0;

  for(let n=0;n<pages.length;n++){
    const meta=pages[n], src=sources[meta.sourceFileIndex];
    const srcPage=src.getPage(meta.sourcePageIndex);
    const {width,height}=srcPage.getSize();

    if(keepInvoice){
      const [cp]=await out.copyPages(src,[meta.sourcePageIndex]);
      out.addPage(cp);
      continue;
    }

    // Bounding box of label: from auto-detected invoice top to page top.
    // Use the detected boundary directly: complete shipping label, no TAX INVOICE text.
    let y0=Math.max(0,Math.min(height-10,meta.boundaryY));
    let cropH=height-y0;
    if(cropH < height*.25 || cropH > height*.72){
      const fallback=Number($("fallbackCrop").value)/100;
      cropH=height*fallback; y0=height-cropH;
    }

    if(state.print==="crop"){
      const [cp]=await out.copyPages(src,[meta.sourcePageIndex]);
      cp.setMediaBox(0,y0,width,cropH);
      cp.setCropBox(0,y0,width,cropH);
      out.addPage(cp);
      continue;
    }

    const embedded=await out.embedPage(srcPage,{left:0,bottom:y0,right:width,top:height});

    if(state.print==="thermal"){
      const page=out.addPage([THW,THH]);
      // Rotate/scale only when it gives a meaningfully bigger label.
      const scaleNormal=Math.min(THW/width,THH/cropH);
      const scaleRot=Math.min(THW/cropH,THH/width);
      if(scaleRot > scaleNormal*1.08){
        const dw=width*scaleRot, dh=cropH*scaleRot;
        page.drawPage(embedded,{x:(THW-dh)/2+dh,y:(THH-dw)/2,width:dw,height:dh,rotate:PDFLib.degrees(90)});
      }else{
        const s=scaleNormal, dw=width*s, dh=cropH*s;
        page.drawPage(embedded,{x:(THW-dw)/2,y:(THH-dh)/2,width:dw,height:dh});
      }
      continue;
    }

    const per=state.print==="a4-4"?4:2;
    if(!sheet || slot>=currentPer || currentPer!==per){
      sheet=out.addPage([A4W,A4H]); slot=0; currentPer=per;
    }
    const cols=per===4?2:1, rows=2;
    const cellW=A4W/cols, cellH=A4H/rows;
    const col=per===4?slot%2:0, row=per===4?Math.floor(slot/2):slot;
    const cellX=col*cellW, cellY=A4H-(row+1)*cellH;

    if(per===4){
      // IMPORTANT:
      // Every Meesho label comes from the same A4 source width.
      // Use ONE fixed scale based on that source width, so longer/taller labels
      // are never shrunk just because their crop is bigger.
      //
      // After 90° rotation:
      //   visible width  = cropH * s   (can vary with content)
      //   visible height = sourceWidth * s (stays consistent)
      //
      // This matches the manual Illustrator workflow much better.
      const targetLongSide = 327; // ~115 mm, based on user's manual PDF
      const s = targetLongSide / width;

      const rotatedW = cropH * s;   // variable according to label content
      const rotatedH = width * s;   // same for all labels from same source format

      // Center each label inside its quarter.
      // If a rare label is wider than its cell, use a tiny safety reduction only.
      const maxCellW = cellW - 10;
      const safeS = rotatedW > maxCellW ? s * (maxCellW / rotatedW) : s;

      const finalW = cropH * safeS;
      const finalH = width * safeS;
      const x = cellX + (cellW-finalW)/2;
      const y = cellY + (cellH-finalH)/2;

      sheet.drawPage(embedded,{
        x:x+finalW,
        y:y,
        width:width*safeS,
        height:cropH*safeS,
        rotate:PDFLib.degrees(90)
      });
    }else{
      // 2-up cells are landscape, so keep the label unrotated.
      const s=Math.min(cellW/width,cellH/cropH);
      const dw=width*s,dh=cropH*s;
      sheet.drawPage(embedded,{
        x:cellX+(cellW-dw)/2,
        y:cellY+(cellH-dh)/2,
        width:dw,
        height:dh
      });
    }
    slot++;
  }
  return out.save();
}
function resetAll(){
  state.files=[];state.pages=[];
  $("pdfInput").value="";
  $("batchSection").classList.add("hidden");
  $("settingsSection").classList.add("hidden");
  $("progressBar").style.width="0%";
  window.scrollTo({top:0,behavior:"smooth"});
}

$("dropzone").addEventListener("click",()=>$("pdfInput").click());
$("addMoreBtn").addEventListener("click",()=>$("pdfInput").click());
$("pdfInput").addEventListener("change",e=>loadFiles(e.target.files,state.files.length>0));

for(const ev of ["dragenter","dragover"]){
  document.addEventListener(ev,e=>e.preventDefault());
}
document.addEventListener("drop",e=>{
  e.preventDefault();
  if(e.dataTransfer?.files?.length) loadFiles(e.dataTransfer.files,state.files.length>0);
});

document.querySelectorAll("#sortGroup button").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("#sortGroup button").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active"); state.sort=btn.dataset.sort;
  const hints={
    product:"Biggest product run first — useful while picking and packing.",
    courier:"Keeps courier handover stacks together.",
    payment:"Keeps COD and prepaid parcels together.",
    original:"Keeps the exact order Meesho supplied."
  };
  $("sortHint").textContent=hints[state.sort];
  updatePacking();
}));
document.querySelectorAll("#printGroup button").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("#printGroup button").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active"); state.print=btn.dataset.print;
}));
$("fallbackCrop").addEventListener("input",e=>$("fallbackVal").textContent=e.target.value+"%");
$("resetBtn").addEventListener("click",resetAll);
$("makePdfBtn").addEventListener("click",async()=>{
  const btn=$("makePdfBtn");
  btn.disabled=true;btn.textContent="Building PDF…";message("Creating print-ready PDF on this device…");
  try{
    const bytes=await makeOutputPdf();
    const blob=new Blob([bytes],{type:"application/pdf"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    const now=new Date();
    const dd=String(now.getDate()).padStart(2,"0");
    const mm=String(now.getMonth()+1).padStart(2,"0");
    const yy=String(now.getFullYear()).slice(-2);
    let hh=now.getHours();
    const min=String(now.getMinutes()).padStart(2,"0");
    const ampm=hh>=12?"PM":"AM";
    hh=hh%12||12;
    const hh12=String(hh).padStart(2,"0");
    // ":" is replaced by "-" because some operating systems do not allow ":" in filenames.
    a.download=`${dd}-${mm}-${yy}-${hh12}-${min}${ampm}.pdf`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    message(`Done ✓ <b>${state.pages.length} labels</b> processed. Your PDF download has started.`,"success");
  }catch(err){
    console.error(err);message(err.message||"Could not create PDF.","error");
  }finally{
    btn.disabled=false;btn.textContent="Make my PDF";
  }
});

// Engine check
const engineTimer=setInterval(()=>{
  if(window.PDFLib){
    clearInterval(engineTimer);
    $("engineStatus").textContent="Ready · PDFs are processed locally";
  }
},250);
setTimeout(()=>{
  if(!window.PDFLib) $("engineStatus").textContent="PDF engine needs internet on first load. Reload when online.";
},7000);

// PWA install
let deferredPrompt=null;
window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault();deferredPrompt=e;$("installBtn").hidden=false;
});
$("installBtn").addEventListener("click",async()=>{
  if(!deferredPrompt)return;
  deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").hidden=true;
});
window.addEventListener("appinstalled",()=>$("installBtn").hidden=true);

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.warn));
}


// ---------------- TOOL TABS ----------------
function activateToolScreen(id){
  document.querySelectorAll(".tool-screen").forEach(x=>x.classList.toggle("active",x.id===id));
  document.querySelectorAll(".tool-tab").forEach(x=>x.classList.toggle("active",x.dataset.tool===id));
  try{ localStorage.setItem("srbActiveTool",id); }catch(e){}
  window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll(".tool-tab").forEach(btn=>btn.addEventListener("click",()=>activateToolScreen(btn.dataset.tool)));
try{
  const saved=localStorage.getItem("srbActiveTool");
  if(["labelTool","priceTool"].includes(saved)) activateToolScreen(saved);
}catch(e){}

// ---------------- MEESHO PRICE CALCULATOR ----------------
let pcMode="pct";
let pcGstRate=5;
const pcMoney=n=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(n)||0);
const pcNum=id=>Math.max(0,parseFloat($(id)?.value)||0);

function pcTargetProfit(){
  const cost=pcNum("pcCost"), t=pcNum("pcTarget");
  return pcMode==="pct" ? cost*t/100 : t;
}

function pcParts(price,includeReturns=true){
  const cost=pcNum("pcCost");
  const pack=pcNum("pcPack");
  const ads=pcNum("pcAds");
  const other=pcNum("pcOther");
  const shipping=pcNum("pcShipping");
  const commissionRate=pcNum("pcCommission")/100;
  const returns=Math.min(.95,pcNum("pcReturns")/100);
  const rto=Math.min(.95,pcNum("pcRto")/100);
  const failure=Math.min(.95,returns+rto);
  const success=1-failure;
  const returnFreight=pcNum("pcReturnFreight");
  const unsellable=pcNum("pcUnsellable")/100;
  const isGst=$("pcGstRegistered")?.checked;

  const commission=price*commissionRate;
  const feeGst=(commission+shipping)*.18;
  const settlement=price-shipping-commission-feeGst;

  // Supplier cost is treated as GST-inclusive for this planning estimator.
  const productInputGst=pcGstRate>0 ? cost*pcGstRate/(100+pcGstRate) : 0;
  const inputCredit=isGst ? productInputGst+feeGst : 0;

  const deliveredProfit=settlement-cost-pack-ads-other+inputCredit;

  // Failed order: no sales revenue, reverse freight paid; some stock becomes unsellable.
  const failedLoss=pack+ads+other+returnFreight+(cost*unsellable);
  const avgProfit=includeReturns
    ? success*deliveredProfit-failure*failedLoss
    : deliveredProfit;

  const outputGst=pcGstRate>0 ? price*pcGstRate/(100+pcGstRate) : 0;
  const netGst=isGst ? outputGst-inputCredit : outputGst;

  return {
    cost,pack,ads,other,shipping,commission,feeGst,settlement,
    productInputGst,inputCredit,deliveredProfit,failedLoss,avgProfit,
    outputGst,netGst,failure,success
  };
}

function pcSolve(includeReturns=true,targetOverride=null){
  const target=targetOverride===null?pcTargetProfit():targetOverride;
  let lo=0,hi=1000;
  // expand upper bound until target is reachable
  while(pcParts(hi,includeReturns).avgProfit<target && hi<100000) hi*=2;
  for(let i=0;i<90;i++){
    const mid=(lo+hi)/2;
    if(pcParts(mid,includeReturns).avgProfit<target) lo=mid;
    else hi=mid;
  }
  return hi;
}

function pcCalc(){
  if(!$("pcCost")) return;

  const listPrice=pcSolve(true);
  const ignoreReturns=pcSolve(false);
  const floor=pcSolve(true,0);
  const c=pcParts(listPrice,true);

  const extra=pcNum("pcPack")+pcNum("pcAds")+pcNum("pcOther");
  const returnBuffer=Math.max(0,listPrice-ignoreReturns);
  const taxFees=c.commission+c.feeGst;
  const margin=listPrice?c.avgProfit/listPrice*100:0;
  const markup=c.cost?c.avgProfit/c.cost*100:0;
  const invested=c.cost+extra;
  const roi=invested?c.avgProfit/invested*100:0;

  $("pcListPrice").textContent=pcMoney(Math.ceil(listPrice));
  $("pcFloorLine").textContent=`Below ${pcMoney(Math.ceil(floor))} you are losing money on average.`;
  $("pcReturnAdd").textContent=`Returns add ${pcMoney(returnBuffer)} to the price`;
  $("pcIgnoreReturn").textContent=`Ignore them and you would list at ${pcMoney(ignoreReturns)}.`;

  $("pcRProduct").textContent=pcMoney(c.cost);
  $("pcRExtra").textContent=pcMoney(extra);
  $("pcRShipping").textContent=pcMoney(c.shipping);
  $("pcRReturns").textContent=pcMoney(returnBuffer);
  $("pcRTax").textContent=pcMoney(taxFees);
  $("pcRProfit").textContent=pcMoney(c.avgProfit);

  $("pcMargin").textContent=margin.toFixed(1)+"%";
  $("pcMarkup").textContent=markup.toFixed(1)+"%";
  $("pcRoi").textContent=roi.toFixed(1)+"%";

  $("pcOutputGst").textContent=pcMoney(c.outputGst);
  $("pcInputGst").textContent=(c.inputCredit>0?"−":"")+pcMoney(c.inputCredit);
  $("pcNetGst").textContent=pcMoney(c.netGst);

  $("pcSettlement").textContent=pcMoney(c.settlement);
  $("pcDeliveredProfit").textContent=pcMoney(c.deliveredProfit);
  $("pcFailedLoss").textContent="−"+pcMoney(c.failedLoss);
  $("pcAvgProfit").textContent=pcMoney(c.avgProfit);
}

["pcCost","pcPack","pcAds","pcOther","pcTarget","pcShipping","pcCommission","pcReturns","pcRto","pcReturnFreight","pcUnsellable","pcGstRegistered"]
.forEach(id=>{
  $(id)?.addEventListener("input",pcCalc);
  $(id)?.addEventListener("change",pcCalc);
});

$("pcPctMode")?.addEventListener("click",()=>{
  pcMode="pct";
  $("pcPctMode").classList.add("active");
  $("pcFixedMode").classList.remove("active");
  $("pcTargetLabel").innerHTML='Profit on cost <b>%</b>';
  pcCalc();
});
$("pcFixedMode")?.addEventListener("click",()=>{
  pcMode="fixed";
  $("pcFixedMode").classList.add("active");
  $("pcPctMode").classList.remove("active");
  $("pcTargetLabel").innerHTML='Fixed target profit <b>₹</b>';
  pcCalc();
});
document.querySelectorAll("#pcGstGroup button").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("#pcGstGroup button").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  pcGstRate=parseFloat(btn.dataset.gst)||0;
  pcCalc();
}));
pcCalc();
