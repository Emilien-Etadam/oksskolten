import { describe, it, expect } from 'vitest'
import { parseGithubRepoUrl, githubRepoUrl } from './github-repo.js'

describe('parseGithubRepoUrl', () => {
  it('reads the repository from any page inside it', () => {
    for (const url of [
      'https://github.com/opendatalab/MinerU',
      'https://github.com/opendatalab/MinerU/',
      'https://github.com/opendatalab/MinerU.git',
      'https://www.github.com/opendatalab/MinerU',
      'https://github.com/opendatalab/MinerU/releases/tag/mineru-2.5.4-released',
      'https://github.com/opendatalab/MinerU/blob/master/README.md',
      'http://github.com/opendatalab/MinerU?tab=readme-ov-file',
    ]) {
      expect(parseGithubRepoUrl(url), url).toEqual({ owner: 'opendatalab', repo: 'MinerU' })
    }
  })

  it('keeps dots in repository names', () => {
    expect(parseGithubRepoUrl('https://github.com/vercel/next.js')).toEqual({ owner: 'vercel', repo: 'next.js' })
  })

  it('rejects pages that name no repository', () => {
    for (const url of [
      'https://github.com/opendatalab',
      'https://github.com/stars/babarot',
      'https://github.com/orgs/opendatalab/repositories',
      'https://github.com/topics/pdf',
      'https://gitlab.com/opendatalab/MinerU',
      'https://github.com/a/..',
      'not a url',
      'ftp://github.com/opendatalab/MinerU',
    ]) {
      expect(parseGithubRepoUrl(url), url).toBeNull()
    }
  })

  it('round-trips through githubRepoUrl', () => {
    expect(githubRepoUrl({ owner: 'opendatalab', repo: 'MinerU' })).toBe('https://github.com/opendatalab/MinerU')
  })
})
