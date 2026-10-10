// Spoken form only. The answer shown on screen remains unchanged.
export function speechText(input) {
  return String(input)
    .replace(/```[\s\S]*?```/g,'。コードは画面をご確認ください。')
    .replace(/!\[([^\]]*)\]\([^\s)]+\)/g,'$1')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g,'$1')
    .replace(/https?:\/\/[^\s）)、。]+/g,'リンクは画面をご確認ください。')
    .replace(/^\s{0,3}#{1,6}\s+/gm,'')
    .replace(/^\s*[-*•]\s+/gm,'')
    .replace(/^\s*(\d+)[.)]\s+/gm,'$1、')
    .replace(/\*\*([^*]+)\*\*/g,'$1').replace(/__([^_]+)__/g,'$1').replace(/`([^`]+)`/g,'$1')
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,(_m,y,m,d)=>`${y}年${Number(m)}月${Number(d)}日`)
    .replace(/\b(\d{1,2})\/(\d{1,2})[（(]([月火水木金土日])[）)]/g,(_m,m,d,day)=>`${Number(m)}月${Number(d)}日、${day}曜日`)
    .replace(/(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/g,(all,h,m)=>Number(h)<=24&&Number(m)<60?`${Number(h)}時${Number(m)?Number(m)+'分':''}`:all)
    .replace(/[〜～]/g,'から')
    .split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>/[。！？!?]$/.test(line)?line:line+'。').join('\n')
    .replace(/。{2,}/g,'。').trim();
}
export function speechChunks(input,maxLength=240) {
  const text=speechText(input),chunks=[];
  for(const sentence of text.match(/[^。！？!?\n]+[。！？!?]?/g)??[]) {
    let remaining=sentence.trim();
    while(remaining.length>maxLength) {
      let end=remaining.lastIndexOf('、',maxLength-1)+1;
      if(end<maxLength/2)end=maxLength;
      if(/[\uD800-\uDBFF]/.test(remaining[end-1]))end--;
      chunks.push(remaining.slice(0,end));remaining=remaining.slice(end);
    }
    if(remaining)chunks.push(remaining);
  }
  return chunks;
}
