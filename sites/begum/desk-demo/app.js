"use strict";
// Isolated concept build. This file never calls the production schedule APIs.
const COURSE = {
  women:{title:"Exploring Taiwan: Women and Taiwanese Society",location:"Boya · Room 202",color:"#b77b9a"},
  globalhealth:{title:"Essentials of Global Health",location:"NTU Hospital · Room 211",color:"#86aa91"},
  macro:{title:"Macroeconomics (1)",location:"Social Sciences · Room 202",color:"#c9a066"},
  statistics:{title:"Statistics with Recitation",location:"Social Sciences · Room 502",color:"#7c99bb"},
  period:{title:"Period: Theory, Thoughts and Actions",location:"Boya · Room 102",color:"#a89ac5"},
  resources:{title:"Exploring Taiwan: Natural Resources",location:"Boya · Room 202",color:"#88a28b"},
  micro:{title:"Microeconomics (1)",location:"Social Sciences · Room 507",color:"#cf8b7f"},
  toc:{title:"TOC",location:"Outside class",color:"#9eacb8"}
};
const LESSONS = {
  1:[{course:"women",start:"10:20",end:"12:10"},{course:"globalhealth",start:"13:20",end:"16:20"}],
  2:[{course:"macro",start:"10:20",end:"13:10",optional:true}],
  3:[{course:"statistics",start:"09:10",end:"12:10"},{course:"period",start:"16:30",end:"18:20"}],
  4:[{course:"resources",start:"13:20",end:"15:10"},{course:"statistics",start:"15:30",end:"17:20"},{course:"toc",start:"18:30",end:"19:20"}],
  5:[{course:"toc",start:"10:20",end:"12:10"},{course:"micro",start:"13:20",end:"16:20"}],
  6:[]
};
const dayShort=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const dayFull=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const monthFmt=new Intl.DateTimeFormat("en-US",{month:"short",timeZone:"UTC"});
const dateFmt=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"});
const clockFmt=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const $=(id)=>document.getElementById(id);
function datePartsInTaipei(){
  const p=Object.fromEntries(dateFmt.formatToParts(new Date()).filter(x=>x.type!=="literal").map(x=>[x.type,Number(x.value)]));
  return p;
}
function localDayUTC(){const p=datePartsInTaipei();return new Date(Date.UTC(p.year,p.month-1,p.day));}
function addDays(date,days){const d=new Date(date);d.setUTCDate(d.getUTCDate()+days);return d;}
function monday(date){return addDays(date,-((date.getUTCDay()+6)%7));}
const startToday=localDayUTC();
let weekShift=0;
let selectedDay=startToday.getUTCDay();
if(selectedDay===0||selectedDay===6) selectedDay=1; // A filled example on weekends for the concept review.
const storePrefix="begum-desk-demo-only-v1:";
const fallbackTasks=[
  {id:"sample-task-1",text:"Read the chapter before class",done:false},
  {id:"sample-task-2",text:"Review this week's notes",done:false},
  {id:"sample-task-3",text:"Pick up a little treat ♡",done:true}
];
const fallbackNotes=[
  {id:"sample-note-1",text:"Check the group presentation slides"},
  {id:"sample-note-2",text:"Remember the library book"}
];
function load(key,fallback){
  try{const parsed=JSON.parse(localStorage.getItem(storePrefix+key));if(Array.isArray(parsed))return parsed.filter(x=>x&&typeof x.text==="string"&&typeof x.id==="string").slice(0,100);}catch(e){}
  return structuredClone(fallback);
}
let tasks=load("tasks",fallbackTasks),notes=load("notes",fallbackNotes);
function save(key,data){try{localStorage.setItem(storePrefix+key,JSON.stringify(data));}catch(e){}}
function safeText(node,value){node.textContent=String(value);}
function svgSymbol(name){const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");const use=document.createElementNS("http://www.w3.org/2000/svg","use");use.setAttribute("href","#"+name);svg.appendChild(use);return svg;}
function uniqueId(){return "item-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);}
function renderWeek(){
 const currentMon=addDays(monday(startToday),weekShift*7),sat=addDays(currentMon,5);
 const range=(d)=>monthFmt.format(d)+" "+d.getUTCDate();
 safeText($("weekRange"),range(currentMon)+" – "+range(sat));
 const nav=$("dayButtons");nav.replaceChildren();
 for(let d=1;d<=6;d++){
   const dt=addDays(currentMon,d-1),btn=document.createElement("button");btn.type="button";
   btn.className="day-btn"+(selectedDay===d?" active":"")+(weekShift===0&&startToday.getUTCDay()===d?" is-today":"");
   btn.setAttribute("aria-current",selectedDay===d?"date":"false");
   btn.setAttribute("aria-label",dayFull[d]+", "+range(dt));
   const small=document.createElement("span");small.textContent=dayShort[d];
   const num=document.createElement("b");num.textContent=dt.getUTCDate();
   btn.append(small,num);btn.addEventListener("click",()=>{selectedDay=d;renderWeek();});
   nav.append(btn);
 }
 renderClasses(currentMon);
}
function timeLabel(time){
 const [hr,minute]=time.split(":").map(Number);
 return String(hr%12||12)+":"+String(minute).padStart(2,"0");
}
function simpleMinutes(time){const [h,m]=time.split(":").map(Number);return h*60+m;}
function renderClasses(weekMon){
 const dayDate=addDays(weekMon,selectedDay-1),day=dayFull[selectedDay];
 safeText($("classesHeading"),day+"'s classes");
 const items=LESSONS[selectedDay]||[];
 safeText($("classCount"),items.length+(items.length===1?" class":" classes"));
 const list=$("classList");list.replaceChildren();
 if(!items.length){
   const box=document.createElement("div");box.className="empty-day";
   const icon=document.createElement("span");icon.textContent="☕";
   const h=document.createElement("strong");h.textContent="Nothing on the schedule";
   const p=document.createElement("p");p.textContent="A little space just for you.";
   box.append(icon,h,p);list.append(box);
 } else {
   const p=datePartsInTaipei(),now=new Date();
   const selectedKey=dayDate.toISOString().slice(0,10);
   const nowKey=[p.year,String(p.month).padStart(2,"0"),String(p.day).padStart(2,"0")].join("-");
   const isToday=selectedKey===nowKey;
   const m=isToday?(p.hour*60+Number(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",minute:"2-digit"}).format(now))):-1;
   for(const lesson of items){
     const course=COURSE[lesson.course],row=document.createElement("article");
     const isOver=isToday&&m>=simpleMinutes(lesson.end);
     const isLive=isToday&&m>=simpleMinutes(lesson.start)&&m<simpleMinutes(lesson.end);
     row.className="class-card"+(isOver?" done":"")+(isLive?" live":"");
     row.style.setProperty("--course-color",course.color);
     const times=document.createElement("div");times.className="class-time";
     times.textContent=timeLabel(lesson.start);
     const timeEnd=document.createElement("small");timeEnd.textContent="– "+timeLabel(lesson.end);
     times.append(timeEnd);
     const info=document.createElement("div");info.className="class-info";
     const name=document.createElement("h3");name.textContent=course.title;
     const loc=document.createElement("p");loc.textContent="⌖ "+course.location;
     info.append(name,loc);
     if(lesson.optional||isLive){
       const badges=document.createElement("div");badges.className="class-tags";
       const badge=document.createElement("span");badge.className="tag";badge.textContent=isLive?"Happening now":"Optional";
       badges.append(badge);info.append(badges);
     }
     row.append(times,info);list.append(row);
   }
 }
 const foot=["","A gentle start to the week.","Room for a little spontaneity.","Halfway there. You're doing fine.","You have a lot going on!","Almost the weekend.","The weekend is yours."];
 safeText($("dayFooter"),foot[selectedDay]);
}
function renderTasks(){
 const list=$("taskList");list.replaceChildren();
 for(const task of tasks){
  const row=document.createElement("li");row.className="task-row";
  const check=document.createElement("button");check.type="button";check.className="task-check"+(task.done?" checked":"");check.setAttribute("aria-label",(task.done?"Mark incomplete: ":"Mark complete: ")+task.text);check.setAttribute("aria-pressed",String(Boolean(task.done)));
  if(task.done)check.append(svgSymbol("checkIcon"));
  check.addEventListener("click",()=>{task.done=!task.done;save("tasks",tasks);renderTasks();});
  const name=document.createElement("span");name.className="task-text"+(task.done?" checked":"");name.textContent=task.text;
  const del=document.createElement("button");del.type="button";del.className="delete";del.setAttribute("aria-label","Delete task: "+task.text);del.append(svgSymbol("trashIcon"));
  del.addEventListener("click",()=>{tasks=tasks.filter(x=>x.id!==task.id);save("tasks",tasks);renderTasks();});
  row.append(check,name,del);list.append(row);
 }
 safeText($("taskCount"),tasks.filter(t=>!t.done).length+" left");
 if(!tasks.length){const li=document.createElement("li");li.className="micro";li.textContent="No tasks here yet. A blank slate.";list.append(li);}
}
function renderNotes(){
 const list=$("noteList");list.replaceChildren();
 for(const note of notes){
   const row=document.createElement("li");row.className="task-row note-row";
   const span=document.createElement("span");span.className="task-text";span.textContent=note.text;
   const del=document.createElement("button");del.type="button";del.className="delete";del.setAttribute("aria-label","Delete note: "+note.text);del.append(svgSymbol("trashIcon"));
   del.addEventListener("click",()=>{notes=notes.filter(x=>x.id!==note.id);save("notes",notes);renderNotes();});
   row.append(span,del);list.append(row);
 }
 if(!notes.length){const li=document.createElement("li");li.className="micro";li.textContent="Your desk is clear.";list.append(li);}
}
$("taskForm").addEventListener("submit",e=>{
 e.preventDefault();const input=$("taskInput"),text=input.value.trim();if(!text)return;
 tasks.unshift({id:uniqueId(),text,done:false});tasks=tasks.slice(0,100);save("tasks",tasks);input.value="";renderTasks();input.focus();
});
$("noteForm").addEventListener("submit",e=>{
 e.preventDefault();const input=$("noteInput"),text=input.value.trim();if(!text)return;
 notes.unshift({id:uniqueId(),text});notes=notes.slice(0,100);save("notes",notes);input.value="";renderNotes();input.focus();
});
$("prevWeek").addEventListener("click",()=>{weekShift=Math.max(-26,weekShift-1);renderWeek();});
$("nextWeek").addEventListener("click",()=>{weekShift=Math.min(26,weekShift+1);renderWeek();});
$("jumpToday").addEventListener("click",()=>{weekShift=0;selectedDay=startToday.getUTCDay()||1;renderWeek();});
const mug=$("mugButton"),pop=$("shortcutPop");
function setMugOpen(open){pop.classList.toggle("open",open);mug.setAttribute("aria-expanded",String(open));if(open){pop.querySelector("a")?.focus();}}
mug.addEventListener("click",()=>setMugOpen(!pop.classList.contains("open")));
document.addEventListener("pointerdown",e=>{if(!e.target.closest("#mugArea")&&pop.classList.contains("open"))setMugOpen(false);});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&pop.classList.contains("open")){setMugOpen(false);mug.focus();}});
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
$("skyWindow").addEventListener("keydown",e=>{
 if(e.key==="Enter"||e.key===" "){e.preventDefault();changeSky();}
});
function clockTick(){safeText($("clock"),"Taipei · "+clockFmt.format(new Date()));if(skyMode==="auto")renderSky();}
$("keyboardKeys").replaceChildren(...Array.from({length:45},()=>document.createElement("i")));
renderWeek();renderTasks();renderNotes();clockTick();setInterval(clockTick,60000);
