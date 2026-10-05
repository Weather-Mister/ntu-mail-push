import sanitizeHtml from 'sanitize-html';
import postcss from 'postcss';

type ImageOptions = {externalImages?:boolean;inlineImages?:Map<string,string>};
const color=/^(?:#[a-f0-9]{3,8}|[a-z]{1,20}|rgba?\([\d\s.,%]+\))$/i;
const size=/^(?:0|auto|(?:\d{1,4}(?:\.\d{1,2})?)(?:px|pt|em|rem|%))$/;
const spacing=/^(?:0|auto|\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%))(?:\s+(?:0|auto|\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%))){0,3}$/;
const styles:Record<string,RegExp[]>={
 color:[color],background:[color],'background-color':[color],'font-size':[size],
 'font-family':[/^[a-zA-Z\s,'"-]{1,160}$/],'font-weight':[/^(normal|bold|[1-9]00)$/],
 'font-style':[/^(normal|italic)$/],'text-align':[/^(left|right|center|justify)$/],
 font:[/^(?:(?:normal|italic|bold|[1-9]00)\s+){0,3}\d{1,3}(?:px|pt|em|rem)(?:\/(?:\d(?:\.\d{1,2})?|\d{1,3}(?:px|pt|%)))?\s+[a-zA-Z\s,'"-]{1,160}$/],
 'letter-spacing':[/^(?:normal|\d(?:\.\d{1,2})?(?:px|em))$/],
 'text-transform':[/^(none|uppercase|lowercase|capitalize)$/],
 'text-decoration':[/^(none|underline|line-through)$/],'vertical-align':[/^(top|middle|bottom|baseline)$/],
 'line-height':[/^(?:\d(?:\.\d{1,2})?|\d{1,3}(?:px|pt|%))$/],
 width:[size],'max-width':[size],height:[size],'border-radius':[spacing],
 margin:[spacing],padding:[spacing],display:[/^(block|inline|inline-block|table|table-row|table-cell|none)$/],
 'border-collapse':[/^(collapse|separate)$/], 'border-spacing':[spacing],
 border:[/^(?:0|\d{1,2}px (?:solid|dashed|dotted) (?:#[a-f0-9]{3,8}|[a-z]{1,20}))$/i],
};
for(const side of ['top','right','bottom','left'])for(const prop of ['margin','padding'])styles[`${prop}-${side}`]=[spacing];

// Keep email stylesheets, including responsive rules, but no imports, fonts,
// URLs, animation, positioning, generated content or other active CSS.
function safeStylesheets(html:string) {
 let result='';
 for(const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
  if(match[1].length>100000)continue;
  try {
   const root=postcss.parse(match[1]);
   root.walkAtRules(rule=>{if(rule.name!=='media'||!/^\s*(?:(?:only )?screen\s*(?:and\s*)?)?\((?:max|min)-width:\s*\d{1,4}px\)\s*$/.test(rule.params))rule.remove();});
   root.walkRules(rule=>{if(!/^[a-zA-Z0-9\s.#,:>+~*()\[\]="'-]{1,500}$/.test(rule.selector))rule.remove();});
   root.walkDecls(decl=>{if(!styles[decl.prop]?.some(re=>re.test(decl.value)))decl.remove();});
   root.walkComments(comment=>{comment.remove();});
   const css=root.toString();if(!/</.test(css))result+=css;
  }catch{/* Broken CSS should not break the message. */}
 }
 return result;
}

function remoteImage(src:string) {
 try {
  const url=new URL(src.startsWith('//')?'https:'+src:src);
  // External loads happen in the sandboxed browser only after explicit consent.
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')return '';
  if(!/^[a-z0-9.-]+\.[a-z]{2,63}$/i.test(url.hostname)||/\.(?:local|localhost|internal|test|invalid)$/i.test(url.hostname))return '';
  return url.href;
 }catch{return '';}
}

export function inlineImages(payload:any) {
 const images=new Map<string,string>();let bytes=0;
 function visit(p:any) {
  const cid=(p.headers||[]).find((h:any)=>h.name.toLowerCase()==='content-id')?.value?.trim().replace(/^<|>$/g,'');
  if(cid&&/^image\/(png|jpeg|gif|webp)$/.test(p.mimeType||'')&&p.body?.data&&p.body.data.length<=2800000&&images.size<24) {
   try {
    const data=p.body.data.replace(/-/g,'+').replace(/_/g,'/'),raw=atob(data);
    const valid=p.mimeType==='image/png'?raw.startsWith('\x89PNG\r\n\x1a\n'):p.mimeType==='image/jpeg'?raw.startsWith('\xff\xd8\xff'):p.mimeType==='image/gif'?/^GIF8[79]a/.test(raw):raw.startsWith('RIFF')&&raw.slice(8,12)==='WEBP';
    if(valid&&bytes+raw.length<=8*1024*1024) {bytes+=raw.length;images.set(cid,'data:'+p.mimeType+';base64,'+data);}
   }catch{/* Invalid content must not prevent reading the mail. */}
  }
  for(const child of p.parts||[])visit(child);
 }
 visit(payload||{});return images;
}

export function safeHtml(html:string,options:ImageOptions={}) {
 const clean=sanitizeHtml(html,{
  allowedTags:['p','br','div','span','b','strong','i','em','u','s','blockquote','pre','code','h1','h2','h3','h4','h5','h6','ul','ol','li','table','thead','tbody','tfoot','tr','td','th','hr','a','img','center','font'],
  allowedAttributes:{'*':['style','class','id','align','dir'],a:['href','title','target','rel'],table:['width','cellpadding','cellspacing','border','bgcolor','role'],td:['colspan','rowspan','width','height','bgcolor','valign'],th:['colspan','rowspan','width','height','bgcolor','valign'],img:['src','alt','title','width','height','referrerpolicy','loading'],span:['data-external-image'],font:['color','face','size']},
  allowedStyles:{'*':styles},allowedSchemes:['https','http','mailto'],allowedSchemesByTag:{img:['https','data']},allowProtocolRelative:false,
  transformTags:{
   body:(_tag,attrs)=>({tagName:'div',attribs:attrs}),
   a:(_tag,attrs)=>({tagName:'a',attribs:{...attrs,target:'_blank',rel:'noopener noreferrer'}}),
   img:(_tag,attrs)=>{
    let cid='';try{cid=decodeURIComponent((attrs.src||'').replace(/^cid:/i,''));}catch{}
    const embedded=/^cid:/i.test(attrs.src||'')?options.inlineImages?.get(cid):'',remote=remoteImage(attrs.src||'');
    const src=embedded||(options.externalImages?remote:'');
    if(!src)return {tagName:'span',attribs:remote?{'data-external-image':'blocked'}:{},text:attrs.alt?'['+attrs.alt+']':''};
    return {tagName:'img',attribs:{...attrs,src,referrerpolicy:'no-referrer',loading:'lazy'}};
   },
  },
  nonTextTags:['script','style','textarea','noscript','iframe','object','template','svg','math'],
 });
 const images="data:"+(options.externalImages?' https:':'');
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${images}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html{color-scheme:light}body{font:14px/1.65 Arial,sans-serif;color:#343330;background:#fff;margin:0;padding:8px;overflow-wrap:anywhere}pre{white-space:pre-wrap}a{color:#263f77}blockquote{border-left:2px solid #ddd;padding-left:12px;margin-left:0}${safeStylesheets(html)}table{max-width:100%!important}img{max-width:100%!important;height:auto!important}</style></head><body>${clean}</body></html>`;
}
