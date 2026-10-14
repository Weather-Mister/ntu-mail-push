// Keep scheduled NTU sync from occupying the interactive session's serial queue.
// Each session still serializes its own requests and remains workspace scoped.
export function ntuSessionKey(account,background=false){
 return account.workspace_hash+':'+account.id+(background?':background':'');
}
