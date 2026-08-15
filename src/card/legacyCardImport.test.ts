import { describe, expect, it } from 'vitest'
import { importLegacyCards, type LegacyCardImportFilePort } from './legacyCardImport'

class LegacyFiles implements LegacyCardImportFilePort {
  reads: string[] = []
  constructor(private readonly files: Record<string, string>) {}

  async readDirectory(path: string) {
    return Object.keys(this.files)
      .filter(file => file.startsWith(`${path}/`))
      .map(file => ({ name: file.slice(path.length + 1), isDirectory: false, path: file }))
  }

  async readFile(path: string) {
    this.reads.push(path)
    return this.files[path] ?? null
  }
}

const cardCode = (className: string, name = className) => `
public class ${className} : CardComponent {
  public override void SetDefaults() {
    Name = "${name}";
    Cost = 1;
    Type = CardType.Attack;
    Rarity = CardRarity.Common;
    Description = "Deal damage";
  }
}`

describe('explicit legacy C# Card import', () => {
  it('只在显式调用时扫描 scripts/Cards，并生成空行为图迁移草稿', async () => {
    const files = new LegacyFiles({
      '/project/scripts/Cards/Fireball.cs': cardCode('Fireball'),
      '/project/scripts/Cards/Ignore.txt': 'not C#',
    })
    const result = await importLegacyCards('/project', { files })

    expect(files.reads).toEqual(['/project/scripts/Cards/Fireball.cs'])
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('migrated-draft')
    expect(result[0].document?.card.id).toBe('Fireball')
    expect(result[0].document?.graph.nodes).toEqual([])
  })

  it('不覆盖旧产物，并报告重复 ID 冲突', async () => {
    const files = new LegacyFiles({
      '/project/scripts/Cards/Fireball.cs': cardCode('Fireball', 'First'),
      '/project/scripts/Cards/FIREBALL.cs': cardCode('FIREBALL', 'Second'),
    })
    const result = await importLegacyCards('/project', { files })

    expect(result.map(item => item.status)).toEqual(['migrated-draft', 'conflict'])
    expect(result[1].reason).toMatch(/ID.*冲突/)
  })

  it('解析失败逐 Card 隔离，不阻塞其他旧卡', async () => {
    const files = new LegacyFiles({
      '/project/scripts/Cards/Broken.cs': 'public class Broken {}',
      '/project/scripts/Cards/Good.cs': cardCode('Good'),
    })
    const result = await importLegacyCards('/project', { files })

    expect(result).toHaveLength(2)
    expect(result.find(item => item.fileName === 'Broken.cs')?.status).toBe('invalid')
    expect(result.find(item => item.fileName === 'Good.cs')?.status).toBe('migrated-draft')
  })
})
