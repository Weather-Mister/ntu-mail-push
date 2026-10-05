export const ATTACHMENT_BUCKET='eren-mail-attachments';

export const draftAttachmentPath=(workspace:string,draftId:string,attachmentId:string)=>workspace+'/draft/'+draftId+'/'+attachmentId;
export const outboxAttachmentPath=(workspace:string,jobId:string,attachmentId:string)=>workspace+'/outbox/'+jobId+'/'+attachmentId;

export function decodeAttachmentData(data:string){
 const normalized=String(data||'').replace(/\s+/g,'');
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized))throw new Error('Attachment data is invalid.');
 try{return Uint8Array.from(atob(normalized),c=>c.charCodeAt(0));}catch{throw new Error('Attachment data is invalid.');}
}

export function encodeAttachmentData(bytes:Uint8Array){
 let binary='';
 for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+0x8000)));
 return btoa(binary);
}

export async function putAttachmentObject(admin:any,path:string,bytes:Uint8Array,type='application/octet-stream'){
 const {error}=await admin.storage.from(ATTACHMENT_BUCKET).upload(path,bytes,{contentType:type,cacheControl:'0',upsert:true});
 if(error)throw error;
}

export async function getAttachmentObject(admin:any,path:string){
 const {data,error}=await admin.storage.from(ATTACHMENT_BUCKET).download(path);
 if(error||!data)throw error||new Error('Attachment missing');
 return new Uint8Array(await data.arrayBuffer());
}

export async function removeAttachmentObjects(admin:any,paths:string[]){
 if(!paths.length)return;
 const {error}=await admin.storage.from(ATTACHMENT_BUCKET).remove(paths);
 if(error)throw error;
}

export async function copyAttachmentObject(admin:any,from:string,to:string){
 const bytes=await getAttachmentObject(admin,from);
 await putAttachmentObject(admin,to,bytes);
 return bytes.length;
}
