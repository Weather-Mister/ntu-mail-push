// Live task invalidations for the GitHub version of NTU Schedule.
// The private pairing key stays on-device. Only its one-way SHA-256 workspace
// identifier appears in the WebSocket channel. No task content is broadcast.
(() => {
  const STORAGE_KEY='ntu-schedule-pairing-key-v1';
  const PUBLIC_KEY='sb_publishable_Wbt6j8h6LXjm_hQ7hyQEzg_5t7eWHfL';
  const BASE='wss://evckshjtzikuusnkdnjn.supabase.co/realtime/v1/websocket';
  let socket=null,heartbeat=null,retry=null,sequence=0,generation=0,delay=1500;

  function refresh(){window.dispatchEvent(new Event('schedule-todos-changed'));}
  function clearConnection(){
    if(retry){clearTimeout(retry);retry=null;}
    if(heartbeat){clearInterval(heartbeat);heartbeat=null;}
    if(socket){const old=socket;socket=null;try{old.close()}catch{}}
  }
  function scheduleReconnect(){
    if(retry||!navigator.onLine)return;
    retry=setTimeout(()=>{retry=null;void connect();},delay);
    delay=Math.min(delay*2,45000);
  }
  async function topicFromKey(key){
    const normalized=key.trim().toLowerCase()==='begum'?'begum':key.trim();
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
    const hex=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
    return 'realtime:schedule-todos:'+hex;
  }
  async function connect(){
    const generationNow=++generation;
    clearConnection();
    let key='';
    try{key=localStorage.getItem(STORAGE_KEY)||''}catch{}
    if(key.length<5||key.length>200||!navigator.onLine)return;
    let topic;
    try{topic=await topicFromKey(key)}catch{scheduleReconnect();return}
    if(generationNow!==generation)return;
    const socketNow=new WebSocket(BASE+'?apikey='+encodeURIComponent(PUBLIC_KEY)+'&vsn=1.0.0');
    socket=socketNow;
    let joined=false;
    function send(event,payload){
      if(socketNow.readyState!==WebSocket.OPEN)return;
      socketNow.send(JSON.stringify({topic:event==='heartbeat'?'phoenix':topic,event,payload,ref:String(++sequence)}));
    }
    socketNow.onopen=()=>send('phx_join',{config:{broadcast:{ack:false,self:false},presence:{enabled:false},postgres_changes:[],private:false}});
    socketNow.onmessage=e=>{
      let msg;try{msg=JSON.parse(e.data)}catch{return}
      if(msg.topic===topic&&msg.event==='phx_reply'&&msg.payload?.status==='ok'&&!joined){
        joined=true;delay=1500;
        heartbeat=setInterval(()=>send('heartbeat',{}),25000);
        refresh(); // Catch changes missed while sleeping/offline.
      } else if(msg.topic===topic&&msg.event==='phx_reply'&&msg.payload?.status==='error'){
        socketNow.close();
      } else if(msg.topic===topic&&msg.event==='broadcast'&&msg.payload?.event==='changed'){
        refresh();
      }
    };
    socketNow.onclose=()=>{
      if(generationNow!==generation)return;
      if(heartbeat){clearInterval(heartbeat);heartbeat=null;}
      socket=null;scheduleReconnect();
    };
    socketNow.onerror=()=>socketNow.close();
  }
  window.addEventListener('schedule-pairing-changed',()=>void connect());
  window.addEventListener('online',()=>void connect());
  window.addEventListener('focus',()=>{if(!socket||socket.readyState!==WebSocket.OPEN)void connect();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(!socket||socket.readyState!==WebSocket.OPEN))void connect();});
  void connect();
})();
