import {recordTrade,validateAccount} from './daily-decision.js';
export const normalName=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/[^0-9A-Z가-힣]/g,'');
export function findStock(value,quotes=[]){const key=normalName(value);if(!key)return null;const matches=quotes.filter(q=>normalName(q.code)===key||normalName(q.name)===key);return matches.length===1?matches[0]:null;}
export const sameFill=(a,b)=>!a.type&&a.date===b.date&&a.code===b.code&&a.side===b.side&&a.qty===b.qty&&a.price===b.price;
export function importTrades(account,rows,{batchId,allowDuplicates=false,today}={}){
 validateAccount(account);if(!rows.length||rows.length>200||!batchId)throw Error('확인한 체결 내역 1~200건을 선택하세요.');
 let next=account;
 rows.forEach((row,i)=>{if(today&&row.date>today)throw Error('미래 날짜의 체결은 기록할 수 없습니다.');const trade={...row,id:`${batchId}:${i}`};if(!allowDuplicates&&(next.log||[]).some(x=>sameFill(x,trade)&&x.id!==trade.id))throw Error(`${row.name||row.code}: 같은 날짜·가격·수량의 기록이 있습니다. 중복 여부를 확인하세요.`);next=recordTrade(next,trade);});
 return next;
}
export function accountSummary(account,snapshot,{from='',to='9999-12-31'}={}){
 validateAccount(account);const quotes=new Map((snapshot?.quotes||[]).map(q=>[q.code,q])),book=new Map();
 const events=(account.log||[]).map(row=>{const x={...row,name:row.name||quotes.get(row.code)?.name||row.code};if(row.type)return x;const p=book.get(row.code)||{qty:0,cost:0};
 if(row.side==='buy'){p.qty+=row.qty;p.cost+=row.qty*row.price;}
 else {const cost=p.qty>=row.qty?p.cost/p.qty*row.qty:null;x.realizedPnl=cost===null?null:row.qty*row.price-row.tax-cost;if(cost!==null){p.cost-=cost;p.qty-=row.qty;}else{p.qty=0;p.cost=0;}}
 book.set(row.code,p);return x;});
 const filtered=events.filter(x=>x.date>=from&&x.date<=to),trades=filtered.filter(x=>!x.type),sells=trades.filter(x=>x.side==='sell'),unknown=sells.some(x=>x.realizedPnl===null);
 const holdings=account.positions.map(p=>{const q=quotes.get(p.code),usable=q?.date===snapshot?.asOf&&q.price>0&&p.entryDate<=q.date,price=usable?q.price:null,cost=p.avg*p.qty;return {...p,name:q?.name||p.code,market:q?.market,price,cost,value:price===null?null:price*p.qty,pnl:price===null?null:price*p.qty-cost};});
 const valuationKnown=holdings.every(p=>p.value!==null),value=holdings.reduce((n,p)=>n+(p.value||0),0),holdingCost=holdings.reduce((n,p)=>n+p.cost,0),months=new Map();let cumulative=0;
 const curve=[];for(const x of trades){const month=x.date.slice(0,7),m=months.get(month)||{month,buys:0,sells:0,tax:0,pnl:0,unknown:false};m[x.side==='buy'?'buys':'sells']+=x.qty*x.price;m.tax+=x.tax;if(x.side==='sell'){if(x.realizedPnl===null)m.unknown=true;else{m.pnl+=x.realizedPnl;cumulative+=x.realizedPnl;curve.push({date:x.date,value:cumulative});}}months.set(month,m);}
 return {events:filtered,holdings,equity:valuationKnown?account.cash+value:null,holdingValue:valuationKnown?value:null,holdingCost,unrealized:valuationKnown?value-holdingCost:null,realized:unknown?null:sells.reduce((n,x)=>n+x.realizedPnl,0),realizedIncomplete:unknown,tradeCount:trades.length,sellCount:sells.length,winRate:unknown||!sells.length?null:sells.filter(x=>x.realizedPnl>0).length/sells.length,buyAmount:trades.filter(x=>x.side==='buy').reduce((n,x)=>n+x.qty*x.price,0),sellAmount:sells.reduce((n,x)=>n+x.qty*x.price,0),tax:trades.reduce((n,x)=>n+x.tax,0),months:[...months.values()].reverse(),curve:unknown?[]:curve};
}
export function parseTradeText(text,quotes=[]){
 const lines=String(text).replace(/\r/g,'').split('\n').map(s=>s.trim()).filter(Boolean),rows=[],quantity=/([0-9]+)\s*주\s*(구매|매수|판매|매도)/,markers=[];
 lines.forEach((line,i)=>{if(quantity.test(line))markers.push(i);});
 markers.forEach((lineIndex,j)=>{
  const prev=j?markers[j-1]+1:0,next=j+1<markers.length?markers[j+1]:lines.length;
  // Name and unit price normally appear just above the quantity, sometimes just below.
  const before=lines.slice(prev,lineIndex+1),after=lines.slice(lineIndex+1,next),qty=lines[lineIndex].match(quantity),base=before.join(' '),tail=after.join(' ');
  const priceRE=/주\s*당\s*([0-9][0-9, .]*)\s*원/;
  let priceText=base.match(priceRE)?.[1];if(!priceText)priceText=tail.match(priceRE)?.[1];
  const allPrices=[...String(text).matchAll(/주\s*당\s*([0-9][0-9, .]*)\s*원/g)];if(allPrices.length===markers.length)priceText=allPrices[j][1];
  const price=priceText?Number(priceText.replace(/[^0-9]/g,'')):0;
  const cleaned=before.filter(s=>!quantity.test(s)).join(' ').replace(/주\s*당\s*[0-9][0-9, .]*\s*원/g,'').replace(/\b\d{1,2}[./]\d{1,2}\b/g,'').trim();
  const normalized=normalName(cleaned),matches=quotes.filter(q=>normalName(q.name)&&normalized===normalName(q.name)).sort((a,b)=>normalName(b.name).length-normalName(a.name).length),q=matches[0];
  rows.push({name:q?.name||cleaned,code:q?.code||'',market:q?.market,qty:Number(qty[1]),price,side:['판매','매도'].includes(qty[2])?'sell':'buy',matched:!!q});
 });
 return rows;
}
export function parseReceiptLines(lines,quotes=[]){
 const qtyRE=/([0-9]*)\s*주\s*(구매|매수|판매|매도)/,priceRE=/주\s*당\s*([0-9][0-9, .]*)\s*원/;
 const clean=s=>s.replace(priceRE,'').replace(qtyRE,'').replace(/완료/g,'').replace(/\b\d{1,2}[./]\d{1,2}\b/g,'').trim();
 const middle=l=>(l.bbox.y0+l.bbox.y1)/2;
 return lines.filter(l=>qtyRE.test(l.text)).map(line=>{const qty=line.text.match(qtyRE),h=Math.max(12,line.bbox.y1-line.bbox.y0);
  const names=lines.filter(l=>!qtyRE.test(l.text)&&clean(l.text)&&l.bbox.y0<=line.bbox.y0&&line.bbox.y0-l.bbox.y1<h*5&&Math.abs(l.bbox.x0-line.bbox.x0)<h*6).sort((a,b)=>b.bbox.y0-a.bbox.y0);
  const nameLine=names[0],name=clean(nameLine?.text||line.text),key=normalName(name),matches=quotes.filter(q=>key===normalName(q.name)&&normalName(q.name)).sort((a,b)=>normalName(b.name).length-normalName(a.name).length),q=matches[0];
  const anchor=nameLine?(middle(nameLine)+middle(line))/2:middle(line),prices=lines.filter(l=>priceRE.test(l.text)&&Math.abs(middle(l)-anchor)<h*4).sort((a,b)=>Math.abs(middle(a)-anchor)-Math.abs(middle(b)-anchor)),priceText=prices[0]?.text.match(priceRE)?.[1];
  return {name:q?.name||name,code:q?.code||'',market:q?.market,qty:Number(qty[1]),price:priceText?Number(priceText.replace(/[^0-9]/g,'')):0,side:['판매','매도'].includes(qty[2])?'sell':'buy',matched:!!q};
 });
}
export function suggestStocks(value,quotes=[]){
 const key=normalName(value);if(key.length<2)return [];
 const distance=(a,b)=>{let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length];};
 return quotes.map(q=>({q,d:distance(key,normalName(q.name))})).filter(x=>x.d<=Math.max(2,Math.floor(key.length*.5))).sort((a,b)=>a.d-b.d||Math.abs(normalName(a.q.name).length-key.length)-Math.abs(normalName(b.q.name).length-key.length)).slice(0,3).map(x=>x.q);
}
