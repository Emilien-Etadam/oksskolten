import fs from 'node:fs'
import path from 'node:path'
import type { BenchConfig } from './config.js'
import { FILES } from './config.js'
import { buildSample } from './sample.js'
import { BenchRunner, loadResults } from './calls.js'
import { analyze, replayRecording } from './analyze.js'
import { renderReport } from './report.js'
import { CALLS_PER_ARTICLE, type ArbitrationFile, type ProgressFile, type SampleFile } from './types.js'

/**
 * Everything after the snapshot. Imported dynamically by run.ts once
 * DATABASE_URL points at the snapshot, since it pulls in the production
 * database modules.
 */

interface PipelineOptions {
  cfg: BenchConfig
  runDir: string
  arbitrationsFile: string | null
  reportOnly: boolean
  progress: (patch: Partial<ProgressFile>) => void
}

function readArbitrations(file: string | null, runId: string): ArbitrationFile['items'] {
  if (!file) return {}
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ArbitrationFile>
  if (parsed.run && parsed.run !== runId) {
    console.warn(`Arbitrations were exported from run ${parsed.run}, not ${runId}: only matching article/question keys apply`)
  }
  return parsed.items ?? {}
}

export async function runPipeline({ cfg, runDir, arbitrationsFile, reportOnly, progress }: PipelineOptions): Promise<void> {
  const runId = path.basename(runDir)
  const samplePath = path.join(runDir, FILES.sample)
  const resultsPath = path.join(runDir, FILES.results)

  progress({ phase: 'sample' })
  let sample: SampleFile
  if (fs.existsSync(samplePath)) {
    sample = JSON.parse(fs.readFileSync(samplePath, 'utf8')) as SampleFile
  } else {
    sample = buildSample(cfg)
    fs.writeFileSync(samplePath, JSON.stringify(sample, null, 1))
    console.log(`Sample: ${sample.articles.length} articles (${sample.counts.labeledUsed} labeled, ${sample.counts.excludedAsInjectedExamples} excluded as importance examples)`)
  }

  const results = loadResults(resultsPath)
  const callsTotal = sample.articles.length * CALLS_PER_ARTICLE
  let errors = 0
  progress({ phase: 'calls', trial: sample.trial, articlesTotal: sample.articles.length, callsTotal, callsDone: results.size, errors })

  if (!reportOnly) {
    let lastWrite = 0
    const runner = new BenchRunner(cfg, results, resultsPath, () => {
      // Throttled: the settings page polls this file
      if (Date.now() - lastWrite < 1000) return
      lastWrite = Date.now()
      progress({ callsDone: results.size, errors })
    })
    console.log(`Calls: ${results.size}/${callsTotal} already recorded, concurrency ${cfg.concurrency}`)
    let next = 0
    const worker = async () => {
      while (next < sample.articles.length) {
        const a = sample.articles[next++]
        try {
          await runner.runArticle(a.id)
        } catch (err) {
          // Nothing recorded for the failed call: the next run makes it again
          errors++
          console.warn(`article ${a.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
        console.log(`${results.size}/${callsTotal} calls`)
      }
    }
    await Promise.all(Array.from({ length: Math.min(cfg.concurrency, sample.articles.length) }, worker))
    progress({ callsDone: results.size, errors })
  }

  progress({ phase: 'report' })
  const arbitrations = readArbitrations(arbitrationsFile, runId)
  if (arbitrationsFile) {
    // Kept next to the run so a later re-report sees the same choices
    const own = path.join(runDir, FILES.arbitrations)
    if (path.resolve(arbitrationsFile) !== own) fs.copyFileSync(arbitrationsFile, own)
  }
  const analysis = analyze(sample, results, cfg.thetas, arbitrations)
  const t = analysis.totals
  const wall = t.firstCallAt && t.lastCallAt ? Date.parse(t.lastCallAt) - Date.parse(t.firstCallAt) : 0
  fs.writeFileSync(path.join(runDir, FILES.report), renderReport(runId, sample, analysis, cfg.thetas, wall))
  fs.writeFileSync(path.join(runDir, cfg.replayFile), JSON.stringify(replayRecording(sample, results)))

  const missing = callsTotal - results.size
  progress({
    status: missing > 0 ? 'error' : 'done',
    message: missing > 0 ? `${missing} call(s) missing: resume the run to make them` : '',
    callsDone: results.size,
    errors,
    finishedAt: new Date().toISOString(),
  })
  console.log(`Report: ${path.join(runDir, FILES.report)}${missing > 0 ? ` (${missing} calls missing)` : ''}`)
}
