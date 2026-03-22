import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadAiConfig } from '../config'

function writeTempYaml(contents: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edgebound-ai-config-'))
  const filePath = path.join(tempDir, 'matchups.yaml')
  fs.writeFileSync(filePath, contents)
  return filePath
}

describe('AI YAML config loader', () => {
  it('parses shorthand and object matchup syntax', () => {
    const yamlPath = writeTempYaml(`
numGames: 12
maxTurns: 300
outputDir: ai-output/custom
matchups:
  - p1: random
    p2: aggressive
  - p1:
      name: MyDefender
      strategy: defensive
    p2: random
`)

    const config = loadAiConfig(yamlPath)
    expect(config.numGames).toBe(12)
    expect(config.maxTurns).toBe(300)
    expect(config.outputDir).toBe('ai-output/custom')
    expect(config.matchups).toHaveLength(2)
    expect(config.matchups[0].p1.strategy).toBe('random')
    expect(config.matchups[0].p2.strategy).toBe('aggressive')
    expect(config.matchups[1].p1.name).toBe('MyDefender')
    expect(config.matchups[1].p1.strategy).toBe('defensive')
  })

  it('rejects invalid strategy names', () => {
    const yamlPath = writeTempYaml(`
matchups:
  - p1: random
    p2: sneaky
`)

    expect(() => loadAiConfig(yamlPath)).toThrow(/invalid/i)
  })

  it('parses per-phase strategy objects', () => {
    const yamlPath = writeTempYaml(`
matchups:
  - p1:
      name: Spread-Rusher
      strategy:
        setup: wide-spread
        opening: rush
        tactic: pick-heavy
    p2:
      strategy:
        setup: front-loaded
        opening: hold
        tactic: conservative
`)

    const config = loadAiConfig(yamlPath)
    expect(config.matchups).toHaveLength(1)
    const p1 = config.matchups[0].p1
    expect(p1.name).toBe('Spread-Rusher')
    expect(typeof p1.strategy).toBe('object')
    const p1s = p1.strategy as { setup: string; opening: string; tactic: string }
    expect(p1s.setup).toBe('wide-spread')
    expect(p1s.opening).toBe('rush')
    expect(p1s.tactic).toBe('pick-heavy')

    const p2 = config.matchups[0].p2
    const p2s = p2.strategy as { setup: string; opening: string; tactic: string }
    expect(p2s.setup).toBe('front-loaded')
    expect(p2s.opening).toBe('hold')
    expect(p2s.tactic).toBe('conservative')
  })

  it('rejects invalid per-phase strategy fields', () => {
    const yamlPath = writeTempYaml(`
matchups:
  - p1:
      strategy:
        setup: wide-spread
        opening: badvalue
        tactic: pick-heavy
    p2: random
`)

    expect(() => loadAiConfig(yamlPath)).toThrow(/opening.*invalid/i)
  })

  it('requires non-empty matchups', () => {
    const yamlPath = writeTempYaml(`
numGames: 10
`)

    expect(() => loadAiConfig(yamlPath)).toThrow(/matchups/i)
  })
})
