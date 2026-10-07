import { useCallback, useEffect, useMemo, useState } from 'react'
type ModInfo = { id: string; folderName: string; name: string; version: string; author: string; description: string; enabled: boolean }

export function ModManager({ gamePath, onOpenSettings }: { gamePath: string; onOpenSettings: () => void }) {
  const [mods, setMods] = useState<ModInfo[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    if (!gamePath) { setMods([]); return }
    setLoading(true); setError('')
    try {
      const result = await window.electronAPI.listMods(gamePath)
      if (result.ok) setMods(result.mods ?? [])
      else setError(result.error ?? '无法读取 Mods 目录')
    } catch { setError('读取 Mods 目录失败，请确认游戏路径和目录权限。') }
    finally { setLoading(false) }
  }, [gamePath])
  useEffect(() => { void refresh() }, [refresh])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return needle ? mods.filter(mod => `${mod.name} ${mod.id} ${mod.author} ${mod.description}`.toLocaleLowerCase().includes(needle)) : mods
  }, [mods, query])
  const enabledCount = mods.filter(mod => mod.enabled).length

  const changeMod = async (mod: ModInfo, action: 'enable' | 'disable' | 'uninstall') => {
    if (busyId) return
    if (action === 'uninstall' && !window.confirm(`将「${mod.name}」移入游戏目录中的 Mod Studio 回收区？文件可以手动恢复。`)) return
    setBusyId(mod.folderName); setError(''); setNotice('')
    try {
      const result = action === 'uninstall'
        ? await window.electronAPI.uninstallMod(gamePath, mod.folderName)
        : await window.electronAPI.setModEnabled(gamePath, mod.folderName, action === 'enable')
      if (!result.success) setError(result.error ?? '操作失败')
      else { setNotice(action === 'uninstall' ? `已卸载 ${mod.name}，文件已移至回收区。` : `${mod.name} 已${action === 'enable' ? '启用' : '停用'}。`); await refresh() }
    } catch { setError('操作失败，请刷新列表后重试。') }
    finally { setBusyId(null) }
  }

  const install = async () => {
    if (busyId) return
    setBusyId('__install__'); setError(''); setNotice('')
    try {
      const result = await window.electronAPI.installMod(gamePath)
      if (result.cancelled) return
      if (!result.success) setError(result.error ?? '安装失败')
      else { setNotice('Mod 已复制到游戏目录。'); await refresh() }
    } catch { setError('安装失败，请检查游戏目录权限。') }
    finally { setBusyId(null) }
  }

  if (!gamePath) return <section className="mod-manager mod-manager-empty"><span className="manager-kicker">GAME LIBRARY</span><h3>先连接游戏目录</h3><p>配置 Slay the Spire 2 的安装位置后，即可查看并管理其中的 Mod。</p><button className="manager-primary" onClick={onOpenSettings}>打开游戏设置</button><ManagerStyles /></section>

  return <section className="mod-manager">
    <header className="manager-header"><div><span className="manager-kicker">GAME LIBRARY / MODS</span><h3>已安装的 Mod</h3><p className="manager-path" title={gamePath}>{gamePath}\mods</p></div>
      <div className="manager-actions"><button className="manager-secondary" onClick={() => void window.electronAPI.openModsFolder(gamePath)}>打开目录</button><button className="manager-secondary" onClick={() => void refresh()} disabled={loading}>刷新</button><button className="manager-primary" onClick={() => void install()} disabled={Boolean(busyId)}>{busyId === '__install__' ? '正在安装…' : '安装本地 Mod'}</button></div>
    </header>
    <div className="manager-summary"><span><i className="status-dot is-on" />{enabledCount} 个已启用</span><span><i className="status-dot is-off" />{mods.length - enabledCount} 个已停用</span><span className="manager-summary-total">共 {mods.length} 个</span></div>
    <label className="manager-search"><span aria-hidden="true">⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称、ID 或作者" aria-label="搜索 Mod" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索">清除</button>}</label>
    {error && <div className="manager-message is-error" role="alert">{error}</div>}{notice && <div className="manager-message is-success" role="status">{notice}</div>}
    {loading ? <div className="manager-empty-state">正在扫描游戏目录…</div> : filtered.length === 0 ? <div className="manager-empty-state"><span className="empty-mark">✳</span><strong>{query ? '没有匹配的 Mod' : '这里还没有 Mod'}</strong><span>{query ? '试试其他关键词。' : '选择已构建的 Mod 文件夹（含清单和 .dll/.pck），或把现有 Mod 放入游戏 Mods 目录。'}</span></div> :
      <div className="manager-list" aria-label="Mod 列表">{filtered.map(mod => <article className="manager-row" key={`${mod.enabled ? 'on' : 'off'}-${mod.folderName}`}>
        <span className={`manager-mod-icon ${mod.enabled ? 'is-enabled' : ''}`} aria-hidden="true">{mod.name.slice(0, 1).toLocaleUpperCase()}</span><div className="manager-mod-main"><div className="manager-mod-title"><strong>{mod.name}</strong><span className={`manager-status ${mod.enabled ? 'is-enabled' : ''}`}><i />{mod.enabled ? '已启用' : '已停用'}</span></div><div className="manager-mod-meta"><span>{mod.id}</span><span>v{mod.version}</span><span>{mod.author}</span></div>{mod.description && <p className="manager-description">{mod.description}</p>}</div>
        <div className="manager-row-actions"><button className="manager-secondary" disabled={Boolean(busyId)} onClick={() => void changeMod(mod, mod.enabled ? 'disable' : 'enable')}>{busyId === mod.folderName ? '处理中…' : mod.enabled ? '停用' : '启用'}</button><button className="manager-danger" disabled={Boolean(busyId)} onClick={() => void changeMod(mod, 'uninstall')}>卸载</button></div>
      </article>)}</div>}
    <footer className="manager-footnote">停用会将 Mod 移出游戏加载目录；卸载会移入 <code>.modstudio-removed-mods</code>，不会立即删除文件。</footer><ManagerStyles />
  </section>
}

function ManagerStyles() { return <style>{`
.mod-manager{min-height:100%;padding:26px clamp(18px,3vw,40px);color:var(--text-primary);background:radial-gradient(ellipse at 88% 0%,rgba(105,153,184,.1),transparent 42%),var(--bg-primary)}
.manager-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:22px;border-bottom:1px solid var(--border)}.manager-kicker{display:block;color:var(--text-secondary);font-size:10px;font-weight:700;letter-spacing:.16em}.manager-header h3,.mod-manager-empty h3{margin:9px 0 5px;font-size:23px;font-weight:650;letter-spacing:-.025em}.manager-path{max-width:min(60vw,620px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0;color:var(--text-secondary);font-size:12px}.manager-actions,.manager-row-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.manager-primary,.manager-secondary,.manager-danger{min-height:36px;padding:0 12px;border:1px solid var(--border);border-radius:7px;color:var(--text-primary);background:var(--bg-secondary);font:inherit;font-size:12px;cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .16s ease}.manager-primary{border-color:rgba(108,160,196,.58);background:linear-gradient(135deg,rgba(97,153,190,.3),rgba(71,115,148,.2))}.manager-primary:hover,.manager-secondary:hover{border-color:var(--accent);transform:translateY(-1px)}.manager-danger{color:#c65f65}.manager-danger:hover{border-color:#c65f65;background:rgba(198,95,101,.08)}.manager-primary:disabled,.manager-secondary:disabled,.manager-danger:disabled{opacity:.5;cursor:wait;transform:none}
.manager-summary{display:flex;align-items:center;gap:20px;padding:16px 0;color:var(--text-secondary);font-size:12px}.manager-summary span{display:inline-flex;align-items:center;gap:7px}.manager-summary-total{margin-left:auto}.status-dot,.manager-status i{width:7px;height:7px;border-radius:50%;background:#7d8790;display:inline-block}.status-dot.is-on,.manager-status.is-enabled i{background:#72a88c;box-shadow:0 0 0 3px rgba(114,168,140,.12)}.status-dot.is-off{background:#858d99}
.manager-search{display:flex;align-items:center;gap:9px;max-width:420px;height:38px;padding:0 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg-secondary);color:var(--text-secondary)}.manager-search>span{font-size:20px;line-height:1}.manager-search input{min-width:0;flex:1;border:0;outline:0;color:var(--text-primary);background:transparent;font:inherit;font-size:12px}.manager-search button{border:0;color:var(--text-secondary);background:none;font:inherit;font-size:11px;cursor:pointer}
.manager-list{margin-top:14px;border-top:1px solid var(--border)}.manager-row{display:flex;align-items:center;gap:14px;padding:16px 4px;border-bottom:1px solid var(--border)}.manager-mod-icon{width:40px;height:40px;flex:0 0 40px;display:grid;place-items:center;border:1px solid var(--border);border-radius:11px;color:var(--text-secondary);background:var(--bg-secondary);font-weight:700}.manager-mod-icon.is-enabled{color:#9fc8b0;border-color:rgba(114,168,140,.28);background:rgba(114,168,140,.09)}.manager-mod-main{min-width:0;flex:1}.manager-mod-title{display:flex;align-items:center;gap:10px}.manager-mod-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600}.manager-status{display:inline-flex;align-items:center;gap:6px;color:var(--text-secondary);font-size:10px;white-space:nowrap}.manager-mod-meta{display:flex;flex-wrap:wrap;gap:11px;margin-top:5px;color:var(--text-secondary);font-size:11px}.manager-description{max-width:660px;overflow:hidden;margin:7px 0 0;color:var(--text-secondary);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.manager-row-actions{flex:0 0 auto}
.manager-message{margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:7px;font-size:12px}.manager-message.is-error{color:#d8898c;border-color:rgba(198,95,101,.34);background:rgba(198,95,101,.07)}.manager-message.is-success{color:#95c1a5;border-color:rgba(114,168,140,.28);background:rgba(114,168,140,.07)}.manager-empty-state{min-height:210px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;color:var(--text-secondary);text-align:center;font-size:12px}.manager-empty-state strong{color:var(--text-primary);font-size:14px}.empty-mark{color:#8daac0;font-size:24px}.manager-footnote{padding-top:16px;color:var(--text-secondary);font-size:10px;line-height:1.7}.manager-footnote code{color:var(--text-primary)}.mod-manager-empty{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:40px}.mod-manager-empty p{max-width:450px;margin:4px 0 20px;color:var(--text-secondary);font-size:13px;line-height:1.7}.manager-primary:focus-visible,.manager-secondary:focus-visible,.manager-danger:focus-visible,.manager-search:focus-within{outline:2px solid var(--accent);outline-offset:2px}
@media(max-width:760px){.manager-header{flex-direction:column}.manager-actions{width:100%}.manager-row{align-items:flex-start;flex-wrap:wrap}.manager-mod-main{min-width:calc(100% - 58px)}.manager-row-actions{margin-left:54px}.manager-path{max-width:80vw}}@media(prefers-reduced-motion:reduce){.manager-primary,.manager-secondary,.manager-danger{transition:none}}
`}</style> }
