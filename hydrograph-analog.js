(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.HydrographAnalog=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const finite=value=>Number.isFinite(Number(value));
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

  function expandAnchors(anchors){
    if(!Array.isArray(anchors)||anchors.length<2)throw new Error('แม่แบบต้องมีจุดอย่างน้อย 2 จุด');
    const rows=anchors.map(row=>({hour:Number(row[0]),level:Number(row[1])})).sort((a,b)=>a.hour-b.hour);
    const output=[];
    for(let hour=rows[0].hour;hour<=rows.at(-1).hour;hour++){
      let right=rows.findIndex(row=>row.hour>=hour);if(right<0)right=rows.length-1;
      if(rows[right].hour===hour||right===0){output.push({hour,level:rows[right].level});continue;}
      const a=rows[right-1],b=rows[right],fraction=(hour-a.hour)/(b.hour-a.hour);
      output.push({hour,level:a.level+fraction*(b.level-a.level)});
    }
    return output;
  }

  function parseObservations(text){
    const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean),output=[];
    lines.forEach((line,index)=>{
      const values=(line.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);
      if(!values.length)return;
      const hour=values.length>=2?values[0]:index+1,level=values.length>=2?values[1]:values[0];
      if(hour<1||!finite(level))throw new Error(`ข้อมูลบรรทัด ${index+1} ไม่ถูกต้อง`);
      output.push({hour:Math.round(hour),level:Number(level)});
    });
    const unique=[...new Map(output.map(row=>[row.hour,row])).values()].sort((a,b)=>a.hour-b.hour);
    if(unique.length<3)throw new Error('ต้องมีระดับน้ำอย่างน้อย 3 ชั่วโมง');
    for(let index=1;index<unique.length;index++)if(unique[index].hour<=unique[index-1].hour)throw new Error('ชั่วโมงต้องเรียงจากน้อยไปมาก');
    return unique;
  }

  function fitTemplate(observations,template){
    const curve=expandAnchors(template.anchors),lookup=new Map(curve.map(row=>[row.hour,row.level]));
    const paired=observations.filter(row=>lookup.has(row.hour));
    if(paired.length<3)return null;
    const x0=lookup.get(paired[0].hour),y0=paired[0].level;
    let numerator=0,denominator=0;
    paired.forEach(row=>{const x=lookup.get(row.hour)-x0,y=row.level-y0;numerator+=x*y;denominator+=x*x;});
    const scale=clamp(denominator>1e-9?numerator/denominator:1,.25,2.5),offset=y0-scale*x0;
    const fitted=curve.map(row=>({hour:row.hour,level:offset+scale*row.level}));
    const errors=paired.map(row=>row.level-(offset+scale*lookup.get(row.hour)));
    const rmse=Math.sqrt(errors.reduce((sum,value)=>sum+value*value,0)/errors.length);
    const observedRange=Math.max(...paired.map(row=>row.level))-Math.min(...paired.map(row=>row.level));
    const templateRise=Math.max(...paired.map(row=>lookup.get(row.hour)))-Math.min(...paired.map(row=>lookup.get(row.hour)));
    const normalizer=Math.max(.20,observedRange,Math.abs(scale*templateRise));
    const nrmse=rmse/normalizer;
    const last=paired.at(-1),prior=paired.at(-2),observedSlope=(last.level-prior.level)/(last.hour-prior.hour);
    const templateSlope=(lookup.get(last.hour)-lookup.get(prior.hour))/(last.hour-prior.hour)*scale;
    const directionPenalty=observedSlope*templateSlope<-.0001?.18:0;
    const similarity=clamp(100*Math.exp(-3.2*(nrmse+directionPenalty)),0,100);
    const peak=fitted.reduce((best,row)=>row.level>best.level?row:best,fitted[0]);
    const remaining=peak.hour-last.hour;
    return {year_be:template.year_be,similarity,rmse,scale,offset,curve,fitted,peak_hour:peak.hour,predicted_peak_level_m:peak.level,hours_to_peak:remaining,observed_count:paired.length,last_hour:last.hour,last_level_m:last.level};
  }

  function analyze(stationConfig,observations){
    if(!stationConfig||!Array.isArray(stationConfig.templates))throw new Error('ไม่พบแม่แบบสถานี');
    const results=stationConfig.templates.map(template=>fitTemplate(observations,template)).filter(Boolean).sort((a,b)=>b.similarity-a.similarity);
    if(!results.length)throw new Error('ช่วงชั่วโมงที่กรอกยาวเกินแม่แบบทั้งหมด');
    const best=results[0],confidence=observations.length>=12&&best.similarity>=70?'สูง':observations.length>=6&&best.similarity>=50?'ปานกลาง':'ต่ำ';
    return {station:stationConfig.name_th,best,alternatives:results.slice(1,3),confidence,bank_level_m:Number(stationConfig.operational_bank_level_m),warning_th:stationConfig.warning_th};
  }

  function assessEvent(stationConfig,observations){
    const rows=Array.isArray(observations)?observations:[],bank=Number(stationConfig&&stationConfig.operational_bank_level_m);
    if(rows.length<3||!finite(bank))return {is_event:false,reason:'ข้อมูลระดับน้ำยังไม่พอประเมินเหตุการณ์'};
    const levels=rows.map(row=>Number(row.level)).filter(finite),latest=levels.at(-1),range=Math.max(...levels)-Math.min(...levels);
    const recent=levels.slice(-Math.min(6,levels.length)),recentChange=recent.at(-1)-recent[0];
    if(latest<bank-.50&&Math.abs(recentChange)<.081)return {is_event:false,reason:`ระดับล่าสุดยังต่ำกว่าตลิ่ง ${(bank-latest).toFixed(2)} ม. และ 6 ชั่วโมงล่าสุดเปลี่ยนเพียง ${Math.abs(recentChange).toFixed(2)} ม. จึงยังไม่พบรูปทรงน้ำหลาก`,latest_level_m:latest,range_m:range,recent_change_m:recentChange};
    return {is_event:true,reason:'พบการเปลี่ยนระดับที่เพียงพอสำหรับเทียบรูปทรงเบื้องต้น',latest_level_m:latest,range_m:range,recent_change_m:recentChange};
  }

  function hourlyFromTelemetry(series,maxHours=168){
    const valid=(Array.isArray(series)?series:[]).map(row=>({time:new Date(row.t||row.time),level:Number(row.v??row.level??row.value)})).filter(row=>!isNaN(row.time)&&finite(row.level)).sort((a,b)=>a.time-b.time);
    if(!valid.length)return [];
    const buckets=new Map();
    valid.forEach(row=>{const key=new Date(row.time);key.setMinutes(0,0,0);buckets.set(key.toISOString(),row);});
    return [...buckets.values()].slice(-maxHours).map((row,index)=>({hour:index+1,level:row.level,time:row.time.toISOString()}));
  }

  function interpolateRating(values,stage){
    const h=Number(stage),rows=(Array.isArray(values)?values:[]).map(row=>[Number(row[0]),Number(row[1])]).filter(row=>finite(row[0])&&finite(row[1])).sort((a,b)=>a[0]-b[0]);
    if(!finite(h)||!rows.length||h<rows[0][0]||h>rows.at(-1)[0])return null;
    for(let index=0;index<rows.length;index++){
      if(h===rows[index][0])return rows[index][1];
      if(h<rows[index][0]){const a=rows[index-1],b=rows[index],fraction=(h-a[0])/(b[0]-a[0]);return a[1]+fraction*(b[1]-a[1]);}
    }
    return rows.at(-1)[1];
  }

  return {expandAnchors,parseObservations,fitTemplate,analyze,assessEvent,hourlyFromTelemetry,interpolateRating};
});
