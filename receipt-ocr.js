let loading;
function loadEngine(){return loading||=(new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('./vendor/ocr/tesseract.min.js',import.meta.url).href;script.onload=()=>resolve(window.Tesseract);script.onerror=()=>{loading=null;reject(Error('사진 인식 엔진을 불러오지 못했습니다. 연결을 확인하세요.'));};document.head.append(script);}));}
export async function recognizeReceipt(file,onProgress=()=>{}){
 if(!file.type.startsWith('image/')||file.size>12*1024*1024)throw Error('12MB 이하의 사진 파일을 선택하세요.');
 onProgress('사진 준비 중',0);const engine=await loadEngine();let worker,bitmap;
 try{
  bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>40000000)throw Error('사진 해상도가 너무 큽니다. 거래 목록 부분만 잘라 다시 선택하세요.');
  const scale=Math.min(2,1600/bitmap.width,7000/bitmap.height),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.filter='grayscale(1) contrast(1.2)';context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const root=new URL('./vendor/ocr/',import.meta.url).href;
  const hasSimd=WebAssembly.validate(Uint8Array.of(0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,9,1,7,0,65,0,253,15,26,11));
  worker=await engine.createWorker('kor+eng',1,{workerPath:root+'worker.min.js',corePath:root+(hasSimd?'tesseract-core-simd-lstm.js':'tesseract-core-lstm.js'),langPath:root,workerBlobURL:false,gzip:true,logger:m=>onProgress(m.status==='recognizing text'?'글자 읽는 중':'인식 엔진 준비 중',m.status==='recognizing text'?m.progress:0),errorHandler:()=>{}});
  await worker.setParameters({tessedit_pageseg_mode:'3',preserve_interword_spaces:'1'});
  const {data}=await worker.recognize(canvas,{}, {text:true,blocks:true});
  const lines=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).map(l=>({text:l.text,bbox:l.bbox,words:l.words}))));
  await refineReceiptNumbers(worker,canvas,lines,canvas.width,canvas.height,onProgress);
  return {text:lines.map(l=>l.text.trim()).join('\n'),confidence:data.confidence,lines};
 }catch(error){throw Error(error.message||'사진에서 글자를 읽지 못했습니다. 밝고 선명한 거래 목록 사진을 사용하세요.');}
 finally{bitmap?.close();await worker?.terminate();}
}
export async function refineReceiptNumbers(worker,source,lines,width,height,onProgress=()=>{}){
 const prices=lines.filter(l=>(/주\s*당/.test(l.text)||l.bbox.x0>width*.55)&&/[0-9].*[0-9]/.test(l.text));
 const quantities=lines.filter(l=>/주\s*(구매|매수|판매|매도)/.test(l.text));
 await worker.reinitialize('eng',1);await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789,'});
 let index=0;
 const crop=async (left,top,right,bottom)=>{left=Math.max(0,Math.floor(left));top=Math.max(0,Math.floor(top));const w=Math.min(width-left,Math.ceil(right)-left),h=Math.min(height-top,Math.ceil(bottom)-top);if(w<4||h<4)return '';const r=await worker.recognize(source,{rectangle:{left,top,width:w,height:h}},{text:true});return r.data.text.trim().replace(/\s/g,'');};
 for(const line of prices){onProgress('가격 숫자 대조 중',++index/(prices.length+quantities.length));const words=(line.words||[]).filter(w=>/[0-9].*[0-9]/.test(w.text));if(!words.length)continue;const unit=(line.words||[]).find(w=>w.text.trim()==='원'),right=unit?.bbox.x0||line.bbox.x1-(line.bbox.y1-line.bbox.y0)*.82;const value=await crop(Math.min(...words.map(w=>w.bbox.x0))-5,line.bbox.y0-6,right,line.bbox.y1+6);if(/^[0-9][0-9,]*$/.test(value))line.text='주당 '+value+'원';}
 for(const line of quantities){onProgress('수량 숫자 대조 중',++index/(prices.length+quantities.length));const unit=(line.words||[]).flatMap(w=>w.symbols||[]).find(s=>s.text==='주');if(!unit)continue;const h=line.bbox.y1-line.bbox.y0,value=await crop(line.bbox.x0-h,line.bbox.y0-6,unit.bbox.x0,line.bbox.y1+6);if(/^[0-9]+$/.test(value))line.text=line.text.replace(/[0-9]*\s*주/,value+'주');}
}
