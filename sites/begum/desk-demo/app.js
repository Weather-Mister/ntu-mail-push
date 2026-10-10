"use strict";
const $=id=>document.getElementById(id);
const dateFmt=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"});
function datePartsInTaipei(){return Object.fromEntries(dateFmt.formatToParts(new Date()).filter(p=>p.type!=="literal").map(p=>[p.type,Number(p.value)]));}
let skyMode="auto";const skyModes=["auto","day","sunset","night"];
function currentSky(){
 const h=datePartsInTaipei().hour;
 return h>=18||h<6?"night":h>=16?"sunset":"day";
}
function renderSky(){
 const target=skyMode==="auto"?currentSky():skyMode;
 $("scene").classList.toggle("sky-sunset",target==="sunset");
 $("scene").classList.toggle("sky-night",target==="night");
 const labels={auto:"Auto sky",day:"Daytime",sunset:"Sunset",night:"Night"};
 const win=$("skyWindow");
 win.setAttribute("aria-label","Taipei skyline. "+labels[skyMode]+". Click to switch between automatic, daytime, sunset and night lighting.");
 win.setAttribute("title",labels[skyMode]+" · Click to change the time of day");
}
function changeSky(){
 skyMode=skyModes[(skyModes.indexOf(skyMode)+1)%skyModes.length];
 renderSky();
}
$("skyWindow").addEventListener("click",changeSky);
const keyRows=[['esc','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12','⏻'],['~','1','2','3','4','5','6','7','8','9','0','−','=','delete'],['tab','Q','W','E','R','T','Y','U','I','O','P','[',']','\\'],['caps','A','S','D','F','G','H','J','K','L',';','’','return'],['shift','Z','X','C','V','B','N','M',',','.','/','shift'],['fn','ctrl','option','cmd','space','cmd','option','◀','▲','▼','▶']];
$("keyboardKeys").replaceChildren(...keyRows.map(keys=>{const row=document.createElement('div');row.className='key-row';keys.forEach(key=>{const cap=document.createElement('i');cap.textContent=key==='space'?'':key;cap.className=key==='space'?'space':key.length>3?'wide':'';row.append(cap);});return row;}));
function fitScene(){const stage=$('stage'),scene=$('scene');const size=getComputedStyle(stage);const w=parseFloat(size.width),h=parseFloat(size.height);scene.style.setProperty('--scene-scale',Math.min(scene.clientWidth/(w+(w>1000?80:0)),scene.clientHeight/h));}
new ResizeObserver(fitScene).observe($('scene'));fitScene();
renderSky();setInterval(()=>{if(skyMode==='auto')renderSky();},60000);
