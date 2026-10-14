export function fixture() {
  return {
    format: 1, source_project: 'evckshjtzikuusnkdnjn', snapshot_at: '2026-10-13T00:00:00.000Z',
    workspaces: ['eren','begum'].map((person,index) => ({ app_slug: person, workspace_hash: String(index+1).repeat(64), cool_feed_url: '', hanzi_username: '' })),
    tasks: ['eren','begum'].map((person,index) => ({ workspace_hash: String(index+1).repeat(64), id: `task-${person}`, text: `${person} staging task`, done: false, created_at: '2026-10-12T00:00:00.000Z', updated_at: '2026-10-12T00:00:00.000Z' })),
    transfers: [], storage_inventory: []
  };
}
