import { useState } from 'react'
import { join } from 'path'
import * as FileService from '../services/FileService'
import { Modal } from './Modal'
import { ModManifest } from '../types'

interface NewProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onProjectCreated: (path: string) => void
}

export function NewProjectModal({ isOpen, onClose, onProjectCreated }: NewProjectModalProps) {
  const [projectName, setProjectName] = useState('')
  const [modId, setModId] = useState('')
  const [author, setAuthor] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState('')

  const handleCreate = async () => {
    if (!projectName.trim() || !modId.trim()) {
      setError('请填写项目名称和Mod ID')
      return
    }

    setLoading(true)
    setError(null)
    setProgress('正在选择保存位置...')

    try {
      const savePath = await FileService.selectSaveDirectory()
      if (!savePath) {
        setLoading(false)
        return
      }

      const projectPath = join(savePath, projectName)
      setProgress('正在创建项目结构...')
      await createBasicProject(projectPath)

      setProgress('正在配置项目...')
      const manifest: ModManifest = {
        id: modId,
        name: projectName,
        version: '1.0.0',
        authors: [author || 'Anonymous'],
        description: `A mod for Slay the Spire 2`,
        dependencies: []
      }
      await FileService.saveModManifest(projectPath, manifest)

      setProgress('完成!')
      setLoading(false)
      onProjectCreated(projectPath)
      onClose()

      setProjectName('')
      setModId('')
      setAuthor('')
      setProgress('')
    } catch (err) {
      setError(`创建失败: ${err}`)
      setLoading(false)
    }
  }

  const createBasicProject = async (projectPath: string) => {
    await FileService.createDirectory(projectPath)
    await FileService.createDirectory(join(projectPath, 'scripts', 'Cards'))
    await FileService.createDirectory(join(projectPath, 'resources'))
    await FileService.createDirectory(join(projectPath, 'resources', 'cards'))
    await FileService.createDirectory(join(projectPath, 'resources', 'images'))

    await FileService.writeFile(
      join(projectPath, 'project.godot'),
      `; Engine configuration file.
config_version=5

[application]

run/main_scene="res://Main.tscn"
config/name="${projectName}"
config/description="A Slay the Spire 2 mod"
config/version="1.0.0"
`
    )

    await FileService.writeFile(
      join(projectPath, 'MainFile.cs'),
      `using Godot;
using RitsuMod;

public partial class MainFile : Node
{
    public override void _Ready()
    {
        ModManager.Initialize();
        GD.Print("Mod loaded successfully!");
    }
}
`
    )

    await FileService.writeFile(
      join(projectPath, 'nuget.config'),
      `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
</configuration>
`
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="新建 Mod 项目" width={480}>
      <div className="new-project-body">
        <div className="form-group">
          <label>项目名称 *</label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="My Awesome Mod"
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label>Mod ID *</label>
          <input
            type="text"
            value={modId}
            onChange={(e) => setModId(e.target.value)}
            placeholder="com.author.my-awesome-mod"
            disabled={loading}
          />
          <small>建议使用反向域名格式，如 com.yourname.modname</small>
        </div>

        <div className="form-group">
          <label>作者</label>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your Name"
            disabled={loading}
          />
        </div>

        {error && <div className="error-msg">{error}</div>}
        {loading && <div className="progress-msg">{progress}</div>}
      </div>

      <div className="new-project-footer">
        <button className="cancel-btn" onClick={onClose} disabled={loading}>
          取消
        </button>
        <button className="create-btn" onClick={handleCreate} disabled={loading}>
          {loading ? '创建中...' : '创建项目'}
        </button>
      </div>

      <style>{`
        .new-project-body {
          padding: 20px;
        }

        .form-group {
          margin-bottom: 16px;
        }

        .form-group label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 6px;
          color: var(--text-primary);
        }

        .form-group input {
          width: 100%;
        }

        .form-group small {
          display: block;
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 4px;
        }

        .error-msg {
          color: var(--accent);
          font-size: 14px;
          padding: 8px 12px;
          background: rgba(233, 69, 96, 0.1);
          border-radius: 4px;
          margin-top: 12px;
        }

        .progress-msg {
          color: #4ade80;
          font-size: 14px;
          padding: 8px 12px;
          background: rgba(74, 222, 128, 0.1);
          border-radius: 4px;
          margin-top: 12px;
        }

        .new-project-footer {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          padding: 16px 20px;
          border-top: 1px solid var(--border);
        }

        .cancel-btn {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .create-btn {
          background: var(--accent);
        }
      `}</style>
    </Modal>
  )
}