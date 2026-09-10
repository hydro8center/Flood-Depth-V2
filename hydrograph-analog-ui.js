(function(){
  'use strict';
  const $=id=>document.getElementById(id),fmt=(value,digits=2)=>Number(value).toLocaleString('th-TH',{minimumFractionDigits:digits,maximumFractionDigits:digits});
  const isPc=Boolean(document.querySelector('link[href*="pc-operations.css"]'));
  let analogConfig=null,ratingConfig=null,x174Config=null;

  function stationKey(code){return code.replace('.','');}
  function templateMarkup(code){
    const key=stationKey(code),auto=isPc?`<button class="secondary" id="analogAuto${key}">อ่านโทรมาตรอัตโนมัติ</button>`:'';
    return `<section class="analogbox" id="analogBox${key}">
      <div class="analoghead"><div><h3>ติดตามรูปทรงเหตุการณ์ ${code}</h3><p>นำระดับน้ำเหตุการณ์ปัจจุบันมาเริ่มเทียบที่ชั่วโมง 1 เพื่อดูว่าคล้ายเหตุการณ์ปีใด และประมาณช่วงเวลาที่ยอดจะมาถึง</p></div><span class="pill">เทียบปีน้ำหลาก</span></div>
      <div class="analogentry"><label>ระดับน้ำรายชั่วโมง (ม.รทก.)<textarea id="analogInput${key}" rows="4" placeholder="ใส่หนึ่งค่าต่อบรรทัด เช่น&#10;8.62&#10;8.75&#10;8.91&#10;หรือใส่ ชั่วโมง,ระดับ เช่น 1,8.62"></textarea></label>
        <div><p class="chartcaveat">ชั่วโมงแรกที่กรอกจะเป็นชั่วโมง 1 ของเหตุการณ์ ควรมีอย่างน้อย 6–12 ชั่วโมงเพื่อให้การจับคู่มีความน่าเชื่อถือขึ้น</p><div class="forecastactions"><button class="primary" id="analogRun${key}">วิเคราะห์แนวโน้ม</button>${auto}<button class="secondary" id="analogClear${key}">ล้างค่า</button></div></div></div>
      <p class="forecastmsg" id="analogMessage${key}">ยังไม่มีข้อมูลเหตุการณ์ปัจจุบัน</p>
      <div class="analogresult" id="analogResult${key}"><div class="analogsummary" id="analogSummary${key}"></div><svg class="uhchart" id="analogChart${key}" viewBox="0 0 700 300" role="img" aria-label="เปรียบเทียบ Hydrograph เหตุการณ์ ${code}"></svg><p class="chartcaveat" id="analogCaveat${key}"></p></div>
    </section>`;
  }

  function install(){
    [['X.90','forecastCard'],['X.174','forecast174Card']].forEach(([code,cardId])=>{
      const card=$(cardId),target=card&&card.querySelector('.rainentry');if(target)target.insertAdjacentHTML('beforebegin',templateMarkup(code));
      const key=stationKey(code);$(`analogRun${key}`).addEventListener('click',()=>run(code));$(`analogClear${key}`).addEventListener('click',()=>clear(code));
      if(isPc)$(`analogAuto${key}`).addEventListener('click',()=>fillTelemetry(code));
    });
  }

  function trimEvent(rows,station){
    if(rows.length<=3)return rows;
    const reindex=values=>values.map((row,index)=>({...row,hour:index+1}));
    const bank=Number(station.operational_bank_level_m),windowRows=rows.slice(-Math.min(rows.length,216));
    const peakIndex=windowRows.reduce((best,row,index)=>row.level>windowRows[best].level?index:best,0);
    const end=Math.max(peakIndex,windowRows.length-1),searchStart=Math.max(0,end-144);
    let start=searchStart;
    for(let index=searchStart+1;index<=Math.max(searchStart,end-3);index++)if(windowRows[index].level<windowRows[start].level)start=index;
    const selected=windowRows.slice(start);
    if(selected.length<3)return reindex(windowRows.slice(-Math.min(24,windowRows.length)));
    const rise=Math.max(...selected.map(row=>row.level))-selected[0].level;
    if(rise<.15&&selected.at(-1).level<bank-.25)return reindex(windowRows.slice(-Math.min(24,windowRows.length)));
    return reindex(selected);
  }

  function fillTelemetry(code){
    const key=stationKey(code),station=(window.FLOOD_TELEMETRY||[]).find(row=>row.station===code);
    if(!station||!station.series||station.series.length<3){$(`analogMessage${key}`).textContent=`ยังไม่มีข้อมูลโทรมาตรรายชั่วโมง ${code} กรุณากดอ่านข้อมูลใหม่หรือกรอกเอง`;return;}
    const config=analogConfig.stations[code],hourly=trimEvent(HydrographAnalog.hourlyFromTelemetry(station.series,240),config);
    $(`analogInput${key}`).value=hourly.map(row=>`${row.hour},${row.level.toFixed(3)}`).join('\n');
    $(`analogMessage${key}`).textContent=`เติมโทรมาตร ${hourly.length} ชั่วโมงแล้ว · ชั่วโมงแรกของช่วงที่ตรวจพบถูกตั้งเป็นชั่วโมง 1`;
    run(code);
  }

  function clear(code){const key=stationKey(code);$(`analogInput${key}`).value='';$(`analogResult${key}`).classList.remove('on');$(`analogMessage${key}`).textContent='ยังไม่มีข้อมูลเหตุการณ์ปัจจุบัน';}

  function stageToQ(code,stage){
    if(code==='X.90'&&ratingConfig)return HydrographAnalog.interpolateRating(ratingConfig.stations['X.90'].values,stage);
    if(code==='X.174'&&x174Config)return HydrographAnalog.interpolateRating(x174Config.rating_curve.values,stage);
    return null;
  }

  function modelPeak(code){
    const result=window.FLOOD_MODEL_RESULTS&&window.FLOOD_MODEL_RESULTS[code];if(!result||!Array.isArray(result.hourly))return null;
    return result.hourly.reduce((best,row)=>row.q_total_cms>best.q_total_cms?row:best,result.hourly[0]);
  }

  function draw(code,observations,analysis){
    const key=stationKey(code),svg=$(`analogChart${key}`),W=700,H=300,L=58,R=18,T=20,B=45,best=analysis.best,alts=analysis.alternatives;
    const curves=[best,...alts].map(row=>row.fitted),allLevels=[...observations.map(row=>row.level),analysis.bank_level_m,...curves.flat().map(row=>row.level)];
    const min=Math.min(...allLevels)-.15,max=Math.max(...allLevels)+.15,maxHour=Math.max(best.curve.at(-1).hour,observations.at(-1).hour),x=h=>L+(h-1)*(W-L-R)/Math.max(1,maxHour-1),y=v=>T+(max-v)/(max-min)*(H-T-B);
    const path=rows=>rows.map((row,index)=>`${index?'L':'M'}${x(row.hour).toFixed(1)} ${y(row.level).toFixed(1)}`).join(' '),colors=['#D7442E','#7A52A8','#7A9AAA'];
    let grid='';for(let index=0;index<=4;index++){const value=max-index*(max-min)/4,yy=y(value);grid+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#DDEAF0"/><text x="${L-7}" y="${yy+4}" text-anchor="end" fill="#607580" font-size="10">${fmt(value,2)}</text>`;}
    svg.innerHTML=`${grid}<line x1="${L}" y1="${y(analysis.bank_level_m)}" x2="${W-R}" y2="${y(analysis.bank_level_m)}" stroke="#E43D30" stroke-dasharray="6 5"/><text x="${W-R-4}" y="${y(analysis.bank_level_m)-5}" text-anchor="end" fill="#B22D25" font-size="10">ตลิ่ง ${fmt(analysis.bank_level_m,2)}</text>${curves.map((curve,index)=>`<path d="${path(curve)}" fill="none" stroke="${colors[index]}" stroke-width="${index?1.5:3}" ${index?'stroke-dasharray="5 4"':''}/>`).join('')}<path d="${path(observations)}" fill="none" stroke="#087FA8" stroke-width="4"/>${observations.map(row=>`<circle cx="${x(row.hour)}" cy="${y(row.level)}" r="3" fill="#087FA8"/>`).join('')}${[1,24,48,72,120,maxHour].filter((v,i,a)=>v<=maxHour&&a.indexOf(v)===i).map(hour=>`<text x="${x(hour)}" y="${H-18}" text-anchor="middle" fill="#536B76" font-size="10">${hour}</text>`).join('')}<text x="${W/2}" y="${H-3}" text-anchor="middle" fill="#536B76" font-size="10">ชั่วโมงของเหตุการณ์ (เริ่มที่ 1)</text><text x="14" y="${H/2}" transform="rotate(-90 14 ${H/2})" text-anchor="middle" fill="#536B76" font-size="10">ระดับน้ำ (ม.รทก.)</text>`;
  }

  function run(code){
    const key=stationKey(code),message=$(`analogMessage${key}`);
    try{
      if(!analogConfig)throw new Error('ยังโหลดแม่แบบเหตุการณ์ไม่สำเร็จ');
      const observations=HydrographAnalog.parseObservations($(`analogInput${key}`).value),event=HydrographAnalog.assessEvent(analogConfig.stations[code],observations);
      if(!event.is_event)throw new Error(`${event.reason} — ระบบยังไม่จับคู่กับปีน้ำหลาก`);
      const analysis=HydrographAnalog.analyze(analogConfig.stations[code],observations),best=analysis.best;
      const q=stageToQ(code,best.predicted_peak_level_m),peakText=best.hours_to_peak>0?`คาดว่ายอดอยู่ข้างหน้าอีกราว ${Math.round(best.hours_to_peak)} ชั่วโมง`:`รูปทรงแม่แบบผ่านยอดมาแล้วราว ${Math.abs(Math.round(best.hours_to_peak))} ชั่วโมง`;
      const direction=observations.at(-1).level>observations.at(-2).level?'กำลังขึ้น':observations.at(-1).level<observations.at(-2).level?'กำลังลด':'ทรงตัว',comparison=best.scale>1.05?'แรงกว่ารูปทรงปีอ้างอิง':best.scale<.95?'เบากว่ารูปทรงปีอ้างอิง':'ใกล้เคียงขนาดปีอ้างอิง';
      const model=modelPeak(code),modelText=model&&q!==null?`<br>เทียบแบบจำลองฝน–น้ำท่า: Rating Curve ให้ Q ยอดประมาณ <b>${fmt(q,1)}</b> ม³/วินาที ขณะที่ Unit Hydrograph ล่าสุดให้ <b>${fmt(model.q_total_cms,1)}</b> ม³/วินาที`:(q!==null?`<br>แปลงระดับยอดด้วย Rating Curve ได้ Q ประมาณ <b>${fmt(q,1)}</b> ม³/วินาที`:''),alternatives=analysis.alternatives.map(row=>`พ.ศ. ${row.year_be} ${fmt(row.similarity,0)}%`).join(' · ');
      $(`analogSummary${key}`).innerHTML=`<strong>แนวโน้มใกล้เคียง พ.ศ. ${best.year_be}</strong><span>ความคล้าย ${fmt(best.similarity,0)}% · ความเชื่อมั่น${analysis.confidence}</span><b>ระดับล่าสุด ${fmt(best.last_level_m,2)} ม.รทก. · ${direction}</b><b>ระดับสูงสุดประมาณ ${fmt(best.predicted_peak_level_m,2)} ม.รทก.</b><b>${peakText}</b><span>${comparison}${modelText}</span><small>ลำดับรอง: ${alternatives||'ไม่มี'}</small>`;
      draw(code,observations,analysis);$(`analogCaveat${key}`).textContent=analogConfig.warning_th;$(`analogResult${key}`).classList.add('on');message.className='forecastmsg';message.textContent=`วิเคราะห์ ${observations.length} ชั่วโมงสำเร็จ · คล้าย พ.ศ. ${best.year_be} มากที่สุด`;
    }catch(error){message.className='forecastmsg bad';message.textContent=error.message||String(error);}
  }

  async function load(){
    install();
    try{
      const [a,r,x]=await Promise.all([fetch('data/historical-hydrograph-analogs.json',{cache:'no-store'}),fetch('data/rating-tables.json',{cache:'no-store'}),fetch('data/x174-unit-hydrograph.json',{cache:'no-store'})]);
      if(!a.ok)throw new Error(`แม่แบบ HTTP ${a.status}`);analogConfig=await a.json();if(r.ok)ratingConfig=await r.json();if(x.ok)x174Config=await x.json();
      ['X.90','X.174'].forEach(code=>{$(`analogCaveat${stationKey(code)}`).textContent=analogConfig.warning_th;});
    }catch(error){['X90','X174'].forEach(key=>$(`analogMessage${key}`).textContent=`โหลดแม่แบบเหตุการณ์ไม่สำเร็จ: ${error.message}`);}
  }
  document.addEventListener('DOMContentLoaded',load);
})();
